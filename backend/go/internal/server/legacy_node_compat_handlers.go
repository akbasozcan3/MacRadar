package server

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"macradar/backend/internal/account"
	"macradar/backend/internal/explore"
)

type legacyViewerInput struct {
	UserID string `json:"userId"`
}

type legacyFeedPostInput struct {
	UserID   string   `json:"userId"`
	Caption  string   `json:"caption"`
	Media    []string `json:"media"`
	Location any      `json:"location"`
}

type legacyCommentInput struct {
	UserID  string `json:"userId"`
	Content string `json:"content"`
}

type legacyInteractionInput struct {
	UserID          string         `json:"userId"`
	InteractionType string         `json:"interactionType"`
	Metadata        map[string]any `json:"metadata"`
}

type legacyFeedUser struct {
	CreatedAt  string            `json:"createdAt"`
	Email      string            `json:"email"`
	ID         string            `json:"id"`
	IsDeleted  bool              `json:"isDeleted"`
	LastActive string            `json:"lastActive"`
	Profile    map[string]any    `json:"profile"`
	Stats      map[string]int    `json:"stats"`
	Username   string            `json:"username"`
}

type legacyFeedStory struct {
	Content    map[string]any `json:"content"`
	CreatedAt  string         `json:"createdAt"`
	ExpiresAt  string         `json:"expiresAt"`
	ID         string         `json:"id"`
	IsDeleted  bool           `json:"isDeleted"`
	Metadata   map[string]any `json:"metadata"`
	UserID     string         `json:"userId"`
}

var legacyFeedStore = struct {
	mu      sync.RWMutex
	stories map[string]legacyFeedStory
	users   map[string]legacyFeedUser
}{
	stories: map[string]legacyFeedStory{},
	users:   map[string]legacyFeedUser{},
}

func (s *Server) resolveLegacyViewerID(r *http.Request, requested string) (string, error) {
	return s.viewerID(r, requested)
}

func (s *Server) handleLegacyFeed(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	feedType := strings.TrimSpace(strings.ToLower(query.Get("feedType")))
	switch feedType {
	case "", "main":
		query.Set("segment", string(explore.SegmentFollowing))
	case "following":
		query.Set("segment", string(explore.SegmentFollowing))
	case "explore":
		query.Set("segment", string(explore.SegmentForYou))
	case "saved":
		query.Set("segment", string(explore.SegmentFollowing))
	default:
		query.Set("segment", string(explore.SegmentForYou))
	}
	r.URL.RawQuery = query.Encode()
	s.handleFeed(w, r)
}

func (s *Server) handleLegacyFeedCreateUser(w http.ResponseWriter, r *http.Request) {
	type payload struct {
		Bio         string `json:"bio"`
		DisplayName string `json:"displayName"`
		Email       string `json:"email"`
		Username    string `json:"username"`
	}
	var input payload
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_feed_user_payload")
		return
	}
	username := strings.TrimSpace(input.Username)
	if username == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_feed_user_payload", "username is required")
		return
	}

	now := time.Now().UTC().Format(time.RFC3339)
	userID := "legacy_" + newRequestID()
	user := legacyFeedUser{
		CreatedAt:  now,
		Email:      strings.TrimSpace(input.Email),
		ID:         userID,
		LastActive: now,
		Profile: map[string]any{
			"bio":         strings.TrimSpace(input.Bio),
			"displayName": strings.TrimSpace(input.DisplayName),
		},
		Stats: map[string]int{
			"comments":  0,
			"followers": 0,
			"following": 0,
			"likes":     0,
			"posts":     0,
		},
		Username: username,
	}
	legacyFeedStore.mu.Lock()
	legacyFeedStore.users[userID] = user
	legacyFeedStore.mu.Unlock()

	s.respondJSON(w, http.StatusCreated, map[string]any{"user": user})
}

func (s *Server) handleLegacyFeedFollow(w http.ResponseWriter, r *http.Request) {
	s.handleLegacyFeedFollowState(w, r, true)
}

func (s *Server) handleLegacyFeedUnfollow(w http.ResponseWriter, r *http.Request) {
	s.handleLegacyFeedFollowState(w, r, false)
}

