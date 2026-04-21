import type { PostLocationPayload } from '../LocationTypes/LocationTypes';

export type AuthProvider = 'local' | 'google' | 'facebook';
export type UserStatus = 'active' | 'pending_verification' | 'disabled';

export type SessionPayload = {
  expiresAt: string;
  token: string;
};

export type ProfileStats = {
  followersCount: number;
  followingCount: number;
  routesCount: number;
  streetFriendsCount: number;
};

export type PrivacySettings = {
  isMapVisible: boolean;
  isPrivateAccount: boolean;
};

export type MapFilterMode = 'street_friends' | 'all';
export type MapThemeMode = 'dark' | 'light' | 'street';
export type AppLanguage = 'en' | 'tr';
export type ProfileGender =
  | 'male'
  | 'female'
  | 'non_binary'
  | 'prefer_not_to_say';

export type MapPreferences = {
  mapFilterMode: MapFilterMode;
  mapThemeMode: MapThemeMode;
  showLocalLayer: boolean;
  showRemoteLayer: boolean;
  trackingEnabled: boolean;
  updatedAt: string;
};

export type ProfilePostVisibility = 'friends' | 'private' | 'public';

export type ProfileAppSettings = {
  gender: ProfileGender;
  language: AppLanguage;
  notifyFollowRequests: boolean;
  notifyMessages: boolean;
  notifyPostLikes: boolean;
  onlyFollowedUsersCanMessage: boolean;
  updatedAt: string;
};

export type ProfileRequestSummary = {
  followRequestsCount: number;
  messagesUnreadCount?: number;
  notificationsUnreadCount?: number;
  streetRequestsCount: number;
  totalCount: number;
  updatedAt: string;
};

export type UserProfile = {
  authProvider: AuthProvider;
  avatarUrl: string;
  bio: string;
  birthYear: number;
  city: string;
  createdAt: string;
  email: string;
  favoriteCar: string;
  fullName: string;
  hasPassword: boolean;
  heroTagline: string;
  id: string;
  /** Ulke kodu olmadan ulusal numara (rakamlar). Bos = kayit yok. */
  phone?: string;
  /** Ulke kodu, + olmadan (orn. 90, 1, 44). */
  phoneDialCode?: string;
  isEmailVerified: boolean;
  isVerified: boolean;
  lastLoginAt: string;
  privacy?: PrivacySettings;
  stats: ProfileStats;
  status: UserStatus;
  username: string;
};

export type AuthResponse = {
  profile: UserProfile;
  session: SessionPayload;
};

export type VerificationChallengeResponse = {
  debugCode?: string;
  email: string;
  expiresAt: string;
  message: string;
  resendAvailableAt: string;
  status: UserStatus;
};

export type PasswordResetChallengeResponse = {
  delivery: 'email' | 'debug';
  debugCode?: string;
  email: string;
  expiresAt: string;
  message: string;
  resendAvailableAt: string;
};

export type PasswordOperationResponse = {
  message: string;
};

export type DeleteAccountResponse = {
  deleted: boolean;
  message: string;
  userId: string;
};

export type DeleteAccountConfirmPayload = {
  code: string;
};

export type VerifyEmailStatus =
  | 'verified'
  | 'expired'
  | 'already_used'
  | 'already_verified'
  | 'invalid';

export type VerifyEmailResponse = {
  auth?: AuthResponse;
  email: string;
  message: string;
  status: VerifyEmailStatus;
  verifiedAt?: string;
};

export type VerifyEmailConfirmPayload = {
  code: string;
  email: string;
};

export type AppOverview = {
  activePostsCount: number;
  membersCount: number;
  routesCount: number;
};

export type AppBootstrap = {
  implementation: string;
  serverTime: string;
  service: string;
  status: 'ok';
  version: string;
};

export type ProfileHelpItem = {
  description: string;
  title: string;
};

export type ProfileHelpResponse = {
  items: ProfileHelpItem[];
  supportEmail: string;
  supportHours: string;
  updatedAt: string;
};

export type RegisterPayload = {
  city: string;
  email: string;
  favoriteCar: string;
  fullName: string;
  password: string;
  username: string;
};

export type LoginPayload = {
  email: string;
  identifier?: string;
  password: string;
};

export type UsernameAvailabilityResponse = {
  available: boolean;
};

export type ResendVerificationPayload = {
  email: string;
};

export type PasswordResetRequestPayload = {
  email: string;
};

export type PasswordResetConfirmPayload = {
  code: string;
  email: string;
  newPassword: string;
};

export type SocialLoginPayload = {
  avatarUrl?: string;
  city?: string;
  email?: string;
  fullName?: string;
  googleIdToken?: string;
  provider: Extract<AuthProvider, 'google' | 'facebook'>;
  username?: string;
};

