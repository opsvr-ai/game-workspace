//go:build windows

package tray

import (
	"encoding/binary"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"
	"unsafe"

	"github.com/chunlv/agent/internal/config"
	"github.com/chunlv/agent/internal/engine"
	"github.com/chunlv/agent/internal/netctrl"
	"github.com/chunlv/agent/internal/sysctrl"
	"github.com/chunlv/agent/internal/wsclient"
)

// ── Win32 constants ──

const (
	// Window messages
	WM_CREATE  = 0x0001
	WM_DESTROY = 0x0002
	WM_CLOSE   = 0x0010
	WM_COMMAND = 0x0111
	WM_TRAY    = 0x8001 // WM_APP + 1

	// Window styles
	CW_USEDEFAULT = 0x80000000

	// Class styles
	CS_VREDRAW = 0x0001
	CS_HREDRAW = 0x0002

	// Shell_NotifyIcon
	NIM_ADD    = 0x00000000
	NIM_MODIFY = 0x00000001
	NIM_DELETE = 0x00000002

	NIF_MESSAGE = 0x00000001
	NIF_ICON    = 0x00000002
	NIF_TIP     = 0x00000004

	// TrackPopupMenu
	TPM_RIGHTBUTTON = 0x0002
	TPM_BOTTOMALIGN = 0x0004
	TPM_LEFTALIGN   = 0x0000

	// Menu flags
	MF_STRING    = 0x00000000
	MF_SEPARATOR = 0x00000800

	// MessageBox
	MB_YESNO         = 0x00000004
	MB_ICONQUESTION  = 0x00000020
	MB_DEFBUTTON2    = 0x00000100
	IDYES            = 6

	// Menu IDs
	IDM_SWITCH = 1001
	IDM_QUIT   = 1003
	IDM_SHOW   = 1004

	NOTIFYICONDATA_V3_SIZE = 956
)

// ── Win32 DLLs ──

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	shell32  = syscall.NewLazyDLL("shell32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")

	// user32 functions
	procRegisterClassEx    = user32.NewProc("RegisterClassExW")
	procCreateWindowEx     = user32.NewProc("CreateWindowExW")
	procDefWindowProc      = user32.NewProc("DefWindowProcW")
	procGetMessage         = user32.NewProc("GetMessageW")
	procTranslateMessage   = user32.NewProc("TranslateMessage")
	procDispatchMessage    = user32.NewProc("DispatchMessageW")
	procPostQuitMessage    = user32.NewProc("PostQuitMessage")
	procGetModuleHandle    = kernel32.NewProc("GetModuleHandleW")
	procLoadIcon           = user32.NewProc("LoadIconW")
	procLoadCursor         = user32.NewProc("LoadCursorW")
	procCreatePopupMenu    = user32.NewProc("CreatePopupMenu")
	procAppendMenu         = user32.NewProc("AppendMenuW")
	procTrackPopupMenu     = user32.NewProc("TrackPopupMenu")
	procDestroyMenu        = user32.NewProc("DestroyMenu")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	procGetCursorPos       = user32.NewProc("GetCursorPos")
	procMessageBox         = user32.NewProc("MessageBoxW")

	// shell32 functions
	procShellNotifyIcon = shell32.NewProc("Shell_NotifyIconW")
)

// ── Window class / instance ──

var (
	appTracker    *engine.TimeTracker
	appWsClient   *wsclient.Client
	appCurrentMode engine.Mode
)

// Run starts the native Win32 system tray and blocks until exit.
func Run(
	tracker *engine.TimeTracker,
	wsClient *wsclient.Client,
	onReconfig func(config.AgentConfig),
) {
	appTracker = tracker
	appWsClient = wsClient
	appCurrentMode = engine.ModeEntertainment

	// Create the floating popup window (hidden by default).
	// Must happen before the message loop so it can receive messages.
	popupWindow = NewPopup(tracker, wsClient, config.Get().Username)

	// Start background services.
	go wsClient.Connect()
	go commandLoop(wsClient)

	// Run the Windows message loop (blocking).
	runMessageLoop()
}

