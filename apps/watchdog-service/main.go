package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/eventlog"
)

const serviceName = "SystemHelper"
const exitEventName = `Global\ChunlvExitRequested`

// 服务自身版本。排查某台机器的看门狗是新是旧，看日志里这一行就行。
const serviceBuild = "2026-10-01.2"

// 自更新用的构建号：这两个字符串会被原样编进二进制里，
// 运行中的服务直接读「旁边那份 SystemHelper.exe」的字节，看它的构建号是不是比自己大——
// 比解析 PE 版本资源简单，也不会因为客户端包里带的还是老版本而把自己降级回有 bug 的旧版。
const serviceBuildNumber = "2026093006"

var buildTagLiteral = "CHUNLV_WATCHDOG_BUILD=2026093006" // 必须与 serviceBuildNumber 一致

// 陪玩端的安装位置（老机器的习惯，别动顺序）。
var companionSearchPaths = []string{
	`C:\Program Files\陪玩管理\陪玩管理.exe`,
	`C:\Program Files (x86)\陪玩管理\陪玩管理.exe`,
	filepath.Join(os.Getenv("LOCALAPPDATA"), `Programs\陪玩管理\陪玩管理.exe`),
	filepath.Join(os.Getenv("ProgramFiles"), `陪玩管理\陪玩管理.exe`),
	`C:\Program Files\蠢驴电竞\蠢驴电竞.exe`,
	`C:\Program Files\@chunlvcompanion-electron\蠢驴电竞.exe`,
	`C:\Program Files (x86)\@chunlvcompanion-electron\蠢驴电竞.exe`,
	`C:\Program Files (x86)\蠢驴电竞\蠢驴电竞.exe`,
	filepath.Join(os.Getenv("LOCALAPPDATA"), `Programs\蠢驴电竞\蠢驴电竞.exe`),
	filepath.Join(os.Getenv("ProgramFiles"), `蠢驴电竞\蠢驴电竞.exe`),
	filepath.Join(os.Getenv("ProgramFiles"), `@chunlvcompanion-electron\蠢驴电竞.exe`),
}

// 客服端（客服管理）的安装位置。老板 2026-09-30：客服电脑也要有看门狗，
// 否则客服端一挂就没人拉起来，更新也装不上（得等人走到电脑跟前）。
var csSearchPaths = []string{
	`C:\Program Files\客服管理\客服管理.exe`,
	`C:\Program Files (x86)\客服管理\客服管理.exe`,
	`C:\Program Files\@chunlvcs-electron\客服管理.exe`,
	`C:\Program Files (x86)\@chunlvcs-electron\客服管理.exe`,
	filepath.Join(os.Getenv("LOCALAPPDATA"), `Programs\客服管理\客服管理.exe`),
	filepath.Join(os.Getenv("ProgramFiles"), `客服管理\客服管理.exe`),
	filepath.Join(os.Getenv("ProgramFiles"), `@chunlvcs-electron\客服管理.exe`),
}

// 本机身份：这台电脑的看门狗该守哪个客户端。装机时由安装包写死
// （陪玩端 install --client=companion / 客服端 install --client=cs），
// 因为一台电脑上可能同时留着两份客户端（客服机常见：以前装过陪玩端没删干净）。
// 不认这份记录的话，客服机上的看门狗会去守那份陪玩端，客服端的更新信号
// 甚至会被解压到陪玩端目录里 —— 直接把人家的客户端换掉。
var clientKindFile = filepath.Join(updateSignalDir, "watchdog-client.txt")

const clientKindCs = "cs"
const clientKindCompanion = "companion"

func readClientKind() string {
	data, err := os.ReadFile(clientKindFile)
	if err != nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(string(data)))
}

func writeClientKind(kind string) {
	if kind == "" {
		return
	}
	_ = os.MkdirAll(updateSignalDir, 0755)
	_ = os.WriteFile(clientKindFile, []byte(kind), 0644)
}

// writeClientKindFromArgs 从安装命令里读身份：SystemHelper.exe install --client=cs
func writeClientKindFromArgs() {
	for _, a := range os.Args[2:] {
		if strings.HasPrefix(a, "--client=") {
			kind := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(a, "--client=")))
			if kind == clientKindCs || kind == clientKindCompanion {
				writeClientKind(kind)
				safeInfo("watchdog client kind set to " + kind)
			}
		}
	}
}

// orderedClientExeNames / orderedSearchPaths：按本机身份排优先级，另一类放在后面兜底
// （万一身份写的是客服端、这台机器上却没装客服端，还能退回陪玩端，不至于谁都不管）。
func orderedClientExeNames() []string {
	if readClientKind() == clientKindCs {
		return []string{csExeName, "陪玩管理.exe", "蠢驴电竞.exe"}
	}
	return clientExeNames
}

func orderedSearchPaths() []string {
	if readClientKind() == clientKindCs {
		return append(append([]string{}, csSearchPaths...), companionSearchPaths...)
	}
	return append(append([]string{}, companionSearchPaths...), csSearchPaths...)
}

// 客服端（客服管理）的进程名。老板 2026-09-30：客服电脑也要有看门狗，
// 否则客服端一挂就没人拉起来，更新也装不上（得等人走到电脑跟前）。
const csExeName = "客服管理.exe"

// 客户端进程名。顺序有意义：一台机器上同时装了陪玩端和客服端时优先认陪玩端
// （保持老机器的行为不变）；客服电脑上只有客服管理.exe，自然就认它。
var clientExeNames = []string{"陪玩管理.exe", "蠢驴电竞.exe", csExeName}

func isClientExe(name string) bool {
	for _, n := range clientExeNames {
		if strings.EqualFold(name, n) {
			return true
		}
	}
	return false
}

// isClientDirName 判断某个安装目录是不是「我们的」客户端目录。
// 只认名字里带 蠢驴 / 陪玩 / 客服 / chunlv / cs-electron 的目录，
// 避免把客户端解压到别的软件目录里。
func isClientDirName(name string) bool {
	lower := strings.ToLower(name)
	for _, kw := range []string{"蠢驴", "陪玩", "chunlv", "客服", "cs-electron"} {
		if strings.Contains(lower, strings.ToLower(kw)) {
			return true
		}
	}
	return false
}

// isCsDirName 判断目录名是不是客服端的安装目录。
func isCsDirName(name string) bool {
	lower := strings.ToLower(name)
	return strings.Contains(lower, "客服") || strings.Contains(lower, "cs-electron")
}

// isCsClient 判断这个「路径或目录」是不是客服端（传 exe 全路径或安装目录都行）。
// 客服端老版本装成过 客服端.exe / @chunlvcs-electron，所以 exe 名和目录名一起认。
func isCsClient(pathOrDir string) bool {
	if pathOrDir == "" {
		return false
	}
	base := filepath.Base(pathOrDir)
	if strings.EqualFold(base, csExeName) {
		return true
	}
	return isCsDirName(base)
}

// 云端整包地址：陪玩端和客服端各有自己的更新包，弄混会把别人的客户端装上来。
const cloudCompanionZipURL = "http://1.117.229.36:3001/api/agent/download/latest"
const cloudCsZipURL = "http://1.117.229.36:3001/api/agent/download/cs-zip"

func cloudClientZipFor(pathOrDir string) string {
	if isCsClient(pathOrDir) {
		return cloudCsZipURL
	}
	return cloudCompanionZipURL
}

// 本机已下好的更新包文件名也要分开：一台机器上万一先后装过两种客户端，
// 拿旧的陪玩端 zip 去更新客服端会把目录换成一个陪玩端。
func localUpdateZipName(pathOrDir string) string {
	if isCsClient(pathOrDir) {
		return "update-cs.zip"
	}
	return "update.zip"
}

func defaultClientDir(pathOrDir string) string {
	if isCsClient(pathOrDir) {
		return `C:\Program Files\客服管理`
	}
	return `C:\Program Files\陪玩管理`
}

// isSkippableDir 判断目录是不是我们自己的「临时/备份」目录，找客户端时必须跳过去。
// 备份目录里也躺着一份客户端 exe，被 findClient 认出来就会去拉旧版 ——
// 所以 staging / 备份 / 坏目录一律用点号开头，并且在这里统一排除。
func isSkippableDir(name string) bool {
	lower := strings.ToLower(name)
	return strings.HasPrefix(lower, ".") ||
		strings.Contains(lower, ".bak-") ||
		strings.Contains(lower, ".broken-")
}

var (
	elog               *eventlog.Log
	clientPath         string
	clientPID          uint32 // the PID we launched — only this one counts
	restartCount       int32
	lastRestartWindow  int64
	launchBackoffUntil int64
	launching          int32
	stopping           int32
	exitEvent          windows.Handle
	suppressLaunch     int32
	repairLastTry      int64
	// processKillDisabled：单测专用开关（见 main_test.go），生产路径上永远是 0。
	processKillDisabled int32
)

// 更新安全网 / 客户端启动健康度（2026-09-23 陈佳祺「双击图标没反应」事故之后加的）。
var (
	healthTrusted    int32 // 见过客户端写的健康标记 → 本机这套机制是通的，才敢按它回滚
	lastShortcutMs   int64
	launchAtMs       int64
	launchPid        int64
	crashCount       int32
	crashWindowStart int64
	zombieCount      int32
	lastDiagMs       int64
)

var (
	kernel32                         = windows.NewLazySystemDLL("kernel32.dll")
	wtsapi32                         = windows.NewLazySystemDLL("wtsapi32.dll")
	userenv                          = windows.NewLazySystemDLL("userenv.dll")
	procWTSGetActiveConsoleSessionId = kernel32.NewProc("WTSGetActiveConsoleSessionId")
	procWTSQueryUserToken            = wtsapi32.NewProc("WTSQueryUserToken")
	procCreateEnvironmentBlock       = userenv.NewProc("CreateEnvironmentBlock")
	procDestroyEnvironmentBlock      = userenv.NewProc("DestroyEnvironmentBlock")
)

var logDir = `C:\Program Files\SystemHelper`
var updateSignalDir = `C:\ProgramData\chunlv`
var updateSignalFile = `C:\ProgramData\chunlv\update.json`

// 看门狗「云端自更新」用的文件（见 cloudSelfUpdateCheck）。
var cloudStampFile = filepath.Join(updateSignalDir, "watchdog-cloud.json")
var cloudSkipFile = filepath.Join(updateSignalDir, "watchdog-no-selfupdate")
var cloudExeFile = filepath.Join(updateSignalDir, "SystemHelper-cloud.exe")

// 上次问云端的时间（Unix 纳秒）——5 秒一轮的主循环靠它把自己限流到 30 分钟一次。
var lastCloudCheck int64

// 客户端 exe 被弄丢、而本机又没留下更新包时（新装的机器、从没更新过的机器），
// 直接从云服务器取一份完整客户端包来补齐。以前这种情况直接放弃，
// 结果就是那台电脑再也拉不起客户端 —— 用户看到的是「客户端打不开、进不去系统」。
// 具体地址看 cloudClientZipFor：陪玩端 / 客服端各有自己的整包。

// 看门狗自己的故障现场也回传云端（onboard-reports/diag/），
// 这样客户端压根起不来的机器也能远程看状态，不用再让人去那台电脑上翻目录。
const diagReportURL = "http://1.117.229.36:3001/api/agent/diag-report"
const onboardToken = "c4f1a2e7d9b8435fa6e10c7d2b9f8e34"

