import { EXPLORE_WS_URL } from '../config/exploreApi';
import { apiRequest, isApiRequestError } from './apiClient';
import { resolveProtectedMediaUrl } from './protectedMedia';
import type { ExploreSegment } from '../types/AppTypes/AppTypes';
import type {
  ProfilePostVisibility,
  PublicProfilePostItem,
} from '../types/AuthTypes/AuthTypes';
import type {
  ExploreCommentMutationResponse,
  ExploreCommentLikeResponse,
  ExploreCommentsResponse,
  ExploreFeedResponse,
  ExploreFollowResponse,
  ExplorePost,
  ExploreReactionKind,
  ExplorePostSearchResponse,
  ExplorePostReportResponse,
  ExplorePostEngagementUsersResponse,
  ExploreSearchPostFilter,
  ExploreSearchPostSort,
  ExploreReactionResponse,
  ExploreRealtimeEvent,
  ExploreTagDetailResponse,
  ExploreTrendingTagsResponse,
  ExploreFollowerRemovalResponse,
  ExploreStreetFriendListResponse,
  ExploreStreetFriendStatusResponse,
  ExploreStreetFriendRequestListResponse,
  ExploreStreetFriendResponse,
  ExploreRecentSearchMutationResponse,
  ExploreRecentSearchTermKind,
  ExploreRecentSearchTermsResponse,
  ExplorePopularSearchTermsResponse,
  ExploreUserListResponse,
  ExploreUserSearchResponse,
} from '../types/ExploreTypes/ExploreTypes';
import type { PostLocationPayload } from '../types/LocationTypes/LocationTypes';

const SEGMENT_EXPLORE = 'Ke\u015ffet' as ExploreSegment;
const SEGMENT_FOLLOWING = 'Takipte' as ExploreSegment;
const SEGMENT_FOR_YOU = 'Sizin \u0130\u00e7in' as ExploreSegment;
const streetFriendFlightByUserId = new Map<
  string,
  Promise<ExploreStreetFriendResponse>
>();
const streetFriendStatusFlightByUserId = new Map<
  string,
  Promise<ExploreStreetFriendStatusResponse>
>();
const streetFriendStatusCacheByUserId = new Map<
  string,
  { expiresAt: number; value: ExploreStreetFriendStatusResponse }
>();
const exploreSessionCache = new Map<string, unknown>();
const exploreSessionFlightByKey = new Map<string, Promise<unknown>>();
// Keep relationship data cached longer during a session to reduce refetches.
const STREET_FRIEND_STATUS_CACHE_TTL_MS = 600_000; // 10 minutes
const RELATION_LIST_CACHE_TTL_MS = 300_000; // 5 minutes

type RelationFetchOptions = {
  force?: boolean;
  signal?: AbortSignal;
};

type TimedCacheEntry<T> = {
  cachedAt: number;
  data: T;
};

const POST_ENGAGEMENT_USERS_CACHE_TTL_MS = 300_000; // 5 minutes
const postEngagementUsersCacheByKey = new Map<
  string,
  TimedCacheEntry<ExplorePostEngagementUsersResponse>
>();
const postEngagementUsersInFlightByKey = new Map<
  string,
  Promise<ExplorePostEngagementUsersResponse>
>();

function invalidatePostEngagementUsersCache(postId: string) {
  const normalizedPostId = postId.trim();
  if (normalizedPostId.length === 0) {
    return;
  }

  const prefix = `${normalizedPostId}:`;
  for (const key of postEngagementUsersCacheByKey.keys()) {
    if (key.startsWith(prefix)) {
      postEngagementUsersCacheByKey.delete(key);
    }
  }
  for (const key of postEngagementUsersInFlightByKey.keys()) {
    if (key.startsWith(prefix)) {
      postEngagementUsersInFlightByKey.delete(key);
    }
  }
}

type StreetFriendMutationResponseRaw = ExploreStreetFriendResponse & {
  creatorId?: string;
  userId?: string;
};

type StreetFriendListItemRaw = ExploreStreetFriendListResponse['friends'][number] & {
  userId?: string;
};

type StreetFriendRequestItemRaw =
  ExploreStreetFriendRequestListResponse['requests'][number] & {
    createdAt?: string;
    requestedAt?: string;
    userId?: string;
  };

export type TrackingFollowPathResponse = {
  points: Array<{
    accuracy: number;
    capturedAt: string;
    heading: number;
    latitude: number;
    longitude: number;
    sequence: number;
    source: string;
    speed: number;
  }>;
  sessionId: number;
  targetUserId: string;
};

export type LiveFollowNotificationResponse = {
  delivered: boolean;
  notificationId?: string;
  retryAfterMs?: number;
  suppressed?: boolean;
  targetUserId: string;
};

