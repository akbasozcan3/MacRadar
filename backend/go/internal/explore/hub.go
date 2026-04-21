package explore

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

const (
	clientWriteWait = 10 * time.Second
	pingPeriod      = 20 * time.Second
	redisExploreChannel = "macradar:explore"
)

type Client struct {
	conn *websocket.Conn
	send chan []byte
}

func (c *Client) Enqueue(message []byte) {
	select {
	case c.send <- message:
		return
	default:
	}

	// Drop the oldest buffered event and keep the latest payload.
	select {
	case <-c.send:
	default:
	}

	select {
	case c.send <- message:
	default:
	}
}

func (c *Client) ReadPump(onDisconnect func()) {
	defer onDisconnect()
	c.conn.SetReadLimit(2048)
	_ = c.conn.SetReadDeadline(time.Now().Add(2 * pingPeriod))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(2 * pingPeriod))
	})

	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(clientWriteWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, nil)
				return
			}

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

type Hub struct {
	clients map[*Client]struct{}
	logger  *slog.Logger
	redis   *redis.Client
	mu      sync.RWMutex
}

func NewHub(logger *slog.Logger, redisClient *redis.Client) *Hub {
	h := &Hub{
		clients: make(map[*Client]struct{}),
		logger:  logger,
		redis:   redisClient,
	}

	if redisClient != nil {
		go h.listenRedis()
	}

	return h
}

func (h *Hub) listenRedis() {
	pubsub := h.redis.Subscribe(context.Background(), redisExploreChannel)
	defer pubsub.Close()

	ch := pubsub.Channel()
	for msg := range ch {
		h.mu.RLock()
		for client := range h.clients {
			client.Enqueue([]byte(msg.Payload))
		}
		h.mu.RUnlock()
	}
}

func (h *Hub) Register(conn *websocket.Conn) *Client {
	client := &Client{
		conn: conn,
		send: make(chan []byte, 32),
	}

	h.mu.Lock()
	h.clients[client] = struct{}{}
	h.mu.Unlock()

	return client
}

func (h *Hub) Unregister(client *Client) {
	h.mu.Lock()
	if _, ok := h.clients[client]; ok {
		delete(h.clients, client)
		close(client.send)
	}
	h.mu.Unlock()
}

func (h *Hub) Broadcast(event RealtimeEvent) {
	payload, err := json.Marshal(event)
	if err != nil {
		h.logger.Error("failed to marshal websocket event", slog.Any("error", err))
		return
	}

	if h.redis != nil {
		h.redis.Publish(context.Background(), redisExploreChannel, payload)
		return
	}

	h.mu.RLock()
	for client := range h.clients {
		client.Enqueue(payload)
	}
	h.mu.RUnlock()
}