func (s *Server) handleLegacyFeedFollowState(w http.ResponseWriter, r *http.Request, desired bool) {
	targetID := strings.TrimSpace(r.PathValue("userID"))
	if targetID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_user_id", "user id is required")
		return
	}

	var input legacyViewerInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_follow_payload")
		return
	}

	viewerID, err := s.resolveLegacyViewerID(r, input.UserID)
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	response, err := s.ensureFollowState(ctx, viewerID, targetID, desired)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrCreatorNotFound):
			s.respondError(w, http.StatusNotFound, "creator_not_found", "Kullanici bulunamadi.")
		case errors.Is(err, explore.ErrInvalidFollowAction):
			s.respondError(w, http.StatusBadRequest, "invalid_follow_action", "Takip islemi gecersiz.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile etkilesim engellendi.")
		default:
			s.respondInternalError(w, "legacy_feed_follow_failed", err)
		}
		return
	}
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) ensureFollowState(
	ctx context.Context,
	viewerID string,
	targetID string,
	desiredFollowing bool,
) (explore.FollowResponse, error) {
	response, err := s.repo.ToggleFollow(ctx, viewerID, targetID)
	if err != nil {
		return explore.FollowResponse{}, err
	}
	if response.IsFollowing == desiredFollowing {
		return response, nil
	}
	return s.repo.ToggleFollow(ctx, viewerID, targetID)
}

func (s *Server) handleLegacyFeedBlock(w http.ResponseWriter, r *http.Request) {
	s.handleLegacyFeedBlockState(w, r, true)
}

func (s *Server) handleLegacyFeedUnblock(w http.ResponseWriter, r *http.Request) {
	s.handleLegacyFeedBlockState(w, r, false)
}

func (s *Server) handleLegacyFeedBlockState(w http.ResponseWriter, r *http.Request, shouldBlock bool) {
	targetID := strings.TrimSpace(r.PathValue("userID"))
	if targetID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_user_id", "user id is required")
		return
	}

	var input struct {
		BlockerID string `json:"blockerId"`
		Unblocker string `json:"unblockerId"`
	}
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_block_payload")
		return
	}

	requested := input.BlockerID
	if !shouldBlock && strings.TrimSpace(input.Unblocker) != "" {
		requested = input.Unblocker
	}

	viewerID, err := s.resolveLegacyViewerID(r, requested)
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	var response account.BlockedUserOperationResponse
	if shouldBlock {
		response, err = s.accounts.BlockUser(ctx, viewerID, targetID)
	} else {
		response, err = s.accounts.UnblockUser(ctx, viewerID, targetID)
	}
	if err != nil {
		s.respondAccountError(w, err)
		return
	}
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleLegacyFeedCreatePost(w http.ResponseWriter, r *http.Request) {
	var input legacyFeedPostInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_create_post_payload")
		return
	}

	viewerID, err := s.resolveLegacyViewerID(r, input.UserID)
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	mediaURL := ""
	mediaType := "image"
	if len(input.Media) > 0 {
		mediaURL = strings.TrimSpace(input.Media[0])
	}
	if strings.TrimSpace(mediaURL) == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_create_post_payload", "media alaninda en az bir URL gereklidir.")
		return
	}

	createInput := explore.CreateProfilePostInput{
		Caption:   strings.TrimSpace(input.Caption),
		Location:  "",
		MediaType: mediaType,
		MediaURL:  mediaURL,
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	item, err := s.repo.CreateProfilePost(ctx, viewerID, createInput)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrUserNotFound):
			s.respondError(w, http.StatusNotFound, "user_not_found", "Kullanici bulunamadi.")
		case errors.Is(err, explore.ErrInvalidCreatePostInput):
			s.respondError(w, http.StatusBadRequest, "invalid_create_post_payload", "Gonderi olusturma verisi gecersiz.")
		default:
			s.respondInternalError(w, "legacy_feed_create_post_failed", err)
		}
		return
	}
	s.respondJSON(w, http.StatusCreated, item)
}

func (s *Server) handleLegacyFeedLike(w http.ResponseWriter, r *http.Request) {
	s.handleLegacyFeedReactionState(w, r, explore.ReactionLike, true)
}

func (s *Server) handleLegacyFeedUnlike(w http.ResponseWriter, r *http.Request) {
	s.handleLegacyFeedReactionState(w, r, explore.ReactionLike, false)
}

func (s *Server) handleLegacyFeedSave(w http.ResponseWriter, r *http.Request) {
	s.handleLegacyFeedReactionState(w, r, explore.ReactionBookmark, true)
}

