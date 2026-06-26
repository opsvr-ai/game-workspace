//go:build linux

package tray

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/chunlv/agent/internal/config"
	"github.com/chunlv/agent/internal/engine"
	"github.com/chunlv/agent/internal/wsclient"
)

// Run starts the agent without a system tray (Linux).
// It blocks until SIGINT or SIGTERM is received.
func Run(addr string, tracker *engine.TimeTracker, client *wsclient.Client,
	httpStart func(string, *engine.TimeTracker, *wsclient.Client, func(config.AgentConfig)),
	onReconfig func(config.AgentConfig)) {

	go client.Connect()
	httpStart(addr, tracker, client, onReconfig)

	log.Println("Agent running (Linux mode — no system tray)")
	log.Printf("  WebUI: http://localhost%s", addr)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("Shutting down...")
	client.Disconnect()
}
