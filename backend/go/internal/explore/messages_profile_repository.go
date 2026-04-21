package explore

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	defaultConversationLimit         = 20
	maxConversationLimit             = 50
	defaultConversationMessageLimit  = 30
	maxConversationMessageLimit      = 100
	maxConversationClientNonceLength = 120
	defaultProfilePostsLimit         = 18
	maxProfilePostsLimit             = 60
	maxConversationMessageLength     = 2000
	conversationSearchTranslateFrom  = "\u00e7\u011f\u0131\u00f6\u015f\u00fc\u00e2\u00ee\u00fb"
	conversationSearchTranslateTo    = "cgiosuaiu"
)

type timelineCursorState struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
}

type profileNotificationPayload struct {
	ActorID     string
	Body        string
	Channel     string
	ID          string
	Metadata    map[string]any
	RecipientID string
	Title       string
	Type        string
}

func normalizeConversationLimit(limit int) int {
	if limit <= 0 {
		return defaultConversationLimit
	}
	if limit > maxConversationLimit {
		return maxConversationLimit
	}

	return limit
}

func normalizeConversationMessageLimit(limit int) int {
	if limit <= 0 {
		return defaultConversationMessageLimit
	}
	if limit > maxConversationMessageLimit {
		return maxConversationMessageLimit
	}

	return limit
}

func normalizeProfilePostsLimit(limit int) int {
	if limit <= 0 {
		return defaultProfilePostsLimit
	}
	if limit > maxProfilePostsLimit {
		return maxProfilePostsLimit
	}

	return limit
}

func normalizeConversationSearch(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "@")
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.NewReplacer(
		"\u00e7", "c",
		"\u011f", "g",
		"\u0131", "i",
		"\u00f6", "o",
		"\u015f", "s",
		"\u00fc", "u",
		"\u00e2", "a",
		"\u00ee", "i",
		"\u00fb", "u",
	).Replace(value)
	return strings.Join(strings.Fields(value), " ")
}

func normalizeConversationClientNonce(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if len(trimmed) > maxConversationClientNonceLength {
		trimmed = trimmed[:maxConversationClientNonceLength]
	}
	return trimmed
}

type conversationSummaryRowScanner interface {
	Scan(dest ...any) error
}

type conversationMessagingSnapshot struct {
	IsPeerBlockedByViewer           bool
	IsStreetFriend                  bool
	IsViewerBlockedByPeer           bool
	PeerFollowsViewer               bool
	PeerHasSentMessage              bool
	PeerOnlyFollowedUsersCanMessage bool
	PeerRequestAcceptedAt           sql.NullTime
	PeerRequestRejectedAt           sql.NullTime
	ViewerFollowsPeer               bool
	ViewerHasSentMessage            bool
	ViewerRequestAcceptedAt         sql.NullTime
	ViewerRequestRejectedAt         sql.NullTime
}

type conversationMessagingState struct {
	CanSendMessage       bool
	ChatRequestDirection ConversationChatRequestDirection
	ChatRequestStatus    ConversationChatRequestStatus
	IsMessageRequest     bool
	MessagingHint        string
	MessagingMode        ConversationMessagingMode
}

func (snapshot conversationMessagingSnapshot) socialConnection() bool {
	return snapshot.IsStreetFriend || snapshot.ViewerFollowsPeer || snapshot.PeerFollowsViewer
}

func (snapshot conversationMessagingSnapshot) mutualFollow() bool {
	return snapshot.ViewerFollowsPeer && snapshot.PeerFollowsViewer
}

func (snapshot conversationMessagingSnapshot) directMessagingAvailable() bool {
	return snapshot.IsStreetFriend ||
		snapshot.mutualFollow() ||
		(snapshot.ViewerRequestAcceptedAt.Valid && snapshot.PeerRequestAcceptedAt.Valid) ||
		(snapshot.ViewerHasSentMessage && snapshot.PeerHasSentMessage)
}

func (snapshot conversationMessagingSnapshot) peerMessagingRestricted() bool {
	return snapshot.PeerOnlyFollowedUsersCanMessage &&
		!snapshot.PeerFollowsViewer &&
		!snapshot.IsStreetFriend
}

func buildConversationMessagingState(
	snapshot conversationMessagingSnapshot,
) conversationMessagingState {
	state := conversationMessagingState{
		CanSendMessage:       true,
		ChatRequestDirection: ConversationChatRequestDirectionNone,
		ChatRequestStatus:    ConversationChatRequestStatusNone,
		IsMessageRequest:     false,
		MessagingHint:        "",
		MessagingMode:        ConversationMessagingModeDirect,
	}

	if snapshot.IsPeerBlockedByViewer || snapshot.IsViewerBlockedByPeer {
		state.CanSendMessage = false
		state.ChatRequestStatus = ConversationChatRequestStatusBlocked
		state.MessagingMode = ConversationMessagingModeBlocked
		return state
	}

	if snapshot.directMessagingAvailable() {
		if !snapshot.socialConnection() &&
			(snapshot.ViewerRequestAcceptedAt.Valid || snapshot.PeerRequestAcceptedAt.Valid) {
			state.ChatRequestStatus = ConversationChatRequestStatusAccepted
		}
		return state
	}

	if snapshot.peerMessagingRestricted() {
		state.CanSendMessage = false
		state.MessagingHint = "Bu kullanici sadece takip ettiklerinden mesaj kabul ediyor."
		state.MessagingMode = ConversationMessagingModeRestricted
		return state
	}

	if snapshot.PeerHasSentMessage && !snapshot.ViewerHasSentMessage {
		if snapshot.ViewerRequestRejectedAt.Valid {
			state.CanSendMessage = false
			state.ChatRequestStatus = ConversationChatRequestStatusRejected
			state.MessagingMode = ConversationMessagingModeRequestRejected
			state.MessagingHint = "Bu mesaj istegini reddettin."
			return state
		}
		if !snapshot.ViewerRequestAcceptedAt.Valid {
			state.CanSendMessage = false
			state.ChatRequestDirection = ConversationChatRequestDirectionIncoming
			state.ChatRequestStatus = ConversationChatRequestStatusPending
			state.IsMessageRequest = true
			state.MessagingHint = "Mesaj istegini kabul etmeden cevap veremezsin."
			state.MessagingMode = ConversationMessagingModeRequestPendingIncoming
			return state
		}
	}

	if snapshot.ViewerHasSentMessage {
		if snapshot.PeerRequestRejectedAt.Valid {
			state.CanSendMessage = false
			state.ChatRequestDirection = ConversationChatRequestDirectionOutgoing
			state.ChatRequestStatus = ConversationChatRequestStatusRejected
			state.MessagingHint = "Mesaj istegi reddedildi. Takip etmeden yeniden mesaj gonderemezsin."
			state.MessagingMode = ConversationMessagingModeRequestRejected
			return state
		}
		if !snapshot.PeerRequestAcceptedAt.Valid {
			state.CanSendMessage = false
			state.ChatRequestDirection = ConversationChatRequestDirectionOutgoing
			state.ChatRequestStatus = ConversationChatRequestStatusPending
			state.MessagingHint = "Mesaj istegi gonderildi. Kabul edilene kadar yeni mesaj gonderemezsin."
			state.MessagingMode = ConversationMessagingModeRequestPendingOutgoing
			return state
		}
	}

	state.MessagingHint = "Ilk mesajin istek olarak gonderilir."
	state.MessagingMode = ConversationMessagingModeRequestRequired
	return state
}

func applyConversationMessagingState(
	summary *ConversationSummary,
	snapshot conversationMessagingSnapshot,
) {
	state := buildConversationMessagingState(snapshot)
	summary.CanSendMessage = state.CanSendMessage
	summary.ChatRequestDirection = state.ChatRequestDirection
	summary.ChatRequestStatus = state.ChatRequestStatus
	summary.IsMessageRequest = state.IsMessageRequest
	summary.MessagingHint = state.MessagingHint
	summary.MessagingMode = state.MessagingMode
}

func scanConversationSummary(
	scanner conversationSummaryRowScanner,
) (ConversationSummary, conversationMessagingSnapshot, error) {
	var (
		item                    ConversationSummary
		snapshot                conversationMessagingSnapshot
		isMuted                 bool
		peerLastReadAt          sql.NullTime
		peerLastReadMessageID   string
		viewerRequestAcceptedAt sql.NullTime
		peerRequestAcceptedAt   sql.NullTime
		viewerRequestRejectedAt sql.NullTime
		peerRequestRejectedAt   sql.NullTime
	)
	if err := scanner.Scan(
		&item.ConversationID,
		&item.Peer.ID,
		&item.Peer.Username,
		&item.Peer.FullName,
		&item.Peer.AvatarURL,
		&item.Peer.IsVerified,
		&item.IsPeerBlockedByViewer,
		&item.IsViewerBlockedByPeer,
		&item.LastMessage,
		&item.LastMessageAt,
		&item.UnreadCount,
		&isMuted,
		&peerLastReadAt,
		&peerLastReadMessageID,
		&snapshot.ViewerFollowsPeer,
		&snapshot.PeerFollowsViewer,
		&snapshot.IsStreetFriend,
		&snapshot.ViewerHasSentMessage,
		&snapshot.PeerHasSentMessage,
		&snapshot.PeerOnlyFollowedUsersCanMessage,
		&viewerRequestAcceptedAt,
		&peerRequestAcceptedAt,
		&viewerRequestRejectedAt,
		&peerRequestRejectedAt,
	); err != nil {
		return ConversationSummary{}, conversationMessagingSnapshot{}, err
	}

	snapshot.IsPeerBlockedByViewer = item.IsPeerBlockedByViewer
	snapshot.IsViewerBlockedByPeer = item.IsViewerBlockedByPeer
	snapshot.ViewerRequestAcceptedAt = viewerRequestAcceptedAt
	snapshot.PeerRequestAcceptedAt = peerRequestAcceptedAt
	snapshot.ViewerRequestRejectedAt = viewerRequestRejectedAt
	snapshot.PeerRequestRejectedAt = peerRequestRejectedAt

	item.IsUnread = item.UnreadCount > 0
	item.IsMuted = isMuted
	if peerLastReadAt.Valid {
		readAt := peerLastReadAt.Time.UTC()
		if readAt.Unix() > 0 {
			item.PeerLastReadAt = &readAt
		}
	}
	item.PeerLastReadMessageID = strings.TrimSpace(peerLastReadMessageID)
	applyConversationMessagingState(&item, snapshot)

	return HydrateConversationSummary(item), snapshot, nil
}

func decodeTimelineCursor(raw string) (*timelineCursorState, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}

	decoded, err := base64.RawURLEncoding.DecodeString(trimmed)
	if err != nil {
		return nil, ErrInvalidFeedCursor
	}

	var cursor timelineCursorState
	if err := json.Unmarshal(decoded, &cursor); err != nil {
		return nil, ErrInvalidFeedCursor
	}
	if cursor.ID == "" || cursor.CreatedAt.IsZero() {
		return nil, ErrInvalidFeedCursor
	}

	return &cursor, nil
}

