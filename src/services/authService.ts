import { apiRequest, isApiRequestError, setApiSessionToken } from './apiClient';
import {
  invalidateFollowersCache,
  resetExploreServiceCaches,
} from './exploreService';
import { isLocalMediaUri, resolveProtectedMediaUrl } from './protectedMedia';
import {
  clearStoredProfileCache,
  clearStoredSessionToken,
  storeProfileCache,
  storeSessionToken,
} from './sessionStorage';
import type {
  AppOverview,
  AppBootstrap,
  AuthResponse,
  BlockedUserListResponse,
  BlockedUserOperationResponse,
  ChangePasswordPayload,
  CreateProfilePostPayload,
  DeleteProfilePostResponse,
  DeleteAccountResponse,
  DeleteAccountConfirmPayload,
  FollowRequestDecisionResponse,
  FollowRequestListResponse,
  LoginPayload,
  MapPreferences,
  ProfileAppSettings,
  ProfileRequestSummary,
  PasswordOperationResponse,
  PasswordResetChallengeResponse,
  PasswordResetConfirmPayload,
  PasswordResetRequestPayload,
  ProfilePostMediaUploadResponse,
  ProfileHelpResponse,
  PublicUserProfile,
  PublicProfilePostItem,
  PublicProfilePostsResponse,
  RegisterPayload,
  ResendVerificationPayload,
  UpdateProfilePostPayload,
  SocialLoginPayload,
  PrivacySettings,
  UpdateMapPreferencesPayload,
  UpdateProfileAppSettingsPayload,
  UpdatePrivacySettingsPayload,
  UpdateProfilePayload,
  UsernameAvailabilityResponse,
  UserProfile,
  UserReportResponse,
  VerificationChallengeResponse,
  VerifyEmailConfirmPayload,
  VerifyEmailResponse,
} from '../types/AuthTypes/AuthTypes';

const FOLLOW_REQUESTS_CACHE_TTL_MS = 2_000;
const PROFILE_APP_SETTINGS_CACHE_TTL_MS = 30_000;
const PROFILE_REQUEST_SUMMARY_CACHE_TTL_MS = 1_000;
const DEFAULT_MAP_PREFERENCES: MapPreferences = {
  mapFilterMode: 'street_friends',
  mapThemeMode: 'dark',
  showLocalLayer: true,
  showRemoteLayer: true,
  trackingEnabled: false,
  updatedAt: new Date().toISOString(),
};
const DEFAULT_PROFILE_APP_SETTINGS: ProfileAppSettings = {
  gender: 'prefer_not_to_say',
  language: 'tr',
  notifyFollowRequests: true,
  notifyMessages: true,
  notifyPostLikes: true,
  onlyFollowedUsersCanMessage: false,
  updatedAt: new Date().toISOString(),
};

type FollowRequestsCacheEntry = {
  cachedAt: number;
  data: FollowRequestListResponse;
};

type FollowRequestFetchOptions = {
  force?: boolean;
  signal?: AbortSignal;
};

type ProfileAppSettingsCacheEntry = {
  cachedAt: number;
  data: ProfileAppSettings;
};

type ProfileAppSettingsFetchOptions = {
  force?: boolean;
};

type ProfileRequestSummaryCacheEntry = {
  cachedAt: number;
  data: ProfileRequestSummary;
};

type ProfileRequestSummaryFetchOptions = {
  force?: boolean;
};

type LogoutUserOptions = {
  preserveLocalSession?: boolean;
  tokenOverride?: string;
};

let followRequestsCache: FollowRequestsCacheEntry | null = null;
let followRequestsInFlight: Promise<FollowRequestListResponse> | null = null;
let profileAppSettingsCache: ProfileAppSettingsCacheEntry | null = null;
let profileAppSettingsInFlight: Promise<ProfileAppSettings> | null = null;
let profileRequestSummaryCache: ProfileRequestSummaryCacheEntry | null = null;
let profileRequestSummaryInFlight: Promise<ProfileRequestSummary> | null = null;
let launchBootstrapCache:
  | { cachedAt: number; data: AppBootstrap }
  | null = null;
let launchBootstrapInFlight: Promise<AppBootstrap | null> | null = null;
const LAUNCH_BOOTSTRAP_CACHE_TTL_MS = 15_000;

