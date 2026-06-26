//go:build windows

package tray

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"syscall"
	"unsafe"

	"github.com/chunlv/agent/internal/engine"
	"github.com/chunlv/agent/internal/wsclient"
)

// ── Types ──

// OrderInfo holds parsed order data for display in the popup.
type OrderInfo struct {
	ID     string
	Game   string
	Amount string
}

// RECT is a Win32 rectangle.
type RECT struct {
	Left, Top, Right, Bottom int32
}

// PopupWindow is a Win32 layered popup that shows companion status / orders.
type PopupWindow struct {
	hwnd     uintptr
	tracker  *engine.TimeTracker
	wsClient *wsclient.Client
	username string
	visible  bool

	// Pre-created GDI objects (destroyed on WM_DESTROY)
	hFontTitle uintptr // 15px bold — mode label
	hFontCard  uintptr // 12px — card labels
	hFontTimer uintptr // 22px bold — timer numbers
	hFontBody  uintptr // 13px — order details
	hFontSmall uintptr // 10px — footer
	hFontBtn   uintptr // 13px bold — button text

	hBgBrush    uintptr // #0F172A
	hCardBrush  uintptr // #1E293B
	hCyanBrush  uintptr // #00D4FF
	hPinkBrush  uintptr // #FF6B9D
	hGreenBrush uintptr // #00E676
	hGrayBrush  uintptr // #475569
	hWhiteBrush uintptr // #FFFFFF

	hCyanPen uintptr // border pen

	// Button hit-test rectangles (set in WM_PAINT, read in WM_LBUTTONDOWN)
	btnMode    RECT
	btnConfirm RECT
	btnIgnore  RECT

	// Current order (parsed from latest wsclient order)
	currentOrder *OrderInfo
	orderMu      sync.Mutex
}

// Global popup instance, set during WM_CREATE so the window proc can reach it.
var popupWindow *PopupWindow

// ── Win32 constants (popup-specific) ──

const (
	// Extended window styles
	_WS_EX_LAYERED    = 0x00080000
	_WS_EX_TOPMOST    = 0x00000008
	_WS_EX_TOOLWINDOW = 0x00000080

	// SetWindowPos
	_HWND_TOPMOST   = ^uintptr(0) // -1
	_SWP_SHOWWINDOW = 0x0040
	_SWP_NOACTIVATE = 0x0010

	// Layered window
	_LWA_ALPHA = 0x00000002

	// SPI
	_SPI_GETWORKAREA = 0x0030

	// Font weights
	_FW_NORMAL = 400
	_FW_BOLD   = 700

	// Font families
	_DEFAULT_CHARSET     = 1
	_OUT_DEFAULT_PRECIS  = 0
	_CLIP_DEFAULT_PRECIS = 0
	_DEFAULT_QUALITY     = 0
	_DEFAULT_PITCH       = 0
	_FF_DONTCARE         = 0

	// DrawText format flags
	_DT_CENTER     = 0x00000001
	_DT_VCENTER    = 0x00000004
	_DT_SINGLELINE = 0x00000020

	// Activate states
	_WA_INACTIVE = 0

	// Stock objects
	_NULL_BRUSH = 5
	_NULL_PEN   = 8

	// Pen style
	_PS_SOLID = 0

	// Window styles (also in tray.go, repeated here for popup self-containment)
	_WS_POPUP = 0x80000000

	// Window messages (standard; tray.go only defines the ones it uses)
	_WM_PAINT       = 0x000F
	_WM_TIMER       = 0x0113
	_WM_KEYDOWN     = 0x0100
	_WM_ACTIVATE    = 0x0006
	_WM_LBUTTONDOWN = 0x0201
	_WM_ERASEBKGND  = 0x0014

	// Key codes
	_VK_ESCAPE = 0x1B

	// Popup dimensions
	POPUP_W = 260
	POPUP_H = 320

	// GDI colors (COLORREF = 0x00BBGGRR)
	COLOR_BG_DARK = 0x002A170F // #0F172A
	COLOR_CARD_BG = 0x003B291E // #1E293B
	COLOR_CYAN    = 0x00FFD400 // #00D4FF
	COLOR_PINK    = 0x009D6BFF // #FF6B9D
	COLOR_GREEN   = 0x0076E600 // #00E676
	COLOR_GRAY    = 0x006B5E47 // #475569
	COLOR_WHITE   = 0x00FFFFFF
	COLOR_SLATE   = 0x00BDAB94 // #94ABBD — muted text

	// Layout padding
	PAD_X = 10
	PAD_Y = 8

	// Timer ID
	TIMER_REFRESH = 1
)

