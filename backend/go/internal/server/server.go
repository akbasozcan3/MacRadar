package server

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"

	"macradar/backend/internal/account"
	"macradar/backend/internal/cache"
	"macradar/backend/internal/config"
	"macradar/backend/internal/explore"
	"macradar/backend/internal/messages"
	"macradar/backend/internal/realtime"
	"macradar/backend/internal/sensors"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

type Server struct {
	accounts         *account.Service
	cfg              config.Config
	cache            cache.Store
	hub              *explore.Hub
	logger           *slog.Logger
	messageHub       *messages.Hub
	players          *realtime.Hub
	postMediaFiles   map[string]postMediaFileRecord
	postMediaFilesMu sync.RWMutex
	requestEventDedupe   map[string]time.Time
	requestEventDedupeMu sync.Mutex
	rateLimiter      *requestRateLimiter
	repo             *explore.Repository
	sensorBridge     *sensors.Bridge
	sensorHub        *sensors.Hub
	upgrader         websocket.Upgrader
	voiceFiles       map[string]voiceFileRecord
	voiceFilesMu     sync.RWMutex
}

type responseEnvelope struct {
	Data    any            `json:"data,omitempty"`
	Error   *errorEnvelope `json:"error,omitempty"`
	Success bool           `json:"success"`
}

type errorEnvelope struct {
	Code      string         `json:"code"`
	Details   map[string]any `json:"details,omitempty"`
	Message   string         `json:"message"`
	RequestID string         `json:"requestId,omitempty"`
	Status    int            `json:"status"`
}

type contextKey string

const requestIDContextKey contextKey = "request_id"
const requestLanguageContextKey contextKey = "request_language"

var (
	errRequestBodyRequired  = errors.New("request body is required")
	errRequestBodyTooLarge  = errors.New("request body is too large")
	errSingleJSONObjectBody = errors.New("request body must contain a single JSON object")
)

type statusResponseWriter struct {
	http.ResponseWriter
	bytes       int64
	language    account.AppLanguage
	status      int
	wroteHeader bool
}