func encodeTimelineCursor(cursor timelineCursorState) (string, error) {
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func nullableTimelineCursorTime(cursor *timelineCursorState) any {
	if cursor == nil {
		return nil
	}

	return cursor.CreatedAt.UTC()
}

func nullableTimelineCursorID(cursor *timelineCursorState) any {
	if cursor == nil {
		return ""
	}

	return cursor.ID
}

func nullableTime(value *time.Time) any {
	if value == nil || value.IsZero() {
		return nil
	}

	return value.UTC()
}

func (r *Repository) hasBlockedRelationshipTx(
	ctx context.Context,
	tx pgx.Tx,
	leftUserID string,
	rightUserID string,
) (bool, error) {
	var blocked bool
	if err := tx.QueryRow(ctx, `
		select exists(
			select 1
			from blocked_users b
			where
				(b.blocker_id = $1 and b.blocked_user_id = $2)
				or (b.blocker_id = $2 and b.blocked_user_id = $1)
		)
	`, leftUserID, rightUserID).Scan(&blocked); err != nil {
		return false, fmt.Errorf("check blocked relationship: %w", err)
	}

	return blocked, nil
}

func (r *Repository) isViewerBlockedByTargetTx(
	ctx context.Context,
	tx pgx.Tx,
	viewerID, targetUserID string,
) (bool, error) {
	var blocked bool
	if err := tx.QueryRow(ctx, `
		select exists(
			select 1
			from blocked_users b
			where b.blocker_id = $2 and b.blocked_user_id = $1
		)
	`, viewerID, targetUserID).Scan(&blocked); err != nil {
		return false, fmt.Errorf("check viewer blocked by target: %w", err)
	}
	return blocked, nil
}

func (r *Repository) isViewerBlockingTargetTx(
	ctx context.Context,
	tx pgx.Tx,
	viewerID, targetUserID string,
) (bool, error) {
	var blocked bool
	if err := tx.QueryRow(ctx, `
		select exists(
			select 1
			from blocked_users b
			where b.blocker_id = $1 and b.blocked_user_id = $2
		)
	`, viewerID, targetUserID).Scan(&blocked); err != nil {
		return false, fmt.Errorf("check viewer blocking target: %w", err)
	}
	return blocked, nil
}

func (r *Repository) assertCanViewProfilePostsTx(
	ctx context.Context,
	tx pgx.Tx,
	viewerID string,
	targetUserID string,
) (string, error) {
	var (
		isPrivate bool
		username  string
	)
	if err := tx.QueryRow(ctx, `
		select
			username,
			coalesce(is_private_account, false)
		from users
		where id = $1
	`, targetUserID).Scan(&username, &isPrivate); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrUserNotFound
		}
		return "", fmt.Errorf("query target user privacy: %w", err)
	}

	if viewerID == targetUserID {
		return username, nil
	}

	blockedByTarget, err := r.isViewerBlockedByTargetTx(ctx, tx, viewerID, targetUserID)
	if err != nil {
		return "", err
	}
	if blockedByTarget {
		return "", ErrBlockedRelationship
	}

	blockingTarget, err := r.isViewerBlockingTargetTx(ctx, tx, viewerID, targetUserID)
	if err != nil {
		return "", err
	}
	if blockingTarget {
		// Viewer chose to block: allow an empty grid (no post payloads); deep links still fail via post access.
		return username, nil
	}

	if !isPrivate {
		return username, nil
	}

	var follows bool
	if err := tx.QueryRow(ctx, `
		select exists(
			select 1
			from follows f
			where f.follower_id = $1 and f.followed_user_id = $2
		)
	`, viewerID, targetUserID).Scan(&follows); err != nil {
		return "", fmt.Errorf("query follow visibility relationship: %w", err)
	}
	if follows {
		return username, nil
	}

	return "", ErrProfilePrivate
}