// ── Win32 DLL procs ──

var (
	_gdi32 = syscall.NewLazyDLL("gdi32.dll")

	// gdi32
	_procCreateSolidBrush = _gdi32.NewProc("CreateSolidBrush")
	_procCreatePen        = _gdi32.NewProc("CreatePen")
	_procCreateFontW      = _gdi32.NewProc("CreateFontW")
	_procDeleteObject     = _gdi32.NewProc("DeleteObject")
	_procSelectObject     = _gdi32.NewProc("SelectObject")
	_procSetBkMode        = _gdi32.NewProc("SetBkMode")
	_procSetTextColor     = _gdi32.NewProc("SetTextColor")
	_procFillRect         = user32.NewProc("FillRect")
	_procRoundRect        = _gdi32.NewProc("RoundRect")
	_procGetStockObject   = _gdi32.NewProc("GetStockObject")

	// user32 drawing
	_procDrawText      = user32.NewProc("DrawTextW")
	_procBeginPaint    = user32.NewProc("BeginPaint")
	_procEndPaint      = user32.NewProc("EndPaint")
	_procGetClientRect = user32.NewProc("GetClientRect")

	// user32 window management
	_procSetLayeredWindowAttributes = user32.NewProc("SetLayeredWindowAttributes")
	_procSetTimer                   = user32.NewProc("SetTimer")
	_procKillTimer                  = user32.NewProc("KillTimer")
	_procInvalidateRect             = user32.NewProc("InvalidateRect")
	_procSetWindowPos               = user32.NewProc("SetWindowPos")
	_procShowWindow                 = user32.NewProc("ShowWindow")
	_procSystemParametersInfoW      = user32.NewProc("SystemParametersInfoW")
)

// ── Helper: draw UTF-16 text without the -1 overflow problem ──

// drawTextW is a thin wrapper that computes the real string length so we don't
// need to pass -1 as cchText (which overflows uintptr in Go).
func drawTextW(hdc uintptr, text string, rect *RECT, format uint32) {
	u16 := syscall.StringToUTF16(text)
	// len(u16) includes the trailing NUL; DrawTextW expects count excluding NUL.
	cch := len(u16) - 1
	_procDrawText.Call(hdc, uintptr(unsafe.Pointer(&u16[0])), uintptr(cch), uintptr(unsafe.Pointer(rect)), uintptr(format))
}

// ── Constructor ──

// NewPopup creates the popup window (initially hidden). Call from the main thread
// before the message loop starts so the window is ready when Toggle is called.
func NewPopup(tracker *engine.TimeTracker, wsClient *wsclient.Client, username string) *PopupWindow {
	p := &PopupWindow{
		tracker:  tracker,
		wsClient: wsClient,
		username: username,
	}

	// Register a dedicated window class for the popup.
	hInstance, _, _ := procGetModuleHandle.Call(0)
	className, _ := syscall.UTF16PtrFromString("ChunlvAgentPopup")
	wndProc := syscall.NewCallback(popupWindowProc)

	wc := make([]byte, 80)
	*(*uint32)(unsafe.Pointer(&wc[0])) = 80            // cbSize
	*(*uint32)(unsafe.Pointer(&wc[4])) = CS_VREDRAW | CS_HREDRAW
	*(*uintptr)(unsafe.Pointer(&wc[8])) = wndProc       // lpfnWndProc
	*(*uintptr)(unsafe.Pointer(&wc[24])) = hInstance     // hInstance
	cur, _, _ := procLoadCursor.Call(0, uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr("IDC_ARROW"))))
	*(*uintptr)(unsafe.Pointer(&wc[40])) = cur
	*(*uintptr)(unsafe.Pointer(&wc[48])) = 5             // COLOR_WINDOW+1
	*(*uintptr)(unsafe.Pointer(&wc[64])) = uintptr(unsafe.Pointer(className))

	ret, _, _ := procRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc[0])))
	if ret == 0 {
		log.Fatal("RegisterClassEx (popup) failed")
	}

	windowName, _ := syscall.UTF16PtrFromString("")

	hwnd, _, _ := procCreateWindowEx.Call(
		_WS_EX_TOPMOST|_WS_EX_TOOLWINDOW|_WS_EX_LAYERED,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(windowName)),
		_WS_POPUP,
		0, 0, POPUP_W, POPUP_H,
		0, 0, hInstance,
		uintptr(unsafe.Pointer(p)), // lpParam → available in WM_CREATE
	)

	if hwnd == 0 {
		log.Fatal("CreateWindowEx (popup) failed")
	}

	// Set overall window translucency (220/255 alpha).
	_procSetLayeredWindowAttributes.Call(hwnd, 0, 220, _LWA_ALPHA)

	// Start the 1-second refresh timer.
	_procSetTimer.Call(hwnd, TIMER_REFRESH, 1000, 0)

	return p
}

