package messages

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
	clientWriteWait               = 10 * time.Second
	maxIncomingMessageBytes int64 = 4096
	outboundBufferSize            = 64
	pingPeriod                    = 20 * time.Second
	redisChannel                  = "macradar:messages"
)

type Client struct {
	conn      *websocket.Conn
	done      chan struct{}
	send      chan []byte
	userID    string
	closeOnce sync.Once
}

func newClient(conn *websocket.Conn, userID string) *Client {
	return &Client{
		conn:   conn,
		done:   make(chan struct{}),
		send:   make(chan []byte, outboundBufferSize),
		userID: userID,
	}
}

func (c *Client) UserID() string {
	return c.userID
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
		onMessage(payload)
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

type Hub struct {
	logger *slog.Logger
	redis  *redis.Client

	mu    sync.RWMutex
	users map[string]map[*Client]struct{}
}

func NewHub(logger *slog.Logger, redisClient *redis.Client) *Hub {
	h := &Hub{
		logger: logger,
		redis:  redisClient,
		users:  make(map[string]map[*Client]struct{}),
	}

	if redisClient != nil {
		go h.listenRedis()
	}

	return h
}

func (h *Hub) listenRedis() {
	pubsub := h.redis.Subscribe(context.Background(), redisChannel)
	defer pubsub.Close()

	ch := pubsub.Channel()
	for msg := range ch {
		var payload struct {
			UserIDs []string        `json:"userIDs"`
			Data    json.RawMessage `json:"data"`
		}

		if err := json.Unmarshal([]byte(msg.Payload), &payload); err != nil {
			if h.logger != nil {
				h.logger.Error("failed to unmarshal redis message", slog.Any("error", err))
			}
			continue
		}

		h.mu.RLock()
		for _, userID := range payload.UserIDs {
			for client := range h.users[userID] {
				client.Enqueue(payload.Data)
			}
		}
		h.mu.RUnlock()
	}
}

func (h *Hub) Register(conn *websocket.Conn, userID string) *Client {
	client := newClient(conn, userID)

	h.mu.Lock()
	if h.users[userID] == nil {
		h.users[userID] = make(map[*Client]struct{})
	}
	h.users[userID][client] = struct{}{}
	h.mu.Unlock()

	return client
}

func (h *Hub) Unregister(client *Client) {
	h.mu.Lock()
	if userClients, ok := h.users[client.userID]; ok {
		if _, exists := userClients[client]; exists {
			delete(userClients, client)
			if len(userClients) == 0 {
				delete(h.users, client.userID)
			}
		}
	}
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

func (h *Hub) BroadcastToUser(userID string, payload any) {
	if h.redis != nil {
		h.publishToRedis([]string{userID}, payload)
		return
	}

	message, ok := h.marshalPayload(payload)
	if !ok {
		return
	}

	h.mu.RLock()
	for client := range h.users[userID] {
		client.Enqueue(message)
	}
	h.mu.RUnlock()
}

func (h *Hub) BroadcastToUsers(userIDs []string, payload any) {
	if h.redis != nil {
		h.publishToRedis(userIDs, payload)
		return
	}

	message, ok := h.marshalPayload(payload)
	if !ok {
		return
	}

	h.mu.RLock()
	for _, userID := range userIDs {
		for client := range h.users[userID] {
			client.Enqueue(message)
		}
	}
	h.mu.RUnlock()
}

func (h *Hub) publishToRedis(userIDs []string, data any) {
	rawData, err := json.Marshal(data)
	if err != nil {
		return
	}

	payload := struct {
		UserIDs []string        `json:"userIDs"`
		Data    json.RawMessage `json:"data"`
	}{
		UserIDs: userIDs,
		Data:    rawData,
	}

	msg, _ := json.Marshal(payload)
	h.redis.Publish(context.Background(), redisChannel, msg)
}

func (h *Hub) marshalPayload(payload any) ([]byte, bool) {
	message, err := json.Marshal(payload)
	if err != nil {
		if h.logger != nil {
			h.logger.Error("messages payload marshal failed", slog.Any("error", err))
		}
		return nil, false
	}

	return message, true
}
