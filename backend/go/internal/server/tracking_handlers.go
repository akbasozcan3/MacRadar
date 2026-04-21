package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"macradar/backend/internal/explore"
	"macradar/backend/internal/realtime"
)

type trackingIngestRequest struct {
	Accuracy  float64 `json:"accuracy"`
	Heading   float64 `json:"heading"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	RoomID    string  `json:"roomId"`
	Sequence  uint32  `json:"sequence"`
	Source    string  `json:"source"`
	Speed     float64 `json:"speed"`
	Timestamp int64   `json:"timestamp"`
	UserID    string  `json:"userId"`
}

func (s *Server) handleTrackingSessionStart(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}
	_ = s.repo.CloseStaleTrackingSessions(ctx, identity.UserID, s.cfg.TrackingSessionInactivityTimeout)
	sessionID, err := s.repo.UpsertTrackingSession(ctx, identity.UserID, "")
	if err != nil {
		s.respondError(w, http.StatusInternalServerError, "tracking_session_start_failed", "Tracking session could not be started.")
		return
	}
	s.respondJSON(w, http.StatusOK, map[string]any{
		"sessionId": sessionID,
		"status":    "active",
	})
}

func (s *Server) handleTrackingSessionStop(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}
	if err := s.repo.CloseTrackingSession(ctx, identity.UserID); err != nil {
		s.respondError(w, http.StatusInternalServerError, "tracking_session_stop_failed", "Tracking session could not be stopped.")
		return
	}
	s.respondJSON(w, http.StatusOK, map[string]any{"status": "stopped"})
}

func (s *Server) handleTrackingFollowPath(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}
	_ = identity

	targetUserID := strings.TrimSpace(r.PathValue("targetUserID"))
	if targetUserID == "" {
		s.respondError(w, http.StatusBadRequest, "target_user_required", "Target user id is required.")
		return
	}
	limit, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))
	window := normalizeTrackingWindow(strings.TrimSpace(r.URL.Query().Get("window")))
	result, err := s.repo.TrackingFollowPath(ctx, targetUserID, explore.TrackingFollowPathQuery{
		Limit:       limit,
		SimplifyEps: 0.00004,
		Window:      window,
	})
	if err != nil {
		s.respondError(w, http.StatusInternalServerError, "tracking_follow_path_failed", "Tracking path could not be loaded.")
		return
	}
	s.respondJSON(w, http.StatusOK, result)
}

func (s *Server) handleTrackingIngest(w http.ResponseWriter, r *http.Request) {
	if strings.TrimSpace(s.cfg.TrackingIngestToken) == "" || strings.TrimSpace(r.Header.Get("x-tracking-token")) != strings.TrimSpace(s.cfg.TrackingIngestToken) {
		s.respondError(w, http.StatusUnauthorized, "tracking_ingest_unauthorized", "Tracking ingest is unauthorized.")
		return
	}

	var payload trackingIngestRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		s.respondError(w, http.StatusBadRequest, "invalid_payload", "Tracking ingest payload is invalid.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	_ = s.repo.CloseStaleTrackingSessions(ctx, payload.UserID, s.cfg.TrackingSessionInactivityTimeout)
	if err := s.repo.RecordTrackingPoint(ctx, explore.TrackingPointInput{
		Accuracy:  payload.Accuracy,
		Heading:   payload.Heading,
		Latitude:  payload.Latitude,
		Longitude: payload.Longitude,
		RoomID:    payload.RoomID,
		Sequence:  payload.Sequence,
		Source:    payload.Source,
		Speed:     payload.Speed,
		Timestamp: payload.Timestamp,
		UserID:    payload.UserID,
	}); err != nil {
		s.respondError(w, http.StatusInternalServerError, "tracking_ingest_failed", "Tracking point could not be ingested.")
		return
	}
	s.respondJSON(w, http.StatusAccepted, map[string]any{"status": "accepted"})
}

type trackingRecorder struct {
	inactivityTimeout time.Duration
	repo              *explore.Repository
}

func (t trackingRecorder) RecordPosition(roomID string, payload realtime.PositionMessage) {
	if t.repo == nil {
		return
	}
	if strings.TrimSpace(payload.PlayerID) == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = t.repo.CloseStaleTrackingSessions(ctx, payload.PlayerID, t.inactivityTimeout)
	_ = t.repo.RecordTrackingPoint(ctx, explore.TrackingPointInput{
		Accuracy:  payload.Accuracy,
		Heading:   payload.Heading,
		Latitude:  payload.Latitude,
		Longitude: payload.Longitude,
		RoomID:    roomID,
		Sequence:  payload.Sequence,
		Source:    payload.Source,
		Speed:     payload.Speed,
		Timestamp: payload.Timestamp,
		UserID:    payload.PlayerID,
	})
}

func normalizeTrackingWindow(raw string) time.Duration {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1h", "60m":
		return time.Hour
	case "15m", "":
		return 15 * time.Minute
	default:
		return 15 * time.Minute
	}
}
