package wsclient

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chunlv/agent/internal/config"
	"github.com/chunlv/agent/internal/engine"
	"github.com/gorilla/websocket"
)

type CommandParams struct {
	LimitKB int `json:"limitKB"`
}

type Command struct {
	Command string        `json:"command"`
	Params  CommandParams `json:"params"`
}

// Shared order storage — written by readLoop, read by httplocal API.
var (
	latestOrderMu    sync.RWMutex
	latestOrderBytes []byte
	currentOrderID   string
)

// OrderMeta extracts the order ID from raw JSON.
type OrderMeta struct {
	ID interface{} `json:"id"`
}

// extractOrderID tries to parse an order ID from raw JSON bytes.
func extractOrderID(raw json.RawMessage) string {
	var meta OrderMeta
	if err := json.Unmarshal(raw, &meta); err != nil {
		return ""
	}
	switch v := meta.ID.(type) {
	case string:
		return v
	case float64:
		return strings.TrimRight(strings.TrimRight(strconv.FormatFloat(v, 'f', -1, 64), "0"), ".")
	default:
		return ""
	}
}

// SetLatestOrder stores the raw JSON bytes of the most recent order.
// Called from readLoop when an order:new event arrives.
func SetLatestOrder(raw json.RawMessage) {
	latestOrderMu.Lock()
	defer latestOrderMu.Unlock()
	latestOrderBytes = raw
	currentOrderID = extractOrderID(raw)
}

// GetLatestOrder returns the raw JSON bytes of the most recent order, or nil.
// Called from httplocal to serve /api/orders/latest.
func GetLatestOrder() json.RawMessage {
	latestOrderMu.RLock()
	defer latestOrderMu.RUnlock()
	if latestOrderBytes == nil {
		return nil
	}
	return latestOrderBytes
}

// GetCurrentOrderID returns the ID of the current active order, or empty string.
func GetCurrentOrderID() string {
	latestOrderMu.RLock()
	defer latestOrderMu.RUnlock()
	return currentOrderID
}

type Client struct {
	serverURL string
	username  string
	password  string
	token     string
	tracker   *engine.TimeTracker
	conn      *websocket.Conn
	CommandChan chan Command
	done      chan struct{}
	writeMu   sync.Mutex     // protects conn writes
	cancel    chan struct{}  // signals heartbeatLoop to exit on reconnect
}

func NewClient(serverURL, username, password string, tracker *engine.TimeTracker) *Client {
	return &Client{
		serverURL:   serverURL,
		username:    username,
		password:    password,
		tracker:     tracker,
		CommandChan: make(chan Command, 10),
		done:        make(chan struct{}),
		cancel:      make(chan struct{}),
	}
}

