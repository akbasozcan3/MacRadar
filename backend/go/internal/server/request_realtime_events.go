package server

import (
	"strconv"
	"strings"
	"time"
)

const requestRealtimeEventDedupeWindow = 1250 * time.Millisecond

func (s *Server) broadcastRequestRealtimeEvent(
	recipientID string,
	eventType string,
	kind string,
	requesterID string,
	targetID string,
	delta int,
	reason string,
) {
	normalizedRecipientID := strings.TrimSpace(recipientID)
	normalizedEventType := strings.TrimSpace(eventType)
	normalizedKind := strings.TrimSpace(kind)
	normalizedRequesterID := strings.TrimSpace(requesterID)
	normalizedTargetID := strings.TrimSpace(targetID)
	normalizedReason := strings.TrimSpace(reason)
	if normalizedRecipientID == "" ||
		normalizedEventType == "" ||
		normalizedKind == "" ||
		normalizedRequesterID == "" ||
		normalizedTargetID == "" ||
		delta == 0 {
		return
	}
	now := time.Now().UTC()
	dedupeKey := strings.Join(
		[]string{
			normalizedRecipientID,
			normalizedEventType,
			normalizedKind,
			normalizedRequesterID,
			normalizedTargetID,
			normalizedReason,
			strconv.Itoa(delta),
		},
		"|",
	)
	if s.shouldSkipRequestRealtimeEvent(dedupeKey, now) {
		return
	}

	s.messageHub.BroadcastToUser(normalizedRecipientID, map[string]any{
		"type":       normalizedEventType,
		"serverTime": now.Format(time.RFC3339Nano),
		"request": map[string]any{
			"kind":        normalizedKind,
			"delta":       delta,
			"requesterId": normalizedRequesterID,
			"targetId":    normalizedTargetID,
			"reason":      normalizedReason,
		},
	})
}

func (s *Server) shouldSkipRequestRealtimeEvent(dedupeKey string, now time.Time) bool {
	cutoff := now.Add(-requestRealtimeEventDedupeWindow)
	s.requestEventDedupeMu.Lock()
	defer s.requestEventDedupeMu.Unlock()

	for key, eventTime := range s.requestEventDedupe {
		if eventTime.Before(cutoff) {
			delete(s.requestEventDedupe, key)
		}
	}

	lastEventTime, exists := s.requestEventDedupe[dedupeKey]
	if exists && now.Sub(lastEventTime) <= requestRealtimeEventDedupeWindow {
		return true
	}

	s.requestEventDedupe[dedupeKey] = now
	return false
}