func writeLog(level, msg string) {
	os.MkdirAll(logDir, 0755)
	f, err := os.OpenFile(filepath.Join(logDir, "service.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "%s [%s] %s\n", time.Now().Format("2006-01-02 15:04:05"), level, msg)
	if fi, _ := f.Stat(); fi != nil && fi.Size() > 1024*1024 {
		f.Truncate(0)
	}
}

func safeInfo(msg string) {
	writeLog("INFO", msg)
	if elog != nil {
		elog.Info(1, msg)
	}
}
func safeWarn(msg string) {
	writeLog("WARN", msg)
	if elog != nil {
		elog.Warning(1, msg)
	}
}
func safeErr(msg string) {
	writeLog("ERR", msg)
	if elog != nil {
		elog.Error(1, msg)
	}
}

func findClient() string {
	// 本机可能「并排」装了两份客户端（旧目录改名被系统按住、只能装到旁边那份新的）。
	// 认哪个以 preferred-client.json 为准，否则永远会去拉那份动不了的旧目录。
	if p := preferredClientExe(); p != "" {
		clientPath = p
		return p
	}
	if clientPath != "" {
		if _, err := os.Stat(clientPath); err == nil {
			return clientPath
		}
		clientPath = ""
	}
	for _, p := range orderedSearchPaths() {
		exists := false
		if _, err := os.Stat(p); err == nil {
			exists = true
			clientPath = p
			safeInfo(fmt.Sprintf("Found client: %s", p))
			return p
		}
		safeInfo(fmt.Sprintf("Scan: %s exists=%v", p, exists))
	}
	for _, base := range []string{`C:\Program Files`, `C:\Program Files (x86)`} {
		entries, err := os.ReadDir(base)
		if err != nil {
			continue
		}
		// 外层先按 exe 名遍历（按本机身份排优先级），内层再找目录：
		// 客服机认客服端、陪玩机认陪玩端，另一类只做兜底。
		for _, exe := range orderedClientExeNames() {
			for _, e := range entries {
				if !e.IsDir() || isSkippableDir(e.Name()) || !isClientDirName(e.Name()) {
					continue
				}
				c := filepath.Join(base, e.Name(), exe)
				if _, err := os.Stat(c); err == nil {
					clientPath = c
					return c
				}
			}
		}
	}
	return ""
}

// NOTE: deliberately NO cleanUnpacked() here. Deleting resources/app.asar.unpacked
// permanently breaks the client: asarUnpack files (e.g. socket.io-client) are
// extracted at BUILD time by electron-builder and are NOT regenerated at runtime.
// After removal every launch of 蠢驴电竞.exe fails to load main.js and shows a
// stuck "Error" window — while the watchdog wrongly treats the live PID as healthy.

// killAllClientProcesses kills every 蠢驴电竞.exe process on the system.
// This cleans up orphan GPU/renderer children that outlive the main process.
func killAllClientProcesses() {
	// 单测里绝不真杀进程：开发机上就装着陪玩端，`go test` 会把老板那台正在跑的
	// 客户端一起杀掉（2026-09-30 被误杀过一次，还好看门狗立刻又拉起来了）。
	// 开关在 main_test.go 的 init() 里打开。
	if atomic.LoadInt32(&processKillDisabled) != 0 {
		return
	}
	for attempt := 0; attempt < 3; attempt++ {
		killed := 0
		snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
		if err != nil {
			return
		}

		var pe windows.ProcessEntry32
		pe.Size = uint32(unsafe.Sizeof(pe))

		err = windows.Process32First(snapshot, &pe)
		for err == nil {
			name := windows.UTF16PtrToString(&pe.ExeFile[0])
			if isClientExe(name) {
				pid := pe.ProcessID
				if pid != 0 && pid != 4 { // skip idle & system
					h, e := windows.OpenProcess(windows.PROCESS_TERMINATE, false, pid)
					if e == nil {
						windows.TerminateProcess(h, 0)
						windows.CloseHandle(h)
						killed++
					}
				}
			}
			err = windows.Process32Next(snapshot, &pe)
		}
		windows.CloseHandle(snapshot)

		if killed > 0 {
			safeInfo(fmt.Sprintf("Killed %d client processes (pass %d)", killed, attempt+1))
		}
		if killed == 0 {
			return // all clean
		}
		time.Sleep(1 * time.Second) // wait for handles to release
	}
}

// fileSHA256 计算文件摘要，用来判断「旁边那份 SystemHelper.exe 是不是新的」。
func fileSHA256(p string) ([]byte, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return nil, err
	}
	return h.Sum(nil), nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

// selfUpdateIfNeeded 用「客户端安装目录里带的那份 SystemHelper.exe」替换服务本体。
//
// 为什么需要：陪玩端的自动更新只解压客户端目录，不会重装服务，
// 所以看门狗的修复如果不自我更新，永远到不了陪玩机器上（今天这种「误杀客户端」的 bug 就会一直复现）。
// 做法：把新版放到旁边，再把正在运行的旧版改名让位（运行中的 exe 不能覆盖但可以改名），
// 下次服务启动（重启电脑）就跑新版；换不动就原样退出，绝不动坏的顶上。
func selfUpdateIfNeeded(clientDir string) {
	if clientDir == "" {
		return
	}
	self, err := os.Executable()
	if err != nil {
		return
	}
	self = filepath.Clean(self)
	cand := filepath.Join(clientDir, "resources", "SystemHelper.exe")
	if strings.EqualFold(filepath.Clean(cand), self) {
		return
	}
	if _, err := os.Stat(cand); err != nil {
		return
	}
	candSum, err := fileSHA256(cand)
	if err != nil {
		safeWarn(fmt.Sprintf("self-update: candidate unreadable: %v", err))
		return
	}
	selfSum, err := fileSHA256(self)
	if err != nil {
		return
	}
	if bytes.Equal(candSum, selfSum) {
		return // 已是最新
	}
	// 只有「构建号更大」才换：客户端包里可能还带着老版本 SystemHelper.exe（老版本没有构建号标记），
	// 光看「文件不一样」会把自己降级回有 bug 的旧版。
	candBuild := readBuildNumber(cand)
	if candBuild == "" || candBuild <= serviceBuildNumber {
		return
	}
	// 只认 PE 头，避免把半个下载/解压文件装成服务。
	f, err := os.Open(cand)
	if err != nil {
		return
	}
	hdr := make([]byte, 2)
	_, err = io.ReadFull(f, hdr)
	f.Close()
	if err != nil || string(hdr) != "MZ" {
		safeWarn("self-update: candidate is not a PE file, skipped")
		return
	}
	newPath := self + ".new"
	if err := copyFile(cand, newPath); err != nil {
		safeWarn(fmt.Sprintf("self-update: stage new binary failed: %v", err))
		return
	}
	oldPath := self + ".old"
	_ = os.Remove(oldPath)
	if err := os.Rename(self, oldPath); err != nil {
		safeWarn(fmt.Sprintf("self-update: rename running exe failed: %v", err))
		_ = os.Remove(newPath)
		return
	}
	if err := os.Rename(newPath, self); err != nil {
		_ = os.Rename(oldPath, self) // 换不成就把旧的放回去
		safeWarn(fmt.Sprintf("self-update: swap failed, kept old binary: %v", err))
		return
	}
	safeInfo("self-update: staged new SystemHelper (takes effect on next service start)")
}

// ── 看门狗自己的「云端自更新」 ───────────────────────────────────────────────
//
// 老板 2026-09-30：「你看看还谁不是全自动的，以后都弄全自动」。
//
// 客户端自动更新只覆盖客户端目录（resources\SystemHelper.exe 是被捎带换掉的），
// 也就是说看门狗本体只能靠「客户端升一次级 + 服务重启一次」才换得掉。机器只要一直不重启、
// 客户端又一直更新不成功，看门狗就永远守在老版本上 —— 而它恰恰是负责下载 / 解压 / 拉起
// 客户端的那一环：老看门狗等于整条自动更新链断在最里面。2026-09-26 起 8 台陪玩机卡在旧版本
// 整整四天，就是栽在这里，每台都得人工登门换一次服务。
//
// 现在补上最后一环：每 30 分钟问一次云端（先只问 Last-Modified / 大小，变了才下载 9MB），
// 云端那份的构建号比自己新就把自己换掉，然后让「计划任务」把服务重启起来。
// 重启看门狗不碰正在接单的客户端（只有装客户端更新时才杀进程）。
const cloudWatchdogURL = "http://1.117.229.36:3001/uploads/SystemHelper.exe"

const cloudCheckInterval = 30 * time.Minute

// 开机后先让那一阵忙完，再开始问云端。
const cloudFirstCheckDelay = 3 * time.Minute

type cloudStamp struct {
	LastModified string `json:"lastModified"`
	Size         int64  `json:"size"`
	AppliedBuild string `json:"appliedBuild"`
	CheckedAt    string `json:"checkedAt"`
}

// cloudProbe 只取头信息，用来判断云端那份变了没有（不然每台每半小时白拉 9MB）。
func cloudProbe(url string) (string, int64, error) {
	resp, err := http.Head(url)
	if err == nil {
		defer resp.Body.Close()
		if resp.StatusCode == 200 {
			return resp.Header.Get("Last-Modified"), resp.ContentLength, nil
		}
	}
	// 有的反代不认 HEAD，退回「只取一个字节」。
	req, rerr := http.NewRequest("GET", url, nil)
	if rerr != nil {
		return "", 0, rerr
	}
	req.Header.Set("Range", "bytes=0-0")
	r2, rerr := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if rerr != nil {
		return "", 0, rerr
	}
	defer r2.Body.Close()
	_, _ = io.Copy(io.Discard, r2.Body)
	return r2.Header.Get("Last-Modified"), r2.ContentLength, nil
}

// downloadFileTo 拉一个文件到本地：先写 .part，字节数对得上、PE 头认得出，才改名到位。
// 没复用 downloadZipTo，是因为那个按「整包客户端 >10MB」卡大小，SystemHelper.exe 只有 9.3MB。
func downloadFileTo(url, dest string, minBytes int64) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download status %d", resp.StatusCode)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return err
	}
	tmp := dest + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	n, cerr := io.Copy(f, resp.Body)
	serr := f.Sync()
	f.Close()
	if cerr != nil {
		_ = os.Remove(tmp)
		return cerr
	}
	if serr != nil {
		_ = os.Remove(tmp)
		return serr
	}
	if resp.ContentLength > 0 && n != resp.ContentLength {
		_ = os.Remove(tmp)
		return fmt.Errorf("download truncated: got %d of %d bytes", n, resp.ContentLength)
	}
	if n < minBytes {
		_ = os.Remove(tmp)
		return fmt.Errorf("downloaded file too small: %d bytes", n)
	}
	fh, err := os.Open(tmp)
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	hdr := make([]byte, 2)
	_, herr := io.ReadFull(fh, hdr)
	fh.Close()
	if herr != nil || string(hdr) != "MZ" {
		_ = os.Remove(tmp)
		return fmt.Errorf("downloaded file is not a PE binary")
	}
	return os.Rename(tmp, dest)
}

// stageSelfReplace 用刚下载的那份替换服务本体。运行中的 exe 不能覆盖但可以改名，
// 所以还是「旧版让位、新版顶上」；换不成就把旧的放回去，绝不留一个半截服务。
func stageSelfReplace(cand string) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	self = filepath.Clean(self)
	newPath := self + ".new"
	if err := copyFile(cand, newPath); err != nil {
		return fmt.Errorf("stage: %w", err)
	}
	oldPath := self + ".old"
	_ = os.Remove(oldPath)
	if err := os.Rename(self, oldPath); err != nil {
		_ = os.Remove(newPath)
		return fmt.Errorf("rename running exe: %w", err)
	}
	if err := os.Rename(newPath, self); err != nil {
		_ = os.Rename(oldPath, self)
		return fmt.Errorf("swap: %w", err)
	}
	return nil
}

// cleanupSelfUpdateLeftovers 清掉换自己留下的 .old / .new（换成功就没用了）。
func cleanupSelfUpdateLeftovers() {
	self, err := os.Executable()
	if err != nil {
		return
	}
	self = filepath.Clean(self)
	_ = os.Remove(self + ".new")
	_ = os.Remove(self + ".old")
}

