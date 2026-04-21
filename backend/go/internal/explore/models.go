package explore

import (
	"strings"
	"time"
)

type Segment string

const (
	SegmentExplore   Segment = "kesfet"
	SegmentFollowing Segment = "takipte"
	SegmentForYou    Segment = "sizin-icin"
)

const FeedRankVersion = "v2-personalized-segments"

func NormalizeSegment(value string) Segment {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case string(SegmentFollowing):
		return SegmentFollowing
	case string(SegmentForYou), "sizin icin", "foryou":
		return SegmentForYou
	default:
		return SegmentExplore
	}
}

type ReactionKind string

const (
	ReactionBookmark ReactionKind = "bookmark"
	ReactionLike     ReactionKind = "like"
	ReactionShare    ReactionKind = "share"
)

func NormalizeReactionKind(value string) ReactionKind {
	kind, ok := ParseReactionKind(value)
	if !ok {
		return ReactionLike
	}

	return kind
}

func ParseReactionKind(value string) (ReactionKind, bool) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case string(ReactionBookmark):
		return ReactionBookmark, true
	case string(ReactionShare):
		return ReactionShare, true
	case string(ReactionLike):
		return ReactionLike, true
	default:
		return "", false
	}
}

type PostVisibility string

const (
	PostVisibilityFriends PostVisibility = "friends"
	PostVisibilityPrivate PostVisibility = "private"
	PostVisibilityPublic  PostVisibility = "public"
)

func NormalizePostVisibility(value string) PostVisibility {
	visibility, ok := ParsePostVisibility(value)
	if !ok {
		return PostVisibilityPublic
	}

	return visibility
}

func ParsePostVisibility(value string) (PostVisibility, bool) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case string(PostVisibilityFriends):
		return PostVisibilityFriends, true
	case string(PostVisibilityPrivate):
		return PostVisibilityPrivate, true
	case string(PostVisibilityPublic):
		return PostVisibilityPublic, true
	default:
		return "", false
	}
}

type SearchPostFilter string

const (
	SearchPostFilterAll   SearchPostFilter = "all"
	SearchPostFilterPhoto SearchPostFilter = "photo"
	SearchPostFilterVideo SearchPostFilter = "video"
)

func NormalizeSearchPostFilter(value string) SearchPostFilter {
	filter, ok := ParseSearchPostFilter(value)
	if !ok {
		return SearchPostFilterAll
	}

	return filter
}

func ParseSearchPostFilter(value string) (SearchPostFilter, bool) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "", string(SearchPostFilterAll):
		return SearchPostFilterAll, true
	case string(SearchPostFilterPhoto):
		return SearchPostFilterPhoto, true
	case string(SearchPostFilterVideo):
		return SearchPostFilterVideo, true
	default:
		return "", false
	}
}

type SearchPostSort string

const (
	SearchPostSortPopular  SearchPostSort = "popular"
	SearchPostSortRecent   SearchPostSort = "recent"
	SearchPostSortRelevant SearchPostSort = "relevant"
)

func NormalizeSearchPostSort(value string) SearchPostSort {
	sort, ok := ParseSearchPostSort(value)
	if !ok {
		return SearchPostSortRelevant
	}

	return sort
}

func ParseSearchPostSort(value string) (SearchPostSort, bool) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "", string(SearchPostSortRelevant):
		return SearchPostSortRelevant, true
	case string(SearchPostSortRecent):
		return SearchPostSortRecent, true
	case string(SearchPostSortPopular):
		return SearchPostSortPopular, true
	default:
		return "", false
	}
}

type RecentSearchTermKind string

const (
	RecentSearchTermKindPlaces RecentSearchTermKind = "places"
	RecentSearchTermKindPosts  RecentSearchTermKind = "posts"
	RecentSearchTermKindTags   RecentSearchTermKind = "tags"
)

func ParseRecentSearchTermKind(value string) (RecentSearchTermKind, bool) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case string(RecentSearchTermKindPosts):
		return RecentSearchTermKindPosts, true
	case string(RecentSearchTermKindTags):
		return RecentSearchTermKindTags, true
	case string(RecentSearchTermKindPlaces):
		return RecentSearchTermKindPlaces, true
	default:
		return "", false
	}
}