func (s *Server) handleLegacyFeedUnsave(w http.ResponseWriter, r *http.Request) {
	s.handleLegacyFeedReactionState(w, r, explore.ReactionBookmark, false)
}

func (s *Server) handleLegacyFeedReactionState(
	w http.ResponseWriter,
	r *http.Request,
	kind explore.ReactionKind,
	desired bool,
) {
	postID := strings.TrimSpace(r.PathValue("postID"))
	if postID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_post_id", "post id is required")
		return
	}

	var input legacyViewerInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_reaction_payload")
		return
	}
	viewerID, err := s.resolveLegacyViewerID(r, input.UserID)
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	response, err := s.ensureReactionState(ctx, postID, viewerID, kind, desired)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrPostNotFound):
			s.respondError(w, http.StatusNotFound, "post_not_found", "Gonderi bulunamadi.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu gonderiye erisim engellendi.")
		case errors.Is(err, explore.ErrProfilePrivate), errors.Is(err, explore.ErrPostAccessForbidden):
			s.respondError(w, http.StatusForbidden, "post_access_forbidden", "Bu gonderiye erisim yetkin yok.")
		default:
			s.respondInternalError(w, "legacy_feed_reaction_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) ensureReactionState(
	ctx context.Context,
	postID string,
	viewerID string,
	kind explore.ReactionKind,
	desired bool,
) (explore.ReactionResponse, error) {
	response, err := s.repo.ApplyReaction(ctx, postID, viewerID, kind)
	if err != nil {
		return explore.ReactionResponse{}, err
	}
	current := response.ViewerState.IsLiked
	if kind == explore.ReactionBookmark {
		current = response.ViewerState.IsBookmarked
	}
	if current == desired {
		return response, nil
	}
	return s.repo.ApplyReaction(ctx, postID, viewerID, kind)
}

func (s *Server) handleLegacyFeedComments(w http.ResponseWriter, r *http.Request) {
	s.handleComments(w, r)
}

func (s *Server) handleLegacyFeedCreateComment(w http.ResponseWriter, r *http.Request) {
	postID := strings.TrimSpace(r.PathValue("postID"))
	if postID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_post_id", "post id is required")
		return
	}

	var input legacyCommentInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_comment_payload")
		return
	}
	translated := explore.CommentInput{
		Text:     strings.TrimSpace(input.Content),
		ViewerID: strings.TrimSpace(input.UserID),
	}
	// Call repository directly to avoid mutating request body reuse semantics.
	viewerID, err := s.resolveLegacyViewerID(r, translated.ViewerID)
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}
	if strings.TrimSpace(translated.Text) == "" {
		s.respondError(w, http.StatusBadRequest, "comment_required", "text is required")
		return
	}
	requestCtx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	response, err := s.repo.AddComment(requestCtx, postID, viewerID, translated.Text)
	if err != nil {
		if errors.Is(err, explore.ErrPostNotFound) {
			s.respondError(w, http.StatusNotFound, "post_not_found", "Yorum yapilacak gonderi bulunamadi.")
			return
		}
		s.respondInternalError(w, "legacy_feed_comment_create_failed", err)
		return
	}
	s.respondJSON(w, http.StatusCreated, response)
}

func (s *Server) handleLegacyFeedStories(w http.ResponseWriter, r *http.Request) {
	switch r.Method + " " + r.URL.Path {
	default:
		if r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/stories/") && strings.HasSuffix(r.URL.Path, "/view") {
			s.handleLegacyFeedViewStory(w, r)
			return
		}
		if r.Method == http.MethodPost {
			s.handleLegacyFeedCreateStory(w, r)
			return
		}
		if r.Method == http.MethodGet {
			s.handleLegacyFeedUserStories(w, r)
			return
		}
		s.respondError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

func (s *Server) handleLegacyFeedCreateStory(w http.ResponseWriter, r *http.Request) {
	var input map[string]any
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_story_payload")
		return
	}
	userID := strings.TrimSpace(toString(input["userId"]))
	if userID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_story_payload", "userId is required")
		return
	}
	now := time.Now().UTC()
	story := legacyFeedStory{
		Content:   map[string]any{"media": input["media"], "caption": toString(input["caption"])},
		CreatedAt: now.Format(time.RFC3339),
		ExpiresAt: now.Add(24 * time.Hour).Format(time.RFC3339),
		ID:        "story_" + newRequestID(),
		Metadata: map[string]any{
			"viewers": []string{},
		},
		UserID: userID,
	}
	legacyFeedStore.mu.Lock()
	legacyFeedStore.stories[story.ID] = story
	legacyFeedStore.mu.Unlock()
	s.respondJSON(w, http.StatusCreated, map[string]any{"story": story})
}