func (r *Repository) ListProfilePosts(
	ctx context.Context,
	viewerID string,
	targetUserID string,
	cursor string,
	limit int,
) (ProfilePostsResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	targetUserID = strings.TrimSpace(targetUserID)
	if viewerID == "" || targetUserID == "" {
		return ProfilePostsResponse{}, ErrInvalidFollowAction
	}

	normalizedLimit := normalizeProfilePostsLimit(limit)
	cursorState, err := decodeTimelineCursor(cursor)
	if err != nil {
		return ProfilePostsResponse{}, err
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ProfilePostsResponse{}, fmt.Errorf("begin profile posts tx: %w", err)
	}
	defer tx.Rollback(ctx)

	username, err := r.assertCanViewProfilePostsTx(ctx, tx, viewerID, targetUserID)
	if err != nil {
		return ProfilePostsResponse{}, err
	}

	blockingTarget, err := r.isViewerBlockingTargetTx(ctx, tx, viewerID, targetUserID)
	if err != nil {
		return ProfilePostsResponse{}, err
	}
	if blockingTarget && viewerID != targetUserID {
		if err := tx.Commit(ctx); err != nil {
			return ProfilePostsResponse{}, fmt.Errorf("commit profile posts tx: %w", err)
		}
		return ProfilePostsResponse{
			HasMore:    false,
			NextCursor: "",
			Posts:      []ProfilePostItem{},
			UserID:     targetUserID,
		}, nil
	}

	rows, err := tx.Query(ctx, `
		select
			p.id,
			p.user_id,
			p.media_type,
			p.media_url,
			coalesce(p.visibility, 'public'),
			p.caption,
			p.location_name,
			p.created_at,
			p.likes_count,
			p.comments_count,
			p.bookmarks_count,
			p.shares_count,
			p.is_live,
			coalesce(pe.liked, false),
			coalesce(pe.bookmarked, false)
		from posts p
		left join post_engagements pe on pe.post_id = p.id and pe.viewer_id = $5
		where
			p.user_id = $1
			and p.is_live = true
			and (
				$5::text = $1
				or coalesce(p.visibility, 'public') = 'public'
				or (
					coalesce(p.visibility, 'public') = 'friends'
					and (
						exists(
							select 1
							from follows f
							where f.follower_id = $5 and f.followed_user_id = $1
						)
						or exists(
							select 1
							from street_friendships sf
							where
								sf.status = 'accepted'
								and (
									(sf.user_a_id = $5 and sf.user_b_id = $1)
									or (sf.user_a_id = $1 and sf.user_b_id = $5)
								)
						)
					)
				)
			)
			and (
				$2::timestamptz is null
				or p.created_at < $2
				or (p.created_at = $2 and p.id < $3)
			)
		order by p.created_at desc, p.id desc
		limit $4
	`,
		targetUserID,
		nullableTimelineCursorTime(cursorState),
		nullableTimelineCursorID(cursorState),
		normalizedLimit+1,
		viewerID,
	)
	if err != nil {
		return ProfilePostsResponse{}, fmt.Errorf("query profile posts: %w", err)
	}
	defer rows.Close()

	posts := make([]ProfilePostItem, 0, normalizedLimit+1)
	for rows.Next() {
		var item ProfilePostItem
		var isBookmarked bool
		var isLiked bool
		if err := rows.Scan(
			&item.ID,
			&item.UserID,
			&item.MediaType,
			&item.MediaURL,
			&item.Visibility,
			&item.Caption,
			&item.Location,
			&item.CreatedAt,
			&item.Stats.LikesCount,
			&item.Stats.CommentsCount,
			&item.Stats.BookmarksCount,
			&item.Stats.SharesCount,
			&item.IsLive,
			&isLiked,
			&isBookmarked,
		); err != nil {
			return ProfilePostsResponse{}, fmt.Errorf("scan profile post row: %w", err)
		}
		item.Username = username
		item.ViewerState = ViewerState{
			FollowRequestStatus: FollowRequestStatusNone,
			IsBookmarked:        isBookmarked,
			IsLiked:             isLiked,
			StreetFriendStatus:  StreetFriendStatusNone,
		}
		posts = append(posts, item)
	}

	if rows.Err() != nil {
		return ProfilePostsResponse{}, fmt.Errorf("iterate profile posts: %w", rows.Err())
	}

	hasMore := len(posts) > normalizedLimit
	if hasMore {
		posts = posts[:normalizedLimit]
	}

	nextCursor := ""
	if hasMore && len(posts) > 0 {
		lastPost := posts[len(posts)-1]
		nextCursor, err = encodeTimelineCursor(timelineCursorState{
			CreatedAt: lastPost.CreatedAt.UTC(),
			ID:        lastPost.ID,
		})
		if err != nil {
			return ProfilePostsResponse{}, fmt.Errorf("encode profile posts cursor: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return ProfilePostsResponse{}, fmt.Errorf("commit profile posts tx: %w", err)
	}

	return ProfilePostsResponse{
		HasMore:    hasMore,
		NextCursor: nextCursor,
		Posts:      posts,
		UserID:     targetUserID,
	}, nil
}

func (r *Repository) ListViewerPosts(
	ctx context.Context,
	viewerID string,
	cursor string,
	limit int,
) (ProfilePostsResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	if viewerID == "" {
		return ProfilePostsResponse{}, ErrInvalidFollowAction
	}

	return r.ListProfilePosts(ctx, viewerID, viewerID, cursor, limit)
}

func (r *Repository) ListViewerLikedPosts(
	ctx context.Context,
	viewerID string,
	cursor string,
	limit int,
) (ProfilePostsResponse, error) {
	return r.listViewerEngagementPosts(ctx, viewerID, cursor, limit, "liked")
}

func (r *Repository) ListViewerSavedPosts(
	ctx context.Context,
	viewerID string,
	cursor string,
	limit int,
) (ProfilePostsResponse, error) {
	return r.listViewerEngagementPosts(ctx, viewerID, cursor, limit, "bookmarked")
}

func (r *Repository) listViewerEngagementPosts(
	ctx context.Context,
	viewerID string,
	cursor string,
	limit int,
	engagementColumn string,
) (ProfilePostsResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	if viewerID == "" {
		return ProfilePostsResponse{}, ErrInvalidFollowAction
	}
	if engagementColumn != "liked" && engagementColumn != "bookmarked" {
		return ProfilePostsResponse{}, ErrInvalidFollowAction
	}

	normalizedLimit := normalizeProfilePostsLimit(limit)
	cursorState, err := decodeTimelineCursor(cursor)
	if err != nil {
		return ProfilePostsResponse{}, err
	}

	queryWithTombstones := fmt.Sprintf(`
		select
			coalesce(p.id, pe.post_id),
			coalesce(p.user_id, ''),
			coalesce(u.username, ''),
			coalesce(p.media_type::text, 'unavailable'),
			coalesce(p.media_url, ''),
			coalesce(p.visibility, 'public'),
			coalesce(p.caption, ''),
			coalesce(p.location_name, ''),
			coalesce(p.created_at, pe.post_deleted_at, pe.updated_at),
			coalesce(p.likes_count, 0),
			coalesce(p.comments_count, 0),
			coalesce(p.bookmarks_count, 0),
			coalesce(p.shares_count, 0),
			coalesce(p.is_live, false),
			(p.id is null or coalesce(p.is_live, false) = false),
			coalesce(
				nullif(pe.post_deleted_reason, ''),
				case
					when p.id is null or coalesce(p.is_live, false) = false then 'deleted'
					else ''
				end
			),
			coalesce(pe.liked, false),
			coalesce(pe.bookmarked, false)
		from post_engagements pe
		left join posts p on p.id = pe.post_id
		left join users u on u.id = p.user_id
		where
			pe.viewer_id = $1
			and pe.%s = true
			and (
				p.id is null
				or coalesce(p.is_live, false) = false
				or (
					not exists (
						select 1
						from blocked_users b
						where
							(b.blocker_id = $1 and b.blocked_user_id = p.user_id)
							or (b.blocker_id = p.user_id and b.blocked_user_id = $1)
					)
					and (
						p.user_id = $1
						or coalesce(u.is_private_account, false) = false
						or exists(
							select 1
							from follows f
							where f.follower_id = $1 and f.followed_user_id = p.user_id
						)
					)
					and (
						p.user_id = $1
						or coalesce(p.visibility, 'public') = 'public'
						or (
							coalesce(p.visibility, 'public') = 'friends'
							and (
								exists(
									select 1
									from follows f
									where f.follower_id = $1 and f.followed_user_id = p.user_id
								)
								or exists(
									select 1
									from street_friendships sf
									where
										sf.status = 'accepted'
										and (
											(sf.user_a_id = $1 and sf.user_b_id = p.user_id)
											or (sf.user_a_id = p.user_id and sf.user_b_id = $1)
										)
								)
							)
						)
					)
				)
			)
			and (
				$2::timestamptz is null
				or coalesce(p.created_at, pe.post_deleted_at, pe.updated_at) < $2
				or (
					coalesce(p.created_at, pe.post_deleted_at, pe.updated_at) = $2
					and coalesce(p.id, pe.post_id) < $3
				)
			)
		order by
			coalesce(p.created_at, pe.post_deleted_at, pe.updated_at) desc,
			coalesce(p.id, pe.post_id) desc
		limit $4
	`, engagementColumn)

	legacyQuery := fmt.Sprintf(`
		select
			coalesce(p.id, pe.post_id),
			coalesce(p.user_id, ''),
			coalesce(u.username, ''),
			coalesce(p.media_type::text, 'unavailable'),
			coalesce(p.media_url, ''),
			coalesce(p.visibility, 'public'),
			coalesce(p.caption, ''),
			coalesce(p.location_name, ''),
			coalesce(p.created_at, pe.updated_at),
			coalesce(p.likes_count, 0),
			coalesce(p.comments_count, 0),
			coalesce(p.bookmarks_count, 0),
			coalesce(p.shares_count, 0),
			coalesce(p.is_live, false),
			(p.id is null or coalesce(p.is_live, false) = false),
			case
				when p.id is null or coalesce(p.is_live, false) = false then 'deleted'
				else ''
			end,
			coalesce(pe.liked, false),
			coalesce(pe.bookmarked, false)
		from post_engagements pe
		left join posts p on p.id = pe.post_id
		left join users u on u.id = p.user_id
		where
			pe.viewer_id = $1
			and pe.%s = true
			and (
				p.id is null
				or coalesce(p.is_live, false) = false
				or (
					not exists (
						select 1
						from blocked_users b
						where
							(b.blocker_id = $1 and b.blocked_user_id = p.user_id)
							or (b.blocker_id = p.user_id and b.blocked_user_id = $1)
					)
					and (
						p.user_id = $1
						or coalesce(u.is_private_account, false) = false
						or exists(
							select 1
							from follows f
							where f.follower_id = $1 and f.followed_user_id = p.user_id
						)
					)
					and (
						p.user_id = $1
						or coalesce(p.visibility, 'public') = 'public'
						or (
							coalesce(p.visibility, 'public') = 'friends'
							and (
								exists(
									select 1
									from follows f
									where f.follower_id = $1 and f.followed_user_id = p.user_id
								)
								or exists(
									select 1
									from street_friendships sf
									where
										sf.status = 'accepted'
										and (
											(sf.user_a_id = $1 and sf.user_b_id = p.user_id)
											or (sf.user_a_id = p.user_id and sf.user_b_id = $1)
										)
								)
							)
						)
					)
				)
			)
			and (
				$2::timestamptz is null
				or coalesce(p.created_at, pe.updated_at) < $2
				or (
					coalesce(p.created_at, pe.updated_at) = $2
					and coalesce(p.id, pe.post_id) < $3
				)
			)
		order by
			coalesce(p.created_at, pe.updated_at) desc,
			coalesce(p.id, pe.post_id) desc
		limit $4
	`, engagementColumn)

	queryArgs := []any{
		viewerID,
		nullableTimelineCursorTime(cursorState),
		nullableTimelineCursorID(cursorState),
		normalizedLimit + 1,
	}

	rows, err := r.db.Query(ctx, queryWithTombstones, queryArgs...)
	if err != nil && isMissingPostEngagementTombstoneColumnError(err) {
		rows, err = r.db.Query(ctx, legacyQuery, queryArgs...)
	}
	if err != nil {
		return ProfilePostsResponse{}, fmt.Errorf("query viewer engagement posts: %w", err)
	}
	defer rows.Close()

	posts := make([]ProfilePostItem, 0, normalizedLimit+1)
	for rows.Next() {
		var item ProfilePostItem
		var isBookmarked bool
		var isLiked bool
		if err := rows.Scan(
			&item.ID,
			&item.UserID,
			&item.Username,
			&item.MediaType,
			&item.MediaURL,
			&item.Visibility,
			&item.Caption,
			&item.Location,
			&item.CreatedAt,
			&item.Stats.LikesCount,
			&item.Stats.CommentsCount,
			&item.Stats.BookmarksCount,
			&item.Stats.SharesCount,
			&item.IsLive,
			&item.IsUnavailable,
			&item.UnavailableReason,
			&isLiked,
			&isBookmarked,
		); err != nil {
			return ProfilePostsResponse{}, fmt.Errorf("scan viewer engagement post row: %w", err)
		}
		item.ViewerState = ViewerState{
			FollowRequestStatus: FollowRequestStatusNone,
			IsBookmarked:        isBookmarked,
			IsLiked:             isLiked,
			StreetFriendStatus:  StreetFriendStatusNone,
		}
		if item.IsUnavailable {
			item.Caption = ""
			item.Location = ""
			item.MediaType = "unavailable"
			item.MediaURL = ""
			item.Stats = Stats{}
			if strings.TrimSpace(item.UnavailableReason) == "" {
				item.UnavailableReason = "deleted"
			}
		}
		posts = append(posts, item)
	}
	if rows.Err() != nil {
		return ProfilePostsResponse{}, fmt.Errorf("iterate viewer engagement posts: %w", rows.Err())
	}

	hasMore := len(posts) > normalizedLimit
	if hasMore {
		posts = posts[:normalizedLimit]
	}

	nextCursor := ""
	if hasMore && len(posts) > 0 {
		lastPost := posts[len(posts)-1]
		nextCursor, err = encodeTimelineCursor(timelineCursorState{
			CreatedAt: lastPost.CreatedAt.UTC(),
			ID:        lastPost.ID,
		})
		if err != nil {
			return ProfilePostsResponse{}, fmt.Errorf("encode viewer engagement posts cursor: %w", err)
		}
	}

	return ProfilePostsResponse{
		HasMore:    hasMore,
		NextCursor: nextCursor,
		Posts:      posts,
		UserID:     viewerID,
	}, nil
}

func isMissingPostEngagementTombstoneColumnError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	if !strings.Contains(message, "does not exist") {
		return false
	}
	return strings.Contains(message, "post_deleted_at") || strings.Contains(message, "post_deleted_reason")
}

func (r *Repository) AuthorizeProfilePostMedia(
	ctx context.Context,
	viewerID string,
	mediaURL string,
) error {
	viewerID = strings.TrimSpace(viewerID)
	mediaURL = strings.TrimSpace(mediaURL)
	if viewerID == "" || mediaURL == "" {
		return ErrPostNotFound
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin authorize profile media tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var postID string
	if err := tx.QueryRow(ctx, `
		select id
		from posts
		where media_url = $1 and is_live = true
		order by created_at desc, id desc
		limit 1
	`, mediaURL).Scan(&postID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			var ownerUserID string
			if userErr := tx.QueryRow(ctx, `
				select id
				from users
				where avatar_url = $1
				limit 1
			`, mediaURL).Scan(&ownerUserID); userErr != nil {
				if errors.Is(userErr, pgx.ErrNoRows) {
					return ErrPostNotFound
				}
				return fmt.Errorf("query media owner avatar user: %w", userErr)
			}
			if _, accessErr := r.assertCanViewProfilePostsTx(ctx, tx, viewerID, ownerUserID); accessErr != nil {
				return accessErr
			}
			if commitErr := tx.Commit(ctx); commitErr != nil {
				return fmt.Errorf("commit authorize profile avatar media tx: %w", commitErr)
			}
			return nil
		}
		return fmt.Errorf("query media owner post: %w", err)
	}

	if _, err := r.loadPostAccessSnapshotTx(ctx, tx, postID, viewerID, false); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit authorize profile media tx: %w", err)
	}

	return nil
}

func (r *Repository) GetProfilePostDetail(
	ctx context.Context,
	viewerID string,
	postID string,
) (Post, error) {
	viewerID = strings.TrimSpace(viewerID)
	postID = strings.TrimSpace(postID)
	if viewerID == "" || postID == "" {
		return Post{}, ErrPostNotFound
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Post{}, fmt.Errorf("begin profile post detail tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := r.loadPostAccessSnapshotTx(ctx, tx, postID, viewerID, false); err != nil {
		return Post{}, err
	}

	var (
		post              Post
		followRequestedBy string
		isBookmarked      bool
		isFollowing       bool
		isLiked           bool
		streetRequestedBy string
		streetStatus      string
	)
	if err := tx.QueryRow(ctx, `
		select
			p.id,
			p.segment,
			p.media_type,
			p.media_url,
			p.caption,
			p.location_name,
			p.created_at,
			p.likes_count,
			p.comments_count,
			p.bookmarks_count,
			p.shares_count,
			u.id,
			u.username,
			u.avatar_url,
			u.is_verified,
			exists(
				select 1
				from follows f
				where f.follower_id = $2 and f.followed_user_id = u.id
			) as is_following,
			coalesce(pe.liked, false) as is_liked,
			coalesce(pe.bookmarked, false) as is_bookmarked,
			coalesce(sf.status, '') as street_friend_status,
			coalesce(sf.requested_by, '') as street_friend_requested_by,
			coalesce((
				select fr.requester_id
				from follow_requests fr
				where
					(fr.requester_id = $2 and fr.target_user_id = u.id)
					or (fr.requester_id = u.id and fr.target_user_id = $2)
				order by case when fr.requester_id = $2 then 0 else 1 end
				limit 1
			), '') as follow_requested_by
		from posts p
		join users u on u.id = p.user_id
		left join post_engagements pe on pe.viewer_id = $2 and pe.post_id = p.id
		left join lateral (
			select sf.status, sf.requested_by
			from street_friendships sf
			where
				(sf.user_a_id = $2 and sf.user_b_id = u.id)
				or (sf.user_a_id = u.id and sf.user_b_id = $2)
			limit 1
		) sf on true
		where p.id = $1
	`, postID, viewerID).Scan(
		&post.ID,
		&post.Segment,
		&post.MediaType,
		&post.MediaURL,
		&post.Caption,
		&post.Location,
		&post.CreatedAt,
		&post.Stats.LikesCount,
		&post.Stats.CommentsCount,
		&post.Stats.BookmarksCount,
		&post.Stats.SharesCount,
		&post.Author.ID,
		&post.Author.Username,
		&post.Author.AvatarURL,
		&post.Author.IsVerified,
		&isFollowing,
		&isLiked,
		&isBookmarked,
		&streetStatus,
		&streetRequestedBy,
		&followRequestedBy,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Post{}, ErrPostNotFound
		}
		return Post{}, fmt.Errorf("query profile post detail: %w", err)
	}

	post.ViewerState = ViewerState{
		FollowRequestStatus: viewerFollowRequestState(isFollowing, followRequestedBy, viewerID),
		IsBookmarked:        isBookmarked,
		IsFollowing:         isFollowing,
		IsLiked:             isLiked,
	}
	post.ViewerState.StreetFriendStatus, post.ViewerState.IsStreetFriend = viewerStreetFriendState(
		streetStatus,
		streetRequestedBy,
		viewerID,
	)

	// Fetch recent comments (e.g., last 3)
	commentRows, err := tx.Query(ctx, `
		select
			c.id, c.body, c.like_count, c.created_at,
			u.id, u.username, u.avatar_url, u.is_verified,
			exists(select 1 from comment_engagements ce where ce.comment_id = c.id and ce.viewer_id = $2) as is_liked
		from comments c
		join users u on u.id = c.user_id
		where c.post_id = $1
		order by c.created_at desc
		limit 3
	`, postID, viewerID)
	if err != nil {
		return Post{}, fmt.Errorf("query recent comments: %w", err)
	}
	defer commentRows.Close()

	for commentRows.Next() {
		var c Comment
		if err := commentRows.Scan(
			&c.ID, &c.Body, &c.LikeCount, &c.CreatedAt,
			&c.Author.ID, &c.Author.Username, &c.Author.AvatarURL, &c.Author.IsVerified,
			&c.IsLiked,
		); err != nil {
			return Post{}, fmt.Errorf("scan recent comment: %w", err)
		}
		c.PostID = postID
		post.RecentComments = append(post.RecentComments, c)
	}

	// Fetch recent likes (e.g., last 5)
	likeRows, err := tx.Query(ctx, `
		select u.id, u.username, u.avatar_url, u.is_verified
		from post_engagements pe
		join users u on u.id = pe.viewer_id
		where pe.post_id = $1 and pe.liked = true
		order by pe.updated_at desc
		limit 5
	`, postID)
	if err != nil {
		return Post{}, fmt.Errorf("query recent likes: %w", err)
	}
	defer likeRows.Close()

	for likeRows.Next() {
		var a Author
		if err := likeRows.Scan(&a.ID, &a.Username, &a.AvatarURL, &a.IsVerified); err != nil {
			return Post{}, fmt.Errorf("scan recent like: %w", err)
		}
		post.RecentLikes = append(post.RecentLikes, a)
	}

	if err := tx.Commit(ctx); err != nil {
		return Post{}, fmt.Errorf("commit profile post detail tx: %w", err)
	}

	return post, nil
}

