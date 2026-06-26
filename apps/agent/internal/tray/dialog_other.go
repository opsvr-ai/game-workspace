//go:build !windows

package tray

// showModeSwitchDialog on non-Windows platforms toggles silently
// and always returns true (no native dialog available).
func showModeSwitchDialog(currentModeName, targetModeName string) bool {
	// No native dialog on this platform — switch directly.
	return true
}
