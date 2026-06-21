package netctrl

import (
	"fmt"
	"os/exec"
)

func SetThrottle(limitKB int) error {
	bitsPerSecond := limitKB * 1000 * 8
	cmd := exec.Command("powershell", "-Command",
		fmt.Sprintf(
			"New-NetQosPolicy -Name 'ChunlvThrottle' -ThrottleRateActionBitsPerSecond %d -ErrorAction SilentlyContinue",
			bitsPerSecond,
		),
	)
	return cmd.Run()
}

func RemoveThrottle() error {
	cmd := exec.Command("powershell", "-Command",
		"Remove-NetQosPolicy -Name 'ChunlvThrottle' -Confirm:$false -ErrorAction SilentlyContinue",
	)
	return cmd.Run()
}
