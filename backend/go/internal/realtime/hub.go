package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

const redisRealtimeChannel = "macradar:realtime"

type Hub struct {
	clients          map[*Client]struct{}
	logger           *slog.Logger
	redis            *redis.Client
	mu               sync.RWMutex
	playerClients    map[string]map[string]*Client
	players          map[string]map[string]PositionMessage
	rooms            map[string]map[*Client]struct{}
	recorder         PositionRecorder
	service          *Service
	staleSweepTicker *time.Ticker
}

type PositionRecorder interface {
	RecordPosition(roomID string, payload PositionMessage)
}

func NewHub(logger *slog.Logger, redisClient *redis.Client, recorder PositionRecorder) *Hub {
	hub := &Hub{
		clients:       make(map[*Client]struct{}),
		logger:        logger,
		redis:         redisClient,
		playerClients: make(map[string]map[string]*Client),
		players:       make(map[string]map[string]PositionMessage),
		rooms:         make(map[string]map[*Client]struct{}),
		recorder:      recorder,
		service:       NewService(logger),
	}

	if redisClient != nil {
		go hub.listenRedis()
	}

	hub.startStaleSweep()
	return hub
}

func (h *Hub) listenRedis() {
	pubsub := h.redis.Subscribe(context.Background(), redisRealtimeChannel)
	defer pubsub.Close()

	ch := pubsub.Channel()
	for msg := range ch {
		var payload struct {
			RoomID string          `json:"roomID"`
			Data   json.RawMessage `json:"data"`
		}

		if err := json.Unmarshal([]byte(msg.Payload), &payload); err != nil {
			continue
		}

		h.mu.RLock()
		for client := range h.rooms[payload.RoomID] {
			client.Enqueue(payload.Data)
		}
		h.mu.RUnlock()
	}
}

func (h *Hub) Register(conn *websocket.Conn, roomID string, playerID string) *Client {
	client := newClient(conn, roomID, playerID)

	var replaced *Client

	h.mu.Lock()
	if h.rooms[client.roomID] == nil {
		h.rooms[client.roomID] = make(map[*Client]struct{})
	}
	if h.playerClients[client.roomID] == nil {
		h.playerClients[client.roomID] = make(map[string]*Client)
	}

	replaced = h.playerClients[client.roomID][client.playerID]
	if replaced != nil {
		h.removeClientLocked(replaced, false)
	}

	h.clients[client] = struct{}{}
	h.rooms[client.roomID][client] = struct{}{}
	h.playerClients[client.roomID][client.playerID] = client
	h.mu.Unlock()

	if replaced != nil {
		replaced.Close()
		h.logger.Info(
			"realtime_client_replaced",
			slog.String("player_id", client.playerID),
			slog.String("room_id", client.roomID),
		)
	}

	return client
}

func (h *Hub) Unregister(client *Client) {
	shouldBroadcastLeave := false

	h.mu.Lock()
	if _, ok := h.clients[client]; ok {
		current := h.playerClients[client.roomID][client.playerID]
		removePlayerState := current == client
		h.removeClientLocked(client, removePlayerState)
		shouldBroadcastLeave = removePlayerState
	}
	h.mu.Unlock()

	client.Close()

	if shouldBroadcastLeave {
		h.broadcastRoom(client.roomID, LeaveMessage{
			PlayerID:  client.playerID,
			RoomID:    client.roomID,
			Type:      messageTypeLeave,
			Timestamp: time.Now().UnixMilli(),
		}, client)
	}
}

func (h *Hub) HandlePosition(client *Client, payload PositionMessage) {
	var (
		next            PositionMessage
		shouldBroadcast bool
	)

	h.mu.Lock()
	previous := h.players[client.roomID][client.playerID]
	prepared, accepted, broadcast := h.service.PreparePositionUpdate(client, previous, payload)
	if accepted {
		if h.players[client.roomID] == nil {
			h.players[client.roomID] = make(map[string]PositionMessage)
		}
		h.players[client.roomID][client.playerID] = prepared
		next = prepared
		shouldBroadcast = broadcast
	}
	h.mu.Unlock()

	if !shouldBroadcast {
		return
	}
	if h.recorder != nil {
		h.recorder.RecordPosition(client.roomID, next)
	}

	h.broadcastRoom(client.roomID, next, client)
}