export type UpdateProfilePayload = {
  avatarUrl?: string;
  bio?: string;
  birthYear?: number;
  city?: string;
  email?: string;
  favoriteCar?: string;
  fullName?: string;
  heroTagline?: string;
  phone?: string;
  phoneDialCode?: string;
  username?: string;
};

export type CreateProfilePostPayload = {
  caption: string;
  location?: string;
  locationPayload?: PostLocationPayload;
  mediaType: 'photo' | 'video';
  mediaUrl: string;
  thumbnailUrl?: string;
  visibility?: ProfilePostVisibility;
};

export type UpdateProfilePostPayload = {
  caption?: string;
  location?: string;
  locationPayload?: PostLocationPayload;
  visibility?: ProfilePostVisibility;
};

export type ProfilePostMediaUploadAsset = {
  id: string;
  mediaType: 'photo' | 'video';
  mediaUrl: string;
  mimeType: string;
  sizeBytes: number;
  thumbnailUrl?: string;
  uploadedAt: string;
};

export type ProfilePostMediaUploadResponse = {
  asset: ProfilePostMediaUploadAsset;
};

export type DeleteProfilePostMode = 'hard' | 'soft';

export type DeleteProfilePostResponse = {
  deleted: boolean;
  mode: DeleteProfilePostMode;
  postId: string;
};

export type UpdatePrivacySettingsPayload = {
  isMapVisible?: boolean;
  isPrivateAccount?: boolean;
};

export type UpdateMapPreferencesPayload = {
  mapFilterMode?: MapFilterMode;
  mapThemeMode?: MapThemeMode;
  showLocalLayer?: boolean;
  showRemoteLayer?: boolean;
  trackingEnabled?: boolean;
};

export type UpdateProfileAppSettingsPayload = {
  gender?: ProfileGender;
  language?: AppLanguage;
  notifyFollowRequests?: boolean;
  notifyMessages?: boolean;
  notifyPostLikes?: boolean;
  onlyFollowedUsersCanMessage?: boolean;
};

export type FollowRequestItem = {
  avatarUrl: string;
  fullName: string;
  id: string;
  isVerified: boolean;
  requestedAt: string;
  username: string;
};

export type FollowRequestListResponse = {
  requests: FollowRequestItem[];
};

export type FollowRequestDecisionResponse = {
  accepted: boolean;
  requesterId: string;
};

export type BlockedUserItem = {
  avatarUrl: string;
  blockedAt: string;
  fullName: string;
  id: string;
  isVerified: boolean;
  username: string;
};

export type BlockedUserListResponse = {
  users: BlockedUserItem[];
};

export type BlockedUserOperationResponse = {
  blocked: boolean;
  blockedUserId: string;
};

export type UserReportResponse = {
  reason: string;
  reportedAt: string;
  reportedUserId: string;
};

export type PublicProfileViewerState = {
  followRequestStatus: 'none' | 'pending_incoming' | 'pending_outgoing';
  followsYou: boolean;
  isBlockedByTarget: boolean;
  isBlockedByViewer: boolean;
  isFollowing: boolean;
  isStreetFriend?: boolean;
  streetFriendStatus?:
    | 'accepted'
    | 'none'
    | 'pending_incoming'
    | 'pending_outgoing';
};

export type PublicProfilePostViewerState = {
  followRequestStatus?: 'none' | 'pending_incoming' | 'pending_outgoing';
  isBookmarked: boolean;
  isFollowing?: boolean;
  isLiked: boolean;
  isStreetFriend?: boolean;
  streetFriendStatus?:
    | 'accepted'
    | 'none'
    | 'pending_incoming'
    | 'pending_outgoing';
};

export type PublicUserProfile = {
  avatarUrl: string;
  bio: string;
  birthYear: number;
  fullName: string;
  id: string;
  isPrivateAccount: boolean;
  isVerified: boolean;
  stats: ProfileStats;
  username: string;
  viewerState: PublicProfileViewerState;
};

export type PublicProfilePostItem = {
  caption: string;
  createdAt: string;
  id: string;
  isLive: boolean;
  isUnavailable?: boolean;
  location: string;
  mediaType: 'photo' | 'video' | string;
  mediaUrl: string;
  thumbnailUrl?: string;
  updatedAt?: string;
  visibility?: ProfilePostVisibility | string;
  stats: {
    bookmarksCount: number;
    commentsCount: number;
    likesCount: number;
    sharesCount: number;
  };
  unavailableReason?: string;
  userId: string;
  username: string;
  viewerState?: PublicProfilePostViewerState;
};

export type PublicProfilePostsResponse = {
  hasMore: boolean;
  nextCursor?: string;
  posts: PublicProfilePostItem[];
  userId: string;
};

export type ChangePasswordPayload = {
  currentPassword: string;
  newPassword: string;
};