let followersCache: TimedCacheEntry<ExploreUserListResponse> | null = null;
let followersInFlight: Promise<ExploreUserListResponse> | null = null;
let followingCache: TimedCacheEntry<ExploreUserListResponse> | null = null;
let followingInFlight: Promise<ExploreUserListResponse> | null = null;
let streetFriendsCache: TimedCacheEntry<ExploreStreetFriendListResponse> | null =
  null;
let streetFriendsInFlight: Promise<ExploreStreetFriendListResponse> | null = null;
let streetFriendRequestsCache:
  | TimedCacheEntry<ExploreStreetFriendRequestListResponse>
  | null = null;
let streetFriendRequestsInFlight:
  | Promise<ExploreStreetFriendRequestListResponse>
  | null = null;

function withStreetFriendSingleFlight(
  userId: string,
  operation: () => Promise<ExploreStreetFriendResponse>,
) {
  const key = userId.trim();
  if (key.length === 0) {
    return operation();
  }

  const existing = streetFriendFlightByUserId.get(key);
  if (existing) {
    return existing;
  }

  const flight = operation().finally(() => {
    if (streetFriendFlightByUserId.get(key) === flight) {
      streetFriendFlightByUserId.delete(key);
    }
  });
  streetFriendFlightByUserId.set(key, flight);
  return flight;
}

function withStreetFriendStatusSingleFlight(
  userId: string,
  operation: () => Promise<ExploreStreetFriendStatusResponse>,
) {
  const key = userId.trim();
  if (key.length === 0) {
    return operation();
  }

  const existing = streetFriendStatusFlightByUserId.get(key);
  if (existing) {
    return existing;
  }

  const flight = operation().finally(() => {
    if (streetFriendStatusFlightByUserId.get(key) === flight) {
      streetFriendStatusFlightByUserId.delete(key);
    }
  });
  streetFriendStatusFlightByUserId.set(key, flight);
  return flight;
}

function cacheStreetFriendStatus(
  userId: string,
  value: ExploreStreetFriendStatusResponse,
) {
  const key = userId.trim();
  if (key.length === 0) {
    return value;
  }
  streetFriendStatusCacheByUserId.set(key, {
    expiresAt: Date.now() + STREET_FRIEND_STATUS_CACHE_TTL_MS,
    value,
  });
  return value;
}

function readStreetFriendStatusCache(userId: string) {
  const key = userId.trim();
  if (key.length === 0) {
    return null;
  }

  const cached = streetFriendStatusCacheByUserId.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    streetFriendStatusCacheByUserId.delete(key);
    return null;
  }
  return cached.value;
}

function setStreetFriendStatusFromMutation(
  userId: string,
  response: ExploreStreetFriendResponse,
) {
  return cacheStreetFriendStatus(userId, {
    isStreetFriend: response.isStreetFriend,
    streetFriendStatus: response.streetFriendStatus,
    targetUserId: userId,
  });
}

function readExploreSessionCache<T>(key: string) {
  if (!key) {
    return null;
  }
  return (exploreSessionCache.get(key) as T | undefined) ?? null;
}

function writeExploreSessionCache<T>(key: string, value: T) {
  if (!key) {
    return value;
  }
  exploreSessionCache.set(key, value);
  return value;
}

function clearExploreSessionCache(prefix?: string) {
  if (!prefix) {
    exploreSessionCache.clear();
    exploreSessionFlightByKey.clear();
    return;
  }

  Array.from(exploreSessionCache.keys()).forEach(key => {
    if (key.startsWith(prefix)) {
      exploreSessionCache.delete(key);
    }
  });
  Array.from(exploreSessionFlightByKey.keys()).forEach(key => {
    if (key.startsWith(prefix)) {
      exploreSessionFlightByKey.delete(key);
    }
  });
}

function withExploreSessionCache<T>(
  key: string,
  options: { force?: boolean } | undefined,
  request: () => Promise<T>,
) {
  if (!options?.force) {
    const cached = readExploreSessionCache<T>(key);
    if (cached) {
      return Promise.resolve(cached);
    }

    const inFlight = exploreSessionFlightByKey.get(key) as Promise<T> | undefined;
    if (inFlight) {
      return inFlight;
    }
  }

  const flight = request()
    .then(response => writeExploreSessionCache(key, response))
    .finally(() => {
      if (exploreSessionFlightByKey.get(key) === flight) {
        exploreSessionFlightByKey.delete(key);
      }
    });

  exploreSessionFlightByKey.set(key, flight);
  return flight;
}

function readTimedCache<T>(entry: TimedCacheEntry<T> | null) {
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.cachedAt >= RELATION_LIST_CACHE_TTL_MS) {
    return null;
  }
  return entry.data;
}

function getSegmentSlug(segment: ExploreSegment) {
  if (segment === SEGMENT_FOLLOWING) {
    return 'takipte';
  }

  if (segment === SEGMENT_FOR_YOU) {
    return 'sizin-icin';
  }

  return 'kesfet';
}

