package server

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"macradar/backend/internal/explore"
)

func (s *Server) handlePostEngagementUsers(w http.ResponseWriter, r *http.Request) {
	postID := strings.TrimSpace(r.PathValue("postID"))
	if postID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_post_id", "post id is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	kindRaw := strings.TrimSpace(r.URL.Query().Get("kind"))
	reactionKind, ok := explore.ParseReactionKind(kindRaw)
	if !ok {
		// Default to likes list to keep UX simple.
		reactionKind = explore.ReactionLike
	}
	if reactionKind != explore.ReactionLike && reactionKind != explore.ReactionBookmark {
		s.respondError(w, http.StatusBadRequest, "invalid_engagement_kind", "kind must be like or bookmark")
		return
	}

	limit, err := parseOptionalLimit(r.URL.Query().Get("limit"))
	if err != nil {
		s.respondError(w, http.StatusBadRequest, "invalid_engagement_limit", "limit sayisal olmali.")
		return
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}

	cacheKey := s.cacheKey(
		"post-engagement-users",
		postID,
		string(reactionKind),
		strconv.Itoa(limit),
	)

	// Check access before serving potentially-cached data.
	if err := s.repo.AssertViewerCanAccessPost(ctx, postID, identity.UserID); err != nil {
		switch {
		case errors.Is(err, explore.ErrPostNotFound):
			s.respondError(w, http.StatusNotFound, "post_not_found", "Gonderi bulunamadi.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile erisim engellendi.")
		case errors.Is(err, explore.ErrProfilePrivate):
			s.respondError(w, http.StatusForbidden, "profile_private", "Bu hesabi gorme yetkin yok.")
		case errors.Is(err, explore.ErrPostAccessForbidden):
			s.respondError(w, http.StatusForbidden, "post_access_forbidden", "Bu gonderiyi gorme yetkin yok.")
		default:
			s.respondInternalError(w, "post_engagement_access_check_failed", err)
		}
		return
	}

	var cached explore.PostEngagementUsersResponse
	if s.cacheGetJSON(ctx, cacheKey, &cached) {
		s.respondJSON(w, http.StatusOK, cached)
		return
	}

	response, err := s.repo.ListPostEngagementUsers(ctx, postID, identity.UserID, reactionKind, limit)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrPostNotFound):
			s.respondError(w, http.StatusNotFound, "post_not_found", "Gonderi bulunamadi.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile erisim engellendi.")
		case errors.Is(err, explore.ErrProfilePrivate):
			s.respondError(w, http.StatusForbidden, "profile_private", "Bu hesabi gorme yetkin yok.")
		case errors.Is(err, explore.ErrPostAccessForbidden):
			s.respondError(w, http.StatusForbidden, "post_access_forbidden", "Bu gonderiyi gorme yetkin yok.")
		default:
			s.respondInternalError(w, "post_engagement_users_failed", err)
		}
		return
	}

	// Engagement lists change often. Cache for a short window but long enough
	// to avoid repeated loading when user revisits quickly.
	s.cacheSetJSON(ctx, cacheKey, 5*time.Minute, response)
	s.respondJSON(w, http.StatusOK, response)
}