function normalizeProfilePostItem(
  item: PublicProfilePostItem,
  fallbackIndex?: number,
): PublicProfilePostItem {
  const rawItem = item as PublicProfilePostItem & { postId?: unknown };
  const normalizedId =
    (typeof item.id === 'string' ? item.id.trim() : '') ||
    (typeof rawItem.postId === 'string' ? rawItem.postId.trim() : '');
  const normalizedMediaUrl = resolveProtectedMediaUrl(item.mediaUrl);
  const derivedIdSeed = [
    normalizedMediaUrl,
    typeof item.createdAt === 'string' ? item.createdAt.trim() : '',
    typeof item.updatedAt === 'string' ? item.updatedAt.trim() : '',
    typeof item.userId === 'string' ? item.userId.trim() : '',
  ]
    .filter(Boolean)
    .join('|');
  const derivedId =
    derivedIdSeed.length > 0
      ? `derived:${derivedIdSeed}`
      : `derived:idx:${Number.isFinite(fallbackIndex) ? String(fallbackIndex) : '0'}`;

  return {
    ...item,
    id: normalizedId.length > 0 ? normalizedId : derivedId,
    mediaUrl: normalizedMediaUrl,
    thumbnailUrl:
      typeof item.thumbnailUrl === 'string'
        ? resolveProtectedMediaUrl(item.thumbnailUrl)
        : undefined,
    visibility:
      item.visibility === 'friends' ||
      item.visibility === 'private' ||
      item.visibility === 'public'
        ? item.visibility
        : 'public',
  };
}

function normalizeUserProfile(profile: UserProfile): UserProfile {
  const rawPhone =
    typeof profile.phone === 'string' ? profile.phone.replace(/\D/g, '') : '';
  const rawDial =
    typeof profile.phoneDialCode === 'string'
      ? profile.phoneDialCode.replace(/\D/g, '').slice(0, 4)
      : '';
  const phoneDialCode = rawDial.length > 0 ? rawDial : '90';
  const phone = rawPhone.length > 0 ? rawPhone.slice(0, 14) : '';
  return {
    ...profile,
    avatarUrl: resolveProtectedMediaUrl(profile.avatarUrl),
    phone,
    phoneDialCode,
  };
}

function normalizePublicUserProfile(profile: PublicUserProfile): PublicUserProfile {
  return {
    ...profile,
    avatarUrl: resolveProtectedMediaUrl(profile.avatarUrl),
  };
}

function normalizeFollowRequestResponse(
  response: FollowRequestListResponse,
): FollowRequestListResponse {
  return {
    ...response,
    requests: response.requests.map(request => ({
      ...request,
      avatarUrl: resolveProtectedMediaUrl(request.avatarUrl),
    })),
  };
}

function normalizeBlockedUsersResponse(
  response: BlockedUserListResponse,
): BlockedUserListResponse {
  return {
    ...response,
    users: response.users.map(user => ({
      ...user,
      avatarUrl: resolveProtectedMediaUrl(user.avatarUrl),
    })),
  };
}

function normalizeProfilePostsResponse(response: PublicProfilePostsResponse) {
  const seenIds = new Map<string, number>();
  return {
    ...response,
    posts: response.posts.map((item, index) => {
      const normalized = normalizeProfilePostItem(item, index);
      const baseId = normalized.id;
      const duplicateCount = seenIds.get(baseId) ?? 0;
      seenIds.set(baseId, duplicateCount + 1);
      if (duplicateCount === 0) {
        return normalized;
      }
      return {
        ...normalized,
        id: `${baseId}#${duplicateCount + 1}`,
      };
    }),
  };
}

function cacheFollowRequests(data: FollowRequestListResponse) {
  followRequestsCache = {
    cachedAt: Date.now(),
    data: {
      requests: [...data.requests],
    },
  };
}

function dropFollowRequestFromCache(requesterId: string) {
  if (!followRequestsCache) {
    return;
  }

  const nextRequests = followRequestsCache.data.requests.filter(
    request => request.id !== requesterId,
  );
  followRequestsCache = {
    cachedAt: Date.now(),
    data: {
      requests: nextRequests,
    },
  };
}

