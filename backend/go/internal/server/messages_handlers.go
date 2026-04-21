package server

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"macradar/backend/internal/explore"
)

type conversationMuteInput struct {
	Muted *bool `json:"muted"`
}

func (s *Server) handleProfilePosts(w http.ResponseWriter, r *http.Request) {
	targetUserID := strings.TrimSpace(r.PathValue("userID"))
	if targetUserID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_user_id", "user id is required")
		return
	}

	limit, err := parseOptionalLimit(r.URL.Query().Get("limit"))
	if err != nil {
		s.respondError(w, http.StatusBadRequest, "invalid_profile_posts_limit", "Post limiti sayisal olmali.")
		return
	}
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	response, err := s.repo.ListProfilePosts(
		ctx,
		identity.UserID,
		targetUserID,
		cursor,
		limit,
	)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrUserNotFound):
			s.respondError(w, http.StatusNotFound, "user_not_found", "Kullanici bulunamadi.")
		case errors.Is(err, explore.ErrProfilePrivate):
			s.respondError(w, http.StatusForbidden, "profile_private", "Bu hesabin gonderilerini gorme yetkin yok.")
		case errors.Is(err, explore.ErrPostAccessForbidden):
			s.respondError(w, http.StatusForbidden, "post_access_forbidden", "Bu kullanicinin bazi gonderilerine erisim yetkin yok.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile erisim engellendi.")
		case errors.Is(err, explore.ErrInvalidFeedCursor):
			s.respondError(w, http.StatusBadRequest, "invalid_profile_posts_cursor", "Profil post cursor gecersiz.")
		default:
			s.respondInternalError(w, "profile_posts_query_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleMyProfilePosts(w http.ResponseWriter, r *http.Request) {
	limit, err := parseOptionalLimit(r.URL.Query().Get("limit"))
	if err != nil {
		s.respondError(w, http.StatusBadRequest, "invalid_my_profile_posts_limit", "Post limiti sayisal olmali.")
		return
	}
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	response, err := s.repo.ListViewerPosts(ctx, identity.UserID, cursor, limit)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidFeedCursor):
			s.respondError(w, http.StatusBadRequest, "invalid_my_profile_posts_cursor", "Profil post cursor gecersiz.")
		default:
			s.respondInternalError(w, "my_profile_posts_query_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleCreateMyProfilePost(w http.ResponseWriter, r *http.Request) {
	var input explore.CreateProfilePostInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_create_profile_post_payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	item, err := s.repo.CreateProfilePost(ctx, identity.UserID, input)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrUserNotFound):
			s.respondError(w, http.StatusNotFound, "user_not_found", "Kullanici bulunamadi.")
		case errors.Is(err, explore.ErrInvalidCreatePostInput):
			s.respondError(w, http.StatusBadRequest, "invalid_create_profile_post_payload", "Gonderi olusturma istegi gecersiz.")
		default:
			s.respondInternalError(w, "create_profile_post_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusCreated, item)
}

func (s *Server) handleUpdateMyProfilePost(w http.ResponseWriter, r *http.Request) {
	postID := strings.TrimSpace(r.PathValue("postID"))
	if postID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_post_id", "post id is required")
		return
	}

	var input explore.UpdateProfilePostInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_update_profile_post_payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	item, err := s.repo.UpdateViewerProfilePost(ctx, identity.UserID, postID, input)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrPostNotFound):
			s.respondError(w, http.StatusNotFound, "post_not_found", "Gönderi Bulunamadi.")
		case errors.Is(err, explore.ErrPostEditForbidden):
			s.respondError(w, http.StatusForbidden, "post_edit_forbidden", "Bu Gönderiyi Düzenleme Yetkin Yok.")
		case errors.Is(err, explore.ErrInvalidUpdatePostInput):
			s.respondError(w, http.StatusBadRequest, "invalid_update_profile_post_payload", "Gönderi Güncelleme İstegi Geçersiz.")
		default:
			s.respondInternalError(w, "update_profile_post_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, item)
}

