package account

import "time"

type UserStatus string

const (
	UserStatusActive              UserStatus = "active"
	UserStatusDisabled            UserStatus = "disabled"
	UserStatusPendingVerification UserStatus = "pending_verification"
)

type VerifyEmailStatus string

const (
	VerifyEmailStatusAlreadyUsed     VerifyEmailStatus = "already_used"
	VerifyEmailStatusAlreadyVerified VerifyEmailStatus = "already_verified"
	VerifyEmailStatusExpired         VerifyEmailStatus = "expired"
	VerifyEmailStatusInvalid         VerifyEmailStatus = "invalid"
	VerifyEmailStatusVerified        VerifyEmailStatus = "verified"
)

type Session struct {
	ExpiresAt time.Time `json:"expiresAt"`
	Token     string    `json:"token"`
}

type ProfileStats struct {
	FollowersCount     int64 `json:"followersCount"`
	FollowingCount     int64 `json:"followingCount"`
	RoutesCount        int64 `json:"routesCount"`
	StreetFriendsCount int64 `json:"streetFriendsCount"`
}

type PrivacySettings struct {
	IsMapVisible     bool `json:"isMapVisible"`
	IsPrivateAccount bool `json:"isPrivateAccount"`
}

type MapFilterMode string

const (
	MapFilterModeAll           MapFilterMode = "all"
	MapFilterModeStreetFriends MapFilterMode = "street_friends"
)

type MapThemeMode string

const (
	MapThemeModeDark   MapThemeMode = "dark"
	MapThemeModeLight  MapThemeMode = "light"
	MapThemeModeStreet MapThemeMode = "street"
)

func NormalizeMapFilterMode(value MapFilterMode) MapFilterMode {
	switch value {
	case MapFilterModeAll:
		return MapFilterModeAll
	case MapFilterModeStreetFriends:
		return MapFilterModeStreetFriends
	default:
		return MapFilterModeAll
	}
}

func NormalizeMapThemeMode(value MapThemeMode) MapThemeMode {
	switch value {
	case MapThemeModeLight:
		return MapThemeModeLight
	case MapThemeModeStreet:
		return MapThemeModeStreet
	case MapThemeModeDark:
		fallthrough
	default:
		return MapThemeModeDark
	}
}

type MapPreferences struct {
	MapFilterMode   MapFilterMode `json:"mapFilterMode"`
	MapThemeMode    MapThemeMode  `json:"mapThemeMode"`
	ShowLocalLayer  bool          `json:"showLocalLayer"`
	ShowRemoteLayer bool          `json:"showRemoteLayer"`
	TrackingEnabled bool          `json:"trackingEnabled"`
	UpdatedAt       time.Time     `json:"updatedAt"`
}

type AppLanguage string

const (
	AppLanguageEnglish AppLanguage = "en"
	AppLanguageTurkish AppLanguage = "tr"
)

func NormalizeAppLanguage(value AppLanguage) AppLanguage {
	switch value {
	case AppLanguageEnglish:
		return AppLanguageEnglish
	case AppLanguageTurkish:
		fallthrough
	default:
		return AppLanguageTurkish
	}
}

type ProfileGender string

const (
	ProfileGenderFemale         ProfileGender = "female"
	ProfileGenderMale           ProfileGender = "male"
	ProfileGenderNonBinary      ProfileGender = "non_binary"
	ProfileGenderPreferNotToSay ProfileGender = "prefer_not_to_say"
)

func NormalizeProfileGender(value ProfileGender) ProfileGender {
	switch value {
	case ProfileGenderFemale:
		return ProfileGenderFemale
	case ProfileGenderMale:
		return ProfileGenderMale
	case ProfileGenderNonBinary:
		return ProfileGenderNonBinary
	case ProfileGenderPreferNotToSay:
		fallthrough
	default:
		return ProfileGenderPreferNotToSay
	}
}