function fromSegmentSlug(segment: string): ExploreSegment {
  if (segment === 'takipte') {
    return SEGMENT_FOLLOWING;
  }

  if (segment === 'sizin-icin') {
    return SEGMENT_FOR_YOU;
  }

  return SEGMENT_EXPLORE;
}

function normalizePost(post: ExplorePost & { segment: string }): ExplorePost {
  return {
    ...post,
    author: {
      ...post.author,
      avatarUrl: resolveProtectedMediaUrl(post.author.avatarUrl),
    },
    mediaUrl: resolveProtectedMediaUrl(post.mediaUrl),
    segment: fromSegmentSlug(post.segment),
  };
}

function normalizeComment(comment: ExploreCommentMutationResponse['comment']) {
  return {
    ...comment,
    author: {
      ...comment.author,
      avatarUrl: resolveProtectedMediaUrl(comment.author.avatarUrl),
    },
  };
}

function normalizeSearchUser(user: ExploreUserSearchResponse['users'][number]) {
  return {
    ...user,
    avatarUrl: resolveProtectedMediaUrl(user.avatarUrl),
  };
}

function normalizeStreetFriendMutationResponse(
  response: StreetFriendMutationResponseRaw,
): ExploreStreetFriendResponse {
  const normalizedCreatorId =
    typeof response.creatorId === 'string' && response.creatorId.trim().length > 0
      ? response.creatorId.trim()
      : typeof response.userId === 'string' && response.userId.trim().length > 0
        ? response.userId.trim()
        : '';

  return {
    ...response,
    creatorId: normalizedCreatorId,
  };
}

function normalizeUserListResponse(response: ExploreUserListResponse) {
  return {
    ...response,
    users: response.users.map(user => normalizeSearchUser(user)),
  };
}

function cloneUserListResponse(response: ExploreUserListResponse) {
  return {
    ...response,
    users: response.users.map(user => ({
      ...user,
      viewerState: {
        ...user.viewerState,
      },
    })),
  };
}

function normalizeStreetFriendsResponse(response: ExploreStreetFriendListResponse) {
  return {
    ...response,
    friends: response.friends.map(rawFriend => {
      const friend = rawFriend as StreetFriendListItemRaw;
      const normalizedId =
        typeof friend.userId === 'string' && friend.userId.trim().length > 0
          ? friend.userId.trim()
          : friend.id;
      return {
        ...friend,
        avatarUrl: resolveProtectedMediaUrl(friend.avatarUrl),
        id: normalizedId,
      };
    }),
  };
}

function cloneStreetFriendsResponse(response: ExploreStreetFriendListResponse) {
  return {
    ...response,
    friends: response.friends.map(friend => ({
      ...friend,
    })),
  };
}

function normalizeStreetFriendRequestsResponse(
  response: ExploreStreetFriendRequestListResponse,
) {
  return {
    ...response,
    requests: response.requests.map(rawRequest => {
      const request = rawRequest as StreetFriendRequestItemRaw;
      const normalizedId =
        typeof request.userId === 'string' && request.userId.trim().length > 0
          ? request.userId.trim()
          : request.id;
      const normalizedRequestedAt =
        typeof request.requestedAt === 'string' &&
        request.requestedAt.trim().length > 0
          ? request.requestedAt
          : typeof request.createdAt === 'string' && request.createdAt.trim().length > 0
            ? request.createdAt
            : new Date().toISOString();
      return {
        ...request,
        avatarUrl: resolveProtectedMediaUrl(request.avatarUrl),
        id: normalizedId,
        requestedAt: normalizedRequestedAt,
      };
    }),
  };
}

function cloneStreetFriendRequestsResponse(
  response: ExploreStreetFriendRequestListResponse,
) {
  return {
    ...response,
    requests: response.requests.map(request => ({
      ...request,
    })),
  };
}

export function invalidateFollowersCache() {
  followersCache = null;
  followersInFlight = null;
}

export function invalidateFollowingCache() {
  followingCache = null;
  followingInFlight = null;
}

export function invalidateStreetFriendsCache() {
  streetFriendsCache = null;
  streetFriendsInFlight = null;
}

export function invalidateStreetFriendRequestsCache() {
  streetFriendRequestsCache = null;
  streetFriendRequestsInFlight = null;
}

export function resetExploreServiceCaches() {
  clearExploreSessionCache();
  streetFriendFlightByUserId.clear();
  streetFriendStatusFlightByUserId.clear();
  streetFriendStatusCacheByUserId.clear();
  invalidateFollowersCache();
  invalidateFollowingCache();
  invalidateStreetFriendsCache();
  invalidateStreetFriendRequestsCache();
}

function normalizeFeedResponse(response: ExploreFeedResponse) {
  return {
    ...response,
    posts: response.posts.map(post =>
      normalizePost(post as ExplorePost & { segment: string }),
    ),
  };
}

export type ExploreFeedRequest = {
  cursor?: string;
  force?: boolean;
  limit?: number;
};