func (s *Server) handleLegacyFeedUserStories(w http.ResponseWriter, r *http.Request) {
	userID := strings.TrimSpace(r.PathValue("userID"))
	if userID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_user_id", "user id is required")
		return
	}
	now := time.Now().UTC()
	stories := make([]legacyFeedStory, 0)
	legacyFeedStore.mu.RLock()
	for _, story := range legacyFeedStore.stories {
		if story.UserID != userID || story.IsDeleted {
			continue
		}
		expiresAt, err := time.Parse(time.RFC3339, story.ExpiresAt)
		if err == nil && expiresAt.Before(now) {
			continue
		}
		stories = append(stories, story)
	}
	legacyFeedStore.mu.RUnlock()
	sort.Slice(stories, func(i, j int) bool { return stories[i].CreatedAt > stories[j].CreatedAt })
	s.respondJSON(w, http.StatusOK, map[string]any{
		"hasStories": len(stories) > 0,
		"stories":    stories,
	})
}

func (s *Server) handleLegacyFeedViewStory(w http.ResponseWriter, r *http.Request) {
	storyID := strings.TrimSpace(r.PathValue("storyID"))
	if storyID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_story_id", "story id is required")
		return
	}
	var input struct {
		ViewerID string `json:"viewerId"`
	}
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_story_view_payload")
		return
	}
	viewerID := strings.TrimSpace(input.ViewerID)
	if viewerID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_story_view_payload", "viewerId is required")
		return
	}

	legacyFeedStore.mu.Lock()
	story, ok := legacyFeedStore.stories[storyID]
	if !ok || story.IsDeleted {
		legacyFeedStore.mu.Unlock()
		s.respondError(w, http.StatusNotFound, "story_not_found", "Story not found")
		return
	}
	viewers, _ := story.Metadata["viewers"].([]string)
	found := false
	for _, viewer := range viewers {
		if viewer == viewerID {
			found = true
			break
		}
	}
	if !found {
		viewers = append(viewers, viewerID)
	}
	story.Metadata["viewers"] = viewers
	legacyFeedStore.stories[storyID] = story
	legacyFeedStore.mu.Unlock()

	s.respondJSON(w, http.StatusOK, map[string]any{"success": true, "story": story})
}

func (s *Server) handleLegacyFeedNotifications(w http.ResponseWriter, r *http.Request) {
	s.handleProfileNotifications(w, r)
}

func (s *Server) handleLegacyFeedReadNotification(w http.ResponseWriter, r *http.Request) {
	notificationID := strings.TrimSpace(r.PathValue("notificationID"))
	if notificationID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_notification_id", "notification id is required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	response, err := s.accounts.MarkNotificationsReadByToken(ctx, s.bearerToken(r), account.MarkNotificationsReadInput{
		IDs: []string{notificationID},
	})
	if err != nil {
		s.respondAccountError(w, err)
		return
	}
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleLegacyFeedReadAllNotifications(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	response, err := s.accounts.MarkNotificationsReadByToken(ctx, s.bearerToken(r), account.MarkNotificationsReadInput{
		All: true,
	})
	if err != nil {
		s.respondAccountError(w, err)
		return
	}
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleLegacyFeedAnalytics(w http.ResponseWriter, r *http.Request) {
	limit := 10
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	trending, err := s.repo.SearchTrendingTags(ctx, viewerID, limit)
	if err != nil {
		s.respondInternalError(w, "legacy_feed_analytics_failed", err)
		return
	}
	s.respondJSON(w, http.StatusOK, map[string]any{
		"timeRange": "24h",
		"metrics": map[string]any{
			"trendingTagCount": len(trending.Tags),
		},
		"topHashtags": trending.Tags,
	})
}

func (s *Server) handleLegacyExploreSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		s.respondError(w, http.StatusBadRequest, "query_required", "Search query is required")
		return
	}
	values := r.URL.Query()
	values.Set("q", q)
	cloned := r.Clone(r.Context())
	urlCopy := *r.URL
	urlCopy.RawQuery = values.Encode()
	cloned.URL = &urlCopy
	s.handleExplorePostSearch(w, cloned)
}

