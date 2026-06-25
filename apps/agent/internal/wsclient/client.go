package wsclient

import (
	"encoding/json"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

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
	serverURL   string
	token       string
	tracker     *engine.TimeTracker
	conn        *websocket.Conn
	CommandChan chan Command
	done        chan struct{}
}

func NewClient(serverURL, token string, tracker *engine.TimeTracker) *Client {
	return &Client{
		serverURL:   serverURL,
		token:       token,
		tracker:     tracker,
		CommandChan: make(chan Command, 10),
		done:        make(chan struct{}),
	}
}

func (c *Client) Connect() {
	for {
		url := c.serverURL + "/socket.io/?EIO=4&transport=websocket"
		conn, _, err := websocket.DefaultDialer.Dial(url, nil)
		if err != nil {
			log.Printf("WebSocket connection failed: %v, retrying in 5s...", err)
			time.Sleep(5 * time.Second)
			continue
		}
		c.conn = conn
		log.Println("WebSocket connected")

		// Send auth
		authMsg := `40{"token":"` + c.token + `"}`
		conn.WriteMessage(websocket.TextMessage, []byte(authMsg))

		go c.heartbeatLoop()
		c.readLoop()

		select {
		case <-c.done:
			return
		default:
			log.Println("Connection lost, reconnecting in 5s...")
			time.Sleep(5 * time.Second)
		}
	}
}

func (c *Client) heartbeatLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-c.done:
			return
		case <-ticker.C:
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
	if c.conn != nil {
		c.conn.Close()
	}
}