export type ExploreUserSearchRequest = {
  cursor?: string;
  force?: boolean;
  limit?: number;
  signal?: AbortSignal;
};

export type ExplorePostSearchRequest = {
  cursor?: string;
  force?: boolean;
  limit?: number;
  mediaType?: ExploreSearchPostFilter;
  signal?: AbortSignal;
  sort?: ExploreSearchPostSort;
};

export async function fetchMapBootstrap() {
  return await apiRequest<{
    streetFriends: ExploreStreetFriendListResponse;
    streetRequests: ExploreStreetFriendRequestListResponse;
    preferences: {
      mapFilterMode: string;
      mapThemeMode: string;
      showLocalLayer: boolean;
      showRemoteLayer: boolean;
      trackingEnabled: boolean;
    };
  }>('/api/v1/app/map-bootstrap');
}

export async function fetchExploreFeed(
  segment: ExploreSegment,
  request?: ExploreFeedRequest,
) {
  const slug = getSegmentSlug(segment);
  const query = new URLSearchParams({ segment: slug });
  if (typeof request?.limit === 'number' && Number.isFinite(request.limit)) {
    query.set('limit', String(Math.max(1, Math.floor(request.limit))));
  }
  if (request?.cursor && request.cursor.trim().length > 0) {
    query.set('cursor', request.cursor.trim());
  }
  const cacheKey = `feed:${query.toString()}`;
  return withExploreSessionCache(cacheKey, request, async () => {
    const response = await apiRequest<ExploreFeedResponse>(
      `/api/v1/explore/feed?${query.toString()}`,
    );
    return normalizeFeedResponse(response);
  });
}

export async function fetchExploreComments(postId: string) {
  const response = await apiRequest<ExploreCommentsResponse>(
    `/api/v1/explore/posts/${encodeURIComponent(postId)}/comments`,
  );
  return {
    ...response,
    comments: response.comments.map(comment => normalizeComment(comment)),
  };
}

export async function fetchPostEngagementUsers(
  postId: string,
  kind: 'like' | 'bookmark',
  options?: {
    limit?: number;
    force?: boolean;
    signal?: AbortSignal;
  },
) {
  const normalizedPostId = postId.trim();
  if (normalizedPostId.length === 0) {
    throw new Error('postId is required');
  }

  const normalizedKind = kind === 'bookmark' ? 'bookmark' : 'like';
  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit)
      ? Math.max(1, Math.min(50, Math.floor(options.limit)))
      : 20;

  const cacheKey = `${normalizedPostId}:${normalizedKind}:${limit}`;
  const cached = postEngagementUsersCacheByKey.get(cacheKey) ?? null;
  if (
    !options?.force &&
    cached &&
    Date.now() - cached.cachedAt <= POST_ENGAGEMENT_USERS_CACHE_TTL_MS
  ) {
    return cached.data;
  }

  const allowSingleFlight = !options?.force && !options?.signal;
  if (allowSingleFlight) {
    const existingFlight = postEngagementUsersInFlightByKey.get(cacheKey);
    if (existingFlight) {
      return existingFlight;
    }
  }

  const query = new URLSearchParams({
    kind: normalizedKind,
    limit: String(limit),
  });

  const requestPromise = apiRequest<ExplorePostEngagementUsersResponse>(
    `/api/v1/explore/posts/${encodeURIComponent(
      normalizedPostId,
    )}/reactions?${query.toString()}`,
    {
      method: 'GET',
      signal: options?.signal,
    },
  ).then(response => {
    postEngagementUsersCacheByKey.set(cacheKey, {
      cachedAt: Date.now(),
      data: response,
    });
    return response;
  });

  if (allowSingleFlight) {
    postEngagementUsersInFlightByKey.set(cacheKey, requestPromise);
  }

  try {
    return await requestPromise;
  } finally {
    if (allowSingleFlight) {
      if (postEngagementUsersInFlightByKey.get(cacheKey) === requestPromise) {
        postEngagementUsersInFlightByKey.delete(cacheKey);
      }
    }
  }
}

export async function sendExploreComment(postId: string, text: string) {
  const response = await apiRequest<ExploreCommentMutationResponse>(
    `/api/v1/explore/posts/${encodeURIComponent(postId)}/comments`,
    {
      body: JSON.stringify({ text }),
      method: 'POST',
    },
  );
  return {
    ...response,
    comment: normalizeComment(response.comment),
  };
}

export async function sendExploreCommentLike(commentId: string) {
  const response = await apiRequest<ExploreCommentLikeResponse>(
    `/api/v1/explore/comments/${encodeURIComponent(commentId)}/like`,
    {
      body: JSON.stringify({}),
      method: 'POST',
    },
  );
  return {
    ...response,
    comment: normalizeComment(response.comment),
  };
}

