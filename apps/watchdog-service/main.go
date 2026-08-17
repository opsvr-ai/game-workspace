package main

import (
	"archive/zip"
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

var searchPaths = []string{
	`C:\Program Files\@chunlvcompanion-electron\蠢驴电竞.exe`,
	`C:\Program Files\蠢驴电竞\蠢驴电竞.exe`,
	`C:\Program Files (x86)\@chunlvcompanion-electron\蠢驴电竞.exe`,
	`C:\Program Files (x86)\蠢驴电竞\蠢驴电竞.exe`,
	filepath.Join(os.Getenv("LOCALAPPDATA"), `Programs\蠢驴电竞\蠢驴电竞.exe`),
	filepath.Join(os.Getenv("ProgramFiles"), `蠢驴电竞\蠢驴电竞.exe`),
	filepath.Join(os.Getenv("ProgramFiles"), `@chunlvcompanion-electron\蠢驴电竞.exe`),
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
			if !e.IsDir() || (!strings.Contains(e.Name(), "蠢驴") && !strings.Contains(e.Name(), "chunlv")) {
				continue
			}
			c := filepath.Join(base, e.Name(), "蠢驴电竞.exe")
			if _, err := os.Stat(c); err == nil {
				clientPath = c
				return c
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
			if strings.EqualFold(name, "蠢驴电竞.exe") {
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

// ensureUpdateDir 创建更新信号目录并授予 Everyone 写权限，让普通权限的陪玩端也能写入。
func ensureUpdateDir() {
	if err := os.MkdirAll(updateSignalDir, 0755); err != nil {
		safeWarn(fmt.Sprintf("mkdir update dir failed: %v", err))
		return
	}
	_ = exec.Command("icacls", updateSignalDir, "/grant", "Everyone:(OI)(CI)F", "/T").Run()
}

type updateRequest struct {
	URL string `json:"url"`
}

// downloadAndExtract 下载 zip 并解压覆盖到目标目录（去掉 win-unpacked 顶层前缀）。
func downloadAndExtract(url, destDir string) error {
	safeInfo(fmt.Sprintf("Downloading update: %s", url))
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download status %d", resp.StatusCode)
	}
	tmp := filepath.Join(os.TempDir(), "chunlv-update.zip")
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err = io.Copy(f, resp.Body); err != nil {
		f.Close()
		return err
	}
	f.Close()
	defer os.Remove(tmp)

	zr, err := zip.OpenReader(tmp)
	if err != nil {
		return err
	}
	defer zr.Close()
	for _, zf := range zr.File {
		rel := zf.Name
		if strings.HasPrefix(rel, "win-unpacked/") {
			rel = strings.TrimPrefix(rel, "win-unpacked/")
		}
		if rel == "" {
			continue
		}
		dst := filepath.Join(destDir, rel)
		if zf.FileInfo().IsDir() {
			_ = os.MkdirAll(dst, 0755)
			continue
		}
		_ = os.MkdirAll(filepath.Dir(dst), 0755)
		out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
		if err != nil {
			continue
		}
		rc, err := zf.Open()
		if err != nil {
			out.Close()
			continue
		}
		_, _ = io.Copy(out, rc)
		out.Close()
		rc.Close()
	}
	return nil
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
	if err := downloadAndExtract(req.URL, installDir); err != nil {
		safeWarn(fmt.Sprintf("update failed: %v", err))
		return
	}
	_ = os.Remove(updateSignalFile)
	safeInfo("Update applied, relaunching client")
	clientPID = 0
	maybeLaunchClient()
}

// isClientRunning checks if OUR launched PID is still alive. If we do not
// currently own a PID, it adopts any running client process so a manually
// started client is protected as well.
func isClientRunning() bool {
	if clientPID != 0 {
		h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, clientPID)
		if err != nil {
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
		if strings.EqualFold(name, "蠢驴电竞.exe") {
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

	if p := findClient(); p != "" {
		safeInfo(fmt.Sprintf("Client found at %s", p))
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
				safeWarn("Client PID gone — relaunching")
				maybeLaunchClient()
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