func runMessageLoop() {
	// Get module handle
	hInstance, _, _ := procGetModuleHandle.Call(0)

	// ── Register window class (using raw bytes to avoid Go struct alignment issues) ──
	className, _ := syscall.UTF16PtrFromString("ChunlvAgentTray")
	wndProc := syscall.NewCallback(windowProc)
	hIcon, _, _ := procLoadIcon.Call(0, uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr("IDI_APPLICATION"))))
	hCursor, _, _ := procLoadCursor.Call(0, uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr("IDC_ARROW"))))

	// Build WNDCLASSEXW as a raw byte buffer (80 bytes)
	wc := make([]byte, 80)
	// cbSize (offset 0, uint32)
	*(*uint32)(unsafe.Pointer(&wc[0])) = 80
	// lpfnWndProc (offset 8, uintptr)
	*(*uintptr)(unsafe.Pointer(&wc[8])) = wndProc
	// cbClsExtra (offset 16, int32)
	*(*int32)(unsafe.Pointer(&wc[16])) = 0
	// cbWndExtra (offset 20, int32)
	*(*int32)(unsafe.Pointer(&wc[20])) = 0
	// hInstance (offset 24, uintptr)
	*(*uintptr)(unsafe.Pointer(&wc[24])) = hInstance
	// hIcon (offset 32, uintptr)
	*(*uintptr)(unsafe.Pointer(&wc[32])) = hIcon
	// hCursor (offset 40, uintptr)
	*(*uintptr)(unsafe.Pointer(&wc[40])) = hCursor
	// hbrBackground (offset 48, uintptr)
	*(*uintptr)(unsafe.Pointer(&wc[48])) = 5 // COLOR_WINDOW+1
	// lpszMenuName (offset 56, *uint16)
	*(*uintptr)(unsafe.Pointer(&wc[56])) = 0
	// lpszClassName (offset 64, *uint16)
	*(*uintptr)(unsafe.Pointer(&wc[64])) = uintptr(unsafe.Pointer(className))
	// hIconSm (offset 72, uintptr)
	*(*uintptr)(unsafe.Pointer(&wc[72])) = 0

	// Style field is at offset 4 in the struct
	// Actually WNDCLASSEXW.style is at offset 4 after cbSize
	*(*uint32)(unsafe.Pointer(&wc[4])) = CS_HREDRAW | CS_VREDRAW

	ret, _, _ := procRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc[0])))
	if ret == 0 {
		log.Fatal("RegisterClassEx failed")
	}

	// ── Create hidden window ──
	windowName, _ := syscall.UTF16PtrFromString("ChunlvAgent")
	hwnd, _, _ := procCreateWindowEx.Call(
		0,                                    // dwExStyle
		uintptr(unsafe.Pointer(className)),    // lpClassName
		uintptr(unsafe.Pointer(windowName)),   // lpWindowName
		0,                                    // dwStyle (hidden)
		CW_USEDEFAULT, 0, CW_USEDEFAULT, 0,   // position/size
		0,                                    // parent
		0,                                    // menu
		hInstance,                             // instance
		0,                                    // lpParam
	)

	if hwnd == 0 {
		log.Fatal("Failed to create tray window")
	}

	// ── Add tray icon ──
	addTrayIcon(hwnd)

	log.Println("Agent running in system tray (right-click for menu)")

	// ── Message loop ──
	var msg struct {
		Hwnd    uintptr
		Message uint32
		WParam  uintptr
		LParam  uintptr
		Time    uint32
		Pt      struct{ X, Y int32 }
	}

	for {
		ret, _, _ := procGetMessage.Call(
			uintptr(unsafe.Pointer(&msg)),
			0, 0, 0,
		)
		if ret == 0 {
			break // WM_QUIT
		}
		if ret == 0xFFFFFFFF { // -1 = error
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		procDispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
	}

	// Cleanup
	removeTrayIcon(hwnd)
}