type PopularSearchScoreModel string

const (
	PopularSearchScoreModelA PopularSearchScoreModel = "a"
	PopularSearchScoreModelB PopularSearchScoreModel = "b"
)

func ParsePopularSearchScoreModel(value string) (PopularSearchScoreModel, bool) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case string(PopularSearchScoreModelA), "control":
		return PopularSearchScoreModelA, true
	case string(PopularSearchScoreModelB), "treatment":
		return PopularSearchScoreModelB, true
	default:
		return "", false
	}
}

type Stats struct {
	BookmarksCount int64 `json:"bookmarksCount"`
	CommentsCount  int64 `json:"commentsCount"`
	LikesCount     int64 `json:"likesCount"`
	SharesCount    int64 `json:"sharesCount"`
}

type Author struct {
	AvatarURL  string `json:"avatarUrl"`
	ID         string `json:"id"`
	IsVerified bool   `json:"isVerified"`
	Username   string `json:"username"`
}

type ViewerState struct {
	FollowRequestStatus FollowRequestStatus `json:"followRequestStatus"`
	IsBookmarked        bool                `json:"isBookmarked"`
	IsFollowing         bool                `json:"isFollowing"`
	IsLiked             bool                `json:"isLiked"`
	IsStreetFriend      bool                `json:"isStreetFriend"`
	StreetFriendStatus  StreetFriendStatus  `json:"streetFriendStatus"`
}

type Soundtrack struct {
	PreviewURL string `json:"previewUrl,omitempty"`
	Title      string `json:"title,omitempty"`
}

type Playlist struct {
	AccentColor       string `json:"accentColor"`
	CoverImageURL     string `json:"coverImageUrl"`
	EmbedURL          string `json:"embedUrl"`
	ID                string `json:"id"`
	OpenURL           string `json:"openUrl"`
	SpotifyPlaylistID string `json:"spotifyPlaylistId"`
	Subtitle          string `json:"subtitle"`
	Theme             int16  `json:"theme"`
	Title             string `json:"title"`
}

type Post struct {
	Author         Author      `json:"author"`
	Caption        string      `json:"caption"`
	CreatedAt      time.Time   `json:"createdAt"`
	ID             string      `json:"id"`
	Location       string      `json:"location"`
	MediaType      string      `json:"mediaType"`
	MediaURL       string      `json:"mediaUrl"`
	RankingScore   float64     `json:"rankingScore"`
	RecentComments []Comment   `json:"recentComments,omitempty"`
	RecentLikes    []Author    `json:"recentLikes,omitempty"`
	Segment        Segment     `json:"segment"`
	Stats          Stats       `json:"stats"`
	ViewerState    ViewerState `json:"viewerState"`
}

type FeedPageQuery struct {
	Cursor   string
	Limit    int
	Segment  Segment
	ViewerID string
}

type SearchUsersQuery struct {
	Cursor   string
	Limit    int
	Query    string
	ViewerID string
}

type SearchPostsQuery struct {
	Cursor   string
	Filter   SearchPostFilter
	Limit    int
	Query    string
	Sort     SearchPostSort
	ViewerID string
}

type TagDetailQuery struct {
	Cursor   string
	Limit    int
	Tag      string
	ViewerID string
}