func (s *Server) handleSoftDeleteMyProfilePost(w http.ResponseWriter, r *http.Request) {
	postID := strings.TrimSpace(r.PathValue("postID"))
	if postID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_post_id", "post id is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	response, err := s.repo.SoftDeleteViewerProfilePost(ctx, identity.UserID, postID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrPostNotFound):
			s.respondError(w, http.StatusNotFound, "post_not_found", "Gonderi bulunamadi.")
		case errors.Is(err, explore.ErrPostDeleteForbidden):
			s.respondError(w, http.StatusForbidden, "post_delete_forbidden", "Bu gonderiyi silme yetkin yok.")
		default:
			s.respondInternalError(w, "soft_delete_profile_post_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleAdminHardDeleteProfilePost(w http.ResponseWriter, r *http.Request) {
	postID := strings.TrimSpace(r.PathValue("postID"))
	if postID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_post_id", "post id is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	if _, err := s.requireIdentity(ctx, r); err != nil {
		s.respondAccountError(w, err)
		return
	}
	if !s.isAdminHardDeleteAuthorized(r) {
		s.respondError(
			w,
			http.StatusForbidden,
			"admin_hard_delete_forbidden",
			"Admin hard delete yetkisi gereklidir.",
		)
		return
	}

	response, err := s.repo.HardDeleteProfilePost(ctx, postID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrPostNotFound):
			s.respondError(w, http.StatusNotFound, "post_not_found", "Gonderi bulunamadi.")
		default:
			s.respondInternalError(w, "hard_delete_profile_post_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) isAdminHardDeleteAuthorized(r *http.Request) bool {
	expected := strings.TrimSpace(s.cfg.AdminPostHardDeleteToken)
	if expected == "" {
		return false
	}
	provided := strings.TrimSpace(r.Header.Get("X-MacRadar-Admin-Token"))
	if provided == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

func (s *Server) handleMyLikedPosts(w http.ResponseWriter, r *http.Request) {
	limit, err := parseOptionalLimit(r.URL.Query().Get("limit"))
	if err != nil {
		s.respondError(w, http.StatusBadRequest, "invalid_my_liked_posts_limit", "Post limiti sayisal olmali.")
		return
	}
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	cacheKey := s.cacheKey(
		"liked-posts",
		identity.UserID,
		buildQueryHash(cursor, strconv.Itoa(limit)),
	)
	var cached explore.ProfilePostsResponse
	if s.cacheGetJSON(ctx, cacheKey, &cached) {
		s.respondJSON(w, http.StatusOK, cached)
		return
	}

	response, err := s.repo.ListViewerLikedPosts(ctx, identity.UserID, cursor, limit)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidFeedCursor):
			s.respondError(w, http.StatusBadRequest, "invalid_my_liked_posts_cursor", "Begeni post cursor gecersiz.")
		default:
			s.respondInternalError(w, "my_liked_posts_query_failed", err)
		}
		return
	}

	// Keep engagement lists cached longer to avoid "reloading" on tab revisit.
	s.cacheSetJSON(ctx, cacheKey, 5*time.Minute, response)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleMySavedPosts(w http.ResponseWriter, r *http.Request) {
	limit, err := parseOptionalLimit(r.URL.Query().Get("limit"))
	if err != nil {
		s.respondError(w, http.StatusBadRequest, "invalid_my_saved_posts_limit", "Post limiti sayisal olmali.")
		return
	}
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	cacheKey := s.cacheKey(
		"saved-posts",
		identity.UserID,
		buildQueryHash(cursor, strconv.Itoa(limit)),
	)
	var cached explore.ProfilePostsResponse
	if s.cacheGetJSON(ctx, cacheKey, &cached) {
		s.respondJSON(w, http.StatusOK, cached)
		return
	}

	response, err := s.repo.ListViewerSavedPosts(ctx, identity.UserID, cursor, limit)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidFeedCursor):
			s.respondError(w, http.StatusBadRequest, "invalid_my_saved_posts_cursor", "Kaydedilen post cursor gecersiz.")
		default:
			s.respondInternalError(w, "my_saved_posts_query_failed", err)
		}
		return
	}

	s.cacheSetJSON(ctx, cacheKey, 5*time.Minute, response)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleProfilePostDetail(w http.ResponseWriter, r *http.Request) {
	postID := strings.TrimSpace(r.PathValue("postID"))
	if postID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_post_id", "post id is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	post, err := s.repo.GetProfilePostDetail(ctx, identity.UserID, postID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrPostNotFound):
			s.respondError(w, http.StatusNotFound, "post_not_found", "Gonderi bulunamadi.")
		case errors.Is(err, explore.ErrProfilePrivate):
			s.respondError(w, http.StatusForbidden, "profile_private", "Bu gonderiyi gorme yetkin yok.")
		case errors.Is(err, explore.ErrPostAccessForbidden):
			s.respondError(w, http.StatusForbidden, "post_access_forbidden", "Bu gonderiyi gorme yetkin yok.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile erisim engellendi.")
		default:
			s.respondInternalError(w, "profile_post_query_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, post)
}

func (s *Server) handleConversations(w http.ResponseWriter, r *http.Request) {
	limit, err := parseOptionalLimit(r.URL.Query().Get("limit"))
	if err != nil {
		s.respondError(w, http.StatusBadRequest, "invalid_conversation_limit", "Konusma limiti sayisal olmali.")
		return
	}
	unreadOnly, err := parseOptionalBool(r.URL.Query().Get("unread"))
	if err != nil {
		s.respondError(w, http.StatusBadRequest, "invalid_conversation_unread", "Unread filtresi true/false olmali.")
		return
	}
	requestsOnly, err := parseOptionalBool(r.URL.Query().Get("requests"))
	if err != nil {
		s.respondError(w, http.StatusBadRequest, "invalid_conversation_requests", "Mesaj istegi filtresi true/false olmali.")
		return
	}
	search := strings.TrimSpace(r.URL.Query().Get("q"))
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	cacheKey := s.cacheKey(
		"conversations",
		identity.UserID,
		buildQueryHash(
			cursor,
			search,
			strconv.Itoa(limit),
			formatIntBool(unreadOnly),
			formatIntBool(requestsOnly),
		),
	)
	var cached explore.ConversationListResponse
	if s.cacheGetJSON(ctx, cacheKey, &cached) {
		s.respondJSON(w, http.StatusOK, cached)
		return
	}

	response, err := s.repo.ListConversations(
		ctx,
		identity.UserID,
		cursor,
		limit,
		unreadOnly,
		requestsOnly,
		search,
	)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidFeedCursor):
			s.respondError(w, http.StatusBadRequest, "invalid_conversation_cursor", "Konusma cursor gecersiz.")
		case errors.Is(err, explore.ErrConversationForbidden):
			s.respondError(w, http.StatusForbidden, "conversation_forbidden", "Konusma listesine erisim engellendi.")
		default:
			s.respondInternalError(w, "conversation_list_failed", err)
		}
		return
	}

	s.cacheSetJSON(ctx, cacheKey, 2*time.Minute, response)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleCreateConversation(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	var input explore.ConversationCreateInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_conversation_payload")
		return
	}

	response, err := s.repo.CreateConversation(ctx, identity.UserID, input)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrUserNotFound):
			s.respondError(w, http.StatusNotFound, "recipient_not_found", "Mesaj gonderilecek kullanici bulunamadi.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullaniciya mesaj gonderemezsin.")
		case errors.Is(err, explore.ErrConversationRequestPending):
			s.respondError(w, http.StatusConflict, "message_request_pending", "Mesaj istegi zaten gonderildi. Kabul edilene kadar yeni mesaj gonderemezsin.")
		case errors.Is(err, explore.ErrConversationRequestRejected):
			s.respondError(w, http.StatusConflict, "message_request_rejected", "Mesaj istegi reddedildi. Takip etmeden yeniden mesaj gonderemezsin.")
		case errors.Is(err, explore.ErrConversationRestricted):
			s.respondError(w, http.StatusForbidden, "messages_limited_to_following", "Bu kullanici sadece takip ettiklerinden mesaj kabul ediyor.")
		case errors.Is(err, explore.ErrInvalidMessageAction):
			s.respondError(w, http.StatusBadRequest, "invalid_conversation_payload", "Konusma olusturma istegi gecersiz.")
		default:
			s.respondInternalError(w, "conversation_create_failed", err)
		}
		return
	}

	if response.Message != nil {
		peerID, peerErr := s.repo.ConversationPeerAllowBlocked(ctx, identity.UserID, response.ConversationID)
		if peerErr != nil {
			if s.logger != nil {
				s.logger.Warn("resolve conversation peer after create failed", "error", peerErr)
			}
		} else {
			s.emitMessageCreatedEvent(identity.UserID, peerID, response.ConversationID, *response.Message)
		}
	}
	if response.Conversation != nil &&
		response.Conversation.ChatRequestStatus == explore.ConversationChatRequestStatusPending &&
		response.Conversation.ChatRequestDirection == explore.ConversationChatRequestDirectionOutgoing {
		targetUserID := strings.TrimSpace(response.Conversation.Peer.ID)
		if targetUserID == "" {
			targetUserID = strings.TrimSpace(input.RecipientID)
		}
		if targetUserID != "" {
			eventID := "mreq:create:" + response.ConversationID + ":" + time.Now().UTC().Format(time.RFC3339Nano)
			if response.Message != nil {
				messageID := strings.TrimSpace(response.Message.ID)
				if messageID != "" {
					eventID = "mreq:create:" + response.ConversationID + ":" + messageID
				}
			}
			s.emitMessageRequestDeltaEvent(
				identity.UserID,
				targetUserID,
				response.ConversationID,
				"message_request.created",
				eventID,
				1,
				"pending",
			)
		}
	}

	s.cacheInvalidatePrefixes(
		ctx,
		s.cacheKey("conversations", identity.UserID),
		s.cacheKey("conversation-messages", identity.UserID, response.ConversationID),
	)
	s.respondJSON(w, http.StatusCreated, response)
}