export async function updateProfilePost(
  postId: string,
  payload: {
    caption?: string;
    location?: string;
    locationPayload?: PostLocationPayload;
    visibility?: ProfilePostVisibility;
  },
) {
  const normalizedPostId = postId.trim();
  if (normalizedPostId.length === 0) {
    throw new Error('Gönderi ID geçersiz.');
  }

  return await apiRequest<PublicProfilePostItem>(
    `/api/v1/profile/me/posts/${encodeURIComponent(normalizedPostId)}`,
    {
      body: JSON.stringify(payload),
      method: 'PATCH',
    },
  );
}

export async function sendExploreReaction(
  postId: string,
  kind: ExploreReactionKind,
) {
  const response = await apiRequest<ExploreReactionResponse>(
    `/api/v1/explore/posts/${encodeURIComponent(postId)}/reactions`,
    {
      body: JSON.stringify({ kind }),
      method: 'POST',
    },
  );
  invalidatePostEngagementUsersCache(postId);
  return response;
}

export async function reportExplorePost(postId: string, reason: string) {
  return apiRequest<ExplorePostReportResponse>(
    `/api/v1/explore/posts/${encodeURIComponent(postId)}/report`,
    {
      body: JSON.stringify({ reason }),
      method: 'POST',
    },
  );
}

export async function followCreator(creatorId: string) {
  return apiRequest<ExploreFollowResponse>(
    `/api/v1/explore/creators/${encodeURIComponent(creatorId)}/follow`,
    {
      body: JSON.stringify({}),
      method: 'POST',
    },
  ).then(response => {
    invalidateFollowersCache();
    invalidateFollowingCache();
    return response;
  });
}

export async function upsertStreetFriend(creatorId: string) {
  const normalizedCreatorId = creatorId.trim();
  const creatorKey =
    normalizedCreatorId.length > 0 ? normalizedCreatorId : creatorId;
  return withStreetFriendSingleFlight(creatorKey, () =>
    apiRequest<StreetFriendMutationResponseRaw>(
      `/api/v1/explore/creators/${encodeURIComponent(
        creatorKey,
      )}/street-friend`,
      {
        body: JSON.stringify({}),
        method: 'POST',
      },
    ).then(rawResponse => {
      const response = normalizeStreetFriendMutationResponse(rawResponse);
      setStreetFriendStatusFromMutation(creatorKey, response);
      invalidateStreetFriendsCache();
      invalidateStreetFriendRequestsCache();
      return response;
    }),
  );
}

export async function searchExploreUsers(
  query: string,
  request?: number | ExploreUserSearchRequest,
) {
  const params = new URLSearchParams();
  if (query.trim().length > 0) {
    params.set('q', query.trim());
  }

  const normalizedLimit =
    typeof request === 'number'
      ? request
      : typeof request?.limit === 'number'
      ? request.limit
      : 20;
  params.set('limit', String(Math.max(1, Math.floor(normalizedLimit))));
  if (
    typeof request === 'object' &&
    request?.cursor &&
    request.cursor.trim().length > 0
  ) {
    params.set('cursor', request.cursor.trim());
  }

  const requestOptions = typeof request === 'object' ? request : undefined;
  const cacheKey = `search-users:${params.toString()}`;
  return withExploreSessionCache(cacheKey, requestOptions, () =>
    apiRequest<ExploreUserSearchResponse>(
      `/api/v1/explore/search/users?${params.toString()}`,
      {
        signal: requestOptions?.signal,
      },
    ).then(response => ({
      ...response,
      users: response.users.map(user => normalizeSearchUser(user)),
    })),
  );
}