// ── Public API ──

// Show positions the popup at the bottom-right of the primary monitor and makes it visible.
func (p *PopupWindow) Show() {
	if p.visible {
		return
	}

	// Get working area of primary monitor.
	var wa RECT
	_procSystemParametersInfoW.Call(_SPI_GETWORKAREA, 0, uintptr(unsafe.Pointer(&wa)), 0)

	x := int(wa.Right) - POPUP_W - 10
	y := int(wa.Bottom) - POPUP_H - 10
	if x < 0 {
		x = 0
	}
	if y < 0 {
		y = 0
	}

	_procSetWindowPos.Call(
		p.hwnd, _HWND_TOPMOST,
		uintptr(x), uintptr(y), POPUP_W, POPUP_H,
		_SWP_SHOWWINDOW|_SWP_NOACTIVATE,
	)
	p.visible = true
	log.Println("Popup shown")
}

// Hide makes the popup invisible.
func (p *PopupWindow) Hide() {
	if !p.visible {
		return
	}
	_procShowWindow.Call(p.hwnd, 0) // SW_HIDE
	p.visible = false
	log.Println("Popup hidden")
}

// Toggle shows or hides the popup depending on current state.
func (p *PopupWindow) Toggle() {
	if p.visible {
		p.Hide()
	} else {
		p.Show()
	}
}

// IsVisible returns whether the popup is currently shown.
func (p *PopupWindow) IsVisible() bool {
	return p.visible
}

// SetOrder stores order data and triggers a repaint so the order section appears.
func (p *PopupWindow) SetOrder(order *OrderInfo) {
	p.orderMu.Lock()
	p.currentOrder = order
	p.orderMu.Unlock()
	_procInvalidateRect.Call(p.hwnd, 0, 1) // TRUE = erase background
}

// checkForOrder polls the wsclient for a new order and updates the popup state.
func (p *PopupWindow) checkForOrder() {
	raw := wsclient.GetLatestOrder()
	if raw == nil {
		p.orderMu.Lock()
		hadOrder := p.currentOrder != nil
		p.currentOrder = nil
		p.orderMu.Unlock()
		if hadOrder {
			_procInvalidateRect.Call(p.hwnd, 0, 1)
		}
		return
	}

	var generic map[string]interface{}
	if err := json.Unmarshal(raw, &generic); err != nil {
		return
	}

	order := &OrderInfo{}
	order.ID = stringField(generic, "id", "orderId", "_id")
	order.Game = stringField(generic, "game", "gameName", "game_type", "title")
	order.Amount = formatAmount(generic)

	if order.ID == "" {
		return
	}

	p.orderMu.Lock()
	existing := p.currentOrder
	changed := existing == nil || existing.ID != order.ID
	p.currentOrder = order
	p.orderMu.Unlock()

	if changed {
		log.Printf("Popup: new order #%s — %s %s", order.ID, order.Game, order.Amount)
		_procInvalidateRect.Call(p.hwnd, 0, 1)
	}
}

// ── Window procedure ──

