package main

import (
	"log"

	"github.com/chunlv/agent/internal/config"
	"github.com/chunlv/agent/internal/engine"
	"github.com/chunlv/agent/internal/tray"
	"github.com/chunlv/agent/internal/wsclient"
)

func main() {
	cfg := config.Load()
	config.Update(cfg)

	log.Printf("Chunlv Agent starting...")
	log.Printf("  Server: %s", cfg.ServerURL)
	log.Printf("  User:   %s", cfg.Username)

	tracker := engine.NewTimeTracker()
	wsClient := wsclient.NewClient(cfg.ServerURL, cfg.Username, cfg.Password, tracker)

	onReconfig := func(newCfg config.AgentConfig) {
		log.Printf("Config changed, reconnecting to %s as %s", newCfg.ServerURL, newCfg.Username)
		wsClient.Disconnect()
		wsClient = wsclient.NewClient(newCfg.ServerURL, newCfg.Username, newCfg.Password, tracker)
		go wsClient.Connect()
	}

	tray.Run(tracker, wsClient, onReconfig)
}