type Comment struct {
	Author    Author    `json:"author"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
	IsLiked   bool      `json:"isLiked"`
	LikeCount int       `json:"likeCount"`
	PostID    string    `json:"postId"`
}

type FeedResponse struct {
	GeneratedAt time.Time `json:"generatedAt"`
	HasMore     bool      `json:"hasMore"`
	NextCursor  string    `json:"nextCursor,omitempty"`
	Posts       []Post    `json:"posts"`
	RankVersion string    `json:"rankVersion"`
	Segment     Segment   `json:"segment"`
}

type CommentsResponse struct {
	Comments []Comment `json:"comments"`
	PostID   string    `json:"postId"`
	Total    int       `json:"total"`
}

type CommentInput struct {
	Text     string `json:"text"`
	ViewerID string `json:"viewerId,omitempty"`
}

type FollowInput struct {
	ViewerID string `json:"viewerId,omitempty"`
}

type ReactionInput struct {
	Kind     ReactionKind `json:"kind"`
	ViewerID string       `json:"viewerId,omitempty"`
}

type ReportInput struct {
	Reason   string `json:"reason"`
	ViewerID string `json:"viewerId,omitempty"`
}

type CommentMutationResponse struct {
	Comment Comment `json:"comment"`
	PostID  string  `json:"postId"`
	Segment Segment `json:"segment"`
	Stats   Stats   `json:"stats"`
}

type CommentLikeMutationResponse struct {
	Comment Comment `json:"comment"`
	PostID  string  `json:"postId"`
}

type FollowResponse struct {
	CreatorID           string              `json:"creatorId"`
	FollowRequestStatus FollowRequestStatus `json:"followRequestStatus"`
	FollowsYou          bool                `json:"followsYou"`
	IsFollowing         bool                `json:"isFollowing"`
	FollowersCount      int64               `json:"followersCount"`
}

type FollowRequestStatus string

const (
	FollowRequestStatusNone            FollowRequestStatus = "none"
	FollowRequestStatusPendingIncoming FollowRequestStatus = "pending_incoming"
	FollowRequestStatusPendingOutgoing FollowRequestStatus = "pending_outgoing"
)

type StreetFriendStatus string

const (
	StreetFriendStatusAccepted        StreetFriendStatus = "accepted"
	StreetFriendStatusNone            StreetFriendStatus = "none"
	StreetFriendStatusPendingIncoming StreetFriendStatus = "pending_incoming"
	StreetFriendStatusPendingOutgoing StreetFriendStatus = "pending_outgoing"
)

type StreetFriendResponse struct {
	CreatorID          string             `json:"creatorId"`
	IsStreetFriend     bool               `json:"isStreetFriend"`
	StreetFriendStatus StreetFriendStatus `json:"streetFriendStatus"`
}

type StreetFriendStatusResponse struct {
	IsStreetFriend     bool               `json:"isStreetFriend"`
	StreetFriendStatus StreetFriendStatus `json:"streetFriendStatus"`
	TargetUserID       string             `json:"targetUserId"`
}

type FollowerRemovalResponse struct {
	FollowerID string `json:"followerId"`
	Removed    bool   `json:"removed"`
}

type SearchUserViewerState struct {
	FollowRequestStatus FollowRequestStatus `json:"followRequestStatus"`
	FollowsYou          bool                `json:"followsYou"`
	IsFollowing         bool                `json:"isFollowing"`
	IsStreetFriend      bool                `json:"isStreetFriend"`
	StreetFriendStatus  StreetFriendStatus  `json:"streetFriendStatus"`
}

type SearchUser struct {
	AvatarURL        string                `json:"avatarUrl"`
	FullName         string                `json:"fullName"`
	ID               string                `json:"id"`
	IsPrivateAccount bool                  `json:"isPrivateAccount"`
	IsVerified       bool                  `json:"isVerified"`
	Username         string                `json:"username"`
	ViewerState      SearchUserViewerState `json:"viewerState"`
}

type SearchUsersResponse struct {
	HasMore    bool         `json:"hasMore"`
	NextCursor string       `json:"nextCursor,omitempty"`
	Query      string       `json:"query"`
	Users      []SearchUser `json:"users"`
}

type UserListResponse struct {
	Users []SearchUser `json:"users"`
}

type RecentSearchUserInput struct {
	UserID string `json:"userId"`
}

type RecentSearchTermInput struct {
	Kind  RecentSearchTermKind `json:"kind"`
	Query string               `json:"query"`
}

type RecentSearchTerm struct {
	Kind       RecentSearchTermKind `json:"kind"`
	Query      string               `json:"query"`
	SearchedAt time.Time            `json:"searchedAt"`
}

type RecentSearchTermsResponse struct {
	Items []RecentSearchTerm   `json:"items"`
	Kind  RecentSearchTermKind `json:"kind"`
}

type PopularSearchTerm struct {
	Kind           RecentSearchTermKind `json:"kind"`
	LastSearchedAt time.Time            `json:"lastSearchedAt"`
	Query          string               `json:"query"`
	RecentSearches int64                `json:"recentSearches"`
	Score          float64              `json:"score"`
	TotalSearches  int64                `json:"totalSearches"`
}

type PopularSearchTermsResponse struct {
	GeneratedAt time.Time            `json:"generatedAt"`
	Items       []PopularSearchTerm  `json:"items"`
	Kind        RecentSearchTermKind `json:"kind"`
	Query       string               `json:"query"`
	ScoreModel  string               `json:"scoreModel"`
}

type RecentSearchMutationResponse struct {
	Cleared      bool   `json:"cleared,omitempty"`
	DeletedCount int64  `json:"deletedCount,omitempty"`
	Kind         string `json:"kind,omitempty"`
	Query        string `json:"query,omitempty"`
	Removed      bool   `json:"removed,omitempty"`
	Saved        bool   `json:"saved,omitempty"`
	UserID       string `json:"userId,omitempty"`
}

type SearchPostsResponse struct {
	Filter     SearchPostFilter `json:"filter"`
	HasMore    bool             `json:"hasMore"`
	NextCursor string           `json:"nextCursor,omitempty"`
	Posts      []Post           `json:"posts"`
	Query      string           `json:"query"`
	Sort       SearchPostSort   `json:"sort"`
}

type SearchTrendingTag struct {
	Count       int64     `json:"count"`
	LastUsedAt  time.Time `json:"lastUsedAt"`
	RecentCount int64     `json:"recentCount"`
	Score       float64   `json:"score"`
	Tag         string    `json:"tag"`
}

type SearchTrendingTagsResponse struct {
	GeneratedAt time.Time           `json:"generatedAt"`
	Tags        []SearchTrendingTag `json:"tags"`
}

type TagDetailSummary struct {
	Count       int64     `json:"count"`
	LastUsedAt  time.Time `json:"lastUsedAt"`
	RecentCount int64     `json:"recentCount"`
	Score       float64   `json:"score"`
	Tag         string    `json:"tag"`
}

type TagDetailOverview struct {
	RelatedTags []SearchTrendingTag `json:"relatedTags"`
	Tag         TagDetailSummary    `json:"tag"`
}

type TagDetailResponse struct {
	GeneratedAt      time.Time           `json:"generatedAt"`
	RecentHasMore    bool                `json:"recentHasMore"`
	RecentNextCursor string              `json:"recentNextCursor,omitempty"`
	RecentPosts      []Post              `json:"recentPosts"`
	RelatedTags      []SearchTrendingTag `json:"relatedTags"`
	Tag              TagDetailSummary    `json:"tag"`
	TopPosts         []Post              `json:"topPosts"`
}

type StreetFriendListItem struct {
	AvatarURL  string `json:"avatarUrl"`
	FullName   string `json:"fullName"`
	ID         string `json:"id"`
	IsVerified bool   `json:"isVerified"`
	Username   string `json:"username"`
}

type StreetFriendListResponse struct {
	Friends []StreetFriendListItem `json:"friends"`
}

type StreetFriendRequestItem struct {
	AvatarURL          string             `json:"avatarUrl"`
	FullName           string             `json:"fullName"`
	ID                 string             `json:"id"`
	IsVerified         bool               `json:"isVerified"`
	RequestedAt        time.Time          `json:"requestedAt"`
	StreetFriendStatus StreetFriendStatus `json:"streetFriendStatus"`
	Username           string             `json:"username"`
}

type StreetFriendRequestListResponse struct {
	IncomingCount int64                     `json:"incomingCount"`
	OutgoingCount int64                     `json:"outgoingCount"`
	Requests      []StreetFriendRequestItem `json:"requests"`
}

type ReactionResponse struct {
	PostID      string      `json:"postId"`
	Segment     Segment     `json:"segment"`
	Stats       Stats       `json:"stats"`
	ViewerState ViewerState `json:"viewerState"`
}

type PostEngagementUsersResponse struct {
	PostID string       `json:"postId"`
	Kind   ReactionKind `json:"kind"`
	Users  []Author     `json:"users"`
	Total  int64        `json:"total"`
}

type PostReportResponse struct {
	PostID     string    `json:"postId"`
	Reason     string    `json:"reason"`
	ReportedAt time.Time `json:"reportedAt"`
}

type ProfilePostItem struct {
	Caption           string      `json:"caption"`
	CreatedAt         time.Time   `json:"createdAt"`
	ID                string      `json:"id"`
	IsLive            bool        `json:"isLive"`
	IsUnavailable     bool        `json:"isUnavailable,omitempty"`
	Location          string      `json:"location"`
	MediaType         string      `json:"mediaType"`
	MediaURL          string      `json:"mediaUrl"`
	RecentComments    []Comment   `json:"recentComments,omitempty"`
	RecentLikes       []Author    `json:"recentLikes,omitempty"`
	Stats             Stats       `json:"stats"`
	UnavailableReason string      `json:"unavailableReason,omitempty"`
	UserID            string      `json:"userId"`
	Username          string      `json:"username"`
	ViewerState       ViewerState `json:"viewerState"`
	Visibility        string      `json:"visibility,omitempty"`
}

type ProfilePostSelectedLocation struct {
	FullAddress string  `json:"fullAddress,omitempty"`
	Latitude    float64 `json:"latitude,omitempty"`
	Longitude   float64 `json:"longitude,omitempty"`
	MapboxID    string  `json:"mapboxId,omitempty"`
	Name        string  `json:"name,omitempty"`
}

type ProfilePostLocationPayload struct {
	NormalizedQuery  string                       `json:"normalizedQuery,omitempty"`
	Query            string                       `json:"query,omitempty"`
	SelectedLocation *ProfilePostSelectedLocation `json:"selectedLocation,omitempty"`
	Source           string                       `json:"source,omitempty"`
}

type CreateProfilePostInput struct {
	Caption         string                      `json:"caption"`
	Location        string                      `json:"location,omitempty"`
	LocationPayload *ProfilePostLocationPayload `json:"locationPayload,omitempty"`
	MediaType       string                      `json:"mediaType"`
	MediaURL        string                      `json:"mediaUrl"`
	ThumbnailURL    string                      `json:"thumbnailUrl,omitempty"`
	Visibility      string                      `json:"visibility,omitempty"`
}

type UpdateProfilePostInput struct {
	Caption         *string                     `json:"caption,omitempty"`
	Location        *string                     `json:"location,omitempty"`
	LocationPayload *ProfilePostLocationPayload `json:"locationPayload,omitempty"`
	Visibility      *string                     `json:"visibility,omitempty"`
}

type ProfilePostsResponse struct {
	HasMore    bool              `json:"hasMore"`
	NextCursor string            `json:"nextCursor,omitempty"`
	Posts      []ProfilePostItem `json:"posts"`
	UserID     string            `json:"userId"`
}

type ProfilePostDeleteMode string

const (
	ProfilePostDeleteModeHard ProfilePostDeleteMode = "hard"
	ProfilePostDeleteModeSoft ProfilePostDeleteMode = "soft"
)

type ProfilePostDeleteResponse struct {
	Deleted bool                  `json:"deleted"`
	Mode    ProfilePostDeleteMode `json:"mode"`
	PostID  string                `json:"postId"`
}

type ConversationPeer struct {
	AvatarURL  string `json:"avatarUrl"`
	FullName   string `json:"fullName"`
	ID         string `json:"id"`
	IsVerified bool   `json:"isVerified"`
	Username   string `json:"username"`
}

type MessageContentKind string

const (
	MessageContentKindLocation MessageContentKind = "location"
	MessageContentKindPhoto    MessageContentKind = "photo"
	MessageContentKindText     MessageContentKind = "text"
	MessageContentKindVoice    MessageContentKind = "voice"
)

type ConversationChatRequestStatus string

const (
	ConversationChatRequestStatusAccepted ConversationChatRequestStatus = "accepted"
	ConversationChatRequestStatusBlocked  ConversationChatRequestStatus = "blocked"
	ConversationChatRequestStatusNone     ConversationChatRequestStatus = "none"
	ConversationChatRequestStatusPending  ConversationChatRequestStatus = "pending"
	ConversationChatRequestStatusRejected ConversationChatRequestStatus = "rejected"
)

type ConversationChatRequestDirection string

const (
	ConversationChatRequestDirectionIncoming ConversationChatRequestDirection = "incoming"
	ConversationChatRequestDirectionNone     ConversationChatRequestDirection = "none"
	ConversationChatRequestDirectionOutgoing ConversationChatRequestDirection = "outgoing"
)

type ConversationMessagingMode string

const (
	ConversationMessagingModeBlocked                ConversationMessagingMode = "blocked"
	ConversationMessagingModeDirect                 ConversationMessagingMode = "direct"
	ConversationMessagingModeRequestPendingIncoming ConversationMessagingMode = "request_pending_incoming"
	ConversationMessagingModeRequestPendingOutgoing ConversationMessagingMode = "request_pending_outgoing"
	ConversationMessagingModeRequestRejected        ConversationMessagingMode = "request_rejected"
	ConversationMessagingModeRequestRequired        ConversationMessagingMode = "request_required"
	ConversationMessagingModeRestricted             ConversationMessagingMode = "restricted"
)

type VoiceMessageAsset struct {
	ConversationID string    `json:"conversationId"`
	CreatedAt      time.Time `json:"createdAt"`
	DurationSec    int       `json:"durationSec"`
	FileName       string    `json:"fileName"`
	ID             string    `json:"id"`
	MimeType       string    `json:"mimeType"`
	SizeBytes      int64     `json:"sizeBytes"`
	URL            string    `json:"url"`
	Waveform       []float64 `json:"waveform,omitempty"`
}

type PhotoMessageAsset struct {
	MimeType  string `json:"mimeType,omitempty"`
	SizeBytes int64  `json:"sizeBytes,omitempty"`
	Title     string `json:"title,omitempty"`
	URL       string `json:"url,omitempty"`
}

type LocationMessageAsset struct {
	Latitude      *float64 `json:"latitude,omitempty"`
	LocationLabel string   `json:"locationLabel,omitempty"`
	Longitude     *float64 `json:"longitude,omitempty"`
	Title         string   `json:"title,omitempty"`
}

type ConversationSummary struct {
	CanSendMessage        bool                             `json:"canSendMessage"`
	ChatRequestDirection  ConversationChatRequestDirection `json:"chatRequestDirection"`
	ChatRequestStatus     ConversationChatRequestStatus    `json:"chatRequestStatus"`
	ConversationID        string                           `json:"conversationId"`
	IsMessageRequest      bool                             `json:"isMessageRequest"`
	IsMuted               bool                             `json:"isMuted"`
	IsPeerBlockedByViewer bool                             `json:"isPeerBlockedByViewer"`
	IsUnread              bool                             `json:"isUnread"`
	IsViewerBlockedByPeer bool                             `json:"isViewerBlockedByPeer"`
	LastLocationMessage   *LocationMessageAsset            `json:"lastLocationMessage,omitempty"`
	LastMessage           string                           `json:"lastMessage"`
	LastMessageAt         time.Time                        `json:"lastMessageAt"`
	LastMessageKind       MessageContentKind               `json:"lastMessageKind,omitempty"`
	LastMessagePreview    string                           `json:"lastMessagePreview,omitempty"`
	LastPhotoMessage      *PhotoMessageAsset               `json:"lastPhotoMessage,omitempty"`
	LastVoiceMessage      *VoiceMessageAsset               `json:"lastVoiceMessage,omitempty"`
	MessagingHint         string                           `json:"messagingHint,omitempty"`
	MessagingMode         ConversationMessagingMode        `json:"messagingMode"`
	PeerLastReadAt        *time.Time                       `json:"peerLastReadAt,omitempty"`
	PeerLastReadMessageID string                           `json:"peerLastReadMessageId,omitempty"`
	Peer                  ConversationPeer                 `json:"peer"`
	UnreadCount           int64                            `json:"unreadCount"`
}

type ConversationListResponse struct {
	Conversations []ConversationSummary `json:"conversations"`
	HasMore       bool                  `json:"hasMore"`
	NextCursor    string                `json:"nextCursor,omitempty"`
}

type ConversationMessage struct {
	Body            string                `json:"body"`
	ClientNonce     string                `json:"clientNonce,omitempty"`
	ConversationID  string                `json:"conversationId"`
	CreatedAt       time.Time             `json:"createdAt"`
	ID              string                `json:"id"`
	IsMine          bool                  `json:"isMine"`
	Kind            MessageContentKind    `json:"kind,omitempty"`
	LocationMessage *LocationMessageAsset `json:"locationMessage,omitempty"`
	PhotoMessage    *PhotoMessageAsset    `json:"photoMessage,omitempty"`
	Preview         string                `json:"preview,omitempty"`
	SenderID        string                `json:"senderId"`
	VoiceMessage    *VoiceMessageAsset    `json:"voiceMessage,omitempty"`
}

type ConversationMessagesResponse struct {
	ConversationID string                `json:"conversationId"`
	HasMore        bool                  `json:"hasMore"`
	Messages       []ConversationMessage `json:"messages"`
	NextCursor     string                `json:"nextCursor,omitempty"`
}

type ConversationCreateInput struct {
	InitialMessage string `json:"initialMessage"`
	RecipientID    string `json:"recipientId"`
}

type ConversationCreateResponse struct {
	ConversationID string               `json:"conversationId"`
	Conversation   *ConversationSummary `json:"conversation,omitempty"`
	Message        *ConversationMessage `json:"message,omitempty"`
}

type ConversationMessageInput struct {
	ClientNonce string `json:"clientNonce,omitempty"`
	Text        string `json:"text"`
}

type ConversationMessageResponse struct {
	ConversationID string               `json:"conversationId"`
	Conversation   *ConversationSummary `json:"conversation,omitempty"`
	Message        ConversationMessage  `json:"message"`
}

type ConversationReadInput struct {
	MessageID string `json:"messageId,omitempty"`
}

type ConversationReadResponse struct {
	ConversationID    string    `json:"conversationId"`
	LastReadAt        time.Time `json:"lastReadAt"`
	LastReadMessageID string    `json:"lastReadMessageId,omitempty"`
	PeerID            string    `json:"-"`
	UnreadCount       int64     `json:"unreadCount"`
}

type ConversationRequestAcceptResponse struct {
	AcceptedAt     time.Time            `json:"acceptedAt"`
	Conversation   *ConversationSummary `json:"conversation,omitempty"`
	ConversationID string               `json:"conversationId"`
}

type ConversationRequestRejectResponse struct {
	Conversation   *ConversationSummary `json:"conversation,omitempty"`
	ConversationID string               `json:"conversationId"`
	RejectedAt     time.Time            `json:"rejectedAt"`
}

type ConversationMuteResponse struct {
	ConversationID string `json:"conversationId"`
	Muted          bool   `json:"muted"`
}

type ConversationClearResponse struct {
	ClearedAt      time.Time `json:"clearedAt"`
	ConversationID string    `json:"conversationId"`
	UnreadCount    int64     `json:"unreadCount"`
}

type ConversationDeleteMode string

const (
	ConversationDeleteModeHard ConversationDeleteMode = "hard"
	ConversationDeleteModeSelf ConversationDeleteMode = "self"
)

type ConversationDeleteResponse struct {
	ConversationID string                 `json:"conversationId"`
	Deleted        bool                   `json:"deleted"`
	Mode           ConversationDeleteMode `json:"mode,omitempty"`
}

type RealtimeEvent struct {
	Comment               *Comment     `json:"comment,omitempty"`
	CreatorID             string       `json:"creatorId,omitempty"`
	CreatorFollowersCount *int64       `json:"creatorFollowersCount,omitempty"`
	FollowerID            string       `json:"followerId,omitempty"`
	PostID                string       `json:"postId,omitempty"`
	Segment               Segment      `json:"segment,omitempty"`
	ServerTime            time.Time    `json:"serverTime"`
	Stats                 *Stats       `json:"stats,omitempty"`
	Type                  string       `json:"type"`
	ViewerState           *ViewerState `json:"viewerState,omitempty"`
}