// runHidden 跑一个不弹黑窗的外部命令。
func runHidden(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// scheduleSelfRestart：把自己换掉之后，得让服务真的跑起来。光换文件、等下次开机才生效，
// 对一台常年不关机的陪玩电脑就等于永远不生效。所以交给「计划任务」来做 ——
// 它是系统计划的，不属于我们服务进程：我们 sc stop 把自己停了，它照样能把服务拉起来。
func scheduleSelfRestart(build string) {
	logPath := filepath.Join(updateSignalDir, "watchdog-restart.log")
	cmdPath := filepath.Join(updateSignalDir, "watchdog-restart.cmd")
	body := "@echo off\r\n" +
		"echo ==== restart for watchdog " + build + " ==== >> \"" + logPath + "\"\r\n" +
		"ping -n 6 127.0.0.1 >nul\r\n" +
		"sc stop " + serviceName + " >> \"" + logPath + "\" 2>&1\r\n" +
		"ping -n 12 127.0.0.1 >nul\r\n" +
		"for /L %%i in (1,1,8) do (\r\n" +
		"  sc query " + serviceName + " | findstr /i RUNNING >nul\r\n" +
		"  if errorlevel 1 (\r\n" +
		"    sc start " + serviceName + " >> \"" + logPath + "\" 2>&1\r\n" +
		"    ping -n 16 127.0.0.1 >nul\r\n" +
		"  ) else (\r\n" +
		"    goto :done\r\n" +
		"  )\r\n" +
		")\r\n" +
		":done\r\n" +
		"sc query " + serviceName + " >> \"" + logPath + "\" 2>&1\r\n"
	if err := os.WriteFile(cmdPath, []byte(body), 0644); err != nil {
		safeWarn(fmt.Sprintf("cloud self-update: write restart script failed: %v", err))
		return
	}
	const task = "ChunlvWatchdogRestart"
	_, _ = runHidden("schtasks", "/Delete", "/TN", task, "/F")
	if out, err := runHidden("schtasks", "/Create", "/TN", task, "/TR", cmdPath, "/SC", "ONCE", "/ST", "00:00", "/RU", "SYSTEM", "/RL", "HIGHEST", "/F"); err != nil {
		safeWarn(fmt.Sprintf("cloud self-update: create restart task failed: %v %s", err, out))
		return
	}
	if out, err := runHidden("schtasks", "/Run", "/TN", task); err != nil {
		safeWarn(fmt.Sprintf("cloud self-update: run restart task failed: %v %s", err, out))
		return
	}
	safeInfo("cloud self-update: restart task launched")
}

// cloudSelfUpdateCheck 由主循环每 5 秒叫一次，内部限流到 30 分钟一次。
func cloudSelfUpdateCheck() {
	if serviceBuildNumber == "" {
		return // 构建号标记坏了，别乱换自己
	}
	if _, err := os.Stat(cloudSkipFile); err == nil {
		return // 本机被人工关掉了自更新（排障用），别硬来
	}
	now := time.Now()
	if now.UnixNano()-atomic.LoadInt64(&lastCloudCheck) < int64(cloudCheckInterval) {
		return
	}
	// 正在给客户端装更新（或有一份更新还没验证完）：这时候重启服务会打断它，下一轮再说。
	if _, err := os.Stat(updateSignalFile); err == nil {
		return
	}
	if _, err := os.Stat(pendingUpdateFile); err == nil {
		return
	}
	atomic.StoreInt64(&lastCloudCheck, now.UnixNano())

	lm, size, err := cloudProbe(cloudWatchdogURL)
	if err != nil {
		safeWarn(fmt.Sprintf("cloud self-update: probe failed: %v", err))
		return
	}
	var stamp cloudStamp
	_ = readJSONFile(cloudStampFile, &stamp)
	conclusive := lm != "" || size > 0
	if conclusive {
		if lm != "" && lm == stamp.LastModified && size == stamp.Size {
			return // 云端那份没动过，不用再拉
		}
	} else if stamp.CheckedAt != "" {
		// 头信息取不出来（反代不吃 HEAD / Range）：那就最多 6 小时拉一次，别把带宽吃光。
		if ts, perr := time.Parse(time.RFC3339, stamp.CheckedAt); perr == nil && now.Sub(ts) < 6*time.Hour {
			return
		}
	}
	if err := downloadFileTo(cloudWatchdogURL, cloudExeFile, 3<<20); err != nil {
		safeWarn(fmt.Sprintf("cloud self-update: download failed: %v", err))
		return
	}
	stamp.LastModified, stamp.Size, stamp.CheckedAt = lm, size, now.Format(time.RFC3339)
	candBuild := readBuildNumber(cloudExeFile)
	if candBuild == "" || candBuild <= serviceBuildNumber {
		// 云端那份不比本机新（或者没带构建号）：记下来，省得反复下载。
		_ = writeJSONFile(cloudStampFile, stamp)
		return
	}
	if err := stageSelfReplace(cloudExeFile); err != nil {
		safeWarn(fmt.Sprintf("cloud self-update: swap failed: %v", err))
		_ = writeJSONFile(cloudStampFile, stamp)
		return
	}
	stamp.AppliedBuild = candBuild
	_ = writeJSONFile(cloudStampFile, stamp)
	safeInfo(fmt.Sprintf("cloud self-update: %s → %s 已就位，准备重启服务", serviceBuildNumber, candBuild))
	reportDiag("watchdog-selfupdate", serviceStateDiag(fmt.Sprintf("from=%s\nto=%s", serviceBuildNumber, candBuild)))
	scheduleSelfRestart(candBuild)
}

// readBuildNumber 在二进制里找 CHUNLV_WATCHDOG_BUILD=<数字> 标记，找不到返回空串。
func readBuildNumber(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return parseBuildNumber(data)
}

func parseBuildNumber(data []byte) string {
	idx := bytes.Index(data, []byte("CHUNLV_WATCHDOG_BUILD="))
	if idx < 0 {
		return ""
	}
	rest := data[idx+len("CHUNLV_WATCHDOG_BUILD="):]
	end := 0
	for end < len(rest) && rest[end] >= '0' && rest[end] <= '9' {
		end++
	}
	return string(rest[:end])
}

// ensureUpdateDir 创建更新信号目录并授予 Everyone 写权限，让普通权限的陪玩端也能写入。
func ensureUpdateDir() {
	if err := os.MkdirAll(updateSignalDir, 0755); err != nil {
		safeWarn(fmt.Sprintf("mkdir update dir failed: %v", err))
		return
	}
	_ = exec.Command("icacls", updateSignalDir, "/grant", "Everyone:(OI)(CI)F", "/T").Run()
}

// ── 更新安全网（2026-09-23）──────────────────────────────────────────────────
// 事故：2026-09-22 17:25 陈佳祺那台机器自动更新到 1.0.20260926 之后就再没起来，
// 陪玩那边看到的就是「双击桌面图标没反应」。
// 老流程把 zip 逐文件直接覆盖进正在用的安装目录，写失败只记一条 warn 还继续，
// 装到一半也算「更新成功」，然后把客户端拉起来 —— 一旦半新半旧，这台机器上就再也
// 没有能跑起来的客户端，而且服务端一条日志都没有，只能靠人去现场翻目录。
// 现在改成：解压到旁边的临时目录 → 校验 → 整个目录换过去（旧的留成备份）→
// 等客户端自己写「我起来了」（client-healthy.json）→ 等不到就整目录回滚、拉回旧版，
// 并把这个版本拉黑，免得客户端每 30 分钟又把自己更新坏一次。

type updateRequest struct {
	URL       string `json:"url"`
	LocalPath string `json:"localPath"`
	Version   string `json:"version"`
}

// pendingUpdate 记录这次换上了什么、旧目录备份在哪，回滚时要用。
type pendingUpdate struct {
	Version     string `json:"version"`
	DestDir     string `json:"destDir"`
	ExePath     string `json:"exePath"`
	BackupDir   string `json:"backupDir"`
	PreviousDir string `json:"previousDir"`
	ApplyAt     int64  `json:"applyAt"`  // unix ms
	Deadline    int64  `json:"deadline"` // unix ms
}

// clientHealth 是陪玩端启动成功后写的：版本、exe 路径、时刻（unix ms）。
type clientHealth struct {
	Version string `json:"version"`
	ExePath string `json:"exePath"`
	At      int64  `json:"at"`
}

var (
	pendingUpdateFile   = filepath.Join(updateSignalDir, "pending-update.json")
	healthyFile         = filepath.Join(updateSignalDir, "client-healthy.json")
	blockedFile         = filepath.Join(updateSignalDir, "blocked-versions.json")
	preferredClientFile = filepath.Join(updateSignalDir, "preferred-client.json")
)

// 更新后等客户端自报健康的时限（慢机器 + 杀毒扫描也够）。
const healthDeadline = 5 * time.Minute

func readJSONFile(p string, v any) bool {
	data, err := os.ReadFile(p)
	if err != nil {
		return false
	}
	return json.Unmarshal(data, v) == nil
}

func writeJSONFile(p string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0644)
}

// isVersionBlocked：这个版本在这台机器上试过、把客户端搞坏、已经回滚掉。
// 回滚之后客户端还是旧版，每 30 分钟又会来要更新，所以客户端和看门狗两头都认这份名单。
func isVersionBlocked(v string) bool {
	if v == "" {
		return false
	}
	m := map[string]string{}
	if !readJSONFile(blockedFile, &m) {
		return false
	}
	_, ok := m[v]
	return ok
}

func blockVersion(v, reason string) {
	if v == "" {
		return
	}
	m := map[string]string{}
	_ = readJSONFile(blockedFile, &m)
	m[v] = time.Now().Format("2006-01-02 15:04:05") + " " + reason
	_ = writeJSONFile(blockedFile, m)
	safeWarn(fmt.Sprintf("version %s blocked on this machine: %s", v, reason))
}

// pendingBackupBase 返回「正要回滚的那份备份」的目录名，清理旧备份时不能删到它。
func pendingBackupBase() string {
	var p pendingUpdate
	if readJSONFile(pendingUpdateFile, &p) && p.BackupDir != "" {
		return filepath.Base(p.BackupDir)
	}
	return ""
}

// cleanupStaleDirs 只留最近一份备份，顺手清掉解压到一半留下的 staging 目录。
func cleanupStaleDirs() {
	keep := pendingBackupBase()
	if p := findClient(); p != "" {
		dir := filepath.Dir(p)
		cleanupBackups(filepath.Dir(dir), dir, keep)
		cleanupSideBySide(dir)
	}
	for _, base := range []string{`C:\Program Files`, `C:\Program Files (x86)`} {
		entries, err := os.ReadDir(base)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !strings.HasPrefix(e.Name(), ".chunlv-new-") {
				continue
			}
			full := filepath.Join(base, e.Name())
			if fi, err := os.Stat(full); err == nil && time.Since(fi.ModTime()) > 2*time.Hour {
				safeInfo("removing stale staging dir " + full)
				_ = os.RemoveAll(full)
			}
		}
	}
}

func cleanupBackups(parent, destDir, keep string) {
	entries, err := os.ReadDir(parent)
	if err != nil {
		return
	}
	prefix := filepath.Base(destDir) + ".bak-"
	var stale []string
	for _, e := range entries {
		n := e.Name()
		if n == keep {
			continue
		}
		if strings.HasPrefix(n, prefix) || strings.HasPrefix(n, ".chunlv-broken-") {
			stale = append(stale, n)
		}
	}
	sort.Strings(stale)
	for _, n := range stale {
		safeInfo("removing old backup dir " + n)
		_ = os.RemoveAll(filepath.Join(parent, n))
	}
}

func downloadZipTo(url, dest string) error {
	safeInfo("Downloading update: " + url)
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download status %d", resp.StatusCode)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return err
	}
	tmp := dest + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	n, cerr := io.Copy(f, resp.Body)
	serr := f.Sync()
	f.Close()
	if cerr != nil {
		_ = os.Remove(tmp)
		return cerr
	}
	if serr != nil {
		_ = os.Remove(tmp)
		return serr
	}
	if resp.ContentLength > 0 && n != resp.ContentLength {
		_ = os.Remove(tmp)
		return fmt.Errorf("download truncated: got %d of %d bytes", n, resp.ContentLength)
	}
	if n < 10<<20 {
		_ = os.Remove(tmp)
		return fmt.Errorf("downloaded package too small: %d bytes", n)
	}
	return os.Rename(tmp, dest)
}

// resolveZip 给出一份「已经躺在本地、可以直接解压」的更新包。
func resolveZip(url, localPath string) (string, error) {
	if localPath != "" {
		if fi, err := os.Stat(localPath); err == nil && fi.Size() > 10<<20 {
			return localPath, nil
		}
		safeWarn(fmt.Sprintf("local package %s unusable — downloading instead", localPath))
	}
	dest := filepath.Join(updateSignalDir, "update-download.zip")
	if err := downloadZipTo(url, dest); err != nil {
		return "", err
	}
	return dest, nil
}

// localZipOrCloud 优先用本机已经下好的整包（省流量、断网也能自愈），没有就回云端拉。
func localZipOrCloud(pathOrDir string) string {
	p := filepath.Join(updateSignalDir, localUpdateZipName(pathOrDir))
	if fi, err := os.Stat(p); err == nil && fi.Size() > 10<<20 {
		return p
	}
	return cloudClientZipFor(pathOrDir)
}