func popupWindowProc(hwnd uintptr, msg uint32, wParam, lParam uintptr) uintptr {
	p := popupWindow
	if p == nil && msg == WM_CREATE {
		// First message: extract PopupWindow pointer from CREATESTRUCT.lpCreateParams.
		// lpCreateParams is the FIRST field of CREATESTRUCTA/W.
		createParams := *(*uintptr)(unsafe.Pointer(lParam))
		p = (*PopupWindow)(unsafe.Pointer(createParams))
		popupWindow = p
		p.hwnd = hwnd
		p.initGDI()
		return 0
	}

	if p == nil {
		ret, _, _ := procDefWindowProc.Call(hwnd, uintptr(msg), wParam, lParam)
		return ret
	}

	switch msg {
	case _WM_ERASEBKGND:
		return 1 // We handle all drawing in _WM_PAINT

	case _WM_PAINT:
		p.onPaint()
		return 0

	case _WM_TIMER:
		if wParam == TIMER_REFRESH {
			p.checkForOrder()
			_procInvalidateRect.Call(hwnd, 0, 0) // FALSE = no erase (avoid flicker)
		}
		return 0

	case _WM_ACTIVATE:
		if uint32(wParam) == _WA_INACTIVE {
			p.Hide()
		}
		return 0

	case _WM_KEYDOWN:
		if wParam == _VK_ESCAPE {
			p.Hide()
		}
		return 0

	case _WM_LBUTTONDOWN:
		x := int32(lParam & 0xFFFF)
		y := int32((lParam >> 16) & 0xFFFF)
		p.handleClick(x, y)
		return 0

	case WM_DESTROY:
		p.releaseGDI()
		_procKillTimer.Call(hwnd, TIMER_REFRESH, 0)
		return 0
	}

	ret, _, _ := procDefWindowProc.Call(hwnd, uintptr(msg), wParam, lParam)
	return ret
}

// ── GDI lifecycle ──

func (p *PopupWindow) initGDI() {
	faceName, _ := syscall.UTF16PtrFromString("Microsoft YaHei")

	p.hFontTitle, _, _ = _procCreateFontW.Call(
		15, 0, 0, 0, _FW_BOLD, 0, 0, 0,
		_DEFAULT_CHARSET, _OUT_DEFAULT_PRECIS, _CLIP_DEFAULT_PRECIS,
		_DEFAULT_QUALITY, _DEFAULT_PITCH|_FF_DONTCARE,
		uintptr(unsafe.Pointer(faceName)),
	)
	p.hFontCard, _, _ = _procCreateFontW.Call(
		12, 0, 0, 0, _FW_NORMAL, 0, 0, 0,
		_DEFAULT_CHARSET, _OUT_DEFAULT_PRECIS, _CLIP_DEFAULT_PRECIS,
		_DEFAULT_QUALITY, _DEFAULT_PITCH|_FF_DONTCARE,
		uintptr(unsafe.Pointer(faceName)),
	)
	p.hFontTimer, _, _ = _procCreateFontW.Call(
		22, 0, 0, 0, _FW_BOLD, 0, 0, 0,
		_DEFAULT_CHARSET, _OUT_DEFAULT_PRECIS, _CLIP_DEFAULT_PRECIS,
		_DEFAULT_QUALITY, _DEFAULT_PITCH|_FF_DONTCARE,
		uintptr(unsafe.Pointer(faceName)),
	)
	p.hFontBody, _, _ = _procCreateFontW.Call(
		13, 0, 0, 0, _FW_NORMAL, 0, 0, 0,
		_DEFAULT_CHARSET, _OUT_DEFAULT_PRECIS, _CLIP_DEFAULT_PRECIS,
		_DEFAULT_QUALITY, _DEFAULT_PITCH|_FF_DONTCARE,
		uintptr(unsafe.Pointer(faceName)),
	)
	p.hFontSmall, _, _ = _procCreateFontW.Call(
		10, 0, 0, 0, _FW_NORMAL, 0, 0, 0,
		_DEFAULT_CHARSET, _OUT_DEFAULT_PRECIS, _CLIP_DEFAULT_PRECIS,
		_DEFAULT_QUALITY, _DEFAULT_PITCH|_FF_DONTCARE,
		uintptr(unsafe.Pointer(faceName)),
	)
	p.hFontBtn, _, _ = _procCreateFontW.Call(
		13, 0, 0, 0, _FW_BOLD, 0, 0, 0,
		_DEFAULT_CHARSET, _OUT_DEFAULT_PRECIS, _CLIP_DEFAULT_PRECIS,
		_DEFAULT_QUALITY, _DEFAULT_PITCH|_FF_DONTCARE,
		uintptr(unsafe.Pointer(faceName)),
	)

	p.hBgBrush, _, _ = _procCreateSolidBrush.Call(uintptr(COLOR_BG_DARK))
	p.hCardBrush, _, _ = _procCreateSolidBrush.Call(uintptr(COLOR_CARD_BG))
	p.hCyanBrush, _, _ = _procCreateSolidBrush.Call(uintptr(COLOR_CYAN))
	p.hPinkBrush, _, _ = _procCreateSolidBrush.Call(uintptr(COLOR_PINK))
	p.hGreenBrush, _, _ = _procCreateSolidBrush.Call(uintptr(COLOR_GREEN))
	p.hGrayBrush, _, _ = _procCreateSolidBrush.Call(uintptr(COLOR_GRAY))
	p.hWhiteBrush, _, _ = _procCreateSolidBrush.Call(uintptr(COLOR_WHITE))

	p.hCyanPen, _, _ = _procCreatePen.Call(_PS_SOLID, 1, uintptr(COLOR_CYAN))
}

