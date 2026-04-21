package server

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"macradar/backend/internal/sensors"
)

type sensorSocketError struct {
	Code       string    `json:"code"`
	Message    string    `json:"message"`
	ServerTime time.Time `json:"serverTime"`
	Type       string    `json:"type"`
}

func (s *Server) handleSensorsWebSocket(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.logger.Error("sensor websocket upgrade failed", "error", err)
		return
	}

	client := s.sensorHub.Register(conn)
	go client.WritePump()

	now := time.Now().UTC()
	s.sensorHub.Send(client, sensors.Event{
		ServerTime: now,
		Source:     "go.ws",
		Type:       sensors.EventTypeWelcome,
	})
	s.sensorHub.Send(client, sensors.SnapshotEvent{
		Readings:   s.sensorHub.Snapshot(24),
		ServerTime: now,
		Type:       sensors.EventTypeSnapshot,
	})

	client.ReadPump(func(payload []byte) {
		s.handleSensorSocketPayload(identity.UserID, client, payload)
	}, func() {
		s.sensorHub.Unregister(client)
	})
}

func (s *Server) handleSensorSocketPayload(userID string, client *sensors.Client, payload []byte) {
	var event sensors.Event
	if err := json.Unmarshal(payload, &event); err != nil {
		s.sendSensorSocketError(client, "invalid_payload", "Sensor websocket payload gecersiz.")
		return
	}

	normalized := sensors.NormalizeEvent(event, userID, "go.ws")
	if normalized.Type == sensors.EventTypeSnapshot || normalized.Type == sensors.EventTypeWelcome {
		s.sendSensorSocketError(client, "invalid_event", "Snapshot ve welcome event disaridan gonderilemez.")
		return
	}
	if normalized.Type != sensors.EventTypeReading {
		normalized.Type = sensors.EventTypeReading
	}

	s.sensorHub.Broadcast(normalized)
	if s.sensorBridge != nil {
		s.sensorBridge.Publish(normalized)
	}
}

func (s *Server) sendSensorSocketError(client *sensors.Client, code string, message string) {
	s.sensorHub.Send(client, sensorSocketError{
		Code:       code,
		Message:    message,
		ServerTime: time.Now().UTC(),
		Type:       "error",
	})
}
