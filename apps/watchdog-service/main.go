package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log"
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
const serviceBuild = "2026-09-23.3"

// 自更新用的构建号：这两个字符串会被原样编进二进制里，
// 运行中的服务直接读「旁边那份 SystemHelper.exe」的字节，看它的构建号是不是比自己大——
// 比解析 PE 版本资源简单，也不会因为客户端包里带的还是老版本而把自己降级回有 bug 的旧版。
const serviceBuildNumber = "2026092303"

var buildTagLiteral = "CHUNLV_WATCHDOG_BUILD=2026092303" // 必须与 serviceBuildNumber 一致

var searchPaths = []string{
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

var clientExeNames = []string{"陪玩管理.exe", "蠢驴电竞.exe"}

func isClientExe(name string) bool {
	for _, n := range clientExeNames {
		if strings.EqualFold(name, n) {
			return true
		}
	}
	return false
}

// isClientDirName 判断某个安装目录是不是「我们的」客户端目录。
// 只认名字里带 蠢驴 / 陪玩 / chunlv 的目录，避免把客户端解压到别的软件目录里。
func isClientDirName(name string) bool {
	lower := strings.ToLower(name)
	for _, kw := range []string{"蠢驴", "陪玩", "chunlv"} {
		if strings.Contains(lower, strings.ToLower(kw)) {
			return true
		}
	}
	return false
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

// 客户端 exe 被弄丢、而本机又没留下更新包时（新装的机器、从没更新过的机器），
// 直接从云服务器取一份完整客户端包来补齐。以前这种情况直接放弃，
// 结果就是那台电脑再也拉不起客户端 —— 用户看到的是「客户端打不开、进不去系统」。
var cloudClientZipURL = "http://1.117.229.36:3001/api/agent/download/latest"

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
	if clientPath != "" {
		if _, err := os.Stat(clientPath); err == nil {
			return clientPath
		}
		clientPath = ""
	}
	for _, p := range searchPaths {
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
		for _, e := range entries {
			if !e.IsDir() || isSkippableDir(e.Name()) || !isClientDirName(e.Name()) {
				continue
			}
			for _, exe := range []string{"陪玩管理.exe", "蠢驴电竞.exe"} {
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
	Version   string `json:"version"`
	DestDir   string `json:"destDir"`
	ExePath   string `json:"exePath"`
	BackupDir string `json:"backupDir"`
	ApplyAt   int64  `json:"applyAt"`  // unix ms
	Deadline  int64  `json:"deadline"` // unix ms
}

// clientHealth 是陪玩端启动成功后写的：版本、exe 路径、时刻（unix ms）。
type clientHealth struct {
	Version string `json:"version"`
	ExePath string `json:"exePath"`
	At      int64  `json:"at"`
}

var (
	pendingUpdateFile = filepath.Join(updateSignalDir, "pending-update.json")
	healthyFile       = filepath.Join(updateSignalDir, "client-healthy.json")
	blockedFile       = filepath.Join(updateSignalDir, "blocked-versions.json")
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
func localZipOrCloud() string {
	p := filepath.Join(updateSignalDir, "update.zip")
	if fi, err := os.Stat(p); err == nil && fi.Size() > 10<<20 {
		return p
	}
	return cloudClientZipURL
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
	if fi, err := os.Stat(asar); err != nil || fi.Size() < 1<<20 {
		return "", fmt.Errorf("staged resources/app.asar missing or too small")
	}
	for _, n := range clientExeNames {
		p := filepath.Join(dir, n)
		if fi, err := os.Stat(p); err == nil && fi.Size() > 10<<20 {
			return p, nil
		}
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
		if err := renameWithRetry(destDir, backup); err != nil {
			_ = os.RemoveAll(staging)
			return "", fmt.Errorf("move current install aside: %w", err)
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
	script := "$ErrorActionPreference='SilentlyContinue';" +
		"$exe='" + exe + "';" +
		"$dir=Split-Path -Parent $exe;" +
		"$name='陪玩管理';" +
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
		"  if(-not ($_.Name -match '蠢驴|chunlv')){ return }" +
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

// serviceStateDiag 拼一段「这台机器现在到底什么状态」，回传云端备查。
func serviceStateDiag(extra string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "host=%s\n", hostName())
	fmt.Fprintf(&b, "time=%s\n", time.Now().Format("2006-01-02 15:04:05"))
	fmt.Fprintf(&b, "watchdogBuild=%s (%s)\n", serviceBuild, serviceBuildNumber)
	fmt.Fprintf(&b, "healthTrusted=%v\n", atomic.LoadInt32(&healthTrusted) == 1)
	fmt.Fprintf(&b, "clientPath=%s\n", findClient())
	for _, d := range []string{`C:\Program Files\陪玩管理`, `C:\Program Files\@chunlvcompanion-electron`, `C:\Program Files\蠢驴电竞`} {
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
		dir = `C:\Program Files\陪玩管理`
	}
	// 先试本机留下的整包（省流量、断网也能自愈），不行再从云端重下一次。
	// 注意 localZipOrCloud 可能直接返回云端 URL —— 必须走 resolveZip 下载成文件，
	// 不能把 URL 当路径丢给解压（2026-09-23 实测报错：open zip: open http://...:
	// The filename, directory name, or volume label syntax is incorrect.，自愈等于没做）。
	sources := []string{localZipOrCloud()}
	if sources[0] != cloudClientZipURL {
		sources = append(sources, cloudClientZipURL)
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
		destDir = `C:\Program Files\陪玩管理`
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
	reportDiag("service-start", serviceStateDiag(""))

	// On startup: if client is missing, launch it
	if !isClientRunning() {
		maybeLaunchClient()
	}

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