func windowProc(hwnd uintptr, msg uint32, wParam, lParam uintptr) uintptr {
	switch msg {
	case WM_DESTROY:
		procPostQuitMessage.Call(0)
		return 0

	case WM_CLOSE:
		procPostQuitMessage.Call(0)
		return 0

	case WM_TRAY:
		// lParam loword = mouse event
		event := uint32(lParam & 0xFFFF)
		switch event {
		case 0x0205: // WM_RBUTTONUP
			showContextMenu(hwnd)
		case 0x0203: // WM_LBUTTONDBLCLK — double-click tray icon
			if popupWindow != nil {
				popupWindow.Toggle()
			}
		case 0x0202: // WM_LBUTTONUP — single-click tray icon
			if popupWindow != nil {
				popupWindow.Toggle()
			}
		}
		return 0

	case WM_COMMAND:
		id := uint32(wParam & 0xFFFF)
		switch id {
		case IDM_SWITCH:
			handleModeSwitch()
		case IDM_SHOW:
			if popupWindow != nil {
				popupWindow.Toggle()
			}
		case IDM_QUIT:
			procPostQuitMessage.Call(0)
		}
		return 0
	}

	ret, _, _ := procDefWindowProc.Call(hwnd, uintptr(msg), wParam, lParam)
	return ret
}

// ── Tray icon ──

func addTrayIcon(hwnd uintptr) {
	nid := makeNOTIFYICONDATA(hwnd, NIM_ADD)
	procShellNotifyIcon.Call(NIM_ADD, uintptr(unsafe.Pointer(&nid[0])))
}

func removeTrayIcon(hwnd uintptr) {
	nid := makeNOTIFYICONDATA(hwnd, NIM_DELETE)
	procShellNotifyIcon.Call(NIM_DELETE, uintptr(unsafe.Pointer(&nid[0])))
}

func makeNOTIFYICONDATA(hwnd uintptr, msg uint32) []byte {
	nid := make([]byte, NOTIFYICONDATA_V3_SIZE)

	// cbSize
	*(*uint32)(unsafe.Pointer(&nid[0])) = uint32(NOTIFYICONDATA_V3_SIZE)
	// hWnd
	*(*uintptr)(unsafe.Pointer(&nid[8])) = hwnd
	// uID
	*(*uint32)(unsafe.Pointer(&nid[16])) = 1
	// uFlags
	*(*uint32)(unsafe.Pointer(&nid[20])) = NIF_MESSAGE | NIF_ICON | NIF_TIP
	// uCallbackMessage
	*(*uint32)(unsafe.Pointer(&nid[24])) = WM_TRAY

	// hIcon — load from ICO bytes
	icoData := generateICO()
	hIcon := createIconFromICO(icoData)
	if hIcon == 0 {
		// Fallback: use default application icon (IDI_APPLICATION = 32512)
		hIcon, _, _ = procLoadIcon.Call(0, uintptr(32512))
	}
	*(*uintptr)(unsafe.Pointer(&nid[32])) = hIcon

	// szTip (offset 40 in struct, but varies by version; in V3 it's after hIcon+szTip starts)
	// NOTIFYICONDATA_V3 layout (simplified): cbSize(4) + padding(4) + hWnd(8) + uID(4) + uFlags(4) + uCallbackMessage(4) + hIcon(8) + szTip[128](128) + ...
	// Actually at offset 40 after hIcon at 32+8=40:
	tip, _ := syscall.UTF16FromString("蠢驴电竞 - 陪玩师客户端")
	tipOffset := 40
	for i, c := range tip {
		if tipOffset+i*2 >= len(nid)-2 {
			break
		}
		nid[tipOffset+i*2] = byte(c)
		nid[tipOffset+i*2+1] = byte(c >> 8)
	}

	return nid
}

func createIconFromICO(data []byte) uintptr {
	// Parse ICO to find image data offset.
	// ICO header: reserved(2) + type(2) + count(2) = 6 bytes
	// Directory entry: width(1)+height(1)+colors(1)+reserved(1)+planes(2)+bpp(2)+size(4)+offset(4) = 16 bytes
	count := int(binary.LittleEndian.Uint16(data[4:6]))
	if count < 1 {
		return 0
	}
	// Read offset of first image from directory entry (bytes 18-21 of the entry at bytes 6-21)
	imageOffset := binary.LittleEndian.Uint32(data[18:22])

	procCreateIcon := user32.NewProc("CreateIconFromResourceEx")

	// fIcon=TRUE(1) creates an ICON; FALSE(0) would create a CURSOR.
	hIcon, _, _ := procCreateIcon.Call(
		uintptr(unsafe.Pointer(&data[imageOffset])),
		0,            // size (0 = use all remaining)
		1,            // fIcon (TRUE = create icon, not cursor)
		0x00030000,   // version
		0, 0,         // cx, cy (0 = use native size)
		0x0001,       // LR_DEFAULTCOLOR
	)

	return hIcon
}