type ProfileAppSettings struct {
	Gender                      ProfileGender `json:"gender"`
	Language                    AppLanguage   `json:"language"`
	NotifyFollowRequests        bool          `json:"notifyFollowRequests"`
	NotifyMessages              bool          `json:"notifyMessages"`
	NotifyPostLikes             bool          `json:"notifyPostLikes"`
	OnlyFollowedUsersCanMessage bool          `json:"onlyFollowedUsersCanMessage"`
	UpdatedAt                   time.Time     `json:"updatedAt"`
}

type ProfileRequestSummary struct {
	FollowRequestsCount      int64     `json:"followRequestsCount"`
	MessagesUnreadCount      int64     `json:"messagesUnreadCount"`
	NotificationsUnreadCount int64     `json:"notificationsUnreadCount"`
	StreetRequestsCount      int64     `json:"streetRequestsCount"`
	TotalCount               int64     `json:"totalCount"`
	UpdatedAt                time.Time `json:"updatedAt"`
}

type ProfileNotificationItem struct {
	ActorAvatarURL *string        `json:"actorAvatarUrl,omitempty"`
	ActorFullName  *string        `json:"actorFullName,omitempty"`
	ActorID        *string        `json:"actorId,omitempty"`
	ActorUsername  *string        `json:"actorUsername,omitempty"`
	Body           string         `json:"body"`
	Channel        string         `json:"channel"`
	ConversationID string         `json:"conversationId,omitempty"`
	CreatedAt      time.Time      `json:"createdAt"`
	FromUserID     string         `json:"fromUserId,omitempty"`
	ID             string         `json:"id"`
	IsRead         bool           `json:"isRead"`
	MessageID      string         `json:"messageId,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	PostID         string         `json:"postId,omitempty"`
	RecipientID    string         `json:"recipientId,omitempty"`
	Title          string         `json:"title"`
	Type           string         `json:"type"`
	UpdatedAt      *time.Time     `json:"updatedAt,omitempty"`
}

type ProfileNotificationsResponse struct {
	Category      string                    `json:"category,omitempty"`
	Cursor        string                    `json:"cursor,omitempty"`
	Notifications []ProfileNotificationItem `json:"notifications"`
	HasMore       bool                      `json:"hasMore"`
	NextCursor    string                    `json:"nextCursor,omitempty"`
	Total         int                       `json:"total"`
	TotalCount    int                       `json:"totalCount"`
	UnreadCount   int                       `json:"unreadCount"`
	UpdatedAt     time.Time                 `json:"updatedAt"`
}

type MarkNotificationsReadResponse struct {
	ReadAt       time.Time `json:"readAt"`
	UnreadCount  int       `json:"unreadCount"`
	UpdatedCount int       `json:"updatedCount"`
	UserID       string    `json:"userId"`
}

type UsernameAvailabilityResponse struct {
	Available bool `json:"available"`
}

type MarkNotificationsReadInput struct {
	All      bool     `json:"all,omitempty"`
	Category string   `json:"category,omitempty"`
	IDs      []string `json:"ids,omitempty"`
}

type FollowRequestStatus string

const (
	FollowRequestStatusNone            FollowRequestStatus = "none"
	FollowRequestStatusPendingIncoming FollowRequestStatus = "pending_incoming"
	FollowRequestStatusPendingOutgoing FollowRequestStatus = "pending_outgoing"
)

type Profile struct {
	AuthProvider    string          `json:"authProvider"`
	AvatarURL       string          `json:"avatarUrl"`
	Bio             string          `json:"bio"`
	BirthYear       int             `json:"birthYear"`
	City            string          `json:"city"`
	CreatedAt       time.Time       `json:"createdAt"`
	Email           string          `json:"email"`
	FavoriteCar     string          `json:"favoriteCar"`
	FullName        string          `json:"fullName"`
	HasPassword     bool            `json:"hasPassword"`
	HeroTagline     string          `json:"heroTagline"`
	ID              string          `json:"id"`
	Phone           string          `json:"phone"`
	PhoneDialCode   string          `json:"phoneDialCode"`
	IsEmailVerified bool            `json:"isEmailVerified"`
	IsVerified      bool            `json:"isVerified"`
	LastLoginAt     time.Time       `json:"lastLoginAt"`
	Privacy         PrivacySettings `json:"privacy"`
	Stats           ProfileStats    `json:"stats"`
	Status          UserStatus      `json:"status"`
	Username        string          `json:"username"`
}

type PublicProfileViewerState struct {
	FollowRequestStatus FollowRequestStatus `json:"followRequestStatus"`
	FollowsYou          bool                `json:"followsYou"`
	IsBlockedByTarget   bool                `json:"isBlockedByTarget"`
	IsBlockedByViewer   bool                `json:"isBlockedByViewer"`
	IsFollowing         bool                `json:"isFollowing"`
}

type PublicProfile struct {
	AvatarURL        string                   `json:"avatarUrl"`
	Bio              string                   `json:"bio"`
	BirthYear        int                      `json:"birthYear"`
	FullName         string                   `json:"fullName"`
	ID               string                   `json:"id"`
	IsPrivateAccount bool                     `json:"isPrivateAccount"`
	IsVerified       bool                     `json:"isVerified"`
	Stats            ProfileStats             `json:"stats"`
	Username         string                   `json:"username"`
	ViewerState      PublicProfileViewerState `json:"viewerState"`
}

type AuthResponse struct {
	Profile Profile `json:"profile"`
	Session Session `json:"session"`
}

type VerificationChallengeResponse struct {
	DebugCode         string     `json:"debugCode,omitempty"`
	Email             string     `json:"email"`
	ExpiresAt         time.Time  `json:"expiresAt"`
	Message           string     `json:"message"`
	ResendAvailableAt time.Time  `json:"resendAvailableAt"`
	Status            UserStatus `json:"status"`
}

type PasswordResetChallengeResponse struct {
	Delivery          string    `json:"delivery"`
	DebugCode         string    `json:"debugCode,omitempty"`
	Email             string    `json:"email"`
	ExpiresAt         time.Time `json:"expiresAt"`
	Message           string    `json:"message"`
	ResendAvailableAt time.Time `json:"resendAvailableAt"`
}

type PasswordOperationResponse struct {
	Message string `json:"message"`
}

type DeleteAccountResponse struct {
	Deleted bool   `json:"deleted"`
	Message string `json:"message"`
	UserID  string `json:"userId"`
}

type VerifyEmailResult struct {
	Auth       *AuthResponse     `json:"auth,omitempty"`
	Email      string            `json:"email"`
	Message    string            `json:"message"`
	Status     VerifyEmailStatus `json:"status"`
	VerifiedAt *time.Time        `json:"verifiedAt,omitempty"`
}

type DevelopmentResetResult struct {
	ClearedComments           int64 `json:"clearedComments"`
	ClearedBlockedUsers       int64 `json:"clearedBlockedUsers"`
	ClearedFollows            int64 `json:"clearedFollows"`
	ClearedFollowRequests     int64 `json:"clearedFollowRequests"`
	ClearedLoginAttempts      int64 `json:"clearedLoginAttempts"`
	ClearedPasswordResets     int64 `json:"clearedPasswordResets"`
	ClearedPostEngagements    int64 `json:"clearedPostEngagements"`
	ClearedPosts              int64 `json:"clearedPosts"`
	ClearedSessions           int64 `json:"clearedSessions"`
	ClearedStreetFriendships  int64 `json:"clearedStreetFriendships"`
	ClearedVerificationTokens int64 `json:"clearedVerificationTokens"`
	DeletedUsers              int64 `json:"deletedUsers"`
}

type RegisterInput struct {
	City        string `json:"city"`
	Email       string `json:"email"`
	FavoriteCar string `json:"favoriteCar"`
	FullName    string `json:"fullName"`
	Password    string `json:"password"`
	Username    string `json:"username"`
}

type LoginInput struct {
	Email      string `json:"email"`
	Identifier string `json:"identifier,omitempty"`
	Password   string `json:"password"`
}

type ResendVerificationInput struct {
	Email string `json:"email"`
}

type VerifyEmailConfirmInput struct {
	Code  string `json:"code"`
	Email string `json:"email"`
}

type PasswordResetRequestInput struct {
	Email string `json:"email"`
}

type PasswordResetConfirmInput struct {
	Code        string `json:"code"`
	Email       string `json:"email"`
	NewPassword string `json:"newPassword"`
}

type PasswordChangeInput struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

type SocialLoginInput struct {
	AvatarURL string `json:"avatarUrl"`
	City      string `json:"city"`
	Email     string `json:"email"`
	FullName  string `json:"fullName"`
	GoogleIDToken string `json:"googleIdToken"`
	Provider  string `json:"provider"`
	Username  string `json:"username"`
}

type UpdateProfileInput struct {
	AvatarURL   *string `json:"avatarUrl,omitempty"`
	Bio         *string `json:"bio,omitempty"`
	BirthYear   *int    `json:"birthYear,omitempty"`
	City        *string `json:"city,omitempty"`
	Email       *string `json:"email,omitempty"`
	FavoriteCar *string `json:"favoriteCar,omitempty"`
	FullName    *string `json:"fullName,omitempty"`
	HeroTagline *string `json:"heroTagline,omitempty"`
	Username     *string `json:"username,omitempty"`
	Phone         *string `json:"phone,omitempty"`
	PhoneDialCode *string `json:"phoneDialCode,omitempty"`
}

type UpdatePrivacySettingsInput struct {
	IsMapVisible     *bool `json:"isMapVisible,omitempty"`
	IsPrivateAccount *bool `json:"isPrivateAccount,omitempty"`
}

type UpdateMapPreferencesInput struct {
	MapFilterMode   *MapFilterMode `json:"mapFilterMode,omitempty"`
	MapThemeMode    *MapThemeMode  `json:"mapThemeMode,omitempty"`
	ShowLocalLayer  *bool          `json:"showLocalLayer,omitempty"`
	ShowRemoteLayer *bool          `json:"showRemoteLayer,omitempty"`
	TrackingEnabled *bool          `json:"trackingEnabled,omitempty"`
}

type UpdateProfileAppSettingsInput struct {
	Gender                      *ProfileGender `json:"gender,omitempty"`
	Language                    *AppLanguage   `json:"language,omitempty"`
	NotifyFollowRequests        *bool          `json:"notifyFollowRequests,omitempty"`
	NotifyMessages              *bool          `json:"notifyMessages,omitempty"`
	NotifyPostLikes             *bool          `json:"notifyPostLikes,omitempty"`
	OnlyFollowedUsersCanMessage *bool          `json:"onlyFollowedUsersCanMessage,omitempty"`
}

type FollowRequestItem struct {
	AvatarURL   string    `json:"avatarUrl"`
	FullName    string    `json:"fullName"`
	ID          string    `json:"id"`
	IsVerified  bool      `json:"isVerified"`
	RequestedAt time.Time `json:"requestedAt"`
	Username    string    `json:"username"`
}

type FollowRequestListResponse struct {
	Requests []FollowRequestItem `json:"requests"`
}

type FollowRequestDecisionResponse struct {
	Accepted    bool   `json:"accepted"`
	RequesterID string `json:"requesterId"`
}

type BlockedUserItem struct {
	AvatarURL  string    `json:"avatarUrl"`
	BlockedAt  time.Time `json:"blockedAt"`
	FullName   string    `json:"fullName"`
	ID         string    `json:"id"`
	IsVerified bool      `json:"isVerified"`
	Username   string    `json:"username"`
}

type BlockedUserListResponse struct {
	Users []BlockedUserItem `json:"users"`
}

type BlockedUserOperationResponse struct {
	Blocked       bool   `json:"blocked"`
	BlockedUserID string `json:"blockedUserId"`
}

type UserReportInput struct {
	Reason string `json:"reason"`
}

type UserReportResponse struct {
	Reason          string    `json:"reason"`
	ReportedAt      time.Time `json:"reportedAt"`
	ReportedUserID string    `json:"reportedUserId"`
}

type SessionIdentity struct {
	ExpiresAt time.Time
	Provider  string
	SessionID string
	UserID    string
}

type RequestMetadata struct {
	IPAddress string
}

type Overview struct {
	ActivePostsCount int64 `json:"activePostsCount"`
	MembersCount     int64 `json:"membersCount"`
	RoutesCount      int64 `json:"routesCount"`
}
