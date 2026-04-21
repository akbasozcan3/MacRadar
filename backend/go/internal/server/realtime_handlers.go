package server

import (
	"context"
	"net/http"
	"strings"
	"time"

	"macradar/backend/internal/realtime"
)

func (s *Server) handlePlayersWebSocket(w http.ResponseWriter, r *http.Request) {
	roomID := strings.TrimSpace(r.URL.Query().Get("room"))
	playerID := strings.TrimSpace(r.URL.Query().Get("player"))
	if playerID == "" {
		s.respondError(w, http.StatusBadRequest, "player_required", "player query is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}
	if identity.UserID != playerID {
		s.respondError(w, http.StatusForbidden, "player_identity_mismatch", "player id does not match session user")
		return
	}

	privacySettings, err := s.accounts.PrivacySettingsByUserID(ctx, identity.UserID)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}
	if !privacySettings.IsMapVisible {
		s.respondError(w, http.StatusForbidden, "map_visibility_disabled", "Map visibility is disabled for this account.")
		return
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.logger.Error(
			"player websocket upgrade failed",
			"error",
			err,
			"origin",
			strings.TrimSpace(r.Header.Get("Origin")),
			"user_agent",
			strings.TrimSpace(r.UserAgent()),
		)
		return
	}

	client := s.players.Register(conn, roomID, playerID)
	go client.WritePump()
	s.players.SendSnapshot(client)

	client.ReadPump(func(message realtime.PositionMessage) {
		s.players.HandlePosition(client, message)
	}, func() {
		s.players.Unregister(client)
	})
}
