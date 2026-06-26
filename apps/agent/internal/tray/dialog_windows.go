package tray

import (
	"fmt"
	"syscall"
	"unsafe"
)

// showModeSwitchDialog displays a native Windows MessageBox asking the user
// to confirm switching from currentModeName to targetModeName.
// Returns true if the user clicked Yes.
func showModeSwitchDialog(currentModeName, targetModeName string) bool {
	user32 := syscall.NewLazyDLL("user32.dll")
	msgBox := user32.NewProc("MessageBoxW")

	title := "切换模式"
	text := fmt.Sprintf("当前模式: %s\r\n是否切换到%s？", currentModeName, targetModeName)

	// MB_YESNO (4) | MB_ICONQUESTION (32) | MB_DEFBUTTON2 (256)
	const flags = 4 | 32 | 256

	ret, _, _ := msgBox.Call(
		0, // hWnd (NULL = no owner)
		uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr(text))),
		uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr(title))),
		uintptr(flags),
	)

	return ret == 6 // IDYES = 6, IDNO = 7
}
