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
const serviceBuild = "2026-09-20.5"

// 自更新用的构建号：这两个字符串会被原样编进二进制里，
// 运行中的服务直接读「旁边那份 SystemHelper.exe」的字节，看它的构建号是不是比自己大——
// 比解析 PE 版本资源简单，也不会因为客户端包里带的还是老版本而把自己降级回有 bug 的旧版。
const serviceBuildNumber = "2026092005"

var buildTagLiteral = "CHUNLV_WATCHDOG_BUILD=2026092005" // 必须与 serviceBuildNumber 一致

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
			if !e.IsDir() || !isClientDirName(e.Name()) {
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

type updateRequest struct {
	URL       string `json:"url"`
	LocalPath string `json:"localPath"`
}

// downloadAndExtract 下载（或使用本地已下载文件）zip 并解压覆盖到目标目录（去掉 win-unpacked 顶层前缀）。
// 返回包内顶层 exe 的文件名：调用方要靠它确认「新客户端真的落到磁盘上了」，
// 再决定要不要删旧的那个 exe —— 删错一次，这台机器就再也没有客户端可拉起。
func downloadAndExtract(url, localPath, destDir string) ([]string, error) {
	tmp := ""
	if localPath != "" {
		tmp = localPath
	} else {
		safeInfo(fmt.Sprintf("Downloading update: %s", url))
		resp, err := http.Get(url)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("download status %d", resp.StatusCode)
		}
		tmp = filepath.Join(os.TempDir(), "chunlv-update.zip")
		f, err := os.Create(tmp)
		if err != nil {
			return nil, err
		}
		if _, err = io.Copy(f, resp.Body); err != nil {
			f.Close()
			return nil, err
		}
		f.Close()
		defer os.Remove(tmp)
	}

	zr, err := zip.OpenReader(tmp)
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	var exeNames []string
	failed := 0
	for _, zf := range zr.File {
		rel := zf.Name
		if strings.HasPrefix(rel, "win-unpacked/") {
			rel = strings.TrimPrefix(rel, "win-unpacked/")
		}
		if rel == "" {
			continue
		}
		if !zf.FileInfo().IsDir() && !strings.ContainsAny(rel, `\/`) && strings.EqualFold(filepath.Ext(rel), ".exe") {
			exeNames = append(exeNames, filepath.Base(rel))
		}
		dst := filepath.Join(destDir, rel)
		if zf.FileInfo().IsDir() {
			_ = os.MkdirAll(dst, 0755)
			continue
		}
		_ = os.MkdirAll(filepath.Dir(dst), 0755)
		out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
		if err != nil {
			failed++
			safeWarn(fmt.Sprintf("update: cannot write %s: %v", dst, err))
			continue
		}
		rc, err := zf.Open()
		if err != nil {
			out.Close()
			failed++
			continue
		}
		if _, err := io.Copy(out, rc); err != nil {
			failed++
			safeWarn(fmt.Sprintf("update: write failed %s: %v", dst, err))
		}
		out.Close()
		rc.Close()
	}
	if failed > 0 {
		safeWarn(fmt.Sprintf("update: %d file(s) could not be written", failed))
	}
	return exeNames, nil
}