func (r *Repository) ListConversations(
	ctx context.Context,
	viewerID string,
	cursor string,
	limit int,
	unreadOnly bool,
	requestsOnly bool,
	search string,
) (ConversationListResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	if viewerID == "" {
		return ConversationListResponse{}, ErrConversationForbidden
	}

	normalizedLimit := normalizeConversationLimit(limit)
	cursorState, err := decodeTimelineCursor(cursor)
	if err != nil {
		return ConversationListResponse{}, err
	}
	search = normalizeConversationSearch(search)
	searchPattern := "%" + strings.ReplaceAll(search, " ", "%") + "%"

	rows, err := r.db.Query(ctx, `
		with conversation_base as (
			select
				c.id,
				case
					when c.user_a_id = $1 then c.user_b_id
					else c.user_a_id
				end as peer_id,
				c.last_message_id,
				coalesce(c.last_message_at, c.updated_at) as sort_time
			from direct_conversations c
			where
				(c.user_a_id = $1 or c.user_b_id = $1)
				and (
					$2::timestamptz is null
					or coalesce(c.last_message_at, c.updated_at) < $2
					or (
						coalesce(c.last_message_at, c.updated_at) = $2
						and c.id < $3
					)
				)
		)
		select
			cb.id,
			u.id,
			u.username,
			coalesce(u.full_name, ''),
			u.avatar_url,
			u.is_verified,
			exists(
				select 1
				from blocked_users b
				where b.blocker_id = $1 and b.blocked_user_id = cb.peer_id
			) as is_peer_blocked_by_viewer,
			exists(
				select 1
				from blocked_users b
				where b.blocker_id = cb.peer_id and b.blocked_user_id = $1
			) as is_viewer_blocked_by_peer,
			coalesce(dm.body, ''),
			cb.sort_time,
			coalesce(unread.unread_count, 0) as unread_count,
			coalesce(dcr.is_muted, false) as is_muted,
			dcr_peer.last_read_at,
			coalesce(peer_last.last_read_message_id, ''),
			req.viewer_follows_peer,
			req.peer_follows_viewer,
			req.is_street_friend,
			req.viewer_has_sent_message,
			req.peer_has_sent_message,
			req.peer_only_followed_users_can_message,
			dcr.request_accepted_at,
			dcr_peer.request_accepted_at,
			dcr.request_rejected_at,
			dcr_peer.request_rejected_at
		from conversation_base cb
		join users u on u.id = cb.peer_id
		left join direct_messages dm on dm.id = cb.last_message_id
		left join direct_conversation_reads dcr
			on dcr.conversation_id = cb.id and dcr.user_id = $1
		left join direct_conversation_reads dcr_peer
			on dcr_peer.conversation_id = cb.id and dcr_peer.user_id = cb.peer_id
		left join lateral (
			select
				exists(
					select 1
					from follows f
					where f.follower_id = $1 and f.followed_user_id = cb.peer_id
				) as viewer_follows_peer,
				exists(
					select 1
					from follows f
					where f.follower_id = cb.peer_id and f.followed_user_id = $1
				) as peer_follows_viewer,
				exists(
					select 1
					from street_friendships sf
					where
						sf.status = 'accepted'
						and (
							(sf.user_a_id = $1 and sf.user_b_id = cb.peer_id)
							or (sf.user_a_id = cb.peer_id and sf.user_b_id = $1)
						)
				) as is_street_friend,
				exists(
					select 1
					from direct_messages dm_viewer
					where dm_viewer.conversation_id = cb.id and dm_viewer.sender_id = $1
				) as viewer_has_sent_message,
				exists(
					select 1
					from direct_messages dm_peer
					where dm_peer.conversation_id = cb.id and dm_peer.sender_id = cb.peer_id
				) as peer_has_sent_message,
				coalesce((
					select ups.only_followed_users_can_message
					from user_profile_app_settings ups
					where ups.user_id = cb.peer_id
				), false) as peer_only_followed_users_can_message
		) req on true
		left join lateral (
			select dm_peer.id as last_read_message_id
			from direct_messages dm_peer
			where
				dm_peer.conversation_id = cb.id
				and dm_peer.created_at <= coalesce(dcr_peer.last_read_at, 'epoch'::timestamptz)
			order by dm_peer.created_at desc, dm_peer.id desc
			limit 1
		) peer_last on true
		left join lateral (
			select count(*)::bigint as unread_count
			from direct_messages unread
			where
				unread.conversation_id = cb.id
				and unread.sender_id <> $1
				and unread.created_at > coalesce(dcr.last_read_at, 'epoch'::timestamptz)
		) unread on true
		where
			coalesce(dcr.deleted_at, 'epoch'::timestamptz) < cb.sort_time
		and (
			$5::boolean = false
			or coalesce(unread.unread_count, 0) > 0
		)
		and (
			$6::text = ''
			or translate(lower(u.username), $8, $9) like $7
			or translate(lower(coalesce(u.full_name, '')), $8, $9) like $7
		)
		and (
			$10::boolean = false
			or (
				req.peer_has_sent_message
				and not req.viewer_has_sent_message
				and not req.viewer_follows_peer
				and not req.peer_follows_viewer
				and not req.is_street_friend
				and not req.peer_only_followed_users_can_message
				and dcr.request_accepted_at is null
				and dcr.request_rejected_at is null
				and not exists(
					select 1
					from blocked_users b
					where b.blocker_id = $1 and b.blocked_user_id = cb.peer_id
				)
				and not exists(
					select 1
					from blocked_users b
					where b.blocker_id = cb.peer_id and b.blocked_user_id = $1
				)
			)
		)
		order by cb.sort_time desc, cb.id desc
		limit $4
	`,
		viewerID,
		nullableTimelineCursorTime(cursorState),
		nullableTimelineCursorID(cursorState),
		normalizedLimit+1,
		unreadOnly,
		search,
		searchPattern,
		conversationSearchTranslateFrom,
		conversationSearchTranslateTo,
		requestsOnly,
	)
	if err != nil {
		return ConversationListResponse{}, fmt.Errorf("query conversations: %w", err)
	}
	defer rows.Close()

	conversations := make([]ConversationSummary, 0, normalizedLimit+1)
	for rows.Next() {
		item, _, err := scanConversationSummary(rows)
		if err != nil {
			return ConversationListResponse{}, fmt.Errorf("scan conversation row: %w", err)
		}
		conversations = append(conversations, item)
	}

	if rows.Err() != nil {
		return ConversationListResponse{}, fmt.Errorf("iterate conversations: %w", rows.Err())
	}

	hasMore := len(conversations) > normalizedLimit
	if hasMore {
		conversations = conversations[:normalizedLimit]
	}

	nextCursor := ""
	if hasMore && len(conversations) > 0 {
		last := conversations[len(conversations)-1]
		nextCursor, err = encodeTimelineCursor(timelineCursorState{
			CreatedAt: last.LastMessageAt.UTC(),
			ID:        last.ConversationID,
		})
		if err != nil {
			return ConversationListResponse{}, fmt.Errorf("encode conversation cursor: %w", err)
		}
	}

	return ConversationListResponse{
		Conversations: conversations,
		HasMore:       hasMore,
		NextCursor:    nextCursor,
	}, nil
}

func (r *Repository) resolveConversationPeerTx(
	ctx context.Context,
	tx pgx.Tx,
	conversationID string,
	viewerID string,
	lock bool,
	enforceBlock bool,
) (string, error) {
	query := `
		select user_a_id, user_b_id
		from direct_conversations
		where id = $1
	`
	if lock {
		query += ` for update`
	}

	var userAID string
	var userBID string
	if err := tx.QueryRow(ctx, query, conversationID).Scan(&userAID, &userBID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrConversationNotFound
		}
		return "", fmt.Errorf("query conversation participants: %w", err)
	}

	peerID := ""
	switch viewerID {
	case userAID:
		peerID = userBID
	case userBID:
		peerID = userAID
	default:
		return "", ErrConversationForbidden
	}

	if enforceBlock {
		blocked, err := r.hasBlockedRelationshipTx(ctx, tx, viewerID, peerID)
		if err != nil {
			return "", err
		}
		if blocked {
			return "", ErrBlockedRelationship
		}
	}

	return peerID, nil
}

func (r *Repository) ConversationPeer(
	ctx context.Context,
	viewerID string,
	conversationID string,
) (string, error) {
	viewerID = strings.TrimSpace(viewerID)
	conversationID = strings.TrimSpace(conversationID)
	if viewerID == "" || conversationID == "" {
		return "", ErrConversationForbidden
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", fmt.Errorf("begin resolve conversation peer tx: %w", err)
	}
	defer tx.Rollback(ctx)

	peerID, err := r.resolveConversationPeerTx(ctx, tx, conversationID, viewerID, false, true)
	if err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit resolve conversation peer tx: %w", err)
	}

	return peerID, nil
}