func New(
	cfg config.Config,
	logger *slog.Logger,
	accounts *account.Service,
	repo *explore.Repository,
	responseCache cache.Store,
	hub *explore.Hub,
	sensorHub *sensors.Hub,
	sensorBridge *sensors.Bridge,
) *Server {
	if sensorHub == nil {
		sensorHub = sensors.NewHub(logger)
	}

	var redisClient *redis.Client
	if redisStore, ok := responseCache.(*cache.RedisStore); ok {
		redisClient = redisStore.Client()
	}

	if responseCache == nil {
		responseCache = cache.NoopStore{}
	}

	server := &Server{
		accounts:   accounts,
		cache:      responseCache,
		cfg:        cfg,
		hub:        hub,
		logger:     logger,
		messageHub: messages.NewHub(logger, redisClient),
		players: realtime.NewHub(logger, redisClient, trackingRecorder{
			inactivityTimeout: cfg.TrackingSessionInactivityTimeout,
			repo:              repo,
		}),
		postMediaFiles:      make(map[string]postMediaFileRecord),
		requestEventDedupe:  make(map[string]time.Time),
		rateLimiter:         newRequestRateLimiter(time.Now),
		repo:                repo,
		sensorBridge:        sensorBridge,
		sensorHub:           sensorHub,
		voiceFiles:          make(map[string]voiceFileRecord),
	}

	server.upgrader = websocket.Upgrader{
		HandshakeTimeout: 5 * time.Second,
		ReadBufferSize:   2048,
		WriteBufferSize:  2048,
		CheckOrigin: func(r *http.Request) bool {
			return server.isWebSocketOriginAllowed(r)
		},
	}

	server.loadVoiceFilesIndex()
	server.loadPostMediaFilesIndex()

	return server
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("GET /api/v1/app/bootstrap", s.handleBootstrap)
	mux.HandleFunc("GET /api/v1/meta/country-calling-codes", s.handleCountryCallingCodes)
	mux.HandleFunc("GET /api/v1/app/i18n", s.handleAppI18n)
	mux.HandleFunc("GET /api/v1/app/overview", s.handleOverview)
	mux.HandleFunc("GET /api/v1/username/check", s.handleUsernameCheck)
	mux.HandleFunc("POST /api/v1/auth/register", s.handleRegister)
	mux.HandleFunc("POST /api/v1/auth/login", s.handleLogin)
	mux.HandleFunc("GET /api/v1/auth/verify-email", s.handleVerifyEmail)
	mux.HandleFunc("POST /api/v1/auth/verify-email/confirm", s.handleConfirmVerifyEmail)
	mux.HandleFunc("POST /api/v1/auth/resend-verification", s.handleResendVerification)
	mux.HandleFunc("POST /api/v1/auth/password-reset/request", s.handlePasswordResetRequest)
	mux.HandleFunc("POST /api/v1/auth/password-reset/confirm", s.handlePasswordResetConfirm)
	mux.HandleFunc("POST /api/v1/auth/social", s.handleSocialLogin)
	mux.HandleFunc("POST /api/v1/auth/logout", s.handleLogout)
	mux.HandleFunc("POST /api/v1/dev/auth/reset", s.handleResetDevelopmentAuth)
	mux.HandleFunc("GET /api/v1/profile/me", s.handleProfile)
	mux.HandleFunc("DELETE /api/v1/profile/me", s.handleDeleteAccount)
	mux.HandleFunc("POST /api/v1/profile/me/delete/request-code", s.handleRequestDeleteAccountCode)
	mux.HandleFunc("POST /api/v1/profile/me/delete/confirm", s.handleConfirmDeleteAccount)
	mux.HandleFunc("POST /api/v1/profile/delete/request-code", s.handleRequestDeleteAccountCode)
	mux.HandleFunc("POST /api/v1/profile/delete/confirm", s.handleConfirmDeleteAccount)
	mux.HandleFunc("POST /api/v1/account/delete/request-code", s.handleRequestDeleteAccountCode)
	mux.HandleFunc("POST /api/v1/account/delete/confirm", s.handleConfirmDeleteAccount)
	mux.HandleFunc("GET /api/v1/profile/me/posts", s.handleMyProfilePosts)
	mux.HandleFunc("POST /api/v1/profile/me/posts", s.handleCreateMyProfilePost)
	mux.HandleFunc("PATCH /api/v1/profile/me/posts/{postID}", s.handleUpdateMyProfilePost)
	mux.HandleFunc("POST /api/v1/profile/me/post-media", s.handleUploadProfilePostMedia)
	mux.HandleFunc("DELETE /api/v1/profile/me/posts/{postID}", s.handleSoftDeleteMyProfilePost)
	mux.HandleFunc("GET /api/v1/profile/post-media/files/{mediaID}/thumbnail", s.handleProfilePostMediaThumbnail)
	mux.HandleFunc("GET /api/v1/profile/post-media/files/{mediaID}", s.handleProfilePostMediaFile)
	mux.HandleFunc("DELETE /api/v1/admin/profile/posts/{postID}", s.handleAdminHardDeleteProfilePost)
	mux.HandleFunc("GET /api/v1/profile/me/liked-posts", s.handleMyLikedPosts)
	mux.HandleFunc("GET /api/v1/profile/me/saved-posts", s.handleMySavedPosts)
	mux.HandleFunc("GET /api/v1/profile/users/{userID}", s.handlePublicProfile)
	mux.HandleFunc("POST /api/v1/profile/users/{userID}/report", s.handleReportUser)
	mux.HandleFunc("GET /api/v1/profile/users/{userID}/posts", s.handleProfilePosts)
	mux.HandleFunc("GET /api/v1/profile/posts/{postID}", s.handleProfilePostDetail)
	mux.HandleFunc("PATCH /api/v1/profile/me", s.handleUpdateProfile)
	mux.HandleFunc("GET /api/v1/profile/privacy", s.handleProfilePrivacy)
	mux.HandleFunc("PATCH /api/v1/profile/privacy", s.handleUpdateProfilePrivacy)
	mux.HandleFunc("GET /api/v1/map/preferences", s.handleMapPreferences)
	mux.HandleFunc("POST /api/v1/map/preferences", s.handleUpdateMapPreferences)
	mux.HandleFunc("PATCH /api/v1/map/preferences", s.handleUpdateMapPreferences)
	mux.HandleFunc("POST /api/v1/tracking/sessions/start", s.handleTrackingSessionStart)
	mux.HandleFunc("POST /api/v1/tracking/sessions/stop", s.handleTrackingSessionStop)
	mux.HandleFunc("GET /api/v1/tracking/follow/{targetUserID}", s.handleTrackingFollowPath)
	mux.HandleFunc("POST /api/v1/tracking/ingest", s.handleTrackingIngest)
	mux.HandleFunc("GET /api/v1/profile/app-settings", s.handleProfileAppSettings)
	mux.HandleFunc("GET /api/v1/profile/request-summary", s.handleProfileRequestSummary)
	mux.HandleFunc("GET /api/v1/profile/notifications", s.handleProfileNotifications)
	mux.HandleFunc("POST /api/v1/profile/notifications/read", s.handleMarkNotificationsRead)
	mux.HandleFunc("GET /api/v1/profile/help", s.handleProfileHelp)
	mux.HandleFunc("PATCH /api/v1/profile/app-settings", s.handleUpdateProfileAppSettings)
	mux.HandleFunc("GET /api/v1/profile/follow-requests", s.handleFollowRequests)
	mux.HandleFunc("POST /api/v1/profile/follow-requests/{requesterID}/accept", s.handleAcceptFollowRequest)
	mux.HandleFunc("POST /api/v1/profile/follow-requests/{requesterID}/reject", s.handleRejectFollowRequest)
	mux.HandleFunc("GET /api/v1/profile/followers", s.handleFollowers)
	mux.HandleFunc("GET /api/v1/profile/following", s.handleFollowing)
	mux.HandleFunc("DELETE /api/v1/profile/followers/{followerID}", s.handleRemoveFollower)
	mux.HandleFunc("GET /api/v1/profile/blocked-users", s.handleBlockedUsers)
	mux.HandleFunc("POST /api/v1/profile/blocked-users/{blockedUserID}", s.handleBlockUser)
	mux.HandleFunc("DELETE /api/v1/profile/blocked-users/{blockedUserID}", s.handleUnblockUser)
	mux.HandleFunc("POST /api/v1/profile/change-password", s.handleChangePassword)
	mux.HandleFunc("GET /api/v1/explore/feed", s.handleFeed)
	mux.HandleFunc("GET /api/v1/explore/posts/{postID}/comments", s.handleComments)
	mux.HandleFunc("POST /api/v1/explore/posts/{postID}/comments", s.handleCreateComment)
	mux.HandleFunc("POST /api/v1/explore/comments/{commentID}/like", s.handleToggleCommentLike)
	mux.HandleFunc("GET /api/v1/explore/posts/{postID}/reactions", s.handlePostEngagementUsers)
	mux.HandleFunc("POST /api/v1/explore/posts/{postID}/reactions", s.handleReaction)
	mux.HandleFunc("POST /api/v1/explore/posts/{postID}/report", s.handleReportPost)
	mux.HandleFunc("POST /api/v1/explore/creators/{creatorID}/follow", s.handleFollow)
	mux.HandleFunc("POST /api/v1/explore/creators/{creatorID}/street-friend", s.handleUpsertStreetFriend)
	mux.HandleFunc("GET /api/v1/explore/search/users", s.handleExploreUserSearch)
	mux.HandleFunc("GET /api/v1/explore/search/places", s.handleExplorePlacesSearch)
	mux.HandleFunc("GET /api/v1/locations/search", s.handleExplorePlacesSearch)
	mux.HandleFunc("GET /api/v1/location/search", s.handleExplorePlacesSearch)
	mux.HandleFunc("GET /api/v1/locations/autocomplete", s.handleExplorePlacesSearch)
	mux.HandleFunc("GET /api/v1/location/autocomplete", s.handleExplorePlacesSearch)
	mux.HandleFunc("GET /api/v1/places/search", s.handleExplorePlacesSearch)
	mux.HandleFunc("GET /api/v1/explore/search/recent-users", s.handleExploreRecentUsers)
	mux.HandleFunc("POST /api/v1/explore/search/recent-users", s.handleRecordExploreRecentUser)
	mux.HandleFunc("DELETE /api/v1/explore/search/recent-users", s.handleClearExploreRecentUsers)
	mux.HandleFunc("DELETE /api/v1/explore/search/recent-users/{userID}", s.handleRemoveExploreRecentUser)
	mux.HandleFunc("GET /api/v1/explore/search/recent-terms", s.handleExploreRecentSearchTerms)
	mux.HandleFunc("POST /api/v1/explore/search/recent-terms", s.handleRecordExploreRecentSearchTerm)
	mux.HandleFunc("DELETE /api/v1/explore/search/recent-terms", s.handleClearExploreRecentSearchTerms)
	mux.HandleFunc("DELETE /api/v1/explore/search/recent-terms/item", s.handleRemoveExploreRecentSearchTerm)
	mux.HandleFunc("GET /api/v1/explore/search/posts", s.handleExplorePostSearch)
	mux.HandleFunc("GET /api/v1/explore/search/popular-terms", s.handleExplorePopularSearchTerms)
	mux.HandleFunc("GET /api/v1/explore/search/trending-tags", s.handleExploreTrendingTags)
	mux.HandleFunc("GET /api/v1/explore/tags/{tag}", s.handleExploreTagDetail)
	mux.HandleFunc("GET /api/v1/explore/friends", s.handleStreetFriends)
	mux.HandleFunc("GET /api/v1/explore/friends/{friendID}/status", s.handleStreetFriendStatus)
	mux.HandleFunc("DELETE /api/v1/explore/friends/{friendID}", s.handleRemoveStreetFriend)
	mux.HandleFunc("GET /api/v1/explore/street-friend-requests", s.handleStreetFriendRequests)
	mux.HandleFunc("GET /api/v1/app/map-bootstrap", s.handleMapBootstrap)
	mux.HandleFunc("GET /api/v1/messages/conversations", s.handleConversations)
	mux.HandleFunc("POST /api/v1/messages/conversations", s.handleCreateConversation)
	mux.HandleFunc("DELETE /api/v1/messages/conversations/{conversationID}", s.handleDeleteConversation)
	mux.HandleFunc("DELETE /api/v1/messages/conversations/{conversationID}/hard", s.handleHardDeleteConversation)
	mux.HandleFunc("POST /api/v1/messages/conversations/{conversationID}/clear", s.handleClearConversation)
	mux.HandleFunc("GET /api/v1/messages/conversations/{conversationID}/messages", s.handleConversationMessages)
	mux.HandleFunc("PATCH /api/v1/messages/conversations/{conversationID}/mute", s.handleSetConversationMuted)
	mux.HandleFunc("POST /api/v1/messages/conversations/{conversationID}/messages", s.handleSendConversationMessage)
	mux.HandleFunc("POST /api/v1/messages/conversations/{conversationID}/voice", s.handleSendConversationVoiceMessage)
	mux.HandleFunc("POST /api/v1/messages/conversations/{conversationID}/read", s.handleMarkConversationRead)
	mux.HandleFunc("POST /api/v1/messages/conversations/{conversationID}/request/accept", s.handleAcceptConversationRequest)
	mux.HandleFunc("POST /api/v1/messages/conversations/{conversationID}/request/reject", s.handleRejectConversationRequest)
	mux.HandleFunc("POST /api/v1/messages/voice/upload", s.handleUploadVoiceMessage)
	mux.HandleFunc("GET /api/v1/messages/voice/files/{voiceMessageID}", s.handleVoiceMessageFile)
	mux.HandleFunc("GET /ws/explore", s.handleWebSocket)
	mux.HandleFunc("GET /ws/messages", s.handleMessagesWebSocket)
	mux.HandleFunc("GET /ws/notifications", s.handleNotificationsWebSocket)
	mux.HandleFunc("GET /ws/players", s.handlePlayersWebSocket)
	mux.HandleFunc("GET /ws/sensors", s.handleSensorsWebSocket)

	return s.withMiddleware(mux)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if err := s.repo.Ping(ctx); err != nil {
		s.respondServerError(w, http.StatusServiceUnavailable, "database_unreachable", "Servis gecici olarak kullanilamiyor.", err)
		return
	}

	s.respondJSON(w, http.StatusOK, map[string]string{
		"service": "go",
		"status":  "ok",
	})
}