// extractZipTo 把 zip 完整解压到 stagingDir。任何一步失败都直接报错：
// 每个文件都要写全（字节数对得上，CRC 由 zip 包自己校验），不允许多半个文件就往下走。
func extractZipTo(zipPath, stagingDir string) error {
	if err := os.RemoveAll(stagingDir); err != nil {
		return fmt.Errorf("clear staging dir: %w", err)
	}
	if err := os.MkdirAll(stagingDir, 0755); err != nil {
		return fmt.Errorf("create staging dir: %w", err)
	}
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("open zip: %w", err)
	}
	defer zr.Close()
	files := 0
	for _, zf := range zr.File {
		rel := zf.Name
		if strings.HasPrefix(rel, "win-unpacked/") {
			rel = strings.TrimPrefix(rel, "win-unpacked/")
		}
		if rel == "" || strings.HasSuffix(rel, "/") {
			continue
		}
		dst := filepath.Join(stagingDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			return fmt.Errorf("mkdir for %s: %w", rel, err)
		}
		rc, err := zf.Open()
		if err != nil {
			return fmt.Errorf("open %s in zip: %w", rel, err)
		}
		out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
		if err != nil {
			rc.Close()
			return fmt.Errorf("create %s: %w", rel, err)
		}
		n, cerr := io.Copy(out, rc) // 读到底会校验 zip CRC，坏包在这里就报错
		serr := out.Sync()
		out.Close()
		rc.Close()
		if cerr != nil {
			return fmt.Errorf("write %s: %w", rel, cerr)
		}
		if serr != nil {
			return fmt.Errorf("flush %s: %w", rel, serr)
		}
		if uint64(n) != zf.UncompressedSize64 {
			return fmt.Errorf("short write %s: got %d want %d", rel, n, zf.UncompressedSize64)
		}
		files++
	}
	if files < 10 {
		return fmt.Errorf("zip looks empty (%d files)", files)
	}
	return nil
}

// verifyStagingDir 确认解压出来的是「一份能跑的客户端」：入口 asar 在、客户端 exe 在。
func verifyStagingDir(dir string) (string, error) {
	asar := filepath.Join(dir, "resources", "app.asar")
	afi, aerr := os.Stat(asar)
	if aerr != nil {
		return "", fmt.Errorf("staged resources/app.asar missing")
	}
	for _, n := range clientExeNames {
		p := filepath.Join(dir, n)
		fi, err := os.Stat(p)
		if err != nil || fi.Size() <= 10<<20 {
			continue
		}
		// 陪玩端的 app.asar 里带着 socket.io，60 多 MB；客服端只有三个脚本，30 多 KB。
		// 所以阈值按客户端类型给 —— 一刀切 1MB 会把客服端的更新包判成坏包（永远更新不了）。
		minAsar := int64(1 << 20)
		if isCsClient(p) {
			minAsar = 8 << 10
		}
		if afi.Size() < minAsar {
			return "", fmt.Errorf("staged resources/app.asar too small (%d bytes)", afi.Size())
		}
		return p, nil
	}
	return "", fmt.Errorf("staged install has no client exe")
}

// applyUpdateAtomic 原子更新：解压到旁边的临时目录 → 校验 → 整个目录换过去。
// 任何一步失败，正在用的安装目录都保持原样 —— 这是「更新把客户端搞没」的根治点。
func applyUpdateAtomic(destDir, zipPath, version string) (string, error) {
	if destDir == "" {
		return "", fmt.Errorf("no install dir")
	}
	parent := filepath.Dir(destDir)
	staging := filepath.Join(parent, ".chunlv-new-"+time.Now().Format("20060102-150405"))
	if err := extractZipTo(zipPath, staging); err != nil {
		_ = os.RemoveAll(staging)
		return "", err
	}
	exe, err := verifyStagingDir(staging)
	if err != nil {
		_ = os.RemoveAll(staging)
		return "", err
	}
	backup := ""
	if _, err := os.Stat(destDir); err == nil {
		cleanupBackups(parent, destDir, pendingBackupBase())
		backup = destDir + ".bak-" + time.Now().Format("20060102-150405")
		// 改名前再确认一次「没有客户端还在占着这个目录」：抢单/重启客户端的时机是随机的，
		// 以前只在这里之前杀过一次进程，中间只要客户端又被拉起来，改名就一定被拒。
		killAllClientProcesses()
		waitNoClientProcess(10 * time.Second)
		if err := renameWithRetry(destDir, backup); err != nil {
			return installSideBySide(destDir, staging, zipPath, version, err)
		}
	}
	if err := os.Rename(staging, destDir); err != nil {
		if backup != "" {
			_ = os.Rename(backup, destDir) // 放回去，绝不给机器留一个空目录
		}
		_ = os.RemoveAll(staging)
		return "", fmt.Errorf("move new install into place: %w", err)
	}
	// exe 路径要按「换完之后」的目录重算：verifyStagingDir 返回的是临时目录里的路径，
	// 拿它写进 pending 会导致每次更新都判成「没等到健康标记」而白白回滚一次。
	exe = filepath.Join(destDir, filepath.Base(exe))
	// 旧标记先删掉：只有「这次更新之后」客户端新写的标记才算数。
	_ = os.Remove(healthyFile)
	_ = writeJSONFile(pendingUpdateFile, pendingUpdate{
		Version:   version,
		DestDir:   destDir,
		ExePath:   exe,
		BackupDir: backup,
		ApplyAt:   time.Now().UnixMilli(),
		Deadline:  time.Now().Add(healthDeadline).UnixMilli(),
	})
	clientPath = ""
	clientPID = 0
	atomic.StoreInt64(&launchPid, 0)
	return exe, nil
}

// renameWithRetry 改目录名前多退几步：杀毒软件/资源管理器/残留句柄经常晚半秒才松开，
// 一次失败就放弃的话，这台机器以后再也更新不了（而且日志里看不出原因）。
func renameWithRetry(from, to string) error {
	var err error
	for i := 0; i < 5; i++ {
		if err = os.Rename(from, to); err == nil {
			return nil
		}
		safeWarn(fmt.Sprintf("rename %s -> %s failed (%v), retry %d", from, to, err, i+1))
		time.Sleep(1200 * time.Millisecond)
	}
	return err
}

// ── 并排安装（2026-09-30）────────────────────────────────────────────────────
// 有些机器上「整个安装目录改名」是**永远**被拒的：报的是 Access is denied，而且被按住的是
// 目录本身 —— 同一个目录里的文件却读写自如（2026-09-24 修机时在 3 台机上实测过）。
// 这种机器上原来的原子更新会一直失败：客户端每半小时来要一次更新，看门狗每次都卡在
// 「把旧目录改名让位」，机器就永远停在老版本上 —— 2026-09-26 起 8 台陪玩机就是这么
// 卡住的（服务器上刷了 200 多条 update-failed，客户端版本全是 60930/60931）。
// 现在遇到这种目录不再硬碰硬：新版解到旁边的「陪玩管理-v<版本>」目录，写上
// preferred-client.json 指过去，旧目录一个字节都不动。以后更新就更新这一份新的
// （那是我们自己建的普通目录，不会再犯这个毛病）；真装坏了，把指针一删就回到旧目录。

type preferredClient struct {
	ExePath string `json:"exePath"`
	Dir     string `json:"dir"`
	Version string `json:"version"`
	At      int64  `json:"at"` // unix ms
}

// preferredClientExe 读「本机现在该跑哪一份客户端」。指向的那份已经不在了就作废。
func preferredClientExe() string {
	var p preferredClient
	if !readJSONFile(preferredClientFile, &p) || p.ExePath == "" {
		return ""
	}
	if _, err := os.Stat(p.ExePath); err != nil {
		safeWarn("preferred client is gone — falling back to the default install dir: " + p.ExePath)
		_ = os.Remove(preferredClientFile)
		return ""
	}
	return p.ExePath
}

// altInstallDir 算出并排安装用的目录名：和旧目录同一个父目录下的「<名字>-v<版本>」。
func altInstallDir(destDir, version string) string {
	parent := filepath.Dir(destDir)
	base := filepath.Base(destDir)
	if i := strings.LastIndex(base, "-v"); i > 0 && isVersionTag(base[i+2:]) {
		base = base[:i]
	}
	tag := version
	if !isVersionTag(tag) {
		tag = time.Now().Format("20060102150405")
	}
	return filepath.Join(parent, base+"-v"+tag)
}

func isVersionTag(s string) bool {
	if s == "" || len(s) > 40 {
		return false
	}
	for _, r := range s {
		ok := (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == '.' || r == '-'
		if !ok {
			return false
		}
	}
	return true
}

// installSideBySide 在旧目录旁边装一份新的，并把「以后跑哪一份」指过去。
// 旧目录保持原样（它多半根本动不了），所以这一步天然可回滚：删掉指针就回去了。
func installSideBySide(destDir, staging, zipPath, version string, cause error) (string, error) {
	alt := altInstallDir(destDir, version)
	safeWarn(fmt.Sprintf("cannot move install dir aside (%v) — installing side-by-side into %s", cause, alt))
	if err := os.RemoveAll(alt); err != nil {
		_ = os.RemoveAll(staging)
		return "", fmt.Errorf("move current install aside: %w (and cannot clear %s: %v)", cause, alt, err)
	}
	if err := os.Rename(staging, alt); err != nil {
		// 同一块盘上的改名也会被拒（少见）→ 老老实实再解一份到目标目录。
		safeWarn(fmt.Sprintf("side-by-side rename failed (%v) — extracting directly into %s", err, alt))
		if err2 := extractZipTo(zipPath, alt); err2 != nil {
			_ = os.RemoveAll(staging)
			return "", fmt.Errorf("move current install aside: %w (side-by-side install failed: %v)", cause, err2)
		}
		_ = os.RemoveAll(staging)
	}
	exe, err := verifyStagingDir(alt)
	if err != nil {
		return "", fmt.Errorf("move current install aside: %w (side-by-side verify failed: %v)", cause, err)
	}
	exe = filepath.Join(alt, filepath.Base(exe))
	_ = os.Remove(healthyFile)
	_ = writeJSONFile(preferredClientFile, preferredClient{
		ExePath: exe,
		Dir:     alt,
		Version: version,
		At:      time.Now().UnixMilli(),
	})
	_ = writeJSONFile(pendingUpdateFile, pendingUpdate{
		Version:     version,
		DestDir:     alt,
		ExePath:     exe,
		PreviousDir: destDir,
		ApplyAt:     time.Now().UnixMilli(),
		Deadline:    time.Now().Add(healthDeadline).UnixMilli(),
	})
	clientPath = ""
	clientPID = 0
	atomic.StoreInt64(&launchPid, 0)
	return exe, nil
}

// cleanupSideBySide 清掉同一族里已经不用了的「-v 目录」，别让版本目录越堆越多。
// 只删得动的；被占着删不掉的留着（下次再说），刚装的那份留着当回滚目标。
func cleanupSideBySide(dir string) {
	base := filepath.Base(dir)
	if i := strings.LastIndex(base, "-v"); i > 0 && isVersionTag(base[i+2:]) {
		base = base[:i]
	}
	prefix := base + "-v"
	parent := filepath.Dir(dir)
	entries, err := os.ReadDir(parent)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() || e.Name() == filepath.Base(dir) || !strings.HasPrefix(e.Name(), prefix) {
			continue
		}
		if !isVersionTag(strings.TrimPrefix(e.Name(), prefix)) {
			continue
		}
		full := filepath.Join(parent, e.Name())
		if fi, err := os.Stat(full); err == nil && time.Since(fi.ModTime()) < 24*time.Hour {
			continue
		}
		safeInfo("removing unused client copy " + full)
		_ = os.RemoveAll(full)
	}
}

