package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/chunlv/agent/internal/config"
	"github.com/chunlv/agent/internal/engine"
	"github.com/chunlv/agent/internal/httplocal"
	"github.com/chunlv/agent/internal/netctrl"
	"github.com/chunlv/agent/internal/sysctrl"
	"github.com/chunlv/agent/internal/wsclient"
)

func main() {
	cfg := config.Load()
	config.Update(cfg)

	log.Printf("Chunlv Agent starting...")
	log.Printf("  Server: %s", cfg.ServerURL)

	wsClient := wsclient.NewClient(cfg.ServerURL, cfg.Token, engine.NewTimeTracker())
	go wsClient.Connect()

	// 配置变更回调：断开旧连接，用新配置重连
	onReconfig := func(newCfg config.AgentConfig) {
		log.Printf("Config changed, reconnecting to %s", newCfg.ServerURL)
		wsClient.Disconnect()
		wsClient = wsclient.NewClient(newCfg.ServerURL, newCfg.Token, engine.NewTimeTracker())
		go wsClient.Connect()
	}

	go httplocal.StartServer(":9876", engine.NewTimeTracker(), wsClient, onReconfig)

	log.Println("Chunlv Agent started")
	log.Println("  Local UI: http://localhost:9876")

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	for {
		select {
		case sig := <-sigChan:
			log.Printf("Received signal %v, shutting down...", sig)
			wsClient.Disconnect()
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
