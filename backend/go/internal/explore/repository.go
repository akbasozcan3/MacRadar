package explore

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInvalidCreatePostInput      = errors.New("invalid create post input")
	ErrInvalidUpdatePostInput      = errors.New("invalid update post input")
	ErrCreatorNotFound             = errors.New("creator not found")
	ErrBlockedRelationship         = errors.New("blocked relationship")
	ErrCommentNotFound             = errors.New("comment not found")
	ErrConversationForbidden       = errors.New("conversation forbidden")
	ErrConversationNotFound        = errors.New("conversation not found")
	ErrConversationRequestPending  = errors.New("conversation request pending")
	ErrConversationRequestRejected = errors.New("conversation request rejected")
	ErrConversationRestricted      = errors.New("conversation restricted")
	ErrInvalidFeedCursor           = errors.New("invalid feed cursor")
	ErrInvalidFollowAction         = errors.New("invalid follow action")
	ErrInvalidMessageAction        = errors.New("invalid message action")
	ErrInvalidRecentSearchAction   = errors.New("invalid recent search action")
	ErrInvalidSearchCursor         = errors.New("invalid search cursor")
	ErrInvalidTagDetail            = errors.New("invalid tag detail")
	ErrInvalidStreetFriendAction   = errors.New("invalid street friend action")
	ErrPostAccessForbidden         = errors.New("post access forbidden")
	ErrPostEditForbidden           = errors.New("post edit forbidden")
	ErrPostDeleteForbidden         = errors.New("post delete forbidden")
	ErrPostNotFound                = errors.New("post not found")
	ErrProfilePrivate              = errors.New("profile private")
	ErrUserNotFound                = errors.New("user not found")
)

const playlistCacheTTL = 2 * time.Minute
const defaultFeedPageLimit = 8
const maxFeedPageLimit = 24
const defaultUserSearchLimit = 20
const maxUserSearchLimit = 40
const defaultPostSearchLimit = 18
const maxPostSearchLimit = 40
const defaultRecentUserSearchLimit = 8
const maxRecentUserSearchLimit = 24
const maxRecentUserSearchHistory = 40
const defaultRecentTermSearchLimit = 8
const maxRecentTermSearchLimit = 24
const maxRecentTermSearchHistory = 40
const defaultPopularSearchLimit = 8
const maxPopularSearchLimit = 24

const (
	streetStatusAccepted = "accepted"
	streetStatusPending  = "pending"

	maxCreatePostCaptionLength  = 280
	maxCreatePostHashtagCount   = 8
	maxCreatePostLocationLength = 120
)

var hiddenExploreFeedUsernames = []string{
	"alp.route",
	"city.line",
	"night.driver",
}

var exploreSearchNormalizer = strings.NewReplacer(
	"\u00e7", "c",
	"\u011f", "g",
	"\u0131", "i",
	"\u00f6", "o",
	"\u015f", "s",
	"\u00fc", "u",
	"\u00e2", "a",
	"\u00ee", "i",
	"\u00fb", "u",
)

var profilePostHashtagPattern = regexp.MustCompile(`#([\p{L}\p{N}_]{2,32})`)
var normalizedExploreHashtagPattern = regexp.MustCompile(`^[a-z0-9_]{2,32}$`)

type playlistCacheEntry struct {
	expiresAt time.Time
	playlist  *Playlist
}

type Repository struct {
	db *pgxpool.Pool

	playlistCache   map[Segment]playlistCacheEntry
	playlistCacheMu sync.RWMutex
}

type feedCursorState struct {
	CreatedAt     time.Time `json:"createdAt"`
	PostID        string    `json:"postId"`
	RankingScore  float64   `json:"rankingScore"`
	ReferenceTime time.Time `json:"referenceTime"`
	Segment       Segment   `json:"segment"`
	RankVersion   string    `json:"rankVersion"`
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{
		db:            db,
		playlistCache: make(map[Segment]playlistCacheEntry, 3),
	}
}

func (r *Repository) Ping(ctx context.Context) error {
	return r.db.Ping(ctx)
}

func (r *Repository) ListFeed(ctx context.Context, input FeedPageQuery) (FeedResponse, error) {
	segment := NormalizeSegment(string(input.Segment))
	viewerID := strings.TrimSpace(input.ViewerID)
	if viewerID == "" {
		return FeedResponse{}, errors.New("viewer id is required")
	}

	limit := normalizeFeedLimit(input.Limit)
	cursor, err := decodeFeedCursor(input.Cursor, segment)
	if err != nil {
		return FeedResponse{}, err
	}

	referenceTime := time.Now().UTC()
	if cursor != nil {
		referenceTime = cursor.ReferenceTime.UTC()
	}

	rows, err := r.db.Query(ctx, `
		with ranked as (
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
				u.id as author_id,
				u.username,
				u.avatar_url,
				u.is_verified,
				(f.followed_user_id is not null) as is_following,
				coalesce(pe.liked, false) as is_liked,
				coalesce(pe.bookmarked, false) as is_bookmarked,
				coalesce(sf.status, '') as street_friend_state,
				coalesce(sf.requested_by, '') as street_friend_requested_by,
				round((
					ln(1 + greatest(p.likes_count, 0)::double precision) * 1.9 +
					ln(1 + greatest(p.comments_count, 0)::double precision) * 2.4 +
					ln(1 + greatest(p.bookmarks_count, 0)::double precision) * 2.0 +
					ln(1 + greatest(p.shares_count, 0)::double precision) * 2.7 +
					exp(-greatest(extract(epoch from ($3::timestamptz - p.created_at)) / 3600.0, 0) / 18.0) * 3.2
				)::numeric, 6)::double precision as ranking_score,
				(
					select coalesce(json_agg(t), '[]')
					from (
						select
							c.id, c.body, c.like_count, c.created_at,
							cu.id as author_id, cu.username as author_username, cu.avatar_url as author_avatar_url, cu.is_verified as author_is_verified,
							exists(select 1 from comment_engagements ce where ce.comment_id = c.id and ce.viewer_id = $4) as is_liked
						from comments c
						join users cu on cu.id = c.user_id
						where c.post_id = p.id
						order by c.created_at desc
						limit 2
					) t
				) as recent_comments_json,
				(
					select coalesce(json_agg(t), '[]')
					from (
						select lu.id, lu.username, lu.avatar_url, lu.is_verified
						from post_engagements lpe
						join users lu on lu.id = lpe.viewer_id
						where lpe.post_id = p.id and lpe.liked = true
						order by lpe.updated_at desc
						limit 3
					) t
				) as recent_likes_json
			from posts p
			join users u on u.id = p.user_id
			left join follows f on f.follower_id = $4 and f.followed_user_id = u.id
			left join post_engagements pe on pe.viewer_id = $4 and pe.post_id = p.id
			left join lateral (
				select sf.status, sf.requested_by
				from street_friendships sf
				where
					(sf.user_a_id = $4 and sf.user_b_id = u.id)
					or (sf.user_a_id = u.id and sf.user_b_id = $4)
				limit 1
			) sf on true
			where
				p.is_live = true
				and not exists (
					select 1
					from blocked_users b
					where
						(b.blocker_id = $4 and b.blocked_user_id = u.id)
						or (b.blocker_id = u.id and b.blocked_user_id = $4)
				)
				and (
					u.id = $4
					or coalesce(u.is_private_account, false) = false
					or f.followed_user_id is not null
				)
				and (
					u.id = $4
					or (
						coalesce(u.is_private_account, false) = true
						and f.followed_user_id is not null
					)
					or coalesce(p.visibility, 'public') = 'public'
					or (
						coalesce(p.visibility, 'public') = 'friends'
						and (
							f.followed_user_id is not null
							or coalesce(sf.status, '') = 'accepted'
						)
					)
				)
				and lower(u.username) <> all($8::text[])
				and (
					($1::text = 'kesfet')
					or ($1::text = 'takipte' and f.followed_user_id is not null)
					or ($1::text = 'sizin-icin' and f.followed_user_id is null and u.id <> $4)
				)
		)
		select
			id,
			segment,
			media_type,
			media_url,
			caption,
			location_name,
			created_at,
			likes_count,
			comments_count,
			bookmarks_count,
			shares_count,
			author_id,
			username,
			avatar_url,
			is_verified,
			is_following,
			is_liked,
			is_bookmarked,
			street_friend_state,
			street_friend_requested_by,
			ranking_score,
			recent_comments_json,
			recent_likes_json
		from ranked
		where
			$5::double precision is null
			or ranking_score < $5
			or (ranking_score = $5 and created_at < $6::timestamptz)
			or (ranking_score = $5 and created_at = $6::timestamptz and id < $7)
		order by ranking_score desc, created_at desc, id desc
		limit $2
	`,
		string(segment),
		limit+1,
		referenceTime,
		viewerID,
		nullableCursorScore(cursor),
		nullableCursorCreatedAt(cursor),
		nullableCursorPostID(cursor),
		hiddenExploreFeedUsernames,
	)
	if err != nil {
		return FeedResponse{}, fmt.Errorf("query feed: %w", err)
	}
	defer rows.Close()

	posts := make([]Post, 0, 8)

	for rows.Next() {
		var (
			post                    Post
			isBookmarked            bool
			isFollowing             bool
			isLiked                 bool
			streetFriendState       string
			streetFriendRequestedBy string
			recentCommentsJSON      []byte
			recentLikesJSON         []byte
		)

		if err := rows.Scan(
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
			&streetFriendState,
			&streetFriendRequestedBy,
			&post.RankingScore,
			&recentCommentsJSON,
			&recentLikesJSON,
		); err != nil {
			return FeedResponse{}, fmt.Errorf("scan feed row: %w", err)
		}

		relationshipStatus, isStreetFriend := viewerStreetFriendState(
			streetFriendState,
			streetFriendRequestedBy,
			viewerID,
		)
		post.ViewerState = ViewerState{
			FollowRequestStatus: FollowRequestStatusNone,
			IsBookmarked:        isBookmarked,
			IsFollowing:         isFollowing,
			IsLiked:             isLiked,
			IsStreetFriend:      isStreetFriend,
			StreetFriendStatus:  relationshipStatus,
		}

		// Unmarshal recent comments
		type dbComment struct {
			ID             string    `json:"id"`
			Body           string    `json:"body"`
			LikeCount      int       `json:"like_count"`
			CreatedAt      time.Time `json:"created_at"`
			AuthorID       string    `json:"author_id"`
			AuthorUsername string    `json:"author_username"`
			AuthorAvatar   string    `json:"author_avatar_url"`
			AuthorVerified bool      `json:"author_is_verified"`
			IsLiked        bool      `json:"is_liked"`
		}
		var dbComments []dbComment
		if err := json.Unmarshal(recentCommentsJSON, &dbComments); err == nil {
			for _, dbc := range dbComments {
				post.RecentComments = append(post.RecentComments, Comment{
					ID:        dbc.ID,
					PostID:    post.ID,
					Body:      dbc.Body,
					LikeCount: dbc.LikeCount,
					CreatedAt: dbc.CreatedAt,
					Author: Author{
						ID:         dbc.AuthorID,
						Username:   dbc.AuthorUsername,
						AvatarURL:  dbc.AuthorAvatar,
						IsVerified: dbc.AuthorVerified,
					},
					IsLiked: dbc.IsLiked,
				})
			}
		}

		// Unmarshal recent likes
		var dbLikes []Author
		if err := json.Unmarshal(recentLikesJSON, &dbLikes); err == nil {
			post.RecentLikes = dbLikes
		}

		posts = append(posts, post)
	}

	if rows.Err() != nil {
		return FeedResponse{}, fmt.Errorf("iterate feed rows: %w", rows.Err())
	}

	hasMore := len(posts) > limit
	if hasMore {
		posts = posts[:limit]
	}

	nextCursor := ""
	if hasMore && len(posts) > 0 {
		lastPost := posts[len(posts)-1]
		nextCursor, err = encodeFeedCursor(feedCursorState{
			CreatedAt:     lastPost.CreatedAt.UTC(),
			PostID:        lastPost.ID,
			RankingScore:  lastPost.RankingScore,
			ReferenceTime: referenceTime.UTC(),
			Segment:       segment,
			RankVersion:   FeedRankVersion,
		})
		if err != nil {
			return FeedResponse{}, fmt.Errorf("encode feed cursor: %w", err)
		}
	}

	return FeedResponse{
		GeneratedAt: referenceTime.UTC(),
		HasMore:     hasMore,
		NextCursor:  nextCursor,
		Posts:       posts,
		RankVersion: FeedRankVersion,
		Segment:     segment,
	}, nil
}

func normalizeFeedLimit(limit int) int {
	if limit <= 0 {
		return defaultFeedPageLimit
	}
	if limit > maxFeedPageLimit {
		return maxFeedPageLimit
	}

	return limit
}

func normalizeSearchLimit(limit int) int {
	if limit <= 0 {
		return defaultUserSearchLimit
	}
	if limit > maxUserSearchLimit {
		return maxUserSearchLimit
	}

	return limit
}

func normalizeRecentUserSearchLimit(limit int) int {
	if limit <= 0 {
		return defaultRecentUserSearchLimit
	}
	if limit > maxRecentUserSearchLimit {
		return maxRecentUserSearchLimit
	}

	return limit
}

func normalizeRecentTermSearchLimit(limit int) int {
	if limit <= 0 {
		return defaultRecentTermSearchLimit
	}
	if limit > maxRecentTermSearchLimit {
		return maxRecentTermSearchLimit
	}

	return limit
}

func normalizePopularSearchLimit(limit int) int {
	if limit <= 0 {
		return defaultPopularSearchLimit
	}
	if limit > maxPopularSearchLimit {
		return maxPopularSearchLimit
	}

	return limit
}

func normalizePostSearchLimit(limit int) int {
	if limit <= 0 {
		return defaultPostSearchLimit
	}
	if limit > maxPostSearchLimit {
		return maxPostSearchLimit
	}

	return limit
}

func normalizeExploreSearchText(value string, trimPrefixes string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if trimPrefixes != "" {
		normalized = strings.TrimLeft(normalized, trimPrefixes)
	}
	normalized = exploreSearchNormalizer.Replace(normalized)
	return strings.Join(strings.Fields(normalized), " ")
}

func buildExploreSearchPattern(normalizedQuery string) string {
	if normalizedQuery == "" {
		return "%"
	}

	return "%" + strings.ReplaceAll(normalizedQuery, " ", "%") + "%"
}

func normalizeExploreHashtag(value string) string {
	normalized := normalizeExploreSearchText(value, "#")
	if !normalizedExploreHashtagPattern.MatchString(normalized) {
		return ""
	}

	return normalized
}

func trimToRuneLength(value string, maxRunes int) string {
	trimmed := strings.TrimSpace(value)
	if maxRunes <= 0 {
		return trimmed
	}
	runes := []rune(trimmed)
	if len(runes) <= maxRunes {
		return trimmed
	}
	return strings.TrimSpace(string(runes[:maxRunes]))
}

func normalizeRecentSearchTerm(
	kind RecentSearchTermKind,
	rawQuery string,
) (displayQuery string, queryKey string, err error) {
	trimmedQuery := trimToRuneLength(rawQuery, 120)
	if trimmedQuery == "" {
		return "", "", ErrInvalidRecentSearchAction
	}

	normalizedKind, ok := ParseRecentSearchTermKind(string(kind))
	if !ok {
		return "", "", ErrInvalidRecentSearchAction
	}

	switch normalizedKind {
	case RecentSearchTermKindPosts:
		display := strings.Join(strings.Fields(trimmedQuery), " ")
		key := normalizeExploreSearchText(display, "")
		if len([]rune(key)) < 2 {
			return "", "", ErrInvalidRecentSearchAction
		}
		return display, key, nil
	case RecentSearchTermKindTags:
		normalizedTag := normalizeExploreHashtag(trimmedQuery)
		if normalizedTag == "" {
			return "", "", ErrInvalidRecentSearchAction
		}
		return "#" + normalizedTag, normalizedTag, nil
	case RecentSearchTermKindPlaces:
		display := strings.Join(strings.Fields(trimmedQuery), " ")
		key := normalizeExploreSearchText(display, "")
		if len([]rune(key)) < 2 {
			return "", "", ErrInvalidRecentSearchAction
		}
		return display, key, nil
	default:
		return "", "", ErrInvalidRecentSearchAction
	}
}