// waitNoClientProcess 等到这台机器上一个客户端进程都不剩（最多等 d）。
// 客户端还在跑的时候改目录名一定被拒 —— 改名之前必须确认它真的退了。
func waitNoClientProcess(d time.Duration) {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if findAnyClientPID() == 0 {
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
	if pid := findAnyClientPID(); pid != 0 {
		safeWarn(fmt.Sprintf("client pid=%d is still running — the install dir may stay locked", pid))
	}
}

// healthMatches：客户端有没有在这次更新之后、以这个版本、从这个 exe 自报健康。
func healthMatches(p *pendingUpdate) bool {
	var h clientHealth
	if !readJSONFile(healthyFile, &h) {
		return false
	}
	if h.At < p.ApplyAt-10000 {
		return false
	}
	if p.Version != "" && h.Version != "" && !strings.EqualFold(h.Version, p.Version) {
		return false
	}
	if p.ExePath != "" && h.ExePath != "" && !strings.EqualFold(filepath.Clean(h.ExePath), filepath.Clean(p.ExePath)) {
		return false
	}
	return true
}

// rollbackUpdate 把安装目录整个换回更新前那一份，并拉黑这个版本。
func rollbackUpdate(p *pendingUpdate, why string) bool {
	safeWarn(fmt.Sprintf("update to %q looks broken (%s) — rolling back", p.Version, why))
	killAllClientProcesses()
	time.Sleep(1500 * time.Millisecond)
	restored := false
	if p.BackupDir != "" {
		if _, err := os.Stat(p.BackupDir); err != nil {
			safeWarn("rollback: backup dir is gone: " + p.BackupDir)
		} else {
			broken := filepath.Join(filepath.Dir(p.DestDir), ".chunlv-broken-"+time.Now().Format("20060102-150405"))
			if err := os.Rename(p.DestDir, broken); err != nil {
				safeErr(fmt.Sprintf("rollback: cannot move broken install aside: %v", err))
			} else if err := os.Rename(p.BackupDir, p.DestDir); err != nil {
				_ = os.Rename(broken, p.DestDir)
				safeErr(fmt.Sprintf("rollback: cannot restore backup: %v", err))
			} else {
				_ = os.RemoveAll(broken)
				restored = true
				safeInfo("rollback done — the previous client is back in place")
			}
		}
	} else if p.PreviousDir != "" {
		// 并排安装：旧目录从头到尾没被动过，把指针摘掉就等于回滚了。
		_ = os.Remove(preferredClientFile)
		if !strings.EqualFold(filepath.Clean(p.DestDir), filepath.Clean(p.PreviousDir)) {
			_ = os.RemoveAll(p.DestDir)
		}
		restored = true
		safeInfo("rollback done — back to the original install dir " + p.PreviousDir)
	}
	blockVersion(p.Version, why)
	_ = os.Remove(pendingUpdateFile)
	_ = os.Remove(healthyFile)
	clientPath = ""
	clientPID = 0
	atomic.StoreInt64(&launchPid, 0)
	reportDiag("rollback", serviceStateDiag(fmt.Sprintf("version=%s\nreason=%s\nrestored=%v", p.Version, why, restored)))
	return restored
}

// checkUpdateHealth 每轮跑一次：更新后等客户端自报健康，等不到就整目录回滚。
func checkUpdateHealth() {
	var probe clientHealth
	if readJSONFile(healthyFile, &probe) {
		if atomic.CompareAndSwapInt32(&healthTrusted, 0, 1) {
			safeInfo("client health marker seen — update rollback is armed on this machine")
		}
	}
	var p pendingUpdate
	if !readJSONFile(pendingUpdateFile, &p) {
		return
	}
	if p.DestDir == "" {
		_ = os.Remove(pendingUpdateFile)
		return
	}
	if healthMatches(&p) {
		safeInfo(fmt.Sprintf("update to %s verified healthy", p.Version))
		if p.BackupDir != "" {
			_ = os.RemoveAll(p.BackupDir)
		}
		_ = os.Remove(pendingUpdateFile)
		return
	}
	if time.Now().UnixMilli() < p.Deadline {
		return
	}
	if atomic.LoadInt32(&healthTrusted) == 0 {
		// 本机从来没见过客户端的健康标记（老版本客户端没有这个功能）→ 判断不了就别乱动，
		// 只把时限往后挪；等这台机器升到带标记的版本之后，才开始按它回滚。
		p.Deadline = time.Now().Add(healthDeadline).UnixMilli()
		_ = writeJSONFile(pendingUpdateFile, p)
		return
	}
	if !rollbackUpdate(&p, fmt.Sprintf("no health marker for %s within %s", p.Version, healthDeadline)) {
		repairClientInstall("update broken and there is no backup to roll back to", p.DestDir)
	}
	maybeLaunchClient()
}

// bumpCrash 统计「刚拉起就死」。短时间内反复死 → 这份安装是坏的，整包重装。
func bumpCrash() {
	now := time.Now().UnixMilli()
	if now-atomic.LoadInt64(&crashWindowStart) > 10*60*1000 {
		atomic.StoreInt32(&crashCount, 0)
		atomic.StoreInt64(&crashWindowStart, now)
	}
	n := atomic.AddInt32(&crashCount, 1)
	if n >= 3 {
		atomic.StoreInt32(&crashCount, 0)
		repairClientInstall(fmt.Sprintf("client died right after launch %d times", n), "")
	}
}

// checkLaunchOutcome 看「刚拉起那次」的结果：
// 进程很快就没了 → 算一次崩溃；活着却一直不自报健康（本机认这套标记时）→ 算僵尸，同样重装。
func checkLaunchOutcome() {
	pid := uint32(atomic.LoadInt64(&launchPid))
	if pid == 0 {
		return
	}
	if pid != clientPID {
		atomic.StoreInt64(&launchPid, 0)
		return
	}
	at := atomic.LoadInt64(&launchAtMs)
	elapsed := time.Since(time.UnixMilli(at))
	if !processExists(pid) {
		atomic.StoreInt64(&launchPid, 0)
		if elapsed >= 30*time.Second {
			return
		}
		// 开机时「服务的启动」和「客户端自己的登录项」会同时拉起客户端，
		// 抢不到单实例锁的那个进程立刻退出 —— 机器上还有活着的客户端就不算坏。
		if other := findAnyClientPID(); other != 0 && other != pid {
			safeInfo(fmt.Sprintf("launched pid=%d exited early but pid=%d is alive — not a crash", pid, other))
			return
		}
		safeWarn(fmt.Sprintf("client pid=%d died within 30s of launch", pid))
		bumpCrash()
		return
	}
	if atomic.LoadInt32(&healthTrusted) == 0 {
		atomic.StoreInt64(&launchPid, 0)
		return
	}
	var h clientHealth
	if readJSONFile(healthyFile, &h) && h.At >= at-5000 {
		atomic.StoreInt64(&launchPid, 0)
		atomic.StoreInt32(&zombieCount, 0)
		return
	}
	if elapsed > 3*time.Minute {
		atomic.StoreInt64(&launchPid, 0)
		n := atomic.AddInt32(&zombieCount, 1)
		safeWarn(fmt.Sprintf("client pid=%d alive but never reported healthy (%s) — count=%d", pid, elapsed.Round(time.Second), n))
		if n >= 2 {
			atomic.StoreInt32(&zombieCount, 0)
			repairClientInstall("client runs but never becomes healthy", "")
		}
	}
}

// ensureShortcut 给所有用户桌面（含公共桌面）摆正「陪玩管理」快捷方式。
// 客户端自己启动时也会重建一次，但它起不来的时候就没机会执行 ——
// 陪玩看到的就是「双击桌面图标没反应」。看门狗是系统权限，哪台机器都能修。
func ensureShortcut(exePath string, force bool) {
	if exePath == "" {
		return
	}
	now := time.Now().UnixNano()
	if !force && now-atomic.LoadInt64(&lastShortcutMs) < 60*1e9 {
		return
	}
	atomic.StoreInt64(&lastShortcutMs, now)
	exe := strings.ReplaceAll(exePath, "'", "''")
	// 快捷方式名字跟着 exe 名走：陪玩端是「陪玩管理」，客服电脑上是「客服管理」。
	// 以前写死「陪玩管理」，客服机上会被看门狗摆出一个打不开的陪玩管理图标。
	shortcutName := strings.TrimSuffix(filepath.Base(exePath), filepath.Ext(exePath))
	name := strings.ReplaceAll(shortcutName, "'", "''")
	script := "$ErrorActionPreference='SilentlyContinue';" +
		"$exe='" + exe + "';" +
		"$dir=Split-Path -Parent $exe;" +
		"$name='" + name + "';" +
		"$pub=$env:PUBLIC; if(-not $pub){ $pub=[Environment]::GetEnvironmentVariable('PUBLIC','Machine') }; if(-not $pub){ $pub='C:\\Users\\Public' };" +
		"$desktops=@((Join-Path $pub 'Desktop'));" +
		"Get-ChildItem 'C:\\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object { $d=Join-Path $_.FullName 'Desktop'; if(Test-Path -LiteralPath $d){ $desktops+=$d } };" +
		"$w=New-Object -ComObject WScript.Shell;" +
		"foreach($d in ($desktops | Select-Object -Unique)){" +
		" if(-not (Test-Path -LiteralPath $d)){ continue }" +
		" $lnk=Join-Path $d ($name+'.lnk');" +
		" $s=$w.CreateShortcut($lnk); $s.TargetPath=$exe; $s.WorkingDirectory=$dir; $s.IconLocation=($exe+',0'); $s.Description=$name; $s.Save();" +
		" Get-ChildItem -Path (Join-Path $d '*.lnk') -File -ErrorAction SilentlyContinue | ForEach-Object {" +
		"  if($_.Name -match $name){ return }" +
		"  if(-not ($_.Name -match '蠢驴|chunlv|客服|陪玩')){ return }" +
		"  $t=$w.CreateShortcut($_.FullName).TargetPath;" +
		"  if(-not $t -or -not (Test-Path -LiteralPath $t) -or ($t -ine $exe)){ Remove-Item -LiteralPath $_.FullName -Force }" +
		" }" +
		"}"
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	if out, err := cmd.CombinedOutput(); err != nil {
		safeWarn(fmt.Sprintf("shortcut repair failed: %v %s", err, strings.TrimSpace(string(out))))
	} else {
		safeInfo("desktop shortcut repaired -> " + exePath)
	}
}

func hostName() string {
	h, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return h
}

func fileSize(p string) int64 {
	if fi, err := os.Stat(p); err == nil {
		return fi.Size()
	}
	return -1
}

// isDirHoldingExe：命令行窗口 / 资源管理器这类「可能把某个目录当成当前目录按住」的进程。
// 目录改名被拒的现场，多看一眼这些进程就能对上是哪个窗口把目录按住了。
func isDirHoldingExe(name string) bool {
	for _, n := range []string{"cmd.exe", "powershell.exe", "pwsh.exe", "conhost.exe", "timeout.exe", "explorer.exe"} {
		if strings.EqualFold(name, n) {
			return true
		}
	}
	return false
}

// processSnapshot 列出会在更新时按住安装目录的常见进程（客户端本体 + 命令行窗口）。
func processSnapshot() string {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(snapshot)
	var b strings.Builder
	b.WriteString("[processes]\n")
	var pe windows.ProcessEntry32
	pe.Size = uint32(unsafe.Sizeof(pe))
	n := 0
	for perr := windows.Process32First(snapshot, &pe); perr == nil; perr = windows.Process32Next(snapshot, &pe) {
		name := windows.UTF16PtrToString(&pe.ExeFile[0])
		if !isClientExe(name) && !isDirHoldingExe(name) {
			continue
		}
		fmt.Fprintf(&b, "  %s pid=%d\n", name, pe.ProcessID)
		n++
		if n >= 40 {
			break
		}
	}
	return b.String()
}

// serviceStateDiag 拼一段「这台机器现在到底什么状态」，回传云端备查。
func serviceStateDiag(extra string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "host=%s\n", hostName())
	fmt.Fprintf(&b, "time=%s\n", time.Now().Format("2006-01-02 15:04:05"))
	fmt.Fprintf(&b, "watchdogBuild=%s (%s)\n", serviceBuild, serviceBuildNumber)
	fmt.Fprintf(&b, "healthTrusted=%v\n", atomic.LoadInt32(&healthTrusted) == 1)
	fmt.Fprintf(&b, "clientPath=%s\n", findClient())
	for _, d := range []string{`C:\Program Files\陪玩管理`, `C:\Program Files\@chunlvcompanion-electron`, `C:\Program Files\蠢驴电竞`, `C:\Program Files\客服管理`, `C:\Program Files\@chunlvcs-electron`} {
		if _, err := os.Stat(d); err != nil {
			continue
		}
		fmt.Fprintf(&b, "[dir] %s\n", d)
		entries, err := os.ReadDir(d)
		if err != nil {
			continue
		}
		for _, e := range entries {
			full := filepath.Join(d, e.Name())
			if e.IsDir() {
				fmt.Fprintf(&b, "  dir  %s\n", e.Name())
			} else {
				fmt.Fprintf(&b, "  file %s %d\n", e.Name(), fileSize(full))
			}
		}
	}
	for _, f := range []string{updateSignalFile, pendingUpdateFile, healthyFile, blockedFile} {
		if data, err := os.ReadFile(f); err == nil {
			fmt.Fprintf(&b, "[file] %s = %s\n", f, strings.TrimSpace(string(data)))
		}
	}
	if pc := preferredClientExe(); pc != "" {
		fmt.Fprintf(&b, "[file] %s = %s\n", preferredClientFile, pc)
	}
	b.WriteString(processSnapshot())
	if fi, err := os.Stat(filepath.Join(updateSignalDir, "update.zip")); err == nil {
		fmt.Fprintf(&b, "[file] update.zip = %d bytes\n", fi.Size())
	}
	if data, err := os.ReadFile(filepath.Join(logDir, "service.log")); err == nil {
		lines := strings.Split(strings.TrimRight(string(data), "\r\n"), "\n")
		if len(lines) > 40 {
			lines = lines[len(lines)-40:]
		}
		b.WriteString("[tail of service.log]\n")
		b.WriteString(strings.Join(lines, "\n"))
		b.WriteString("\n")
	}
	if extra != "" {
		b.WriteString("[extra]\n" + extra)
	}
	return b.String()
}

