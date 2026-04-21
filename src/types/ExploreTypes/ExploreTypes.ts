import type { ExploreSegment } from '../AppTypes/AppTypes';

export type ExploreMediaType = 'photo' | 'video';
export type ExploreReactionKind = 'bookmark' | 'like' | 'share';
export type ExploreRecentSearchTermKind = 'posts' | 'tags' | 'places';
export type ExploreSearchPostFilter = 'all' | 'photo' | 'video';
export type ExploreSearchPostSort = 'popular' | 'recent' | 'relevant';
export type FollowRequestStatus =
  | 'none'
  | 'pending_incoming'
  | 'pending_outgoing';
export type StreetFriendStatus =
  | 'accepted'
  | 'none'
  | 'pending_incoming'
  | 'pending_outgoing';
export type ExploreRealtimeEventType =
  | 'comment.created'
  | 'creator.follow.updated'
  | 'creator.street_friend.updated'
  | 'post.updated'
  | 'welcome';

export interface ExploreStats {
  bookmarksCount: number;
  commentsCount: number;
  likesCount: number;
  sharesCount: number;
}

export interface ExploreAuthor {
  avatarUrl: string;
  id: string;
  isVerified: boolean;
  username: string;
}

export interface ExploreViewerState {
  followRequestStatus: FollowRequestStatus;
  isBookmarked: boolean;
  isFollowing: boolean;
  isLiked: boolean;
  isStreetFriend: boolean;
  streetFriendStatus: StreetFriendStatus;
}

export interface ExplorePost {
  author: ExploreAuthor;
  caption: string;
  createdAt: string;
  id: string;
  location: string;
  mediaType: ExploreMediaType;
  mediaUrl: string;
  rankingScore: number;
  segment: ExploreSegment;
  stats: ExploreStats;
  viewerState: ExploreViewerState;
}

export interface ExploreComment {
  author: ExploreAuthor;
  body: string;
  createdAt: string;
  id: string;
  isLiked: boolean;
  likeCount: number;
  postId: string;
}

export interface ExploreFeedResponse {
  generatedAt: string;
  hasMore: boolean;
  nextCursor?: string;
  posts: ExplorePost[];
  rankVersion: string;
  segment: string;
}

export interface ExploreCommentsResponse {
  comments: ExploreComment[];
  postId: string;
  total: number;
}

export interface ExploreReactionResponse {
  postId: string;
  segment: string;
  stats: ExploreStats;
  viewerState: ExploreViewerState;
}

export interface ExplorePostEngagementUsersResponse {
  postId: string;
  kind: ExploreReactionKind;
  users: ExploreAuthor[];
  total: number;
}

export interface ExplorePostReportResponse {
  postId: string;
  reason: string;
  reportedAt: string;
}

export interface ExploreCommentMutationResponse {
  comment: ExploreComment;
  postId: string;
  segment: string;
  stats: ExploreStats;
}

export interface ExploreCommentLikeResponse {
  comment: ExploreComment;
  postId: string;
}

export interface ExploreFollowResponse {
  creatorId: string;
  followRequestStatus: FollowRequestStatus;
  followsYou: boolean;
  isFollowing: boolean;
  followersCount?: number;
}

export interface ExploreStreetFriendResponse {
  creatorId: string;
  isStreetFriend: boolean;
  streetFriendStatus: StreetFriendStatus;
}

export interface ExploreFollowerRemovalResponse {
  followerId: string;
  removed: boolean;
}

export interface ExploreSearchUserViewerState {
  followRequestStatus: FollowRequestStatus;
  followsYou: boolean;
  isFollowing: boolean;
  isStreetFriend: boolean;
  streetFriendStatus: StreetFriendStatus;
}

export interface ExploreSearchUser {
  avatarUrl: string;
  fullName: string;
  id: string;
  isHiddenByRelationship?: boolean;
  isPrivateAccount: boolean;
  isVerified: boolean;
  username: string;
  viewerState: ExploreSearchUserViewerState;
}

export interface ExploreUserSearchResponse {
  hasMore?: boolean;
  nextCursor?: string;
  query: string;
  users: ExploreSearchUser[];
}

export interface ExploreUserListResponse {
  users: ExploreSearchUser[];
}

export interface ExploreRecentSearchMutationResponse {
  cleared?: boolean;
  deletedCount?: number;
  kind?: ExploreRecentSearchTermKind;
  query?: string;
  removed?: boolean;
  saved?: boolean;
  userId?: string;
}

export interface ExploreRecentSearchTerm {
  kind: ExploreRecentSearchTermKind;
  query: string;
  searchedAt: string;
}

export interface ExploreRecentSearchTermsResponse {
  items: ExploreRecentSearchTerm[];
  kind: ExploreRecentSearchTermKind;
}

export interface ExplorePopularSearchTerm {
  kind: ExploreRecentSearchTermKind;
  lastSearchedAt: string;
  query: string;
  recentSearches: number;
  score: number;
  totalSearches: number;
}

export interface ExplorePopularSearchTermsResponse {
  generatedAt: string;
  items: ExplorePopularSearchTerm[];
  kind: ExploreRecentSearchTermKind;
  query: string;
  scoreModel?: 'a' | 'b';
}

export interface ExplorePostSearchResponse {
  filter?: ExploreSearchPostFilter;
  hasMore?: boolean;
  nextCursor?: string;
  posts: ExplorePost[];
  query: string;
  sort?: ExploreSearchPostSort;
}

export interface ExploreTrendingTag {
  count: number;
  lastUsedAt?: string;
  recentCount?: number;
  score?: number;
  tag: string;
}

export interface ExploreTrendingTagsResponse {
  generatedAt: string;
  tags: ExploreTrendingTag[];
}

export interface ExploreTagDetailSummary {
  count: number;
  lastUsedAt: string;
  recentCount: number;
  score: number;
  tag: string;
}

export interface ExploreTagDetailResponse {
  generatedAt: string;
  recentHasMore?: boolean;
  recentNextCursor?: string;
  recentPosts: ExplorePost[];
  relatedTags: ExploreTrendingTag[];
  tag: ExploreTagDetailSummary;
  topPosts: ExplorePost[];
}

export interface ExploreStreetFriendListItem {
  avatarUrl: string;
  fullName: string;
  id: string;
  isVerified: boolean;
  username: string;
}

export interface ExploreStreetFriendListResponse {
  friends: ExploreStreetFriendListItem[];
}

export interface ExploreStreetFriendStatusResponse {
  isStreetFriend: boolean;
  streetFriendStatus: StreetFriendStatus;
  targetUserId: string;
}

export interface ExploreStreetFriendRequestItem {
  avatarUrl: string;
  fullName: string;
  id: string;
  isVerified: boolean;
  requestedAt: string;
  streetFriendStatus: StreetFriendStatus;
  username: string;
}

export interface ExploreStreetFriendRequestListResponse {
  incomingCount?: number;
  outgoingCount?: number;
  requests: ExploreStreetFriendRequestItem[];
}

export interface ExploreRealtimeEvent {
  comment?: ExploreComment;
  creatorId?: string;
  creatorFollowersCount?: number;
  followerId?: string;
  postId?: string;
  segment?: string;
  serverTime: string;
  stats?: ExploreStats;
  type: ExploreRealtimeEventType;
  viewerState?: ExploreViewerState;
}