func normalizeRecentSearchQueryFilter(
	kind RecentSearchTermKind,
	rawQuery string,
) string {
	trimmed := trimToRuneLength(rawQuery, 120)
	if trimmed == "" {
		return ""
	}

	switch kind {
	case RecentSearchTermKindTags:
		normalizedTag := normalizeExploreSearchText(strings.TrimLeft(trimmed, "#"), "")
		return strings.ReplaceAll(normalizedTag, " ", "")
	case RecentSearchTermKindPosts, RecentSearchTermKindPlaces:
		return normalizeExploreSearchText(trimmed, "")
	default:
		return ""
	}
}

func extractNormalizedProfilePostHashtags(value string) []string {
	matches := profilePostHashtagPattern.FindAllStringSubmatch(value, -1)
	if len(matches) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(matches))
	tags := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}

		tag := normalizeExploreSearchText(match[1], "")
		if tag == "" {
			continue
		}
		if _, exists := seen[tag]; exists {
			continue
		}

		seen[tag] = struct{}{}
		tags = append(tags, tag)
	}

	return tags
}

func decodeSearchOffsetCursor(raw string) (int, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0, nil
	}

	offset, err := strconv.Atoi(trimmed)
	if err != nil || offset < 0 {
		return 0, ErrInvalidSearchCursor
	}

	return offset, nil
}

func canViewerAccessPostVisibility(
	visibility PostVisibility,
	viewerID string,
	authorID string,
	isPrivateAccount bool,
	isFollowing bool,
	isStreetFriend bool,
) bool {
	if strings.TrimSpace(viewerID) != "" && strings.TrimSpace(viewerID) == strings.TrimSpace(authorID) {
		return true
	}

	if isPrivateAccount {
		return isFollowing
	}

	switch NormalizePostVisibility(string(visibility)) {
	case PostVisibilityPrivate:
		return false
	case PostVisibilityFriends:
		return isFollowing || isStreetFriend
	default:
		return true
	}
}

func isSupportedProfilePostMediaURL(mediaURL string) bool {
	normalized := strings.ToLower(strings.TrimSpace(mediaURL))
	return strings.HasPrefix(normalized, "https://") ||
		strings.HasPrefix(normalized, "http://") ||
		strings.HasPrefix(normalized, "/api/v1/profile/post-media/files/")
}

func normalizeProfilePostLocationPayload(
	payload *ProfilePostLocationPayload,
) *ProfilePostLocationPayload {
	if payload == nil {
		return nil
	}

	source := strings.ToLower(strings.TrimSpace(payload.Source))
	if source != "mapbox" {
		source = "manual"
	}

	query := strings.TrimSpace(payload.Query)
	normalizedQuery := strings.TrimSpace(payload.NormalizedQuery)
	var selectedLocation *ProfilePostSelectedLocation

	if payload.SelectedLocation != nil {
		fullAddress := strings.TrimSpace(payload.SelectedLocation.FullAddress)
		name := strings.TrimSpace(payload.SelectedLocation.Name)
		mapboxID := strings.TrimSpace(payload.SelectedLocation.MapboxID)
		if fullAddress != "" && name != "" && mapboxID != "" {
			selectedLocation = &ProfilePostSelectedLocation{
				FullAddress: fullAddress,
				Latitude:    payload.SelectedLocation.Latitude,
				Longitude:   payload.SelectedLocation.Longitude,
				MapboxID:    mapboxID,
				Name:        name,
			}
		}
	}

	if source == "mapbox" && selectedLocation != nil {
		if query == "" {
			query = selectedLocation.FullAddress
		}
		if normalizedQuery == "" {
			normalizedQuery = selectedLocation.FullAddress
		}
	}

	if normalizedQuery == "" {
		normalizedQuery = query
	}

	if source == "mapbox" && selectedLocation == nil {
		source = "manual"
	}

	if query == "" && normalizedQuery == "" && selectedLocation == nil {
		return nil
	}

	return &ProfilePostLocationPayload{
		NormalizedQuery:  normalizedQuery,
		Query:            query,
		SelectedLocation: selectedLocation,
		Source:           source,
	}
}

func resolveProfilePostLocationValue(
	location string,
	payload *ProfilePostLocationPayload,
) string {
	normalizedLocation := strings.TrimSpace(location)
	normalizedPayload := normalizeProfilePostLocationPayload(payload)

	if normalizedPayload != nil &&
		normalizedPayload.Source == "mapbox" &&
		normalizedPayload.SelectedLocation != nil {
		if preferred := strings.TrimSpace(normalizedPayload.SelectedLocation.FullAddress); preferred != "" {
			normalizedLocation = preferred
		}
	}

	if normalizedLocation == "" && normalizedPayload != nil {
		switch {
		case normalizedPayload.SelectedLocation != nil &&
			strings.TrimSpace(normalizedPayload.SelectedLocation.FullAddress) != "":
			normalizedLocation = strings.TrimSpace(normalizedPayload.SelectedLocation.FullAddress)
		case strings.TrimSpace(normalizedPayload.NormalizedQuery) != "":
			normalizedLocation = strings.TrimSpace(normalizedPayload.NormalizedQuery)
		case strings.TrimSpace(normalizedPayload.Query) != "":
			normalizedLocation = strings.TrimSpace(normalizedPayload.Query)
		}
	}

	if normalizedLocation == "" {
		return "Konum belirtilmedi"
	}

	return normalizedLocation
}

type postAccessSnapshot struct {
	AuthorID         string
	IsFollowing      bool
	IsLive           bool
	IsPrivateAccount bool
	IsStreetFriend   bool
	Segment          Segment
	Visibility       PostVisibility
}

func (r *Repository) loadPostAccessSnapshotTx(
	ctx context.Context,
	tx pgx.Tx,
	postID string,
	viewerID string,
	lock bool,
) (postAccessSnapshot, error) {
	query := `
		select
			p.user_id,
			p.segment,
			coalesce(p.visibility, 'public'),
			p.is_live,
			coalesce(u.is_private_account, false),
			exists(
				select 1
				from follows f
				where f.follower_id = $2 and f.followed_user_id = u.id
			) as is_following,
			exists(
				select 1
				from street_friendships sf
				where
					sf.status = 'accepted'
					and (
						(sf.user_a_id = $2 and sf.user_b_id = u.id)
						or (sf.user_a_id = u.id and sf.user_b_id = $2)
					)
			) as is_street_friend
		from posts p
		join users u on u.id = p.user_id
		where p.id = $1
	`
	if lock {
		query += ` for update`
	}

	var (
		rawVisibility string
		snapshot      postAccessSnapshot
	)
	if err := tx.QueryRow(ctx, query, postID, viewerID).Scan(
		&snapshot.AuthorID,
		&snapshot.Segment,
		&rawVisibility,
		&snapshot.IsLive,
		&snapshot.IsPrivateAccount,
		&snapshot.IsFollowing,
		&snapshot.IsStreetFriend,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return postAccessSnapshot{}, ErrPostNotFound
		}
		return postAccessSnapshot{}, fmt.Errorf("query post access snapshot: %w", err)
	}
	snapshot.Visibility = NormalizePostVisibility(rawVisibility)

	if !snapshot.IsLive {
		return postAccessSnapshot{}, ErrPostNotFound
	}
	if strings.TrimSpace(snapshot.AuthorID) == strings.TrimSpace(viewerID) {
		return snapshot, nil
	}

	blocked, err := r.hasBlockedRelationshipTx(ctx, tx, viewerID, snapshot.AuthorID)
	if err != nil {
		return postAccessSnapshot{}, err
	}
	if blocked {
		return postAccessSnapshot{}, ErrBlockedRelationship
	}
	if snapshot.IsPrivateAccount && !snapshot.IsFollowing {
		return postAccessSnapshot{}, ErrProfilePrivate
	}
	if !canViewerAccessPostVisibility(
		snapshot.Visibility,
		viewerID,
		snapshot.AuthorID,
		snapshot.IsPrivateAccount,
		snapshot.IsFollowing,
		snapshot.IsStreetFriend,
	) {
		return postAccessSnapshot{}, ErrPostAccessForbidden
	}

	return snapshot, nil
}

func orderedUserPair(left string, right string) (string, string) {
	if left <= right {
		return left, right
	}

	return right, left
}

func viewerStreetFriendState(
	rawStatus string,
	requestedBy string,
	viewerID string,
) (StreetFriendStatus, bool) {
	switch strings.TrimSpace(rawStatus) {
	case streetStatusAccepted:
		return StreetFriendStatusAccepted, true
	case streetStatusPending:
		if strings.TrimSpace(requestedBy) == viewerID {
			return StreetFriendStatusPendingOutgoing, false
		}
		return StreetFriendStatusPendingIncoming, false
	default:
		return StreetFriendStatusNone, false
	}
}

func viewerFollowRequestState(
	isFollowing bool,
	requestedBy string,
	viewerID string,
) FollowRequestStatus {
	if isFollowing {
		return FollowRequestStatusNone
	}

	switch strings.TrimSpace(requestedBy) {
	case viewerID:
		return FollowRequestStatusPendingOutgoing
	case "":
		return FollowRequestStatusNone
	default:
		return FollowRequestStatusPendingIncoming
	}
}

func decodeFeedCursor(raw string, segment Segment) (*feedCursorState, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}

	decoded, err := base64.RawURLEncoding.DecodeString(trimmed)
	if err != nil {
		return nil, ErrInvalidFeedCursor
	}

	var cursor feedCursorState
	if err := json.Unmarshal(decoded, &cursor); err != nil {
		return nil, ErrInvalidFeedCursor
	}

	if cursor.PostID == "" ||
		cursor.CreatedAt.IsZero() ||
		cursor.ReferenceTime.IsZero() ||
		cursor.Segment == "" {
		return nil, ErrInvalidFeedCursor
	}
	if cursor.Segment != segment {
		return nil, ErrInvalidFeedCursor
	}
	if cursor.RankVersion == "" {
		cursor.RankVersion = FeedRankVersion
	}
	if cursor.RankVersion != FeedRankVersion {
		return nil, ErrInvalidFeedCursor
	}

	return &cursor, nil
}

func encodeFeedCursor(cursor feedCursorState) (string, error) {
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func nullableCursorScore(cursor *feedCursorState) any {
	if cursor == nil {
		return nil
	}

	return cursor.RankingScore
}

func nullableCursorCreatedAt(cursor *feedCursorState) any {
	if cursor == nil {
		return nil
	}

	return cursor.CreatedAt.UTC()
}

func nullableCursorPostID(cursor *feedCursorState) any {
	if cursor == nil {
		return ""
	}

	return cursor.PostID
}

func (r *Repository) ListComments(
	ctx context.Context,
	postID string,
	viewerID string,
) (CommentsResponse, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return CommentsResponse{}, fmt.Errorf("begin list comments tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := r.loadPostAccessSnapshotTx(ctx, tx, postID, viewerID, false); err != nil {
		return CommentsResponse{}, err
	}

	rows, err := tx.Query(ctx, `
		select
			c.id,
			c.post_id,
			c.body,
			c.like_count,
			exists(
				select 1
				from comment_engagements ce
				where ce.comment_id = c.id and ce.viewer_id = $2
			) as is_liked,
			c.created_at,
			u.id,
			u.username,
			u.avatar_url,
			u.is_verified
		from comments c
		join users u on u.id = c.user_id
		where c.post_id = $1
		order by c.created_at desc
	`, postID, viewerID)
	if err != nil {
		return CommentsResponse{}, fmt.Errorf("query comments: %w", err)
	}
	defer rows.Close()

	comments := make([]Comment, 0, 12)

	for rows.Next() {
		var comment Comment
		if err := rows.Scan(
			&comment.ID,
			&comment.PostID,
			&comment.Body,
			&comment.LikeCount,
			&comment.IsLiked,
			&comment.CreatedAt,
			&comment.Author.ID,
			&comment.Author.Username,
			&comment.Author.AvatarURL,
			&comment.Author.IsVerified,
		); err != nil {
			return CommentsResponse{}, fmt.Errorf("scan comment row: %w", err)
		}

		comments = append(comments, comment)
	}

	if rows.Err() != nil {
		return CommentsResponse{}, fmt.Errorf("iterate comments: %w", rows.Err())
	}

	if err := tx.Commit(ctx); err != nil {
		return CommentsResponse{}, fmt.Errorf("commit list comments tx: %w", err)
	}

	return CommentsResponse{
		Comments: comments,
		PostID:   postID,
		Total:    len(comments),
	}, nil
}

func (r *Repository) AddComment(ctx context.Context, postID string, viewerID string, text string) (CommentMutationResponse, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return CommentMutationResponse{}, fmt.Errorf("begin add comment tx: %w", err)
	}
	defer tx.Rollback(ctx)

	snapshot, err := r.loadPostAccessSnapshotTx(ctx, tx, postID, viewerID, true)
	if err != nil {
		return CommentMutationResponse{}, err
	}

	commentID := newID("comment")
	if _, err := tx.Exec(ctx, `
		insert into comments (id, post_id, user_id, body, like_count, created_at)
		values ($1, $2, $3, $4, 0, now())
	`, commentID, postID, viewerID, strings.TrimSpace(text)); err != nil {
		return CommentMutationResponse{}, fmt.Errorf("insert comment: %w", err)
	}

	var stats Stats
	if err := tx.QueryRow(ctx, `
		update posts
		set comments_count = comments_count + 1
		where id = $1
		returning likes_count, comments_count, bookmarks_count, shares_count
	`, postID).Scan(
		&stats.LikesCount,
		&stats.CommentsCount,
		&stats.BookmarksCount,
		&stats.SharesCount,
	); err != nil {
		return CommentMutationResponse{}, fmt.Errorf("update comment stats: %w", err)
	}

	comment, err := scanComment(ctx, tx, commentID, viewerID)
	if err != nil {
		return CommentMutationResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return CommentMutationResponse{}, fmt.Errorf("commit add comment tx: %w", err)
	}

	return CommentMutationResponse{
		Comment: comment,
		PostID:  postID,
		Segment: snapshot.Segment,
		Stats:   stats,
	}, nil
}

func (r *Repository) ToggleCommentLike(
	ctx context.Context,
	commentID string,
	viewerID string,
) (CommentLikeMutationResponse, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return CommentLikeMutationResponse{}, fmt.Errorf("begin comment like tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var postID string
	if err := tx.QueryRow(ctx, `
		select post_id
		from comments
		where id = $1
	`, commentID).Scan(&postID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return CommentLikeMutationResponse{}, ErrCommentNotFound
		}
		return CommentLikeMutationResponse{}, fmt.Errorf("query comment post id: %w", err)
	}

	if _, err := r.loadPostAccessSnapshotTx(ctx, tx, postID, viewerID, false); err != nil {
		return CommentLikeMutationResponse{}, err
	}

	var isLiked bool
	if err := tx.QueryRow(ctx, `
		with removed as (
			delete from comment_engagements
			where viewer_id = $1 and comment_id = $2
			returning 1
		),
		inserted as (
			insert into comment_engagements (viewer_id, comment_id, created_at)
			select $1, $2, now()
			where not exists (select 1 from removed)
			returning 1
		)
		select exists(select 1 from inserted)
	`, viewerID, commentID).Scan(&isLiked); err != nil {
		return CommentLikeMutationResponse{}, fmt.Errorf("toggle comment engagement: %w", err)
	}

	if isLiked {
		if _, err := tx.Exec(ctx, `
			update comments
			set like_count = like_count + 1
			where id = $1
		`, commentID); err != nil {
			return CommentLikeMutationResponse{}, fmt.Errorf("increment comment like count: %w", err)
		}
	} else {
		if _, err := tx.Exec(ctx, `
			update comments
			set like_count = greatest(like_count - 1, 0)
			where id = $1
		`, commentID); err != nil {
			return CommentLikeMutationResponse{}, fmt.Errorf("decrement comment like count: %w", err)
		}
	}

	comment, err := scanComment(ctx, tx, commentID, viewerID)
	if err != nil {
		return CommentLikeMutationResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return CommentLikeMutationResponse{}, fmt.Errorf("commit comment like tx: %w", err)
	}

	return CommentLikeMutationResponse{
		Comment: comment,
		PostID:  postID,
	}, nil
}