// reportDiag 把现场回传云端（最多 5 秒一次）。失败就算了，绝不因为它影响拉起客户端。
func reportDiag(source, text string) {
	now := time.Now().UnixNano()
	if now-atomic.LoadInt64(&lastDiagMs) < 5*1e9 {
		return
	}
	atomic.StoreInt64(&lastDiagMs, now)
	go func() {
		body, err := json.Marshal(map[string]string{
			"hostname": hostName(),
			"source":   source,
			"lines":    text,
		})
		if err != nil {
			return
		}
		req, err := http.NewRequest("POST", diagReportURL, bytes.NewReader(body))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-onboard-token", onboardToken)
		httpClient := &http.Client{Timeout: 30 * time.Second}
		resp, err := httpClient.Do(req)
		if err != nil {
			return
		}
		resp.Body.Close()
	}()
}

// repairClientInstall 兜底自愈：这份安装已经起不来了（exe 没了 / 刚拉起就死 /
// 一直不自报健康），就用本机留下的整包或云端整包重装一份。
// 走的还是原子换目录，不会再往坏目录上盖文件。
func repairClientInstall(why, preferDir string) string {
	now := time.Now().UnixNano()
	if now-atomic.LoadInt64(&repairLastTry) < 10*60*1e9 {
		return ""
	}
	atomic.StoreInt64(&repairLastTry, now)
	// 优先修「刚拉不起来的那个目录」：机器上可能同时存在好几分客户端目录
	// （蠢驴电竞 / @chunlvcompanion-electron / 陪玩管理），修错目录等于白折腾。
	dir := preferDir
	if dir == "" {
		if p := findClient(); p != "" {
			dir = filepath.Dir(p)
		} else {
			dir = findClientDir()
		}
	}
	if dir == "" {
		hint := preferDir
		if hint == "" {
			hint = clientPath
		}
		dir = defaultClientDir(hint)
	}
	// 先试本机留下的整包（省流量、断网也能自愈），不行再从云端重下一次。
	// 注意 localZipOrCloud 可能直接返回云端 URL —— 必须走 resolveZip 下载成文件，
	// 不能把 URL 当路径丢给解压（2026-09-23 实测报错：open zip: open http://...:
	// The filename, directory name, or volume label syntax is incorrect.，自愈等于没做）。
	cloudURL := cloudClientZipFor(dir)
	sources := []string{localZipOrCloud(dir)}
	if sources[0] != cloudURL {
		sources = append(sources, cloudURL)
	}
	for _, src := range sources {
		zip := src
		if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
			p, err := resolveZip(src, "")
			if err != nil {
				safeErr(fmt.Sprintf("repair download failed (%s): %v", src, err))
				continue
			}
			zip = p
		}
		safeWarn(fmt.Sprintf("repairing client install (%s): dir=%s source=%s", why, dir, zip))
		reportDiag("repair", serviceStateDiag(fmt.Sprintf("why=%s\ndir=%s\nsource=%s", why, dir, zip)))
		killAllClientProcesses()
		time.Sleep(1500 * time.Millisecond)
		exe, err := applyUpdateAtomic(dir, zip, "")
		if err != nil {
			safeErr(fmt.Sprintf("repair failed (%s): %v", zip, err))
			continue
		}
		ensureShortcut(exe, true)
		safeInfo("repair done — " + exe)
		return findClient()
	}
	return ""
}

// findClientDir 找「目录还在、客户端却起不来」的残局目录（有 resources\app.asar 的我们的目录）。
func findClientDir() string {
	for _, base := range []string{`C:\Program Files`, `C:\Program Files (x86)`} {
		entries, err := os.ReadDir(base)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() || isSkippableDir(e.Name()) || !isClientDirName(e.Name()) {
				continue
			}
			dir := filepath.Join(base, e.Name())
			if _, err := os.Stat(filepath.Join(dir, "resources", "app.asar")); err != nil {
				continue
			}
			return dir
		}
	}
	return ""
}

// checkForUpdate 轮询更新信号文件，若存在就原子安装并重启客户端。
func checkForUpdate(installDir string) {
	data, err := os.ReadFile(updateSignalFile)
	if err != nil {
		return
	}
	var req updateRequest
	if json.Unmarshal(data, &req) != nil || req.URL == "" {
		return
	}
	// 先把信号删掉：下面下载/解压要几分钟，期间别再被同一份信号触发第二遍。
	_ = os.Remove(updateSignalFile)
	if req.Version != "" && isVersionBlocked(req.Version) {
		safeWarn(fmt.Sprintf("ignoring update signal for blocked version %s", req.Version))
		reportDiag("update-blocked", serviceStateDiag(fmt.Sprintf("blockedVersion=%s", req.Version)))
		return
	}
	safeInfo(fmt.Sprintf("Update signal received (version=%s)", req.Version))
	killAllClientProcesses()
	time.Sleep(2 * time.Second)
	// 解压到客户端「当前实际安装目录」（installDir 来自 findClient 返回的 clientPath）。
	// 不要写死「陪玩管理」目录：老机器可能装在「蠢驴电竞 / @chunlvcompanion-electron」，
	// 写死会把新版装到另一个目录，老目录那份坏客户端照样被 findClient 拉起来。
	destDir := installDir
	if destDir == "" {
		destDir = defaultClientDir(clientPath)
	}
	zip, err := resolveZip(req.URL, req.LocalPath)
	if err != nil {
		safeErr(fmt.Sprintf("update download failed: %v — keeping the current install", err))
		reportDiag("update-failed", serviceStateDiag(fmt.Sprintf("version=%s\nerror=%v", req.Version, err)))
		clientPID = 0
		clientPath = ""
		maybeLaunchClient()
		return
	}
	exe, err := applyUpdateAtomic(destDir, zip, req.Version)
	if err != nil {
		// 安装目录还是更新前那一份，客户端照样拉得起来（顶多是旧版），机器不会变砖。
		safeErr(fmt.Sprintf("update failed: %v — keeping the current install", err))
		reportDiag("update-failed", serviceStateDiag(fmt.Sprintf("version=%s\nerror=%v", req.Version, err)))
		clientPID = 0
		clientPath = ""
		maybeLaunchClient()
		return
	}
	safeInfo(fmt.Sprintf("update to %s applied (%s)", req.Version, exe))
	selfUpdateIfNeeded(destDir)
	ensureShortcut(exe, true)
	maybeLaunchClient()
}

// isClientRunning checks if OUR launched PID is still alive. If we do not
// currently own a PID, it adopts any running client process so a manually
// started client is protected as well.
func isClientRunning() bool {
	if clientPID != 0 {
		h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, clientPID)
		if err != nil {
			// 句柄打不开 ≠ 进程没了：权限/瞬时错误（"The parameter is incorrect."）都会走到这里。
			// 拿进程快照再确认一次，只有真的查不到才算退出——否则会把活着的客户端当尸体，
			// 触发「杀掉正在跑的客户端再拉一个」（陪玩看到的就是闪退）。
			if processExists(clientPID) {
				safeWarn(fmt.Sprintf("PID %d still alive but OpenProcess failed: %v", clientPID, err))
				return true
			}
			safeWarn(fmt.Sprintf("PID %d gone: %v", clientPID, err))
			clientPID = 0
			return false
		}
		var exitCode uint32
		windows.GetExitCodeProcess(h, &exitCode)
		windows.CloseHandle(h)
		if exitCode != 259 { // STILL_ACTIVE
			safeWarn(fmt.Sprintf("PID %d exited code=%d", clientPID, exitCode))
			clientPID = 0
			return false
		}
		return true
	}

	if pid := findAnyClientPID(); pid != 0 {
		clientPID = pid
		safeInfo(fmt.Sprintf("Adopted running client pid=%d", pid))
		return true
	}
	return false
}

// processExists 用进程快照确认 PID 是否真的还在（OpenProcess 失败时的兜底判断）。
func processExists(pid uint32) bool {
	if pid == 0 {
		return false
	}
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return true // 拿不到快照时宁可当它还活着，别误杀
	}
	defer windows.CloseHandle(snapshot)

	var pe windows.ProcessEntry32
	pe.Size = uint32(unsafe.Sizeof(pe))
	err = windows.Process32First(snapshot, &pe)
	for err == nil {
		if pe.ProcessID == pid {
			return true
		}
		err = windows.Process32Next(snapshot, &pe)
	}
	return false
}

// findAnyClientPID returns the first running client process PID, or zero.
func findAnyClientPID() uint32 {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return 0
	}
	defer windows.CloseHandle(snapshot)

	var pe windows.ProcessEntry32
	pe.Size = uint32(unsafe.Sizeof(pe))

	var found uint32
	err = windows.Process32First(snapshot, &pe)
	for err == nil {
		name := windows.UTF16PtrToString(&pe.ExeFile[0])
		if isClientExe(name) {
			pid := pe.ProcessID
			if pid != 0 && pid != 4 && (found == 0 || pid < found) {
				found = uint32(pid)
			}
		}
		err = windows.Process32Next(snapshot, &pe)
	}
	return found
}

// setupExitEvent creates (or opens) the global named event that the client
// signals when an authorized exit was approved. It stays unsignaled until
// the client requests exit. The event DACL grants Everyone access so the
// non-elevated companion client can signal it from the user session.
func setupExitEvent() {
	sa := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{}))}
	if sd, err := windows.SecurityDescriptorFromString("D:(A;;GA;;;WD)"); err == nil {
		sa.SecurityDescriptor = sd
	} else {
		safeWarn(fmt.Sprintf("SecurityDescriptorFromString failed: %v", err))
	}
	h, _ := windows.CreateEvent(&sa, 1, 0, windows.StringToUTF16Ptr(exitEventName))
	if h != 0 {
		exitEvent = h
		return
	}
	safeWarn("CreateEvent for authorized exit failed")
}

// consumeExitRequest returns true when the client has just requested an
// authorized exit. The event is reset so a single request triggers once.
func consumeExitRequest() bool {
	if exitEvent == 0 {
		return false
	}
	rc, err := windows.WaitForSingleObject(exitEvent, 0)
	if err != nil || rc != windows.WAIT_OBJECT_0 {
		return false
	}
	windows.ResetEvent(exitEvent)
	atomic.StoreInt32(&suppressLaunch, 1)
	return true
}