func (p *PopupWindow) releaseGDI() {
	for _, obj := range []uintptr{
		p.hFontTitle, p.hFontCard, p.hFontTimer, p.hFontBody, p.hFontSmall, p.hFontBtn,
		p.hBgBrush, p.hCardBrush, p.hCyanBrush, p.hPinkBrush, p.hGreenBrush, p.hGrayBrush, p.hWhiteBrush,
		p.hCyanPen,
	} {
		if obj != 0 {
			_procDeleteObject.Call(obj)
		}
	}
}

// ── Painting ──

func (p *PopupWindow) onPaint() {
	var ps [64]byte // PAINTSTRUCT
	hdc, _, _ := _procBeginPaint.Call(p.hwnd, uintptr(unsafe.Pointer(&ps[0])))
	if hdc == 0 {
		return
	}
	defer _procEndPaint.Call(p.hwnd, uintptr(unsafe.Pointer(&ps[0])))

	// Transparent text background.
	_procSetBkMode.Call(hdc, 1) // TRANSPARENT

	// ── 1. Background fill ──
	fullRect := RECT{0, 0, POPUP_W, POPUP_H}
	gdiFillRect(hdc, &fullRect, p.hBgBrush)

	// ── 2. Rounded border ──
	oldPen, _, _ := _procSelectObject.Call(hdc, p.hCyanPen)
	nullBrush, _, _ := _procGetStockObject.Call(_NULL_BRUSH)
	oldBrush, _, _ := _procSelectObject.Call(hdc, nullBrush)
	_procRoundRect.Call(hdc, 0, 0, POPUP_W-1, POPUP_H-1, 8, 8)
	_procSelectObject.Call(hdc, oldPen)
	_procSelectObject.Call(hdc, oldBrush)

	// ── 3. Layout state ──
	mode, workSec, entertainSec, totalSec := p.tracker.GetSnapshot()

	p.orderMu.Lock()
	hasOrder := p.currentOrder != nil
	order := p.currentOrder
	p.orderMu.Unlock()

	y := int32(10)

	// ── 4. Mode label ──
	p.drawModeLabel(hdc, mode, &y)

	// ── 5. Timer cards ──
	y += 4
	p.drawTimerCards(hdc, workSec, entertainSec, y)
	y += 62

	// ── 6. Total time card ──
	p.drawTotalCard(hdc, totalSec, y)
	y += 52

	// ── 7. Order notification OR mode switch button ──
	if hasOrder && order != nil {
		y += 4
		p.drawOrderSection(hdc, order, &y)
	} else {
		y += 10
		p.btnMode = p.drawModeButton(hdc, mode, y)
	}

	// ── 8. Footer ──
	p.drawFooter(hdc)
}

// ── Drawing helpers ──

