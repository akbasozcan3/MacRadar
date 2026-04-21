import type { ExploreSegment } from '../types/AppTypes/AppTypes';
import type { PublicProfilePostItem } from '../types/AuthTypes/AuthTypes';
import type { ExplorePost } from '../types/ExploreTypes/ExploreTypes';
import { resolveProtectedMediaUrl } from './protectedMedia';

const SEGMENT_EXPLORE: ExploreSegment = 'Ke\u015ffet';

const FALLBACK_AVATAR =
  'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=200&q=80';

let pendingSeed: ExplorePost | null = null;

function mapCreatedProfilePostToExplorePost(
  post: PublicProfilePostItem,
  viewerId: string,
  viewerAvatarUrl: string,
  viewerUsername: string,
): ExplorePost {
  const vs = post.viewerState;
  const normalizedMediaType: ExplorePost['mediaType'] =
    typeof post.mediaType === 'string' &&
    post.mediaType.toLowerCase().includes('video')
      ? 'video'
      : 'photo';
  const popularityScore =
    Number(post.stats.likesCount || 0) +
    Number(post.stats.commentsCount || 0) * 2 +
    Number(post.stats.bookmarksCount || 0) * 1.5 +
    Number(post.stats.sharesCount || 0) * 2.5;
  const trimmedViewerId = viewerId.trim();
  const authorId = post.userId.trim();
  const authorAvatar =
    viewerAvatarUrl.trim().length > 0 ? viewerAvatarUrl.trim() : FALLBACK_AVATAR;

  return {
    author: {
      avatarUrl: authorAvatar,
      id: authorId || trimmedViewerId,
      isVerified: false,
      username:
        post.username.trim().replace(/^@+/, '') ||
        viewerUsername.trim().replace(/^@+/, '') ||
        'kullanici',
    },
    caption: post.caption,
    createdAt: post.createdAt,
    id: post.id,
    location: post.location,
    mediaType: normalizedMediaType,
    mediaUrl: resolveProtectedMediaUrl(post.mediaUrl.trim()),
    rankingScore: popularityScore,
    segment: SEGMENT_EXPLORE,
    stats: post.stats,
    viewerState: {
      followRequestStatus: vs?.followRequestStatus ?? 'none',
      isBookmarked: Boolean(vs?.isBookmarked),
      isFollowing: Boolean(vs?.isFollowing ?? true),
      isLiked: Boolean(vs?.isLiked),
      isStreetFriend: Boolean(vs?.isStreetFriend),
      streetFriendStatus: vs?.streetFriendStatus ?? 'none',
    },
  };
}

export function queueExploreFeedSeedFromCreatedProfilePost(
  post: PublicProfilePostItem,
  viewerId: string,
  viewerAvatarUrl: string,
  viewerUsername: string,
): void {
  if (post.userId.trim() !== viewerId.trim()) {
    return;
  }
  pendingSeed = mapCreatedProfilePostToExplorePost(
    post,
    viewerId,
    viewerAvatarUrl,
    viewerUsername,
  );
}

export function mergePendingExploreSeedIntoPosts(
  segment: ExploreSegment,
  posts: ExplorePost[],
): ExplorePost[] {
  if (segment !== SEGMENT_EXPLORE || !pendingSeed) {
    return posts;
  }
  if (posts.some(p => p.id === pendingSeed!.id)) {
    pendingSeed = null;
    return posts;
  }
  const seed = pendingSeed;
  pendingSeed = null;
  return [seed, ...posts];
}
