package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/chunlv/agent/internal/engine"
	"github.com/chunlv/agent/internal/httplocal"
	"github.com/chunlv/agent/internal/netctrl"
	"github.com/chunlv/agent/internal/sysctrl"
	"github.com/chunlv/agent/internal/wsclient"
)

func main() {
	serverURL := getEnv("AGENT_SERVER_URL", "http://localhost:3001")
	token := getEnv("AGENT_TOKEN", "")

	tracker := engine.NewTimeTracker()
	wsClient := wsclient.NewClient(serverURL, token, tracker)

	go wsClient.Connect()
	go httplocal.StartServer(":9876", tracker, wsClient)

	log.Println("Chunlv Agent started")
	log.Printf("  Server: %s", serverURL)
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

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