func (s *Server) handleConversationMessages(w http.ResponseWriter, r *http.Request) {
	conversationID := strings.TrimSpace(r.PathValue("conversationID"))
	if conversationID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_conversation_id", "conversation id is required")
		return
	}

	limit, err := parseOptionalLimit(r.URL.Query().Get("limit"))
	if err != nil {
		s.respondError(w, http.StatusBadRequest, "invalid_message_limit", "Mesaj limiti sayisal olmali.")
		return
	}
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	cacheKey := s.cacheKey(
		"conversation-messages",
		identity.UserID,
		conversationID,
		buildQueryHash(cursor, strconv.Itoa(limit)),
	)
	var cached explore.ConversationMessagesResponse
	if s.cacheGetJSON(ctx, cacheKey, &cached) {
		s.respondJSON(w, http.StatusOK, cached)
		return
	}

	response, err := s.repo.ListConversationMessages(
		ctx,
		identity.UserID,
		conversationID,
		cursor,
		limit,
	)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrConversationNotFound):
			s.respondError(w, http.StatusNotFound, "conversation_not_found", "Konusma bulunamadi.")
		case errors.Is(err, explore.ErrConversationForbidden):
			s.respondError(w, http.StatusForbidden, "conversation_forbidden", "Bu konusmaya erisim yetkin yok.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile mesajlasma engellendi.")
		case errors.Is(err, explore.ErrInvalidFeedCursor):
			s.respondError(w, http.StatusBadRequest, "invalid_message_cursor", "Mesaj cursor gecersiz.")
		default:
			s.respondInternalError(w, "conversation_messages_failed", err)
		}
		return
	}

	s.cacheSetJSON(ctx, cacheKey, 2*time.Minute, response)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleSendConversationMessage(w http.ResponseWriter, r *http.Request) {
	conversationID := strings.TrimSpace(r.PathValue("conversationID"))
	if conversationID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_conversation_id", "conversation id is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	var input explore.ConversationMessageInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_message_payload")
		return
	}

	response, err := s.repo.SendConversationMessage(
		ctx,
		identity.UserID,
		conversationID,
		input,
	)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrConversationNotFound):
			s.respondError(w, http.StatusNotFound, "conversation_not_found", "Konusma bulunamadi.")
		case errors.Is(err, explore.ErrConversationForbidden):
			s.respondError(w, http.StatusForbidden, "conversation_forbidden", "Bu konusmaya mesaj gonderemezsin.")
		case errors.Is(err, explore.ErrConversationRequestPending):
			s.respondError(w, http.StatusConflict, "message_request_pending", "Mesaj istegi zaten gonderildi. Kabul edilene kadar yeni mesaj gonderemezsin.")
		case errors.Is(err, explore.ErrConversationRequestRejected):
			s.respondError(w, http.StatusConflict, "message_request_rejected", "Mesaj istegi reddedildi. Takip etmeden yeniden mesaj gonderemezsin.")
		case errors.Is(err, explore.ErrConversationRestricted):
			s.respondError(w, http.StatusForbidden, "messages_limited_to_following", "Bu kullanici sadece takip ettiklerinden mesaj kabul ediyor.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile mesajlasma engellendi.")
		case errors.Is(err, explore.ErrInvalidMessageAction):
			s.respondError(w, http.StatusBadRequest, "invalid_message_payload", "Mesaj icerigi gecersiz.")
		default:
			s.respondInternalError(w, "send_message_failed", err)
		}
		return
	}

	peerID, peerErr := s.repo.ConversationPeerAllowBlocked(ctx, identity.UserID, response.ConversationID)
	if peerErr != nil {
		if s.logger != nil {
			s.logger.Warn("resolve conversation peer after send failed", "error", peerErr)
		}
	} else {
		s.emitMessageCreatedEvent(identity.UserID, peerID, response.ConversationID, response.Message)
		if response.Conversation != nil &&
			response.Conversation.ChatRequestStatus == explore.ConversationChatRequestStatusPending &&
			response.Conversation.ChatRequestDirection == explore.ConversationChatRequestDirectionOutgoing {
			s.emitMessageRequestDeltaEvent(
				identity.UserID,
				peerID,
				response.ConversationID,
				"message_request.created",
				"mreq:create:"+response.ConversationID+":"+strings.TrimSpace(response.Message.ID),
				1,
				"pending",
			)
		}
	}

	s.cacheInvalidatePrefixes(
		ctx,
		s.cacheKey("conversations", identity.UserID),
		s.cacheKey("conversation-messages", identity.UserID, conversationID),
	)
	s.respondJSON(w, http.StatusCreated, response)
}