export async function fetchExploreRecentUsers(options?: {
  force?: boolean;
  limit?: number;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams();
  if (typeof options?.limit === 'number' && Number.isFinite(options.limit)) {
    params.set('limit', String(Math.max(1, Math.floor(options.limit))));
  }
  const query = params.toString();
  const cacheKey = `recent-users:${query}`;
  return withExploreSessionCache(cacheKey, options, async () => {
    const response = await apiRequest<ExploreUserListResponse>(
      `/api/v1/explore/search/recent-users${query.length > 0 ? `?${query}` : ''}`,
      {
        signal: options?.signal,
      },
    );
    return {
      ...response,
      users: response.users.map(user => normalizeSearchUser(user)),
    };
  });
}

export async function recordExploreRecentUser(userId: string) {
  return apiRequest<ExploreRecentSearchMutationResponse>(
    '/api/v1/explore/search/recent-users',
    {
      body: JSON.stringify({ userId }),
      method: 'POST',
    },
  ).then(response => {
    clearExploreSessionCache('recent-users:');
    return response;
  });
}

export async function removeExploreRecentUser(userId: string) {
  return apiRequest<ExploreRecentSearchMutationResponse>(
    `/api/v1/explore/search/recent-users/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
    },
  ).then(response => {
    clearExploreSessionCache('recent-users:');
    return response;
  });
}

export async function clearExploreRecentUsers() {
  return apiRequest<ExploreRecentSearchMutationResponse>(
    '/api/v1/explore/search/recent-users',
    {
      method: 'DELETE',
    },
  ).then(response => {
    clearExploreSessionCache('recent-users:');
    return response;
  });
}

export async function fetchExploreRecentSearchTerms(options: {
  force?: boolean;
  kind: ExploreRecentSearchTermKind;
  limit?: number;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams();
  params.set('kind', options.kind);
  if (typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    params.set('limit', String(Math.max(1, Math.floor(options.limit))));
  }
  const cacheKey = `recent-terms:${params.toString()}`;
  return withExploreSessionCache(cacheKey, options, () =>
    apiRequest<ExploreRecentSearchTermsResponse>(
      `/api/v1/explore/search/recent-terms?${params.toString()}`,
      {
        signal: options.signal,
      },
    ),
  );
}

export async function recordExploreRecentSearchTerm(
  kind: ExploreRecentSearchTermKind,
  query: string,
) {
  return apiRequest<ExploreRecentSearchMutationResponse>(
    '/api/v1/explore/search/recent-terms',
    {
      body: JSON.stringify({ kind, query }),
      method: 'POST',
    },
  ).then(response => {
    clearExploreSessionCache('recent-terms:');
    clearExploreSessionCache('popular-terms:');
    return response;
  });
}

export async function removeExploreRecentSearchTerm(
  kind: ExploreRecentSearchTermKind,
  query: string,
) {
  const params = new URLSearchParams();
  params.set('kind', kind);
  params.set('q', query);
  return apiRequest<ExploreRecentSearchMutationResponse>(
    `/api/v1/explore/search/recent-terms/item?${params.toString()}`,
    {
      method: 'DELETE',
    },
  ).then(response => {
    clearExploreSessionCache('recent-terms:');
    return response;
  });
}

export async function clearExploreRecentSearchTerms(
  kind: ExploreRecentSearchTermKind,
) {
  const params = new URLSearchParams();
  params.set('kind', kind);
  return apiRequest<ExploreRecentSearchMutationResponse>(
    `/api/v1/explore/search/recent-terms?${params.toString()}`,
    {
      method: 'DELETE',
    },
  ).then(response => {
    clearExploreSessionCache('recent-terms:');
    return response;
  });
}

export async function fetchExplorePopularSearchTerms(options: {
  force?: boolean;
  kind: ExploreRecentSearchTermKind;
  limit?: number;
  query?: string;
  scoreModel?: 'a' | 'b';
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams();
  params.set('kind', options.kind);
  if (typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    params.set('limit', String(Math.max(1, Math.floor(options.limit))));
  }
  if (typeof options.query === 'string' && options.query.trim().length > 0) {
    params.set('q', options.query.trim());
  }
  if (options.scoreModel === 'a' || options.scoreModel === 'b') {
    params.set('scoreModel', options.scoreModel);
  }
  const cacheKey = `popular-terms:${params.toString()}`;
  return withExploreSessionCache(cacheKey, options, () =>
    apiRequest<ExplorePopularSearchTermsResponse>(
      `/api/v1/explore/search/popular-terms?${params.toString()}`,
      {
        signal: options.signal,
      },
    ),
  );
}

export async function searchExplorePosts(
  query: string,
  request?: number | ExplorePostSearchRequest,
) {
  const params = new URLSearchParams();
  if (query.trim().length > 0) {
    params.set('q', query.trim());
  }

  const normalizedLimit =
    typeof request === 'number'
      ? request
      : typeof request?.limit === 'number'
      ? request.limit
      : 20;
  params.set('limit', String(Math.max(1, Math.floor(normalizedLimit))));
  if (
    typeof request === 'object' &&
    request?.cursor &&
    request.cursor.trim().length > 0
  ) {
    params.set('cursor', request.cursor.trim());
  }
  if (typeof request === 'object' && request?.mediaType) {
    params.set('mediaType', request.mediaType);
  }
  if (typeof request === 'object' && request?.sort) {
    params.set('sort', request.sort);
  }

  const requestOptions = typeof request === 'object' ? request : undefined;
  const cacheKey = `search-posts:${params.toString()}`;
  return withExploreSessionCache(cacheKey, requestOptions, () =>
    apiRequest<ExplorePostSearchResponse>(
      `/api/v1/explore/search/posts?${params.toString()}`,
      {
        signal: requestOptions?.signal,
      },
    ).then(response => ({
      ...response,
      posts: response.posts.map(post =>
        normalizePost(post as ExplorePost & { segment: string }),
      ),
    })),
  );
}

export async function fetchExploreTrendingTags(
  request:
    | number
    | { force?: boolean; limit?: number; query?: string; signal?: AbortSignal } = 12,
) {
  const params = new URLSearchParams();
  const normalizedLimit =
    typeof request === 'number'
      ? request
      : typeof request?.limit === 'number'
      ? request.limit
      : 12;
  params.set('limit', String(Math.max(1, Math.floor(normalizedLimit))));
  if (
    typeof request === 'object' &&
    request?.query &&
    request.query.trim().length > 0
  ) {
    params.set('q', request.query.trim());
  }
  const requestOptions = typeof request === 'object' ? request : undefined;
  const cacheKey = `trending-tags:${params.toString()}`;
  return withExploreSessionCache(cacheKey, requestOptions, () =>
    apiRequest<ExploreTrendingTagsResponse>(
      `/api/v1/explore/search/trending-tags?${params.toString()}`,
      {
        signal: requestOptions?.signal,
      },
    ),
  );
}

export async function fetchExploreTagDetail(
  tag: string,
  request?: { cursor?: string; limit?: number; signal?: AbortSignal },
) {
  const params = new URLSearchParams();
  const normalizedLimit =
    typeof request?.limit === 'number' && Number.isFinite(request.limit)
      ? Math.max(1, Math.floor(request.limit))
      : 18;
  params.set('limit', String(normalizedLimit));
  if (request?.cursor && request.cursor.trim().length > 0) {
    params.set('cursor', request.cursor.trim());
  }

  const response = await apiRequest<ExploreTagDetailResponse>(
    `/api/v1/explore/tags/${encodeURIComponent(tag.trim().replace(/^#+/, ''))}?${params.toString()}`,
    {
      signal: request?.signal,
    },
  );
  return {
    ...response,
    recentPosts: response.recentPosts.map(post =>
      normalizePost(post as ExplorePost & { segment: string }),
    ),
    topPosts: response.topPosts.map(post =>
      normalizePost(post as ExplorePost & { segment: string }),
    ),
  };
}

export async function fetchStreetFriends(options?: RelationFetchOptions) {
  const cached = !options?.force ? readTimedCache(streetFriendsCache) : null;
  if (cached) {
    return cloneStreetFriendsResponse(cached);
  }

  const hasCustomSignal = Boolean(options?.signal);
  if (!hasCustomSignal && streetFriendsInFlight) {
    return streetFriendsInFlight;
  }

  const requestPromise = apiRequest<ExploreStreetFriendListResponse>(
    '/api/v1/explore/friends',
    {
      signal: options?.signal,
    },
  ).then(response => {
    const normalized = normalizeStreetFriendsResponse(response);
    streetFriendsCache = {
      cachedAt: Date.now(),
      data: cloneStreetFriendsResponse(normalized),
    };
    return cloneStreetFriendsResponse(normalized);
  });

  if (hasCustomSignal) {
    return requestPromise;
  }

  streetFriendsInFlight = requestPromise.finally(() => {
    streetFriendsInFlight = null;
  });
  return streetFriendsInFlight;
}

export async function fetchStreetFriendStatus(userId: string) {
  const normalizedUserId = userId.trim();
  if (normalizedUserId.length === 0) {
    return {
      isStreetFriend: false,
      streetFriendStatus: 'none' as const,
      targetUserId: '',
    };
  }

  const cached = readStreetFriendStatusCache(normalizedUserId);
  if (cached) {
    return cached;
  }

  return withStreetFriendStatusSingleFlight(normalizedUserId, async () => {
    try {
      const response = await apiRequest<ExploreStreetFriendStatusResponse>(
        `/api/v1/explore/friends/${encodeURIComponent(normalizedUserId)}/status`,
      );
      return cacheStreetFriendStatus(normalizedUserId, response);
    } catch (error) {
      if (
        !isApiRequestError(error) ||
        ![404, 405, 501].includes(error.status)
      ) {
        throw error;
      }

      const response = await fetchStreetFriends();
      const isStreetFriend = response.friends.some(
        friend => friend.id === normalizedUserId,
      );
      return cacheStreetFriendStatus(normalizedUserId, {
        isStreetFriend,
        streetFriendStatus: isStreetFriend ? ('accepted' as const) : ('none' as const),
        targetUserId: normalizedUserId,
      });
    }
  });
}

export async function fetchStreetFriendRequests(options?: RelationFetchOptions) {
  const cached = !options?.force
    ? readTimedCache(streetFriendRequestsCache)
    : null;
  if (cached) {
    return cloneStreetFriendRequestsResponse(cached);
  }

  const hasCustomSignal = Boolean(options?.signal);
  if (!hasCustomSignal && streetFriendRequestsInFlight) {
    return streetFriendRequestsInFlight;
  }

  const requestPromise = apiRequest<ExploreStreetFriendRequestListResponse>(
    '/api/v1/explore/street-friend-requests',
    {
      signal: options?.signal,
    },
  ).then(response => {
    const normalized = normalizeStreetFriendRequestsResponse(response);
    streetFriendRequestsCache = {
      cachedAt: Date.now(),
      data: cloneStreetFriendRequestsResponse(normalized),
    };
    return cloneStreetFriendRequestsResponse(normalized);
  });

  if (hasCustomSignal) {
    return requestPromise;
  }

  streetFriendRequestsInFlight = requestPromise.finally(() => {
    streetFriendRequestsInFlight = null;
  });
  return streetFriendRequestsInFlight;
}

export async function fetchFollowers(options?: RelationFetchOptions) {
  const cached = !options?.force ? readTimedCache(followersCache) : null;
  if (cached) {
    return cloneUserListResponse(cached);
  }

  const hasCustomSignal = Boolean(options?.signal);
  if (!hasCustomSignal && followersInFlight) {
    return followersInFlight;
  }

  const requestPromise = apiRequest<ExploreUserListResponse>(
    '/api/v1/profile/followers',
    {
      signal: options?.signal,
    },
  ).then(response => {
    const normalized = normalizeUserListResponse(response);
    followersCache = {
      cachedAt: Date.now(),
      data: cloneUserListResponse(normalized),
    };
    return cloneUserListResponse(normalized);
  });

  if (hasCustomSignal) {
    return requestPromise;
  }

  followersInFlight = requestPromise.finally(() => {
    followersInFlight = null;
  });
  return followersInFlight;
}

export async function fetchFollowing(options?: RelationFetchOptions) {
  const cached = !options?.force ? readTimedCache(followingCache) : null;
  if (cached) {
    return cloneUserListResponse(cached);
  }

  const hasCustomSignal = Boolean(options?.signal);
  if (!hasCustomSignal && followingInFlight) {
    return followingInFlight;
  }

  const requestPromise = apiRequest<ExploreUserListResponse>(
    '/api/v1/profile/following',
    {
      signal: options?.signal,
    },
  ).then(response => {
    const normalized = normalizeUserListResponse(response);
    followingCache = {
      cachedAt: Date.now(),
      data: cloneUserListResponse(normalized),
    };
    return cloneUserListResponse(normalized);
  });

  if (hasCustomSignal) {
    return requestPromise;
  }

  followingInFlight = requestPromise.finally(() => {
    followingInFlight = null;
  });
  return followingInFlight;
}

export async function removeFollower(followerId: string) {
  return apiRequest<ExploreFollowerRemovalResponse>(
    `/api/v1/profile/followers/${encodeURIComponent(followerId)}`,
    {
      method: 'DELETE',
    },
  ).then(response => {
    invalidateFollowersCache();
    return response;
  });
}

export async function removeStreetFriend(friendId: string) {
  const normalizedFriendId = friendId.trim();
  const friendKey =
    normalizedFriendId.length > 0 ? normalizedFriendId : friendId;
  return withStreetFriendSingleFlight(friendKey, () =>
    apiRequest<StreetFriendMutationResponseRaw>(
      `/api/v1/explore/friends/${encodeURIComponent(friendKey)}`,
      {
        method: 'DELETE',
      },
    ).then(rawResponse => {
      const response = normalizeStreetFriendMutationResponse(rawResponse);
      setStreetFriendStatusFromMutation(friendKey, response);
      invalidateStreetFriendsCache();
      invalidateStreetFriendRequestsCache();
      return response;
    }),
  );
}

export function createExploreSocket(
  onMessage: (event: ExploreRealtimeEvent) => void,
) {
  const socket = new WebSocket(EXPLORE_WS_URL);

  socket.onmessage = event => {
    try {
      const parsed = JSON.parse(event.data) as ExploreRealtimeEvent;
      onMessage(
        parsed.comment
          ? {
              ...parsed,
              comment: normalizeComment(parsed.comment),
            }
          : parsed,
      );
    } catch {
      // Ignore malformed events and keep the stream alive.
    }
  };

  return socket;
}

export async function fetchTrackingFollowPath(
  targetUserId: string,
  options?: { limit?: number; signal?: AbortSignal; window?: '15m' | '1h' },
) {
  const normalizedTarget = targetUserId.trim();
  const params: string[] = [];
  if (
    typeof options?.limit === 'number' &&
    Number.isFinite(options.limit)
  ) {
    params.push(`limit=${Math.max(1, Math.floor(options.limit))}`);
  }
  if (options?.window) {
    params.push(`window=${encodeURIComponent(options.window)}`);
  }
  const queryString = params.length > 0 ? `?${params.join('&')}` : '';
  return apiRequest<TrackingFollowPathResponse>(
    `/api/v1/tracking/follow/${encodeURIComponent(normalizedTarget)}${queryString}`,
    {
      signal: options?.signal,
    },
  );
}

export async function triggerLiveFollowNotification(targetUserId: string) {
  const normalizedTargetUserId = targetUserId.trim();
  if (!normalizedTargetUserId) {
    throw new Error('Hedef kullanici secilmedi.');
  }

  return apiRequest<LiveFollowNotificationResponse>(
    '/api/v1/tracking/live-follow/start',
    {
      body: JSON.stringify({
        targetUserId: normalizedTargetUserId,
      }),
      method: 'POST',
    },
  );
}