func (s *Server) handleMapBootstrap(w http.ResponseWriter, r *http.Request) {
	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	type mapBootstrapResponse struct {
		StreetFriends  explore.StreetFriendListResponse        `json:"streetFriends"`
		StreetRequests explore.StreetFriendRequestListResponse `json:"streetRequests"`
		Preferences    account.MapPreferences                  `json:"preferences"`
	}

	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	cacheKey := s.cacheKey("map-bootstrap", viewerID)
	var cached mapBootstrapResponse
	if s.cacheGetJSON(ctx, cacheKey, &cached) {
		setPrivateCacheControl(w, 5)
		s.respondJSON(w, http.StatusOK, cached)
		return
	}

	// Parallel fetch for speed
	type bootstrapResult struct {
		friends  *explore.StreetFriendListResponse
		requests *explore.StreetFriendRequestListResponse
		prefs    *account.MapPreferences
		err      error
	}

	resChan := make(chan bootstrapResult, 3)

	go func() {
		friends, err := s.repo.ListStreetFriends(ctx, viewerID)
		resChan <- bootstrapResult{friends: &friends, err: err}
	}()

	go func() {
		requests, err := s.repo.ListStreetFriendRequests(ctx, viewerID)
		resChan <- bootstrapResult{requests: &requests, err: err}
	}()

	go func() {
		prefs, err := s.accounts.MapPreferencesByToken(ctx, s.bearerToken(r))
		resChan <- bootstrapResult{prefs: &prefs, err: err}
	}()

	var response mapBootstrapResponse

	for i := 0; i < 3; i++ {
		res := <-resChan
		if res.err != nil {
			s.respondInternalError(w, "map_bootstrap_failed", res.err)
			return
		}
		if res.friends != nil {
			response.StreetFriends = *res.friends
		}
		if res.requests != nil {
			response.StreetRequests = *res.requests
		}
		if res.prefs != nil {
			response.Preferences = *res.prefs
		}
	}

	s.cacheSetJSON(ctx, cacheKey, 5*time.Second, response)
	setPrivateCacheControl(w, 5)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleFeed(w http.ResponseWriter, r *http.Request) {
	segment := explore.NormalizeSegment(r.URL.Query().Get("segment"))
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	limit := 0
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsedLimit, err := strconv.Atoi(rawLimit)
		if err != nil {
			s.respondError(w, http.StatusBadRequest, "invalid_feed_limit", "Feed limit sayisal olmali.")
			return
		}
		limit = parsedLimit
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	useFeedCache := cursor == ""
	cacheKey := ""
	if useFeedCache {
		cacheKey = s.cacheKey("feed", viewerID, string(segment), strconv.Itoa(limit))
		var cached explore.FeedResponse
		if s.cacheGetJSON(ctx, cacheKey, &cached) {
			setPrivateCacheControl(w, 20)
			s.respondJSON(w, http.StatusOK, cached)
			return
		}
	}

	response, err := s.repo.ListFeed(ctx, explore.FeedPageQuery{
		Cursor:   cursor,
		Limit:    limit,
		Segment:  segment,
		ViewerID: viewerID,
	})
	if err != nil {
		if errors.Is(err, explore.ErrInvalidFeedCursor) {
			s.respondError(w, http.StatusBadRequest, "invalid_feed_cursor", "Feed cursor gecersiz.")
			return
		}
		s.respondInternalError(w, "feed_query_failed", err)
		return
	}

	if useFeedCache {
		s.cacheSetJSON(ctx, cacheKey, 20*time.Second, response)
	}
	setPrivateCacheControl(w, 20)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleComments(w http.ResponseWriter, r *http.Request) {
	postID := strings.TrimSpace(r.PathValue("postID"))
	if postID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_post_id", "post id is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	cacheKey := s.cacheKey("comments", viewerID, postID)
	var cached explore.CommentsResponse
	if s.cacheGetJSON(ctx, cacheKey, &cached) {
		s.respondJSON(w, http.StatusOK, cached)
		return
	}

	response, err := s.repo.ListComments(ctx, postID, viewerID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrPostNotFound):
			s.respondError(w, http.StatusNotFound, "post_not_found", "Yorumlari gosterilecek gonderi bulunamadi.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu gonderiye erisim engellendi.")
		case errors.Is(err, explore.ErrProfilePrivate), errors.Is(err, explore.ErrPostAccessForbidden):
			s.respondError(w, http.StatusForbidden, "post_access_forbidden", "Bu gonderiyi gorme yetkin yok.")
		default:
			s.respondInternalError(w, "comments_query_failed", err)
		}
		return
	}

	// Comments can be expensive to fetch repeatedly. Cache longer during a session-like window.
	s.cacheSetJSON(ctx, cacheKey, 5*time.Minute, response)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleCreateComment(w http.ResponseWriter, r *http.Request) {
	postID := strings.TrimSpace(r.PathValue("postID"))
	if postID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_post_id", "post id is required")
		return
	}

	var input explore.CommentInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_comment_payload")
		return
	}

	if strings.TrimSpace(input.Text) == "" {
		s.respondError(w, http.StatusBadRequest, "comment_required", "text is required")
		return
	}

	viewerID, err := s.viewerID(r, input.ViewerID)
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.repo.AddComment(ctx, postID, viewerID, input.Text)
	if err != nil {
		if errors.Is(err, explore.ErrPostNotFound) {
			s.respondError(w, http.StatusNotFound, "post_not_found", "Yorum yapilacak gonderi bulunamadi.")
			return
		}
		if errors.Is(err, explore.ErrBlockedRelationship) {
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu gonderiye yorum yapamazsin.")
			return
		}
		if errors.Is(err, explore.ErrProfilePrivate) || errors.Is(err, explore.ErrPostAccessForbidden) {
			s.respondError(w, http.StatusForbidden, "post_access_forbidden", "Bu gonderiye yorum yapma yetkin yok.")
			return
		}
		s.respondInternalError(w, "comment_create_failed", err)
		return
	}

	s.cacheInvalidatePrefixes(
		ctx,
		s.cacheKey("comments", viewerID, postID),
		s.cacheKey("feed", viewerID),
	)

	s.hub.Broadcast(explore.RealtimeEvent{
		Comment:    &response.Comment,
		PostID:     response.PostID,
		Segment:    response.Segment,
		ServerTime: time.Now().UTC(),
		Stats:      &response.Stats,
		Type:       "comment.created",
	})

	s.respondJSON(w, http.StatusCreated, response)
}

