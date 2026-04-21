package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

type inboundNotificationSocketEvent struct {
	Type string `json:"type"`
}

type outboundNotificationSocketEvent struct {
	ServerTime time.Time `json:"serverTime"`
	Type       string    `json:"type"`
}

func (s *Server) handleNotificationsWebSocket(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		if s.logger != nil {
			s.logger.Error("notifications websocket upgrade failed", "error", err)
		}
		return
	}

	client := s.messageHub.Register(conn, identity.UserID)
	go client.WritePump()
	s.messageHub.Send(client, outboundNotificationSocketEvent{
		ServerTime: time.Now().UTC(),
		Type:       "welcome",
	})

	client.ReadPump(func(payload []byte) {
		var input inboundNotificationSocketEvent
		if err := json.Unmarshal(payload, &input); err != nil {
			return
		}
		if strings.EqualFold(strings.TrimSpace(input.Type), "heartbeat") {
			s.messageHub.Send(client, outboundNotificationSocketEvent{
				ServerTime: time.Now().UTC(),
				Type:       "heartbeat",
			})
		}
	}, func() {
		s.messageHub.Unregister(client)
	})
}

