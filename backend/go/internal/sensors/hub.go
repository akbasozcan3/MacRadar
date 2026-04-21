package sensors

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	sensorClientWriteWait               = 10 * time.Second
	sensorMaxIncomingMessageBytes int64 = 8192
	sensorOutboundBufferSize            = 256
	sensorPingPeriod                    = 20 * time.Second
	sensorSnapshotLimit                 = 24
)

type Client struct {
	conn      *websocket.Conn
	done      chan struct{}
	send      chan []byte
	closeOnce sync.Once
}

func newClient(conn *websocket.Conn) *Client {
	return &Client{
		conn: conn,
		done: make(chan struct{}),
		send: make(chan []byte, sensorOutboundBufferSize),
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

func (c *Client) ReadPump(onMessage func([]byte), onDisconnect func()) {
	defer onDisconnect()

	c.conn.SetReadLimit(sensorMaxIncomingMessageBytes)
	_ = c.conn.SetReadDeadline(time.Now().Add(2 * sensorPingPeriod))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(2 * sensorPingPeriod))
	})

	for {
		_, payload, err := c.conn.ReadMessage()
		if err != nil {
			return
		}

		onMessage(payload)
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(sensorPingPeriod)
	defer func() {
		ticker.Stop()
		c.Close()
	}()

	for {
		select {
		case <-c.done:
			_ = c.conn.SetWriteDeadline(time.Now().Add(sensorClientWriteWait))
			_ = c.conn.WriteMessage(websocket.CloseMessage, nil)
			return
		case message := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(sensorClientWriteWait))
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(sensorClientWriteWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

type Hub struct {
	logger *slog.Logger

	mu           sync.RWMutex
	clients      map[*Client]struct{}
	lastByDevice map[string]Event
}

func NewHub(logger *slog.Logger) *Hub {
	return &Hub{
		logger:       logger,
		clients:      make(map[*Client]struct{}),
		lastByDevice: make(map[string]Event),
	}
}

func (h *Hub) Register(conn *websocket.Conn) *Client {
	client := newClient(conn)

	h.mu.Lock()
	h.clients[client] = struct{}{}
	h.mu.Unlock()

	return client
}

func (h *Hub) Unregister(client *Client) {
	h.mu.Lock()
	delete(h.clients, client)
	h.mu.Unlock()

	client.Close()
}

func (h *Hub) Send(client *Client, payload any) {
	message, ok := h.marshalPayload(payload)
	if !ok {
		return
	}
	client.Enqueue(message)
}

func (h *Hub) Broadcast(event Event) {
	normalized := NormalizeEvent(event, event.Reading.UserID, event.Source)
	if normalized.Type == EventTypeReading && normalized.Reading.DeviceID != "" {
		h.mu.Lock()
		h.lastByDevice[normalized.Reading.DeviceID] = normalized
		h.mu.Unlock()
	}

	message, ok := h.marshalPayload(normalized)
	if !ok {
		return
	}

	h.mu.RLock()
	for client := range h.clients {
		client.Enqueue(message)
	}
	h.mu.RUnlock()
}

func (h *Hub) Snapshot(limit int) []Event {
	if limit <= 0 {
		limit = sensorSnapshotLimit
	}
	if limit > 200 {
		limit = 200
	}

	h.mu.RLock()
	items := make([]Event, 0, len(h.lastByDevice))
	for _, item := range h.lastByDevice {
		items = append(items, item)
	}
	h.mu.RUnlock()

	if len(items) > limit {
		return items[:limit]
	}

	return items
}

func (h *Hub) marshalPayload(payload any) ([]byte, bool) {
	message, err := json.Marshal(payload)
	if err != nil {
		if h.logger != nil {
			h.logger.Error("sensor payload marshal failed", slog.Any("error", err))
		}
		return nil, false
	}

	return message, true
}
