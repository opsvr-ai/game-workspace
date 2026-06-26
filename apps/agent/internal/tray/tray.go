package tray

import (
	"log"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"

	"github.com/chunlv/agent/internal/config"
	"github.com/chunlv/agent/internal/engine"
	"github.com/chunlv/agent/internal/netctrl"
	"github.com/chunlv/agent/internal/sysctrl"
	"github.com/chunlv/agent/internal/wsclient"
	"github.com/getlantern/systray"
)

// Start launches the system tray icon and blocks until the user quits.
//
// Parameters:
//   - addr: local HTTP server address (e.g. ":9876")
//   - tracker: shared time tracker for mode switching and status
//   - wsClient: shared WebSocket client for server communication
//   - httpStart: function that starts the local HTTP server (non-blocking)
//   - onReconfig: called when config is saved via the settings page, triggers reconnect
func Start(
	addr string,
	tracker *engine.TimeTracker,
	wsClient *wsclient.Client,
	httpStart func(addr string, tracker *engine.TimeTracker, wsClient *wsclient.Client, onReconfig func(config.AgentConfig)),
	onReconfig func(config.AgentConfig),
) {
	systray.Run(func() { onReady(addr, tracker, wsClient, httpStart, onReconfig) }, onExit(wsClient))
}

func onReady(
	addr string,
	tracker *engine.TimeTracker,
	wsClient *wsclient.Client,
	httpStart func(addr string, tracker *engine.TimeTracker, wsClient *wsclient.Client, onReconfig func(config.AgentConfig)),
	onReconfig func(config.AgentConfig),
) {
	icon := generateIcon()
	systray.SetIcon(icon)
	systray.SetTitle("Chunlv Agent")
	systray.SetTooltip("蠢驴电竞 - 陪玩师客户端")

	// ── Menu items ──
	mSwitch := systray.AddMenuItem("切换为接单模式", "在接单/娱乐模式之间切换")
	systray.AddSeparator()
	mSettings := systray.AddMenuItem("打开设置...", "配置服务器地址和Token")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("退出", "退出客户端")

	// ── Start background services ──
	go wsClient.Connect()
	go httpStart(addr, tracker, wsClient, onReconfig)
	go commandLoop(wsClient)

	log.Println("Agent running in system tray (right-click for menu)")

	// ── Menu event loop ──
	currentMode := engine.ModeEntertainment

	for {
		select {
		case <-mSwitch.ClickedCh:
			// Toggle mode
			var newMode engine.Mode
			var status string
			if currentMode == engine.ModeWork {
				newMode = engine.ModeEntertainment
				status = "IDLE"
				mSwitch.SetTitle("切换为接单模式")
			} else {
				newMode = engine.ModeWork
				status = "ONLINE"
				mSwitch.SetTitle("切换为娱乐模式")
			}
			currentMode = newMode
			tracker.SwitchMode(newMode)
			wsClient.SendStatus(status, newMode)
			log.Printf("Mode switched to %s", newMode)

		case <-mSettings.ClickedCh:
			// Open browser to settings page
			openBrowser("http://localhost:9876")

		case <-mQuit.ClickedCh:
			log.Println("Quit requested from tray menu")
			systray.Quit()
			return
		}
	}
}

// onExit returns a cleanup function called when systray shuts down.
func onExit(wsClient *wsclient.Client) func() {
	return func() {
		log.Println("Shutting down agent...")
		wsClient.Disconnect()
	}
}

// commandLoop reads commands from the WebSocket client and dispatches them.
// This mirrors the command dispatch that was in main.go.
func commandLoop(wsClient *wsclient.Client) {
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	for {
		select {
		case sig := <-sigChan:
			log.Printf("Received signal %v, shutting down...", sig)
			systray.Quit()
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
