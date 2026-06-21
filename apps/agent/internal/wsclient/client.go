package wsclient

import (
	"encoding/json"
	"log"
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
		if !ok || event != "pc:command" {
			continue
		}
		dataBytes, _ := json.Marshal(raw[1])
		var cmd Command
		if json.Unmarshal(dataBytes, &cmd) == nil {
			c.CommandChan <- cmd
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

func (c *Client) Disconnect() {
	close(c.done)
	if c.conn != nil {
		c.conn.Close()
	}
}