func (s *Server) handleToggleCommentLike(w http.ResponseWriter, r *http.Request) {
	commentID := strings.TrimSpace(r.PathValue("commentID"))
	if commentID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_comment_id", "comment id is required")
		return
	}

	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.repo.ToggleCommentLike(ctx, commentID, viewerID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrCommentNotFound):
			s.respondError(w, http.StatusNotFound, "comment_not_found", "Begeni yapilacak yorum bulunamadi.")
		case errors.Is(err, explore.ErrPostNotFound):
			s.respondError(w, http.StatusNotFound, "post_not_found", "Yorumun ait oldugu gonderi bulunamadi.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu yoruma erisim engellendi.")
		case errors.Is(err, explore.ErrProfilePrivate), errors.Is(err, explore.ErrPostAccessForbidden):
			s.respondError(w, http.StatusForbidden, "post_access_forbidden", "Bu yoruma erisim yetkin yok.")
		default:
			s.respondInternalError(w, "comment_like_toggle_failed", err)
		}
		return
	}

	s.cacheInvalidatePrefixes(ctx, s.cacheKey("comments", viewerID))
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleReaction(w http.ResponseWriter, r *http.Request) {
	postID := strings.TrimSpace(r.PathValue("postID"))
	if postID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_post_id", "post id is required")
		return
	}

	var input explore.ReactionInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_reaction_payload")
		return
	}

	viewerID, err := s.viewerID(r, input.ViewerID)
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}
	reactionKind, ok := explore.ParseReactionKind(string(input.Kind))
	if !ok {
		s.respondError(w, http.StatusBadRequest, "invalid_reaction_kind", "Reaction turu like, bookmark veya share olmalidir.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.repo.ApplyReaction(ctx, postID, viewerID, reactionKind)
	if err != nil {
		if errors.Is(err, explore.ErrPostNotFound) {
			s.respondError(w, http.StatusNotFound, "post_not_found", "Etkilesim yapilacak gonderi bulunamadi.")
			return
		}
		if errors.Is(err, explore.ErrBlockedRelationship) {
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu gonderiye erisim engellendi.")
			return
		}
		if errors.Is(err, explore.ErrProfilePrivate) || errors.Is(err, explore.ErrPostAccessForbidden) {
			s.respondError(w, http.StatusForbidden, "post_access_forbidden", "Bu gonderiye etkilesim yetkin yok.")
			return
		}
		s.respondInternalError(w, "reaction_update_failed", err)
		return
	}

	s.cacheInvalidatePrefixes(
		ctx,
		s.cacheKey("feed", viewerID),
		s.cacheKey("liked-posts", viewerID),
		s.cacheKey("saved-posts", viewerID),
	)

	// Invalidate engagement lists globally for this post.
	s.cacheInvalidatePrefixes(
		ctx,
		s.cacheKey(
			"post-engagement-users",
			response.PostID,
			string(explore.ReactionLike),
		),
		s.cacheKey(
			"post-engagement-users",
			response.PostID,
			string(explore.ReactionBookmark),
		),
	)

	s.hub.Broadcast(explore.RealtimeEvent{
		PostID:      response.PostID,
		Segment:     response.Segment,
		ServerTime:  time.Now().UTC(),
		Stats:       &response.Stats,
		Type:        "post.updated",
		ViewerState: &response.ViewerState,
	})

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleReportPost(w http.ResponseWriter, r *http.Request) {
	postID := strings.TrimSpace(r.PathValue("postID"))
	if postID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_post_id", "post id is required")
		return
	}

	var input explore.ReportInput
	if err := s.decodeJSON(r, &input); err != nil && !errors.Is(err, io.EOF) {
		s.respondDecodeError(w, err, "invalid_post_report_payload")
		return
	}

	viewerID, err := s.viewerID(r, input.ViewerID)
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.repo.ReportPost(ctx, postID, viewerID, input.Reason)
	if err != nil {
		if errors.Is(err, explore.ErrPostNotFound) {
			s.respondError(w, http.StatusNotFound, "post_not_found", "Bildirilecek gonderi bulunamadi.")
			return
		}
		if errors.Is(err, explore.ErrBlockedRelationship) {
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu gonderiye erisim engellendi.")
			return
		}
		if errors.Is(err, explore.ErrProfilePrivate) || errors.Is(err, explore.ErrPostAccessForbidden) {
			s.respondError(w, http.StatusForbidden, "post_access_forbidden", "Bu gonderiyi bildirme yetkin yok.")
			return
		}
		s.respondInternalError(w, "post_report_failed", err)
		return
	}

	s.respondJSON(w, http.StatusCreated, response)
}

func (s *Server) handleFollow(w http.ResponseWriter, r *http.Request) {
	creatorID := strings.TrimSpace(r.PathValue("creatorID"))
	if creatorID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_creator_id", "creator id is required")
		return
	}

	var input explore.FollowInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_follow_payload")
		return
	}

	viewerID, err := s.viewerID(r, input.ViewerID)
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.repo.ToggleFollow(ctx, viewerID, creatorID)
	if err != nil {
		if errors.Is(err, explore.ErrCreatorNotFound) {
			s.respondError(w, http.StatusNotFound, "creator_not_found", "Takip edilecek kullanici bulunamadi.")
			return
		}
		if errors.Is(err, explore.ErrBlockedRelationship) {
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile takip islemi engellendi.")
			return
		}
		if errors.Is(err, explore.ErrInvalidFollowAction) {
			s.respondError(w, http.StatusBadRequest, "invalid_follow_action", "Takip islemi gecersiz.")
			return
		}
		s.respondInternalError(w, "follow_update_failed", err)
		return
	}

	followersBroadcast := response.FollowersCount
	s.hub.Broadcast(explore.RealtimeEvent{
		CreatorID:             response.CreatorID,
		CreatorFollowersCount: &followersBroadcast,
		FollowerID:            viewerID,
		ServerTime:            time.Now().UTC(),
		Type:                  "creator.follow.updated",
		ViewerState: &explore.ViewerState{
			FollowRequestStatus: response.FollowRequestStatus,
			IsFollowing:         response.IsFollowing,
		},
	})

	// Notify target user in real-time so follow request badges drop instantly.
	if response.FollowRequestStatus == explore.FollowRequestStatusPendingOutgoing {
		notifID := explore.FollowRequestNotificationID(viewerID, creatorID)
		s.messageHub.BroadcastToUser(creatorID, map[string]any{
			"type": "notification.created",
			"notification": map[string]any{
				"actorId":    viewerID,
				"body":       "Sana yeni takip istegi gonderildi.",
				"channel":    "follow_requests",
				"createdAt":  time.Now().UTC().Format(time.RFC3339Nano),
				"fromUserId": viewerID,
				"id":         notifID,
				"isRead":     false,
				"metadata": map[string]any{
					"requesterId": viewerID,
					"targetId":    creatorID,
				},
				"title":  "Yeni takip istegi",
				"type":   "follow.request.created",
				"userId": creatorID,
			},
		})
		s.broadcastRequestRealtimeEvent(
			creatorID,
			"request.created",
			"follow",
			viewerID,
			creatorID,
			1,
			"created",
		)
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.logger.Error("websocket upgrade failed", slog.Any("error", err))
		return
	}

	client := s.hub.Register(conn)
	go client.WritePump()

	client.Enqueue(mustJSON(explore.RealtimeEvent{
		ServerTime: time.Now().UTC(),
		Type:       "welcome",
	}))

	client.ReadPump(func() {
		s.hub.Unregister(client)
	})
}