func (r *Repository) CreateProfilePost(
	ctx context.Context,
	userID string,
	input CreateProfilePostInput,
) (ProfilePostItem, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ProfilePostItem{}, ErrInvalidCreatePostInput
	}

	mediaURL := strings.TrimSpace(input.MediaURL)
	if mediaURL == "" || !isSupportedProfilePostMediaURL(mediaURL) {
		return ProfilePostItem{}, ErrInvalidCreatePostInput
	}

	mediaType := strings.ToLower(strings.TrimSpace(input.MediaType))
	switch mediaType {
	case "photo", "video":
	default:
		return ProfilePostItem{}, ErrInvalidCreatePostInput
	}

	caption := strings.TrimSpace(input.Caption)
	if len(caption) > maxCreatePostCaptionLength {
		return ProfilePostItem{}, ErrInvalidCreatePostInput
	}
	if len(extractNormalizedProfilePostHashtags(caption)) > maxCreatePostHashtagCount {
		return ProfilePostItem{}, ErrInvalidCreatePostInput
	}

	location := resolveProfilePostLocationValue(input.Location, input.LocationPayload)
	if len(location) > maxCreatePostLocationLength {
		return ProfilePostItem{}, ErrInvalidCreatePostInput
	}
	visibility := NormalizePostVisibility(input.Visibility)
	var isPrivateAccount bool
	if err := r.db.QueryRow(ctx, `
		select coalesce(is_private_account, false)
		from users
		where id = $1
	`, userID).Scan(&isPrivateAccount); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ProfilePostItem{}, ErrUserNotFound
		}
		return ProfilePostItem{}, fmt.Errorf("query author privacy for create profile post: %w", err)
	}
	if isPrivateAccount {
		visibility = PostVisibilityFriends
	}

	postID := newID("post")
	var item ProfilePostItem
	if err := r.db.QueryRow(ctx, `
		with author as (
			select id, username
			from users
			where id = $1
		),
		inserted as (
			insert into posts (
				id,
				user_id,
				segment,
				media_type,
				media_url,
				visibility,
				caption,
				location_name,
				is_live,
				created_at
			)
			select
				$2,
				author.id,
				$3,
				$4,
				$5,
				$6,
				$7,
				$8,
				true,
				now()
			from author
			returning
				id,
				user_id,
				caption,
				media_url,
				media_type,
				visibility,
				location_name,
				is_live,
				created_at,
				likes_count,
				comments_count,
				bookmarks_count,
				shares_count
		)
		select
			inserted.id,
			inserted.caption,
			inserted.created_at,
			inserted.is_live,
			inserted.location_name,
			inserted.media_type,
			inserted.media_url,
			inserted.visibility,
			inserted.likes_count,
			inserted.comments_count,
			inserted.bookmarks_count,
			inserted.shares_count,
			inserted.user_id,
			author.username
		from inserted
		join author on author.id = inserted.user_id
	`, userID, postID, string(SegmentForYou), mediaType, mediaURL, string(visibility), caption, location).Scan(
		&item.ID,
		&item.Caption,
		&item.CreatedAt,
		&item.IsLive,
		&item.Location,
		&item.MediaType,
		&item.MediaURL,
		&item.Visibility,
		&item.Stats.LikesCount,
		&item.Stats.CommentsCount,
		&item.Stats.BookmarksCount,
		&item.Stats.SharesCount,
		&item.UserID,
		&item.Username,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ProfilePostItem{}, ErrUserNotFound
		}
		return ProfilePostItem{}, fmt.Errorf("create profile post: %w", err)
	}

	return item, nil
}

func (r *Repository) UpdateViewerProfilePost(
	ctx context.Context,
	viewerID string,
	postID string,
	input UpdateProfilePostInput,
) (ProfilePostItem, error) {
	viewerID = strings.TrimSpace(viewerID)
	postID = strings.TrimSpace(postID)
	if viewerID == "" || postID == "" {
		return ProfilePostItem{}, ErrPostNotFound
	}

	hasCaption := input.Caption != nil
	hasLocation := input.Location != nil
	hasLocationPayload := input.LocationPayload != nil
	hasVisibility := input.Visibility != nil
	if !hasCaption && !hasLocation && !hasLocationPayload && !hasVisibility {
		return ProfilePostItem{}, ErrInvalidUpdatePostInput
	}

	var (
		nextCaption    *string
		nextLocation   *string
		nextVisibility *string
	)
	if hasCaption {
		normalizedCaption := strings.TrimSpace(*input.Caption)
		if len(normalizedCaption) > maxCreatePostCaptionLength {
			return ProfilePostItem{}, ErrInvalidUpdatePostInput
		}
		if len(extractNormalizedProfilePostHashtags(normalizedCaption)) > maxCreatePostHashtagCount {
			return ProfilePostItem{}, ErrInvalidUpdatePostInput
		}
		nextCaption = &normalizedCaption
	}

	if hasLocation || hasLocationPayload {
		rawLocation := ""
		if input.Location != nil {
			rawLocation = *input.Location
		}
		normalizedLocation := resolveProfilePostLocationValue(
			rawLocation,
			input.LocationPayload,
		)
		if len(normalizedLocation) > maxCreatePostLocationLength {
			return ProfilePostItem{}, ErrInvalidUpdatePostInput
		}
		nextLocation = &normalizedLocation
	}

	if hasVisibility {
		visibility, ok := ParsePostVisibility(strings.TrimSpace(*input.Visibility))
		if !ok {
			return ProfilePostItem{}, ErrInvalidUpdatePostInput
		}
		visibilityValue := string(visibility)
		nextVisibility = &visibilityValue
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ProfilePostItem{}, fmt.Errorf("begin update profile post tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var ownerID string
	if err := tx.QueryRow(ctx, `
		select user_id
		from posts
		where id = $1 and is_live = true
		for update
	`, postID).Scan(&ownerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ProfilePostItem{}, ErrPostNotFound
		}
		return ProfilePostItem{}, fmt.Errorf("lock post for update: %w", err)
	}
	if ownerID != viewerID {
		return ProfilePostItem{}, ErrPostEditForbidden
	}
	if nextVisibility != nil {
		var ownerPrivateAccount bool
		if err := tx.QueryRow(ctx, `
			select coalesce(is_private_account, false)
			from users
			where id = $1
		`, ownerID).Scan(&ownerPrivateAccount); err != nil {
			return ProfilePostItem{}, fmt.Errorf("query author privacy for update profile post: %w", err)
		}
		if ownerPrivateAccount {
			forced := string(PostVisibilityFriends)
			nextVisibility = &forced
		}
	}

	var item ProfilePostItem
	if err := tx.QueryRow(ctx, `
		update posts
		set
			caption = coalesce($2, caption),
			location_name = coalesce($3, location_name),
			visibility = coalesce($4, visibility)
		where id = $1
		returning
			id,
			user_id,
			media_type,
			media_url,
			visibility,
			caption,
			location_name,
			created_at,
			likes_count,
			comments_count,
			bookmarks_count,
			shares_count,
			is_live
	`, postID, nextCaption, nextLocation, nextVisibility).Scan(
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
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ProfilePostItem{}, ErrPostNotFound
		}
		return ProfilePostItem{}, fmt.Errorf("update profile post: %w", err)
	}

	if err := tx.QueryRow(ctx, `
		select username
		from users
		where id = $1
	`, item.UserID).Scan(&item.Username); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ProfilePostItem{}, ErrUserNotFound
		}
		return ProfilePostItem{}, fmt.Errorf("query post owner username: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return ProfilePostItem{}, fmt.Errorf("commit update profile post tx: %w", err)
	}

	return item, nil
}

func (r *Repository) SoftDeleteViewerProfilePost(
	ctx context.Context,
	viewerID string,
	postID string,
) (ProfilePostDeleteResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	postID = strings.TrimSpace(postID)
	if viewerID == "" || postID == "" {
		return ProfilePostDeleteResponse{}, ErrPostNotFound
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ProfilePostDeleteResponse{}, fmt.Errorf("begin soft delete profile post tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var (
		ownerID string
		isLive  bool
	)
	if err := tx.QueryRow(ctx, `
		select user_id, is_live
		from posts
		where id = $1
		for update
	`, postID).Scan(&ownerID, &isLive); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ProfilePostDeleteResponse{}, ErrPostNotFound
		}
		return ProfilePostDeleteResponse{}, fmt.Errorf("lock post for soft delete: %w", err)
	}
	if ownerID != viewerID {
		return ProfilePostDeleteResponse{}, ErrPostDeleteForbidden
	}

	if isLive {
		if _, err := tx.Exec(ctx, `
			update posts
			set is_live = false
			where id = $1
		`, postID); err != nil {
			return ProfilePostDeleteResponse{}, fmt.Errorf("soft delete post: %w", err)
		}
	}

	if _, err := tx.Exec(ctx, `
		update post_engagements
		set
			post_deleted_at = coalesce(post_deleted_at, now()),
			post_deleted_reason = case
				when trim(post_deleted_reason) = '' then 'soft_deleted'
				else post_deleted_reason
			end,
			updated_at = now()
		where post_id = $1
	`, postID); err != nil {
		return ProfilePostDeleteResponse{}, fmt.Errorf("mark soft delete tombstones: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return ProfilePostDeleteResponse{}, fmt.Errorf("commit soft delete profile post tx: %w", err)
	}

	return ProfilePostDeleteResponse{
		Deleted: true,
		Mode:    ProfilePostDeleteModeSoft,
		PostID:  postID,
	}, nil
}