func launchInUserSession(exePath string) (uint32, error) {
	sessionID, _, _ := procWTSGetActiveConsoleSessionId.Call()
	if sessionID == 0xFFFFFFFF {
		return 0, fmt.Errorf("no active console session")
	}

	var token windows.Token
	r1, _, _ := procWTSQueryUserToken.Call(sessionID, uintptr(unsafe.Pointer(&token)))
	if r1 == 0 {
		return 0, fmt.Errorf("WTSQueryUserToken failed")
	}
	defer token.Close()

	// Impersonate the user to get their real environment
	advapi32 := windows.NewLazySystemDLL("advapi32.dll")
	procImpersonateLoggedOnUser := advapi32.NewProc("ImpersonateLoggedOnUser")
	procRevertToSelf := advapi32.NewProc("RevertToSelf")
	procImpersonateLoggedOnUser.Call(uintptr(token))
	var envBlock *uint16
	windows.CreateEnvironmentBlock(&envBlock, token, false)
	procRevertToSelf.Call()

	dir := filepath.Dir(exePath)
	exePtr, _ := syscall.UTF16PtrFromString(exePath)
	dirPtr, _ := syscall.UTF16PtrFromString(dir)

	var si windows.StartupInfo
	si.Cb = uint32(unsafe.Sizeof(si))
	si.Desktop = windows.StringToUTF16Ptr(`winsta0\default`)
	si.ShowWindow = 1

	var pi windows.ProcessInformation

	flags := uint32(windows.NORMAL_PRIORITY_CLASS | windows.CREATE_UNICODE_ENVIRONMENT)

	err := windows.CreateProcessAsUser(
		token, exePtr, nil, nil, nil,
		false, flags,
		envBlock,
		dirPtr, &si, &pi,
	)

	if envBlock != nil {
		windows.DestroyEnvironmentBlock(envBlock)
	}

	if err != nil {
		return 0, err
	}

	pid := pi.ProcessId
	windows.CloseHandle(windows.Handle(pi.Process))
	windows.CloseHandle(windows.Handle(pi.Thread))
	return uint32(pid), nil
}

func launchClient() {
	if atomic.LoadInt32(&stopping) != 0 {
		return
	}

	now := time.Now().UnixNano()
	if now < atomic.LoadInt64(&launchBackoffUntil) {
		return
	}

	path := findClient()
	if path == "" {
		path = repairClientInstall("client exe not found", "")
	}
	if path == "" {
		safeWarn("Client exe not found")
		return
	}

	window := atomic.LoadInt64(&lastRestartWindow)
	if now-window > 10*60*1e9 {
		atomic.StoreInt32(&restartCount, 0)
		atomic.StoreInt64(&lastRestartWindow, now)
	}
	if atomic.AddInt32(&restartCount, 1) > 5 {
		atomic.StoreInt32(&restartCount, 0)
		atomic.StoreInt64(&lastRestartWindow, time.Now().UnixNano())
		safeWarn("Frequent relaunches detected — continuing without long backoff")
	}

	// Kill orphans from previous killed launches
	killAllClientProcesses()
	time.Sleep(1 * time.Second) // let file handles fully release
	if atomic.LoadInt32(&stopping) != 0 {
		return
	}

	safeInfo(fmt.Sprintf("Launching: %s", path))
	pid, err := launchInUserSession(path)
	if err != nil {
		safeWarn(fmt.Sprintf("CreateProcessAsUser failed: %v — fallback exec", err))
		killAllClientProcesses()
		time.Sleep(500 * time.Millisecond)
		cmd := exec.Command(path)
		cmd.Dir = filepath.Dir(path)
		if e := cmd.Start(); e != nil {
			safeWarn(fmt.Sprintf("exec fallback failed: %v", e))
		} else {
			clientPID = uint32(cmd.Process.Pid)
		}
	} else {
		clientPID = pid
		safeInfo(fmt.Sprintf("Client started pid=%d", pid))
	}
	if clientPID == 0 {
		// 连进程都创建不出来：这份安装里的客户端已经不是个能跑的程序了
		// （解压到一半的 exe、被删了一半的目录都会这样）。光重试没有意义 ——
		// 日志里刷的 "Client PID gone — relaunching" 就是这么来的，
		// 陪玩那边看到的是「双击图标没反应」。这里直接整包重装一份。
		safeWarn("cannot start the client at all — repairing this install")
		repairClientInstall("client cannot be started", filepath.Dir(path))
		return
	}
	// 记住这次拉起的 PID 和时刻：接下来靠「它有没有活着 + 有没有自报健康」判断
	// 这份安装是不是坏的（进程在、界面却是死的，陪玩看到的就是「双击没反应」）。
	atomic.StoreInt64(&launchPid, int64(clientPID))
	atomic.StoreInt64(&launchAtMs, time.Now().UnixMilli())
	ensureShortcut(path, false)
}

// maybeLaunchClient starts a launch in the background so the service control
// loop is never blocked by kill/launch operations or crash-loop backoff.
func maybeLaunchClient() {
	if atomic.LoadInt32(&stopping) != 0 {
		return
	}
	if !atomic.CompareAndSwapInt32(&launching, 0, 1) {
		return
	}

	go func() {
		defer atomic.StoreInt32(&launching, 0)
		if atomic.LoadInt32(&stopping) != 0 {
			return
		}
		launchClient()
	}()
}

type watchdogService struct{}

// ── 远程任务：以 SYSTEM 权限替客户端领任务并执行 ──────────────────────────────
//
// 为什么这件事交给看门狗，而不是客户端（老板 2026-10-01：「你看看还谁不是全自动的……
// 以后都弄全自动好么？」）：管理端下发的「一键诊断 / 远程指令 / 开通远程管理」都要管理员
// 权限，而客户端是以**登录用户**身份跑的 —— 2026-10-01 实拍：叶号那台（WIN-20260311RKT）
// 登录的 Windows 账号不是管理员，脚本第一行就报「是不是管理员: False」，任务白派。
// 看门狗是 SYSTEM 服务、开机就在跑，它来领任务就绕开了这个坑：没人登录、登录的是普通
// 账号，任务都照样能干。服务端也配合改成「看门狗来领过之后，客户端就领不到」。
const (
	machineReportURL = "http://1.117.229.36:3001/api/agent/machine-report"
	machineTasksURL  = "http://1.117.229.36:3001/api/agent/machine-tasks"
	machineResultURL = "http://1.117.229.36:3001/api/agent/machine-task-result"
	// 领任务的节奏：比客户端（60 秒）不慢，但开机先让自更新 / 拉起客户端忙完。
	remoteTickEvery = 60 * time.Second
	remoteFirstTick = 90 * time.Second
	// 一条任务最多让脚本跑多久（服务端下发的 timeoutSec 也在这个上限内）。
	remoteTaskMaxSec = 600
)

var (
	lastRemoteTick    int64
	remoteTaskBusy    int32
	cachedMachineID   string
	cachedMachineIDAt int64
)

// remoteTask 是服务端下发的任务（字段名跟 apps/server 的 buildTaskPayload 一一对应）。
type remoteTask struct {
	ID         string   `json:"id"`
	Type       string   `json:"type"`
	Mode       string   `json:"mode"`
	Script     string   `json:"script"`
	Args       []string `json:"args"`
	Command    string   `json:"command"`
	TimeoutSec int      `json:"timeoutSec"`
	Reason     string   `json:"reason"`
}

// isVirtualAdapter：跟客户端 machine-agent.js 用同一套判断，两边算出来的机器编号才一致。
func isVirtualAdapter(name string) bool {
	l := strings.ToLower(name)
	for _, k := range []string{"virtual", "vmware", "vmnet", "hyper-v", "loopback", "docker", "vethernet"} {
		if strings.Contains(l, k) {
			return true
		}
	}
	return false
}

// networkFingerprint：本机真实网卡的 IP 列表 / MAC / 主 IP（跳过虚拟网卡、回环、169.254）。
func networkFingerprint() ([]string, string, string) {
	ips := []string{}
	mac := ""
	primary := ""
	ifaces, err := net.Interfaces()
	if err != nil {
		return ips, mac, primary
	}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		if isVirtualAdapter(ifc.Name) {
			continue
		}
		addrs, aerr := ifc.Addrs()
		if aerr != nil {
			continue
		}
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			v4 := ipnet.IP.To4()
			if v4 == nil {
				continue
			}
			ip := v4.String()
			if ip == "127.0.0.1" || strings.HasPrefix(ip, "169.254.") {
				continue
			}
			ips = append(ips, ip)
			if mac == "" && len(ifc.HardwareAddr) >= 6 {
				mac = strings.ToUpper(strings.ReplaceAll(ifc.HardwareAddr.String(), ":", "-"))
			}
			if primary == "" && strings.HasPrefix(ip, "192.168.") {
				primary = ip
			}
		}
	}
	if primary == "" && len(ips) > 0 {
		primary = ips[0]
	}
	return ips, mac, primary
}

// localMachineID：计算机名 + 网卡 MAC（算法跟客户端一致）。这只是「报上去」用的一个初值，
// 真正的台账号以服务端认下来的为准（脚本行会被归并到客户端台账那一行）。
func localMachineID() string {
	keep := func(r rune, dash bool) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			return r
		}
		if dash && r == '-' {
			return r
		}
		return -1
	}
	base := strings.Map(func(r rune) rune { return keep(r, true) }, strings.ToLower(hostName()))
	_, mac, _ := networkFingerprint()
	macPart := strings.Map(func(r rune) rune { return keep(r, false) }, strings.ToLower(mac))
	if macPart != "" {
		return base + "-" + macPart
	}
	return base
}

// watchdogReportBody：看门狗上报自己时带的那份信息。
// 故意不带 appVersion —— 服务端对「脚本来源」的上报会保留客户端报的版本，
// 看门狗跟着混一个进去就会把客户端版本号写坏。
func watchdogReportBody() map[string]any {
	ips, mac, primary := networkFingerprint()
	kind := readClientKind()
	clientType := "COMPANION"
	if kind == clientKindCs {
		clientType = "CS"
	}
	return map[string]any{
		"machineId":     localMachineID(),
		"clientType":    clientType,
		"hostname":      hostName(),
		"ips":           ips,
		"primaryIp":     primary,
		"mac":           mac,
		"os":            strings.TrimSpace(os.Getenv("OS")),
		"watchdogBuild": serviceBuildNumber,
		"systemPoller":  true,
		"source":        "watchdog",
	}
}

