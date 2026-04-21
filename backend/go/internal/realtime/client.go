package realtime

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Client struct {
	conn      *websocket.Conn
	done      chan struct{}
	playerID  string
	roomID    string
	send      chan []byte
	closeOnce sync.Once
}

func newClient(conn *websocket.Conn, roomID string, playerID string) *Client {
	return &Client{
		conn:     conn,
		done:     make(chan struct{}),
		playerID: normalizeID(playerID, "guest"),
		roomID:   normalizeID(roomID, "global"),
		send:     make(chan []byte, outboundBufferSize),
	}
}

func (c *Client) Close() {
	c.closeOnce.Do(func() {
		close(c.done)
		_ = c.conn.Close()
	})
}

func (c *Client) Enqueue(message []byte) {
	select {
	case <-c.done:
		return
	case c.send <- message:
		return
	default:
	}

	select {
	case <-c.done:
		return
	case <-c.send:
	default:
	}

	select {
	case <-c.done:
	case c.send <- message:
	default:
	}
}

func (c *Client) ReadPump(onPosition func(PositionMessage), onDisconnect func()) {
	defer onDisconnect()

	c.conn.SetReadLimit(maxIncomingMessageBytes)
	_ = c.conn.SetReadDeadline(time.Now().Add(2 * pingPeriod))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(2 * pingPeriod))
	})

	for {
		_, payload, err := c.conn.ReadMessage()
		if err != nil {
			return
		}

		var message PositionMessage
		if err := json.Unmarshal(payload, &message); err != nil {
			continue
		}

		onPosition(message)
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Close()
	}()

	for {
		select {
		case <-c.done:
			_ = c.conn.SetWriteDeadline(time.Now().Add(clientWriteWait))
			_ = c.conn.WriteMessage(websocket.CloseMessage, nil)
			return
		case message := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(clientWriteWait))
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(clientWriteWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