func (s *Server) handleMarkConversationRead(w http.ResponseWriter, r *http.Request) {
	conversationID := strings.TrimSpace(r.PathValue("conversationID"))
	if conversationID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_conversation_id", "conversation id is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	var input explore.ConversationReadInput
	if err := s.decodeJSON(r, &input); err != nil {
		if !errors.Is(err, errRequestBodyRequired) {
			s.respondDecodeError(w, err, "invalid_read_payload")
			return
		}
	}

	response, err := s.repo.MarkConversationRead(
		ctx,
		identity.UserID,
		conversationID,
		input,
	)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrConversationNotFound):
			s.respondError(w, http.StatusNotFound, "conversation_not_found", "Konusma bulunamadi.")
		case errors.Is(err, explore.ErrConversationForbidden):
			s.respondError(w, http.StatusForbidden, "conversation_forbidden", "Bu konusmaya erisim yetkin yok.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile mesajlasma engellendi.")
		case errors.Is(err, explore.ErrInvalidMessageAction):
			s.respondError(w, http.StatusBadRequest, "invalid_read_payload", "Okundu payload gecersiz.")
		default:
			s.respondInternalError(w, "mark_read_failed", err)
		}
		return
	}

	s.emitMessageReadEvent(identity.UserID, response)
	s.cacheInvalidatePrefixes(
		ctx,
		s.cacheKey("conversations", identity.UserID),
		s.cacheKey("conversation-messages", identity.UserID, conversationID),
	)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleAcceptConversationRequest(w http.ResponseWriter, r *http.Request) {
	conversationID := strings.TrimSpace(r.PathValue("conversationID"))
	if conversationID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_conversation_id", "conversation id is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	response, err := s.repo.AcceptConversationRequest(ctx, identity.UserID, conversationID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrConversationNotFound):
			s.respondError(w, http.StatusNotFound, "conversation_not_found", "Konusma bulunamadi.")
		case errors.Is(err, explore.ErrConversationForbidden):
			s.respondError(w, http.StatusConflict, "conversation_request_not_actionable", "Bu mesaj istegi artik islenebilir degil.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile mesajlasma engellendi.")
		default:
			s.respondInternalError(w, "accept_conversation_request_failed", err)
		}
		return
	}

	peerID := ""
	if response.Conversation != nil {
		peerID = strings.TrimSpace(response.Conversation.Peer.ID)
	}
	if peerID == "" {
		if resolvedPeerID, peerErr := s.repo.ConversationPeerAllowBlocked(ctx, identity.UserID, response.ConversationID); peerErr == nil {
			peerID = strings.TrimSpace(resolvedPeerID)
		}
	}
	s.cacheInvalidatePrefixes(ctx, s.cacheKey("conversations", identity.UserID))
	if peerID != "" {
		s.cacheInvalidatePrefixes(ctx, s.cacheKey("conversations", peerID))
		s.emitMessageRequestUpdatedEvent(identity.UserID, peerID, response.ConversationID, "accepted")
		s.emitMessageRequestDeltaEvent(
			peerID,
			identity.UserID,
			response.ConversationID,
			"message_request.resolved",
			"mreq:resolved:"+response.ConversationID+":"+response.AcceptedAt.UTC().Format(time.RFC3339Nano),
			-1,
			"accepted",
		)
	}
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleRejectConversationRequest(w http.ResponseWriter, r *http.Request) {
	conversationID := strings.TrimSpace(r.PathValue("conversationID"))
	if conversationID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_conversation_id", "conversation id is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	response, err := s.repo.RejectConversationRequest(ctx, identity.UserID, conversationID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrConversationNotFound):
			s.respondError(w, http.StatusNotFound, "conversation_not_found", "Konusma bulunamadi.")
		case errors.Is(err, explore.ErrConversationForbidden):
			s.respondError(w, http.StatusConflict, "conversation_request_not_actionable", "Bu mesaj istegi artik islenebilir degil.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile mesajlasma engellendi.")
		default:
			s.respondInternalError(w, "reject_conversation_request_failed", err)
		}
		return
	}

	peerID := ""
	if response.Conversation != nil {
		peerID = strings.TrimSpace(response.Conversation.Peer.ID)
	}
	if peerID == "" {
		if resolvedPeerID, peerErr := s.repo.ConversationPeerAllowBlocked(ctx, identity.UserID, response.ConversationID); peerErr == nil {
			peerID = strings.TrimSpace(resolvedPeerID)
		}
	}
	s.cacheInvalidatePrefixes(ctx, s.cacheKey("conversations", identity.UserID))
	if peerID != "" {
		s.cacheInvalidatePrefixes(ctx, s.cacheKey("conversations", peerID))
		s.emitMessageRequestDeltaEvent(
			peerID,
			identity.UserID,
			response.ConversationID,
			"message_request.cancelled",
			"mreq:cancelled:"+response.ConversationID+":"+response.RejectedAt.UTC().Format(time.RFC3339Nano),
			-1,
			"removed",
		)
	}
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleSetConversationMuted(w http.ResponseWriter, r *http.Request) {
	conversationID := strings.TrimSpace(r.PathValue("conversationID"))
	if conversationID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_conversation_id", "conversation id is required")
		return
	}

	var input conversationMuteInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_mute_payload")
		return
	}
	if input.Muted == nil {
		s.respondError(w, http.StatusBadRequest, "invalid_mute_payload", "Sessize alma payload gecersiz.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	response, err := s.repo.SetConversationMuted(ctx, identity.UserID, conversationID, *input.Muted)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrConversationNotFound):
			s.respondError(w, http.StatusNotFound, "conversation_not_found", "Konusma bulunamadi.")
		case errors.Is(err, explore.ErrConversationForbidden):
			s.respondError(w, http.StatusForbidden, "conversation_forbidden", "Bu konusmaya erisim yetkin yok.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile mesajlasma engellendi.")
		default:
			s.respondInternalError(w, "mute_conversation_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleClearConversation(w http.ResponseWriter, r *http.Request) {
	conversationID := strings.TrimSpace(r.PathValue("conversationID"))
	if conversationID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_conversation_id", "conversation id is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	response, err := s.repo.ClearConversationMessages(ctx, identity.UserID, conversationID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrConversationNotFound):
			s.respondError(w, http.StatusNotFound, "conversation_not_found", "Konusma bulunamadi.")
		case errors.Is(err, explore.ErrConversationForbidden):
			s.respondError(w, http.StatusForbidden, "conversation_forbidden", "Bu konusmaya erisim yetkin yok.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile mesajlasma engellendi.")
		default:
			s.respondInternalError(w, "clear_conversation_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleDeleteConversation(w http.ResponseWriter, r *http.Request) {
	conversationID := strings.TrimSpace(r.PathValue("conversationID"))
	if conversationID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_conversation_id", "conversation id is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	response, err := s.repo.DeleteConversationForUser(ctx, identity.UserID, conversationID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrConversationNotFound):
			s.respondError(w, http.StatusNotFound, "conversation_not_found", "Konusma bulunamadi.")
		case errors.Is(err, explore.ErrConversationForbidden):
			s.respondError(w, http.StatusForbidden, "conversation_forbidden", "Bu konusmaya erisim yetkin yok.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile mesajlasma engellendi.")
		default:
			s.respondInternalError(w, "delete_conversation_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleHardDeleteConversation(w http.ResponseWriter, r *http.Request) {
	conversationID := strings.TrimSpace(r.PathValue("conversationID"))
	if conversationID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_conversation_id", "conversation id is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	response, err := s.repo.HardDeleteConversation(ctx, identity.UserID, conversationID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrConversationNotFound):
			s.respondError(w, http.StatusNotFound, "conversation_not_found", "Konusma bulunamadi.")
		case errors.Is(err, explore.ErrConversationForbidden):
			s.respondError(w, http.StatusForbidden, "conversation_forbidden", "Bu konusmaya erisim yetkin yok.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile mesajlasma engellendi.")
		default:
			s.respondInternalError(w, "hard_delete_conversation_failed", err)
		}
		return
	}

	if err := s.deleteVoiceFilesForConversation(conversationID); err != nil && s.logger != nil {
		s.logger.Warn("delete conversation voice files failed", "conversationId", conversationID, "error", err)
	}

	s.respondJSON(w, http.StatusOK, response)
}

func parseOptionalLimit(raw string) (int, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0, nil
	}

	value, err := strconv.Atoi(trimmed)
	if err != nil {
		return 0, err
	}

	return value, nil
}

func parseOptionalBool(raw string) (bool, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return false, nil
	}

	value, err := strconv.ParseBool(trimmed)
	if err != nil {
		return false, err
	}

	return value, nil
}