func postJSON(url string, payload any) (map[string]any, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-onboard-token", onboardToken)
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func serverBaseURL() string {
	return strings.TrimSuffix(machineReportURL, "/api/agent/machine-report")
}

// machineIDForServer：上报自己、拿回服务端认下来的台账号。
//
// 每次领任务前都报一次（60 秒一次，跟客户端一个节奏）：这次上报同时就是「看门狗还活着」
// 的凭证 —— 服务端靠它把管理端下发的任务从「客户端（登录用户权限）」转给「看门狗（SYSTEM）」
// 执行（见 machine.service.ts 的 systemPollerAlive）。
func machineIDForServer() string {
	now := time.Now().UnixNano()
	out, err := postJSON(machineReportURL, watchdogReportBody())
	if err != nil {
		safeWarn("看门狗上报失败: " + err.Error())
		// 服务端偶尔连不上（重启 / 断网）时，用半小时内认下来的台账号继续领任务。
		if cachedMachineID != "" && now-cachedMachineIDAt < int64(30*time.Minute) {
			return cachedMachineID
		}
		return ""
	}
	id := ""
	if data, ok := out["data"].(map[string]any); ok {
		id, _ = data["machineId"].(string)
	}
	if id == "" {
		return ""
	}
	cachedMachineID = id
	cachedMachineIDAt = now
	return id
}

func fetchRemoteTasks(machineID string) []remoteTask {
	req, err := http.NewRequest("GET", machineTasksURL+"?machineId="+machineID+"&limit=3&as=system", nil)
	if err != nil {
		return nil
	}
	req.Header.Set("x-onboard-token", onboardToken)
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	var out struct {
		Data struct {
			Tasks []remoteTask `json:"tasks"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil
	}
	return out.Data.Tasks
}

// runHiddenTimeout：跟 runHidden 一样不弹窗，但带超时 —— 诊断脚本卡住时不能把看门狗一起拖住。
func runHiddenTimeout(timeout time.Duration, args ...string) (string, int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell.exe", args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	code := 0
	if cmd.ProcessState != nil {
		code = cmd.ProcessState.ExitCode()
	}
	text := strings.TrimSpace(string(out))
	if ctx.Err() == context.DeadlineExceeded {
		return text, code, fmt.Errorf("执行超时（%s）已被中断", timeout)
	}
	return text, code, err
}

func trimBOM(s string) string {
	return strings.TrimPrefix(s, "\uFEFF")
}

// runRemoteTask：跑一条任务，把输出回传服务端。跟客户端 machine-agent 的行为一致。
func runRemoteTask(machineID string, t remoteTask) {
	started := time.Now()
	timeout := time.Duration(t.TimeoutSec) * time.Second
	if timeout <= 0 || timeout > remoteTaskMaxSec*time.Second {
		timeout = 240 * time.Second
	}
	lines := ""
	code := 0
	var err error

	if t.Mode == "command" {
		lines, code, err = runHiddenTimeout(timeout, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", t.Command)
	} else {
		dir := filepath.Join(updateSignalDir, "tasks")
		if mkErr := os.MkdirAll(dir, 0755); mkErr != nil {
			safeWarn("远程任务目录建不起来: " + mkErr.Error())
			return
		}
		tag := t.ID
		if len(tag) > 8 {
			tag = tag[:8]
		}
		scriptFile := filepath.Join(dir, "task-"+tag+".ps1")
		outFile := filepath.Join(dir, "task-"+tag+".log")
		_ = os.Remove(outFile)
		// PS 5.1 不认没 BOM 的 UTF-8，中文会变乱码 —— 服务端那段脚本里全是中文。
		payload := append([]byte{0xEF, 0xBB, 0xBF}, []byte(t.Script)...)
		if wErr := os.WriteFile(scriptFile, payload, 0644); wErr != nil {
			safeWarn("远程任务脚本写不下去: " + wErr.Error())
			return
		}
		args := []string{"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptFile}
		for _, a := range t.Args {
			a = strings.ReplaceAll(a, "__OUT__", outFile)
			a = strings.ReplaceAll(a, "__SERVER__", serverBaseURL())
			args = append(args, a)
		}
		stdout, runCode, runErr := runHiddenTimeout(timeout, args...)
		code, err = runCode, runErr
		if data, rErr := os.ReadFile(outFile); rErr == nil {
			lines = trimBOM(string(data))
		}
		if strings.TrimSpace(lines) == "" {
			lines = "[看门狗] 脚本没有生成报告文件，退回命令输出：\n" + stdout
		}
	}

	status := "ok"
	errText := ""
	if err != nil || code != 0 {
		status = "failed"
		if err != nil {
			errText = err.Error()
		} else {
			errText = fmt.Sprintf("exit=%d", code)
		}
	}
	if len(lines) > 380000 {
		lines = lines[:380000]
	}
	if _, perr := postJSON(machineResultURL, map[string]any{
		"taskId":    t.ID,
		"machineId": machineID,
		"hostname":  hostName(),
		"status":    status,
		"exitCode":  code,
		"lines":     lines,
		"error":     errText,
		"tookMs":    time.Since(started).Milliseconds(),
	}); perr != nil {
		safeWarn("远程任务回执失败: " + perr.Error())
	}
	safeInfo(fmt.Sprintf("远程任务执行完 %s [%s] exit=%d", t.Type, status, code))
}

// remoteTaskTick：5 秒一轮的主循环叫它，内部限流到 60 秒一次，且同一时刻只跑一轮。
func remoteTaskTick() {
	now := time.Now().UnixNano()
	if now-atomic.LoadInt64(&lastRemoteTick) < int64(remoteTickEvery) {
		return
	}
	atomic.StoreInt64(&lastRemoteTick, now)
	if !atomic.CompareAndSwapInt32(&remoteTaskBusy, 0, 1) {
		return
	}
	go func() {
		defer atomic.StoreInt32(&remoteTaskBusy, 0)
		id := machineIDForServer()
		if id == "" {
			return
		}
		for _, t := range fetchRemoteTasks(id) {
			safeInfo("以系统权限领到远程任务 " + t.Type + " " + t.ID)
			runRemoteTask(id, t)
		}
	}()
}

func (s *watchdogService) Execute(args []string, r <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	const cmdsAccepted = svc.AcceptStop | svc.AcceptShutdown
	atomic.StoreInt32(&stopping, 0)

	status <- svc.Status{State: svc.StartPending}
	safeInfo(fmt.Sprintf("SystemHelper service starting (build %s / %s)", serviceBuild, serviceBuildNumber))
	if parseBuildNumber([]byte(buildTagLiteral)) != serviceBuildNumber {
		safeWarn("build marker mismatch — self-update disabled until fixed")
	}

	if p := findClient(); p != "" {
		safeInfo(fmt.Sprintf("Client found at %s", p))
		selfUpdateIfNeeded(filepath.Dir(p))
	} else {
		safeWarn("Client not found")
	}

	status <- svc.Status{State: svc.Running, Accepts: cmdsAccepted}
	setupExitEvent()
	ensureUpdateDir()
	cleanupStaleDirs()
	cleanupSelfUpdateLeftovers()
	reportDiag("service-start", serviceStateDiag(""))

	// On startup: if client is missing, launch it
	if !isClientRunning() {
		maybeLaunchClient()
	}

	// 第一次问云端：开机三分钟后再来，别跟开机那一阵抢。
	atomic.StoreInt64(&lastCloudCheck, time.Now().Add(-cloudCheckInterval+cloudFirstCheckDelay).UnixNano())
	// 第一次领远程任务：开机 90 秒后再来（同样别跟开机那一阵、跟自更新抢）。
	atomic.StoreInt64(&lastRemoteTick, time.Now().Add(-remoteTickEvery+remoteFirstTick).UnixNano())

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if atomic.LoadInt32(&stopping) != 0 {
				continue
			}
			if consumeExitRequest() {
				safeInfo("Authorized exit requested — suppressing auto-relaunch until reboot")
				continue
			}
			if atomic.LoadInt32(&suppressLaunch) != 0 {
				// A different client PID means the user manually started the app again.
				if pid := findAnyClientPID(); pid != 0 && pid != clientPID {
					clientPID = pid
					atomic.StoreInt32(&suppressLaunch, 0)
					safeInfo(fmt.Sprintf("Manual client start detected pid=%d — resuming watchdog", pid))
				}
				continue
			}
			if p := findClient(); p != "" {
				checkForUpdate(filepath.Dir(p))
			}
			checkUpdateHealth()
			checkLaunchOutcome()
			cloudSelfUpdateCheck()
			// 管理端下发的远程任务：以 SYSTEM 权限跑（客户端登录的是普通账号也能干）。
			remoteTaskTick()
			if !isClientRunning() {
				// 「我这个 PID 没了」不等于「机器上没有客户端」。
				// 开机时服务的启动和客户端自己的登录项会同时拉起客户端，抢不到单实例锁的那个进程
				// 会立刻退出（exit code 0 / PID 查不到）；老逻辑这时直接 kill + 重启，
				// 把「正常运行的那个客户端」一起杀掉，陪玩看到的就是「客户端突然闪退」。
				// 现在先看机器上还有没有活着的客户端：有就接管它，没有才拉起。
				if pid := findAnyClientPID(); pid != 0 {
					clientPID = pid
					safeInfo(fmt.Sprintf("Tracked PID gone but a live client exists pid=%d — adopting it instead of relaunching", pid))
				} else {
					safeWarn("Client PID gone — relaunching")
					maybeLaunchClient()
				}
			}

		case c := <-r:
			switch c.Cmd {
			case svc.Interrogate:
				status <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				atomic.StoreInt32(&stopping, 1)
				safeInfo("Service stopping")
				status <- svc.Status{State: svc.StopPending}
				return false, 0
			default:
			}
		}
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, "Usage: %s [install|remove|run]\n", os.Args[0])
	os.Exit(2)
}

func main() {
	if len(os.Args) >= 2 {
		switch strings.ToLower(os.Args[1]) {
		case "install":
			if err := installService(); err != nil {
				log.Fatalf("Install failed: %v", err)
			}
			fmt.Println("SystemHelper service installed successfully.")
			return
		case "remove":
			if err := removeService(); err != nil {
				log.Fatalf("Remove failed: %v", err)
			}
			fmt.Println("SystemHelper service removed successfully.")
			return
		case "run":
			runForeground()
			return
		default:
			usage()
		}
	}

	var err error
	elog, err = eventlog.Open(serviceName)
	if err != nil {
		log.Printf("Warning: eventlog unavailable: %v", err)
	}

	safeInfo(fmt.Sprintf("%s service starting", serviceName))

	err = svc.Run(serviceName, &watchdogService{})
	if err != nil {
		safeErr(fmt.Sprintf("Service failed: %v", err))
		return
	}

	safeInfo("Service stopped")
}

func installService() error {
	// 先记下「这台电脑的看门狗该守谁」：陪玩端 install --client=companion，
	// 客服端 install --client=cs。不认参数时保持老行为（守陪玩端）。
	writeClientKindFromArgs()
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("cannot get exe path: %w", err)
	}

	mgr, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_ALL_ACCESS)
	if err != nil {
		return fmt.Errorf("OpenSCManager failed (need admin): %w", err)
	}
	defer windows.CloseServiceHandle(mgr)

	svcHandle, err := windows.CreateService(
		mgr,
		windows.StringToUTF16Ptr(serviceName),
		windows.StringToUTF16Ptr("System Helper Service"),
		windows.SERVICE_ALL_ACCESS,
		windows.SERVICE_WIN32_OWN_PROCESS,
		windows.SERVICE_AUTO_START,
		windows.SERVICE_ERROR_NORMAL,
		windows.StringToUTF16Ptr(exePath),
		nil, nil, nil, nil, nil,
	)
	if err != nil {
		return fmt.Errorf("CreateService failed: %w", err)
	}
	defer windows.CloseServiceHandle(svcHandle)

	actions := []windows.SC_ACTION{
		{Type: windows.SC_ACTION_RESTART, Delay: 30000},
		{Type: windows.SC_ACTION_RESTART, Delay: 60000},
		{Type: windows.SC_ACTION_NONE, Delay: 0},
	}
	windows.ChangeServiceConfig2(svcHandle, windows.SERVICE_CONFIG_FAILURE_ACTIONS, (*byte)(unsafe.Pointer(&windows.SERVICE_FAILURE_ACTIONS{
		ResetPeriod:  86400,
		RebootMsg:    nil,
		Command:      nil,
		ActionsCount: uint32(len(actions)),
		Actions:      &actions[0],
	})))
	return nil
}

func removeService() error {
	mgr, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_ALL_ACCESS)
	if err != nil {
		return fmt.Errorf("OpenSCManager failed (need admin): %w", err)
	}
	defer windows.CloseServiceHandle(mgr)

	svcHandle, err := windows.OpenService(mgr, windows.StringToUTF16Ptr(serviceName), windows.SERVICE_ALL_ACCESS)
	if err != nil {
		return fmt.Errorf("Service not found: %w", err)
	}
	defer windows.CloseServiceHandle(svcHandle)

	var status windows.SERVICE_STATUS
	windows.ControlService(svcHandle, windows.SERVICE_CONTROL_STOP, &status)
	time.Sleep(2 * time.Second)

	return windows.DeleteService(svcHandle)
}

func runForeground() {
	log.SetOutput(os.Stdout)
	log.Println("SystemHelper watchdog foreground mode")
	setupExitEvent()
	ensureUpdateDir()
	cleanupStaleDirs()
	reportDiag("service-start-fg", serviceStateDiag(""))

	if p := findClient(); p != "" {
		log.Printf("Client found at: %s", p)
	}

	if !isClientRunning() {
		log.Println("Launching client...")
		maybeLaunchClient()
	}

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		if consumeExitRequest() {
			log.Println("Authorized exit requested — suppressing auto-relaunch until reboot")
			continue
		}
		if atomic.LoadInt32(&suppressLaunch) != 0 {
			if pid := findAnyClientPID(); pid != 0 && pid != clientPID {
				clientPID = pid
				atomic.StoreInt32(&suppressLaunch, 0)
				log.Printf("Manual client start detected pid=%d — resuming watchdog", pid)
			}
			continue
		}
		if p := findClient(); p != "" {
			checkForUpdate(filepath.Dir(p))
		}
		checkUpdateHealth()
		checkLaunchOutcome()
		if !isClientRunning() {
			log.Println("Client gone — relaunching...")
			maybeLaunchClient()
		}
	}
}