func (s *Server) withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Render (and some proxies) occasionally append trailing whitespace to the
		// configured health-check path; stdlib ServeMux matches literally, so normalize.
		if trimmed := strings.TrimSpace(r.URL.Path); trimmed != r.URL.Path {
			u := *r.URL
			u.Path = trimmed
			r = r.Clone(r.Context())
			r.URL = &u
		}

		startedAt := time.Now()
		requestID := requestIDFromHeader(r)
		requestLanguage := s.resolveRequestLanguage(r)
		routeGroup := describeRouteGroup(r)
		rateLimited := false
		if requestID == "" {
			requestID = newRequestID()
		}

		recorder := &statusResponseWriter{
			ResponseWriter: w,
			language:       requestLanguage,
		}
		recorder.Header().Set("Content-Language", string(requestLanguage))
		recorder.Header().Set("X-Request-Id", requestID)

		ctx := context.WithValue(r.Context(), requestIDContextKey, requestID)
		ctx = context.WithValue(ctx, requestLanguageContextKey, requestLanguage)
		r = r.WithContext(ctx)

		if limit := requestBodyLimitBytes(r, s.cfg.MaxRequestBodyBytes); r.Body != nil && limit > 0 {
			r.Body = http.MaxBytesReader(recorder, r.Body, limit)
		}

		defer func() {
			if recovered := recover(); recovered != nil {
				s.logger.Error(
					"http_panic_recovered",
					slog.String("request_id", requestID),
					slog.String("method", r.Method),
					slog.String("path", r.URL.Path),
					slog.Any("panic", recovered),
					slog.String("stack", string(debug.Stack())),
				)
				if !recorder.wroteHeader {
					s.respondError(recorder, http.StatusInternalServerError, "internal_server_error", "Beklenmeyen bir sunucu hatasi olustu.")
				}
			}

			s.logger.Info(
				"http_request",
				slog.String("request_id", requestID),
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.String("route_group", routeGroup),
				slog.String("language", string(requestLanguage)),
				slog.Bool("rate_limited", rateLimited),
				slog.Int("status", recorder.statusCode()),
				slog.Int64("bytes", recorder.bytes),
				slog.Int64("duration_ms", time.Since(startedAt).Milliseconds()),
				slog.String("ip", s.clientMetadata(r).IPAddress),
			)
		}()

		s.applySecurityHeaders(recorder)
		s.applyCORS(recorder, r)
		if r.Method == http.MethodOptions {
			recorder.WriteHeader(http.StatusNoContent)
			return
		}

		if decision, limited := s.rateLimitDecision(r); limited {
			s.applyRateLimitHeaders(recorder, decision)
			if !decision.Allowed {
				rateLimited = true
				retryAfter := retryAfterSeconds(decision.RetryAfter)
				recorder.Header().Set("Retry-After", strconv.Itoa(retryAfter))
				if s.logger != nil {
					s.logger.Warn(
						"http_rate_limited",
						slog.String("request_id", requestID),
						slog.String("path", r.URL.Path),
						slog.String("method", r.Method),
						slog.String("route_group", routeGroup),
						slog.String("scope", decision.Scope),
						slog.Int("limit", decision.Limit),
						slog.Int("retry_after_seconds", retryAfter),
						slog.String("ip", s.clientMetadata(r).IPAddress),
					)
				}
				s.respondErrorWithDetails(recorder, http.StatusTooManyRequests, "rate_limit_exceeded", "Cok sik istek gonderiyorsunuz. Lutfen biraz bekleyin.", map[string]any{
					"limit":             decision.Limit,
					"retryAfterSeconds": retryAfter,
					"retryAt":           decision.ResetAt.UTC(),
					"scope":             decision.Scope,
				})
				return
			}
		}

		next.ServeHTTP(recorder, r)
	})
}