func (p *PopupWindow) drawModeLabel(hdc uintptr, mode engine.Mode, y *int32) {
	oldFont, _, _ := _procSelectObject.Call(hdc, p.hFontTitle)
	defer _procSelectObject.Call(hdc, oldFont)

	var text string
	if mode == engine.ModeWork {
		text = "🔴 接单中"
	} else {
		text = "🟢 娱乐中"
	}

	_procSetTextColor.Call(hdc, uintptr(COLOR_CYAN))
	rect := RECT{0, *y, POPUP_W, *y + 24}
	drawTextW(hdc, text, &rect, _DT_CENTER|_DT_VCENTER|_DT_SINGLELINE)
	*y += 24
}

func (p *PopupWindow) drawTimerCards(hdc uintptr, workSec, entertainSec int64, y int32) {
	cardW := int32(115)
	cardH := int32(58)
	gap := int32(6)
	leftX := int32(PAD_X)
	rightX := leftX + cardW + gap

	p.drawCard(hdc, leftX, y, cardW, cardH, "接单时间", workSec)
	p.drawCard(hdc, rightX, y, cardW, cardH, "娱乐时间", entertainSec)
}

func (p *PopupWindow) drawCard(hdc uintptr, x, y, w, h int32, label string, seconds int64) {
	// Card bg with rounded corners
	oldBrush, _, _ := _procSelectObject.Call(hdc, p.hCardBrush)
	nullPen, _, _ := _procGetStockObject.Call(_NULL_PEN)
	oldPen, _, _ := _procSelectObject.Call(hdc, nullPen)
	_procRoundRect.Call(hdc, uintptr(x), uintptr(y), uintptr(x+w), uintptr(y+h), 6, 6)

	// Label
	oldFont, _, _ := _procSelectObject.Call(hdc, p.hFontCard)
	_procSetTextColor.Call(hdc, uintptr(COLOR_CYAN))
	lblRect := RECT{x, y + 4, x + w, y + 22}
	drawTextW(hdc, label, &lblRect, _DT_CENTER|_DT_VCENTER|_DT_SINGLELINE)

	// Timer value
	_procSelectObject.Call(hdc, p.hFontTimer)
	_procSetTextColor.Call(hdc, uintptr(COLOR_WHITE))
	valRect := RECT{x, y + 24, x + w, y + h - 2}
	drawTextW(hdc, formatDuration(seconds), &valRect, _DT_CENTER|_DT_VCENTER|_DT_SINGLELINE)

	// Restore
	_procSelectObject.Call(hdc, oldFont)
	_procSelectObject.Call(hdc, oldBrush)
	_procSelectObject.Call(hdc, oldPen)
}

func (p *PopupWindow) drawTotalCard(hdc uintptr, totalSec int64, y int32) {
	w := int32(240)
	h := int32(46)
	x := int32(PAD_X)

	// Card bg
	oldBrush, _, _ := _procSelectObject.Call(hdc, p.hCardBrush)
	nullPen, _, _ := _procGetStockObject.Call(_NULL_PEN)
	oldPen, _, _ := _procSelectObject.Call(hdc, nullPen)
	_procRoundRect.Call(hdc, uintptr(x), uintptr(y), uintptr(x+w), uintptr(y+h), 6, 6)

	// Label
	oldFont, _, _ := _procSelectObject.Call(hdc, p.hFontCard)
	_procSetTextColor.Call(hdc, uintptr(COLOR_CYAN))
	lblRect := RECT{x, y + 2, x + w, y + h/2}
	drawTextW(hdc, "总运行时间", &lblRect, _DT_CENTER|_DT_VCENTER|_DT_SINGLELINE)

	// Value
	_procSelectObject.Call(hdc, p.hFontTimer)
	_procSetTextColor.Call(hdc, uintptr(COLOR_WHITE))
	valRect := RECT{x, y + h/2, x + w, y + h - 2}
	drawTextW(hdc, formatDuration(totalSec), &valRect, _DT_CENTER|_DT_VCENTER|_DT_SINGLELINE)

	// Restore
	_procSelectObject.Call(hdc, oldFont)
	_procSelectObject.Call(hdc, oldBrush)
	_procSelectObject.Call(hdc, oldPen)
}