function invalidateFollowRequestsCache() {
  followRequestsCache = null;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeMapFilterMode(
  value: unknown,
): MapPreferences['mapFilterMode'] {
  return value === 'street_friends' || value === 'all'
    ? value
    : DEFAULT_MAP_PREFERENCES.mapFilterMode;
}

function normalizeMapThemeMode(value: unknown): MapPreferences['mapThemeMode'] {
  return value === 'dark' || value === 'light' || value === 'street'
    ? value
    : DEFAULT_MAP_PREFERENCES.mapThemeMode;
}

function normalizeLanguage(value: unknown): ProfileAppSettings['language'] {
  return value === 'en' || value === 'tr'
    ? value
    : DEFAULT_PROFILE_APP_SETTINGS.language;
}

function normalizeProfileGender(value: unknown): ProfileAppSettings['gender'] {
  return value === 'male' ||
    value === 'female' ||
    value === 'non_binary' ||
    value === 'prefer_not_to_say'
    ? value
    : DEFAULT_PROFILE_APP_SETTINGS.gender;
}

function normalizeMapPreferences(value: unknown): MapPreferences {
  const raw = (value ?? {}) as Partial<MapPreferences>;

  return {
    mapFilterMode: normalizeMapFilterMode(raw.mapFilterMode),
    mapThemeMode: normalizeMapThemeMode(raw.mapThemeMode),
    showLocalLayer: parseBoolean(
      raw.showLocalLayer,
      DEFAULT_MAP_PREFERENCES.showLocalLayer,
    ),
    showRemoteLayer: parseBoolean(
      raw.showRemoteLayer,
      DEFAULT_MAP_PREFERENCES.showRemoteLayer,
    ),
    trackingEnabled: parseBoolean(
      raw.trackingEnabled,
      DEFAULT_MAP_PREFERENCES.trackingEnabled,
    ),
    updatedAt:
      typeof raw.updatedAt === 'string'
        ? raw.updatedAt
        : DEFAULT_MAP_PREFERENCES.updatedAt,
  };
}

function normalizeProfileAppSettings(value: unknown): ProfileAppSettings {
  const raw = (value ?? {}) as Partial<ProfileAppSettings>;

  return {
    gender: normalizeProfileGender(raw.gender),
    language: normalizeLanguage(raw.language),
    notifyFollowRequests: parseBoolean(
      raw.notifyFollowRequests,
      DEFAULT_PROFILE_APP_SETTINGS.notifyFollowRequests,
    ),
    notifyMessages: parseBoolean(
      raw.notifyMessages,
      DEFAULT_PROFILE_APP_SETTINGS.notifyMessages,
    ),
    notifyPostLikes: parseBoolean(
      raw.notifyPostLikes,
      DEFAULT_PROFILE_APP_SETTINGS.notifyPostLikes,
    ),
    onlyFollowedUsersCanMessage: parseBoolean(
      raw.onlyFollowedUsersCanMessage,
      DEFAULT_PROFILE_APP_SETTINGS.onlyFollowedUsersCanMessage,
    ),
    updatedAt:
      typeof raw.updatedAt === 'string'
        ? raw.updatedAt
        : DEFAULT_PROFILE_APP_SETTINGS.updatedAt,
  };
}

function cacheProfileAppSettings(data: ProfileAppSettings) {
  profileAppSettingsCache = {
    cachedAt: Date.now(),
    data: {
      ...data,
    },
  };
}

function invalidateProfileAppSettingsCache() {
  profileAppSettingsCache = null;
  profileAppSettingsInFlight = null;
}

function cacheProfileRequestSummary(data: ProfileRequestSummary) {
  profileRequestSummaryCache = {
    cachedAt: Date.now(),
    data: {
      ...data,
    },
  };
}

function invalidateProfileRequestSummaryCache() {
  profileRequestSummaryCache = null;
  profileRequestSummaryInFlight = null;
}

async function applySession(response: AuthResponse) {
  const normalizedProfile = normalizeUserProfile(response.profile);
  invalidateFollowRequestsCache();
  invalidateProfileAppSettingsCache();
  invalidateProfileRequestSummaryCache();
  resetExploreServiceCaches();
  setApiSessionToken(response.session.token);
  await storeSessionToken(response.session.token);
  await storeProfileCache(normalizedProfile);
  return {
    ...response,
    profile: normalizedProfile,
  };
}

export async function fetchAppOverview() {
  return apiRequest<AppOverview>('/api/v1/app/overview');
}

export async function warmLaunchBootstrap(options?: { force?: boolean }) {
  if (!options?.force && launchBootstrapCache) {
    const ageMs = Date.now() - launchBootstrapCache.cachedAt;
    if (ageMs < LAUNCH_BOOTSTRAP_CACHE_TTL_MS) {
      return launchBootstrapCache.data;
    }
  }

  if (launchBootstrapInFlight) {
    return launchBootstrapInFlight;
  }

  launchBootstrapInFlight = apiRequest<AppBootstrap>('/api/v1/app/bootstrap')
    .then(response => {
      launchBootstrapCache = {
        cachedAt: Date.now(),
        data: response,
      };
      return response;
    })
    .catch(() => null)
    .finally(() => {
      launchBootstrapInFlight = null;
    });

  return launchBootstrapInFlight;
}

export async function fetchProfileHelp() {
  return apiRequest<ProfileHelpResponse>('/api/v1/profile/help');
}

export type ProfileNotificationItem = {
  actorAvatarUrl?: string;
  actorFullName?: string;
  actorId?: string;
  actorUsername?: string;
  body: string;
  channel: string;
  commentId?: string;
  conversationId?: string;
  createdAt: string;
  fromUserId?: string;
  id: string;
  isRead?: boolean;
  messageId?: string;
  metadata?: Record<string, unknown>;
  postId?: string;
  title: string;
  type: string;
  updatedAt?: string;
  userId?: string;
};

export type ProfileNotificationCategory = 'all' | 'messages' | 'requests' | 'social';

export type ProfileNotificationsResponse = {
  category?: ProfileNotificationCategory;
  cursor?: string;
  hasMore: boolean;
  nextCursor?: string;
  notifications: ProfileNotificationItem[];
  total: number;
  unreadCount: number;
  updatedAt: string;
};

export async function fetchProfileNotifications(options?: {
  category?: ProfileNotificationCategory;
  cursor?: string;
  limit?: number;
}) {
  const params: string[] = [];
  if (
    options?.category &&
    ['all', 'messages', 'requests', 'social'].includes(options.category)
  ) {
    params.push(`category=${encodeURIComponent(options.category)}`);
  }
  if (typeof options?.cursor === 'string' && options.cursor.trim().length > 0) {
    params.push(`cursor=${encodeURIComponent(options.cursor.trim())}`);
  }
  if (Number.isFinite(options?.limit)) {
    params.push(`limit=${Math.max(1, Math.floor(Number(options?.limit)))}`);
  }
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return apiRequest<ProfileNotificationsResponse>(`/api/v1/profile/notifications${query}`);
}

export async function markProfileNotificationsRead(payload?: {
  all?: boolean;
  category?: ProfileNotificationCategory;
  ids?: string[];
}) {
  const response = await apiRequest<{
    readAt: string;
    unreadCount: number;
    updatedCount: number;
    userId: string;
  }>('/api/v1/profile/notifications/read', {
    body: JSON.stringify(payload || { all: true }),
    method: 'POST',
  });
  invalidateProfileRequestSummaryCache();
  return response;
}

export async function registerUser(payload: RegisterPayload) {
  return apiRequest<VerificationChallengeResponse>('/api/v1/auth/register', {
    body: JSON.stringify(payload),
    method: 'POST',
  });
}

export async function checkUsernameAvailability(
  username: string,
  options?: { signal?: AbortSignal },
) {
  const normalizedUsername = username.trim().toLowerCase();
  return apiRequest<UsernameAvailabilityResponse>(
    `/api/v1/username/check?username=${encodeURIComponent(normalizedUsername)}`,
    {
      signal: options?.signal,
      timeoutMs: 2500,
    },
  );
}

export async function resendVerificationEmail(
  payload: ResendVerificationPayload,
) {
  return apiRequest<VerificationChallengeResponse>(
    '/api/v1/auth/resend-verification',
    {
      body: JSON.stringify(payload),
      method: 'POST',
    },
  );
}

export async function confirmVerificationCode(
  payload: VerifyEmailConfirmPayload,
) {
  return apiRequest<VerifyEmailResponse>('/api/v1/auth/verify-email/confirm', {
    body: JSON.stringify(payload),
    method: 'POST',
  });
}

export async function loginUser(payload: LoginPayload) {
  const response = await apiRequest<AuthResponse>('/api/v1/auth/login', {
    body: JSON.stringify(payload),
    method: 'POST',
  });

  return applySession(response);
}

export async function requestPasswordReset(
  payload: PasswordResetRequestPayload,
) {
  return apiRequest<PasswordResetChallengeResponse>(
    '/api/v1/auth/password-reset/request',
    {
      body: JSON.stringify(payload),
      method: 'POST',
    },
  );
}

export async function confirmPasswordReset(
  payload: PasswordResetConfirmPayload,
) {
  return apiRequest<PasswordOperationResponse>(
    '/api/v1/auth/password-reset/confirm',
    {
      body: JSON.stringify(payload),
      method: 'POST',
    },
  );
}

export async function socialLogin(payload: SocialLoginPayload) {
  const response = await apiRequest<AuthResponse>('/api/v1/auth/social', {
    body: JSON.stringify(payload),
    method: 'POST',
  });

  return applySession(response);
}

export async function fetchMyProfile() {
  const profile = await apiRequest<UserProfile>('/api/v1/profile/me');
  return normalizeUserProfile(profile);
}

export async function fetchPublicProfile(userId: string) {
  const profile = await apiRequest<PublicUserProfile>(
    `/api/v1/profile/users/${encodeURIComponent(userId)}`,
  );
  return normalizePublicUserProfile(profile);
}

export type FetchPublicProfilePostsRequest = {
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
};

function buildProfilePostsQuery(request?: FetchPublicProfilePostsRequest) {
  const query = new URLSearchParams();
  if (typeof request?.limit === 'number' && Number.isFinite(request.limit)) {
    query.set('limit', String(Math.max(1, Math.floor(request.limit))));
  }
  if (request?.cursor && request.cursor.trim().length > 0) {
    query.set('cursor', request.cursor.trim());
  }

  return query.toString();
}

export async function fetchPublicProfilePosts(
  userId: string,
  request?: FetchPublicProfilePostsRequest,
) {
  const suffix = buildProfilePostsQuery(request);
  const path = suffix
    ? `/api/v1/profile/users/${encodeURIComponent(userId)}/posts?${suffix}`
    : `/api/v1/profile/users/${encodeURIComponent(userId)}/posts`;

  const response = await apiRequest<PublicProfilePostsResponse>(path, {
    signal: request?.signal,
  });
  return normalizeProfilePostsResponse(response);
}

export async function fetchMyProfilePosts(
  request?: FetchPublicProfilePostsRequest,
) {
  const suffix = buildProfilePostsQuery(request);
  const path = suffix
    ? `/api/v1/profile/me/posts?${suffix}`
    : '/api/v1/profile/me/posts';
  const response = await apiRequest<PublicProfilePostsResponse>(path, {
    signal: request?.signal,
  });
  return normalizeProfilePostsResponse(response);
}

export async function createMyProfilePost(payload: CreateProfilePostPayload) {
  const response = await apiRequest<PublicProfilePostItem>(
    '/api/v1/profile/me/posts',
    {
      body: JSON.stringify(payload),
      method: 'POST',
    },
  );
  return normalizeProfilePostItem(response);
}

export async function updateMyProfilePost(
  postId: string,
  payload: UpdateProfilePostPayload,
) {
  const response = await apiRequest<PublicProfilePostItem>(
    `/api/v1/profile/me/posts/${encodeURIComponent(postId.trim())}`,
    {
      body: JSON.stringify(payload),
      method: 'PATCH',
    },
  );
  return normalizeProfilePostItem(response);
}

function inferProfilePostUploadMimeType(
  mediaType: 'photo' | 'video',
  mediaUrl: string,
) {
  const normalizedUrl = mediaUrl.trim().toLowerCase();
  if (mediaType === 'video') {
    if (normalizedUrl.endsWith('.mov')) {
      return 'video/quicktime';
    }
    return 'video/mp4';
  }

  if (normalizedUrl.endsWith('.png')) {
    return 'image/png';
  }
  if (normalizedUrl.endsWith('.heic') || normalizedUrl.endsWith('.heif')) {
    return 'image/heic';
  }
  return 'image/jpeg';
}

function inferProfilePostUploadFileName(
  mediaType: 'photo' | 'video',
  mediaUrl: string,
) {
  const sanitizedSegment =
    mediaUrl.split('?')[0]?.split('/').pop()?.trim() ?? '';
  if (sanitizedSegment.length > 0 && sanitizedSegment.includes('.')) {
    return sanitizedSegment;
  }

  if (mediaType === 'video') {
    return 'captured-post.mp4';
  }
  return 'captured-post.jpg';
}

export async function uploadProfilePostMedia(payload: {
  mediaType: 'photo' | 'video';
  mediaUrl: string;
}) {
  const normalizedMediaUrl = payload.mediaUrl.trim();
  if (!isLocalMediaUri(normalizedMediaUrl)) {
    return {
      asset: {
        id: normalizedMediaUrl,
        mediaType: payload.mediaType,
        mediaUrl: normalizedMediaUrl,
        mimeType: inferProfilePostUploadMimeType(
          payload.mediaType,
          normalizedMediaUrl,
        ),
        sizeBytes: 0,
        uploadedAt: new Date().toISOString(),
      },
    } satisfies ProfilePostMediaUploadResponse;
  }

  const form = new FormData();
  form.append('mediaType', payload.mediaType);
  form.append('file', {
    name: inferProfilePostUploadFileName(payload.mediaType, normalizedMediaUrl),
    type: inferProfilePostUploadMimeType(payload.mediaType, normalizedMediaUrl),
    uri: normalizedMediaUrl,
  } as any);

  const response = await apiRequest<ProfilePostMediaUploadResponse>(
    '/api/v1/profile/me/post-media',
    {
      body: form,
      method: 'POST',
      timeoutMs: payload.mediaType === 'video' ? 120000 : 45000,
    },
  );
  return response;
}

export type DeleteMyProfilePostOptions = {
  adminToken?: string;
  mode?: 'hard' | 'soft';
};

export async function deleteMyProfilePost(
  postId: string,
  options?: DeleteMyProfilePostOptions,
) {
  const normalizedPostId = postId.trim();
  const mode = options?.mode === 'hard' ? 'hard' : 'soft';
  const path =
    mode === 'hard'
      ? `/api/v1/admin/profile/posts/${encodeURIComponent(normalizedPostId)}`
      : `/api/v1/profile/me/posts/${encodeURIComponent(normalizedPostId)}`;
  const headers =
    mode === 'hard' && options?.adminToken
      ? { 'X-MacRadar-Admin-Token': options.adminToken.trim() }
      : undefined;

  return apiRequest<DeleteProfilePostResponse>(path, {
    headers,
    method: 'DELETE',
  });
}

export async function fetchMyLikedPosts(
  request?: FetchPublicProfilePostsRequest,
) {
  const suffix = buildProfilePostsQuery(request);
  const path = suffix
    ? `/api/v1/profile/me/liked-posts?${suffix}`
    : '/api/v1/profile/me/liked-posts';
  const response = await apiRequest<PublicProfilePostsResponse>(path, {
    signal: request?.signal,
  });
  return normalizeProfilePostsResponse(response);
}

export async function fetchMySavedPosts(
  request?: FetchPublicProfilePostsRequest,
) {
  const suffix = buildProfilePostsQuery(request);
  const path = suffix
    ? `/api/v1/profile/me/saved-posts?${suffix}`
    : '/api/v1/profile/me/saved-posts';
  const response = await apiRequest<PublicProfilePostsResponse>(path, {
    signal: request?.signal,
  });
  return normalizeProfilePostsResponse(response);
}

export async function updateMyProfile(payload: UpdateProfilePayload) {
  const profile = await apiRequest<UserProfile>('/api/v1/profile/me', {
    body: JSON.stringify(payload),
    method: 'PATCH',
  });
  const normalizedProfile = normalizeUserProfile(profile);
  await storeProfileCache(normalizedProfile);
  return normalizedProfile;
}

export type CountryCallingCodeRow = {
  dial: string;
  flag: string;
  iso2: string;
  name: string;
};

let countryCallingCodesCache: CountryCallingCodeRow[] | null = null;
let countryCallingCodesInflight: Promise<CountryCallingCodeRow[]> | null =
  null;

export async function fetchCountryCallingCodes(options?: {
  force?: boolean;
}): Promise<CountryCallingCodeRow[]> {
  if (!options?.force && countryCallingCodesCache) {
    return countryCallingCodesCache;
  }
  if (!options?.force && countryCallingCodesInflight) {
    return countryCallingCodesInflight;
  }
  countryCallingCodesInflight = apiRequest<{ countries: CountryCallingCodeRow[] }>(
    '/api/v1/meta/country-calling-codes',
    { method: 'GET' },
  )
    .then(body => {
      const rows = Array.isArray(body?.countries) ? body.countries : [];
      countryCallingCodesCache = rows;
      countryCallingCodesInflight = null;
      return rows;
    })
    .catch(err => {
      countryCallingCodesInflight = null;
      throw err;
    });
  return countryCallingCodesInflight;
}

export async function fetchProfilePrivacy() {
  return apiRequest<PrivacySettings>('/api/v1/profile/privacy');
}

export async function updateProfilePrivacy(
  payload: UpdatePrivacySettingsPayload,
) {
  return apiRequest<PrivacySettings>('/api/v1/profile/privacy', {
    body: JSON.stringify(payload),
    method: 'PATCH',
  });
}

export async function fetchMapPreferences() {
  const response = await apiRequest<MapPreferences>('/api/v1/map/preferences');
  return normalizeMapPreferences(response);
}

export async function updateMapPreferences(
  payload: UpdateMapPreferencesPayload,
) {
  const response = await apiRequest<MapPreferences>('/api/v1/map/preferences', {
    body: JSON.stringify(payload),
    method: 'PATCH',
  });
  return normalizeMapPreferences(response);
}

export async function startTrackingSession() {
  return apiRequest<{ sessionId: string; status: string }>(
    '/api/v1/tracking/sessions/start',
    {
      method: 'POST',
    },
  );
}

export async function stopTrackingSession() {
  return apiRequest<{ status: string }>('/api/v1/tracking/sessions/stop', {
    method: 'POST',
  });
}

export async function fetchProfileAppSettings(
  options?: ProfileAppSettingsFetchOptions,
) {
  const force = options?.force === true;
  const cached = profileAppSettingsCache;
  if (
    !force &&
    cached &&
    Date.now() - cached.cachedAt < PROFILE_APP_SETTINGS_CACHE_TTL_MS
  ) {
    return {
      ...cached.data,
    };
  }

  if (profileAppSettingsInFlight) {
    return profileAppSettingsInFlight;
  }

  profileAppSettingsInFlight = apiRequest<ProfileAppSettings>(
    '/api/v1/profile/app-settings',
  )
    .then(response => {
      const normalized = normalizeProfileAppSettings(response);
      cacheProfileAppSettings(normalized);
      return {
        ...normalized,
      };
    })
    .finally(() => {
      profileAppSettingsInFlight = null;
    });

  return profileAppSettingsInFlight;
}

export async function updateProfileAppSettings(
  payload: UpdateProfileAppSettingsPayload,
) {
  profileAppSettingsInFlight = null;
  invalidateProfileRequestSummaryCache();
  const response = await apiRequest<ProfileAppSettings>(
    '/api/v1/profile/app-settings',
    {
      body: JSON.stringify(payload),
      method: 'PATCH',
    },
  );
  const normalized = normalizeProfileAppSettings(response);
  cacheProfileAppSettings(normalized);
  return {
    ...normalized,
  };
}

export async function fetchProfileRequestSummary(
  options?: ProfileRequestSummaryFetchOptions,
) {
  const force = options?.force === true;
  const cached = profileRequestSummaryCache;
  if (
    !force &&
    cached &&
    Date.now() - cached.cachedAt < PROFILE_REQUEST_SUMMARY_CACHE_TTL_MS
  ) {
    return {
      ...cached.data,
    };
  }

  if (profileRequestSummaryInFlight) {
    return profileRequestSummaryInFlight;
  }

  profileRequestSummaryInFlight = apiRequest<ProfileRequestSummary>(
    '/api/v1/profile/request-summary',
  )
    .then(response => {
      cacheProfileRequestSummary(response);
      return {
        ...response,
      };
    })
    .finally(() => {
      profileRequestSummaryInFlight = null;
    });

  return profileRequestSummaryInFlight;
}

export async function fetchFollowRequests(options?: FollowRequestFetchOptions) {
  const force = options?.force === true;
  const hasCustomSignal = Boolean(options?.signal);
  const cached = followRequestsCache;
  if (
    !force &&
    cached &&
    Date.now() - cached.cachedAt < FOLLOW_REQUESTS_CACHE_TTL_MS
  ) {
    return {
      requests: [...cached.data.requests],
    };
  }

  if (!hasCustomSignal && followRequestsInFlight) {
    return followRequestsInFlight;
  }

  const requestPromise = apiRequest<FollowRequestListResponse>(
    '/api/v1/profile/follow-requests',
    {
      signal: options?.signal,
    },
  )
    .then(response => {
      const normalized = normalizeFollowRequestResponse(response);
      cacheFollowRequests(normalized);
      return {
        requests: [...normalized.requests],
      };
    });

  if (hasCustomSignal) {
    return requestPromise;
  }

  followRequestsInFlight = requestPromise.finally(() => {
    followRequestsInFlight = null;
  });

  return followRequestsInFlight;
}

export async function acceptFollowRequest(requesterId: string) {
  const response = await apiRequest<FollowRequestDecisionResponse>(
    `/api/v1/profile/follow-requests/${encodeURIComponent(requesterId)}/accept`,
    {
      body: JSON.stringify({}),
      method: 'POST',
    },
  );
  dropFollowRequestFromCache(requesterId);
  invalidateProfileRequestSummaryCache();
  invalidateFollowersCache();
  return response;
}

export async function rejectFollowRequest(requesterId: string) {
  const response = await apiRequest<FollowRequestDecisionResponse>(
    `/api/v1/profile/follow-requests/${encodeURIComponent(requesterId)}/reject`,
    {
      body: JSON.stringify({}),
      method: 'POST',
    },
  );
  dropFollowRequestFromCache(requesterId);
  invalidateProfileRequestSummaryCache();
  return response;
}

export async function fetchBlockedUsers() {
  const response = await apiRequest<BlockedUserListResponse>(
    '/api/v1/profile/blocked-users',
  );
  return normalizeBlockedUsersResponse(response);
}

export async function blockUser(blockedUserId: string) {
  return apiRequest<BlockedUserOperationResponse>(
    `/api/v1/profile/blocked-users/${encodeURIComponent(blockedUserId)}`,
    {
      body: JSON.stringify({}),
      method: 'POST',
    },
  );
}

export async function unblockUser(blockedUserId: string) {
  return apiRequest<BlockedUserOperationResponse>(
    `/api/v1/profile/blocked-users/${encodeURIComponent(blockedUserId)}`,
    {
      method: 'DELETE',
    },
  );
}

export async function reportUser(reportedUserId: string, reason: string) {
  return apiRequest<UserReportResponse>(
    `/api/v1/profile/users/${encodeURIComponent(reportedUserId)}/report`,
    {
      body: JSON.stringify({ reason }),
      method: 'POST',
    },
  );
}

export async function changePassword(payload: ChangePasswordPayload) {
  return apiRequest<PasswordOperationResponse>(
    '/api/v1/profile/change-password',
    {
      body: JSON.stringify(payload),
      method: 'POST',
    },
  );
}

export async function deleteMyAccount() {
  const response = await apiRequest<DeleteAccountResponse>(
    '/api/v1/profile/me',
    {
      method: 'DELETE',
    },
  );
  invalidateFollowRequestsCache();
  invalidateProfileAppSettingsCache();
  invalidateProfileRequestSummaryCache();
  resetExploreServiceCaches();
  setApiSessionToken(null);
  await clearStoredSessionToken();
  await clearStoredProfileCache();
  return response;
}

export async function requestDeleteAccountCode() {
  const candidates = [
    '/api/v1/profile/me/delete/request-code',
    '/api/v1/profile/delete/request-code',
    '/api/v1/account/delete/request-code',
  ];

  let lastError: unknown = null;
  for (const path of candidates) {
    try {
      return await apiRequest<VerificationChallengeResponse>(path, {
        body: JSON.stringify({}),
        method: 'POST',
      });
    } catch (error) {
      lastError = error;
      if (!isApiRequestError(error) || error.status !== 404) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error('delete account request endpoint not found');
}

export async function confirmDeleteMyAccount(payload: DeleteAccountConfirmPayload) {
  const candidates = [
    '/api/v1/profile/me/delete/confirm',
    '/api/v1/profile/delete/confirm',
    '/api/v1/account/delete/confirm',
  ];

  let response: DeleteAccountResponse | null = null;
  let lastError: unknown = null;
  for (const path of candidates) {
    try {
      response = await apiRequest<DeleteAccountResponse>(path, {
        body: JSON.stringify(payload),
        method: 'POST',
      });
      break;
    } catch (error) {
      lastError = error;
      if (!isApiRequestError(error) || error.status !== 404) {
        throw error;
      }
    }
  }
  if (!response) {
    throw lastError ?? new Error('delete account confirm endpoint not found');
  }

  invalidateFollowRequestsCache();
  invalidateProfileAppSettingsCache();
  invalidateProfileRequestSummaryCache();
  resetExploreServiceCaches();
  setApiSessionToken(null);
  await clearStoredSessionToken();
  await clearStoredProfileCache();
  return response;
}

export async function logoutUser(options?: LogoutUserOptions) {
  const headers =
    typeof options?.tokenOverride === 'string' &&
    options.tokenOverride.trim().length > 0
      ? { Authorization: `Bearer ${options.tokenOverride.trim()}` }
      : undefined;

  try {
    await apiRequest<{ ok: boolean }>('/api/v1/auth/logout', {
      body: JSON.stringify({}),
      headers,
      method: 'POST',
    });
  } finally {
    if (options?.preserveLocalSession) {
      return;
    }
    invalidateFollowRequestsCache();
    invalidateProfileAppSettingsCache();
    invalidateProfileRequestSummaryCache();
    resetExploreServiceCaches();
    setApiSessionToken(null);
    await clearStoredSessionToken();
    await clearStoredProfileCache();
  }
}