// Login 用账号密码登录服务端，获取 JWT Token
func (c *Client) Login() error {
	body, _ := json.Marshal(map[string]string{
		"username": c.username,
		"password": c.password,
	})
	resp, err := http.Post(c.serverURL+"/api/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var result struct {
		Code int `json:"code"`
		Data struct {
			AccessToken string `json:"accessToken"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return err
	}
	if result.Code != 200 {
		return fmt.Errorf("login failed: %s", result.Message)
	}
	c.token = result.Data.AccessToken
	c.password = "" // 登录成功后清除明文密码，仅保留 Token
	config.SetToken(c.token)
	log.Printf("Login OK — welcome %s", c.username)
	return nil
}

func (c *Client) Connect() {
	// 先登录获取 Token
	for {
		if err := c.Login(); err != nil {
			log.Printf("Login failed: %v, retrying in 5s...", err)
			time.Sleep(5 * time.Second)
			continue
		}
		break
	}

	// Normalize URL scheme: gorilla/websocket expects ws:// or wss://
	serverURL := c.serverURL
	serverURL = strings.Replace(serverURL, "http://", "ws://", 1)
	serverURL = strings.Replace(serverURL, "https://", "wss://", 1)

	for {
		// 通知旧的 heartbeatLoop 退出
		if c.cancel != nil {
			close(c.cancel)
		}
		c.cancel = make(chan struct{})

		url := serverURL + "/socket.io/?EIO=4&transport=websocket&token=" + c.token
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		if err != nil {
			log.Printf("WebSocket connection failed: %v, retrying in 5s...", err)
			time.Sleep(5 * time.Second)
			continue
		}
		c.conn = conn
		log.Println("WebSocket connected")

		go c.heartbeatLoop(c.cancel)
		c.readLoop()

		// 连接断开，清理
		c.writeMu.Lock()
		c.conn = nil
		c.writeMu.Unlock()

		select {
		case <-c.done:
			return
		default:
			log.Println("Connection lost, reconnecting in 5s...")
			time.Sleep(5 * time.Second)
		}
	}
}

func (c *Client) heartbeatLoop(cancel <-chan struct{}) {
	// 首次启动立即通过 REST 注册，让服务端能看到客户端
	go c.sendRestHeartbeat()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-c.done:
			return
		case <-cancel:
			return // reconnect requested
		case <-ticker.C:
			// REST 心跳（可靠），让服务端感知在线状态
			go c.sendRestHeartbeat()
			// WebSocket 心跳（实时数据）
			mode, workSec, entertainSec, totalSec := c.tracker.GetSnapshot()
			data := map[string]interface{}{
				"mode":          mode,
				"workSec":       workSec,
				"entertainSec":  entertainSec,
				"totalSec":      totalSec,
				"timestamp":     time.Now().Unix(),
			}
			c.emit("companion:heartbeat", data)
		}
	}
}

// sendRestHeartbeat 通过 REST API 上报心跳，注册 Agent 在线状态
func (c *Client) sendRestHeartbeat() {
	mode, workSec, _, _ := c.tracker.GetSnapshot()
	body, _ := json.Marshal(map[string]interface{}{
		"agentVersion": "2.0.0",
		"currentMode":  string(mode),
		"workSec":      workSec,
	})

	req, err := http.NewRequest("POST", c.serverURL+"/api/companions/agent-heartbeat", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("REST heartbeat failed: %v", err)
		return
	}
	resp.Body.Close()
	if resp.StatusCode == 200 {
		log.Println("REST heartbeat OK — agent registered with server")
	}
}

func (c *Client) readLoop() {
	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			return
		}

		// Parse Socket.IO protocol: 42["event",{...}]
		var raw []interface{}
		if err := json.Unmarshal(msg, &raw); err != nil || len(raw) < 2 {
			continue
		}
		event, ok := raw[0].(string)
		if !ok {
			continue
		}
		switch event {
		case "pc:command":
			dataBytes, _ := json.Marshal(raw[1])
			var cmd Command
			if json.Unmarshal(dataBytes, &cmd) == nil {
				c.CommandChan <- cmd
			}
		case "order:new":
			dataBytes, _ := json.Marshal(raw[1])
			log.Printf("Received order:new: %s", string(dataBytes))
			SetLatestOrder(dataBytes)
		}
	}
}

func (c *Client) emit(event string, data interface{}) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}
	payload, _ := json.Marshal([]interface{}{event, data})
	msg := "42" + string(payload)
	return c.conn.WriteMessage(websocket.TextMessage, []byte(msg))
}

func (c *Client) SendAck(command string, success bool) {
	c.emit("pc:command_ack", map[string]interface{}{
		"command": command,
		"success": success,
	})
}

func (c *Client) SendStatus(status string, mode engine.Mode) {
	c.emit("companion:status", map[string]interface{}{
		"status": status,
		"mode":   string(mode),
	})
}

// ConfirmOrder emits an order:confirm event with the latest order ID.
// If no order is present, the call is a no-op.
func (c *Client) ConfirmOrder() {
	id := GetCurrentOrderID()
	if id == "" {
		log.Println("ConfirmOrder: no active order to confirm")
		return
	}
	log.Printf("ConfirmOrder: confirming order %s", id)
	c.emit("order:confirm", map[string]interface{}{
		"orderId": id,
	})
	// Clear the current order after action
	ClearCurrentOrder()
}

// CompleteOrder emits an order:complete event with the latest order ID.
// If no order is present, the call is a no-op.
func (c *Client) CompleteOrder() {
	id := GetCurrentOrderID()
	if id == "" {
		log.Println("CompleteOrder: no active order to complete")
		return
	}
	log.Printf("CompleteOrder: completing order %s", id)
	c.emit("order:complete", map[string]interface{}{
		"orderId": id,
	})
	// Clear the current order after action
	ClearCurrentOrder()
}

// ClearCurrentOrder clears the stored current order.
func ClearCurrentOrder() {
	latestOrderMu.Lock()
	defer latestOrderMu.Unlock()
	latestOrderBytes = nil
	currentOrderID = ""
}

func (c *Client) Disconnect() {
	close(c.done)
	if c.cancel != nil {
		close(c.cancel)
	}
	c.writeMu.Lock()
	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}
	c.writeMu.Unlock()
}