func (s *Server) applyCORS(w http.ResponseWriter, r *http.Request) {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" {
		w.Header().Add("Vary", "Origin")
	}

	if origin != "" && s.isOriginAllowed(origin) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
	}
	if origin == "" {
		w.Header().Set("Access-Control-Allow-Origin", "*")
	}

	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-MacRadar-Reset-Token, X-Request-Id")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Expose-Headers", "Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Request-Id")
	w.Header().Set("Access-Control-Max-Age", "600")
}

func (s *Server) applySecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
	w.Header().Set("Cross-Origin-Resource-Policy", "same-site")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-DNS-Prefetch-Control", "off")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("X-Permitted-Cross-Domain-Policies", "none")

	if strings.EqualFold(s.cfg.Environment, "production") {
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
	}
}

func (s *Server) isOriginAllowed(origin string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return false
	}

	for _, allowedOrigin := range s.cfg.AllowedOrigins {
		if allowedOrigin == "*" || strings.EqualFold(origin, allowedOrigin) {
			return true
		}
	}

	if strings.EqualFold(s.cfg.Environment, "production") {
		return false
	}

	originURL, err := url.Parse(origin)
	if err != nil || originURL.Host == "" {
		return false
	}

	return isLocalDevelopmentHost(originURL.Hostname())
}