// ── Context menu ──

func showContextMenu(hwnd uintptr) {
	menu, _, _ := procCreatePopupMenu.Call()

	// Build menu items
	var modeLabel string
	if appCurrentMode == engine.ModeWork {
		modeLabel = "切换为娱乐模式"
	} else {
		modeLabel = "切换为接单模式"
	}

	appendMenu(menu, MF_STRING, IDM_SWITCH, modeLabel)

	// Show/hide popup label
	var showLabel string
	if popupWindow != nil && popupWindow.IsVisible() {
		showLabel = "隐藏状态窗"
	} else {
		showLabel = "显示状态窗"
	}
	appendMenu(menu, MF_STRING, IDM_SHOW, showLabel)

	appendMenu(menu, MF_SEPARATOR, 0, "")
	appendMenu(menu, MF_STRING, IDM_QUIT, "退出")

	// Get cursor position
	var pt struct{ X, Y int32 }
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))

	// Must set foreground window before track
	procSetForegroundWindow.Call(hwnd)

	procTrackPopupMenu.Call(
		menu,
		TPM_RIGHTBUTTON|TPM_BOTTOMALIGN|TPM_LEFTALIGN,
		uintptr(pt.X), uintptr(pt.Y),
		0, // reserved
		hwnd,
		0, // rect
	)

	procDestroyMenu.Call(menu)
}

func appendMenu(menu uintptr, flags uint32, id uint32, text string) {
	uText, _ := syscall.UTF16PtrFromString(text)
	procAppendMenu.Call(menu, uintptr(flags), uintptr(id), uintptr(unsafe.Pointer(uText)))
}

// ── Mode switch ──

func handleModeSwitch() {
	var currentName, targetName string
	var newMode engine.Mode
	var status string

	if appCurrentMode == engine.ModeWork {
		currentName = "接单中"
		targetName = "娱乐模式"
		newMode = engine.ModeEntertainment
		status = "IDLE"
	} else {
		currentName = "娱乐中"
		targetName = "接单模式"
		newMode = engine.ModeWork
		status = "ONLINE"
	}

	if showMessageBox(currentName, targetName) {
		appCurrentMode = newMode
		appTracker.SwitchMode(newMode)
		appWsClient.SendStatus(status, newMode)
		log.Printf("Mode switched to %s", newMode)
	}
}

func showMessageBox(currentName, targetName string) bool {
	title, _ := syscall.UTF16PtrFromString("切换模式")
	text, _ := syscall.UTF16PtrFromString(
		fmt.Sprintf("当前模式: %s\r\n是否切换到%s？", currentName, targetName),
	)

	ret, _, _ := procMessageBox.Call(
		0,
		uintptr(unsafe.Pointer(text)),
		uintptr(unsafe.Pointer(title)),
		MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2,
	)

	return ret == IDYES
}

// ── Command dispatch ──

func commandLoop(wsClient *wsclient.Client) {
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	for {
		select {
		case sig := <-sigChan:
			log.Printf("Received signal %v, shutting down...", sig)
			procPostQuitMessage.Call(0)
			return
		case cmd := <-wsClient.CommandChan:
			log.Printf("Executing command: %s", cmd.Command)
			var err error
			switch cmd.Command {
			case "shutdown":
				err = sysctrl.Shutdown()
			case "restart":
				err = sysctrl.Restart()
			case "throttle":
				err = netctrl.SetThrottle(cmd.Params.LimitKB)
			case "unthrottle":
				err = netctrl.RemoveThrottle()
			case "kick":
				log.Println("Kicked by admin — shutting down")
				wsClient.Disconnect()
				procPostQuitMessage.Call(0)
				return
			default:
				log.Printf("Unknown command: %s", cmd.Command)
			}
			success := err == nil
			if !success {
				log.Printf("Command %s failed: %v", cmd.Command, err)
			}
			wsClient.SendAck(cmd.Command, success)
		}
	}
}

// openBrowser opens the default browser to the given URL.
func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("Failed to open browser: %v", err)
	}
}