// checkForUpdate 轮询更新信号文件，若存在则下载解压并重启客户端。
func checkForUpdate(installDir string) {
	data, err := os.ReadFile(updateSignalFile)
	if err != nil {
		return
	}
	var req updateRequest
	if json.Unmarshal(data, &req) != nil || req.URL == "" {
		return
	}
	safeInfo("Update signal received")
	killAllClientProcesses()
	time.Sleep(2 * time.Second)
	// 解压到客户端「当前实际安装目录」（installDir 来自 findClient 返回的 clientPath），
	// 不要写死「陪玩管理」目录：老版本可能还叫「蠢驴电竞」装在别的目录，写死会导致更新解压到
	// 错误目录，重启后还是旧版、看门狗看起来像「没拉起」。
	destDir := installDir
	if destDir == "" {
		destDir = `C:\Program Files\陪玩管理`
	}
	_ = os.MkdirAll(destDir, 0755)
	exeNames, err := downloadAndExtract(req.URL, req.LocalPath, destDir)
	if err != nil {
		safeWarn(fmt.Sprintf("update failed: %v", err))
		// 下载/解压失败时也要清掉信号文件，否则每 5 秒都会重新下载一遍，
		// 造成全机反复下载大安装包、卡顿、并不断杀死/重启客户端。
		_ = os.Remove(updateSignalFile)
		clientPID = 0
		clientPath = ""
		maybeLaunchClient()
		return
	}
	// 删旧 exe 必须满足两个条件：① 新包里的客户端 exe 真的已经躺在盘上；
	// ② 它和旧路径不是同一个文件（也就是「改名」这种情况，例如老机器上还留着「蠢驴电竞.exe」）。
	// 之前是无条件 os.Remove(clientPath)：同名升级时旧路径 == 新 exe，等于把刚更新出来的客户端删掉，
	// 机器上再也没有客户端可拉起，日志里只剩 "Client exe not found"，
	// 陪玩那边看到的就是「客户端闪退之后再打开都打不开」。
	newExe := ""
	for _, n := range exeNames {
		if !isClientExe(n) {
			continue
		}
		p := filepath.Join(destDir, n)
		if fi, err := os.Stat(p); err == nil && fi.Size() > 0 {
			newExe = p
			break
		}
	}
	switch oldExe := clientPath; {
	case newExe == "":
		safeWarn("update: no client exe after extract — keeping the existing install untouched")
	case oldExe == "" || strings.EqualFold(filepath.Clean(oldExe), filepath.Clean(newExe)):
		// 同一个文件（同名升级）：它就是新客户端本体，绝不能删。
	default:
		if _, err := os.Stat(oldExe); err == nil {
			_ = os.Remove(oldExe)
			safeInfo(fmt.Sprintf("Removed old-named client exe %s (now using %s)", oldExe, newExe))
		}
	}
	_ = os.Remove(updateSignalFile)
	safeInfo("Update applied, relaunching client")
	selfUpdateIfNeeded(destDir)
	clientPID = 0
	clientPath = ""
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
		path = repairMissingExe()
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
}

// repairMissingExe 兜底修复：客户端目录还在（resources\app.asar 在），但启动用的 exe 不见了。
// 这是历史 bug 留下的残局——更新流程把「刚解压出来的客户端 exe」当成旧 exe 删掉了，
// 之后每一轮 findClient 都返回空，看门狗只会一直写 "Client exe not found"，
// 陪玩那边就是「客户端闪退之后再打开都打不开」。这里用本机已下载好的安装包把它补回去。
func repairMissingExe() string {
	now := time.Now().UnixNano()
	if now-atomic.LoadInt64(&repairLastTry) < 10*60*1e9 {
		return ""
	}
	zipPath := filepath.Join(updateSignalDir, "update.zip")
	// 本机没留下更新包（新装机器 / 从没更新过）时留空：
	// 下面的 downloadAndExtract 会改用 cloudClientZipURL 从云端现拉一份。
	if _, err := os.Stat(zipPath); err != nil {
		zipPath = ""
	}
	for _, base := range []string{`C:\Program Files`, `C:\Program Files (x86)`} {
		entries, err := os.ReadDir(base)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			// 目录名必须是「我们的」客户端目录（蠢驴 / 陪玩 / chunlv）。
			// 别的 Electron 程序（实测是 Logitech G HUB 的 LGHUB 目录）同样有
			// resources\app.asar，只按 app.asar 判断会把整包客户端解压进别人的安装目录，
			// 覆盖掉别人的 dll / app.asar，把那款软件搞坏。
			if !isClientDirName(e.Name()) {
				continue
			}
			dir := filepath.Join(base, e.Name())
			if _, err := os.Stat(filepath.Join(dir, "resources", "app.asar")); err != nil {
				continue
			}
			atomic.StoreInt64(&repairLastTry, now)
			src := zipPath
			if src == "" {
				src = cloudClientZipURL
			}
			safeWarn(fmt.Sprintf("client exe gone but install dir intact (%s) — restoring from %s", dir, src))
			if _, err := downloadAndExtract(cloudClientZipURL, zipPath, dir); err != nil {
				safeErr(fmt.Sprintf("restore failed: %v", err))
				return ""
			}
			if p := findClient(); p != "" {
				safeInfo(fmt.Sprintf("Restored client exe: %s", p))
				return p
			}
		}
	}
	return ""
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
		if !isClientRunning() {
			log.Println("Client gone — relaunching...")
			maybeLaunchClient()
		}
	}
}
