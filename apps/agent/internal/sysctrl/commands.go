package sysctrl

import "os/exec"

func Shutdown() error {
	return exec.Command("shutdown", "/s", "/t", "0").Run()
}

func Restart() error {
	return exec.Command("shutdown", "/r", "/t", "0").Run()
}