func (h *Hub) SendSnapshot(client *Client) {
	now := time.Now()

	h.mu.RLock()
	roomPlayers := h.players[client.roomID]
	players := make([]PositionMessage, 0, len(roomPlayers))
	for _, player := range roomPlayers {
		if player.PlayerID == client.playerID || isPositionStale(player, now) {
			continue
		}
		players = append(players, player)
	}
	h.mu.RUnlock()

	h.send(client, SnapshotMessage{
		Players:   players,
		RoomID:    client.roomID,
		Type:      messageTypeSnapshot,
		Timestamp: now.UnixMilli(),
	})
	h.send(client, AckMessage{
		PlayerID:  client.playerID,
		RoomID:    client.roomID,
		Type:      messageTypeAck,
		Timestamp: now.UnixMilli(),
	})
}

func (h *Hub) startStaleSweep() {
	h.staleSweepTicker = time.NewTicker(realtimeStaleSweepInterval)

	go func() {
		for now := range h.staleSweepTicker.C {
			h.evictStalePlayers(now)
		}
	}()
}

func (h *Hub) evictStalePlayers(now time.Time) {
	type stalePlayer struct {
		playerID string
		roomID   string
	}

	stalePlayers := make([]stalePlayer, 0)

	h.mu.Lock()
	for roomID, roomPlayers := range h.players {
		for playerID, position := range roomPlayers {
			if !isPositionStale(position, now) {
				continue
			}

			delete(roomPlayers, playerID)
			if roomClient, ok := h.playerClients[roomID][playerID]; ok {
				h.removeClientLocked(roomClient, false)
				roomClient.Close()
			}
			stalePlayers = append(stalePlayers, stalePlayer{
				playerID: playerID,
				roomID:   roomID,
			})
		}

		if len(roomPlayers) == 0 {
			delete(h.players, roomID)
		}
	}
	h.mu.Unlock()

	for _, stale := range stalePlayers {
		h.broadcastRoom(stale.roomID, LeaveMessage{
			PlayerID:  stale.playerID,
			RoomID:    stale.roomID,
			Type:      messageTypeLeave,
			Timestamp: now.UnixMilli(),
		}, nil)
	}
}

func (h *Hub) removeClientLocked(client *Client, removePlayerState bool) {
	delete(h.clients, client)

	if roomClients, ok := h.rooms[client.roomID]; ok {
		delete(roomClients, client)
		if len(roomClients) == 0 {
			delete(h.rooms, client.roomID)
		}
	}

	if roomPlayerClients, ok := h.playerClients[client.roomID]; ok {
		if roomPlayerClients[client.playerID] == client {
			delete(roomPlayerClients, client.playerID)
		}
		if len(roomPlayerClients) == 0 {
			delete(h.playerClients, client.roomID)
		}
	}

	if removePlayerState {
		if roomPlayers, ok := h.players[client.roomID]; ok {
			delete(roomPlayers, client.playerID)
			if len(roomPlayers) == 0 {
				delete(h.players, client.roomID)
			}
		}
	}
}

func (h *Hub) send(client *Client, payload any) {
	message, err := json.Marshal(payload)
	if err != nil {
		h.logger.Error("failed to marshal realtime payload", slog.Any("error", err))
		return
	}

	client.Enqueue(message)
}

func (h *Hub) broadcastRoom(roomID string, payload any, except *Client) {
	if h.redis != nil {
		h.publishToRedis(roomID, payload)
		return
	}

	message, err := json.Marshal(payload)
	if err != nil {
		h.logger.Error("failed to marshal realtime broadcast", slog.Any("error", err))
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.rooms[roomID] {
		if except != nil && client == except {
			continue
		}

		client.Enqueue(message)
	}
}

func (h *Hub) publishToRedis(roomID string, data any) {
	rawData, err := json.Marshal(data)
	if err != nil {
		return
	}

	payload := struct {
		RoomID string          `json:"roomID"`
		Data   json.RawMessage `json:"data"`
	}{
		RoomID: roomID,
		Data:   rawData,
	}

	msg, _ := json.Marshal(payload)
	h.redis.Publish(context.Background(), redisRealtimeChannel, msg)
}