func (r *Repository) ConversationPeerAllowBlocked(
	ctx context.Context,
	viewerID string,
	conversationID string,
) (string, error) {
	viewerID = strings.TrimSpace(viewerID)
	conversationID = strings.TrimSpace(conversationID)
	if viewerID == "" || conversationID == "" {
		return "", ErrConversationForbidden
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", fmt.Errorf("begin resolve conversation peer tx: %w", err)
	}
	defer tx.Rollback(ctx)

	peerID, err := r.resolveConversationPeerTx(ctx, tx, conversationID, viewerID, false, false)
	if err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit resolve conversation peer tx: %w", err)
	}

	return peerID, nil
}

func (r *Repository) conversationSummaryByID(
	ctx context.Context,
	viewerID string,
	conversationID string,
) (ConversationSummary, error) {
	viewerID = strings.TrimSpace(viewerID)
	conversationID = strings.TrimSpace(conversationID)
	if viewerID == "" || conversationID == "" {
		return ConversationSummary{}, ErrConversationForbidden
	}

	row := r.db.QueryRow(ctx, `
		with conversation_base as (
			select
				c.id,
				case
					when c.user_a_id = $1 then c.user_b_id
					else c.user_a_id
				end as peer_id,
				c.last_message_id,
				coalesce(c.last_message_at, c.updated_at) as sort_time
			from direct_conversations c
			where
				c.id = $2
				and (c.user_a_id = $1 or c.user_b_id = $1)
		)
		select
			cb.id,
			u.id,
			u.username,
			coalesce(u.full_name, ''),
			u.avatar_url,
			u.is_verified,
			exists(
				select 1
				from blocked_users b
				where b.blocker_id = $1 and b.blocked_user_id = cb.peer_id
			) as is_peer_blocked_by_viewer,
			exists(
				select 1
				from blocked_users b
				where b.blocker_id = cb.peer_id and b.blocked_user_id = $1
			) as is_viewer_blocked_by_peer,
			coalesce(dm.body, ''),
			cb.sort_time,
			coalesce(unread.unread_count, 0) as unread_count,
			coalesce(dcr.is_muted, false) as is_muted,
			dcr_peer.last_read_at,
			coalesce(peer_last.last_read_message_id, ''),
			req.viewer_follows_peer,
			req.peer_follows_viewer,
			req.is_street_friend,
			req.viewer_has_sent_message,
			req.peer_has_sent_message,
			req.peer_only_followed_users_can_message,
			dcr.request_accepted_at,
			dcr_peer.request_accepted_at,
			dcr.request_rejected_at,
			dcr_peer.request_rejected_at
		from conversation_base cb
		join users u on u.id = cb.peer_id
		left join direct_messages dm on dm.id = cb.last_message_id
		left join direct_conversation_reads dcr
			on dcr.conversation_id = cb.id and dcr.user_id = $1
		left join direct_conversation_reads dcr_peer
			on dcr_peer.conversation_id = cb.id and dcr_peer.user_id = cb.peer_id
		left join lateral (
			select
				exists(
					select 1
					from follows f
					where f.follower_id = $1 and f.followed_user_id = cb.peer_id
				) as viewer_follows_peer,
				exists(
					select 1
					from follows f
					where f.follower_id = cb.peer_id and f.followed_user_id = $1
				) as peer_follows_viewer,
				exists(
					select 1
					from street_friendships sf
					where
						sf.status = 'accepted'
						and (
							(sf.user_a_id = $1 and sf.user_b_id = cb.peer_id)
							or (sf.user_a_id = cb.peer_id and sf.user_b_id = $1)
						)
				) as is_street_friend,
				exists(
					select 1
					from direct_messages dm_viewer
					where dm_viewer.conversation_id = cb.id and dm_viewer.sender_id = $1
				) as viewer_has_sent_message,
				exists(
					select 1
					from direct_messages dm_peer
					where dm_peer.conversation_id = cb.id and dm_peer.sender_id = cb.peer_id
				) as peer_has_sent_message,
				coalesce((
					select ups.only_followed_users_can_message
					from user_profile_app_settings ups
					where ups.user_id = cb.peer_id
				), false) as peer_only_followed_users_can_message
		) req on true
		left join lateral (
			select dm_peer.id as last_read_message_id
			from direct_messages dm_peer
			where
				dm_peer.conversation_id = cb.id
				and dm_peer.created_at <= coalesce(dcr_peer.last_read_at, 'epoch'::timestamptz)
			order by dm_peer.created_at desc, dm_peer.id desc
			limit 1
		) peer_last on true
		left join lateral (
			select count(*)::bigint as unread_count
			from direct_messages unread
			where
				unread.conversation_id = cb.id
				and unread.sender_id <> $1
				and unread.created_at > coalesce(dcr.last_read_at, 'epoch'::timestamptz)
		) unread on true
		where coalesce(dcr.deleted_at, 'epoch'::timestamptz) < cb.sort_time
	`, viewerID, conversationID)

	item, _, err := scanConversationSummary(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ConversationSummary{}, ErrConversationNotFound
		}
		return ConversationSummary{}, fmt.Errorf("query conversation summary: %w", err)
	}

	return item, nil
}

func (r *Repository) loadConversationMessagingSnapshotTx(
	ctx context.Context,
	tx pgx.Tx,
	conversationID string,
	viewerID string,
	peerID string,
) (conversationMessagingSnapshot, error) {
	var (
		snapshot                conversationMessagingSnapshot
		viewerRequestAcceptedAt sql.NullTime
		peerRequestAcceptedAt   sql.NullTime
		viewerRequestRejectedAt sql.NullTime
		peerRequestRejectedAt   sql.NullTime
	)
	if err := tx.QueryRow(ctx, `
		select
			exists(
				select 1
				from follows f
				where f.follower_id = $2 and f.followed_user_id = $3
			),
			exists(
				select 1
				from follows f
				where f.follower_id = $3 and f.followed_user_id = $2
			),
			exists(
				select 1
				from street_friendships sf
				where
					sf.status = 'accepted'
					and (
						(sf.user_a_id = $2 and sf.user_b_id = $3)
						or (sf.user_a_id = $3 and sf.user_b_id = $2)
					)
			),
			exists(
				select 1
				from direct_messages dm
				where dm.conversation_id = $1 and dm.sender_id = $2
			),
			exists(
				select 1
				from direct_messages dm
				where dm.conversation_id = $1 and dm.sender_id = $3
			),
			coalesce((
				select ups.only_followed_users_can_message
				from user_profile_app_settings ups
				where ups.user_id = $3
			), false),
			exists(
				select 1
				from blocked_users b
				where b.blocker_id = $2 and b.blocked_user_id = $3
			),
			exists(
				select 1
				from blocked_users b
				where b.blocker_id = $3 and b.blocked_user_id = $2
			),
			dcr.request_accepted_at,
			dcr_peer.request_accepted_at,
			dcr.request_rejected_at,
			dcr_peer.request_rejected_at
		from direct_conversations c
		left join direct_conversation_reads dcr
			on dcr.conversation_id = c.id and dcr.user_id = $2
		left join direct_conversation_reads dcr_peer
			on dcr_peer.conversation_id = c.id and dcr_peer.user_id = $3
		where c.id = $1
	`, conversationID, viewerID, peerID).Scan(
		&snapshot.ViewerFollowsPeer,
		&snapshot.PeerFollowsViewer,
		&snapshot.IsStreetFriend,
		&snapshot.ViewerHasSentMessage,
		&snapshot.PeerHasSentMessage,
		&snapshot.PeerOnlyFollowedUsersCanMessage,
		&snapshot.IsPeerBlockedByViewer,
		&snapshot.IsViewerBlockedByPeer,
		&viewerRequestAcceptedAt,
		&peerRequestAcceptedAt,
		&viewerRequestRejectedAt,
		&peerRequestRejectedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return conversationMessagingSnapshot{}, ErrConversationNotFound
		}
		return conversationMessagingSnapshot{}, fmt.Errorf("query conversation messaging snapshot: %w", err)
	}

	snapshot.ViewerRequestAcceptedAt = viewerRequestAcceptedAt
	snapshot.PeerRequestAcceptedAt = peerRequestAcceptedAt
	snapshot.ViewerRequestRejectedAt = viewerRequestRejectedAt
	snapshot.PeerRequestRejectedAt = peerRequestRejectedAt
	return snapshot, nil
}

func (r *Repository) ensureConversationReadStateTx(
	ctx context.Context,
	tx pgx.Tx,
	conversationID string,
	userID string,
	lastReadAt time.Time,
) error {
	if _, err := tx.Exec(ctx, `
		insert into direct_conversation_reads (
			conversation_id,
			user_id,
			last_read_at,
			updated_at
		)
		values ($1, $2, $3, now())
		on conflict (conversation_id, user_id)
		do update set
			last_read_at = greatest(direct_conversation_reads.last_read_at, excluded.last_read_at),
			updated_at = now()
	`, conversationID, userID, lastReadAt.UTC()); err != nil {
		return fmt.Errorf("upsert conversation read state: %w", err)
	}

	return nil
}

func (r *Repository) setConversationRequestAcceptedTx(
	ctx context.Context,
	tx pgx.Tx,
	conversationID string,
	userID string,
	acceptedAt time.Time,
) error {
	if _, err := tx.Exec(ctx, `
		insert into direct_conversation_reads (
			conversation_id,
			user_id,
			last_read_at,
			updated_at,
			request_accepted_at
		)
		values ($1, $2, 'epoch'::timestamptz, $3, $3)
		on conflict (conversation_id, user_id)
		do update set
			request_accepted_at = coalesce(
				direct_conversation_reads.request_accepted_at,
				excluded.request_accepted_at
			),
			request_rejected_at = null,
			deleted_at = null,
			updated_at = excluded.updated_at
	`, conversationID, userID, acceptedAt.UTC()); err != nil {
		return fmt.Errorf("update conversation request accepted state: %w", err)
	}

	return nil
}

func (r *Repository) setConversationRequestRejectedTx(
	ctx context.Context,
	tx pgx.Tx,
	conversationID string,
	userID string,
	rejectedAt time.Time,
) error {
	if _, err := tx.Exec(ctx, `
		insert into direct_conversation_reads (
			conversation_id,
			user_id,
			last_read_at,
			updated_at,
			request_accepted_at,
			request_rejected_at,
			deleted_at
		)
		values ($1, $2, 'epoch'::timestamptz, $3, null, $3, $3)
		on conflict (conversation_id, user_id)
		do update set
			request_accepted_at = null,
			request_rejected_at = excluded.request_rejected_at,
			deleted_at = excluded.deleted_at,
			updated_at = excluded.updated_at
	`, conversationID, userID, rejectedAt.UTC()); err != nil {
		return fmt.Errorf("update conversation request rejected state: %w", err)
	}

	return nil
}

func (r *Repository) restoreConversationVisibilityTx(
	ctx context.Context,
	tx pgx.Tx,
	conversationID string,
	userID string,
	updatedAt time.Time,
) error {
	if _, err := tx.Exec(ctx, `
		insert into direct_conversation_reads (
			conversation_id,
			user_id,
			last_read_at,
			updated_at
		)
		values ($1, $2, 'epoch'::timestamptz, $3)
		on conflict (conversation_id, user_id)
		do update set
			deleted_at = null,
			updated_at = $3
	`, conversationID, userID, updatedAt.UTC()); err != nil {
		return fmt.Errorf("restore conversation visibility state: %w", err)
	}

	return nil
}