func (s *Server) isWebSocketOriginAllowed(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" || strings.EqualFold(origin, "null") {
		return true
	}
	if s.isOriginAllowed(origin) {
		return true
	}

	originURL, err := url.Parse(origin)
	if err != nil || originURL.Host == "" {
		return false
	}

	originHost := strings.TrimSpace(strings.ToLower(originURL.Hostname()))
	if originHost == "" {
		return false
	}

	requestHost := strings.TrimSpace(strings.ToLower(r.Host))
	if requestHost != "" {
		if host, _, splitErr := net.SplitHostPort(requestHost); splitErr == nil {
			requestHost = strings.TrimSpace(strings.ToLower(host))
		}
		if requestHost != "" && originHost == requestHost {
			return true
		}
	}

	if strings.EqualFold(s.cfg.Environment, "production") {
		return false
	}

	return isLocalDevelopmentHost(originHost)
}

func isLocalDevelopmentHost(host string) bool {
	host = strings.TrimSpace(strings.ToLower(host))
	if host == "" {
		return false
	}

	switch host {
	case "localhost", "127.0.0.1", "::1", "10.0.2.2", "10.0.3.2":
		return true
	}

	if parsedIP := net.ParseIP(host); parsedIP != nil {
		return parsedIP.IsLoopback() || parsedIP.IsPrivate() || parsedIP.IsLinkLocalUnicast()
	}

	return strings.HasSuffix(host, ".local")
}

func (s *Server) viewerID(r *http.Request, candidate string) (string, error) {
	identity, err := s.optionalIdentity(r)
	if err != nil {
		return "", err
	}
	if identity != nil {
		return identity.UserID, nil
	}
	if strings.EqualFold(s.cfg.Environment, "production") {
		return "", errors.New("authorization required")
	}

	if trimmed := strings.TrimSpace(candidate); trimmed != "" {
		return trimmed, nil
	}

	return s.cfg.ViewerUserID, nil
}

func (s *Server) decodeJSON(r *http.Request, target any) error {
	defer r.Body.Close()

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(target); err != nil {
		if errors.Is(err, io.EOF) {
			return errRequestBodyRequired
		}

		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return errRequestBodyTooLarge
		}

		return err
	}

	var extra json.RawMessage
	if err := decoder.Decode(&extra); err != nil && !errors.Is(err, io.EOF) {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return errRequestBodyTooLarge
		}

		return errSingleJSONObjectBody
	}
	if len(extra) > 0 {
		return errSingleJSONObjectBody
	}

	return nil
}

func (s *Server) respondError(w http.ResponseWriter, status int, code string, message string) {
	s.respondErrorWithDetails(w, status, code, message, nil)
}

func (s *Server) respondServerError(
	w http.ResponseWriter,
	status int,
	code string,
	message string,
	err error,
) {
	if s.logger != nil && err != nil {
		s.logger.Error(
			"http_handler_error",
			slog.String("request_id", requestIDFromWriter(w)),
			slog.String("code", code),
			slog.Int("status", status),
			slog.Any("error", err),
		)
	}

	s.respondError(w, status, code, message)
}

func (s *Server) respondInternalError(w http.ResponseWriter, code string, err error) {
	s.respondServerError(
		w,
		http.StatusInternalServerError,
		code,
		"Sunucu istegi su anda tamamlayamadi.",
		err,
	)
}

func (s *Server) respondDecodeError(w http.ResponseWriter, err error, invalidCode string) {
	switch {
	case errors.Is(err, errRequestBodyRequired):
		s.respondError(w, http.StatusBadRequest, invalidCode, "Istek govdesi zorunludur.")
	case errors.Is(err, errRequestBodyTooLarge):
		s.respondError(w, http.StatusRequestEntityTooLarge, "request_body_too_large", "Istek govdesi izin verilen boyutu asiyor.")
	case errors.Is(err, errSingleJSONObjectBody):
		s.respondError(w, http.StatusBadRequest, invalidCode, err.Error())
	default:
		s.respondError(w, http.StatusBadRequest, invalidCode, err.Error())
	}
}

func (s *Server) respondErrorWithDetails(w http.ResponseWriter, status int, code string, message string, details map[string]any) {
	requestID := requestIDFromWriter(w)
	s.writeJSON(w, status, responseEnvelope{
		Error: &errorEnvelope{
			Code:      code,
			Details:   details,
			Message:   message,
			RequestID: requestID,
			Status:    status,
		},
	})
}

func (s *Server) respondJSON(w http.ResponseWriter, status int, payload any) {
	s.writeJSON(w, status, responseEnvelope{
		Data:    payload,
		Success: true,
	})
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, payload responseEnvelope) {
	// Language localization was temporarily removed pending implementation
	// Language localization was temporarily removed pending implementation

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(payload); err != nil && s.logger != nil {
		s.logger.Error("json_encode_failed", slog.Int("status", status), slog.Any("error", err))
	}
}

func mustJSON(payload any) []byte {
	data, _ := json.Marshal(payload)
	return data
}

func (w *statusResponseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}

	w.status = status
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusResponseWriter) Write(payload []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}

	written, err := w.ResponseWriter.Write(payload)
	w.bytes += int64(written)
	return written, err
}

func (w *statusResponseWriter) ReadFrom(reader io.Reader) (int64, error) {
	downstream, ok := w.ResponseWriter.(io.ReaderFrom)
	if !ok {
		type writeOnly struct{ io.Writer }
		return io.Copy(writeOnly{w}, reader)
	}

	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}

	written, err := downstream.ReadFrom(reader)
	w.bytes += written
	return written, err
}

func (w *statusResponseWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *statusResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("response writer does not support hijacking")
	}

	return hijacker.Hijack()
}

