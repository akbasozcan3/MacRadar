package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"macradar/backend/internal/explore"
	"macradar/backend/internal/messages"
)

type inboundMessageSocketEvent struct {
	ConversationID string `json:"conversationId"`
	IsTyping       *bool  `json:"isTyping,omitempty"`
	MessageID      string `json:"messageId,omitempty"`
	Type           string `json:"type"`
}

type outboundMessageSocketEvent struct {
	ConversationID string                       `json:"conversationId,omitempty"`
	EventID        string                       `json:"eventId,omitempty"`
	FromUserID     string                       `json:"fromUserId,omitempty"`
	IsTyping       *bool                        `json:"isTyping,omitempty"`
	LastReadAt     *time.Time                   `json:"lastReadAt,omitempty"`
	Message        *explore.ConversationMessage `json:"message,omitempty"`
	MessageID      string                       `json:"messageId,omitempty"`
	PeerUserID     string                       `json:"peerUserId,omitempty"`
	RequestDelta   *int                         `json:"requestDelta,omitempty"`
	RequestReason  string                       `json:"requestReason,omitempty"`
	ServerTime     time.Time                    `json:"serverTime"`
	Status         string                       `json:"status,omitempty"`
	Type           string                       `json:"type"`
	UnreadCount    *int64                       `json:"unreadCount,omitempty"`
}

type outboundMessageSocketError struct {
	Code       string    `json:"code"`
	Message    string    `json:"message"`
	ServerTime time.Time `json:"serverTime"`
	Type       string    `json:"type"`
}

func (s *Server) handleMessagesWebSocket(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.logger.Error("messages websocket upgrade failed", "error", err)
		return
	}

	client := s.messageHub.Register(conn, identity.UserID)
	go client.WritePump()
	s.messageHub.Send(client, outboundMessageSocketEvent{
		ServerTime: time.Now().UTC(),
		Type:       "welcome",
	})

	client.ReadPump(func(payload []byte) {
		s.handleMessageSocketPayload(client, payload)
	}, func() {
		s.messageHub.Unregister(client)
	})
}