func (r *Repository) HardDeleteProfilePost(
	ctx context.Context,
	postID string,
) (ProfilePostDeleteResponse, error) {
	postID = strings.TrimSpace(postID)
	if postID == "" {
		return ProfilePostDeleteResponse{}, ErrPostNotFound
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ProfilePostDeleteResponse{}, fmt.Errorf("begin hard delete profile post tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var existingPostID string
	if err := tx.QueryRow(ctx, `
		select id
		from posts
		where id = $1
		for update
	`, postID).Scan(&existingPostID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ProfilePostDeleteResponse{}, ErrPostNotFound
		}
		return ProfilePostDeleteResponse{}, fmt.Errorf("lock post for hard delete: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		delete from posts
		where id = $1
	`, postID); err != nil {
		return ProfilePostDeleteResponse{}, fmt.Errorf("hard delete post: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		update post_engagements
		set
			post_deleted_at = coalesce(post_deleted_at, now()),
			post_deleted_reason = case
				when trim(post_deleted_reason) = '' then 'deleted'
				else post_deleted_reason
			end,
			updated_at = now()
		where post_id = $1
	`, postID); err != nil {
		return ProfilePostDeleteResponse{}, fmt.Errorf("mark hard delete tombstones: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return ProfilePostDeleteResponse{}, fmt.Errorf("commit hard delete profile post tx: %w", err)
	}

	return ProfilePostDeleteResponse{
		Deleted: true,
		Mode:    ProfilePostDeleteModeHard,
		PostID:  postID,
	}, nil
}

func (r *Repository) ToggleFollow(ctx context.Context, viewerID string, creatorID string) (FollowResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	creatorID = strings.TrimSpace(creatorID)
	if viewerID == "" || creatorID == "" || viewerID == creatorID {
		return FollowResponse{}, ErrInvalidFollowAction
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return FollowResponse{}, fmt.Errorf("begin follow tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var isPrivateAccount bool
	if err := tx.QueryRow(ctx, `
		select is_private_account
		from users
		where id = $1
	`, creatorID).Scan(&isPrivateAccount); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return FollowResponse{}, ErrCreatorNotFound
		}
		return FollowResponse{}, fmt.Errorf("query creator privacy for follow: %w", err)
	}

	var hasBlockedRelationship bool
	if err := tx.QueryRow(ctx, `
		select exists(
			select 1
			from blocked_users b
			where
				(b.blocker_id = $1 and b.blocked_user_id = $2)
				or (b.blocker_id = $2 and b.blocked_user_id = $1)
		)
	`, viewerID, creatorID).Scan(&hasBlockedRelationship); err != nil {
		return FollowResponse{}, fmt.Errorf("check blocked relationship for follow: %w", err)
	}
	if hasBlockedRelationship {
		return FollowResponse{}, ErrBlockedRelationship
	}

	var exists bool
	if err := tx.QueryRow(ctx, `
		select exists(
			select 1
			from follows
			where follower_id = $1 and followed_user_id = $2
		)
	`, viewerID, creatorID).Scan(&exists); err != nil {
		return FollowResponse{}, fmt.Errorf("check follow: %w", err)
	}

	isFollowing := false
	if exists {
		if _, err := tx.Exec(ctx, `
			delete from follows
			where follower_id = $1 and followed_user_id = $2
		`, viewerID, creatorID); err != nil {
			return FollowResponse{}, fmt.Errorf("delete follow: %w", err)
		}

		if _, err := tx.Exec(ctx, `
			delete from follow_requests
			where requester_id = $1 and target_user_id = $2
		`, viewerID, creatorID); err != nil {
			return FollowResponse{}, fmt.Errorf("delete outgoing follow request after unfollow: %w", err)
		}
		if err := r.deleteProfileNotificationByIDTx(
			ctx,
			tx,
			FollowRequestNotificationID(viewerID, creatorID),
		); err != nil {
			return FollowResponse{}, err
		}
	} else {
		if isPrivateAccount {
			var hasOutgoingRequest bool
			if err := tx.QueryRow(ctx, `
				select exists(
					select 1
					from follow_requests
					where requester_id = $1 and target_user_id = $2
				)
			`, viewerID, creatorID).Scan(&hasOutgoingRequest); err != nil {
				return FollowResponse{}, fmt.Errorf("check outgoing follow request: %w", err)
			}

			if hasOutgoingRequest {
				if _, err := tx.Exec(ctx, `
					delete from follow_requests
					where requester_id = $1 and target_user_id = $2
				`, viewerID, creatorID); err != nil {
					return FollowResponse{}, fmt.Errorf("delete follow request: %w", err)
				}
				if err := r.deleteProfileNotificationByIDTx(
					ctx,
					tx,
					FollowRequestNotificationID(viewerID, creatorID),
				); err != nil {
					return FollowResponse{}, err
				}
			} else {
				if _, err := tx.Exec(ctx, `
					insert into follow_requests (requester_id, target_user_id)
					values ($1, $2)
					on conflict do nothing
				`, viewerID, creatorID); err != nil {
					var pgErr *pgconn.PgError
					if errors.As(err, &pgErr) && pgErr.Code == "23503" {
						return FollowResponse{}, ErrCreatorNotFound
					}
					return FollowResponse{}, fmt.Errorf("insert follow request: %w", err)
				}
				if _, err := r.insertProfileNotificationTx(ctx, tx, profileNotificationPayload{
					ActorID:     viewerID,
					Body:        "Sana yeni takip isteği gönderildi.",
					Channel:     "follow_requests",
					ID:          FollowRequestNotificationID(viewerID, creatorID),
					Metadata:    map[string]any{"requesterId": viewerID, "targetId": creatorID},
					RecipientID: creatorID,
					Title:       "Yeni takip isteği",
					Type:        "follow.request.created",
				}); err != nil {
					return FollowResponse{}, fmt.Errorf("insert follow request notification: %w", err)
				}
			}
		} else {
			if _, err := tx.Exec(ctx, `
				insert into follows (follower_id, followed_user_id)
				values ($1, $2)
				on conflict do nothing
			`, viewerID, creatorID); err != nil {
				var pgErr *pgconn.PgError
				if errors.As(err, &pgErr) && pgErr.Code == "23503" {
					return FollowResponse{}, ErrCreatorNotFound
				}
				return FollowResponse{}, fmt.Errorf("insert follow: %w", err)
			}

			if _, err := tx.Exec(ctx, `
				delete from follow_requests
				where requester_id = $1 and target_user_id = $2
			`, viewerID, creatorID); err != nil {
				return FollowResponse{}, fmt.Errorf("delete follow request after follow: %w", err)
			}
			if err := r.deleteProfileNotificationByIDTx(
				ctx,
				tx,
				FollowRequestNotificationID(viewerID, creatorID),
			); err != nil {
				return FollowResponse{}, err
			}
			isFollowing = true
		}
	}

	var followsYou bool
	if err := tx.QueryRow(ctx, `
		select exists(
			select 1
			from follows
			where follower_id = $1 and followed_user_id = $2
		)
	`, creatorID, viewerID).Scan(&followsYou); err != nil {
		return FollowResponse{}, fmt.Errorf("check follows you after follow toggle: %w", err)
	}

	var followRequestedBy string
	if err := tx.QueryRow(ctx, `
		select coalesce((
			select requester_id
			from follow_requests
			where
				(requester_id = $1 and target_user_id = $2)
				or (requester_id = $2 and target_user_id = $1)
			order by case when requester_id = $1 then 0 else 1 end
			limit 1
		), '')
	`, viewerID, creatorID).Scan(&followRequestedBy); err != nil {
		return FollowResponse{}, fmt.Errorf("check follow request state after follow toggle: %w", err)
	}
	followRequestStatus := viewerFollowRequestState(isFollowing, followRequestedBy, viewerID)

	var followersCount int64
	if err := tx.QueryRow(ctx, `
		select count(*)::bigint
		from follows
		where followed_user_id = $1
	`, creatorID).Scan(&followersCount); err != nil {
		return FollowResponse{}, fmt.Errorf("count followers: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return FollowResponse{}, fmt.Errorf("commit follow tx: %w", err)
	}

	return FollowResponse{
		CreatorID:           creatorID,
		FollowRequestStatus: followRequestStatus,
		FollowsYou:          followsYou,
		IsFollowing:         isFollowing,
		FollowersCount:      followersCount,
	}, nil
}

func (r *Repository) SearchUsers(
	ctx context.Context,
	input SearchUsersQuery,
) (SearchUsersResponse, error) {
	trimmedQuery := strings.TrimSpace(input.Query)
	normalizedQuery := normalizeExploreSearchText(trimmedQuery, "@")
	searchPattern := buildExploreSearchPattern(normalizedQuery)
	prefixPattern := "%"
	if normalizedQuery != "" {
		prefixPattern = normalizedQuery + "%"
	}
	cursorOffset, err := decodeSearchOffsetCursor(input.Cursor)
	if err != nil {
		return SearchUsersResponse{}, err
	}

	limit := normalizeSearchLimit(input.Limit)
	rows, err := r.db.Query(ctx, `
		select
			u.id,
			u.username,
			coalesce(u.full_name, ''),
			u.avatar_url,
			coalesce(u.is_private_account, false),
			u.is_verified,
			exists(
				select 1
				from follows f
				where f.follower_id = $1 and f.followed_user_id = u.id
			) as is_following,
			exists(
				select 1
				from follows f
				where f.follower_id = u.id and f.followed_user_id = $1
			) as follows_you,
			coalesce(sf.status, ''),
			coalesce(sf.requested_by, ''),
			coalesce(fr.requester_id, '')
		from users u
		left join lateral (
			select sf.status, sf.requested_by
			from street_friendships sf
			where
				(sf.user_a_id = $1 and sf.user_b_id = u.id)
				or (sf.user_a_id = u.id and sf.user_b_id = $1)
			limit 1
		) sf on true
		left join lateral (
			select fr.requester_id
			from follow_requests fr
			where
				(fr.requester_id = $1 and fr.target_user_id = u.id)
				or (fr.requester_id = u.id and fr.target_user_id = $1)
			order by case when fr.requester_id = $1 then 0 else 1 end
			limit 1
		) fr on true
		where
			u.id <> $1
			and lower(u.username) <> all($2::text[])
			and not exists (
				select 1
				from blocked_users b
				where
					(b.blocker_id = $1 and b.blocked_user_id = u.id)
					or (b.blocker_id = u.id and b.blocked_user_id = $1)
			)
			and (
				$3 = ''
				or translate(lower(u.username), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') like $4
				or translate(lower(coalesce(u.full_name, '')), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') like $4
			)
		order by
			case
				when $3 = '' and exists(
					select 1
					from follows f
					where f.follower_id = $1 and f.followed_user_id = u.id
				) then 0
				when $3 = '' then 1
				when translate(lower(u.username), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') = $3 then 0
				when translate(lower(coalesce(u.full_name, '')), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') = $3 then 1
				when translate(lower(u.username), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') like $5 then 2
				when translate(lower(coalesce(u.full_name, '')), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') like $5 then 3
				when translate(lower(u.username), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') like $4 then 4
				when translate(lower(coalesce(u.full_name, '')), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') like $4 then 5
				else 6
			end,
			case
				when $3 = '' and coalesce(sf.status, '') = 'accepted' then 0
				when $3 = '' then 1
				else 0
			end,
			case
				when $3 = '' and u.is_verified then 0
				when $3 = '' then 1
				else 0
			end,
			lower(u.username) asc
		limit $6 offset $7
	`,
		input.ViewerID,
		hiddenExploreFeedUsernames,
		normalizedQuery,
		searchPattern,
		prefixPattern,
		limit+1,
		cursorOffset,
	)
	if err != nil {
		return SearchUsersResponse{}, fmt.Errorf("query explore users: %w", err)
	}
	defer rows.Close()

	users := make([]SearchUser, 0, limit+1)
	for rows.Next() {
		var (
			item              SearchUser
			followsYou        bool
			followRequestedBy string
			isFollowing       bool
			streetRequestedBy string
			streetStatus      string
		)

		if err := rows.Scan(
			&item.ID,
			&item.Username,
			&item.FullName,
			&item.AvatarURL,
			&item.IsPrivateAccount,
			&item.IsVerified,
			&isFollowing,
			&followsYou,
			&streetStatus,
			&streetRequestedBy,
			&followRequestedBy,
		); err != nil {
			return SearchUsersResponse{}, fmt.Errorf("scan explore user row: %w", err)
		}

		relationshipStatus, isStreetFriend := viewerStreetFriendState(
			streetStatus,
			streetRequestedBy,
			input.ViewerID,
		)
		followRequestStatus := viewerFollowRequestState(
			isFollowing,
			followRequestedBy,
			input.ViewerID,
		)
		item.ViewerState = SearchUserViewerState{
			FollowRequestStatus: followRequestStatus,
			FollowsYou:          followsYou,
			IsFollowing:         isFollowing,
			IsStreetFriend:      isStreetFriend,
			StreetFriendStatus:  relationshipStatus,
		}
		users = append(users, item)
	}

	if rows.Err() != nil {
		return SearchUsersResponse{}, fmt.Errorf("iterate explore users: %w", rows.Err())
	}

	hasMore := len(users) > limit
	if hasMore {
		users = users[:limit]
	}

	nextCursor := ""
	if hasMore {
		nextCursor = strconv.Itoa(cursorOffset + limit)
	}

	return SearchUsersResponse{
		HasMore:    hasMore,
		NextCursor: nextCursor,
		Query:      trimmedQuery,
		Users:      users,
	}, nil
}

func (r *Repository) ListRecentSearchedUsers(
	ctx context.Context,
	viewerID string,
	limit int,
) (UserListResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	if viewerID == "" {
		return UserListResponse{}, ErrInvalidRecentSearchAction
	}

	normalizedLimit := normalizeRecentUserSearchLimit(limit)
	rows, err := r.db.Query(ctx, `
		select
			u.id,
			u.username,
			coalesce(u.full_name, ''),
			u.avatar_url,
			coalesce(u.is_private_account, false),
			u.is_verified,
			exists(
				select 1
				from follows f
				where f.follower_id = $1 and f.followed_user_id = u.id
			) as is_following,
			exists(
				select 1
				from follows f
				where f.follower_id = u.id and f.followed_user_id = $1
			) as follows_you,
			coalesce(sf.status, ''),
			coalesce(sf.requested_by, ''),
			coalesce(fr.requester_id, '')
		from explore_recent_user_searches rs
		join users u on u.id = rs.searched_user_id
		left join lateral (
			select sf.status, sf.requested_by
			from street_friendships sf
			where
				(sf.user_a_id = $1 and sf.user_b_id = u.id)
				or (sf.user_a_id = u.id and sf.user_b_id = $1)
			limit 1
		) sf on true
		left join lateral (
			select fr.requester_id
			from follow_requests fr
			where
				(fr.requester_id = $1 and fr.target_user_id = u.id)
				or (fr.requester_id = u.id and fr.target_user_id = $1)
			order by case when fr.requester_id = $1 then 0 else 1 end
			limit 1
		) fr on true
		where
			rs.viewer_id = $1
			and u.id <> $1
			and lower(u.username) <> all($2::text[])
			and not exists (
				select 1
				from blocked_users b
				where
					(b.blocker_id = $1 and b.blocked_user_id = u.id)
					or (b.blocker_id = u.id and b.blocked_user_id = $1)
			)
		order by rs.updated_at desc, lower(u.username) asc
		limit $3
	`,
		viewerID,
		hiddenExploreFeedUsernames,
		normalizedLimit,
	)
	if err != nil {
		return UserListResponse{}, fmt.Errorf("query recent searched users: %w", err)
	}
	defer rows.Close()

	users := make([]SearchUser, 0, normalizedLimit)
	for rows.Next() {
		var (
			item              SearchUser
			followsYou        bool
			followRequestedBy string
			isFollowing       bool
			streetRequestedBy string
			streetStatus      string
		)

		if err := rows.Scan(
			&item.ID,
			&item.Username,
			&item.FullName,
			&item.AvatarURL,
			&item.IsPrivateAccount,
			&item.IsVerified,
			&isFollowing,
			&followsYou,
			&streetStatus,
			&streetRequestedBy,
			&followRequestedBy,
		); err != nil {
			return UserListResponse{}, fmt.Errorf("scan recent searched user row: %w", err)
		}

		relationshipStatus, isStreetFriend := viewerStreetFriendState(
			streetStatus,
			streetRequestedBy,
			viewerID,
		)
		followRequestStatus := viewerFollowRequestState(
			isFollowing,
			followRequestedBy,
			viewerID,
		)
		item.ViewerState = SearchUserViewerState{
			FollowRequestStatus: followRequestStatus,
			FollowsYou:          followsYou,
			IsFollowing:         isFollowing,
			IsStreetFriend:      isStreetFriend,
			StreetFriendStatus:  relationshipStatus,
		}
		users = append(users, item)
	}

	if rows.Err() != nil {
		return UserListResponse{}, fmt.Errorf("iterate recent searched users: %w", rows.Err())
	}

	return UserListResponse{
		Users: users,
	}, nil
}

func (r *Repository) SaveRecentSearchedUser(
	ctx context.Context,
	viewerID string,
	searchedUserID string,
) error {
	viewerID = strings.TrimSpace(viewerID)
	searchedUserID = strings.TrimSpace(searchedUserID)
	if viewerID == "" || searchedUserID == "" {
		return ErrInvalidRecentSearchAction
	}
	if viewerID == searchedUserID {
		return nil
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin recent search tx: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	result, err := tx.Exec(ctx, `
		insert into explore_recent_user_searches (
			viewer_id,
			searched_user_id,
			created_at,
			updated_at
		)
		select
			$1,
			u.id,
			now(),
			now()
		from users u
		where
			u.id = $2
			and u.id <> $1
			and lower(u.username) <> all($3::text[])
			and not exists (
				select 1
				from blocked_users b
				where
					(b.blocker_id = $1 and b.blocked_user_id = u.id)
					or (b.blocker_id = u.id and b.blocked_user_id = $1)
			)
		on conflict (viewer_id, searched_user_id)
		do update set updated_at = excluded.updated_at
	`,
		viewerID,
		searchedUserID,
		hiddenExploreFeedUsernames,
	)
	if err != nil {
		return fmt.Errorf("upsert recent searched user: %w", err)
	}
	if result.RowsAffected() == 0 {
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit recent searched user noop tx: %w", err)
		}
		committed = true
		return nil
	}

	if _, err := tx.Exec(ctx, `
		with ranked as (
			select
				searched_user_id,
				row_number() over (
					order by updated_at desc, searched_user_id desc
				) as row_num
			from explore_recent_user_searches
			where viewer_id = $1
		)
		delete from explore_recent_user_searches rs
		using ranked
		where
			rs.viewer_id = $1
			and rs.searched_user_id = ranked.searched_user_id
			and ranked.row_num > $2
	`,
		viewerID,
		maxRecentUserSearchHistory,
	); err != nil {
		return fmt.Errorf("trim recent searched users: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit recent searched user tx: %w", err)
	}
	committed = true
	return nil
}

func (r *Repository) RemoveRecentSearchedUser(
	ctx context.Context,
	viewerID string,
	searchedUserID string,
) (bool, error) {
	viewerID = strings.TrimSpace(viewerID)
	searchedUserID = strings.TrimSpace(searchedUserID)
	if viewerID == "" || searchedUserID == "" {
		return false, ErrInvalidRecentSearchAction
	}

	result, err := r.db.Exec(ctx, `
		delete from explore_recent_user_searches
		where viewer_id = $1 and searched_user_id = $2
	`,
		viewerID,
		searchedUserID,
	)
	if err != nil {
		return false, fmt.Errorf("delete recent searched user: %w", err)
	}

	return result.RowsAffected() > 0, nil
}

func (r *Repository) ClearRecentSearchedUsers(
	ctx context.Context,
	viewerID string,
) (int64, error) {
	viewerID = strings.TrimSpace(viewerID)
	if viewerID == "" {
		return 0, ErrInvalidRecentSearchAction
	}

	result, err := r.db.Exec(ctx, `
		delete from explore_recent_user_searches
		where viewer_id = $1
	`,
		viewerID,
	)
	if err != nil {
		return 0, fmt.Errorf("clear recent searched users: %w", err)
	}

	return result.RowsAffected(), nil
}

func (r *Repository) ListRecentSearchTerms(
	ctx context.Context,
	viewerID string,
	kind RecentSearchTermKind,
	limit int,
) (RecentSearchTermsResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	if viewerID == "" {
		return RecentSearchTermsResponse{}, ErrInvalidRecentSearchAction
	}
	normalizedKind, ok := ParseRecentSearchTermKind(string(kind))
	if !ok {
		return RecentSearchTermsResponse{}, ErrInvalidRecentSearchAction
	}

	normalizedLimit := normalizeRecentTermSearchLimit(limit)
	rows, err := r.db.Query(ctx, `
		select
			search_kind,
			query_text,
			updated_at
		from explore_recent_search_terms
		where
			viewer_id = $1
			and search_kind = $2
		order by updated_at desc, query_key asc
		limit $3
	`,
		viewerID,
		string(normalizedKind),
		normalizedLimit,
	)
	if err != nil {
		return RecentSearchTermsResponse{}, fmt.Errorf("query recent search terms: %w", err)
	}
	defer rows.Close()

	items := make([]RecentSearchTerm, 0, normalizedLimit)
	for rows.Next() {
		var (
			item    RecentSearchTerm
			rawKind string
		)
		if err := rows.Scan(
			&rawKind,
			&item.Query,
			&item.SearchedAt,
		); err != nil {
			return RecentSearchTermsResponse{}, fmt.Errorf("scan recent search term row: %w", err)
		}
		parsedKind, ok := ParseRecentSearchTermKind(rawKind)
		if !ok {
			continue
		}
		item.Kind = parsedKind
		items = append(items, item)
	}

	if rows.Err() != nil {
		return RecentSearchTermsResponse{}, fmt.Errorf("iterate recent search term rows: %w", rows.Err())
	}

	return RecentSearchTermsResponse{
		Items: items,
		Kind:  normalizedKind,
	}, nil
}

func (r *Repository) SaveRecentSearchTerm(
	ctx context.Context,
	viewerID string,
	kind RecentSearchTermKind,
	query string,
) (RecentSearchTerm, error) {
	viewerID = strings.TrimSpace(viewerID)
	if viewerID == "" {
		return RecentSearchTerm{}, ErrInvalidRecentSearchAction
	}
	normalizedKind, ok := ParseRecentSearchTermKind(string(kind))
	if !ok {
		return RecentSearchTerm{}, ErrInvalidRecentSearchAction
	}
	displayQuery, queryKey, err := normalizeRecentSearchTerm(normalizedKind, query)
	if err != nil {
		return RecentSearchTerm{}, err
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return RecentSearchTerm{}, fmt.Errorf("begin recent search term tx: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	now := time.Now().UTC()
	result, err := tx.Exec(ctx, `
		insert into explore_recent_search_terms (
			viewer_id,
			search_kind,
			query_text,
			query_key,
			created_at,
			updated_at
		)
		values (
			$1,
			$2,
			$3,
			$4,
			$5,
			$5
		)
		on conflict (viewer_id, search_kind, query_key)
		do update set
			query_text = excluded.query_text,
			updated_at = excluded.updated_at
	`,
		viewerID,
		string(normalizedKind),
		displayQuery,
		queryKey,
		now,
	)
	if err != nil {
		return RecentSearchTerm{}, fmt.Errorf("upsert recent search term: %w", err)
	}
	if result.RowsAffected() == 0 {
		return RecentSearchTerm{}, ErrInvalidRecentSearchAction
	}

	if _, err := tx.Exec(ctx, `
		insert into explore_search_term_analytics (
			search_kind,
			query_key,
			query_text,
			total_search_count,
			last_searched_at,
			created_at,
			updated_at
		)
		values (
			$1,
			$2,
			$3,
			1,
			$4,
			$4,
			$4
		)
		on conflict (search_kind, query_key)
		do update set
			query_text = excluded.query_text,
			total_search_count = explore_search_term_analytics.total_search_count + 1,
			last_searched_at = excluded.last_searched_at,
			updated_at = excluded.updated_at
	`,
		string(normalizedKind),
		queryKey,
		displayQuery,
		now,
	); err != nil {
		return RecentSearchTerm{}, fmt.Errorf("upsert search term analytics: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		insert into explore_search_term_daily_hits (
			search_kind,
			query_key,
			day,
			hit_count,
			updated_at
		)
		values (
			$1,
			$2,
			current_date,
			1,
			$3
		)
		on conflict (search_kind, query_key, day)
		do update set
			hit_count = explore_search_term_daily_hits.hit_count + 1,
			updated_at = excluded.updated_at
	`,
		string(normalizedKind),
		queryKey,
		now,
	); err != nil {
		return RecentSearchTerm{}, fmt.Errorf("upsert search term daily hit: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		with ranked as (
			select
				query_key,
				row_number() over (
					order by updated_at desc, query_key asc
				) as row_num
			from explore_recent_search_terms
			where
				viewer_id = $1
				and search_kind = $2
		)
		delete from explore_recent_search_terms rs
		using ranked
		where
			rs.viewer_id = $1
			and rs.search_kind = $2
			and rs.query_key = ranked.query_key
			and ranked.row_num > $3
	`,
		viewerID,
		string(normalizedKind),
		maxRecentTermSearchHistory,
	); err != nil {
		return RecentSearchTerm{}, fmt.Errorf("trim recent search terms: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return RecentSearchTerm{}, fmt.Errorf("commit recent search term tx: %w", err)
	}
	committed = true

	return RecentSearchTerm{
		Kind:       normalizedKind,
		Query:      displayQuery,
		SearchedAt: now,
	}, nil
}

func (r *Repository) RemoveRecentSearchTerm(
	ctx context.Context,
	viewerID string,
	kind RecentSearchTermKind,
	query string,
) (bool, RecentSearchTerm, error) {
	viewerID = strings.TrimSpace(viewerID)
	if viewerID == "" {
		return false, RecentSearchTerm{}, ErrInvalidRecentSearchAction
	}
	normalizedKind, ok := ParseRecentSearchTermKind(string(kind))
	if !ok {
		return false, RecentSearchTerm{}, ErrInvalidRecentSearchAction
	}
	displayQuery, queryKey, err := normalizeRecentSearchTerm(normalizedKind, query)
	if err != nil {
		return false, RecentSearchTerm{}, err
	}

	result, err := r.db.Exec(ctx, `
		delete from explore_recent_search_terms
		where
			viewer_id = $1
			and search_kind = $2
			and query_key = $3
	`,
		viewerID,
		string(normalizedKind),
		queryKey,
	)
	if err != nil {
		return false, RecentSearchTerm{}, fmt.Errorf("delete recent search term: %w", err)
	}

	return result.RowsAffected() > 0, RecentSearchTerm{
		Kind:       normalizedKind,
		Query:      displayQuery,
		SearchedAt: time.Now().UTC(),
	}, nil
}

func (r *Repository) ClearRecentSearchTerms(
	ctx context.Context,
	viewerID string,
	kind RecentSearchTermKind,
) (int64, error) {
	viewerID = strings.TrimSpace(viewerID)
	if viewerID == "" {
		return 0, ErrInvalidRecentSearchAction
	}
	normalizedKind, ok := ParseRecentSearchTermKind(string(kind))
	if !ok {
		return 0, ErrInvalidRecentSearchAction
	}

	result, err := r.db.Exec(ctx, `
		delete from explore_recent_search_terms
		where
			viewer_id = $1
			and search_kind = $2
	`,
		viewerID,
		string(normalizedKind),
	)
	if err != nil {
		return 0, fmt.Errorf("clear recent search terms: %w", err)
	}

	return result.RowsAffected(), nil
}

func (r *Repository) SearchPopularSearchTerms(
	ctx context.Context,
	kind RecentSearchTermKind,
	query string,
	limit int,
	scoreModel PopularSearchScoreModel,
) (PopularSearchTermsResponse, error) {
	normalizedKind, ok := ParseRecentSearchTermKind(string(kind))
	if !ok {
		return PopularSearchTermsResponse{}, ErrInvalidRecentSearchAction
	}
	normalizedScoreModel, ok := ParsePopularSearchScoreModel(string(scoreModel))
	if !ok {
		normalizedScoreModel = PopularSearchScoreModelA
	}
	normalizedLimit := normalizePopularSearchLimit(limit)
	normalizedQuery := normalizeRecentSearchQueryFilter(normalizedKind, query)
	searchPattern := buildExploreSearchPattern(normalizedQuery)

	rows, err := r.db.Query(ctx, `
		with scored as (
			select
				a.search_kind,
				a.query_text,
				a.total_search_count,
				a.last_searched_at,
				coalesce(sum(case when d.day >= current_date - interval '1 day' then d.hit_count else 0 end), 0)::bigint as hits_24h,
				coalesce(sum(case when d.day >= current_date - interval '7 day' then d.hit_count else 0 end), 0)::bigint as hits_7d
			from explore_search_term_analytics a
			left join explore_search_term_daily_hits d
				on d.search_kind = a.search_kind
				and d.query_key = a.query_key
				and d.day >= current_date - interval '14 day'
			where
				a.search_kind = $1
				and (
					$2 = ''
					or a.query_key like $3
					or translate(lower(a.query_text), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') like $3
				)
			group by
				a.search_kind,
				a.query_key,
				a.query_text,
				a.total_search_count,
				a.last_searched_at
		)
		select
			search_kind,
			query_text,
			last_searched_at,
			hits_7d,
			total_search_count,
			(
				(
					case
						when $4 = 'b' then (
							ln(1 + greatest(hits_24h, 0)::double precision) * 3.30 +
							ln(1 + greatest(hits_7d, 0)::double precision) * 1.60 +
							ln(1 + greatest(total_search_count, 0)::double precision) * 0.72 +
							exp(-greatest(extract(epoch from (now() - last_searched_at)) / 3600.0, 0) / 26.0) * 2.45 +
							exp(-greatest(extract(epoch from (now() - last_searched_at)) / 3600.0, 0) / 6.0) * 0.65
						)
						else (
							ln(1 + greatest(hits_24h, 0)::double precision) * 2.70 +
							ln(1 + greatest(hits_7d, 0)::double precision) * 1.85 +
							ln(1 + greatest(total_search_count, 0)::double precision) * 0.90 +
							exp(-greatest(extract(epoch from (now() - last_searched_at)) / 3600.0, 0) / 42.0) * 1.95
						)
					end
				) *
				(
					case
						when search_kind = 'tags' then case when $4 = 'b' then 1.14 else 1.08 end
						when search_kind = 'places' then case when $4 = 'b' then 1.09 else 1.04 end
						else 1.0
					end
				) *
				(
					case
						when $2 = '' then 1.0
						when translate(lower(query_text), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') = $2 then case when $4 = 'b' then 1.24 else 1.18 end
						when translate(lower(query_text), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') like ($2 || '%') then case when $4 = 'b' then 1.15 else 1.10 end
						else 1.0
					end
				)
			)::double precision as score
		from scored
		order by
			score desc,
			hits_7d desc,
			last_searched_at desc,
			query_text asc
		limit $5
	`,
		string(normalizedKind),
		normalizedQuery,
		searchPattern,
		string(normalizedScoreModel),
		normalizedLimit,
	)
	if err != nil {
		return PopularSearchTermsResponse{}, fmt.Errorf("query popular search terms: %w", err)
	}
	defer rows.Close()

	items := make([]PopularSearchTerm, 0, normalizedLimit)
	for rows.Next() {
		var (
			item    PopularSearchTerm
			rawKind string
		)
		if err := rows.Scan(
			&rawKind,
			&item.Query,
			&item.LastSearchedAt,
			&item.RecentSearches,
			&item.TotalSearches,
			&item.Score,
		); err != nil {
			return PopularSearchTermsResponse{}, fmt.Errorf("scan popular search term row: %w", err)
		}
		parsedKind, ok := ParseRecentSearchTermKind(rawKind)
		if !ok {
			continue
		}
		item.Kind = parsedKind
		items = append(items, item)
	}
	if rows.Err() != nil {
		return PopularSearchTermsResponse{}, fmt.Errorf("iterate popular search terms: %w", rows.Err())
	}

	return PopularSearchTermsResponse{
		GeneratedAt: time.Now().UTC(),
		Items:       items,
		Kind:        normalizedKind,
		Query:       strings.TrimSpace(query),
		ScoreModel:  string(normalizedScoreModel),
	}, nil
}

func (r *Repository) ListFollowers(
	ctx context.Context,
	viewerID string,
) (UserListResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	if viewerID == "" {
		return UserListResponse{}, ErrInvalidFollowAction
	}

	rows, err := r.db.Query(ctx, `
		select
			u.id,
			u.username,
			coalesce(u.full_name, ''),
			u.avatar_url,
			coalesce(u.is_private_account, false),
			u.is_verified,
			exists(
				select 1
				from follows f
				where f.follower_id = $1 and f.followed_user_id = u.id
			) as is_following,
			exists(
				select 1
				from follows f
				where f.follower_id = u.id and f.followed_user_id = $1
			) as follows_you,
			coalesce(sf.status, ''),
			coalesce(sf.requested_by, ''),
			coalesce(fr.requester_id, '')
		from follows base
		join users u on u.id = base.follower_id
		left join lateral (
			select sf.status, sf.requested_by
			from street_friendships sf
			where
				(sf.user_a_id = $1 and sf.user_b_id = u.id)
				or (sf.user_a_id = u.id and sf.user_b_id = $1)
			limit 1
		) sf on true
		left join lateral (
			select fr.requester_id
			from follow_requests fr
			where
				(fr.requester_id = $1 and fr.target_user_id = u.id)
				or (fr.requester_id = u.id and fr.target_user_id = $1)
			order by case when fr.requester_id = $1 then 0 else 1 end
			limit 1
		) fr on true
		where
			base.followed_user_id = $1
			and not exists (
				select 1
				from blocked_users b
				where
					(b.blocker_id = $1 and b.blocked_user_id = u.id)
					or (b.blocker_id = u.id and b.blocked_user_id = $1)
			)
		order by u.username asc
	`, viewerID)
	if err != nil {
		return UserListResponse{}, fmt.Errorf("query followers: %w", err)
	}
	defer rows.Close()

	users := make([]SearchUser, 0, 16)
	for rows.Next() {
		var (
			item              SearchUser
			followsYou        bool
			followRequestedBy string
			isFollowing       bool
			streetRequestedBy string
			streetStatus      string
		)

		if err := rows.Scan(
			&item.ID,
			&item.Username,
			&item.FullName,
			&item.AvatarURL,
			&item.IsPrivateAccount,
			&item.IsVerified,
			&isFollowing,
			&followsYou,
			&streetStatus,
			&streetRequestedBy,
			&followRequestedBy,
		); err != nil {
			return UserListResponse{}, fmt.Errorf("scan follower row: %w", err)
		}

		relationshipStatus, isStreetFriend := viewerStreetFriendState(
			streetStatus,
			streetRequestedBy,
			viewerID,
		)
		followRequestStatus := viewerFollowRequestState(
			isFollowing,
			followRequestedBy,
			viewerID,
		)
		item.ViewerState = SearchUserViewerState{
			FollowRequestStatus: followRequestStatus,
			FollowsYou:          followsYou,
			IsFollowing:         isFollowing,
			IsStreetFriend:      isStreetFriend,
			StreetFriendStatus:  relationshipStatus,
		}
		users = append(users, item)
	}

	if rows.Err() != nil {
		return UserListResponse{}, fmt.Errorf("iterate followers: %w", rows.Err())
	}

	return UserListResponse{
		Users: users,
	}, nil
}

func (r *Repository) ListFollowing(
	ctx context.Context,
	viewerID string,
) (UserListResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	if viewerID == "" {
		return UserListResponse{}, ErrInvalidFollowAction
	}

	rows, err := r.db.Query(ctx, `
		select
			u.id,
			u.username,
			coalesce(u.full_name, ''),
			u.avatar_url,
			coalesce(u.is_private_account, false),
			u.is_verified,
			exists(
				select 1
				from follows f
				where f.follower_id = $1 and f.followed_user_id = u.id
			) as is_following,
			exists(
				select 1
				from follows f
				where f.follower_id = u.id and f.followed_user_id = $1
			) as follows_you,
			coalesce(sf.status, ''),
			coalesce(sf.requested_by, ''),
			coalesce(fr.requester_id, '')
		from follows base
		join users u on u.id = base.followed_user_id
		left join lateral (
			select sf.status, sf.requested_by
			from street_friendships sf
			where
				(sf.user_a_id = $1 and sf.user_b_id = u.id)
				or (sf.user_a_id = u.id and sf.user_b_id = $1)
			limit 1
		) sf on true
		left join lateral (
			select fr.requester_id
			from follow_requests fr
			where
				(fr.requester_id = $1 and fr.target_user_id = u.id)
				or (fr.requester_id = u.id and fr.target_user_id = $1)
			order by case when fr.requester_id = $1 then 0 else 1 end
			limit 1
		) fr on true
		where
			base.follower_id = $1
			and not exists (
				select 1
				from blocked_users b
				where
					(b.blocker_id = $1 and b.blocked_user_id = u.id)
					or (b.blocker_id = u.id and b.blocked_user_id = $1)
			)
		order by u.username asc
	`, viewerID)
	if err != nil {
		return UserListResponse{}, fmt.Errorf("query following: %w", err)
	}
	defer rows.Close()

	users := make([]SearchUser, 0, 16)
	for rows.Next() {
		var (
			item              SearchUser
			followsYou        bool
			followRequestedBy string
			isFollowing       bool
			streetRequestedBy string
			streetStatus      string
		)

		if err := rows.Scan(
			&item.ID,
			&item.Username,
			&item.FullName,
			&item.AvatarURL,
			&item.IsPrivateAccount,
			&item.IsVerified,
			&isFollowing,
			&followsYou,
			&streetStatus,
			&streetRequestedBy,
			&followRequestedBy,
		); err != nil {
			return UserListResponse{}, fmt.Errorf("scan following row: %w", err)
		}

		relationshipStatus, isStreetFriend := viewerStreetFriendState(
			streetStatus,
			streetRequestedBy,
			viewerID,
		)
		followRequestStatus := viewerFollowRequestState(
			isFollowing,
			followRequestedBy,
			viewerID,
		)
		item.ViewerState = SearchUserViewerState{
			FollowRequestStatus: followRequestStatus,
			FollowsYou:          followsYou,
			IsFollowing:         isFollowing,
			IsStreetFriend:      isStreetFriend,
			StreetFriendStatus:  relationshipStatus,
		}
		users = append(users, item)
	}

	if rows.Err() != nil {
		return UserListResponse{}, fmt.Errorf("iterate following: %w", rows.Err())
	}

	return UserListResponse{
		Users: users,
	}, nil
}

func (r *Repository) RemoveFollower(
	ctx context.Context,
	viewerID string,
	followerID string,
) (FollowerRemovalResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	followerID = strings.TrimSpace(followerID)
	if viewerID == "" || followerID == "" || viewerID == followerID {
		return FollowerRemovalResponse{}, ErrInvalidFollowAction
	}

	result, err := r.db.Exec(ctx, `
		delete from follows
		where follower_id = $1 and followed_user_id = $2
	`, followerID, viewerID)
	if err != nil {
		return FollowerRemovalResponse{}, fmt.Errorf("remove follower: %w", err)
	}

	return FollowerRemovalResponse{
		FollowerID: followerID,
		Removed:    result.RowsAffected() > 0,
	}, nil
}

func (r *Repository) RemoveStreetFriend(
	ctx context.Context,
	viewerID string,
	friendID string,
) (StreetFriendResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	friendID = strings.TrimSpace(friendID)
	if viewerID == "" || friendID == "" || viewerID == friendID {
		return StreetFriendResponse{}, ErrInvalidStreetFriendAction
	}

	userA, userB := orderedUserPair(viewerID, friendID)
	if err := r.deleteProfileNotificationByIDs(
		ctx,
		StreetFriendRequestNotificationID(viewerID, friendID),
		StreetFriendRequestNotificationID(friendID, viewerID),
	); err != nil {
		return StreetFriendResponse{}, err
	}
	if _, err := r.db.Exec(ctx, `
		delete from street_friendships
		where user_a_id = $1 and user_b_id = $2
	`, userA, userB); err != nil {
		return StreetFriendResponse{}, fmt.Errorf("remove street friend: %w", err)
	}

	return StreetFriendResponse{
		CreatorID:          friendID,
		IsStreetFriend:     false,
		StreetFriendStatus: StreetFriendStatusNone,
	}, nil
}

func (r *Repository) SearchPosts(
	ctx context.Context,
	input SearchPostsQuery,
) (SearchPostsResponse, error) {
	trimmedQuery := strings.TrimSpace(input.Query)
	normalizedQuery := normalizeExploreSearchText(trimmedQuery, "@#")
	normalizedTagQuery := ""
	tagSearchPattern := ""
	if strings.HasPrefix(strings.TrimSpace(trimmedQuery), "#") {
		normalizedTagQuery = normalizeExploreHashtag(trimmedQuery)
		if normalizedTagQuery != "" {
			tagSearchPattern = fmt.Sprintf(
				"(^|[^[:alnum:]_])#%s($|[^[:alnum:]_])",
				normalizedTagQuery,
			)
		}
	}
	searchPattern := buildExploreSearchPattern(normalizedQuery)
	prefixPattern := "%"
	if normalizedQuery != "" {
		prefixPattern = normalizedQuery + "%"
	}
	cursorOffset, err := decodeSearchOffsetCursor(input.Cursor)
	if err != nil {
		return SearchPostsResponse{}, err
	}

	filter := NormalizeSearchPostFilter(string(input.Filter))
	sort := NormalizeSearchPostSort(string(input.Sort))
	limit := normalizePostSearchLimit(input.Limit)

	rows, err := r.db.Query(ctx, `
		with searchable as (
			select
				p.id,
				p.segment,
				p.media_type,
				p.media_url,
				coalesce(p.caption, '') as caption,
				coalesce(p.location_name, '') as location_name,
				p.created_at,
				p.likes_count,
				p.comments_count,
				p.bookmarks_count,
				p.shares_count,
				u.id as author_id,
				u.username,
				u.avatar_url,
				u.is_verified,
				(f.followed_user_id is not null) as is_following,
				coalesce(pe.liked, false) as is_liked,
				coalesce(pe.bookmarked, false) as is_bookmarked,
				coalesce(sf.status, '') as street_status,
				coalesce(sf.requested_by, '') as street_requested_by,
				translate(lower(coalesce(p.caption, '')), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') as normalized_caption,
				translate(lower(coalesce(p.location_name, '')), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') as normalized_location,
				translate(lower(u.username), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') as normalized_username,
				translate(lower(coalesce(u.full_name, '')), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') as normalized_full_name,
				(
					coalesce(p.likes_count, 0) * 1.5
					+ coalesce(p.comments_count, 0) * 2.0
					+ coalesce(p.bookmarks_count, 0) * 2.5
					+ coalesce(p.shares_count, 0) * 3.0
				)::double precision as popularity_score
			from posts p
			join users u on u.id = p.user_id
			left join follows f on f.follower_id = $1 and f.followed_user_id = u.id
			left join post_engagements pe on pe.viewer_id = $1 and pe.post_id = p.id
			left join lateral (
				select sf.status, sf.requested_by
				from street_friendships sf
				where
					(sf.user_a_id = $1 and sf.user_b_id = u.id)
					or (sf.user_a_id = u.id and sf.user_b_id = $1)
				limit 1
			) sf on true
			where
				p.is_live = true
				and lower(u.username) <> all($2::text[])
				and not exists (
					select 1
					from blocked_users b
					where
						(b.blocker_id = $1 and b.blocked_user_id = u.id)
						or (b.blocker_id = u.id and b.blocked_user_id = $1)
				)
				and (
					u.id = $1
					or coalesce(u.is_private_account, false) = false
					or f.followed_user_id is not null
				)
				and (
					u.id = $1
					or (
						coalesce(u.is_private_account, false) = true
						and f.followed_user_id is not null
					)
					or coalesce(p.visibility, 'public') = 'public'
					or (
						coalesce(p.visibility, 'public') = 'friends'
						and (
							f.followed_user_id is not null
							or coalesce(sf.status, '') = 'accepted'
						)
					)
				)
				and ($3 = 'all' or p.media_type::text = $3)
				and (
					($10 <> '' and translate(lower(coalesce(p.caption, '')), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') ~ $10)
					or (
						$10 = ''
						and (
							$4 = ''
							or translate(lower(coalesce(p.caption, '')), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') like $5
							or translate(lower(coalesce(p.location_name, '')), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') like $5
							or translate(lower(u.username), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') like $5
							or translate(lower(coalesce(u.full_name, '')), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') like $5
						)
					)
				)
		), ranked as (
			select
				searchable.*,
				case
					when $10 <> '' then 0
					when normalized_username = $4 then 0
					when normalized_full_name = $4 then 1
					when normalized_caption = $4 then 2
					when normalized_location = $4 then 3
					when normalized_username like $6 then 4
					when normalized_full_name like $6 then 5
					when normalized_caption like $6 then 6
					when normalized_location like $6 then 7
					when normalized_username like $5 then 8
					when normalized_full_name like $5 then 9
					when normalized_caption like $5 then 10
					when normalized_location like $5 then 11
					else 12
				end as search_rank
			from searchable
		)
		select
			id,
			segment,
			media_type,
			media_url,
			caption,
			location_name,
			created_at,
			likes_count,
			comments_count,
			bookmarks_count,
			shares_count,
			author_id,
			username,
			avatar_url,
			is_verified,
			is_following,
			is_liked,
			is_bookmarked,
			street_status,
			street_requested_by,
			case
				when $7 = 'popular' then popularity_score
				when $7 = 'recent' then extract(epoch from created_at)::double precision
				else greatest(0::double precision, 1000.0 - search_rank::double precision)
			end as ranking_score
		from ranked
		order by
			case when $7 = 'relevant' then search_rank else 0 end asc,
			case
				when $7 = 'popular' then popularity_score
				when $7 = 'relevant' then popularity_score
				else 0::double precision
			end desc,
			created_at desc,
			id desc
		limit $8 offset $9
	`,
		input.ViewerID,
		hiddenExploreFeedUsernames,
		string(filter),
		normalizedQuery,
		searchPattern,
		prefixPattern,
		string(sort),
		limit+1,
		cursorOffset,
		tagSearchPattern,
	)
	if err != nil {
		return SearchPostsResponse{}, fmt.Errorf("query explore posts: %w", err)
	}
	defer rows.Close()

	posts := make([]Post, 0, limit+1)
	for rows.Next() {
		var (
			post                    Post
			isBookmarked            bool
			isFollowing             bool
			isLiked                 bool
			streetFriendState       string
			streetFriendRequestedBy string
		)

		if err := rows.Scan(
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
			&streetFriendState,
			&streetFriendRequestedBy,
			&post.RankingScore,
		); err != nil {
			return SearchPostsResponse{}, fmt.Errorf("scan explore post row: %w", err)
		}

		relationshipStatus, isStreetFriend := viewerStreetFriendState(
			streetFriendState,
			streetFriendRequestedBy,
			input.ViewerID,
		)
		post.ViewerState = ViewerState{
			FollowRequestStatus: FollowRequestStatusNone,
			IsBookmarked:        isBookmarked,
			IsFollowing:         isFollowing,
			IsLiked:             isLiked,
			IsStreetFriend:      isStreetFriend,
			StreetFriendStatus:  relationshipStatus,
		}
		posts = append(posts, post)
	}

	if rows.Err() != nil {
		return SearchPostsResponse{}, fmt.Errorf("iterate explore posts: %w", rows.Err())
	}

	hasMore := len(posts) > limit
	if hasMore {
		posts = posts[:limit]
	}

	nextCursor := ""
	if hasMore {
		nextCursor = strconv.Itoa(cursorOffset + limit)
	}

	return SearchPostsResponse{
		Filter:     filter,
		HasMore:    hasMore,
		NextCursor: nextCursor,
		Posts:      posts,
		Query:      trimmedQuery,
		Sort:       sort,
	}, nil
}

func (r *Repository) SearchTrendingTags(
	ctx context.Context,
	viewerID string,
	limit int,
) (SearchTrendingTagsResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	if viewerID == "" {
		return SearchTrendingTagsResponse{
			GeneratedAt: time.Now().UTC(),
			Tags:        []SearchTrendingTag{},
		}, nil
	}

	rows, err := r.db.Query(ctx, `
		with visible_posts as (
			select
				p.id,
				p.created_at,
				translate(lower(coalesce(p.caption, '')), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') as normalized_caption
			from posts p
			join users u on u.id = p.user_id
			left join follows f on f.follower_id = $1 and f.followed_user_id = u.id
			where
				p.is_live = true
				and lower(u.username) <> all($3::text[])
				and not exists (
					select 1
					from blocked_users b
					where
						(b.blocker_id = $1 and b.blocked_user_id = u.id)
						or (b.blocker_id = u.id and b.blocked_user_id = $1)
				)
				and (
					u.id = $1
					or coalesce(u.is_private_account, false) = false
					or f.followed_user_id is not null
				)
				and (
					u.id = $1
					or (
						coalesce(u.is_private_account, false) = true
						and f.followed_user_id is not null
					)
					or coalesce(p.visibility, 'public') = 'public'
					or (
						coalesce(p.visibility, 'public') = 'friends'
						and (
							f.followed_user_id is not null
							or exists(
								select 1
								from street_friendships sf
								where
									sf.status = 'accepted'
									and (
										(sf.user_a_id = $1 and sf.user_b_id = u.id)
										or (sf.user_a_id = u.id and sf.user_b_id = $1)
									)
							)
						)
					)
				)
		), matches as (
			select
				visible_posts.id,
				visible_posts.created_at,
				lower(tag_match.tag) as tag
			from visible_posts
			cross join lateral (
				select unnest(regexp_matches(visible_posts.normalized_caption, '#([[:alnum:]_]{2,32})', 'g')) as tag
			) tag_match
		)
		select
			tag,
			count(distinct id)::bigint as post_count,
			count(distinct id) filter (
				where created_at >= now() - interval '48 hours'
			)::bigint as recent_count,
			max(created_at) as last_used_at,
			(
				count(distinct id) filter (
					where created_at >= now() - interval '48 hours'
				)::double precision * 3.0
				+ count(distinct id)::double precision
			) as trend_score
		from matches
		where tag <> ''
		group by tag
		order by recent_count desc, trend_score desc, last_used_at desc, tag asc
		limit $2
	`,
		viewerID,
		normalizePostSearchLimit(limit),
		hiddenExploreFeedUsernames,
	)
	if err != nil {
		return SearchTrendingTagsResponse{}, fmt.Errorf("query trending tags: %w", err)
	}
	defer rows.Close()

	tags := make([]SearchTrendingTag, 0, 12)
	for rows.Next() {
		var item SearchTrendingTag
		if err := rows.Scan(
			&item.Tag,
			&item.Count,
			&item.RecentCount,
			&item.LastUsedAt,
			&item.Score,
		); err != nil {
			return SearchTrendingTagsResponse{}, fmt.Errorf("scan trending tag row: %w", err)
		}
		if strings.TrimSpace(item.Tag) == "" {
			continue
		}
		tags = append(tags, item)
	}

	if rows.Err() != nil {
		return SearchTrendingTagsResponse{}, fmt.Errorf("iterate trending tag rows: %w", rows.Err())
	}

	return SearchTrendingTagsResponse{
		GeneratedAt: time.Now().UTC(),
		Tags:        tags,
	}, nil
}

func (r *Repository) DescribeTag(
	ctx context.Context,
	viewerID string,
	rawTag string,
	relatedLimit int,
) (TagDetailOverview, error) {
	viewerID = strings.TrimSpace(viewerID)
	normalizedTag := normalizeExploreHashtag(rawTag)
	if viewerID == "" || normalizedTag == "" {
		return TagDetailOverview{}, ErrInvalidTagDetail
	}

	tagPattern := fmt.Sprintf("(^|[^[:alnum:]_])#%s($|[^[:alnum:]_])", normalizedTag)
	summary := TagDetailSummary{Tag: normalizedTag}
	err := r.db.QueryRow(ctx, `
		with visible_posts as (
			select
				p.id,
				p.created_at,
				translate(lower(coalesce(p.caption, '')), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') as normalized_caption
			from posts p
			join users u on u.id = p.user_id
			left join follows f on f.follower_id = $1 and f.followed_user_id = u.id
			where
				p.is_live = true
				and lower(u.username) <> all($3::text[])
				and not exists (
					select 1
					from blocked_users b
					where
						(b.blocker_id = $1 and b.blocked_user_id = u.id)
						or (b.blocker_id = u.id and b.blocked_user_id = $1)
				)
				and (
					u.id = $1
					or coalesce(u.is_private_account, false) = false
					or f.followed_user_id is not null
				)
				and (
					u.id = $1
					or (
						coalesce(u.is_private_account, false) = true
						and f.followed_user_id is not null
					)
					or coalesce(p.visibility, 'public') = 'public'
					or (
						coalesce(p.visibility, 'public') = 'friends'
						and (
							f.followed_user_id is not null
							or exists(
								select 1
								from street_friendships sf
								where
									sf.status = 'accepted'
									and (
										(sf.user_a_id = $1 and sf.user_b_id = u.id)
										or (sf.user_a_id = u.id and sf.user_b_id = $1)
									)
							)
						)
					)
				)
		), tagged_posts as (
			select
				id,
				created_at,
				normalized_caption
			from visible_posts
			where normalized_caption ~ $2
		)
		select
			count(distinct id)::bigint as post_count,
			count(distinct id) filter (
				where created_at >= now() - interval '48 hours'
			)::bigint as recent_count,
			coalesce(max(created_at), to_timestamp(0)) as last_used_at
		from tagged_posts
	`,
		viewerID,
		tagPattern,
		hiddenExploreFeedUsernames,
	).Scan(
		&summary.Count,
		&summary.RecentCount,
		&summary.LastUsedAt,
	)
	if err != nil {
		return TagDetailOverview{}, fmt.Errorf("describe tag summary: %w", err)
	}
	summary.Score = float64(summary.RecentCount)*3.0 + float64(summary.Count)

	if summary.Count == 0 {
		return TagDetailOverview{
			RelatedTags: []SearchTrendingTag{},
			Tag:         summary,
		}, nil
	}

	rows, err := r.db.Query(ctx, `
		with visible_posts as (
			select
				p.id,
				p.created_at,
				translate(lower(coalesce(p.caption, '')), U&'\00E7\011F\0131\00F6\015F\00FC\00E2\00EE\00FB', 'cgiosuaiu') as normalized_caption
			from posts p
			join users u on u.id = p.user_id
			left join follows f on f.follower_id = $1 and f.followed_user_id = u.id
			where
				p.is_live = true
				and lower(u.username) <> all($3::text[])
				and not exists (
					select 1
					from blocked_users b
					where
						(b.blocker_id = $1 and b.blocked_user_id = u.id)
						or (b.blocker_id = u.id and b.blocked_user_id = $1)
				)
				and (
					u.id = $1
					or coalesce(u.is_private_account, false) = false
					or f.followed_user_id is not null
				)
				and (
					u.id = $1
					or (
						coalesce(u.is_private_account, false) = true
						and f.followed_user_id is not null
					)
					or coalesce(p.visibility, 'public') = 'public'
					or (
						coalesce(p.visibility, 'public') = 'friends'
						and (
							f.followed_user_id is not null
							or exists(
								select 1
								from street_friendships sf
								where
									sf.status = 'accepted'
									and (
										(sf.user_a_id = $1 and sf.user_b_id = u.id)
										or (sf.user_a_id = u.id and sf.user_b_id = $1)
									)
							)
						)
					)
				)
		), tagged_posts as (
			select
				id,
				created_at,
				normalized_caption
			from visible_posts
			where normalized_caption ~ $2
		), related_matches as (
			select
				tagged_posts.id,
				tagged_posts.created_at,
				lower(tag_match.tag) as tag
			from tagged_posts
			cross join lateral (
				select unnest(regexp_matches(tagged_posts.normalized_caption, '#([[:alnum:]_]{2,32})', 'g')) as tag
			) tag_match
		)
		select
			tag,
			count(distinct id)::bigint as post_count,
			count(distinct id) filter (
				where created_at >= now() - interval '48 hours'
			)::bigint as recent_count,
			max(created_at) as last_used_at,
			(
				count(distinct id) filter (
					where created_at >= now() - interval '48 hours'
				)::double precision * 3.0
				+ count(distinct id)::double precision
			) as trend_score
		from related_matches
		where tag <> '' and tag <> $4
		group by tag
		order by recent_count desc, trend_score desc, last_used_at desc, tag asc
		limit $5
	`,
		viewerID,
		tagPattern,
		hiddenExploreFeedUsernames,
		normalizedTag,
		normalizePostSearchLimit(relatedLimit),
	)
	if err != nil {
		return TagDetailOverview{}, fmt.Errorf("query related tags: %w", err)
	}
	defer rows.Close()

	relatedTags := make([]SearchTrendingTag, 0, 8)
	for rows.Next() {
		var item SearchTrendingTag
		if err := rows.Scan(
			&item.Tag,
			&item.Count,
			&item.RecentCount,
			&item.LastUsedAt,
			&item.Score,
		); err != nil {
			return TagDetailOverview{}, fmt.Errorf("scan related tag row: %w", err)
		}
		if strings.TrimSpace(item.Tag) == "" {
			continue
		}
		relatedTags = append(relatedTags, item)
	}
	if rows.Err() != nil {
		return TagDetailOverview{}, fmt.Errorf("iterate related tag rows: %w", rows.Err())
	}

	return TagDetailOverview{
		RelatedTags: relatedTags,
		Tag:         summary,
	}, nil
}

func (r *Repository) ListStreetFriends(
	ctx context.Context,
	viewerID string,
) (StreetFriendListResponse, error) {
	rows, err := r.db.Query(ctx, `
		select
			u.id,
			u.username,
			coalesce(u.full_name, ''),
			u.avatar_url,
			u.is_verified
		from street_friendships sf
		join users u on u.id = case
			when sf.user_a_id = $1 then sf.user_b_id
			else sf.user_a_id
		end
		where
			sf.status = $2
			and (sf.user_a_id = $1 or sf.user_b_id = $1)
		order by u.username asc
	`, viewerID, streetStatusAccepted)
	if err != nil {
		return StreetFriendListResponse{}, fmt.Errorf("query street friends: %w", err)
	}
	defer rows.Close()

	friends := make([]StreetFriendListItem, 0, 12)
	for rows.Next() {
		var item StreetFriendListItem
		if err := rows.Scan(
			&item.ID,
			&item.Username,
			&item.FullName,
			&item.AvatarURL,
			&item.IsVerified,
		); err != nil {
			return StreetFriendListResponse{}, fmt.Errorf("scan street friend row: %w", err)
		}
		friends = append(friends, item)
	}

	if rows.Err() != nil {
		return StreetFriendListResponse{}, fmt.Errorf("iterate street friends: %w", rows.Err())
	}

	return StreetFriendListResponse{
		Friends: friends,
	}, nil
}

func (r *Repository) StreetFriendStatus(
	ctx context.Context,
	viewerID string,
	targetUserID string,
) (StreetFriendStatusResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	targetUserID = strings.TrimSpace(targetUserID)
	if viewerID == "" || targetUserID == "" || viewerID == targetUserID {
		return StreetFriendStatusResponse{}, ErrInvalidStreetFriendAction
	}

	leftUserID, rightUserID := orderedUserPair(viewerID, targetUserID)

	var (
		rawStatus   string
		requestedBy string
	)
	if err := r.db.QueryRow(ctx, `
		select
			coalesce(status, ''),
			coalesce(requested_by, '')
		from street_friendships
		where user_a_id = $1 and user_b_id = $2
	`, leftUserID, rightUserID).Scan(&rawStatus, &requestedBy); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return StreetFriendStatusResponse{
				IsStreetFriend:     false,
				StreetFriendStatus: StreetFriendStatusNone,
				TargetUserID:       targetUserID,
			}, nil
		}
		return StreetFriendStatusResponse{}, fmt.Errorf("query street friend status: %w", err)
	}

	streetFriendStatus, isStreetFriend := viewerStreetFriendState(rawStatus, requestedBy, viewerID)
	return StreetFriendStatusResponse{
		IsStreetFriend:     isStreetFriend,
		StreetFriendStatus: streetFriendStatus,
		TargetUserID:       targetUserID,
	}, nil
}

func (r *Repository) ListStreetFriendRequests(
	ctx context.Context,
	viewerID string,
) (StreetFriendRequestListResponse, error) {
	rows, err := r.db.Query(ctx, `
		select
			u.id,
			u.username,
			coalesce(u.full_name, ''),
			u.avatar_url,
			u.is_verified,
			coalesce(sf.requested_by, ''),
			sf.updated_at
		from street_friendships sf
		join users u on u.id = case
			when sf.user_a_id = $1 then sf.user_b_id
			else sf.user_a_id
		end
		where
			sf.status = $2
			and (sf.user_a_id = $1 or sf.user_b_id = $1)
			and not exists (
				select 1
				from blocked_users b
				where
					(
						b.blocker_id = $1
						and b.blocked_user_id = case
							when sf.user_a_id = $1 then sf.user_b_id
							else sf.user_a_id
						end
					)
					or (
						b.blocker_id = case
							when sf.user_a_id = $1 then sf.user_b_id
							else sf.user_a_id
						end
						and b.blocked_user_id = $1
					)
			)
		order by sf.updated_at desc, u.username asc
	`, viewerID, streetStatusPending)
	if err != nil {
		return StreetFriendRequestListResponse{}, fmt.Errorf("query street friend requests: %w", err)
	}
	defer rows.Close()

	requests := make([]StreetFriendRequestItem, 0, 12)
	var incomingCount int64
	var outgoingCount int64
	for rows.Next() {
		var (
			item        StreetFriendRequestItem
			requestedBy string
		)
		if err := rows.Scan(
			&item.ID,
			&item.Username,
			&item.FullName,
			&item.AvatarURL,
			&item.IsVerified,
			&requestedBy,
			&item.RequestedAt,
		); err != nil {
			return StreetFriendRequestListResponse{}, fmt.Errorf("scan street friend request row: %w", err)
		}

		relationshipStatus, isStreetFriend := viewerStreetFriendState(
			streetStatusPending,
			requestedBy,
			viewerID,
		)
		if isStreetFriend {
			continue
		}
		if relationshipStatus != StreetFriendStatusPendingIncoming &&
			relationshipStatus != StreetFriendStatusPendingOutgoing {
			continue
		}
		if relationshipStatus == StreetFriendStatusPendingIncoming {
			incomingCount++
		} else if relationshipStatus == StreetFriendStatusPendingOutgoing {
			outgoingCount++
		}
		item.StreetFriendStatus = relationshipStatus
		requests = append(requests, item)
	}

	if rows.Err() != nil {
		return StreetFriendRequestListResponse{}, fmt.Errorf("iterate street friend requests: %w", rows.Err())
	}

	return StreetFriendRequestListResponse{
		IncomingCount: incomingCount,
		OutgoingCount: outgoingCount,
		Requests:      requests,
	}, nil
}

func (r *Repository) UpsertStreetFriend(
	ctx context.Context,
	viewerID string,
	creatorID string,
) (StreetFriendResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	creatorID = strings.TrimSpace(creatorID)
	if viewerID == "" || creatorID == "" || viewerID == creatorID {
		return StreetFriendResponse{}, ErrInvalidStreetFriendAction
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return StreetFriendResponse{}, fmt.Errorf("begin street friend tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var creatorExists bool
	if err := tx.QueryRow(ctx, `
		select exists(select 1 from users where id = $1)
	`, creatorID).Scan(&creatorExists); err != nil {
		return StreetFriendResponse{}, fmt.Errorf("check creator exists: %w", err)
	}
	if !creatorExists {
		return StreetFriendResponse{}, ErrCreatorNotFound
	}

	var hasBlockedRelationship bool
	if err := tx.QueryRow(ctx, `
		select exists(
			select 1
			from blocked_users b
			where
				(b.blocker_id = $1 and b.blocked_user_id = $2)
				or (b.blocker_id = $2 and b.blocked_user_id = $1)
		)
	`, viewerID, creatorID).Scan(&hasBlockedRelationship); err != nil {
		return StreetFriendResponse{}, fmt.Errorf("check blocked relationship for street friend: %w", err)
	}
	if hasBlockedRelationship {
		return StreetFriendResponse{}, ErrBlockedRelationship
	}

	userA, userB := orderedUserPair(viewerID, creatorID)
	var (
		rawStatus   string
		requestedBy string
	)
	rowErr := tx.QueryRow(ctx, `
		select status, requested_by
		from street_friendships
		where user_a_id = $1 and user_b_id = $2
		for update
	`, userA, userB).Scan(&rawStatus, &requestedBy)

	switch {
	case errors.Is(rowErr, pgx.ErrNoRows):
		if _, err := tx.Exec(ctx, `
			insert into street_friendships (
				user_a_id,
				user_b_id,
				requested_by,
				status,
				created_at,
				updated_at
			)
			values ($1, $2, $3, $4, now(), now())
		`, userA, userB, viewerID, streetStatusPending); err != nil {
			return StreetFriendResponse{}, fmt.Errorf("insert street friendship: %w", err)
		}
		rawStatus = streetStatusPending
		requestedBy = viewerID
		if _, err := r.insertProfileNotificationTx(ctx, tx, profileNotificationPayload{
			ActorID:     viewerID,
			Body:        "Sana yeni Yakındakiler isteği gönderildi.",
			Channel:     "follow_requests",
			ID:          StreetFriendRequestNotificationID(viewerID, creatorID),
			Metadata:    map[string]any{"requesterId": viewerID, "targetId": creatorID},
			RecipientID: creatorID,
			Title:       "Yeni Yakındakiler isteği",
			Type:        "street_friend.request.created",
		}); err != nil {
			return StreetFriendResponse{}, fmt.Errorf("insert street friend request notification: %w", err)
		}
	case rowErr != nil:
		return StreetFriendResponse{}, fmt.Errorf("query street friendship: %w", rowErr)
	case rawStatus == streetStatusAccepted:
		// already accepted
	case rawStatus == streetStatusPending && requestedBy != viewerID:
		if err := r.deleteProfileNotificationByIDTx(
			ctx,
			tx,
			StreetFriendRequestNotificationID(viewerID, creatorID),
		); err != nil {
			return StreetFriendResponse{}, err
		}
		if err := r.deleteProfileNotificationByIDTx(
			ctx,
			tx,
			StreetFriendRequestNotificationID(creatorID, viewerID),
		); err != nil {
			return StreetFriendResponse{}, err
		}
		if _, err := tx.Exec(ctx, `
			update street_friendships
			set
				status = $3,
				accepted_at = now(),
				updated_at = now()
			where user_a_id = $1 and user_b_id = $2
		`, userA, userB, streetStatusAccepted); err != nil {
			return StreetFriendResponse{}, fmt.Errorf("accept street friendship: %w", err)
		}
		rawStatus = streetStatusAccepted
	default:
		// pending_outgoing: idempotent
	}

	if err := tx.Commit(ctx); err != nil {
		return StreetFriendResponse{}, fmt.Errorf("commit street friend tx: %w", err)
	}

	relationshipStatus, isStreetFriend := viewerStreetFriendState(
		rawStatus,
		requestedBy,
		viewerID,
	)
	return StreetFriendResponse{
		CreatorID:          creatorID,
		IsStreetFriend:     isStreetFriend,
		StreetFriendStatus: relationshipStatus,
	}, nil
}

func (r *Repository) ApplyReaction(ctx context.Context, postID string, viewerID string, kind ReactionKind) (ReactionResponse, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ReactionResponse{}, fmt.Errorf("begin reaction tx: %w", err)
	}
	defer tx.Rollback(ctx)

	snapshot, err := r.loadPostAccessSnapshotTx(ctx, tx, postID, viewerID, true)
	if err != nil {
		return ReactionResponse{}, err
	}

	switch kind {
	case ReactionBookmark:
		if _, err := r.toggleEngagementFlagTx(ctx, tx, postID, viewerID, "bookmarked"); err != nil {
			return ReactionResponse{}, err
		}
	case ReactionShare:
		if _, err := tx.Exec(ctx, `
			insert into post_engagements (
				viewer_id,
				post_id,
				shared_count,
				post_deleted_at,
				post_deleted_reason,
				updated_at
			)
			values ($1, $2, 1, null, '', now())
			on conflict (viewer_id, post_id)
			do update set
				shared_count = post_engagements.shared_count + 1,
				post_deleted_at = null,
				post_deleted_reason = '',
				updated_at = now()
		`, viewerID, postID); err != nil {
			return ReactionResponse{}, fmt.Errorf("record share: %w", err)
		}

		if _, err := tx.Exec(ctx, `
			update posts
			set shares_count = shares_count + 1
			where id = $1
		`, postID); err != nil {
			return ReactionResponse{}, fmt.Errorf("increment share counter: %w", err)
		}
	default:
		if _, err := r.toggleEngagementFlagTx(ctx, tx, postID, viewerID, "liked"); err != nil {
			return ReactionResponse{}, err
		}
	}

	stats, viewerState, err := r.fetchReactionSnapshotTx(
		ctx,
		tx,
		postID,
		viewerID,
		snapshot.AuthorID,
	)
	if err != nil {
		return ReactionResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return ReactionResponse{}, fmt.Errorf("commit reaction tx: %w", err)
	}

	return ReactionResponse{
		PostID:      postID,
		Segment:     snapshot.Segment,
		Stats:       stats,
		ViewerState: viewerState,
	}, nil
}

func (r *Repository) AssertViewerCanAccessPost(
	ctx context.Context,
	postID string,
	viewerID string,
) error {
	postID = strings.TrimSpace(postID)
	viewerID = strings.TrimSpace(viewerID)
	if postID == "" || viewerID == "" {
		return errors.New("post id and viewer id are required")
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin assert post access tx: %w", err)
	}
	defer tx.Rollback(ctx)

	_, err = r.loadPostAccessSnapshotTx(ctx, tx, postID, viewerID, false)
	return err
}

func (r *Repository) ListPostEngagementUsers(
	ctx context.Context,
	postID string,
	viewerID string,
	kind ReactionKind,
	limit int,
) (PostEngagementUsersResponse, error) {
	postID = strings.TrimSpace(postID)
	viewerID = strings.TrimSpace(viewerID)
	if postID == "" || viewerID == "" {
		return PostEngagementUsersResponse{}, errors.New("post id and viewer id are required")
	}

	switch kind {
	case ReactionLike, ReactionBookmark:
	default:
		return PostEngagementUsersResponse{}, errors.New("invalid engagement kind")
	}

	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return PostEngagementUsersResponse{}, fmt.Errorf("begin engagement list tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Enforce access (private posts, blocking, etc.) before building a user list.
	if _, err := r.loadPostAccessSnapshotTx(ctx, tx, postID, viewerID, false); err != nil {
		return PostEngagementUsersResponse{}, err
	}

	rows, err := tx.Query(ctx, `
		select
			u.id,
			u.username,
			u.avatar_url,
			u.is_verified,
			coalesce(count(*) over(), 0) as total
		from post_engagements pe
		join users u on u.id = pe.viewer_id
		where
			pe.post_id = $1
			and pe.post_deleted_at is null
			and (
				case
					when $3 = 'like' then pe.liked
					when $3 = 'bookmark' then pe.bookmarked
					else false
				end
			) = true
		order by pe.updated_at desc
		limit $2
	`, postID, limit, string(kind))
	if err != nil {
		return PostEngagementUsersResponse{}, fmt.Errorf("query post engagement users: %w", err)
	}
	defer rows.Close()

	users := make([]Author, 0, limit)
	var total int64
	for rows.Next() {
		var author Author
		var rowTotal int64
		if err := rows.Scan(&author.ID, &author.Username, &author.AvatarURL, &author.IsVerified, &rowTotal); err != nil {
			return PostEngagementUsersResponse{}, fmt.Errorf("scan engagement user row: %w", err)
		}
		if total == 0 && rowTotal > 0 {
			total = rowTotal
		}
		users = append(users, author)
	}
	if err := rows.Err(); err != nil {
		return PostEngagementUsersResponse{}, fmt.Errorf("iterate engagement users: %w", err)
	}

	// If there are no rows, total stays 0.
	return PostEngagementUsersResponse{
		PostID: postID,
		Kind:   kind,
		Users:  users,
		Total:  total,
	}, nil
}

func (r *Repository) ReportPost(ctx context.Context, postID string, viewerID string, reason string) (PostReportResponse, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return PostReportResponse{}, fmt.Errorf("begin report tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := r.loadPostAccessSnapshotTx(ctx, tx, postID, viewerID, false); err != nil {
		return PostReportResponse{}, err
	}

	normalizedReason := strings.TrimSpace(reason)
	if normalizedReason == "" {
		normalizedReason = "other"
	}
	if len(normalizedReason) > 120 {
		normalizedReason = normalizedReason[:120]
	}

	reportedAt := time.Now().UTC()
	if err := tx.QueryRow(ctx, `
		insert into post_reports (
			viewer_id,
			post_id,
			reason,
			created_at,
			updated_at
		)
		values ($1, $2, $3, $4, $4)
		on conflict (viewer_id, post_id)
		do update set
			reason = excluded.reason,
			updated_at = excluded.updated_at
		returning updated_at
	`, viewerID, postID, normalizedReason, reportedAt).Scan(&reportedAt); err != nil {
		return PostReportResponse{}, fmt.Errorf("upsert post report: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return PostReportResponse{}, fmt.Errorf("commit report tx: %w", err)
	}

	return PostReportResponse{
		PostID:     postID,
		Reason:     normalizedReason,
		ReportedAt: reportedAt,
	}, nil
}

func (r *Repository) fetchPlaylist(ctx context.Context, segment Segment) (*Playlist, error) {
	now := time.Now().UTC()
	if cached, ok := r.readPlaylistCache(segment, now); ok {
		return cached, nil
	}

	var playlist Playlist
	err := r.db.QueryRow(ctx, `
		select
			sp.id,
			sp.spotify_playlist_id,
			sp.title,
			sp.subtitle,
			sp.cover_image_url,
			sp.open_url,
			sp.embed_url,
			sp.theme,
			sp.accent_color
		from segment_playlists sg
		join spotify_playlists sp on sp.id = sg.playlist_id
		where sg.segment = $1
	`, string(segment)).Scan(
		&playlist.ID,
		&playlist.SpotifyPlaylistID,
		&playlist.Title,
		&playlist.Subtitle,
		&playlist.CoverImageURL,
		&playlist.OpenURL,
		&playlist.EmbedURL,
		&playlist.Theme,
		&playlist.AccentColor,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		r.storePlaylistCache(segment, nil, now.Add(playlistCacheTTL))
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query playlist: %w", err)
	}

	r.storePlaylistCache(segment, &playlist, now.Add(playlistCacheTTL))
	return clonePlaylist(&playlist), nil
}

func (r *Repository) fetchReactionSnapshotTx(
	ctx context.Context,
	tx pgx.Tx,
	postID string,
	viewerID string,
	creatorID string,
) (Stats, ViewerState, error) {
	var (
		stats             Stats
		viewerState       ViewerState
		streetRequestedBy string
		streetStatus      string
	)

	if err := tx.QueryRow(ctx, `
		select likes_count, comments_count, bookmarks_count, shares_count
		from posts
		where id = $1
	`, postID).Scan(
		&stats.LikesCount,
		&stats.CommentsCount,
		&stats.BookmarksCount,
		&stats.SharesCount,
	); err != nil {
		return Stats{}, ViewerState{}, fmt.Errorf("query post stats snapshot: %w", err)
	}

	if err := tx.QueryRow(ctx, `
		select
			coalesce(pe.liked, false),
			coalesce(pe.bookmarked, false),
			exists(
				select 1
				from follows f
				where f.follower_id = $2 and f.followed_user_id = $3
			),
			coalesce(sf.status, ''),
			coalesce(sf.requested_by, '')
		from posts p
		left join post_engagements pe on pe.post_id = p.id and pe.viewer_id = $2
		left join lateral (
			select sf.status, sf.requested_by
			from street_friendships sf
			where
				(sf.user_a_id = $2 and sf.user_b_id = $3)
				or (sf.user_a_id = $3 and sf.user_b_id = $2)
			limit 1
		) sf on true
		where p.id = $1
	`, postID, viewerID, creatorID).Scan(
		&viewerState.IsLiked,
		&viewerState.IsBookmarked,
		&viewerState.IsFollowing,
		&streetStatus,
		&streetRequestedBy,
	); err != nil {
		return Stats{}, ViewerState{}, fmt.Errorf("query viewer state snapshot: %w", err)
	}

	viewerState.StreetFriendStatus, viewerState.IsStreetFriend = viewerStreetFriendState(
		streetStatus,
		streetRequestedBy,
		viewerID,
	)
	viewerState.FollowRequestStatus = FollowRequestStatusNone

	return stats, viewerState, nil
}

func (r *Repository) toggleEngagementFlagTx(
	ctx context.Context,
	tx pgx.Tx,
	postID string,
	viewerID string,
	field string,
) (bool, error) {
	var (
		bookmarked bool
		liked      bool
	)

	lockErr := tx.QueryRow(ctx, `
		select liked, bookmarked
		from post_engagements
		where viewer_id = $1 and post_id = $2
		for update
	`, viewerID, postID).Scan(&liked, &bookmarked)
	if errors.Is(lockErr, pgx.ErrNoRows) {
		liked = false
		bookmarked = false
	} else if lockErr != nil {
		return false, fmt.Errorf("lock engagement row: %w", lockErr)
	}

	nextValue := true
	counterColumn := "likes_count"

	switch field {
	case "bookmarked":
		nextValue = !bookmarked
		bookmarked = nextValue
		counterColumn = "bookmarks_count"
	default:
		nextValue = !liked
		liked = nextValue
	}

	if errors.Is(lockErr, pgx.ErrNoRows) {
		if _, err := tx.Exec(ctx, `
			insert into post_engagements (
				viewer_id,
				post_id,
				liked,
				bookmarked,
				post_deleted_at,
				post_deleted_reason,
				updated_at
			)
			values ($1, $2, $3, $4, null, '', now())
		`, viewerID, postID, liked, bookmarked); err != nil {
			return false, fmt.Errorf("insert engagement row: %w", err)
		}
	} else {
		if _, err := tx.Exec(ctx, `
			update post_engagements
			set
				liked = $3,
				bookmarked = $4,
				post_deleted_at = null,
				post_deleted_reason = '',
				updated_at = now()
			where viewer_id = $1 and post_id = $2
		`, viewerID, postID, liked, bookmarked); err != nil {
			return false, fmt.Errorf("update engagement row: %w", err)
		}
	}

	delta := 1
	if !nextValue {
		delta = -1
	}

	query := fmt.Sprintf(`
		update posts
		set %s = greatest(%s + $2, 0)
		where id = $1
	`, counterColumn, counterColumn)

	if _, err := tx.Exec(ctx, query, postID, delta); err != nil {
		return false, fmt.Errorf("update post counter: %w", err)
	}

	return nextValue, nil
}

func scanComment(ctx context.Context, tx pgx.Tx, commentID string, viewerID string) (Comment, error) {
	var comment Comment

	if err := tx.QueryRow(ctx, `
		select
			c.id,
			c.post_id,
			c.body,
			c.like_count,
			exists(
				select 1
				from comment_engagements ce
				where ce.comment_id = c.id and ce.viewer_id = $2
			) as is_liked,
			c.created_at,
			u.id,
			u.username,
			u.avatar_url,
			u.is_verified
		from comments c
		join users u on u.id = c.user_id
		where c.id = $1
	`, commentID, viewerID).Scan(
		&comment.ID,
		&comment.PostID,
		&comment.Body,
		&comment.LikeCount,
		&comment.IsLiked,
		&comment.CreatedAt,
		&comment.Author.ID,
		&comment.Author.Username,
		&comment.Author.AvatarURL,
		&comment.Author.IsVerified,
	); err != nil {
		return Comment{}, fmt.Errorf("query inserted comment: %w", err)
	}

	return comment, nil
}

func (r *Repository) readPlaylistCache(segment Segment, now time.Time) (*Playlist, bool) {
	r.playlistCacheMu.RLock()
	entry, ok := r.playlistCache[segment]
	r.playlistCacheMu.RUnlock()
	if !ok || now.After(entry.expiresAt) {
		return nil, false
	}

	return clonePlaylist(entry.playlist), true
}

func (r *Repository) storePlaylistCache(segment Segment, playlist *Playlist, expiresAt time.Time) {
	r.playlistCacheMu.Lock()
	r.playlistCache[segment] = playlistCacheEntry{
		expiresAt: expiresAt,
		playlist:  clonePlaylist(playlist),
	}
	r.playlistCacheMu.Unlock()
}

func clonePlaylist(playlist *Playlist) *Playlist {
	if playlist == nil {
		return nil
	}

	copy := *playlist
	return &copy
}

func (r *Repository) UpsertTrackingSession(ctx context.Context, userID string, roomID string) (int64, error) {
	normalizedUserID := strings.TrimSpace(userID)
	if normalizedUserID == "" {
		return 0, errors.New("user id is required")
	}

	row := r.db.QueryRow(ctx, `
		with active as (
			select id
			from tracking_sessions
			where user_id = $1 and closed_at is null
			order by last_seen_at desc
			limit 1
		),
		updated as (
			update tracking_sessions
			set room_id = $2, last_seen_at = now()
			where id in (select id from active)
			returning id
		),
		inserted as (
			insert into tracking_sessions (user_id, room_id, started_at, last_seen_at)
			select $1, $2, now(), now()
			where not exists (select 1 from updated)
			returning id
		)
		select id from updated
		union all
		select id from inserted
		limit 1
	`, normalizedUserID, strings.TrimSpace(roomID))

	var sessionID int64
	if err := row.Scan(&sessionID); err != nil {
		return 0, fmt.Errorf("upsert tracking session: %w", err)
	}
	return sessionID, nil
}

func (r *Repository) CloseTrackingSession(ctx context.Context, userID string) error {
	normalizedUserID := strings.TrimSpace(userID)
	if normalizedUserID == "" {
		return errors.New("user id is required")
	}

	if _, err := r.db.Exec(ctx, `
		update tracking_sessions
		set closed_at = now(), last_seen_at = now()
		where user_id = $1 and closed_at is null
	`, normalizedUserID); err != nil {
		return fmt.Errorf("close tracking session: %w", err)
	}
	return nil
}

func (r *Repository) RecordTrackingPoint(ctx context.Context, input TrackingPointInput) error {
	if strings.TrimSpace(input.UserID) == "" {
		return errors.New("user id is required")
	}
	if input.Latitude == 0 && input.Longitude == 0 {
		return nil
	}
	sessionID, err := r.UpsertTrackingSession(ctx, input.UserID, input.RoomID)
	if err != nil {
		return err
	}

	capturedAt := time.Now().UTC()
	if input.Timestamp > 0 {
		capturedAt = time.UnixMilli(input.Timestamp).UTC()
	}
	source := strings.TrimSpace(input.Source)
	if source == "" {
		source = "gps"
	}

	_, err = r.db.Exec(ctx, `
		insert into tracking_points (
			session_id, user_id, room_id, latitude, longitude,
			accuracy, heading, speed, source, sequence, captured_at
		) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
	`, sessionID, strings.TrimSpace(input.UserID), strings.TrimSpace(input.RoomID),
		input.Latitude, input.Longitude, input.Accuracy, input.Heading, input.Speed,
		source, int(input.Sequence), capturedAt)
	if err != nil {
		return fmt.Errorf("insert tracking point: %w", err)
	}
	return nil
}

func (r *Repository) CloseStaleTrackingSessions(ctx context.Context, userID string, inactivityTimeout time.Duration) error {
	normalizedUserID := strings.TrimSpace(userID)
	if normalizedUserID == "" {
		return errors.New("user id is required")
	}
	if inactivityTimeout <= 0 {
		return nil
	}
	if _, err := r.db.Exec(ctx, `
		update tracking_sessions
		set closed_at = now()
		where user_id = $1
		  and closed_at is null
		  and last_seen_at < now() - $2::interval
	`, normalizedUserID, inactivityTimeout.String()); err != nil {
		return fmt.Errorf("close stale tracking sessions: %w", err)
	}
	return nil
}

func (r *Repository) TrackingFollowPath(ctx context.Context, targetUserID string, query TrackingFollowPathQuery) (TrackingFollowPathResponse, error) {
	normalizedUserID := strings.TrimSpace(targetUserID)
	if normalizedUserID == "" {
		return TrackingFollowPathResponse{}, errors.New("target user id is required")
	}
	limit := query.Limit
	if limit <= 0 {
		limit = 120
	}
	if limit > 200 {
		limit = 200
	}
	window := query.Window
	if window <= 0 {
		window = 15 * time.Minute
	}
	if window > time.Hour {
		window = time.Hour
	}
	epsilon := query.SimplifyEps
	if epsilon <= 0 {
		epsilon = 0.00004
	}

	var sessionID int64
	err := r.db.QueryRow(ctx, `
		select id
		from tracking_sessions
		where user_id = $1
		order by last_seen_at desc
		limit 1
	`, normalizedUserID).Scan(&sessionID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return TrackingFollowPathResponse{
				Points:       []TrackingPoint{},
				SessionID:    0,
				TargetUserID: normalizedUserID,
			}, nil
		}
		return TrackingFollowPathResponse{}, fmt.Errorf("find tracking session: %w", err)
	}

	rows, err := r.db.Query(ctx, `
		select latitude, longitude, accuracy, heading, speed, source, sequence, captured_at
		from tracking_points
		where session_id = $1
		  and captured_at >= now() - $2::interval
		order by captured_at desc
		limit $3
	`, sessionID, window.String(), limit)
	if err != nil {
		return TrackingFollowPathResponse{}, fmt.Errorf("query tracking points: %w", err)
	}
	defer rows.Close()

	points := make([]TrackingPoint, 0, limit)
	for rows.Next() {
		var point TrackingPoint
		if err := rows.Scan(
			&point.Latitude,
			&point.Longitude,
			&point.Accuracy,
			&point.Heading,
			&point.Speed,
			&point.Source,
			&point.Sequence,
			&point.CapturedAt,
		); err != nil {
			return TrackingFollowPathResponse{}, fmt.Errorf("scan tracking point: %w", err)
		}
		points = append(points, point)
	}
	if err := rows.Err(); err != nil {
		return TrackingFollowPathResponse{}, fmt.Errorf("iterate tracking points: %w", err)
	}

	for left, right := 0, len(points)-1; left < right; left, right = left+1, right-1 {
		points[left], points[right] = points[right], points[left]
	}
	points = simplifyTrackingPoints(points, epsilon)

	return TrackingFollowPathResponse{
		Points:       points,
		SessionID:    sessionID,
		TargetUserID: normalizedUserID,
	}, nil
}

func simplifyTrackingPoints(points []TrackingPoint, epsilon float64) []TrackingPoint {
	if len(points) <= 2 || epsilon <= 0 {
		return points
	}
	keep := make([]bool, len(points))
	keep[0] = true
	keep[len(points)-1] = true
	simplifyRange(points, 0, len(points)-1, epsilon, keep)

	result := make([]TrackingPoint, 0, len(points))
	for index, point := range points {
		if keep[index] {
			result = append(result, point)
		}
	}
	if len(result) < 2 {
		return points
	}
	return result
}

func simplifyRange(points []TrackingPoint, start int, end int, epsilon float64, keep []bool) {
	if end <= start+1 {
		return
	}
	maxDistance := -1.0
	index := -1
	for current := start + 1; current < end; current++ {
		distance := pointToSegmentDistance(points[current], points[start], points[end])
		if distance > maxDistance {
			maxDistance = distance
			index = current
		}
	}
	if index == -1 || maxDistance <= epsilon {
		return
	}
	keep[index] = true
	simplifyRange(points, start, index, epsilon, keep)
	simplifyRange(points, index, end, epsilon, keep)
}

func pointToSegmentDistance(point TrackingPoint, start TrackingPoint, end TrackingPoint) float64 {
	dx := end.Longitude - start.Longitude
	dy := end.Latitude - start.Latitude
	if dx == 0 && dy == 0 {
		return math.Hypot(point.Longitude-start.Longitude, point.Latitude-start.Latitude)
	}
	projection := ((point.Longitude-start.Longitude)*dx + (point.Latitude-start.Latitude)*dy) / (dx*dx + dy*dy)
	if projection < 0 {
		projection = 0
	} else if projection > 1 {
		projection = 1
	}
	nearestX := start.Longitude + projection*dx
	nearestY := start.Latitude + projection*dy
	return math.Hypot(point.Longitude-nearestX, point.Latitude-nearestY)
}

func newID(prefix string) string {
	buffer := make([]byte, 6)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
	}

	return fmt.Sprintf("%s_%d_%s", prefix, time.Now().UnixMilli(), hex.EncodeToString(buffer))
}