func (s *Server) handleLegacyExploreTrending(w http.ResponseWriter, r *http.Request) {
	s.handleExploreTrendingTags(w, r)
}

func (s *Server) handleLegacyExploreCreatePost(w http.ResponseWriter, r *http.Request) {
	s.handleLegacyFeedCreatePost(w, r)
}

func (s *Server) handleLegacyExploreInteract(w http.ResponseWriter, r *http.Request) {
	postID := strings.TrimSpace(r.PathValue("postID"))
	if postID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_post_id", "post id is required")
		return
	}

	var input legacyInteractionInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_interaction_payload")
		return
	}
	viewerID, err := s.resolveLegacyViewerID(r, input.UserID)
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	switch strings.ToLower(strings.TrimSpace(input.InteractionType)) {
	case "like":
		response, applyErr := s.ensureReactionState(ctx, postID, viewerID, explore.ReactionLike, true)
		if applyErr != nil {
			s.respondInternalError(w, "legacy_explore_like_failed", applyErr)
			return
		}
		s.respondJSON(w, http.StatusOK, response)
	case "share":
		response, applyErr := s.repo.ApplyReaction(ctx, postID, viewerID, explore.ReactionShare)
		if applyErr != nil {
			s.respondInternalError(w, "legacy_explore_share_failed", applyErr)
			return
		}
		s.respondJSON(w, http.StatusOK, response)
	case "comment":
		s.respondError(w, http.StatusBadRequest, "interaction_requires_comment_content", "Comment icin /api/v1/explore/posts/{postID}/comments kullanin.")
	default:
		s.respondJSON(w, http.StatusOK, map[string]any{
			"message":         "Interaction recorded",
			"interactionType": input.InteractionType,
			"postId":          postID,
		})
	}
}

func (s *Server) handleLegacyExploreCategories(w http.ResponseWriter, _ *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]any{
		"categories": []map[string]string{
			{"key": "food", "name": "Food & Dining"},
			{"key": "travel", "name": "Travel"},
			{"key": "fashion", "name": "Fashion"},
			{"key": "tech", "name": "Technology"},
			{"key": "fitness", "name": "Fitness"},
			{"key": "art", "name": "Art & Design"},
			{"key": "music", "name": "Music"},
			{"key": "nature", "name": "Nature"},
		},
	})
}

func (s *Server) handleLegacyExploreAnalytics(w http.ResponseWriter, r *http.Request) {
	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	tags, err := s.repo.SearchTrendingTags(ctx, viewerID, 20)
	if err != nil {
		s.respondInternalError(w, "legacy_explore_analytics_failed", err)
		return
	}
	s.respondJSON(w, http.StatusOK, map[string]any{
		"timeRange":    "24h",
		"topHashtags":  tags.Tags,
		"topCategories": []any{},
		"metrics":      map[string]any{"tagCount": len(tags.Tags)},
	})
}

func (s *Server) handleLegacyMessagesTyping(w http.ResponseWriter, r *http.Request) {
	conversationID := strings.TrimSpace(r.PathValue("conversationID"))
	if conversationID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_conversation_id", "conversation id is required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}
	s.respondJSON(w, http.StatusOK, map[string]any{
		"conversationId": conversationID,
		"status":         "ok",
		"typingUserId":   identity.UserID,
		"updatedAt":      time.Now().UTC(),
	})
}

func (s *Server) handleLegacyMessagesAttachments(w http.ResponseWriter, r *http.Request) {
	conversationID := strings.TrimSpace(r.PathValue("conversationID"))
	if conversationID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_conversation_id", "conversation id is required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if _, err := s.requireIdentity(ctx, r); err != nil {
		s.respondAccountError(w, err)
		return
	}
	s.respondJSON(w, http.StatusAccepted, map[string]any{
		"conversationId": conversationID,
		"status":         "accepted",
		"supported":      false,
		"message":        "Attachment endpoint alindi; dosya pipeline'i bu surumde voice/profil medya endpointleri uzerinden ilerliyor.",
	})
}