func (p *PopupWindow) drawOrderSection(hdc uintptr, order *OrderInfo, y *int32) {
	// Separator line
	sepRect := RECT{int32(PAD_X), *y, POPUP_W - int32(PAD_X), *y + 1}
	gdiFillRect(hdc, &sepRect, p.hCyanBrush)
	*y += 8

	// "新订单" header
	oldFont, _, _ := _procSelectObject.Call(hdc, p.hFontTitle)
	_procSetTextColor.Call(hdc, uintptr(COLOR_CYAN))
	headerRect := RECT{0, *y, POPUP_W, *y + 22}
	drawTextW(hdc, "───── 新订单 ─────", &headerRect, _DT_CENTER|_DT_VCENTER|_DT_SINGLELINE)
	*y += 24

	// Game & Amount
	_procSelectObject.Call(hdc, p.hFontBody)
	_procSetTextColor.Call(hdc, uintptr(COLOR_WHITE))

	gameText := "游戏: " + order.Game
	gameRect := RECT{int32(PAD_X + 8), *y, POPUP_W - int32(PAD_X + 8), *y + 20}
	drawTextW(hdc, gameText, &gameRect, _DT_VCENTER|_DT_SINGLELINE)
	*y += 20

	amountText := "金额: " + order.Amount
	amtRect := RECT{int32(PAD_X + 8), *y, POPUP_W - int32(PAD_X + 8), *y + 20}
	drawTextW(hdc, amountText, &amtRect, _DT_VCENTER|_DT_SINGLELINE)
	*y += 22

	// Action buttons
	btnW := int32(110)
	btnH := int32(32)
	gap := int32(8)
	totalW := btnW*2 + gap
	startX := (POPUP_W - totalW) / 2
	btnY := *y

	// Confirm button (cyan)
	p.btnConfirm = RECT{startX, btnY, startX + btnW, btnY + btnH}
	_procSelectObject.Call(hdc, p.hFontBtn)
	gdiFillRoundedRect(hdc, &p.btnConfirm, 4, p.hCyanBrush)
	_procSetTextColor.Call(hdc, uintptr(COLOR_BG_DARK))
	drawTextW(hdc, "✅ 确认", &p.btnConfirm, _DT_CENTER|_DT_VCENTER|_DT_SINGLELINE)

	// Ignore button (gray)
	p.btnIgnore = RECT{startX + btnW + gap, btnY, startX + btnW + gap + btnW, btnY + btnH}
	gdiFillRoundedRect(hdc, &p.btnIgnore, 4, p.hGrayBrush)
	_procSetTextColor.Call(hdc, uintptr(COLOR_WHITE))
	drawTextW(hdc, "⏭ 忽略", &p.btnIgnore, _DT_CENTER|_DT_VCENTER|_DT_SINGLELINE)

	_procSelectObject.Call(hdc, oldFont)
	*y = btnY + btnH + 6
}

func (p *PopupWindow) drawModeButton(hdc uintptr, mode engine.Mode, y int32) RECT {
	btnW := int32(220)
	btnH := int32(34)
	btnX := (POPUP_W - btnW) / 2
	btnY := y

	rect := RECT{btnX, btnY, btnX + btnW, btnY + btnH}

	oldFont, _, _ := _procSelectObject.Call(hdc, p.hFontBtn)

	var text string
	var brush uintptr
	if mode == engine.ModeWork {
		text = "🟢 切换娱乐模式"
		brush = p.hGreenBrush
	} else {
		text = "🔴 切换接单模式"
		brush = p.hPinkBrush
	}

	gdiFillRoundedRect(hdc, &rect, 6, brush)
	_procSetTextColor.Call(hdc, uintptr(COLOR_WHITE))
	drawTextW(hdc, text, &rect, _DT_CENTER|_DT_VCENTER|_DT_SINGLELINE)

	_procSelectObject.Call(hdc, oldFont)

	// Stretch click target a few px for usability.
	rect.Left -= 4
	rect.Right += 4
	rect.Top -= 2
	rect.Bottom += 2

	return rect
}