func (s *Server) handleMessageSocketPayload(client *messages.Client, payload []byte) {
	var input inboundMessageSocketEvent
	if err := json.Unmarshal(payload, &input); err != nil {
		s.sendMessageSocketError(client, "invalid_payload", "WebSocket payload gecersiz.")
		return
	}

	eventType := strings.ToLower(strings.TrimSpace(input.Type))
	conversationID := strings.TrimSpace(input.ConversationID)
	if eventType == "" {
		s.sendMessageSocketError(client, "invalid_event", "Event type zorunludur.")
		return
	}

	switch eventType {
	case "heartbeat":
		s.messageHub.Send(client, outboundMessageSocketEvent{
			ServerTime: time.Now().UTC(),
			Type:       "heartbeat",
		})
	case "typing":
		if conversationID == "" {
			s.sendMessageSocketError(client, "invalid_event", "conversationId zorunludur.")
			return
		}
		if input.IsTyping == nil {
			s.sendMessageSocketError(client, "invalid_typing", "Typing event icin isTyping zorunludur.")
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()

		peerID, err := s.repo.ConversationPeer(ctx, client.UserID(), conversationID)
		if err != nil {
			s.sendMessageSocketRepositoryError(client, err)
			return
		}

		isTyping := *input.IsTyping
		s.messageHub.BroadcastToUsers([]string{peerID}, outboundMessageSocketEvent{
			ConversationID: conversationID,
			FromUserID:     client.UserID(),
			IsTyping:       &isTyping,
			ServerTime:     time.Now().UTC(),
			Type:           "typing",
		})
	case "read":
		if conversationID == "" {
			s.sendMessageSocketError(client, "invalid_event", "conversationId zorunludur.")
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()

		response, err := s.repo.MarkConversationRead(
			ctx,
			client.UserID(),
			conversationID,
			explore.ConversationReadInput{MessageID: strings.TrimSpace(input.MessageID)},
		)
		if err != nil {
			s.sendMessageSocketRepositoryError(client, err)
			return
		}

		s.emitMessageReadEvent(client.UserID(), response)
	default:
		s.sendMessageSocketError(client, "unsupported_event", "Bu websocket event tipi desteklenmiyor.")
	}
}

func (s *Server) sendMessageSocketRepositoryError(client *messages.Client, err error) {
	switch {
	case errors.Is(err, explore.ErrConversationNotFound):
		s.sendMessageSocketError(client, "conversation_not_found", "Konusma bulunamadi.")
	case errors.Is(err, explore.ErrConversationForbidden):
		s.sendMessageSocketError(client, "conversation_forbidden", "Bu konusmaya erisim yok.")
	case errors.Is(err, explore.ErrBlockedRelationship):
		s.sendMessageSocketError(client, "blocked_relationship", "Bu kullanici ile mesajlasma engellendi.")
	case errors.Is(err, explore.ErrInvalidMessageAction):
		s.sendMessageSocketError(client, "invalid_message_action", "Mesaj read islemi gecersiz.")
	default:
		s.sendMessageSocketError(client, "request_failed", "Mesaj websocket istegi tamamlanamadi.")
	}
}

func (s *Server) sendMessageSocketError(client *messages.Client, code string, message string) {
	s.messageHub.Send(client, outboundMessageSocketError{
		Code:       code,
		Message:    message,
		ServerTime: time.Now().UTC(),
		Type:       "error",
	})
}

func (s *Server) emitMessageCreatedEvent(
	actorUserID string,
	peerUserID string,
	conversationID string,
	message explore.ConversationMessage,
) {
	messageCopy := explore.HydrateConversationMessage(message)
	s.messageHub.BroadcastToUsers([]string{actorUserID, peerUserID}, outboundMessageSocketEvent{
		ConversationID: conversationID,
		FromUserID:     actorUserID,
		Message:        &messageCopy,
		MessageID:      message.ID,
		ServerTime:     time.Now().UTC(),
		Type:           "message.created",
	})

	if strings.TrimSpace(peerUserID) == "" || strings.TrimSpace(peerUserID) == strings.TrimSpace(actorUserID) {
		return
	}
	createdAt := message.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	actorLabel := strings.TrimSpace(actorUserID)
	if s.accounts != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		actorLabel = s.accounts.MessageNotificationActorLabelByUserID(ctx, actorUserID)
		cancel()
	}
	if actorLabel == "" {
		actorLabel = "MacRadar"
	}
	messagePreview := strings.TrimSpace(messageCopy.Preview)
	if messagePreview == "" {
		messagePreview = strings.TrimSpace(messageCopy.Body)
	}
	if messagePreview == "" {
		messagePreview = "Yeni mesaj"
	}

	s.messageHub.BroadcastToUser(peerUserID, map[string]any{
		"type": "notification.created",
		"notification": map[string]any{
			"body":           actorLabel + ": " + messagePreview,
			"channel":        "messages",
			"conversationId": conversationID,
			"createdAt":      createdAt.UTC().Format(time.RFC3339Nano),
			"fromUserId":     actorUserID,
			"id":             "notif_msg_" + strings.TrimSpace(message.ID),
			"isRead":         false,
			"messageId":      message.ID,
			"metadata": map[string]any{
				"actorLabel":     actorLabel,
				"conversationId": conversationID,
				"messagePreview": messagePreview,
				"messageId":      message.ID,
			},
			"title":  actorLabel,
			"type":   "message",
			"userId": peerUserID,
		},
	})
}

func (s *Server) emitMessageReadEvent(actorUserID string, response explore.ConversationReadResponse) {
	lastReadAt := response.LastReadAt.UTC()
	unreadCount := response.UnreadCount
	s.messageHub.BroadcastToUsers([]string{actorUserID, response.PeerID}, outboundMessageSocketEvent{
		ConversationID: response.ConversationID,
		FromUserID:     actorUserID,
		LastReadAt:     &lastReadAt,
		MessageID:      response.LastReadMessageID,
		ServerTime:     time.Now().UTC(),
		Type:           "message.read",
		UnreadCount:    &unreadCount,
	})
}

func (s *Server) emitMessageRequestUpdatedEvent(actorUserID string, peerUserID string, conversationID string, status string) {
	if strings.TrimSpace(peerUserID) == "" || strings.TrimSpace(conversationID) == "" {
		return
	}

	s.messageHub.BroadcastToUsers([]string{actorUserID, peerUserID}, outboundMessageSocketEvent{
		ConversationID: conversationID,
		FromUserID:     actorUserID,
		PeerUserID:     peerUserID,
		ServerTime:     time.Now().UTC(),
		Status:         strings.TrimSpace(status),
		Type:           "message.request.updated",
	})
}

func (s *Server) emitMessageRequestDeltaEvent(
	requesterUserID string,
	targetUserID string,
	conversationID string,
	eventType string,
	eventID string,
	delta int,
	status string,
) {
	normalizedRequesterID := strings.TrimSpace(requesterUserID)
	normalizedTargetID := strings.TrimSpace(targetUserID)
	normalizedConversationID := strings.TrimSpace(conversationID)
	normalizedEventType := strings.TrimSpace(eventType)
	normalizedEventID := strings.TrimSpace(eventID)
	normalizedStatus := strings.TrimSpace(status)
	if normalizedRequesterID == "" ||
		normalizedTargetID == "" ||
		normalizedConversationID == "" ||
		normalizedEventType == "" ||
		delta == 0 {
		return
	}
	if normalizedEventID == "" {
		normalizedEventID = fmt.Sprintf(
			"mreq:%s:%s:%s:%s:%d:%d",
			normalizedConversationID,
			normalizedEventType,
			normalizedRequesterID,
			normalizedTargetID,
			delta,
			time.Now().UTC().UnixNano(),
		)
	}

	deltaCopy := delta
	s.messageHub.BroadcastToUsers(
		[]string{normalizedRequesterID, normalizedTargetID},
		outboundMessageSocketEvent{
			ConversationID: normalizedConversationID,
			EventID:        normalizedEventID,
			FromUserID:     normalizedRequesterID,
			PeerUserID:     normalizedTargetID,
			RequestDelta:   &deltaCopy,
			RequestReason:  normalizedStatus,
			ServerTime:     time.Now().UTC(),
			Status:         normalizedStatus,
			Type:           normalizedEventType,
		},
	)
}

func (s *Server) emitMessageRelationshipEvent(actorUserID string, peerUserID string, blocked bool) {
	eventType := "relationship.unblocked"
	if blocked {
		eventType = "relationship.blocked"
	}

	s.messageHub.BroadcastToUsers([]string{actorUserID, peerUserID}, outboundMessageSocketEvent{
		FromUserID: actorUserID,
		PeerUserID: peerUserID,
		ServerTime: time.Now().UTC(),
		Type:       eventType,
	})
}