func (s *Server) handleLegacyMessagesBlockUser(w http.ResponseWriter, r *http.Request) {
	s.handleLegacyMessagesBlockState(w, r, true)
}

func (s *Server) handleLegacyMessagesUnblockUser(w http.ResponseWriter, r *http.Request) {
	s.handleLegacyMessagesBlockState(w, r, false)
}

func (s *Server) handleLegacyMessagesBlockState(w http.ResponseWriter, r *http.Request, shouldBlock bool) {
	targetID := strings.TrimSpace(r.PathValue("userID"))
	if targetID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_user_id", "user id is required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	var response account.BlockedUserOperationResponse
	if shouldBlock {
		response, err = s.accounts.BlockUser(ctx, identity.UserID, targetID)
	} else {
		response, err = s.accounts.UnblockUser(ctx, identity.UserID, targetID)
	}
	if err != nil {
		s.respondAccountError(w, err)
		return
	}
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleLegacyVoiceUpload(w http.ResponseWriter, r *http.Request) {
	s.handleUploadVoiceMessage(w, r)
}

func (s *Server) handleLegacyVoiceFile(w http.ResponseWriter, r *http.Request) {
	legacyKey := strings.TrimSpace(r.PathValue("filename"))
	if legacyKey == "" {
		s.respondError(w, http.StatusNotFound, "voice_not_found", "Ses dosyasi bulunamadi.")
		return
	}

	resolvedID := s.resolveLegacyVoiceIDByKey(legacyKey)
	if strings.TrimSpace(resolvedID) == "" {
		s.respondError(w, http.StatusNotFound, "voice_not_found", "Ses dosyasi bulunamadi.")
		return
	}
	cloned := r.Clone(r.Context())
	cloned.SetPathValue("voiceMessageID", resolvedID)
	s.handleVoiceMessageFile(w, cloned)
}

func (s *Server) handleLegacyVoiceDelete(w http.ResponseWriter, r *http.Request) {
	voiceMessageID := strings.TrimSpace(r.PathValue("filename"))
	if voiceMessageID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_voice_id", "voice id is required")
		return
	}
	resolvedID := s.resolveLegacyVoiceIDByKey(voiceMessageID)
	if resolvedID == "" {
		s.respondError(w, http.StatusNotFound, "voice_not_found", "Ses dosyasi bulunamadi.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.voiceFilesMu.RLock()
	record, ok := s.voiceFiles[resolvedID]
	s.voiceFilesMu.RUnlock()
	if !ok {
		s.respondError(w, http.StatusNotFound, "voice_not_found", "Ses dosyasi bulunamadi.")
		return
	}
	if identity.UserID != record.UploaderID {
		s.respondError(w, http.StatusForbidden, "voice_delete_forbidden", "Bu ses dosyasini silme yetkin yok.")
		return
	}
	if err := s.deleteVoiceFileByID(resolvedID); err != nil {
		s.respondInternalError(w, "legacy_voice_delete_failed", err)
		return
	}
	s.respondJSON(w, http.StatusOK, map[string]any{
		"deleted": true,
		"id":      resolvedID,
	})
}

func (s *Server) handleLegacyVoiceList(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.voiceFilesMu.RLock()
	items := make([]voiceFileRecord, 0, len(s.voiceFiles))
	for _, item := range s.voiceFiles {
		if identity.UserID == item.UploaderID || identity.UserID == item.PeerID {
			items = append(items, item)
		}
	}
	s.voiceFilesMu.RUnlock()

	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedAt > items[j].CreatedAt
	})

	response := make([]map[string]any, 0, len(items))
	for _, item := range items {
		response = append(response, map[string]any{
			"filename":  item.FileName,
			"id":        item.ID,
			"mimeType":  item.MimeType,
			"size":      item.SizeBytes,
			"createdAt": item.CreatedAt,
			"url":       "/api/v1/voice/file/" + item.ID,
		})
	}
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) resolveLegacyVoiceIDByKey(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return ""
	}
	s.voiceFilesMu.RLock()
	defer s.voiceFilesMu.RUnlock()
	if _, ok := s.voiceFiles[key]; ok {
		return key
	}
	for id, item := range s.voiceFiles {
		if strings.EqualFold(strings.TrimSpace(item.FileName), key) {
			return id
		}
	}
	return ""
}

func toString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	default:
		return ""
	}
}