func (w *statusResponseWriter) Push(target string, opts *http.PushOptions) error {
	pusher, ok := w.ResponseWriter.(http.Pusher)
	if !ok {
		return http.ErrNotSupported
	}

	return pusher.Push(target, opts)
}

func (w *statusResponseWriter) statusCode() int {
	if w.status != 0 {
		return w.status
	}

	return http.StatusOK
}

func (w *statusResponseWriter) responseLanguage() account.AppLanguage {
	if w.language == "" {
		return account.AppLanguageTurkish
	}

	return w.language
}

func responseLanguageFromWriter(w http.ResponseWriter) account.AppLanguage {
	type languageCarrier interface {
		responseLanguage() account.AppLanguage
	}

	carrier, ok := w.(languageCarrier)
	if !ok {
		return account.AppLanguageTurkish
	}

	language := carrier.responseLanguage()
	if language == "" {
		return account.AppLanguageTurkish
	}

	return language
}

func (s *Server) resolveRequestLanguage(r *http.Request) account.AppLanguage {
	headerLanguage := strings.TrimSpace(r.Header.Get("X-App-Language"))
	if language, ok := normalizeRequestLanguageTag(headerLanguage); ok {
		return language
	}

	acceptLanguage := strings.TrimSpace(r.Header.Get("Accept-Language"))
	if language, ok := normalizeRequestLanguageTag(firstAcceptLanguageTag(acceptLanguage)); ok {
		return language
	}

	return account.AppLanguageTurkish
}

func normalizeRequestLanguageTag(value string) (account.AppLanguage, bool) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return "", false
	}

	if strings.HasPrefix(normalized, "en") {
		return account.AppLanguageEnglish, true
	}
	if strings.HasPrefix(normalized, "tr") {
		return account.AppLanguageTurkish, true
	}

	return "", false
}

func firstAcceptLanguageTag(value string) string {
	for _, item := range strings.Split(value, ",") {
		candidate := strings.TrimSpace(item)
		if candidate == "" {
			continue
		}

		if semicolon := strings.Index(candidate, ";"); semicolon >= 0 {
			candidate = strings.TrimSpace(candidate[:semicolon])
		}

		if candidate != "" {
			return candidate
		}
	}

	return ""
}

func shouldLimitRequestBody(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPatch, http.MethodPut:
		return true
	default:
		return false
	}
}

func requestBodyLimitBytes(r *http.Request, defaultLimit int64) int64 {
	if !shouldLimitRequestBody(r.Method) || defaultLimit <= 0 {
		return 0
	}

	switch strings.TrimSpace(r.URL.Path) {
	case "/api/v1/profile/me/post-media":
		return maxProfileVideoUploadBytes + (1 << 20)
	default:
		return defaultLimit
	}
}

func requestIDFromHeader(r *http.Request) string {
	value := strings.TrimSpace(r.Header.Get("X-Request-Id"))
	if value == "" {
		return ""
	}
	if len(value) > 128 {
		return value[:128]
	}

	return value
}

func requestIDFromWriter(w http.ResponseWriter) string {
	return strings.TrimSpace(w.Header().Get("X-Request-Id"))
}

func describeRouteGroup(r *http.Request) string {
	path := strings.ToLower(strings.TrimSpace(r.URL.Path))

	switch {
	case path == "/healthz":
		return "health"
	case strings.HasPrefix(path, "/api/v1/auth/"):
		return "auth"
	case strings.HasPrefix(path, "/api/v1/profile/"):
		return "profile"
	case strings.HasPrefix(path, "/api/v1/map/"):
		return "map"
	case strings.HasPrefix(path, "/api/v1/explore/"):
		return "explore"
	case strings.HasPrefix(path, "/api/v1/messages/"):
		return "messages"
	case strings.HasPrefix(path, "/ws/"):
		return "websocket"
	default:
		return "other"
	}
}

func (s *Server) rateLimitDecision(r *http.Request) (requestRateLimitDecision, bool) {
	if s.rateLimiter == nil {
		return requestRateLimitDecision{}, false
	}

	rule, ok := s.requestRateLimitRule(r)
	if !ok {
		return requestRateLimitDecision{}, false
	}

	ipAddress := strings.TrimSpace(s.clientMetadata(r).IPAddress)
	if ipAddress == "" {
		ipAddress = "unknown"
	}

	decision := s.rateLimiter.allow(rule.Scope+"|"+ipAddress, rule.Limit, rule.Window)
	decision.Scope = rule.Scope
	return decision, true
}

func newRequestID() string {
	buffer := make([]byte, 8)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("req_%d", time.Now().UnixNano())
	}

	return "req_" + hex.EncodeToString(buffer)
}

func (s *Server) clientMetadata(r *http.Request) account.RequestMetadata {
	candidates := []string{
		strings.TrimSpace(strings.Split(strings.TrimSpace(r.Header.Get("X-Forwarded-For")), ",")[0]),
		strings.TrimSpace(r.Header.Get("X-Real-IP")),
	}

	if hostPort := strings.TrimSpace(r.RemoteAddr); hostPort != "" {
		if addr, err := netip.ParseAddrPort(hostPort); err == nil {
			candidates = append(candidates, addr.Addr().String())
		} else {
			candidates = append(candidates, hostPort)
		}
	}

	for _, candidate := range candidates {
		if candidate != "" {
			return account.RequestMetadata{IPAddress: candidate}
		}
	}

	return account.RequestMetadata{}
}

func (s *Server) isLoopbackRequest(r *http.Request) bool {
	ip := strings.TrimSpace(s.clientMetadata(r).IPAddress)
	if ip == "" {
		return false
	}

	if parsed, err := netip.ParseAddr(ip); err == nil {
		return parsed.IsLoopback()
	}

	if host, _, err := net.SplitHostPort(ip); err == nil {
		if parsed, parseErr := netip.ParseAddr(host); parseErr == nil {
			return parsed.IsLoopback()
		}
	}

	return strings.EqualFold(ip, "localhost")
}
