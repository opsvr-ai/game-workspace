package config

import (
	"encoding/json"
	"os"
	"sync"
)

type AgentConfig struct {
	ServerURL string `json:"serverUrl"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	Token     string `json:"token,omitempty"` // auto-login 后缓存
}

var (
	cfg  AgentConfig
	mu   sync.RWMutex
	path = "agent-config.json"
)

func Load() AgentConfig {
	mu.RLock()
	defer mu.RUnlock()

	// 1. Try config file
	if data, err := os.ReadFile(path); err == nil {
		var c AgentConfig
		if json.Unmarshal(data, &c) == nil && c.ServerURL != "" && c.Username != "" {
			return c
		}
	}

	// 2. Fallback to env vars
	return AgentConfig{
		ServerURL: getEnv("AGENT_SERVER_URL", "http://localhost:3001"),
		Username:  getEnv("AGENT_USERNAME", ""),
		Password:  getEnv("AGENT_PASSWORD", ""),
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

func SetToken(token string) {
	mu.Lock()
	defer mu.Unlock()
	cfg.Token = token
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