func (p *PopupWindow) drawFooter(hdc uintptr) {
	oldFont, _, _ := _procSelectObject.Call(hdc, p.hFontSmall)
	defer _procSelectObject.Call(hdc, oldFont)

	_procSetTextColor.Call(hdc, uintptr(COLOR_SLATE))
	footerText := fmt.Sprintf("v2.0 · %s", p.username)
	footerRect := RECT{0, POPUP_H - 24, POPUP_W, POPUP_H - 4}
	drawTextW(hdc, footerText, &footerRect, _DT_CENTER|_DT_VCENTER|_DT_SINGLELINE)
}

// ── Click handling ──

func (p *PopupWindow) handleClick(clickX, clickY int32) {
	if p.pointInRect(clickX, clickY, p.btnMode) {
		p.performModeSwitch()
		return
	}

	p.orderMu.Lock()
	hasOrder := p.currentOrder != nil
	p.orderMu.Unlock()

	if hasOrder {
		if p.pointInRect(clickX, clickY, p.btnConfirm) {
			p.performConfirmOrder()
		} else if p.pointInRect(clickX, clickY, p.btnIgnore) {
			p.performIgnoreOrder()
		}
	}
}

func (p *PopupWindow) pointInRect(x, y int32, r RECT) bool {
	return x >= r.Left && x <= r.Right && y >= r.Top && y <= r.Bottom
}

func (p *PopupWindow) performModeSwitch() {
	mode, _, _, _ := p.tracker.GetSnapshot()
	var newMode engine.Mode
	var status string

	if mode == engine.ModeWork {
		newMode = engine.ModeEntertainment
		status = "IDLE"
	} else {
		newMode = engine.ModeWork
		status = "ONLINE"
	}

	p.tracker.SwitchMode(newMode)
	p.wsClient.SendStatus(status, newMode)
	log.Printf("Popup: mode switched to %s", newMode)

	// Update global mode so tray context menu stays in sync.
	appCurrentMode = newMode

	_procInvalidateRect.Call(p.hwnd, 0, 1)
}

func (p *PopupWindow) performConfirmOrder() {
	log.Println("Popup: confirming order")
	p.wsClient.ConfirmOrder()
	p.clearOrderAndRefresh()
}

func (p *PopupWindow) performIgnoreOrder() {
	log.Println("Popup: ignoring order")
	wsclient.ClearCurrentOrder()
	p.clearOrderAndRefresh()
}

func (p *PopupWindow) clearOrderAndRefresh() {
	p.orderMu.Lock()
	p.currentOrder = nil
	p.orderMu.Unlock()
	_procInvalidateRect.Call(p.hwnd, 0, 1)
}

// ── GDI helpers ──

func gdiFillRect(hdc uintptr, r *RECT, brush uintptr) {
	_procFillRect.Call(hdc, uintptr(unsafe.Pointer(r)), brush)
}

// gdiFillRoundedRect fills a rounded rectangle with the given brush.
// (Named differently from icon.go's fillRoundedRect which operates on pixel arrays.)
func gdiFillRoundedRect(hdc uintptr, r *RECT, radius int32, brush uintptr) {
	oldBrush, _, _ := _procSelectObject.Call(hdc, brush)
	nullPen, _, _ := _procGetStockObject.Call(_NULL_PEN)
	oldPen, _, _ := _procSelectObject.Call(hdc, nullPen)
	_procRoundRect.Call(hdc, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right), uintptr(r.Bottom), uintptr(radius), uintptr(radius))
	_procSelectObject.Call(hdc, oldBrush)
	_procSelectObject.Call(hdc, oldPen)
}

// ── Utility ──

func formatDuration(seconds int64) string {
	if seconds < 0 {
		seconds = 0
	}
	h := seconds / 3600
	m := (seconds % 3600) / 60
	s := seconds % 60
	return fmt.Sprintf("%02d:%02d:%02d", h, m, s)
}

func stringField(m map[string]interface{}, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			if s, ok := v.(string); ok {
				return s
			}
		}
	}
	return ""
}

func formatAmount(m map[string]interface{}) string {
	keys := []string{"amount", "price", "totalAmount", "totalPrice", "total_price"}
	for _, k := range keys {
		if v, ok := m[k]; ok {
			switch n := v.(type) {
			case float64:
				return fmt.Sprintf("¥%.2f", n)
			case string:
				return "¥" + n
			}
		}
	}
	return "¥0.00"
}
