package config

import (
	"encoding/json"
	"os"
	"sync"
)

type AgentConfig struct {
	ServerURL string `json:"serverUrl"`
	Token     string `json:"token"`
}

var (
	cfg     AgentConfig
	mu      sync.RWMutex
	path    = "agent-config.json"
)

func Load() AgentConfig {
	mu.RLock()
	defer mu.RUnlock()

	// 1. Try config file
	if data, err := os.ReadFile(path); err == nil {
		var c AgentConfig
		if json.Unmarshal(data, &c) == nil && c.ServerURL != "" && c.Token != "" {
			return c
		}
	}

	// 2. Fallback to env vars
	return AgentConfig{
		ServerURL: getEnv("AGENT_SERVER_URL", "http://localhost:3001"),
		Token:     getEnv("AGENT_TOKEN", ""),
	}
}

func Save(c AgentConfig) error {
	mu.Lock()
	defer mu.Unlock()

	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

func Get() AgentConfig {
	mu.RLock()
	defer mu.RUnlock()
	return cfg
}

func Update(c AgentConfig) {
	mu.Lock()
	defer mu.Unlock()
	cfg = c
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