func (r *Repository) setConversationMutedTx(
	ctx context.Context,
	tx pgx.Tx,
	conversationID string,
	userID string,
	muted bool,
	updatedAt time.Time,
) error {
	if _, err := tx.Exec(ctx, `
		insert into direct_conversation_reads (
			conversation_id,
			user_id,
			last_read_at,
			updated_at,
			is_muted
		)
		values ($1, $2, 'epoch'::timestamptz, $3, $4)
		on conflict (conversation_id, user_id)
		do update set
			is_muted = excluded.is_muted,
			updated_at = excluded.updated_at
	`, conversationID, userID, updatedAt.UTC(), muted); err != nil {
		return fmt.Errorf("update conversation muted state: %w", err)
	}

	return nil
}

func (r *Repository) setConversationArchiveStateTx(
	ctx context.Context,
	tx pgx.Tx,
	conversationID string,
	userID string,
	lastReadAt time.Time,
	clearedAt *time.Time,
	deletedAt *time.Time,
) error {
	if _, err := tx.Exec(ctx, `
		insert into direct_conversation_reads (
			conversation_id,
			user_id,
			last_read_at,
			updated_at,
			cleared_at,
			deleted_at
		)
		values ($1, $2, $3, $3, $4, $5)
		on conflict (conversation_id, user_id)
		do update set
			last_read_at = greatest(direct_conversation_reads.last_read_at, excluded.last_read_at),
			updated_at = excluded.updated_at,
			cleared_at = excluded.cleared_at,
			deleted_at = excluded.deleted_at
	`, conversationID, userID, lastReadAt.UTC(), nullableTime(clearedAt), nullableTime(deletedAt)); err != nil {
		return fmt.Errorf("update conversation archive state: %w", err)
	}

	return nil
}

func (r *Repository) MarkConversationRead(
	ctx context.Context,
	viewerID string,
	conversationID string,
	input ConversationReadInput,
) (ConversationReadResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	conversationID = strings.TrimSpace(conversationID)
	if viewerID == "" || conversationID == "" {
		return ConversationReadResponse{}, ErrConversationForbidden
	}

	requestedMessageID := strings.TrimSpace(input.MessageID)

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ConversationReadResponse{}, fmt.Errorf("begin mark read tx: %w", err)
	}
	defer tx.Rollback(ctx)

	peerID, err := r.resolveConversationPeerTx(ctx, tx, conversationID, viewerID, true, false)
	if err != nil {
		return ConversationReadResponse{}, err
	}

	readAt := time.Now().UTC()
	lastReadMessageID := requestedMessageID
	if requestedMessageID != "" {
		if err := tx.QueryRow(ctx, `
			select created_at
			from direct_messages
			where id = $1 and conversation_id = $2
		`, requestedMessageID, conversationID).Scan(&readAt); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ConversationReadResponse{}, ErrInvalidMessageAction
			}
			return ConversationReadResponse{}, fmt.Errorf("query requested read message: %w", err)
		}
	} else {
		latestErr := tx.QueryRow(ctx, `
			select id, created_at
			from direct_messages
			where conversation_id = $1
			order by created_at desc, id desc
			limit 1
		`, conversationID).Scan(&lastReadMessageID, &readAt)
		if latestErr != nil {
			if !errors.Is(latestErr, pgx.ErrNoRows) {
				return ConversationReadResponse{}, fmt.Errorf("query latest conversation message: %w", latestErr)
			}
			lastReadMessageID = ""
		}
	}

	if err := r.ensureConversationReadStateTx(
		ctx,
		tx,
		conversationID,
		viewerID,
		readAt,
	); err != nil {
		return ConversationReadResponse{}, err
	}

	var unreadCount int64
	if err := tx.QueryRow(ctx, `
		select coalesce(count(*), 0)
		from direct_messages unread
		where
			unread.conversation_id = $1
			and unread.sender_id <> $2
			and unread.created_at > $3
	`, conversationID, viewerID, readAt.UTC()).Scan(&unreadCount); err != nil {
		return ConversationReadResponse{}, fmt.Errorf("query unread count after mark read: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return ConversationReadResponse{}, fmt.Errorf("commit mark read tx: %w", err)
	}

	return ConversationReadResponse{
		ConversationID:    conversationID,
		LastReadAt:        readAt.UTC(),
		LastReadMessageID: lastReadMessageID,
		PeerID:            peerID,
		UnreadCount:       unreadCount,
	}, nil
}

func (r *Repository) insertConversationMessageTx(
	ctx context.Context,
	tx pgx.Tx,
	conversationID string,
	senderID string,
	input ConversationMessageInput,
) (ConversationMessage, error) {
	trimmedBody := strings.TrimSpace(input.Text)
	clientNonce := normalizeConversationClientNonce(input.ClientNonce)
	if trimmedBody == "" || len(trimmedBody) > maxConversationMessageLength {
		return ConversationMessage{}, ErrInvalidMessageAction
	}

	messageID := newID("dm")
	var createdAt time.Time
	var storedBody string
	var storedClientNonce string
	var storedMessageID string
	if err := tx.QueryRow(ctx, `
		insert into direct_messages (
			id,
			conversation_id,
			sender_id,
			body,
			client_nonce,
			created_at
		)
		values ($1, $2, $3, $4, nullif($5, ''), now())
		on conflict (conversation_id, sender_id, client_nonce)
			where client_nonce is not null
		do update set body = direct_messages.body
		returning id, body, coalesce(client_nonce, ''), created_at
	`, messageID, conversationID, senderID, trimmedBody, clientNonce).Scan(
		&storedMessageID,
		&storedBody,
		&storedClientNonce,
		&createdAt,
	); err != nil {
		return ConversationMessage{}, fmt.Errorf("insert direct message: %w", err)
	}
	if storedMessageID == "" {
		storedMessageID = messageID
	}
	if storedBody == "" {
		storedBody = trimmedBody
	}
	if storedClientNonce == "" {
		storedClientNonce = clientNonce
	}

	if _, err := tx.Exec(ctx, `
		update direct_conversations
		set
			last_message_id = case
				when coalesce(last_message_at, 'epoch'::timestamptz) <= $3 then $2
				else last_message_id
			end,
			last_message_at = greatest(
				coalesce(last_message_at, 'epoch'::timestamptz),
				$3
			),
			updated_at = now()
		where id = $1
	`, conversationID, storedMessageID, createdAt.UTC()); err != nil {
		return ConversationMessage{}, fmt.Errorf("update conversation latest message: %w", err)
	}

	return HydrateConversationMessage(ConversationMessage{
		Body:           storedBody,
		ClientNonce:    storedClientNonce,
		ConversationID: conversationID,
		CreatedAt:      createdAt.UTC(),
		ID:             storedMessageID,
		IsMine:         true,
		SenderID:       senderID,
	}), nil
}

