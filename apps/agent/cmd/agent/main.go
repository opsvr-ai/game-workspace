package main

import (
	"log"

	"github.com/chunlv/agent/internal/config"
	"github.com/chunlv/agent/internal/engine"
	"github.com/chunlv/agent/internal/httplocal"
	"github.com/chunlv/agent/internal/tray"
	"github.com/chunlv/agent/internal/wsclient"
)

func main() {
	cfg := config.Load()
	config.Update(cfg)

	log.Printf("Chunlv Agent starting...")
	log.Printf("  Server: %s", cfg.ServerURL)

	tracker := engine.NewTimeTracker()
	wsClient := wsclient.NewClient(cfg.ServerURL, cfg.Token, tracker)

	// onReconfig is called when the user saves new config via the settings page.
	// It disconnects the old WS connection and creates a new one with updated credentials.
	onReconfig := func(newCfg config.AgentConfig) {
		log.Printf("Config changed, reconnecting to %s", newCfg.ServerURL)
		wsClient.Disconnect()
		wsClient = wsclient.NewClient(newCfg.ServerURL, newCfg.Token, tracker)
		go wsClient.Connect()
	}

	// Wrap httplocal.StartAsync to match the function signature expected by tray.Start.
	httpStart := func(addr string, tracker *engine.TimeTracker, wsClient *wsclient.Client, onReconfig func(config.AgentConfig)) {
		httplocal.StartAsync(addr, tracker, wsClient, onReconfig)
	}

	// Start the system tray — this blocks until the user quits.
	tray.Start(":9876", tracker, wsClient, httpStart, onReconfig)
}