func (r *Repository) insertProfileNotificationTx(
	ctx context.Context,
	tx pgx.Tx,
	payload profileNotificationPayload,
) (string, error) {
	recipientID := strings.TrimSpace(payload.RecipientID)
	actorID := strings.TrimSpace(payload.ActorID)
	if recipientID == "" || actorID == "" || recipientID == actorID {
		return "", nil
	}

	var tableExists bool
	if err := tx.QueryRow(ctx, `
		select to_regclass('public.profile_notifications') is not null
	`).Scan(&tableExists); err != nil {
		return "", fmt.Errorf("check profile notifications table: %w", err)
	}
	if !tableExists {
		return "", nil
	}

	notificationID := strings.TrimSpace(payload.ID)
	if notificationID == "" {
		notificationID = newID("notif")
	}
	title := strings.TrimSpace(payload.Title)
	if title == "" {
		title = "MacRadar"
	}
	body := strings.TrimSpace(payload.Body)
	if body == "" {
		body = "Yeni bildirim"
	}
	channel := strings.TrimSpace(payload.Channel)
	if channel == "" {
		channel = "activity"
	}
	notificationType := strings.TrimSpace(payload.Type)
	if notificationType == "" {
		notificationType = "generic"
	}

	metadata := payload.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return "", fmt.Errorf("marshal profile notification metadata: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		insert into profile_notifications (
			id,
			recipient_id,
			actor_id,
			title,
			body,
			type,
			channel,
			metadata,
			is_read,
			created_at,
			updated_at
		)
		select
			$1,
			$2,
			$3,
			$4,
			$5,
			$6,
			$7,
			$8::jsonb,
			false,
			now(),
			now()
		where case
			when $7 = 'messages' then coalesce((
				select notify_messages
				from user_profile_app_settings
				where user_id = $2
			), true)
			when $7 = 'follow_requests' then coalesce((
				select notify_follow_requests
				from user_profile_app_settings
				where user_id = $2
			), true)
			else true
		end
		on conflict (id) do nothing
	`,
		notificationID,
		recipientID,
		actorID,
		title,
		body,
		notificationType,
		channel,
		string(metadataJSON),
	); err != nil {
		return "", fmt.Errorf("insert profile notification: %w", err)
	}

	return notificationID, nil
}

func (r *Repository) deleteProfileNotificationByIDTx(ctx context.Context, tx pgx.Tx, id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil
	}

	var tableExists bool
	if err := tx.QueryRow(ctx, `
		select to_regclass('public.profile_notifications') is not null
	`).Scan(&tableExists); err != nil {
		return fmt.Errorf("check profile notifications table: %w", err)
	}
	if !tableExists {
		return nil
	}

	if _, err := tx.Exec(ctx, `
		delete from profile_notifications
		where id = $1
	`, id); err != nil {
		return fmt.Errorf("delete profile notification: %w", err)
	}

	return nil
}

func (r *Repository) deleteConversationMessageNotificationsTx(
	ctx context.Context,
	tx pgx.Tx,
	recipientID string,
	conversationID string,
) error {
	recipientID = strings.TrimSpace(recipientID)
	conversationID = strings.TrimSpace(conversationID)
	if recipientID == "" || conversationID == "" {
		return nil
	}

	var tableExists bool
	if err := tx.QueryRow(ctx, `
		select to_regclass('public.profile_notifications') is not null
	`).Scan(&tableExists); err != nil {
		return fmt.Errorf("check profile notifications table: %w", err)
	}
	if !tableExists {
		return nil
	}

	if _, err := tx.Exec(ctx, `
		delete from profile_notifications
		where
			recipient_id = $1
			and channel = 'messages'
			and coalesce(metadata->>'conversationId', '') = $2
	`, recipientID, conversationID); err != nil {
		return fmt.Errorf("delete conversation message notifications: %w", err)
	}

	return nil
}

func (r *Repository) deleteProfileNotificationByIDs(ctx context.Context, ids ...string) error {
	var tableExists bool
	if err := r.db.QueryRow(ctx, `
		select to_regclass('public.profile_notifications') is not null
	`).Scan(&tableExists); err != nil {
		return fmt.Errorf("check profile notifications table: %w", err)
	}
	if !tableExists {
		return nil
	}

	for _, raw := range ids {
		id := strings.TrimSpace(raw)
		if id == "" {
			continue
		}
		if _, err := r.db.Exec(ctx, `
			delete from profile_notifications
			where id = $1
		`, id); err != nil {
			return fmt.Errorf("delete profile notification: %w", err)
		}
	}

	return nil
}

func (r *Repository) insertMessageNotificationTx(
	ctx context.Context,
	tx pgx.Tx,
	recipientID string,
	actorID string,
	conversationID string,
	messageID string,
	messagePreview string,
) (string, error) {
	actorLabel := "MacRadar"
	actorUsername := ""
	var (
		label    string
		username string
	)
	if err := tx.QueryRow(ctx, `
		select
			coalesce(nullif(full_name, ''), nullif(username, ''), 'MacRadar') as label,
			coalesce(nullif(username, ''), nullif(full_name, ''), 'MacRadar') as username
		from users
		where id = $1
	`, actorID).Scan(&label, &username); err == nil && strings.TrimSpace(label) != "" {
		actorLabel = strings.TrimSpace(label)
		actorUsername = strings.TrimSpace(username)
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("query notification actor label: %w", err)
	}
	if actorUsername == "" {
		actorUsername = actorLabel
	}
	normalizedPreview := strings.TrimSpace(messagePreview)
	if normalizedPreview == "" {
		normalizedPreview = "Yeni mesaj"
	}

	return r.insertProfileNotificationTx(ctx, tx, profileNotificationPayload{
		ActorID: actorID,
		Body:    actorUsername + ": " + normalizedPreview,
		Channel: "messages",
		ID:      "notif_msg_" + strings.TrimSpace(messageID),
		Metadata: map[string]any{
			"actorLabel":     actorUsername,
			"conversationId": strings.TrimSpace(conversationID),
			"messagePreview": normalizedPreview,
			"messageId":      strings.TrimSpace(messageID),
		},
		RecipientID: recipientID,
		Title:       actorUsername,
		Type:        "message",
	})
}

func (r *Repository) CreateConversation(
	ctx context.Context,
	viewerID string,
	input ConversationCreateInput,
) (ConversationCreateResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	recipientID := strings.TrimSpace(input.RecipientID)
	if viewerID == "" || recipientID == "" || viewerID == recipientID {
		return ConversationCreateResponse{}, ErrInvalidMessageAction
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ConversationCreateResponse{}, fmt.Errorf("begin create conversation tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var recipientExists bool
	if err := tx.QueryRow(ctx, `
		select exists(select 1 from users where id = $1)
	`, recipientID).Scan(&recipientExists); err != nil {
		return ConversationCreateResponse{}, fmt.Errorf("query recipient exists: %w", err)
	}
	if !recipientExists {
		return ConversationCreateResponse{}, ErrUserNotFound
	}

	blocked, err := r.hasBlockedRelationshipTx(ctx, tx, viewerID, recipientID)
	if err != nil {
		return ConversationCreateResponse{}, err
	}
	if blocked {
		return ConversationCreateResponse{}, ErrBlockedRelationship
	}

	userAID, userBID := orderedUserPair(viewerID, recipientID)
	var (
		conversationID    string
		isNewConversation bool
	)
	if err := tx.QueryRow(ctx, `
		insert into direct_conversations (
			id,
			user_a_id,
			user_b_id,
			created_at,
			updated_at
		)
		values ($1, $2, $3, now(), now())
		on conflict (user_a_id, user_b_id)
		do update set updated_at = direct_conversations.updated_at
		returning id, (xmax = 0) as inserted
	`, newID("conv"), userAID, userBID).Scan(&conversationID, &isNewConversation); err != nil {
		return ConversationCreateResponse{}, fmt.Errorf("upsert direct conversation: %w", err)
	}

	epoch := time.Unix(0, 0).UTC()
	if err := r.ensureConversationReadStateTx(ctx, tx, conversationID, viewerID, epoch); err != nil {
		return ConversationCreateResponse{}, err
	}
	if err := r.ensureConversationReadStateTx(ctx, tx, conversationID, recipientID, epoch); err != nil {
		return ConversationCreateResponse{}, err
	}
	visibilityResetAt := time.Now().UTC()

	response := ConversationCreateResponse{
		ConversationID: conversationID,
	}
	snapshot, err := r.loadConversationMessagingSnapshotTx(
		ctx,
		tx,
		conversationID,
		viewerID,
		recipientID,
	)
	if err != nil {
		return ConversationCreateResponse{}, err
	}
	messagingState := buildConversationMessagingState(snapshot)

	initialMessage := strings.TrimSpace(input.InitialMessage)
	if initialMessage != "" && messagingState.CanSendMessage {
		message, err := r.insertConversationMessageTx(
			ctx,
			tx,
			conversationID,
			viewerID,
			ConversationMessageInput{
				Text: initialMessage,
			},
		)
		if err != nil {
			return ConversationCreateResponse{}, err
		}
		response.Message = &message
		if err := r.ensureConversationReadStateTx(
			ctx,
			tx,
			conversationID,
			viewerID,
			message.CreatedAt,
		); err != nil {
			return ConversationCreateResponse{}, err
		}
		if !snapshot.directMessagingAvailable() {
			if err := r.setConversationRequestAcceptedTx(
				ctx,
				tx,
				conversationID,
				viewerID,
				message.CreatedAt,
			); err != nil {
				return ConversationCreateResponse{}, err
			}
		}
		visibilityResetAt = message.CreatedAt
	}
	if err := r.restoreConversationVisibilityTx(ctx, tx, conversationID, viewerID, visibilityResetAt); err != nil {
		return ConversationCreateResponse{}, err
	}
	if response.Message != nil {
		if err := r.restoreConversationVisibilityTx(ctx, tx, conversationID, recipientID, visibilityResetAt); err != nil {
			return ConversationCreateResponse{}, err
		}
		if _, err := r.insertMessageNotificationTx(
			ctx,
			tx,
			recipientID,
			viewerID,
			conversationID,
			response.Message.ID,
			response.Message.Preview,
		); err != nil {
			return ConversationCreateResponse{}, err
		}
	} else if isNewConversation {
		deletedAt := visibilityResetAt
		if err := r.setConversationArchiveStateTx(
			ctx,
			tx,
			conversationID,
			recipientID,
			epoch,
			nil,
			&deletedAt,
		); err != nil {
			return ConversationCreateResponse{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return ConversationCreateResponse{}, fmt.Errorf("commit create conversation tx: %w", err)
	}

	summary, err := r.conversationSummaryByID(ctx, viewerID, conversationID)
	if err != nil {
		return ConversationCreateResponse{}, err
	}
	response.Conversation = &summary
	return response, nil
}

func (r *Repository) AcceptConversationRequest(
	ctx context.Context,
	viewerID string,
	conversationID string,
) (ConversationRequestAcceptResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	conversationID = strings.TrimSpace(conversationID)
	if viewerID == "" || conversationID == "" {
		return ConversationRequestAcceptResponse{}, ErrConversationForbidden
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ConversationRequestAcceptResponse{}, fmt.Errorf("begin accept conversation request tx: %w", err)
	}
	defer tx.Rollback(ctx)

	peerID, err := r.resolveConversationPeerTx(ctx, tx, conversationID, viewerID, true, false)
	if err != nil {
		return ConversationRequestAcceptResponse{}, err
	}

	snapshot, err := r.loadConversationMessagingSnapshotTx(
		ctx,
		tx,
		conversationID,
		viewerID,
		peerID,
	)
	if err != nil {
		return ConversationRequestAcceptResponse{}, err
	}
	messagingState := buildConversationMessagingState(snapshot)

	acceptedAt := time.Now().UTC()
	if messagingState.MessagingMode == ConversationMessagingModeRequestPendingIncoming {
		if err := r.setConversationRequestAcceptedTx(ctx, tx, conversationID, viewerID, acceptedAt); err != nil {
			return ConversationRequestAcceptResponse{}, err
		}
		if err := r.restoreConversationVisibilityTx(ctx, tx, conversationID, viewerID, acceptedAt); err != nil {
			return ConversationRequestAcceptResponse{}, err
		}
	} else if snapshot.ViewerRequestAcceptedAt.Valid {
		acceptedAt = snapshot.ViewerRequestAcceptedAt.Time.UTC()
	} else {
		return ConversationRequestAcceptResponse{}, ErrConversationForbidden
	}

	if err := tx.Commit(ctx); err != nil {
		return ConversationRequestAcceptResponse{}, fmt.Errorf("commit accept conversation request tx: %w", err)
	}

	summary, err := r.conversationSummaryByID(ctx, viewerID, conversationID)
	if err != nil {
		return ConversationRequestAcceptResponse{}, err
	}
	return ConversationRequestAcceptResponse{
		AcceptedAt:     acceptedAt,
		Conversation:   &summary,
		ConversationID: conversationID,
	}, nil
}

func (r *Repository) RejectConversationRequest(
	ctx context.Context,
	viewerID string,
	conversationID string,
) (ConversationRequestRejectResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	conversationID = strings.TrimSpace(conversationID)
	if viewerID == "" || conversationID == "" {
		return ConversationRequestRejectResponse{}, ErrConversationForbidden
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ConversationRequestRejectResponse{}, fmt.Errorf("begin reject conversation request tx: %w", err)
	}
	defer tx.Rollback(ctx)

	peerID, err := r.resolveConversationPeerTx(ctx, tx, conversationID, viewerID, true, false)
	if err != nil {
		return ConversationRequestRejectResponse{}, err
	}

	snapshot, err := r.loadConversationMessagingSnapshotTx(
		ctx,
		tx,
		conversationID,
		viewerID,
		peerID,
	)
	if err != nil {
		return ConversationRequestRejectResponse{}, err
	}
	messagingState := buildConversationMessagingState(snapshot)

	rejectedAt := time.Now().UTC()
	if messagingState.MessagingMode == ConversationMessagingModeRequestPendingIncoming {
		// Message request deletion: clear request state fully, hide from recipient box,
		// and allow future messages to start from a clean request flow.
		if _, err := tx.Exec(ctx, `
			delete from direct_messages
			where conversation_id = $1
		`, conversationID); err != nil {
			return ConversationRequestRejectResponse{}, fmt.Errorf("delete request conversation messages: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			update direct_conversations
			set
				last_message_id = null,
				last_message_at = null,
				updated_at = now()
			where id = $1
		`, conversationID); err != nil {
			return ConversationRequestRejectResponse{}, fmt.Errorf("reset request conversation latest message: %w", err)
		}
		if err := r.setConversationArchiveStateTx(
			ctx,
			tx,
			conversationID,
			viewerID,
			rejectedAt,
			&rejectedAt,
			&rejectedAt,
		); err != nil {
			return ConversationRequestRejectResponse{}, err
		}
		if _, err := tx.Exec(ctx, `
			update direct_conversation_reads
			set
				request_accepted_at = null,
				request_rejected_at = null,
				updated_at = now()
			where
				conversation_id = $1
				and user_id in ($2, $3)
		`, conversationID, viewerID, peerID); err != nil {
			return ConversationRequestRejectResponse{}, fmt.Errorf("reset request state after deletion: %w", err)
		}
		if err := r.deleteConversationMessageNotificationsTx(ctx, tx, viewerID, conversationID); err != nil {
			return ConversationRequestRejectResponse{}, err
		}
	} else if snapshot.ViewerRequestRejectedAt.Valid {
		rejectedAt = snapshot.ViewerRequestRejectedAt.Time.UTC()
	} else {
		return ConversationRequestRejectResponse{}, ErrConversationForbidden
	}

	if err := tx.Commit(ctx); err != nil {
		return ConversationRequestRejectResponse{}, fmt.Errorf("commit reject conversation request tx: %w", err)
	}

	return ConversationRequestRejectResponse{
		ConversationID: conversationID,
		RejectedAt:     rejectedAt,
	}, nil
}

func (r *Repository) ListConversationMessages(
	ctx context.Context,
	viewerID string,
	conversationID string,
	cursor string,
	limit int,
) (ConversationMessagesResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	conversationID = strings.TrimSpace(conversationID)
	if viewerID == "" || conversationID == "" {
		return ConversationMessagesResponse{}, ErrConversationForbidden
	}

	normalizedLimit := normalizeConversationMessageLimit(limit)
	cursorState, err := decodeTimelineCursor(cursor)
	if err != nil {
		return ConversationMessagesResponse{}, err
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ConversationMessagesResponse{}, fmt.Errorf("begin list conversation messages tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := r.resolveConversationPeerTx(ctx, tx, conversationID, viewerID, false, false); err != nil {
		return ConversationMessagesResponse{}, err
	}

	rows, err := tx.Query(ctx, `
		select
			m.id,
			m.conversation_id,
			m.sender_id,
			m.body,
			coalesce(m.client_nonce, ''),
			m.created_at
		from direct_messages m
		left join direct_conversation_reads dcr
			on dcr.conversation_id = m.conversation_id and dcr.user_id = $2
		where
			m.conversation_id = $1
			and m.created_at > greatest(
				coalesce(dcr.cleared_at, 'epoch'::timestamptz),
				coalesce(dcr.deleted_at, 'epoch'::timestamptz)
			)
			and (
				$3::timestamptz is null
				or m.created_at < $3
				or (m.created_at = $3 and m.id < $4)
			)
		order by m.created_at desc, m.id desc
		limit $5
	`,
		conversationID,
		viewerID,
		nullableTimelineCursorTime(cursorState),
		nullableTimelineCursorID(cursorState),
		normalizedLimit+1,
	)
	if err != nil {
		return ConversationMessagesResponse{}, fmt.Errorf("query conversation messages: %w", err)
	}
	defer rows.Close()

	messages := make([]ConversationMessage, 0, normalizedLimit+1)
	for rows.Next() {
		var item ConversationMessage
		if err := rows.Scan(
			&item.ID,
			&item.ConversationID,
			&item.SenderID,
			&item.Body,
			&item.ClientNonce,
			&item.CreatedAt,
		); err != nil {
			return ConversationMessagesResponse{}, fmt.Errorf("scan conversation message row: %w", err)
		}
		item.IsMine = item.SenderID == viewerID
		messages = append(messages, HydrateConversationMessage(item))
	}

	if rows.Err() != nil {
		return ConversationMessagesResponse{}, fmt.Errorf("iterate conversation messages: %w", rows.Err())
	}

	hasMore := len(messages) > normalizedLimit
	if hasMore {
		messages = messages[:normalizedLimit]
	}

	nextCursor := ""
	if hasMore && len(messages) > 0 {
		last := messages[len(messages)-1]
		nextCursor, err = encodeTimelineCursor(timelineCursorState{
			CreatedAt: last.CreatedAt.UTC(),
			ID:        last.ID,
		})
		if err != nil {
			return ConversationMessagesResponse{}, fmt.Errorf("encode conversation messages cursor: %w", err)
		}
	}

	if err := r.ensureConversationReadStateTx(
		ctx,
		tx,
		conversationID,
		viewerID,
		time.Now().UTC(),
	); err != nil {
		return ConversationMessagesResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return ConversationMessagesResponse{}, fmt.Errorf("commit list conversation messages tx: %w", err)
	}

	return ConversationMessagesResponse{
		ConversationID: conversationID,
		HasMore:        hasMore,
		Messages:       messages,
		NextCursor:     nextCursor,
	}, nil
}

func (r *Repository) SendConversationMessage(
	ctx context.Context,
	viewerID string,
	conversationID string,
	input ConversationMessageInput,
) (ConversationMessageResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	conversationID = strings.TrimSpace(conversationID)
	if viewerID == "" || conversationID == "" {
		return ConversationMessageResponse{}, ErrConversationForbidden
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ConversationMessageResponse{}, fmt.Errorf("begin send conversation message tx: %w", err)
	}
	defer tx.Rollback(ctx)

	peerID, err := r.resolveConversationPeerTx(ctx, tx, conversationID, viewerID, true, true)
	if err != nil {
		return ConversationMessageResponse{}, err
	}

	snapshot, err := r.loadConversationMessagingSnapshotTx(
		ctx,
		tx,
		conversationID,
		viewerID,
		peerID,
	)
	if err != nil {
		return ConversationMessageResponse{}, err
	}
	messagingState := buildConversationMessagingState(snapshot)
	if !messagingState.CanSendMessage {
		switch messagingState.MessagingMode {
		case ConversationMessagingModeRequestPendingIncoming,
			ConversationMessagingModeRequestPendingOutgoing:
			return ConversationMessageResponse{}, ErrConversationRequestPending
		case ConversationMessagingModeRequestRejected:
			return ConversationMessageResponse{}, ErrConversationRequestRejected
		case ConversationMessagingModeRestricted:
			return ConversationMessageResponse{}, ErrConversationRestricted
		case ConversationMessagingModeBlocked:
			return ConversationMessageResponse{}, ErrBlockedRelationship
		default:
			return ConversationMessageResponse{}, ErrConversationForbidden
		}
	}

	message, err := r.insertConversationMessageTx(ctx, tx, conversationID, viewerID, input)
	if err != nil {
		return ConversationMessageResponse{}, err
	}
	if err := r.ensureConversationReadStateTx(
		ctx,
		tx,
		conversationID,
		viewerID,
		message.CreatedAt,
	); err != nil {
		return ConversationMessageResponse{}, err
	}
	if err := r.restoreConversationVisibilityTx(ctx, tx, conversationID, viewerID, message.CreatedAt); err != nil {
		return ConversationMessageResponse{}, err
	}
	if err := r.restoreConversationVisibilityTx(ctx, tx, conversationID, peerID, message.CreatedAt); err != nil {
		return ConversationMessageResponse{}, err
	}
	if !snapshot.directMessagingAvailable() {
		if err := r.setConversationRequestAcceptedTx(ctx, tx, conversationID, viewerID, message.CreatedAt); err != nil {
			return ConversationMessageResponse{}, err
		}
	}
	if _, err := r.insertMessageNotificationTx(
		ctx,
		tx,
		peerID,
		viewerID,
		conversationID,
		message.ID,
		message.Preview,
	); err != nil {
		return ConversationMessageResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return ConversationMessageResponse{}, fmt.Errorf("commit send conversation message tx: %w", err)
	}

	summary, err := r.conversationSummaryByID(ctx, viewerID, conversationID)
	if err != nil {
		return ConversationMessageResponse{}, err
	}
	return ConversationMessageResponse{
		ConversationID: conversationID,
		Conversation:   &summary,
		Message:        message,
	}, nil
}

func (r *Repository) SetConversationMuted(
	ctx context.Context,
	viewerID string,
	conversationID string,
	muted bool,
) (ConversationMuteResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	conversationID = strings.TrimSpace(conversationID)
	if viewerID == "" || conversationID == "" {
		return ConversationMuteResponse{}, ErrConversationForbidden
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ConversationMuteResponse{}, fmt.Errorf("begin mute conversation tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := r.resolveConversationPeerTx(ctx, tx, conversationID, viewerID, true, false); err != nil {
		return ConversationMuteResponse{}, err
	}

	updatedAt := time.Now().UTC()
	if err := r.setConversationMutedTx(ctx, tx, conversationID, viewerID, muted, updatedAt); err != nil {
		return ConversationMuteResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return ConversationMuteResponse{}, fmt.Errorf("commit mute conversation tx: %w", err)
	}

	return ConversationMuteResponse{
		ConversationID: conversationID,
		Muted:          muted,
	}, nil
}

func (r *Repository) ClearConversationMessages(
	ctx context.Context,
	viewerID string,
	conversationID string,
) (ConversationClearResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	conversationID = strings.TrimSpace(conversationID)
	if viewerID == "" || conversationID == "" {
		return ConversationClearResponse{}, ErrConversationForbidden
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ConversationClearResponse{}, fmt.Errorf("begin clear conversation tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := r.resolveConversationPeerTx(ctx, tx, conversationID, viewerID, true, false); err != nil {
		return ConversationClearResponse{}, err
	}

	clearedAt := time.Now().UTC()
	if err := r.setConversationArchiveStateTx(
		ctx,
		tx,
		conversationID,
		viewerID,
		clearedAt,
		&clearedAt,
		nil,
	); err != nil {
		return ConversationClearResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return ConversationClearResponse{}, fmt.Errorf("commit clear conversation tx: %w", err)
	}

	return ConversationClearResponse{
		ClearedAt:      clearedAt,
		ConversationID: conversationID,
		UnreadCount:    0,
	}, nil
}

func (r *Repository) DeleteConversationForUser(
	ctx context.Context,
	viewerID string,
	conversationID string,
) (ConversationDeleteResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	conversationID = strings.TrimSpace(conversationID)
	if viewerID == "" || conversationID == "" {
		return ConversationDeleteResponse{}, ErrConversationForbidden
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ConversationDeleteResponse{}, fmt.Errorf("begin delete conversation tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := r.resolveConversationPeerTx(ctx, tx, conversationID, viewerID, true, false); err != nil {
		return ConversationDeleteResponse{}, err
	}

	deletedAt := time.Now().UTC()
	if err := r.setConversationArchiveStateTx(
		ctx,
		tx,
		conversationID,
		viewerID,
		deletedAt,
		&deletedAt,
		&deletedAt,
	); err != nil {
		return ConversationDeleteResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return ConversationDeleteResponse{}, fmt.Errorf("commit delete conversation tx: %w", err)
	}

	return ConversationDeleteResponse{
		ConversationID: conversationID,
		Deleted:        true,
		Mode:           ConversationDeleteModeSelf,
	}, nil
}

func (r *Repository) HardDeleteConversation(
	ctx context.Context,
	viewerID string,
	conversationID string,
) (ConversationDeleteResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	conversationID = strings.TrimSpace(conversationID)
	if viewerID == "" || conversationID == "" {
		return ConversationDeleteResponse{}, ErrConversationForbidden
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ConversationDeleteResponse{}, fmt.Errorf("begin hard delete conversation tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := r.resolveConversationPeerTx(ctx, tx, conversationID, viewerID, true, false); err != nil {
		return ConversationDeleteResponse{}, err
	}

	result, err := tx.Exec(ctx, `
		delete from direct_conversations
		where id = $1
	`, conversationID)
	if err != nil {
		return ConversationDeleteResponse{}, fmt.Errorf("hard delete conversation: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ConversationDeleteResponse{}, ErrConversationNotFound
	}

	if err := tx.Commit(ctx); err != nil {
		return ConversationDeleteResponse{}, fmt.Errorf("commit hard delete conversation tx: %w", err)
	}

	return ConversationDeleteResponse{
		ConversationID: conversationID,
		Deleted:        true,
		Mode:           ConversationDeleteModeHard,
	}, nil
}
