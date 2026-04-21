import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated as RNAnimated,
  BackHandler,
  Dimensions,
  Easing as RNEasing,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  StatusBar,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { BlurView } from '@react-native-community/blur';
import { FlashList, type ViewToken } from '@shopify/flash-list';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  SlideInRight,
  SlideOutRight,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import FeatherIcon from '../../components/FeatherIcon/FeatherIcon';
import IosSpinner from '../../components/IosSpinner/IosSpinner';
import { useAlert } from '../../alerts/AlertProvider';
import AppMedia from '../../components/Media/AppMedia';
import PostCard from '../../components/PostCard/PostCard';
import ScreenStateCard, {
  ScreenStateCenter,
} from '../../components/ScreenState/ScreenStateCard';
import { Text, TextInput } from '../../theme/typography';
import { mergePendingExploreSeedIntoPosts } from '../../services/exploreFeedPendingSeed';
import {
  clearExploreRecentUsers,
  clearExploreRecentSearchTerms,
  createExploreSocket,
  fetchExplorePopularSearchTerms,
  fetchExploreRecentSearchTerms,
  fetchExploreTrendingTags,
  fetchExploreTagDetail,
  fetchExploreRecentUsers,
  fetchExploreComments,
  fetchExploreFeed,
  fetchStreetFriendStatus,
  fetchStreetFriends,
  followCreator,
  recordExploreRecentUser,
  recordExploreRecentSearchTerm,
  reportExplorePost,
  removeExploreRecentUser,
  removeExploreRecentSearchTerm,
  removeStreetFriend,
  searchExplorePosts,
  searchExploreUsers,
  sendExploreComment,
  sendExploreCommentLike,
  sendExploreReaction,
  upsertStreetFriend,
} from '../../services/exploreService';
import {
  acceptFollowRequest,
  blockUser,
  fetchPublicProfile,
  fetchPublicProfilePosts,
  rejectFollowRequest,
  reportUser,
  unblockUser,
} from '../../services/authService';
import { isApiRequestError } from '../../services/apiClient';
import { resolveProtectedMediaUrl } from '../../services/protectedMedia';
import { syncExploreReactionCollection } from '../../services/profileMediaService';
import {
  hasStoredExploreShareClick,
  storeExploreShareClick,
} from '../../services/sessionStorage';
import BlockUserConfirmSheet from '../../components/BlockUserConfirmSheet/BlockUserConfirmSheet';
import ExploreHeader from '../../components/Headers/ExploreHeader';
import type {
  ExploreSegment,
  TabKey,
  ExploreViewerRequest,
} from '../../types/AppTypes/AppTypes';
import type {
  PublicProfilePostItem,
  PublicUserProfile,
} from '../../types/AuthTypes/AuthTypes';
import type {
  ExploreComment,
  FollowRequestStatus,
  ExplorePopularSearchTerm,
  ExploreRecentSearchTerm,
  ExplorePost,
  ExploreSearchPostFilter,
  ExploreSearchPostSort,
  ExploreReactionKind,
  ExploreRealtimeEvent,
  ExploreSearchUser,
  ExploreTagDetailResponse,
  ExploreStats,
  ExploreTrendingTag,
  StreetFriendStatus,
} from '../../types/ExploreTypes/ExploreTypes';
import {
  HIDDEN_USER_NOT_FOUND_LABEL,
  resolveUserIdentity,
} from '../../utils/hiddenUser';
import { subscribeAppLanguage, translateText } from '../../i18n/runtime';

const { height: WINDOW_HEIGHT, width } = Dimensions.get('window');

const FALLBACK_AVATAR =
  'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=200&q=80';

const SEGMENT_EXPLORE = 'Ke\u015ffet' as ExploreSegment;
const SEGMENT_FOLLOWING = 'Takipte' as ExploreSegment;
const SEGMENT_FOR_YOU = 'Sizin \u0130\u00e7in' as ExploreSegment;
const TABS: ExploreSegment[] = [
  SEGMENT_EXPLORE,
  SEGMENT_FOLLOWING,
  SEGMENT_FOR_YOU,
];
const FEED_PAGE_LIMIT = 8;
const FEED_PREFETCH_CACHE_TTL_MS = 45_000;
const SEARCH_DEBOUNCE_MS = 120;
const SUGGESTED_USERS_PAGE_SIZE = 12;
const DOUBLE_TAP_MAX_DELAY_MS = 260;
const SEARCH_SUGGESTIONS_CACHE_TTL_MS = 30_000;
// Comments are fairly stable during typical user sessions. Keep them cached longer
// to avoid unnecessary refetch and keep "yuklenmesin" behavior.
const COMMENTS_CACHE_TTL_MS = 600_000; // 10 minutes
const TRENDING_TAG_DETAIL_CACHE_TTL_MS = 45_000;
const TRENDING_TAG_RECENT_PAGE_LIMIT = 18;
const SHOW_RUNTIME_RIBBON = false;
const PUBLIC_PROFILE_POST_CARD_GAP = 16;
const SEARCH_POST_GRID_GAP = 8;
const SEARCH_POST_TILE_SIZE = Math.floor(
  (width - 32 - SEARCH_POST_GRID_GAP * 2) / 3,
);
const SEARCH_POST_TILE_MEDIA_HEIGHT = Math.round(SEARCH_POST_TILE_SIZE * 0.9);
const TRENDING_HERO_MEDIA_HEIGHT = Math.round((width - 32) * 0.46);
const VIDEO_PREVIEW_OFFSET_SEC = 2;
const POST_ITEM_MEDIA_STYLE = {
  height: '100%',
  width: '100%',
} as const;
const EXPLORE_ROOT_STYLE = {
  backgroundColor: '#000000',
  flex: 1,
} as const;
const COMMENTS_BACKDROP_STYLE = StyleSheet.absoluteFillObject;
const COMMENTS_LIST_CONTENT_STYLE = {
  paddingBottom: 30,
} as const;
const COMMENTS_KEYBOARD_AVOIDING_STYLE = {
  justifyContent: 'flex-end',
  width: '100%',
} as const;
const SEARCH_MODAL_HEADER_CHROME_STYLE = {
  elevation: 8,
  shadowColor: '#0f172a',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.06,
  shadowRadius: 18,
  zIndex: 4,
} as const;
const SEARCH_PANEL_ANIMATED_CONTAINER_STYLE = {
  flex: 1,
} as const;
const REPORT_MODAL_SCROLL_CONTENT_STYLE = {
  paddingBottom: 12,
} as const;
const REPORT_MODAL_SCROLL_INSET_STYLE = {
  paddingHorizontal: 20,
  paddingTop: 12,
} as const;
const REPORT_MODAL_SHEET_BASE_STYLE = {
  height: '96%',
} as const;
const COMMENT_LIKE_PENDING_STYLE = {
  opacity: 0.55,
} as const;
const FEED_ERROR_OVERLAY_CARD_STYLE = {
  left: 16,
  position: 'absolute',
  right: 16,
  zIndex: 50,
} as const;
const DOUBLE_TAP_SURFACE_STYLE = StyleSheet.absoluteFillObject;
const DOUBLE_TAP_HEART_OVERLAY_STYLE = {
  ...StyleSheet.absoluteFillObject,
  alignItems: 'center',
  justifyContent: 'center',
} as const;
const LOADING_OVERLAY_ROOT_STYLE = {
  ...StyleSheet.absoluteFillObject,
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 70,
} as const;
const LOADING_OVERLAY_DARK_SURFACE_STYLE = {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: 'rgba(3, 7, 18, 0.36)',
} as const;
const LOADING_OVERLAY_LIGHT_SURFACE_STYLE = {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: 'rgba(15, 23, 42, 0.14)',
} as const;
const DOUBLE_TAP_HEART_BUBBLE_STYLE = {
  alignItems: 'center',
  backgroundColor: 'rgba(255, 90, 31, 0.28)',
  borderColor: 'rgba(255, 255, 255, 0.34)',
  borderRadius: 64,
  borderWidth: 1,
  height: 128,
  justifyContent: 'center',
  shadowColor: '#05070c',
  shadowOffset: { width: 0, height: 12 },
  shadowOpacity: 0.34,
  shadowRadius: 18,
  width: 128,
} as const;
const FOLLOWING_COMPLETE_CARD_STYLE = {
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: WINDOW_HEIGHT,
  paddingBottom: 136,
  paddingHorizontal: 32,
  paddingTop: 104,
} as const;
const FOLLOWING_COMPLETE_ICON_WRAP_STYLE = {
  alignItems: 'center',
  borderColor: 'rgba(255, 90, 31, 0.82)',
  borderRadius: 52,
  borderWidth: 2.5,
  height: 104,
  justifyContent: 'center',
  marginBottom: 28,
  width: 104,
} as const;
const FOLLOWING_COMPLETE_TITLE_STYLE = {
  color: '#f8fafc',
  fontSize: 34,
  fontWeight: '300',
  letterSpacing: -0.8,
  textAlign: 'center',
} as const;
const FOLLOWING_COMPLETE_DESCRIPTION_STYLE = {
  color: '#cbd5e1',
  fontSize: 15,
  lineHeight: 22,
  marginTop: 12,
  maxWidth: 280,
  textAlign: 'center',
} as const;
const FOLLOWING_COMPLETE_BUTTON_STYLE = {
  marginTop: 18,
  paddingHorizontal: 14,
  paddingVertical: 8,
} as const;
const FOLLOWING_COMPLETE_BUTTON_TEXT_STYLE = {
  color: '#38bdf8',
  fontSize: 17,
  fontWeight: '700',
  letterSpacing: -0.2,
} as const;
type SearchPanelTab = 'users' | 'posts' | 'tags' | 'places';
type SearchRecentTermTab = Exclude<SearchPanelTab, 'users'>;
const SEARCH_PANEL_TABS: SearchPanelTab[] = ['users', 'posts', 'tags', 'places'];
const SEARCH_USER_AVATAR_SIZE = 40;
const SEARCH_USER_ROW_GAP = 16;
const SEARCH_USER_ROW_HORIZONTAL_PADDING = 16;
const SEARCH_USER_ROW_MIN_HEIGHT = 58;
const SEARCH_USER_SEPARATOR_INSET_LEFT =
  SEARCH_USER_ROW_HORIZONTAL_PADDING + SEARCH_USER_AVATAR_SIZE + SEARCH_USER_ROW_GAP;
type TagDetailTab = 'top' | 'recent';
type ExploreOverlayRoute =
  | {
    id: string;
    kind: 'trend-tag-detail';
    tag: string;
  }
  | {
    id: string;
    initialIndex: number;
    kind: 'trend-tag-feed';
    sourceTab: TagDetailTab;
    tag: string;
  };
type PostReportReasonOption = {
  backendReason: string;
  icon: string;
  key: string;
  label: string;
};
type SearchPlaceItem = {
  hasVideo: boolean;
  location: string;
  postCount: number;
  previewPost: ExplorePost;
};

const POST_REPORT_REASON_OPTIONS: PostReportReasonOption[] = [
  {
    backendReason: 'spam',
    icon: 'alert-octagon',
    key: 'spam',
    label: 'Spam',
  },
  {
    backendReason: 'harassment_or_bullying',
    icon: 'alert-triangle',
    key: 'harassment_or_bullying',
    label: 'Taciz veya Zorbalik',
  },
  {
    backendReason: 'inappropriate_content',
    icon: 'eye-off',
    key: 'inappropriate_content',
    label: 'Uygunsuz İçerik',
  },
  {
    backendReason: 'violence',
    icon: 'slash',
    key: 'violence',
    label: 'Şiddet',
  },
  {
    backendReason: 'hate_speech',
    icon: 'x-circle',
    key: 'hate_speech',
    label: 'Nefret Söylemi',
  },
  {
    backendReason: 'other',
    icon: 'more-horizontal',
    key: 'other',
    label: 'Diğer',
  },
];

type ExploreRelationshipState = {
  followRequestStatus: FollowRequestStatus;
  followsYou: boolean;
  isFollowing: boolean;
  isStreetFriend: boolean;
  streetFriendStatus: StreetFriendStatus;
};

type ExploreRelationshipCommitPatch = Partial<ExploreRelationshipState> & {
  creatorFollowersCount?: number;
};

type FeedCacheEntry = {
  cachedAt: number;
  generatedAt: string | null;
  hasMore: boolean;
  nextCursor: string | null;
  posts: ExplorePost[];
  rankVersion: string | null;
};

function buildFeedSnapshotSignature(snapshot: FeedCacheEntry) {
  const postSignature = snapshot.posts
    .map(post =>
      [
        post.id,
        post.createdAt,
        post.mediaUrl,
        post.stats.likesCount,
        post.stats.commentsCount,
        post.stats.sharesCount,
        post.viewerState.isFollowing ? '1' : '0',
        post.viewerState.followRequestStatus,
      ].join('|'),
    )
    .join('||');
  return [
    snapshot.generatedAt ?? '',
    snapshot.rankVersion ?? '',
    snapshot.nextCursor ?? '',
    snapshot.hasMore ? '1' : '0',
    postSignature,
  ].join('::');
}

function formatCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1).replace('.0', '')}B`;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace('.0', '')}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace('.0', '')}K`;
  }

  return String(value);
}

function formatTrendingTagMeta(tag: ExploreTrendingTag) {
  const recentCount =
    typeof tag.recentCount === 'number' && Number.isFinite(tag.recentCount)
      ? Math.max(0, Math.round(tag.recentCount))
      : 0;
  const totalCount = Math.max(0, Math.round(tag.count || 0));

  if (recentCount > 0 && totalCount > recentCount) {
    return `Son 48s ${recentCount} / Toplam ${totalCount}`;
  }
  if (recentCount > 0) {
    return `Son 48s ${recentCount}`;
  }
  return totalCount === 1 ? '1 gonderi' : `${totalCount} gonderi`;
}

function normalizeTrendingTagKey(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0131/g, 'i')
    .replace(/\u0130/g, 'i')
    .replace(/\s+/g, ' ');

  return /^[a-z0-9_]{2,32}$/.test(normalized) ? normalized : '';
}

function formatTrendingTagActivity(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) {
    return 'Yeni Etiket';
  }

  return `${formatRelativeTime(value)} Önce`;
}

function compactSearchUserText(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/\s+/g, ' ');
}

function normalizeSearchUserIdentity(value: string | null | undefined) {
  return compactSearchUserText(value)
    .replace(/^@+/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0131/g, 'i')
    .replace(/\u0130/g, 'i');
}

function sanitizeSearchUser(user: ExploreSearchUser): ExploreSearchUser {
  return {
    ...user,
    avatarUrl: compactSearchUserText(user.avatarUrl),
    fullName: compactSearchUserText(user.fullName),
    id: compactSearchUserText(user.id),
    username: compactSearchUserText(user.username).replace(/^@+/, ''),
  };
}

function cleanSearchUserList(users: ExploreSearchUser[]) {
  const seenIds = new Set<string>();
  const seenUsernames = new Set<string>();

  return users.reduce<ExploreSearchUser[]>((accumulator, item) => {
    const user = sanitizeSearchUser(item);
    if (user.id.length === 0 || seenIds.has(user.id)) {
      return accumulator;
    }

    const normalizedUsername = normalizeSearchUserIdentity(user.username);
    if (normalizedUsername.length > 0 && seenUsernames.has(normalizedUsername)) {
      return accumulator;
    }

    seenIds.add(user.id);
    if (normalizedUsername.length > 0) {
      seenUsernames.add(normalizedUsername);
    }

    accumulator.push(user);
    return accumulator;
  }, []);
}

function rankSearchUsersForDisplay(
  users: ExploreSearchUser[],
  query: string,
): ExploreSearchUser[] {
  const normalizedQuery = normalizeSearchUserIdentity(query);
  const displayNameCounts = new Map<string, number>();

  const ranked = [...users].sort((left, right) => {
    const leftIdentity = resolveUserIdentity({
      avatarUrl: left.avatarUrl,
      fullName: left.fullName,
      isHidden: left.isHiddenByRelationship,
      username: left.username,
    });
    const rightIdentity = resolveUserIdentity({
      avatarUrl: right.avatarUrl,
      fullName: right.fullName,
      isHidden: right.isHiddenByRelationship,
      username: right.username,
    });
    const leftName = normalizeSearchUserIdentity(leftIdentity.displayName);
    const rightName = normalizeSearchUserIdentity(rightIdentity.displayName);
    const leftUsername = normalizeSearchUserIdentity(left.username);
    const rightUsername = normalizeSearchUserIdentity(right.username);
    const leftPrefix =
      normalizedQuery.length > 0 &&
      (leftUsername.startsWith(normalizedQuery) || leftName.startsWith(normalizedQuery));
    const rightPrefix =
      normalizedQuery.length > 0 &&
      (rightUsername.startsWith(normalizedQuery) || rightName.startsWith(normalizedQuery));
    if (leftPrefix !== rightPrefix) {
      return leftPrefix ? -1 : 1;
    }

    const leftConnectionScore =
      (left.viewerState.isFollowing ? 4 : 0) +
      (left.viewerState.followsYou ? 3 : 0) +
      (left.viewerState.isStreetFriend ? 2 : 0) +
      (left.isVerified ? 1 : 0);
    const rightConnectionScore =
      (right.viewerState.isFollowing ? 4 : 0) +
      (right.viewerState.followsYou ? 3 : 0) +
      (right.viewerState.isStreetFriend ? 2 : 0) +
      (right.isVerified ? 1 : 0);
    if (leftConnectionScore !== rightConnectionScore) {
      return rightConnectionScore - leftConnectionScore;
    }

    if (leftName !== rightName) {
      return leftName.localeCompare(rightName, 'tr');
    }
    return leftUsername.localeCompare(rightUsername, 'tr');
  });

  return ranked.filter(user => {
    const identity = resolveUserIdentity({
      avatarUrl: user.avatarUrl,
      fullName: user.fullName,
      isHidden: user.isHiddenByRelationship,
      username: user.username,
    });
    const key = normalizeSearchUserIdentity(identity.displayName);
    const currentCount = displayNameCounts.get(key) ?? 0;
    if (key.length > 0 && currentCount >= 3) {
      return false;
    }
    displayNameCounts.set(key, currentCount + 1);
    return true;
  });
}

function applySuggestedUserQualityRules(users: ExploreSearchUser[]) {
  const avatarCounts = new Map<string, number>();
  const displayNameCounts = new Map<string, number>();
  const usernameStemCounts = new Map<string, number>();

  return users.filter(user => {
    const identity = resolveUserIdentity({
      avatarUrl: user.avatarUrl,
      fullName: user.fullName,
      isHidden: user.isHiddenByRelationship,
      username: user.username,
    });
    const normalizedName = normalizeSearchUserIdentity(identity.displayName);
    const normalizedUsername = normalizeSearchUserIdentity(user.username);
    const usernameStem = normalizedUsername.slice(0, 5);
    const avatarKey = compactSearchUserText(user.avatarUrl).toLowerCase();

    const existingAvatarCount = avatarCounts.get(avatarKey) ?? 0;
    const existingNameCount = displayNameCounts.get(normalizedName) ?? 0;
    const existingStemCount = usernameStemCounts.get(usernameStem) ?? 0;

    if (avatarKey.length > 0 && existingAvatarCount >= 2) {
      return false;
    }
    if (normalizedName.length > 0 && existingNameCount >= 2) {
      return false;
    }
    if (usernameStem.length > 0 && existingStemCount >= 2) {
      return false;
    }

    if (avatarKey.length > 0) {
      avatarCounts.set(avatarKey, existingAvatarCount + 1);
    }
    if (normalizedName.length > 0) {
      displayNameCounts.set(normalizedName, existingNameCount + 1);
    }
    if (usernameStem.length > 0) {
      usernameStemCounts.set(usernameStem, existingStemCount + 1);
    }
    return true;
  });
}

function buildSuggestionContextLabel(
  user: ExploreSearchUser,
  relationship: ExploreRelationshipState,
) {
  if (relationship.followsYou) {
    return translateText('3 ortak takipci');
  }
  return translateText('Senin İçin Önerildi');
}

function searchUserDisplayName(user: ExploreSearchUser) {
  const displayName = resolveUserIdentity({
    avatarUrl: user.avatarUrl,
    fullName: user.fullName,
    isHidden: user.isHiddenByRelationship,
    username: user.username,
  }).displayName;
  if (displayName.length > 0) {
    return displayName;
  }

  const fullName = compactSearchUserText(user.fullName);
  if (fullName.length > 0) {
    return fullName;
  }

  const username = compactSearchUserText(user.username).replace(/^@+/, '');
  return username.length > 0 ? username : translateText('Kullanıcı');
}

function searchUserUsernameLabel(user: ExploreSearchUser) {
  const handleLabel = resolveUserIdentity({
    avatarUrl: user.avatarUrl,
    fullName: user.fullName,
    isHidden: user.isHiddenByRelationship,
    username: user.username,
  }).handleLabel;
  if (handleLabel.length > 1) {
    return handleLabel;
  }

  const username = compactSearchUserText(user.username).replace(/^@+/, '');
  return username.length > 0 ? `@${username}` : '@';
}

function userInitials(fullName: string, username: string) {
  const source = (
    compactSearchUserText(fullName) ||
    compactSearchUserText(username).replace(/^@+/, '')
  ).toUpperCase();
  return source.slice(0, 2);
}

type SearchUserCardProps = {
  relationship: ExploreRelationshipState;
  isActionPending: boolean;
  isSuggested: boolean;
  onDismissUser: (user: ExploreSearchUser) => void;
  onFollowUser: (user: ExploreSearchUser) => void;
  isSearchingHistory: boolean;
  onOpenProfile: (user: ExploreSearchUser) => void;
  onRemoveRecentUser: (userId: string) => void;
  user: ExploreSearchUser;
};

type SearchUserListItem =
  | { id: string; title: string; type: 'section' }
  | { type: 'user'; user: ExploreSearchUser };

function SearchUserCard({
  relationship,
  isActionPending,
  isSuggested,
  onDismissUser,
  onFollowUser,
  isSearchingHistory,
  onOpenProfile,
  onRemoveRecentUser,
  user,
}: SearchUserCardProps) {
  const identity = resolveUserIdentity({
    avatarUrl: user.avatarUrl,
    fullName: user.fullName,
    isHidden: user.isHiddenByRelationship,
    username: user.username,
  });
  const displayName = searchUserDisplayName(user);
  const usernameLabel = searchUserUsernameLabel(user);
  const avatarUrl = identity.avatarUrl;
  const suggestionContextLabel = buildSuggestionContextLabel(user, relationship);
  const isFollowRequestPending =
    relationship.followRequestStatus === 'pending_outgoing' &&
    !relationship.isFollowing;
  const followButtonLabel = relationship.isFollowing
    ? 'Takiptesin'
    : isFollowRequestPending
      ? 'Istek Gonderildi'
      : 'Takip Et';
  const followScale = useSharedValue(1);
  const followAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: followScale.value }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        onOpenProfile(user);
      }}
      style={({ pressed }) => [
        isSearchingHistory
          ? SEARCH_USER_CARD_STYLES.historyRow
          : SEARCH_USER_CARD_STYLES.suggestedRow,
        pressed
          ? isSearchingHistory
            ? SEARCH_USER_CARD_STYLES.historyRowPressed
            : SEARCH_USER_CARD_STYLES.suggestedRowPressed
          : null,
      ]}
    >
      <View style={SEARCH_USER_CARD_STYLES.historyRowMain}>
        <View style={SEARCH_USER_CARD_STYLES.historyLeadingWrap}>
          <View style={SEARCH_USER_CARD_STYLES.historyAvatarWrap}>
            {avatarUrl.length > 0 ? (
              <Image
                resizeMode="cover"
                source={{ uri: avatarUrl }}
                style={SEARCH_USER_CARD_STYLES.avatarImage}
              />
            ) : (
              <Text style={SEARCH_USER_CARD_STYLES.avatarFallbackText}>
                {userInitials(user.fullName, user.username) || identity.initials}
              </Text>
            )}
          </View>

          <View
            style={
              isSearchingHistory
                ? SEARCH_USER_CARD_STYLES.historyIdentityWrap
                : SEARCH_USER_CARD_STYLES.suggestedIdentityWrap
            }
          >
            <Text
              numberOfLines={1}
              style={
                isSearchingHistory
                  ? SEARCH_USER_CARD_STYLES.historyDisplayName
                  : SEARCH_USER_CARD_STYLES.suggestedDisplayName
              }
            >
              {displayName}
            </Text>

            <Text
              numberOfLines={1}
              style={
                isSearchingHistory
                  ? SEARCH_USER_CARD_STYLES.historyUsername
                  : SEARCH_USER_CARD_STYLES.suggestedUsername
              }
            >
              {usernameLabel}
            </Text>
            {!isSearchingHistory && isSuggested ? (
              <Text numberOfLines={1} style={SEARCH_USER_CARD_STYLES.suggestedMeta}>
                {suggestionContextLabel}
              </Text>
            ) : null}
          </View>
        </View>

        {isSearchingHistory ? (
          <Pressable
            hitSlop={8}
            onPress={event => {
              event.stopPropagation();
              onRemoveRecentUser(user.id);
            }}
            style={({ pressed }) => [
              SEARCH_USER_CARD_STYLES.historyCloseButton,
              pressed ? SEARCH_USER_CARD_STYLES.historyCloseButtonPressed : null,
            ]}
          >
            <FeatherIcon color="#98a2b3" name="x" size={18} />
          </Pressable>
        ) : isSuggested ? (
          <View style={SEARCH_USER_CARD_STYLES.suggestedActionsWrap}>
            <Animated.View style={followAnimatedStyle}>
              <Pressable
                disabled={isActionPending}
                hitSlop={6}
                onPress={event => {
                  event.stopPropagation();
                  followScale.value = withSequence(
                    withTiming(0.96, { duration: 90 }),
                    withTiming(1, { duration: 130 }),
                  );
                  onFollowUser(user);
                }}
                style={({ pressed }) => [
                  SEARCH_USER_CARD_STYLES.followButton,
                  relationship.isFollowing || isFollowRequestPending
                    ? SEARCH_USER_CARD_STYLES.followButtonMuted
                    : null,
                  pressed ? SEARCH_USER_CARD_STYLES.actionDisabled : null,
                  isActionPending ? SEARCH_USER_CARD_STYLES.actionDisabled : null,
                ]}
              >
                <Text
                  style={[
                    SEARCH_USER_CARD_STYLES.followButtonText,
                    relationship.isFollowing || isFollowRequestPending
                      ? SEARCH_USER_CARD_STYLES.followButtonTextMuted
                      : null,
                  ]}
                >
                  {followButtonLabel}
                </Text>
              </Pressable>
            </Animated.View>
            <Pressable
              hitSlop={8}
              onPress={event => {
                event.stopPropagation();
                onDismissUser(user);
              }}
              style={({ pressed }) => [
                SEARCH_USER_CARD_STYLES.suggestedDismissButton,
                pressed ? SEARCH_USER_CARD_STYLES.historyCloseButtonPressed : null,
              ]}
            >
              <FeatherIcon color="#98a2b3" name="x" size={16} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            hitSlop={8}
            onPress={event => {
              event.stopPropagation();
              onDismissUser(user);
            }}
            style={({ pressed }) => [
              SEARCH_USER_CARD_STYLES.historyCloseButton,
              pressed ? SEARCH_USER_CARD_STYLES.historyCloseButtonPressed : null,
            ]}
          >
            <FeatherIcon color="#98a2b3" name="x" size={18} />
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

const SEARCH_USER_CARD_STYLES = StyleSheet.create({
  actionDisabled: {
    opacity: 0.72,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  avatarFallbackText: {
    color: '#7f8794',
    fontSize: 19,
    fontWeight: '500',
    letterSpacing: -0.15,
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  avatarWrap: {
    alignItems: 'center',
    backgroundColor: '#eef1f4',
    borderRadius: SEARCH_USER_AVATAR_SIZE / 2,
    height: SEARCH_USER_AVATAR_SIZE,
    justifyContent: 'center',
    overflow: 'hidden',
    width: SEARCH_USER_AVATAR_SIZE,
  },
  card: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 2,
    paddingVertical: 14,
  },
  cardPressed: {
    backgroundColor: '#fafbfc',
  },
  contentWrap: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  compactDisplayName: {
    color: '#111827',
    flexShrink: 1,
    fontSize: 14.5,
    fontWeight: '700',
    letterSpacing: -0.15,
  },
  compactInfoWrap: {
    flex: 1,
    justifyContent: 'center',
    marginLeft: 14,
    minWidth: 0,
    paddingRight: 8,
  },
  compactRow: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    minHeight: 72,
    paddingVertical: 11,
  },
  compactRowPressed: {
    backgroundColor: '#fafbfc',
  },
  compactUsername: {
    color: '#7a8495',
    fontSize: 13,
    marginTop: 2,
  },
  displayName: {
    color: '#111827',
    flexShrink: 1,
    fontSize: 15.5,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  followButton: {
    alignItems: 'center',
    backgroundColor: '#171b2d',
    borderColor: '#171b2d',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    height: 36,
    minWidth: 94,
    paddingHorizontal: 16,
  },
  followButtonMuted: {
    backgroundColor: '#ffffff',
    borderColor: '#d6dde6',
  },
  followButtonText: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  followButtonTextMuted: {
    color: '#475467',
  },
  historyAvatarWrap: {
    alignItems: 'center',
    backgroundColor: '#eceef2',
    borderRadius: SEARCH_USER_AVATAR_SIZE / 2,
    height: SEARCH_USER_AVATAR_SIZE,
    justifyContent: 'center',
    overflow: 'hidden',
    width: SEARCH_USER_AVATAR_SIZE,
  },
  historyCloseButton: {
    alignItems: 'center',
    borderRadius: 14,
    height: 30,
    justifyContent: 'center',
    marginLeft: 8,
    marginRight: 0,
    flexShrink: 0,
    width: 30,
  },
  historyCloseButtonPressed: {
    backgroundColor: '#f3f5f8',
  },
  historyDisplayName: {
    color: '#171c28',
    flexShrink: 1,
    fontSize: 15.5,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  historyIdentityWrap: {
    flex: 1,
    marginLeft: SEARCH_USER_ROW_GAP,
    minWidth: 0,
    paddingRight: 4,
  },
  historyLeadingWrap: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    minWidth: 0,
  },
  historyRow: {
    backgroundColor: '#ffffff',
    minHeight: SEARCH_USER_ROW_MIN_HEIGHT,
    paddingHorizontal: SEARCH_USER_ROW_HORIZONTAL_PADDING,
    paddingVertical: 10,
  },
  historyRowMain: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    maxWidth: 430,
    minWidth: 0,
    paddingHorizontal: 4,
    width: '100%',
  },
  historyRowPressed: {
    backgroundColor: '#fafbfc',
  },
  historyUsername: {
    color: '#7f8794',
    fontSize: 12.5,
    fontWeight: '500',
    marginTop: 1,
  },
  resultDisplayName: {
    color: '#101828',
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.18,
  },
  resultIdentityWrap: {
    flex: 1,
    justifyContent: 'center',
    marginLeft: 14,
    minWidth: 0,
    paddingRight: 4,
  },
  resultRowMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    minWidth: 0,
  },
  resultUsername: {
    color: '#8b95a7',
    fontSize: 12.5,
    marginTop: 2,
  },
  identityWrap: {
    flex: 1,
    marginRight: 10,
    minWidth: 0,
  },
  messageButton: {
    alignItems: 'center',
    backgroundColor: '#f3f6fb',
    borderColor: '#d6deea',
    borderRadius: 16,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  metaBadge: {
    backgroundColor: '#f5f7fb',
    borderColor: '#e6ebf3',
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 6,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  metaBadgeText: {
    color: '#667085',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
  },
  nameRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  rowMain: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  streetButton: {
    alignItems: 'center',
    backgroundColor: '#fff3e8',
    borderColor: '#f2ab72',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    height: 36,
    minWidth: 108,
    paddingHorizontal: 14,
  },
  streetButtonMuted: {
    backgroundColor: '#f2f5f8',
    borderColor: '#d7dee8',
  },
  streetButtonText: {
    color: '#c96f2d',
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  streetButtonTextMuted: {
    color: '#667085',
  },
  suggestedDisplayName: {
    color: '#101828',
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.18,
  },
  suggestedIdentityWrap: {
    flex: 1,
    marginLeft: SEARCH_USER_ROW_GAP,
    minWidth: 0,
    paddingRight: 4,
  },
  suggestedRow: {
    backgroundColor: '#ffffff',
    minHeight: SEARCH_USER_ROW_MIN_HEIGHT,
    paddingHorizontal: SEARCH_USER_ROW_HORIZONTAL_PADDING,
    paddingVertical: 12,
  },
  suggestedRowPressed: {
    backgroundColor: '#f7f9fc',
  },
  suggestedMeta: {
    color: '#98a2b3',
    fontSize: 11.5,
    fontWeight: '500',
    marginTop: 2,
  },
  suggestedUsername: {
    color: '#98a2b3',
    fontSize: 12.5,
    fontWeight: '500',
    marginTop: 2,
  },
  suggestedActionsWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    marginLeft: 8,
  },
  suggestedDismissButton: {
    alignItems: 'center',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    marginLeft: 6,
    opacity: 0.62,
    width: 28,
  },
  skeletonAvatar: {
    backgroundColor: '#edf1f5',
    borderRadius: SEARCH_USER_AVATAR_SIZE / 2,
    height: SEARCH_USER_AVATAR_SIZE,
    width: SEARCH_USER_AVATAR_SIZE,
  },
  skeletonButton: {
    backgroundColor: '#edf1f5',
    borderRadius: 999,
    height: 34,
    marginLeft: 12,
    width: 90,
  },
  skeletonMeta: {
    backgroundColor: '#f1f4f8',
    borderRadius: 6,
    height: 10,
    marginTop: 8,
    width: 130,
  },
  skeletonName: {
    backgroundColor: '#e8edf3',
    borderRadius: 6,
    height: 13,
    width: 150,
  },
  skeletonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: SEARCH_USER_ROW_HORIZONTAL_PADDING,
    paddingVertical: 12,
  },
  skeletonTextWrap: {
    flex: 1,
    marginLeft: SEARCH_USER_ROW_GAP,
  },
  skeletonUsername: {
    backgroundColor: '#eef2f6',
    borderRadius: 6,
    height: 11,
    marginTop: 8,
    width: 110,
  },
  skeletonWrap: {
    paddingTop: 6,
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  trailingIconButton: {
    alignItems: 'center',
    backgroundColor: '#f7f9fc',
    borderRadius: 12,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  username: {
    color: '#7a8495',
    fontSize: 12.5,
    marginTop: 2,
  },
});

const SEARCH_USER_LIST_SEPARATOR_STYLE = {
  backgroundColor: '#e8eaef',
  height: StyleSheet.hairlineWidth,
  marginLeft: SEARCH_USER_SEPARATOR_INSET_LEFT,
  marginRight: SEARCH_USER_ROW_HORIZONTAL_PADDING,
} as const;

const SEARCH_USER_HISTORY_SEPARATOR_STYLE = {
  backgroundColor: '#e8eaef',
  height: StyleSheet.hairlineWidth,
  marginLeft: SEARCH_USER_SEPARATOR_INSET_LEFT,
  marginRight: SEARCH_USER_ROW_HORIZONTAL_PADDING,
} as const;

function SearchUserListSeparator() {
  return <View style={SEARCH_USER_LIST_SEPARATOR_STYLE} />;
}

function SearchUserHistorySeparator() {
  return <View style={SEARCH_USER_HISTORY_SEPARATOR_STYLE} />;
}

function SearchUserSkeletonList() {
  return (
    <View style={SEARCH_USER_CARD_STYLES.skeletonWrap}>
      {Array.from({ length: 5 }, (_, index) => (
        <View key={`search-user-skeleton-${index}`} style={SEARCH_USER_CARD_STYLES.skeletonRow}>
          <View style={SEARCH_USER_CARD_STYLES.skeletonAvatar} />
          <View style={SEARCH_USER_CARD_STYLES.skeletonTextWrap}>
            <View style={SEARCH_USER_CARD_STYLES.skeletonName} />
            <View style={SEARCH_USER_CARD_STYLES.skeletonUsername} />
            <View style={SEARCH_USER_CARD_STYLES.skeletonMeta} />
          </View>
          <View style={SEARCH_USER_CARD_STYLES.skeletonButton} />
        </View>
      ))}
    </View>
  );
}

function SearchUserSectionHeader({ title }: { title: string }) {
  return (
    <View className="bg-white px-4 pb-2 pt-4">
      <View className="flex-row items-center">
        <View className="h-[1px] flex-1 bg-[#edf1f5]" />
        <View className="mx-2 rounded-full border border-[#e4e7ec] bg-[#f8fafc] px-2.5 py-1">
          <Text className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[#667085]">
            {title}
          </Text>
        </View>
        <View className="h-[1px] flex-1 bg-[#edf1f5]" />
      </View>
    </View>
  );
}

type AuthorLike = {
  avatarUrl?: string | null;
  id?: string | null;
  username?: string | null;
};

function resolveDisplayedAuthorAvatar(
  author: AuthorLike | null | undefined,
  viewerId: string,
  viewerAvatarUrl: string,
  viewerUsername = '',
) {
  const normalizedViewerId = viewerId.trim();
  const normalizedViewerAvatar = viewerAvatarUrl.trim();
  const authorId = safeAuthorId(author);
  if (
    normalizedViewerAvatar.length > 0 &&
    normalizedViewerId.length > 0 &&
    authorIdsEqual(authorId, normalizedViewerId)
  ) {
    return normalizedViewerAvatar;
  }
  const viewerUserKey = normalizeUsernameKey(viewerUsername);
  const authorUserKey = normalizeUsernameKey(safeAuthorUsername(author));
  if (
    normalizedViewerAvatar.length > 0 &&
    viewerUserKey.length > 0 &&
    authorUserKey.length > 0 &&
    authorUserKey === viewerUserKey
  ) {
    return normalizedViewerAvatar;
  }
  const raw =
    typeof author?.avatarUrl === 'string' ? author.avatarUrl.trim() : '';
  const resolved = resolveProtectedMediaUrl(raw);
  if (resolved.length > 0) {
    return resolved;
  }
  return FALLBACK_AVATAR;
}

function patchViewerAuthorAvatarsInPosts(
  previous: ExplorePost[],
  viewerId: string,
  viewerAvatarUrl: string,
  viewerUsername = '',
): ExplorePost[] {
  const vid = viewerId.trim();
  const vAv = viewerAvatarUrl.trim();
  const vu = normalizeUsernameKey(viewerUsername);
  if (!vAv || (!vid && !vu)) {
    return previous;
  }
  const isViewerPost = (post: ExplorePost) => {
    if (vid.length > 0 && authorIdsEqual(safeAuthorId(post.author), vid)) {
      return true;
    }
    if (
      vu.length > 0 &&
      normalizeUsernameKey(safeAuthorUsername(post.author)) === vu
    ) {
      return true;
    }
    return false;
  };
  let changed = false;
  const next = previous.map(post => {
    if (!isViewerPost(post)) {
      return post;
    }
    const current = post.author.avatarUrl?.trim() ?? '';
    if (current === vAv) {
      return post;
    }
    changed = true;
    return {
      ...post,
      author: {
        ...post.author,
        avatarUrl: vAv,
      },
    };
  });
  return changed ? next : previous;
}

function safeAuthorId(author: AuthorLike | null | undefined) {
  return typeof author?.id === 'string' ? author.id.trim() : '';
}

function safeAuthorUsername(author: AuthorLike | null | undefined) {
  const candidate =
    typeof author?.username === 'string' ? author.username.trim() : '';
  return candidate.length > 0 ? candidate : 'unknown';
}

function normalizeUsernameKey(value: string | null | undefined) {
  try {
    return String(value ?? '')
      .normalize('NFKC')
      .trim()
      .replace(/^@+/, '')
      .toLowerCase()
      .replace(/\s+/g, '');
  } catch {
    return String(value ?? '')
      .trim()
      .replace(/^@+/, '')
      .toLowerCase()
      .replace(/\s+/g, '');
  }
}

function authorIdsEqual(a: string, b: string) {
  const x = a.trim();
  const y = b.trim();
  if (!x || !y) {
    return false;
  }
  return x.toLowerCase() === y.toLowerCase();
}

function mapExploreAuthorToSearchUser(
  author: ExplorePost['author'],
  viewerState: ExplorePost['viewerState'],
  viewerId: string,
  viewerAvatarUrl: string,
  viewerUsername: string,
): ExploreSearchUser {
  return {
    avatarUrl: resolveDisplayedAuthorAvatar(
      author,
      viewerId,
      viewerAvatarUrl,
      viewerUsername,
    ),
    fullName: '',
    id: safeAuthorId(author),
    isPrivateAccount: false,
    isVerified: Boolean(author.isVerified),
    username: safeAuthorUsername(author).replace(/^@+/, ''),
    viewerState: {
      followRequestStatus: viewerState.followRequestStatus,
      followsYou: false,
      isFollowing: viewerState.isFollowing,
      isStreetFriend: viewerState.isStreetFriend,
      streetFriendStatus: viewerState.streetFriendStatus,
    },
  };
}

function isRecentSearchTab(tab: SearchPanelTab): tab is SearchRecentTermTab {
  return tab === 'posts' || tab === 'tags' || tab === 'places';
}

function mapViewerRequestPostToExplorePost(
  post: ExploreViewerRequest['posts'][number],
  viewerId: string,
  viewerAvatarUrl: string,
  viewerUsername = '',
): ExplorePost {
  const rawStats = post.stats ?? {};
  const rawViewerState = post.viewerState ?? {};
  const authorId = post.authorId?.trim() || '';
  const rawAuthorAvatar = post.authorAvatarUrl?.trim() || '';
  const normalizedViewerId = viewerId.trim();
  const normalizedViewerAvatar = viewerAvatarUrl.trim();
  const viewerUserKey = normalizeUsernameKey(viewerUsername);
  const authorUserKey = normalizeUsernameKey(post.authorUsername);
  const idMatches =
    normalizedViewerId.length > 0 &&
    authorId.length > 0 &&
    authorIdsEqual(authorId, normalizedViewerId);
  const usernameMatches =
    normalizedViewerAvatar.length > 0 &&
    viewerUserKey.length > 0 &&
    authorUserKey.length > 0 &&
    authorUserKey === viewerUserKey;
  let authorAvatar =
    idMatches || usernameMatches
      ? normalizedViewerAvatar
      : resolveProtectedMediaUrl(rawAuthorAvatar);
  if (authorAvatar.length === 0) {
    authorAvatar = FALLBACK_AVATAR;
  }
  return {
    author: {
      avatarUrl: authorAvatar,
      id: authorId,
      isVerified: false,
      username:
        post.authorUsername?.trim().replace(/^@+/, '') || 'kullanici',
    },
    caption: post.caption,
    createdAt: post.createdAt,
    id: post.id,
    location: post.location,
    mediaType: post.mediaType === 'video' ? 'video' : 'photo',
    mediaUrl: post.mediaUrl,
    rankingScore: 0,
    segment: SEGMENT_EXPLORE,
    stats: {
      bookmarksCount: Number(rawStats.bookmarksCount ?? 0),
      commentsCount: Number(rawStats.commentsCount ?? 0),
      likesCount: Number(rawStats.likesCount ?? 0),
      sharesCount: Number(rawStats.sharesCount ?? 0),
    },
    viewerState: {
      followRequestStatus: rawViewerState.followRequestStatus ?? 'none',
      isBookmarked: Boolean(rawViewerState.isBookmarked),
      isFollowing: Boolean(rawViewerState.isFollowing),
      isLiked: Boolean(rawViewerState.isLiked),
      isStreetFriend: Boolean(rawViewerState.isStreetFriend),
      streetFriendStatus: rawViewerState.streetFriendStatus ?? 'none',
    },
  };
}

function normalizeExploreUsernameKey(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/^@+/, '').toLowerCase();
}

type LoadingOverlayTone = 'dark' | 'light';

function LoadingOverlay({ tone = 'light' }: { tone?: LoadingOverlayTone }) {
  const isDark = tone === 'dark';
  return (
    <View pointerEvents="auto" style={LOADING_OVERLAY_ROOT_STYLE}>
      <BlurView
        blurAmount={14}
        blurType={isDark ? 'dark' : 'light'}
        reducedTransparencyFallbackColor={
          isDark ? 'rgba(7, 10, 15, 0.74)' : 'rgba(243, 244, 247, 0.86)'
        }
        style={StyleSheet.absoluteFillObject}
      />
      <View
        style={
          isDark
            ? LOADING_OVERLAY_DARK_SURFACE_STYLE
            : LOADING_OVERLAY_LIGHT_SURFACE_STYLE
        }
      />
      <IosSpinner color="#ff5a1f" size="large" />
    </View>
  );
}

function formatRelativeTime(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));

  if (diffMinutes < 60) {
    return `${diffMinutes} dk`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} sa`;
  }

  return `${Math.floor(diffHours / 24)} g`;
}

function formatBackendSyncTime(value: string | null) {
  if (!value) {
    return '--:--:--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--:--:--';
  }

  return date.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function mergeComment(comments: ExploreComment[], comment: ExploreComment) {
  if (comments.some(existing => existing.id === comment.id)) {
    return comments;
  }

  return [comment, ...comments];
}

function patchPost(
  posts: ExplorePost[],
  postId: string,
  updater: (post: ExplorePost) => ExplorePost,
) {
  return posts.map(post => (post.id === postId ? updater(post) : post));
}

function patchComment(
  comments: ExploreComment[],
  commentId: string,
  updater: (comment: ExploreComment) => ExploreComment,
) {
  return comments.map(comment =>
    comment.id === commentId ? updater(comment) : comment,
  );
}

function patchPublicProfilePost(
  posts: PublicProfilePostItem[],
  postId: string,
  updater: (post: PublicProfilePostItem) => PublicProfilePostItem,
) {
  return posts.map(post => (post.id === postId ? updater(post) : post));
}

type RelationshipPatch = {
  followRequestStatus?: FollowRequestStatus;
  isFollowing?: boolean;
  isStreetFriend?: boolean;
  streetFriendStatus?: StreetFriendStatus;
};

type ReactionOptions = {
  forceActive?: boolean;
};

function patchAuthor(
  posts: ExplorePost[],
  authorId: string,
  relationship: RelationshipPatch,
) {
  return posts.map(post =>
    authorIdsEqual(safeAuthorId(post.author), authorId)
      ? {
        ...post,
        viewerState: {
          ...post.viewerState,
          ...(typeof relationship.isFollowing === 'boolean'
            ? { isFollowing: relationship.isFollowing }
            : {}),
          ...(relationship.followRequestStatus
            ? { followRequestStatus: relationship.followRequestStatus }
            : {}),
          ...(typeof relationship.isStreetFriend === 'boolean'
            ? { isStreetFriend: relationship.isStreetFriend }
            : {}),
          ...(relationship.streetFriendStatus
            ? { streetFriendStatus: relationship.streetFriendStatus }
            : {}),
        },
      }
      : post,
  );
}

function getOptimisticStats(
  stats: ExploreStats,
  kind: ExploreReactionKind,
  active: boolean,
) {
  switch (kind) {
    case 'bookmark':
      return {
        ...stats,
        bookmarksCount: Math.max(stats.bookmarksCount + (active ? 1 : -1), 0),
      };
    case 'share':
      return {
        ...stats,
        sharesCount: stats.sharesCount + 1,
      };
    default:
      return {
        ...stats,
        likesCount: Math.max(stats.likesCount + (active ? 1 : -1), 0),
      };
  }
}

function resolveExploreCommentError(error: unknown, fallback: string) {
  if (isApiRequestError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (
      message.length > 0 &&
      !/unabletoresolveerror/i.test(message) &&
      !/unable to resolve/i.test(message)
    ) {
      return message;
    }
  }

  return fallback;
}

function buildExploreSharePayload(post: ExplorePost) {
  const authorHandle = safeAuthorUsername(post.author);
  const caption = post.caption.trim();
  const location = post.location.trim();
  const parts = [
    `${authorHandle} gonderisini MacRadar'da incele`,
    caption.length > 0 ? caption : null,
    location.length > 0 ? `Konum: ${location}` : null,
    post.mediaUrl.trim().length > 0 ? post.mediaUrl.trim() : null,
  ].filter(Boolean);

  return {
    message: parts.join('\n\n'),
    title: 'MacRadar gonderisi',
    url: post.mediaUrl.trim().length > 0 ? post.mediaUrl.trim() : undefined,
  };
}

type CommentsCacheEntry = {
  cachedAt: number;
  comments: ExploreComment[];
};

function defaultRelationshipState(): ExploreRelationshipState {
  return {
    followRequestStatus: 'none',
    followsYou: false,
    isFollowing: false,
    isStreetFriend: false,
    streetFriendStatus: 'none',
  };
}

function streetFriendActionLabel(status: StreetFriendStatus) {
  switch (status) {
    case 'accepted':
      return translateText('Yakındakilerden Çık');
    case 'pending_incoming':
      return translateText('Yakındakileri Kabul Et');
    case 'pending_outgoing':
      return translateText('Geri Cek');
    default:
      return translateText('Yakındakilere Ekle');
  }
}

function resolveEmptyFeedState(segment: ExploreSegment) {
  if (segment === SEGMENT_FOLLOWING) {
    return {
      description: translateText(
        'Takip ettigin hesaplarda su an yeni paylasim yok. Kisa bir sure sonra tekrar yenileyebilirsin.',
      ),
      title: translateText('Takipte su an sakin'),
    };
  }

  if (segment === SEGMENT_FOR_YOU) {
    return {
      description: translateText(
        'Sana Özel Öneriler Hazırlanıyor. Birazdan tekrar denersen yeni icerikler gorebilirsin.',
      ),
      title: translateText('Sizin İçin Hazırlanıyor'),
    };
  }

  return {
    description: translateText(
      'Kesfet Akışında Şu an Gösterilcek İçerik yok. Kısa bir sure sure sonra yeni Paylaşımlar burada listelenecek.',
    ),
    title: translateText('Kesfet su an Boş'),
  };
}

const PostItem = React.memo(
  function PostItem({
    isActive,
    item,
    safeBottom,
    viewerAvatarUrl,
    viewerId,
    viewerUsername,
    onDoubleTapLike,
    onOpenAuthorProfile,
    onOpenComments,
    onReport,
    onReact,
    onShare,
    onToggleFollow: _onToggleFollow,
  }: {
    isActive: boolean;
    item: ExplorePost;
    safeBottom: number;
    viewerAvatarUrl: string;
    viewerId: string;
    viewerUsername: string;
    onDoubleTapLike: (post: ExplorePost) => void;
    onOpenAuthorProfile: (post: ExplorePost) => void;
    onOpenComments: (post: ExplorePost) => void;
    onReport: (post: ExplorePost) => void;
    onReact: (post: ExplorePost, kind: ExploreReactionKind) => void;
    onShare: (post: ExplorePost) => void;
    onToggleFollow: (post: ExplorePost) => void;
  }) {
    const heartScale = useSharedValue(0.2);
    const heartOpacity = useSharedValue(0);
    const lastTapAtRef = useRef(0);
    const tapResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const postItemContainerStyle = {
      height: WINDOW_HEIGHT,
      width,
    };
    const postMetaContainerStyle = {
      paddingBottom: Math.max(safeBottom, 18) + 14,
      paddingHorizontal: 16,
    };
    const authorHandle = safeAuthorUsername(item.author).replace(/^@+/, '');
    const displayedAuthorAvatarUri = resolveDisplayedAuthorAvatar(
      item.author,
      viewerId,
      viewerAvatarUrl,
      viewerUsername,
    );
    const captionText =
      item.caption.trim().length > 0
        ? item.caption.trim()
        : item.location.trim().length > 0
          ? item.location.trim()
          : 'Yeni gonderi';
    const canOpenAuthorProfile = safeAuthorId(item.author).length > 0;
    const likeCount = Math.max(0, item.stats.likesCount);
    const commentCount = Math.max(0, item.stats.commentsCount);
    const bookmarkCount = Math.max(0, item.stats.bookmarksCount);
    const shareCount = Math.max(0, item.stats.sharesCount);
    const postActionShellStyle = {
      backgroundColor: 'rgba(19, 24, 34, 0.74)',
      borderColor: 'rgba(255, 255, 255, 0.14)',
      borderRadius: 26,
      borderWidth: 1,
      minHeight: 74,
      paddingHorizontal: 12,
      paddingVertical: 8,
    };
    const heartOverlayStyle = useAnimatedStyle(() => ({
      opacity: heartOpacity.value,
      transform: [{ scale: heartScale.value }],
    }));

    useEffect(() => {
      return () => {
        if (tapResetTimerRef.current) {
          clearTimeout(tapResetTimerRef.current);
          tapResetTimerRef.current = null;
        }
      };
    }, []);

    const playDoubleTapHeart = useCallback(() => {
      heartOpacity.value = 0;
      heartScale.value = 0.34;
      heartOpacity.value = withSequence(
        withTiming(1, { duration: 90, easing: Easing.out(Easing.cubic) }),
        withTiming(1, { duration: 190 }),
        withTiming(0, { duration: 210, easing: Easing.in(Easing.quad) }),
      );
      heartScale.value = withSequence(
        withTiming(1.14, {
          duration: 180,
          easing: Easing.out(Easing.back(1.6)),
        }),
        withTiming(1, { duration: 110, easing: Easing.out(Easing.quad) }),
        withTiming(0.76, { duration: 210, easing: Easing.in(Easing.quad) }),
      );
    }, [heartOpacity, heartScale]);

    const handleMediaSurfacePress = useCallback(() => {
      const now = Date.now();
      const elapsed = now - lastTapAtRef.current;
      if (elapsed > 0 && elapsed <= DOUBLE_TAP_MAX_DELAY_MS) {
        lastTapAtRef.current = 0;
        if (tapResetTimerRef.current) {
          clearTimeout(tapResetTimerRef.current);
          tapResetTimerRef.current = null;
        }
        onDoubleTapLike(item);
        playDoubleTapHeart();
        return;
      }

      lastTapAtRef.current = now;
      if (tapResetTimerRef.current) {
        clearTimeout(tapResetTimerRef.current);
      }
      tapResetTimerRef.current = setTimeout(() => {
        lastTapAtRef.current = 0;
        tapResetTimerRef.current = null;
      }, DOUBLE_TAP_MAX_DELAY_MS + 16);
    }, [item, onDoubleTapLike, playDoubleTapHeart]);

    return (
      <View style={postItemContainerStyle}>
        <AppMedia
          durationLabelMode="remaining"
          mediaType={item.mediaType}
          mediaUrl={item.mediaUrl}
          mode="autoplay"
          muted={true}
          paused={!isActive}
          previewLoopFromOffset={item.mediaType === 'video'}
          previewStartOffsetSec={
            item.mediaType === 'video' ? VIDEO_PREVIEW_OFFSET_SEC : 0
          }
          showVideoBadge={item.mediaType === 'video'}
          showVideoDurationLabel={item.mediaType === 'video'}
          showVideoTypePill={item.mediaType === 'video'}
          style={POST_ITEM_MEDIA_STYLE}
        />
        <Pressable
          android_disableSound={true}
          onPress={handleMediaSurfacePress}
          style={DOUBLE_TAP_SURFACE_STYLE}
        >
          <Animated.View
            pointerEvents="none"
            style={[DOUBLE_TAP_HEART_OVERLAY_STYLE, heartOverlayStyle]}
          >
            <View style={DOUBLE_TAP_HEART_BUBBLE_STYLE}>
              <FeatherIcon
                color="#ffffff"
                name="heart"
                size={70}
                strokeWidth={2.7}
              />
            </View>
          </Animated.View>
        </Pressable>

        <View className="absolute inset-0 bg-black/10" pointerEvents="none" />

        <View
          className="absolute bottom-0 left-0 right-0 h-2/3 justify-end"
          pointerEvents="none"
        >
          {Array.from({ length: 24 }).map((_, index) => {
            const overlayShadeStyle = {
              backgroundColor: `rgba(3, 7, 18, ${Math.pow(index / 23, 1.4) * 0.86
                })`,
              flex: 1,
            };
            return <View key={index} style={overlayShadeStyle} />;
          })}
        </View>

        <View
          className="absolute bottom-0 left-0 right-0 z-40"
          style={postMetaContainerStyle}
        >
          <Pressable
            className="mb-4 flex-row items-center self-start"
            disabled={!canOpenAuthorProfile}
            onPress={() => {
              onOpenAuthorProfile(item);
            }}
            style={({ pressed }) => (pressed ? { opacity: 0.76 } : null)}
          >
            <View className="mr-3 rounded-full border border-white/30 bg-white/10 p-[1px]">
              <Image
                key={displayedAuthorAvatarUri}
                source={{ uri: displayedAuthorAvatarUri }}
                className="h-12 w-12 rounded-full"
              />
            </View>
            <Text className="text-[17px] font-semibold tracking-tight text-white">
              @{authorHandle}
            </Text>
          </Pressable>

          <Text
            className="mb-5 text-[13px] font-normal tracking-tight text-white/95"
            numberOfLines={2}
          >
            {captionText}
          </Text>

          <View style={postActionShellStyle}>
            <View className="flex-row items-center justify-between">
              <Pressable
                className="h-12 min-w-[56px] flex-row items-center justify-center rounded-[18px] px-2"
                onPress={() => {
                  onReact(item, 'like');
                }}
              >
                <FeatherIcon
                  color={item.viewerState.isLiked ? '#ff6b8e' : '#f8fafc'}
                  name="heart"
                  size={22}
                  strokeWidth={1.75}
                />
                <Text className="ml-2 text-[14px] font-medium text-white">
                  {formatCount(likeCount)}
                </Text>
              </Pressable>

              <Pressable
                className="h-12 min-w-[56px] flex-row items-center justify-center rounded-[18px] px-2"
                onPress={() => {
                  onOpenComments(item);
                }}
              >
                <FeatherIcon
                  color="#f8fafc"
                  name="message-circle"
                  size={22}
                  strokeWidth={1.75}
                />
                <Text className="ml-2 text-[14px] font-medium text-white">
                  {formatCount(commentCount)}
                </Text>
              </Pressable>

              <Pressable
                className="h-12 min-w-[56px] flex-row items-center justify-center rounded-[18px] px-2"
                onPress={() => {
                  onReact(item, 'bookmark');
                }}
              >
                <FeatherIcon
                  color={item.viewerState.isBookmarked ? '#f5d27b' : '#f8fafc'}
                  name="bookmark"
                  size={22}
                  strokeWidth={1.75}
                />
                <Text className="ml-2 text-[14px] font-medium text-white">
                  {formatCount(bookmarkCount)}
                </Text>
              </Pressable>

              <Pressable
                className="h-12 min-w-[56px] flex-row items-center justify-center rounded-[18px] px-2"
                onPress={() => {
                  onShare(item);
                }}
              >
                <FeatherIcon
                  color="#f8fafc"
                  name="share-2"
                  size={22}
                  strokeWidth={1.75}
                />
                <Text className="ml-2 text-[14px] font-medium text-white">
                  {formatCount(shareCount)}
                </Text>
              </Pressable>

              <Pressable
                className="h-12 min-w-[52px] items-center justify-center rounded-[18px] px-2"
                onPress={() => {
                  onReport(item);
                }}
              >
                <FeatherIcon
                  color="#f8fafc"
                  name="flag"
                  size={22}
                  strokeWidth={1.75}
                />
              </Pressable>
            </View>
            <Text className="mt-1 text-center text-[11px] text-white/45">
              {item.location} - {formatRelativeTime(item.createdAt)}
            </Text>
          </View>
        </View>
      </View>
    );
  },
  (prevProps, nextProps) =>
    prevProps.isActive === nextProps.isActive &&
    prevProps.item === nextProps.item &&
    prevProps.safeBottom === nextProps.safeBottom,
);

type TrendTagDetailPageProps = {
  activePosts: ExplorePost[];
  activeTagKey: string | null;
  detail: ExploreTagDetailResponse | null;
  detailError: string | null;
  isFetchingMore: boolean;
  isLoading: boolean;
  onBack: () => void;
  onLoadMore: () => void;
  onOpenPost: (post: ExplorePost, index: number) => void;
  onOpenRelatedTag: (tag: string) => void;
  onRefresh: () => void;
  onSelectTab: (tab: TagDetailTab) => void;
  safeBottom: number;
  safeTop: number;
  tab: TagDetailTab;
};

function TrendTagDetailPage({
  activePosts,
  activeTagKey,
  detail,
  detailError,
  isFetchingMore,
  isLoading,
  onBack,
  onLoadMore,
  onOpenPost,
  onOpenRelatedTag,
  onRefresh,
  onSelectTab,
  safeBottom,
  safeTop,
  tab,
}: TrendTagDetailPageProps) {
  const headerTopPadding = Math.max(safeTop, 10) + 6;
  const contentBottomPadding = Math.max(safeBottom, 16) + 22;
  const primaryPost = tab === 'top' ? activePosts[0] ?? null : null;
  const secondaryPosts =
    tab === 'top' && activePosts.length > 0 ? activePosts.slice(1) : activePosts;

  return (
    <View className="flex-1 bg-white">
      <StatusBar
        animated={true}
        backgroundColor="#ffffff"
        barStyle="dark-content"
        translucent={false}
      />

      <View className="flex-1 bg-white">
        <Animated.View
          className="border-b border-[#eceff3] bg-white px-5 pb-4"
          entering={FadeIn.duration(180)}
          style={{ paddingTop: headerTopPadding }}
        >
          <View className="flex-row items-center">
            <Pressable
              className="mr-4 h-11 w-11 items-center justify-center rounded-full border border-[#e7ebf0] bg-white"
              onPress={onBack}
            >
              <FeatherIcon color="#111827" name="arrow-left" size={20} />
            </Pressable>

            <View className="flex-1">
              <Text className="text-[11px] font-semibold uppercase tracking-[0.9px] text-[#98a2b3]">
                Trend Etiketi
              </Text>
              <Text className="mt-1 text-[17px] font-semibold tracking-[-0.2px] text-[#111827]">
                {activeTagKey ? `#${activeTagKey}` : 'Etiket'}
              </Text>
            </View>

            <Pressable
              className="h-11 w-11 items-center justify-center rounded-full border border-[#e7ebf0] bg-white"
              disabled={!activeTagKey || isLoading}
              onPress={onRefresh}
            >
              {isLoading ? (
                <IosSpinner color="#ff5a1f" size="small" />
              ) : (
                <FeatherIcon color="#111827" name="refresh-cw" size={18} />
              )}
            </Pressable>
          </View>
        </Animated.View>

        <ScrollView
          className="flex-1 bg-white"
          contentContainerStyle={{ paddingBottom: contentBottomPadding }}
          showsVerticalScrollIndicator={false}
        >
          {detail ? (
            <Animated.View
              className="px-5 pt-4"
              entering={FadeInDown.duration(260)}
            >
              <View className="overflow-hidden rounded-[30px] bg-[#17172b] px-5 py-5">
                <View className="absolute right-[-32px] top-[-28px] h-28 w-28 rounded-full bg-[#9a6038]/55" />
                <View className="absolute bottom-[-22px] left-[-16px] h-24 w-24 rounded-full bg-white/10" />

                <View className="self-start rounded-full bg-white/10 px-3 py-[6px]">
                  <Text className="text-[11px] font-semibold uppercase tracking-[0.75px] text-[#f7bf75]">
                    Kesfet
                  </Text>
                </View>

                <Text className="mt-5 text-[19px] font-semibold tracking-[-0.35px] text-white">
                  #{detail.tag.tag}
                </Text>
                <Text className="mt-3 text-[13px] leading-[20px] text-[#dde2ea]">
                  Bu etikette paylasilan gonderileri, one cikanlari ve yeni akis
                  hareketlerini tek sayfada gor.
                </Text>

                <View className="mt-5 flex-row flex-wrap">
                  <View className="mb-2 mr-2 min-w-[84px] rounded-[18px] bg-white/10 px-3.5 py-3">
                    <Text className="text-[10px] font-semibold uppercase tracking-[0.8px] text-[#cfd6df]">
                      Toplam
                    </Text>
                    <Text className="mt-1 text-[18px] font-semibold text-white">
                      {formatCount(detail.tag.count)}
                    </Text>
                  </View>

                  <View className="mb-2 mr-2 min-w-[84px] rounded-[18px] bg-white/10 px-3.5 py-3">
                    <Text className="text-[10px] font-semibold uppercase tracking-[0.8px] text-[#cfd6df]">
                      Son 48s
                    </Text>
                    <Text className="mt-1 text-[18px] font-semibold text-white">
                      {formatCount(detail.tag.recentCount)}
                    </Text>
                  </View>

                  <View className="mb-2 min-w-[104px] rounded-[18px] bg-white/10 px-3.5 py-3">
                    <Text className="text-[10px] font-semibold uppercase tracking-[0.8px] text-[#cfd6df]">
                      Son Hareket
                    </Text>
                    <Text className="mt-1 text-[15px] font-semibold text-white">
                      {formatTrendingTagActivity(detail.tag.lastUsedAt)}
                    </Text>
                  </View>
                </View>
              </View>
            </Animated.View>
          ) : null}

          {isLoading && !detail ? (
            <View className="items-center justify-center px-8 py-20">
              <IosSpinner color="#ff5a1f" size="small" />
              <Text className="mt-3 text-center text-[13px] text-[#8f94a1]">
                Etiket sayfasi yukleniyor...
              </Text>
            </View>
          ) : null}

          {!isLoading && detailError ? (
            <View className="mx-5 mt-4 rounded-[16px] border border-rose-200 bg-rose-50 px-4 py-3.5">
              <Text className="text-[12px] text-rose-500">{detailError}</Text>
            </View>
          ) : null}

          {detail ? (
            <>
              <Animated.View
                className="px-5 pt-4"
                entering={FadeInDown.delay(50).duration(260)}
              >
                <View className="rounded-full bg-[#f1f3f7] p-[4px]">
                  <View className="flex-row">
                    <Pressable
                      className={`flex-1 items-center rounded-full py-[11px] ${tab === 'top' ? 'bg-[#111111]' : 'bg-transparent'
                        }`}
                      onPress={() => {
                        onSelectTab('top');
                      }}
                    >
                      <Text
                        className={`text-[13px] ${tab === 'top'
                          ? 'font-semibold text-white'
                          : 'font-medium text-[#808595]'
                          }`}
                      >
                        One Cikanlar
                      </Text>
                    </Pressable>

                    <Pressable
                      className={`flex-1 items-center rounded-full py-[11px] ${tab === 'recent' ? 'bg-[#111111]' : 'bg-transparent'
                        }`}
                      onPress={() => {
                        onSelectTab('recent');
                      }}
                    >
                      <Text
                        className={`text-[13px] ${tab === 'recent'
                          ? 'font-semibold text-white'
                          : 'font-medium text-[#808595]'
                          }`}
                      >
                        En Yeniler
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </Animated.View>

              {detail.relatedTags.length > 0 ? (
                <Animated.View
                  className="px-5 pt-5"
                  entering={FadeInDown.delay(90).duration(260)}
                >
                  <Text className="text-[12px] font-semibold uppercase tracking-[0.85px] text-[#7b8495]">
                    Ilgili Etiketler
                  </Text>
                  <View className="mt-3 flex-row flex-wrap">
                    {detail.relatedTags.map(item => (
                      <Pressable
                        className="mb-2 mr-2 rounded-[16px] border border-[#dbe2ec] bg-white px-3.5 py-2.5"
                        key={item.tag}
                        onPress={() => {
                          onOpenRelatedTag(item.tag);
                        }}
                      >
                        <Text className="text-[12px] font-semibold text-[#111827]">
                          #{item.tag}
                        </Text>
                        <Text className="mt-[3px] text-[10px] text-[#7b8495]">
                          {formatTrendingTagMeta(item)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </Animated.View>
              ) : null}

              <Animated.View
                className="px-5 pt-5"
                entering={FadeInDown.delay(120).duration(260)}
              >
                <View className="mb-3">
                  <Text className="text-[18px] font-semibold tracking-[-0.28px] text-[#111827]">
                    {tab === 'top' ? 'One Cikan Gonderiler' : 'Yeni Paylasimlar'}
                  </Text>
                  <Text className="mt-1.5 text-[12px] leading-[18px] text-[#8b95a7]">
                    {tab === 'top'
                      ? 'Etkilesimi yuksek paylasimlar once gelir.'
                      : 'En son paylasilan gonderiler burada akar.'}
                  </Text>
                </View>

                {activePosts.length === 0 ? (
                  <ScreenStateCard
                    description="Bu etikette henuz gosterilecek gonderi yok."
                    title="Henüz Gönderi Yok"
                  />
                ) : (
                  <>
                    {primaryPost ? (
                      <Pressable
                        className="mb-3 overflow-hidden rounded-[24px] border border-[#e7ebf2] bg-white"
                        onPress={() => {
                          onOpenPost(primaryPost, 0);
                        }}
                      >
                        <View style={{ height: TRENDING_HERO_MEDIA_HEIGHT }}>
                          <AppMedia
                            durationLabelMode="remaining"
                            enableVideoPreviewInThumbnail={
                              primaryPost.mediaType === 'video'
                            }
                            mediaType={primaryPost.mediaType}
                            mediaUrl={primaryPost.mediaUrl}
                            mode="thumbnail"
                            paused={primaryPost.mediaType === 'video' ? false : undefined}
                            previewLoopFromOffset={true}
                            previewStartOffsetSec={VIDEO_PREVIEW_OFFSET_SEC}
                            showVideoBadge={primaryPost.mediaType === 'video'}
                            showVideoDurationLabel={primaryPost.mediaType === 'video'}
                            showVideoTypePill={primaryPost.mediaType === 'video'}
                            style={POST_ITEM_MEDIA_STYLE}
                          />
                        </View>
                        <View className="px-3.5 pb-3.5 pt-3">
                          <Text
                            className="text-[12px] font-semibold text-[#111827]"
                            numberOfLines={1}
                          >
                            @{safeAuthorUsername(primaryPost.author)}
                          </Text>
                          <Text
                            className="mt-1 text-[12px] leading-[18px] text-[#7b8495]"
                            numberOfLines={2}
                          >
                            {primaryPost.caption.trim().length > 0
                              ? primaryPost.caption.trim()
                              : primaryPost.location.trim().length > 0
                                ? primaryPost.location.trim()
                                : 'Kesfet onizleme'}
                          </Text>
                        </View>
                      </Pressable>
                    ) : null}

                    <View className="flex-row flex-wrap">
                      {secondaryPosts.map((post, index) => {
                        const itemIndex = primaryPost ? index + 1 : index;
                        const isLastInRow = (index + 1) % 3 === 0;
                        const secondaryTileStyle = {
                          marginRight: isLastInRow ? 0 : SEARCH_POST_GRID_GAP,
                          width: SEARCH_POST_TILE_SIZE,
                        };
                        return (
                          <Pressable
                            className="mb-[8px] overflow-hidden rounded-[18px] border border-[#e7ebf2] bg-white"
                            key={post.id}
                            onPress={() => {
                              onOpenPost(post, itemIndex);
                            }}
                            style={secondaryTileStyle}
                          >
                            <View style={{ height: SEARCH_POST_TILE_MEDIA_HEIGHT }}>
                              <AppMedia
                                durationLabelMode="remaining"
                                enableVideoPreviewInThumbnail={
                                  post.mediaType === 'video'
                                }
                                mediaType={post.mediaType}
                                mediaUrl={post.mediaUrl}
                                mode="thumbnail"
                                paused={post.mediaType === 'video' ? index > 2 : undefined}
                                previewLoopFromOffset={true}
                                previewStartOffsetSec={VIDEO_PREVIEW_OFFSET_SEC}
                                showVideoBadge={post.mediaType === 'video'}
                                showVideoDurationLabel={post.mediaType === 'video'}
                                showVideoTypePill={post.mediaType === 'video'}
                                style={POST_ITEM_MEDIA_STYLE}
                              />
                            </View>
                            <View className="px-2.5 pb-2.5 pt-2">
                              <Text
                                className="text-[10px] font-semibold text-[#111827]"
                                numberOfLines={1}
                              >
                                @{safeAuthorUsername(post.author)}
                              </Text>
                              <Text
                                className="mt-[2px] text-[10px] leading-[14px] text-[#7b8495]"
                                numberOfLines={1}
                              >
                                {post.caption.trim().length > 0
                                  ? post.caption.trim()
                                  : post.location.trim().length > 0
                                    ? post.location.trim()
                                    : 'Kesfet onizleme'}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                )}

                {tab === 'recent' && detail.recentHasMore ? (
                  <View className="pt-4">
                    <Pressable
                      className={`h-[46px] items-center justify-center rounded-[14px] border ${isFetchingMore
                        ? 'border-[#dde3ee] bg-[#eff3f8]'
                        : 'border-[#dbe2ec] bg-white'
                        }`}
                      disabled={isFetchingMore}
                      onPress={onLoadMore}
                    >
                      <Text className="text-[12px] font-semibold text-[#4b5563]">
                        {isFetchingMore ? 'Guncelleniyor...' : 'Daha fazla goster'}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </Animated.View>
            </>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

type TrendTagFeedPageProps = {
  initialIndex: number;
  onBack: () => void;
  onDoubleTapLike: (post: ExplorePost) => void;
  onOpenAuthorProfile: (post: ExplorePost) => void;
  onOpenComments: (post: ExplorePost) => void;
  onReact: (post: ExplorePost, kind: ExploreReactionKind) => void;
  onReport: (post: ExplorePost) => void;
  onShare: (post: ExplorePost) => void;
  onToggleFollow: (post: ExplorePost) => void;
  posts: ExplorePost[];
  safeBottom: number;
  safeTop: number;
  tag: string;
  viewerAvatarUrl: string;
  viewerId: string;
  viewerUsername: string;
};

function TrendTagFeedPage({
  initialIndex,
  onBack,
  onDoubleTapLike,
  onOpenAuthorProfile,
  onOpenComments,
  onReact,
  onReport,
  onShare,
  onToggleFollow,
  posts,
  safeBottom,
  safeTop,
  tag,
  viewerAvatarUrl,
  viewerId,
  viewerUsername,
}: TrendTagFeedPageProps) {
  const listRef = useRef<any>(null);
  const safeInitialIndex = Math.max(0, Math.min(initialIndex, posts.length - 1));
  const [activeIndex, setActiveIndex] = useState(safeInitialIndex);
  const viewabilityConfigRef = useRef({
    itemVisiblePercentThreshold: 78,
    minimumViewTime: 80,
  });
  const onViewableItemsChangedRef = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<ExplorePost>[] }) => {
      const nextVisible = viewableItems.find(
        viewableItem =>
          viewableItem.isViewable && typeof viewableItem.index === 'number',
      );

      if (typeof nextVisible?.index === 'number') {
        setActiveIndex(nextVisible.index);
      }
    },
  );

  useEffect(() => {
    setActiveIndex(safeInitialIndex);
    const frame = requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToIndex({
          animated: false,
          index: safeInitialIndex,
        });
      } catch {
        return;
      }
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [safeInitialIndex, posts]);

  return (
    <View className="flex-1 bg-black">
      <StatusBar
        animated={true}
        backgroundColor="#000000"
        barStyle="light-content"
        translucent={false}
      />

      {posts.length > 0 ? (
        <FlashList
          ref={listRef}
          className="flex-1 bg-black"
          data={posts}
          decelerationRate="fast"
          disableIntervalMomentum={true}
          initialScrollIndex={safeInitialIndex}
          keyExtractor={item => item.id}
          onViewableItemsChanged={onViewableItemsChangedRef.current}
          pagingEnabled={true}
          renderItem={({ item, index }) => (
            <PostItem
              isActive={index === activeIndex}
              item={item}
              onDoubleTapLike={onDoubleTapLike}
              onOpenAuthorProfile={onOpenAuthorProfile}
              onOpenComments={onOpenComments}
              onReact={onReact}
              onReport={onReport}
              onShare={onShare}
              onToggleFollow={onToggleFollow}
              safeBottom={safeBottom}
              viewerAvatarUrl={viewerAvatarUrl}
              viewerId={viewerId}
              viewerUsername={viewerUsername}
            />
          )}
          showsVerticalScrollIndicator={false}
          snapToAlignment="start"
          viewabilityConfig={viewabilityConfigRef.current}
        />
      ) : (
        <View className="flex-1 items-center justify-center bg-black px-8">
          <Text className="text-[18px] font-semibold text-white">
            Gosterilecek icerik yok
          </Text>
          <Text className="mt-2 text-center text-[13px] leading-[19px] text-white/60">
            Bu etikette acilacak video akisi su an bos.
          </Text>
        </View>
      )}

      <Animated.View
        className="absolute left-0 right-0 px-4"
        entering={FadeIn.duration(180)}
        pointerEvents="box-none"
        style={{ paddingTop: Math.max(safeTop, 12) + 4 }}
      >
        <View className="flex-row items-center justify-between">
          <Pressable
            className="h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-black/55"
            onPress={onBack}
          >
            <FeatherIcon color="#ffffff" name="arrow-left" size={20} />
          </Pressable>

          <View className="items-center rounded-full border border-white/12 bg-black/45 px-4 py-2">
            <Text className="text-[11px] font-semibold uppercase tracking-[0.8px] text-white/65">
              Trend Akisi
            </Text>
            <Text className="mt-[2px] text-[13px] font-semibold text-white">
              #{tag}
            </Text>
          </View>

          <View className="min-w-[52px] items-end">
            <Text className="rounded-full bg-black/45 px-3 py-2 text-[12px] font-semibold text-white/90">
              {posts.length === 0 ? '0/0' : `${activeIndex + 1}/${posts.length}`}
            </Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

type ExploreScreenProps = {
  contentBottomInset?: number;
  onBack?: () => void;
  onOpenDirectMessage?: (user: ExploreSearchUser) => void;
  onPrefillPublicProfileBackRequested?: (returnTab: TabKey) => void;
  onPrefillPublicProfileUserConsumed?: () => void;
  onPrefillViewerRequestConsumed?: () => void;
  prefillPublicProfileUser?: ExploreSearchUser | null;
  prefillPublicProfileReturnTab?: TabKey | null;
  prefillViewerRequest?: ExploreViewerRequest | null;
  safeBottom?: number;
  safeTop?: number;
  viewerAvatarUrl?: string;
  viewerId: string;
  viewerUsername?: string;
};

export default function ExploreScreen({
  contentBottomInset,
  onBack,
  onOpenDirectMessage,
  onPrefillPublicProfileBackRequested,
  onPrefillPublicProfileUserConsumed,
  onPrefillViewerRequestConsumed,
  prefillPublicProfileUser,
  prefillPublicProfileReturnTab,
  prefillViewerRequest,
  safeBottom,
  safeTop,
  viewerAvatarUrl = '',
  viewerId,
  viewerUsername = '',
}: ExploreScreenProps) {
  const [i18nTick, setI18nTick] = useState(0);
  useEffect(() => {
    return subscribeAppLanguage(() => {
      setI18nTick(value => value + 1);
    });
  }, []);
  const insets = useSafeAreaInsets();
  const { confirm, showToast } = useAlert();
  const resolvedSafeTop = Math.max(safeTop ?? 0, insets.top);
  const resolvedSafeBottom = Math.max(
    contentBottomInset ?? 0,
    safeBottom ?? 0,
    insets.bottom,
  );
  const resolvedPostSafeBottom = Math.max(safeBottom ?? 0, insets.bottom);
  const [activeTab, setActiveTab] = useState<ExploreSegment>(SEGMENT_EXPLORE);
  const deferredTab = useDeferredValue(activeTab);

  const [posts, setPosts] = useState<ExplorePost[]>([]);
  const postsRef = useRef<ExplorePost[]>([]);
  postsRef.current = posts;
  const [lastFeedGeneratedAt, setLastFeedGeneratedAt] = useState<string | null>(
    null,
  );
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [rankVersion, setRankVersion] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [isLoadingFeed, setIsLoadingFeed] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [socketStatus, setSocketStatus] = useState<
    'connecting' | 'live' | 'offline'
  >('connecting');
  const [relationshipByUserId, setRelationshipByUserId] = useState<
    Record<string, ExploreRelationshipState>
  >({});
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isProfileBackOnlyHeader, setIsProfileBackOnlyHeader] = useState(false);
  const [searchTab, setSearchTab] = useState<SearchPanelTab>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchUsers, setSearchUsers] = useState<ExploreSearchUser[]>([]);
  const [searchPosts, setSearchPosts] = useState<ExplorePost[]>([]);
  const [searchPostsSort, setSearchPostsSort] =
    useState<ExploreSearchPostSort>('popular');
  const [searchPostsMediaType, setSearchPostsMediaType] =
    useState<ExploreSearchPostFilter>('all');
  const [recentUsers, setRecentUsers] = useState<ExploreSearchUser[]>([]);
  const [recentSearchTermsByTab, setRecentSearchTermsByTab] = useState<
    Record<SearchRecentTermTab, ExploreRecentSearchTerm[]>
  >({
    places: [],
    posts: [],
    tags: [],
  });
  const [popularSearchTermsByTab, setPopularSearchTermsByTab] = useState<
    Record<SearchRecentTermTab, ExplorePopularSearchTerm[]>
  >({
    places: [],
    posts: [],
    tags: [],
  });
  const [selectedSearchUser, setSelectedSearchUser] =
    useState<ExploreSearchUser | null>(null);
  const [selectedPublicProfile, setSelectedPublicProfile] =
    useState<PublicUserProfile | null>(null);
  const [publicProfilePosts, setPublicProfilePosts] = useState<
    PublicProfilePostItem[]
  >([]);
  const [isLoadingPublicProfile, setIsLoadingPublicProfile] = useState(false);
  const [isLoadingPublicProfilePosts, setIsLoadingPublicProfilePosts] =
    useState(false);
  const [publicProfileError, setPublicProfileError] = useState<string | null>(
    null,
  );
  const [publicProfilePostsError, setPublicProfilePostsError] = useState<
    string | null
  >(null);
  const [isSelectedProfileUnavailable, setIsSelectedProfileUnavailable] =
    useState(false);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const searchPanelOpacity = useRef(new RNAnimated.Value(1)).current;
  const searchPanelTranslateX = useRef(new RNAnimated.Value(0)).current;
  const isSearchTabAnimatingRef = useRef(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearchingPosts, setIsSearchingPosts] = useState(false);
  const [searchPostsError, setSearchPostsError] = useState<string | null>(null);
  const [searchPostsHasMore, setSearchPostsHasMore] = useState(false);
  const [searchPostsNextCursor, setSearchPostsNextCursor] = useState<
    string | null
  >(null);
  const [isFetchingMoreSearchPosts, setIsFetchingMoreSearchPosts] =
    useState(false);
  const [trendingTags, setTrendingTags] = useState<ExploreTrendingTag[]>([]);
  const [isLoadingTrendingTags, setIsLoadingTrendingTags] = useState(false);
  const [trendingTagsError, setTrendingTagsError] = useState<string | null>(
    null,
  );
  const [overlayRoutes, setOverlayRoutes] = useState<ExploreOverlayRoute[]>([]);
  const [activeTrendingTagKey, setActiveTrendingTagKey] = useState<
    string | null
  >(null);
  const [trendingTagDetailTab, setTrendingTagDetailTab] =
    useState<TagDetailTab>('top');
  const [trendingTagDetail, setTrendingTagDetail] =
    useState<ExploreTagDetailResponse | null>(null);
  const [isLoadingTrendingTagDetail, setIsLoadingTrendingTagDetail] =
    useState(false);
  const [isFetchingMoreTrendingTagPosts, setIsFetchingMoreTrendingTagPosts] =
    useState(false);
  const [trendingTagDetailError, setTrendingTagDetailError] = useState<
    string | null
  >(null);
  const [searchActionPendingUserId, setSearchActionPendingUserId] = useState<
    string | null
  >(null);
  const [suggestedUsersVisibleCount, setSuggestedUsersVisibleCount] = useState(
    SUGGESTED_USERS_PAGE_SIZE,
  );
  const [isProfileActionsVisible, setIsProfileActionsVisible] = useState(false);
  const [blockConfirmUser, setBlockConfirmUser] =
    useState<ExploreSearchUser | null>(null);
  const [streetFriendIds, setStreetFriendIds] = useState<Record<string, true>>(
    {},
  );
  const [hiddenExploreUserIds, setHiddenExploreUserIds] = useState<
    Record<string, true>
  >({});
  const [hiddenExploreUsernameKeys, setHiddenExploreUsernameKeys] = useState<
    Record<string, true>
  >({});
  const [activePostIndex, setActivePostIndex] = useState(0);

  const [isCommentsVisible, setIsCommentsVisible] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [selectedReportPost, setSelectedReportPost] = useState<ExplorePost | null>(
    null,
  );
  const [isReportModalVisible, setIsReportModalVisible] = useState(false);
  const [reportSubmitError, setReportSubmitError] = useState<string | null>(null);
  const [reportSubmitReasonKey, setReportSubmitReasonKey] = useState<string | null>(
    null,
  );
  const [comments, setComments] = useState<ExploreComment[]>([]);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [commentLikePendingIds, setCommentLikePendingIds] = useState<
    Record<string, true>
  >({});
  const [newComment, setNewComment] = useState('');
  const sendScale = useRef(new RNAnimated.Value(0)).current;
  const publicProfileRequestIdRef = useRef(0);
  const selectedPostIdRef = useRef<string | null>(null);
  const activeTabRef = useRef<ExploreSegment>(SEGMENT_EXPLORE);
  const replaceFeedRequestIdRef = useRef(0);
  const trendingTagDetailRequestIdRef = useRef(0);
  const refreshFeedRequestIdRef = useRef(0);
  const loadMoreFeedRequestIdRef = useRef(0);
  const loadMoreFeedInFlightRef = useRef(false);
  const feedCacheByTabRef = useRef<
    Record<ExploreSegment, FeedCacheEntry | null>
  >({
    [SEGMENT_EXPLORE]: null,
    [SEGMENT_FOLLOWING]: null,
    [SEGMENT_FOR_YOU]: null,
  } as Record<ExploreSegment, FeedCacheEntry | null>);
  const trendingTagsLastFetchedAtRef = useRef(0);
  const trendingTagDetailCacheRef = useRef<
    Record<string, { cachedAt: number; value: ExploreTagDetailResponse }>
  >({});
  const searchPostsLoadMoreRequestIdRef = useRef(0);
  const pendingReactionKeysRef = useRef(new Set<string>());
  const overlayRouteIdRef = useRef(0);
  const feedListRef = useRef<any>(null);
  const activeFeedSignatureRef = useRef('');
  const pendingPrefillPostIdRef = useRef<string | null>(null);
  const pendingPrefillLoadAttemptsRef = useRef(0);
  const profilePrefillLockRef = useRef(false);
  const publicProfileReturnTabRef = useRef<TabKey | null>(null);
  const commentsRequestIdRef = useRef(0);
  const commentsCacheRef = useRef<Record<string, CommentsCacheEntry>>({});
  const commentInputRef = useRef<any>(null);
  const recentUsersAbortControllerRef = useRef<AbortController | null>(null);
  const recentSearchTermsAbortControllerRef = useRef<AbortController | null>(null);
  const popularSearchTermsAbortControllerRef = useRef<AbortController | null>(null);
  const searchUsersAbortControllerRef = useRef<AbortController | null>(null);
  const searchPostsAbortControllerRef = useRef<AbortController | null>(null);
  const trendingTagsAbortControllerRef = useRef<AbortController | null>(null);
  const trendingTagDetailAbortControllerRef = useRef<AbortController | null>(null);
  const shareClickSeenByPostIdRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    return () => {
      recentUsersAbortControllerRef.current?.abort();
      recentSearchTermsAbortControllerRef.current?.abort();
      popularSearchTermsAbortControllerRef.current?.abort();
      searchUsersAbortControllerRef.current?.abort();
      searchPostsAbortControllerRef.current?.abort();
      trendingTagsAbortControllerRef.current?.abort();
      trendingTagDetailAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    shareClickSeenByPostIdRef.current = {};
  }, [viewerId]);

  useEffect(() => {
    setPosts(prev =>
      patchViewerAuthorAvatarsInPosts(
        prev,
        viewerId,
        viewerAvatarUrl,
        viewerUsername,
      ),
    );
    setSearchPosts(prev =>
      patchViewerAuthorAvatarsInPosts(
        prev,
        viewerId,
        viewerAvatarUrl,
        viewerUsername,
      ),
    );
    setTrendingTagDetail(prev => {
      if (!prev) {
        return prev;
      }
      const nextTop = patchViewerAuthorAvatarsInPosts(
        prev.topPosts,
        viewerId,
        viewerAvatarUrl,
        viewerUsername,
      );
      const nextRecent = patchViewerAuthorAvatarsInPosts(
        prev.recentPosts,
        viewerId,
        viewerAvatarUrl,
        viewerUsername,
      );
      if (nextTop === prev.topPosts && nextRecent === prev.recentPosts) {
        return prev;
      }
      return {
        ...prev,
        topPosts: nextTop,
        recentPosts: nextRecent,
      };
    });
    const vId = viewerId.trim();
    const vAv = viewerAvatarUrl.trim();
    const vu = normalizeUsernameKey(viewerUsername);
    if (vAv.length > 0 && (vId.length > 0 || vu.length > 0)) {
      const commentIsViewer = (comment: ExploreComment) => {
        if (vId.length > 0 && authorIdsEqual(safeAuthorId(comment.author), vId)) {
          return true;
        }
        if (
          vu.length > 0 &&
          normalizeUsernameKey(safeAuthorUsername(comment.author)) === vu
        ) {
          return true;
        }
        return false;
      };
      setComments(prev => {
        let changed = false;
        const next = prev.map(comment => {
          if (!commentIsViewer(comment)) {
            return comment;
          }
          if ((comment.author.avatarUrl?.trim() ?? '') === vAv) {
            return comment;
          }
          changed = true;
          return {
            ...comment,
            author: {
              ...comment.author,
              avatarUrl: vAv,
            },
          };
        });
        return changed ? next : prev;
      });
      let cacheChanged = false;
      const nextCache: typeof commentsCacheRef.current = {
        ...commentsCacheRef.current,
      };
      for (const postId of Object.keys(nextCache)) {
        const entry = nextCache[postId];
        if (!entry) {
          continue;
        }
        let entryCommentsChanged = false;
        const patchedComments = entry.comments.map(comment => {
          if (!commentIsViewer(comment)) {
            return comment;
          }
          if ((comment.author.avatarUrl?.trim() ?? '') === vAv) {
            return comment;
          }
          entryCommentsChanged = true;
          return {
            ...comment,
            author: {
              ...comment.author,
              avatarUrl: vAv,
            },
          };
        });
        if (entryCommentsChanged) {
          cacheChanged = true;
          nextCache[postId] = {
            ...entry,
            comments: patchedComments,
          };
        }
      }
      if (cacheChanged) {
        commentsCacheRef.current = nextCache;
      }
    }
  }, [viewerAvatarUrl, viewerId, viewerUsername]);

  const activePost = posts[activePostIndex] ?? null;
  const selectedPost =
    posts.find(post => post.id === selectedPostId) ?? activePost;
  const emptyFeedState = resolveEmptyFeedState(activeTab);

  const replaceCommentsCache = useCallback(
    (postId: string, nextComments: ExploreComment[]) => {
      commentsCacheRef.current[postId] = {
        cachedAt: Date.now(),
        comments: nextComments,
      };
    },
    [],
  );

  const mergeCommentIntoCache = useCallback(
    (postId: string, comment: ExploreComment) => {
      const currentComments = commentsCacheRef.current[postId]?.comments ?? [];
      replaceCommentsCache(postId, mergeComment(currentComments, comment));
    },
    [replaceCommentsCache],
  );

  const patchCommentEverywhere = useCallback(
    (
      postId: string,
      commentId: string,
      updater: (comment: ExploreComment) => ExploreComment,
    ) => {
      const cachedEntry = commentsCacheRef.current[postId];
      if (cachedEntry) {
        replaceCommentsCache(
          postId,
          patchComment(cachedEntry.comments, commentId, updater),
        );
      }

      if (selectedPostIdRef.current === postId) {
        setComments(previousComments =>
          patchComment(previousComments, commentId, updater),
        );
      }
    },
    [replaceCommentsCache],
  );

  const syncPostSnapshotEverywhere = useCallback(
    (
      postId: string,
      stats: ExploreStats,
      viewerState?: Partial<ExplorePost['viewerState']>,
    ) => {
      const applyExploreSnapshot = (post: ExplorePost) => ({
        ...post,
        stats,
        viewerState: viewerState
          ? { ...post.viewerState, ...viewerState }
          : post.viewerState,
      });

      setPosts(previousPosts => patchPost(previousPosts, postId, applyExploreSnapshot));
      setSearchPosts(previousPosts =>
        patchPost(previousPosts, postId, applyExploreSnapshot),
      );
      setTrendingTagDetail(previous =>
        previous
          ? {
            ...previous,
            recentPosts: patchPost(previous.recentPosts, postId, applyExploreSnapshot),
            topPosts: patchPost(previous.topPosts, postId, applyExploreSnapshot),
          }
          : previous,
      );
      setPublicProfilePosts(previousPosts =>
        patchPublicProfilePost(previousPosts, postId, post => ({
          ...post,
          stats,
        })),
      );
    },
    [],
  );

  const applyOptimisticReactionEverywhere = useCallback(
    (postId: string, kind: ExploreReactionKind, active: boolean) => {
      const viewerStatePatch =
        kind === 'like'
          ? { isLiked: active }
          : kind === 'bookmark'
            ? { isBookmarked: active }
            : null;
      const patchExploreReaction = (post: ExplorePost) => ({
        ...post,
        stats: getOptimisticStats(post.stats, kind, active),
        viewerState: viewerStatePatch
          ? { ...post.viewerState, ...viewerStatePatch }
          : post.viewerState,
      });

      setPosts(previousPosts => patchPost(previousPosts, postId, patchExploreReaction));
      setSearchPosts(previousPosts =>
        patchPost(previousPosts, postId, patchExploreReaction),
      );
      setTrendingTagDetail(previous =>
        previous
          ? {
            ...previous,
            recentPosts: patchPost(previous.recentPosts, postId, patchExploreReaction),
            topPosts: patchPost(previous.topPosts, postId, patchExploreReaction),
          }
          : previous,
      );
      setPublicProfilePosts(previousPosts =>
        patchPublicProfilePost(previousPosts, postId, post => ({
          ...post,
          stats: getOptimisticStats(post.stats, kind, active),
        })),
      );
    },
    [],
  );

  const relationshipForUser = useCallback(
    (user: ExploreSearchUser): ExploreRelationshipState => {
      const baseFromUser: ExploreRelationshipState = {
        followRequestStatus: user.viewerState.followRequestStatus,
        followsYou: user.viewerState.followsYou,
        isFollowing: user.viewerState.isFollowing,
        isStreetFriend: user.viewerState.isStreetFriend,
        streetFriendStatus: user.viewerState.streetFriendStatus,
      };
      const cached = relationshipByUserId[user.id];
      const merged = cached ? { ...baseFromUser, ...cached } : baseFromUser;
      if (streetFriendIds[user.id]) {
        return {
          ...merged,
          isStreetFriend: true,
          streetFriendStatus: 'accepted',
        };
      }
      return merged;
    },
    [relationshipByUserId, streetFriendIds],
  );

  const isHiddenExploreUsername = useCallback(
    (value: string) => {
      const key = normalizeExploreUsernameKey(value);
      return key.length > 0 && hiddenExploreUsernameKeys[key] === true;
    },
    [hiddenExploreUsernameKeys],
  );

  const filterHiddenExploreUsers = useCallback(
    (users: ExploreSearchUser[]) =>
      users.filter(user => {
        if (hiddenExploreUserIds[user.id]) {
          return false;
        }

        return !isHiddenExploreUsername(user.username);
      }),
    [hiddenExploreUserIds, isHiddenExploreUsername],
  );

  const rememberHiddenExploreUser = useCallback((user: ExploreSearchUser) => {
    setHiddenExploreUserIds(previous =>
      previous[user.id] ? previous : { ...previous, [user.id]: true },
    );
    const usernameKey = normalizeExploreUsernameKey(user.username);
    if (usernameKey.length === 0) {
      return;
    }
    setHiddenExploreUsernameKeys(previous =>
      previous[usernameKey]
        ? previous
        : { ...previous, [usernameKey]: true },
    );
  }, []);

  const revealHiddenExploreUser = useCallback((user: ExploreSearchUser) => {
    setHiddenExploreUserIds(previous => {
      if (!previous[user.id]) {
        return previous;
      }
      const next = { ...previous };
      delete next[user.id];
      return next;
    });
    const usernameKey = normalizeExploreUsernameKey(user.username);
    if (usernameKey.length === 0) {
      return;
    }
    setHiddenExploreUsernameKeys(previous => {
      if (!previous[usernameKey]) {
        return previous;
      }
      const next = { ...previous };
      delete next[usernameKey];
      return next;
    });
  }, []);

  const commitRelationship = useCallback(
    (userId: string, patch: ExploreRelationshipCommitPatch) => {
      const { creatorFollowersCount, ...relPatch } = patch;

      setRelationshipByUserId(previous => {
        const current = previous[userId] ?? defaultRelationshipState();
        const next = { ...current, ...relPatch };
        if (
          current.followRequestStatus === next.followRequestStatus &&
          current.followsYou === next.followsYou &&
          current.isFollowing === next.isFollowing &&
          current.isStreetFriend === next.isStreetFriend &&
          current.streetFriendStatus === next.streetFriendStatus
        ) {
          return previous;
        }
        return {
          ...previous,
          [userId]: next,
        };
      });

      setPosts(previousPosts =>
        patchAuthor(previousPosts, userId, {
          followRequestStatus: relPatch.followRequestStatus,
          isFollowing: relPatch.isFollowing,
          isStreetFriend: relPatch.isStreetFriend,
          streetFriendStatus: relPatch.streetFriendStatus,
        }),
      );

      setSearchUsers(previous =>
        previous.map(user => {
          if (user.id !== userId) {
            return user;
          }
          return {
            ...user,
            viewerState: {
              ...user.viewerState,
              ...(relPatch.followRequestStatus
                ? { followRequestStatus: relPatch.followRequestStatus }
                : {}),
              ...(typeof relPatch.followsYou === 'boolean'
                ? { followsYou: relPatch.followsYou }
                : {}),
              ...(typeof relPatch.isFollowing === 'boolean'
                ? { isFollowing: relPatch.isFollowing }
                : {}),
              ...(typeof relPatch.isStreetFriend === 'boolean'
                ? { isStreetFriend: relPatch.isStreetFriend }
                : {}),
              ...(relPatch.streetFriendStatus
                ? { streetFriendStatus: relPatch.streetFriendStatus }
                : {}),
            },
          };
        }),
      );

      setRecentUsers(previous =>
        previous.map(user => {
          if (user.id !== userId) {
            return user;
          }
          return {
            ...user,
            viewerState: {
              ...user.viewerState,
              ...(relPatch.followRequestStatus
                ? { followRequestStatus: relPatch.followRequestStatus }
                : {}),
              ...(typeof relPatch.followsYou === 'boolean'
                ? { followsYou: relPatch.followsYou }
                : {}),
              ...(typeof relPatch.isFollowing === 'boolean'
                ? { isFollowing: relPatch.isFollowing }
                : {}),
              ...(typeof relPatch.isStreetFriend === 'boolean'
                ? { isStreetFriend: relPatch.isStreetFriend }
                : {}),
              ...(relPatch.streetFriendStatus
                ? { streetFriendStatus: relPatch.streetFriendStatus }
                : {}),
            },
          };
        }),
      );

      setSelectedPublicProfile(previous => {
        if (!previous || previous.id !== userId) {
          return previous;
        }

        const nextProfile = {
          ...previous,
          viewerState: {
            ...previous.viewerState,
            ...(relPatch.followRequestStatus
              ? { followRequestStatus: relPatch.followRequestStatus }
              : {}),
            ...(typeof relPatch.followsYou === 'boolean'
              ? { followsYou: relPatch.followsYou }
              : {}),
            ...(typeof relPatch.isFollowing === 'boolean'
              ? { isFollowing: relPatch.isFollowing }
              : {}),
            ...(typeof relPatch.isStreetFriend === 'boolean'
              ? { isStreetFriend: relPatch.isStreetFriend }
              : {}),
            ...(relPatch.streetFriendStatus
              ? { streetFriendStatus: relPatch.streetFriendStatus }
              : {}),
          },
        };

        if (
          typeof creatorFollowersCount === 'number' &&
          Number.isFinite(creatorFollowersCount)
        ) {
          return {
            ...nextProfile,
            stats: {
              ...nextProfile.stats,
              followersCount: Math.max(0, Math.floor(creatorFollowersCount)),
            },
          };
        }

        return nextProfile;
      });
    },
    [],
  );

  const syncRelationshipStateFromUsers = useCallback(
    (users: ExploreSearchUser[]) => {
      setRelationshipByUserId(previous => {
        let changed = false;
        const next = { ...previous };
        users.forEach(user => {
          const current = next[user.id] ?? defaultRelationshipState();
          const incoming: ExploreRelationshipState = {
            followRequestStatus: user.viewerState.followRequestStatus,
            followsYou: user.viewerState.followsYou,
            isFollowing: user.viewerState.isFollowing,
            isStreetFriend: user.viewerState.isStreetFriend,
            streetFriendStatus: user.viewerState.streetFriendStatus,
          };
          if (
            current.followRequestStatus !== incoming.followRequestStatus ||
            current.followsYou !== incoming.followsYou ||
            current.isFollowing !== incoming.isFollowing ||
            current.isStreetFriend !== incoming.isStreetFriend ||
            current.streetFriendStatus !== incoming.streetFriendStatus
          ) {
            next[user.id] = incoming;
            changed = true;
          }
        });
        return changed ? next : previous;
      });
    },
    [],
  );

  const pushRecentUser = useCallback((user: ExploreSearchUser) => {
    const sanitizedUser = sanitizeSearchUser(user);
    setRecentUsers(previous => {
      const deduped = previous.filter(item => item.id !== sanitizedUser.id);
      return cleanSearchUserList([sanitizedUser, ...deduped]).slice(0, 8);
    });
    if (sanitizedUser.id.length > 0) {
      recordExploreRecentUser(sanitizedUser.id).catch(() => {
        return;
      });
    }
  }, []);

  useEffect(() => {
    if (activePostIndex >= posts.length) {
      setActivePostIndex(0);
    }
  }, [activePostIndex, posts.length]);

  useEffect(() => {
    selectedPostIdRef.current = selectedPostId;
  }, [selectedPostId]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const resetFeedViewport = useCallback(() => {
    setActivePostIndex(0);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          if (typeof feedListRef.current?.scrollToOffset === 'function') {
            feedListRef.current.scrollToOffset({
              animated: false,
              offset: 0,
            });
            return;
          }
          feedListRef.current?.scrollToIndex?.({
            animated: false,
            index: 0,
          });
        } catch {
          return;
        }
      });
    });
  }, []);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<ExplorePost>[] }) => {
      if (viewableItems.length > 0 && viewableItems[0]?.index != null) {
        setActivePostIndex(viewableItems[0].index);
      }
    },
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 80,
    minimumViewTime: 120,
  }).current;

  useEffect(() => {
    if (newComment.trim().length > 0) {
      RNAnimated.spring(sendScale, {
        toValue: 1,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }).start();
    } else {
      sendScale.setValue(0);
    }
  }, [newComment, sendScale]);

  const mergeFeedPosts = useCallback(
    (existing: ExplorePost[], incoming: ExplorePost[]) => {
      if (incoming.length === 0) {
        return existing;
      }

      const merged = [...existing];
      const existingIds = new Set(existing.map(post => post.id));
      incoming.forEach(post => {
        if (existingIds.has(post.id)) {
          return;
        }
        existingIds.add(post.id);
        merged.push(post);
      });

      return merged;
    },
    [],
  );

  const applyFeedSnapshot = useCallback((snapshot: FeedCacheEntry) => {
    const nextSignature = buildFeedSnapshotSignature(snapshot);
    if (activeFeedSignatureRef.current === nextSignature) {
      return false;
    }
    activeFeedSignatureRef.current = nextSignature;
    setPosts(snapshot.posts);
    setLastFeedGeneratedAt(snapshot.generatedAt);
    setHasMore(snapshot.hasMore);
    setNextCursor(snapshot.nextCursor);
    setRankVersion(snapshot.rankVersion);
    return true;
  }, []);

  const syncRelationshipsFromFeedPosts = useCallback(
    (feedPosts: ExplorePost[]) => {
      setRelationshipByUserId(previous => {
        let changed = false;
        const next = { ...previous };
        feedPosts.forEach(post => {
          const authorId = safeAuthorId(post.author);
          if (!authorId) {
            return;
          }

          const current = next[authorId] ?? defaultRelationshipState();
          const incoming: ExploreRelationshipState = {
            followRequestStatus: post.viewerState.followRequestStatus,
            followsYou: current.followsYou,
            isFollowing: post.viewerState.isFollowing,
            isStreetFriend: post.viewerState.isStreetFriend,
            streetFriendStatus: post.viewerState.streetFriendStatus,
          };
          if (
            current.followRequestStatus !== incoming.followRequestStatus ||
            current.followsYou !== incoming.followsYou ||
            current.isFollowing !== incoming.isFollowing ||
            current.isStreetFriend !== incoming.isStreetFriend ||
            current.streetFriendStatus !== incoming.streetFriendStatus
          ) {
            next[authorId] = incoming;
            changed = true;
          }
        });
        return changed ? next : previous;
      });
    },
    [],
  );

  const seedExploreFeedPost = useCallback(
    (seedPost: ExplorePost) => {
      const normalizedSeedPost: ExplorePost = {
        ...seedPost,
        segment: SEGMENT_EXPLORE,
      };

      setPosts(previousPosts => [
        normalizedSeedPost,
        ...previousPosts.filter(post => post.id !== normalizedSeedPost.id),
      ]);

      const currentExploreCache = feedCacheByTabRef.current[SEGMENT_EXPLORE];
      const currentExplorePosts = currentExploreCache?.posts ?? posts;
      const nextExplorePosts = [
        normalizedSeedPost,
        ...currentExplorePosts.filter(post => post.id !== normalizedSeedPost.id),
      ];
      feedCacheByTabRef.current[SEGMENT_EXPLORE] = {
        cachedAt: Date.now(),
        generatedAt:
          currentExploreCache?.generatedAt ??
          lastFeedGeneratedAt ??
          new Date().toISOString(),
        hasMore: currentExploreCache?.hasMore ?? hasMore,
        nextCursor: currentExploreCache?.nextCursor ?? nextCursor,
        posts: nextExplorePosts,
        rankVersion: currentExploreCache?.rankVersion ?? rankVersion,
      };
      syncRelationshipsFromFeedPosts([normalizedSeedPost]);
    },
    [
      hasMore,
      lastFeedGeneratedAt,
      nextCursor,
      posts,
      rankVersion,
      syncRelationshipsFromFeedPosts,
    ],
  );

  const commitFeed = useCallback(
    (
      response: Awaited<ReturnType<typeof fetchExploreFeed>>,
      mode: 'append' | 'replace',
      options?: {
        applyToScreen?: boolean;
        basePosts?: ExplorePost[];
        segment?: ExploreSegment;
      },
    ) => {
      const segment = options?.segment ?? activeTabRef.current;
      const currentCache = feedCacheByTabRef.current[segment];
      const basePosts =
        mode === 'append'
          ? options?.basePosts ?? currentCache?.posts ?? []
          : [];
      const nextPosts =
        mode === 'append'
          ? mergeFeedPosts(basePosts, response.posts)
          : response.posts;

      const snapshot: FeedCacheEntry = {
        cachedAt: Date.now(),
        generatedAt: response.generatedAt,
        hasMore: response.hasMore,
        nextCursor: response.nextCursor ?? null,
        posts: nextPosts,
        rankVersion: response.rankVersion,
      };
      feedCacheByTabRef.current[segment] = snapshot;
      syncRelationshipsFromFeedPosts(response.posts);

      const shouldApplyToScreen =
        options?.applyToScreen ?? segment === activeTabRef.current;
      if (shouldApplyToScreen) {
        applyFeedSnapshot(snapshot);
      }
    },
    [
      applyFeedSnapshot,
      mergeFeedPosts,
      syncRelationshipsFromFeedPosts,
    ],
  );

  useEffect(() => {
    let active = true;
    const segment = deferredTab;
    if (profilePrefillLockRef.current && segment === SEGMENT_EXPLORE) {
      setFeedError(null);
      setIsLoadingFeed(false);
      setIsRefreshing(false);
      setIsFetchingMore(false);
      return () => {
        active = false;
      };
    }
    replaceFeedRequestIdRef.current += 1;
    const requestId = replaceFeedRequestIdRef.current;
    const cached = feedCacheByTabRef.current[segment];

    setFeedError(null);
    setIsFetchingMore(false);
    if (cached) {
      const mergedSnapshot = {
        ...cached,
        posts: mergePendingExploreSeedIntoPosts(segment, cached.posts),
      };
      feedCacheByTabRef.current[segment] = mergedSnapshot;
      applyFeedSnapshot(mergedSnapshot);
      resetFeedViewport();
      setIsLoadingFeed(false);
    } else {
      activeFeedSignatureRef.current = '';
      setPosts([]);
      setLastFeedGeneratedAt(null);
      setNextCursor(null);
      setHasMore(false);
      setRankVersion(null);
      resetFeedViewport();
      setIsLoadingFeed(true);
    }

    fetchExploreFeed(segment, { limit: FEED_PAGE_LIMIT })
      .then(response => {
        if (!active || requestId !== replaceFeedRequestIdRef.current) {
          return;
        }

        commitFeed(
          {
            ...response,
            posts: mergePendingExploreSeedIntoPosts(segment, response.posts),
          },
          'replace',
          { segment },
        );
      })
      .catch(error => {
        if (active && requestId === replaceFeedRequestIdRef.current && activeTabRef.current === segment) {
          setFeedError(
            error instanceof Error
              ? error.message
              : 'Feed could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (
          active &&
          requestId === replaceFeedRequestIdRef.current &&
          activeTabRef.current === segment
        ) {
          setIsLoadingFeed(false);
          setIsRefreshing(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    applyFeedSnapshot,
    commitFeed,
    deferredTab,
    resetFeedViewport,
  ]);

  useEffect(() => {
    let active = true;
    const segmentsToPrefetch = TABS.filter(segment => segment !== deferredTab);

    segmentsToPrefetch.forEach(segment => {
      const cached = feedCacheByTabRef.current[segment];
      if (cached && Date.now() - cached.cachedAt < FEED_PREFETCH_CACHE_TTL_MS) {
        return;
      }

      fetchExploreFeed(segment, { limit: FEED_PAGE_LIMIT })
        .then(response => {
          if (!active) {
            return;
          }
          commitFeed(
            {
              ...response,
              posts: mergePendingExploreSeedIntoPosts(segment, response.posts),
            },
            'replace',
            { applyToScreen: false, segment },
          );
        })
        .catch(() => {
          return;
        });
    });

    return () => {
      active = false;
    };
  }, [commitFeed, deferredTab]);

  useEffect(() => {
    let active = true;

    const syncStreetFriends = () => {
      fetchStreetFriends()
        .then(response => {
          if (!active) {
            return;
          }

          const accepted: Record<string, true> = {};
          response.friends.forEach(friend => {
            accepted[friend.id] = true;
            commitRelationship(friend.id, {
              isStreetFriend: true,
              streetFriendStatus: 'accepted',
            });
          });

          setStreetFriendIds(accepted);
        })
        .catch(() => {
          if (active) {
            setStreetFriendIds(previous => previous);
          }
        });
    };

    syncStreetFriends();
    return () => {
      active = false;
    };
  }, [commitRelationship]);

  const loadComments = useCallback((postId: string) => {
    const requestId = commentsRequestIdRef.current + 1;
    commentsRequestIdRef.current = requestId;
    const cachedEntry = commentsCacheRef.current[postId];
    const hasCachedComments = cachedEntry != null;
    const hasFreshCache =
      hasCachedComments &&
      Date.now() - cachedEntry.cachedAt <= COMMENTS_CACHE_TTL_MS;

    setCommentsError(null);
    if (hasCachedComments) {
      setComments(cachedEntry.comments);
      setCommentsLoading(false);
    } else {
      setCommentsLoading(true);
    }

    if (hasFreshCache) {
      return;
    }

    fetchExploreComments(postId)
      .then(response => {
        if (commentsRequestIdRef.current !== requestId) {
          return;
        }
        replaceCommentsCache(postId, response.comments);
        setComments(response.comments);
      })
      .catch(error => {
        if (commentsRequestIdRef.current !== requestId || hasCachedComments) {
          return;
        }
        setCommentsError(
          resolveExploreCommentError(error, 'Yorumlar su an yuklenemedi.'),
        );
      })
      .finally(() => {
        if (commentsRequestIdRef.current === requestId && !hasCachedComments) {
          setCommentsLoading(false);
        }
      });
  }, [replaceCommentsCache]);

  const openComments = useCallback((post: ExplorePost) => {
    setSelectedPostId(post.id);
    setIsCommentsVisible(true);
    setNewComment('');
    setCommentsError(null);
    const cachedEntry = commentsCacheRef.current[post.id];
    if (cachedEntry) {
      setComments(cachedEntry.comments);
    } else {
      setComments([]);
    }
    loadComments(post.id);
    setTimeout(() => {
      commentInputRef.current?.focus?.();
    }, 120);
  }, [loadComments]);

  const handleRealtimeEvent = useCallback(
    (event: ExploreRealtimeEvent) => {
      switch (event.type) {
        case 'post.updated':
          if (!event.postId || !event.stats) {
            return;
          }

          syncPostSnapshotEverywhere(
            event.postId,
            event.stats,
            event.viewerState ?? undefined,
          );
          return;
        case 'comment.created':
          if (!event.postId || !event.stats) {
            return;
          }

          syncPostSnapshotEverywhere(event.postId, event.stats);

          if (event.comment) {
            mergeCommentIntoCache(event.postId, event.comment);
          }

          if (event.comment && selectedPostIdRef.current === event.postId) {
            setComments(previousComments => {
              const nextComments = mergeComment(previousComments, event.comment!);
              replaceCommentsCache(event.postId!, nextComments);
              return nextComments;
            });
          }
          return;
        case 'creator.follow.updated': {
          if (!event.creatorId) {
            return;
          }

          const countPatch =
            typeof event.creatorFollowersCount === 'number' &&
            Number.isFinite(event.creatorFollowersCount)
              ? { creatorFollowersCount: event.creatorFollowersCount }
              : {};

          if (
            event.viewerState &&
            event.followerId === viewerId
          ) {
            commitRelationship(event.creatorId, {
              followRequestStatus: event.viewerState.followRequestStatus,
              isFollowing: event.viewerState.isFollowing,
              ...countPatch,
            });
          } else if (Object.keys(countPatch).length > 0) {
            commitRelationship(event.creatorId, countPatch);
          }

          return;
        }
        case 'creator.street_friend.updated':
          if (!event.creatorId || !event.viewerState) {
            return;
          }

          commitRelationship(event.creatorId, {
            isStreetFriend: event.viewerState.isStreetFriend,
            streetFriendStatus: event.viewerState.streetFriendStatus,
          });
          setStreetFriendIds(previous => {
            const next = { ...previous };
            if (event.viewerState?.isStreetFriend) {
              next[event.creatorId!] = true;
            } else {
              delete next[event.creatorId!];
            }
            return next;
          });
          return;
        default:
          return;
      }
    },
    [
      commitRelationship,
      mergeCommentIntoCache,
      replaceCommentsCache,
      syncPostSnapshotEverywhere,
      viewerId,
    ],
  );

  useEffect(() => {
    const socket = createExploreSocket(handleRealtimeEvent);
    setSocketStatus('connecting');

    socket.onopen = () => {
      setSocketStatus('live');
    };

    socket.onerror = () => {
      setSocketStatus('offline');
    };

    socket.onclose = () => {
      setSocketStatus('offline');
    };

    return () => {
      socket.close();
    };
  }, [handleRealtimeEvent]);

  const handleRefresh = useCallback(() => {
    const segment = activeTabRef.current;
    if (profilePrefillLockRef.current && segment === SEGMENT_EXPLORE) {
      return;
    }
    refreshFeedRequestIdRef.current += 1;
    const requestId = refreshFeedRequestIdRef.current;

    setFeedError(null);
    setIsRefreshing(true);
    setIsFetchingMore(false);

    fetchExploreFeed(segment, { force: true, limit: FEED_PAGE_LIMIT })
      .then(response => {
        if (
          requestId !== refreshFeedRequestIdRef.current ||
          activeTabRef.current !== segment
        ) {
          return;
        }
        commitFeed(
          {
            ...response,
            posts: mergePendingExploreSeedIntoPosts(segment, response.posts),
          },
          'replace',
          { segment },
        );
      })
      .catch(error => {
        if (
          requestId === refreshFeedRequestIdRef.current &&
          activeTabRef.current === segment
        ) {
          setFeedError(
            error instanceof Error
              ? error.message
              : 'Feed could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (
          requestId === refreshFeedRequestIdRef.current &&
          activeTabRef.current === segment
        ) {
          setIsRefreshing(false);
        }
      });
  }, [commitFeed]);

  const handleLoadMore = useCallback(() => {
    const segment = activeTabRef.current;
    if (profilePrefillLockRef.current && segment === SEGMENT_EXPLORE) {
      return;
    }
    const cursor = nextCursor;
    if (
      isLoadingFeed ||
      isRefreshing ||
      isFetchingMore ||
      loadMoreFeedInFlightRef.current ||
      !hasMore ||
      !cursor
    ) {
      return;
    }

    loadMoreFeedRequestIdRef.current += 1;
    const requestId = loadMoreFeedRequestIdRef.current;
    loadMoreFeedInFlightRef.current = true;
    setIsFetchingMore(true);
    fetchExploreFeed(segment, {
      cursor,
      limit: FEED_PAGE_LIMIT,
    })
      .then(response => {
        if (
          requestId !== loadMoreFeedRequestIdRef.current ||
          activeTabRef.current !== segment
        ) {
          return;
        }
        commitFeed(response, 'append', { segment });
      })
      .catch(error => {
        if (
          requestId === loadMoreFeedRequestIdRef.current &&
          activeTabRef.current === segment
        ) {
          setFeedError(
            error instanceof Error
              ? error.message
              : 'Feed could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (requestId === loadMoreFeedRequestIdRef.current) {
          loadMoreFeedInFlightRef.current = false;
        }
        if (
          requestId === loadMoreFeedRequestIdRef.current &&
          activeTabRef.current === segment
        ) {
          setIsFetchingMore(false);
        }
      });
  }, [
    commitFeed,
    hasMore,
    isFetchingMore,
    isLoadingFeed,
    isRefreshing,
    nextCursor,
  ]);

  const scrollToFeedPostIndex = useCallback((index: number) => {
    if (!Number.isFinite(index) || index < 0) {
      return;
    }

    const len = postsRef.current.length;
    const safeIndex = Math.max(
      0,
      Math.min(Math.trunc(index), Math.max(len - 1, 0)),
    );
    setActivePostIndex(safeIndex);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          feedListRef.current?.scrollToIndex({
            animated: false,
            index: safeIndex,
          });
        } catch {
          return;
        }
      });
    });
  }, []);

  useEffect(() => {
    if (!isSearchOpen || searchTab !== 'users') {
      return;
    }
    if (searchQuery.trim().length > 0) {
      return;
    }

    recentUsersAbortControllerRef.current?.abort();
    const requestAbortController = new AbortController();
    recentUsersAbortControllerRef.current = requestAbortController;

    let active = true;
    fetchExploreRecentUsers({
      limit: 8,
      signal: requestAbortController.signal,
    })
      .then(response => {
        if (!active || requestAbortController.signal.aborted) {
          return;
        }
        const filteredUsers = filterHiddenExploreUsers(
          cleanSearchUserList(response.users),
        ).slice(0, 8);
        setRecentUsers(filteredUsers);
        syncRelationshipStateFromUsers(filteredUsers);
      })
      .catch(error => {
        if (!active || requestAbortController.signal.aborted) {
          return;
        }
        if (
          isApiRequestError(error) &&
          [404, 405, 501].includes(error.status)
        ) {
          return;
        }
      });

    return () => {
      active = false;
      requestAbortController.abort();
      if (recentUsersAbortControllerRef.current === requestAbortController) {
        recentUsersAbortControllerRef.current = null;
      }
    };
  }, [
    filterHiddenExploreUsers,
    isSearchOpen,
    searchQuery,
    searchTab,
    syncRelationshipStateFromUsers,
  ]);

  useEffect(() => {
    if (!isSearchOpen || !isRecentSearchTab(searchTab)) {
      return;
    }
    if (searchQuery.trim().length > 0) {
      return;
    }

    const termTab = searchTab;
    recentSearchTermsAbortControllerRef.current?.abort();
    const requestAbortController = new AbortController();
    recentSearchTermsAbortControllerRef.current = requestAbortController;

    let active = true;
    fetchExploreRecentSearchTerms({
      kind: termTab,
      limit: 8,
      signal: requestAbortController.signal,
    })
      .then(response => {
        if (!active || requestAbortController.signal.aborted) {
          return;
        }
        setRecentSearchTermsByTab(previous => ({
          ...previous,
          [termTab]: response.items
            .filter(item => item.query.trim().length > 0)
            .slice(0, 8),
        }));
      })
      .catch(error => {
        if (!active || requestAbortController.signal.aborted) {
          return;
        }
        if (
          isApiRequestError(error) &&
          [404, 405, 501].includes(error.status)
        ) {
          return;
        }
      });

    return () => {
      active = false;
      requestAbortController.abort();
      if (recentSearchTermsAbortControllerRef.current === requestAbortController) {
        recentSearchTermsAbortControllerRef.current = null;
      }
    };
  }, [isSearchOpen, searchQuery, searchTab]);

  useEffect(() => {
    if (!isSearchOpen || !isRecentSearchTab(searchTab)) {
      return;
    }

    const termTab = searchTab;
    const trimmedQuery = searchQuery.trim();
    popularSearchTermsAbortControllerRef.current?.abort();
    const requestAbortController = new AbortController();
    popularSearchTermsAbortControllerRef.current = requestAbortController;

    let active = true;
    const timer = setTimeout(
      () => {
        fetchExplorePopularSearchTerms({
          kind: termTab,
          limit: 8,
          query: trimmedQuery.length > 0 ? trimmedQuery : undefined,
          signal: requestAbortController.signal,
        })
          .then(response => {
            if (!active || requestAbortController.signal.aborted) {
              return;
            }
            setPopularSearchTermsByTab(previous => ({
              ...previous,
              [termTab]: response.items
                .filter(item => item.query.trim().length > 0)
                .slice(0, 8),
            }));
          })
          .catch(error => {
            if (!active || requestAbortController.signal.aborted) {
              return;
            }
            if (
              isApiRequestError(error) &&
              [404, 405, 501].includes(error.status)
            ) {
              return;
            }
            setPopularSearchTermsByTab(previous => ({
              ...previous,
              [termTab]: [],
            }));
          });
      },
      trimmedQuery.length > 0 ? SEARCH_DEBOUNCE_MS : 0,
    );

    return () => {
      active = false;
      clearTimeout(timer);
      requestAbortController.abort();
      if (popularSearchTermsAbortControllerRef.current === requestAbortController) {
        popularSearchTermsAbortControllerRef.current = null;
      }
    };
  }, [isSearchOpen, searchQuery, searchTab]);

  useEffect(() => {
    if (!isSearchOpen || searchTab !== 'users') {
      return;
    }

    searchUsersAbortControllerRef.current?.abort();
    const requestAbortController = new AbortController();
    searchUsersAbortControllerRef.current = requestAbortController;

    const trimmed = searchQuery.trim();
    const isSuggestionMode = trimmed.length === 0;
    const requestLimit = isSuggestionMode ? 16 : 24;

    let active = true;
    const timer = setTimeout(
      () => {
        setIsSearchingUsers(true);
        setSearchError(null);

        searchExploreUsers(trimmed, {
          limit: requestLimit,
          signal: requestAbortController.signal,
        })
          .then(response => {
            if (!active || requestAbortController.signal.aborted) {
              return;
            }

            const filteredUsers = filterHiddenExploreUsers(
              cleanSearchUserList(response.users),
            );
            setSearchUsers(filteredUsers);
            syncRelationshipStateFromUsers(filteredUsers);
          })
          .catch(error => {
            if (!active || requestAbortController.signal.aborted) {
              return;
            }
            setSearchError(
              error instanceof Error
                ? error.message
                : 'Kullanicilar yuklenemedi.',
            );
            setSearchUsers([]);
          })
          .finally(() => {
            if (active && !requestAbortController.signal.aborted) {
              setIsSearchingUsers(false);
            }
          });
      },
      isSuggestionMode ? 0 : SEARCH_DEBOUNCE_MS,
    );

    return () => {
      active = false;
      clearTimeout(timer);
      requestAbortController.abort();
      if (searchUsersAbortControllerRef.current === requestAbortController) {
        searchUsersAbortControllerRef.current = null;
      }
    };
  }, [
    filterHiddenExploreUsers,
    isSearchOpen,
    searchQuery,
    syncRelationshipStateFromUsers,
    searchTab,
  ]);

  useEffect(() => {
    if ((searchTab === 'posts' || searchTab === 'places') && isSearchOpen) {
      return;
    }
    setIsFetchingMoreSearchPosts(false);
  }, [isSearchOpen, searchTab]);

  useEffect(() => {
    if (!isSearchOpen || (searchTab !== 'posts' && searchTab !== 'places')) {
      return;
    }

    searchPostsAbortControllerRef.current?.abort();
    const requestAbortController = new AbortController();
    searchPostsAbortControllerRef.current = requestAbortController;

    const trimmed = searchQuery.trim();
    const isPlacesTab = searchTab === 'places';
    const requestLimit = isPlacesTab ? 30 : 24;
    const effectiveMediaType: ExploreSearchPostFilter = isPlacesTab
      ? 'all'
      : searchPostsMediaType;
    const effectiveSort: ExploreSearchPostSort = isPlacesTab
      ? 'relevant'
      : searchPostsSort;
    const isSuggestionMode = trimmed.length === 0;

    let active = true;
    const timer = setTimeout(
      () => {
        searchPostsLoadMoreRequestIdRef.current += 1;
        setIsSearchingPosts(true);
        setIsFetchingMoreSearchPosts(false);
        setSearchPostsError(null);
        setSearchPostsHasMore(false);
        setSearchPostsNextCursor(null);

        searchExplorePosts(trimmed, {
          limit: requestLimit,
          mediaType: effectiveMediaType,
          signal: requestAbortController.signal,
          sort: effectiveSort,
        })
          .then(response => {
            if (!active || requestAbortController.signal.aborted) {
              return;
            }

            setSearchPosts(response.posts);
            setSearchPostsHasMore(response.hasMore === true);
            setSearchPostsNextCursor(response.nextCursor ?? null);
          })
          .catch(error => {
            if (!active || requestAbortController.signal.aborted) {
              return;
            }
            setSearchPostsError(
              error instanceof Error
                ? error.message
                : 'Gonderiler yuklenemedi.',
            );
            setSearchPosts([]);
            setSearchPostsHasMore(false);
            setSearchPostsNextCursor(null);
          })
          .finally(() => {
            if (active && !requestAbortController.signal.aborted) {
              setIsSearchingPosts(false);
            }
          });
      },
      isSuggestionMode ? 0 : SEARCH_DEBOUNCE_MS,
    );

    return () => {
      active = false;
      clearTimeout(timer);
      requestAbortController.abort();
      if (searchPostsAbortControllerRef.current === requestAbortController) {
        searchPostsAbortControllerRef.current = null;
      }
    };
  }, [
    isSearchOpen,
    searchPostsMediaType,
    searchPostsSort,
    searchQuery,
    searchTab,
  ]);

  useEffect(() => {
    if (!isSearchOpen || (searchTab !== 'posts' && searchTab !== 'tags')) {
      return;
    }

    trendingTagsAbortControllerRef.current?.abort();
    const requestAbortController = new AbortController();
    trendingTagsAbortControllerRef.current = requestAbortController;

    const normalizedQuery = normalizeTrendingTagKey(searchQuery);
    const isSuggestionMode = normalizedQuery.length === 0;
    if (
      isSuggestionMode &&
      trendingTags.length > 0 &&
      Date.now() - trendingTagsLastFetchedAtRef.current <
      SEARCH_SUGGESTIONS_CACHE_TTL_MS
    ) {
      return;
    }

    let active = true;
    const timer = setTimeout(
      () => {
        setIsLoadingTrendingTags(true);
        setTrendingTagsError(null);

        fetchExploreTrendingTags({
          limit: searchTab === 'tags' ? 28 : 12,
          query: normalizedQuery.length > 0 ? normalizedQuery : undefined,
          signal: requestAbortController.signal,
        })
          .then(response => {
            if (!active || requestAbortController.signal.aborted) {
              return;
            }
            setTrendingTags(response.tags);
            if (isSuggestionMode) {
              trendingTagsLastFetchedAtRef.current = Date.now();
            }
          })
          .catch(error => {
            if (!active || requestAbortController.signal.aborted) {
              return;
            }
            setTrendingTagsError(
              error instanceof Error
                ? error.message
                : 'Trend etiketler su an alinamadi.',
            );
            setTrendingTags([]);
          })
          .finally(() => {
            if (active && !requestAbortController.signal.aborted) {
              setIsLoadingTrendingTags(false);
            }
          });
      },
      isSuggestionMode ? 0 : SEARCH_DEBOUNCE_MS,
    );

    return () => {
      active = false;
      clearTimeout(timer);
      requestAbortController.abort();
      if (trendingTagsAbortControllerRef.current === requestAbortController) {
        trendingTagsAbortControllerRef.current = null;
      }
    };
  }, [
    isSearchOpen,
    searchQuery,
    searchTab,
    trendingTags.length,
  ]);

  const handleSearchClose = useCallback(() => {
    recentUsersAbortControllerRef.current?.abort();
    recentSearchTermsAbortControllerRef.current?.abort();
    popularSearchTermsAbortControllerRef.current?.abort();
    searchUsersAbortControllerRef.current?.abort();
    searchPostsAbortControllerRef.current?.abort();
    trendingTagsAbortControllerRef.current?.abort();
    trendingTagDetailAbortControllerRef.current?.abort();
    publicProfileRequestIdRef.current += 1;
    searchPostsLoadMoreRequestIdRef.current += 1;
    setIsSearchOpen(false);
    setSelectedSearchUser(null);
    setSelectedPublicProfile(null);
    setPublicProfilePosts([]);
    setPublicProfileError(null);
    setPublicProfilePostsError(null);
    setIsLoadingPublicProfile(false);
    setIsLoadingPublicProfilePosts(false);
    setSearchQuery('');
    setSearchTab('users');
    setSearchError(null);
    setIsSearchingUsers(false);
    setSearchPosts([]);
    setSearchPostsSort('popular');
    setSearchPostsMediaType('all');
    setSearchPostsHasMore(false);
    setSearchPostsNextCursor(null);
    setIsFetchingMoreSearchPosts(false);
    setSearchPostsError(null);
    setIsSearchingPosts(false);
    setSearchActionPendingUserId(null);
    searchPanelOpacity.setValue(1);
    searchPanelTranslateX.setValue(0);
    isSearchTabAnimatingRef.current = false;
  }, [searchPanelOpacity, searchPanelTranslateX]);

  const handleSearchTabChange = useCallback((nextTab: SearchPanelTab) => {
    if (nextTab === searchTab || isSearchTabAnimatingRef.current) {
      return;
    }

    const currentIndex = SEARCH_PANEL_TABS.indexOf(searchTab);
    const nextIndex = SEARCH_PANEL_TABS.indexOf(nextTab);
    const direction = nextIndex > currentIndex ? 1 : -1;
    isSearchTabAnimatingRef.current = true;

    RNAnimated.parallel([
      RNAnimated.timing(searchPanelOpacity, {
        duration: 120,
        easing: RNEasing.out(RNEasing.quad),
        toValue: 0,
        useNativeDriver: true,
      }),
      RNAnimated.timing(searchPanelTranslateX, {
        duration: 120,
        easing: RNEasing.out(RNEasing.quad),
        toValue: direction * -18,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (!finished) {
        isSearchTabAnimatingRef.current = false;
        return;
      }

      setSearchTab(nextTab);
      searchPanelOpacity.setValue(0);
      searchPanelTranslateX.setValue(direction * 18);

      requestAnimationFrame(() => {
        RNAnimated.parallel([
          RNAnimated.timing(searchPanelOpacity, {
            duration: 170,
            easing: RNEasing.out(RNEasing.cubic),
            toValue: 1,
            useNativeDriver: true,
          }),
          RNAnimated.timing(searchPanelTranslateX, {
            duration: 170,
            easing: RNEasing.out(RNEasing.cubic),
            toValue: 0,
            useNativeDriver: true,
          }),
        ]).start(() => {
          isSearchTabAnimatingRef.current = false;
        });
      });
    });
  }, [searchPanelOpacity, searchPanelTranslateX, searchTab]);

  const closePublicProfile = useCallback(() => {
    const returnTab = publicProfileReturnTabRef.current;
    publicProfileReturnTabRef.current = null;
    publicProfileRequestIdRef.current += 1;
    setIsProfileActionsVisible(false);
    setSelectedSearchUser(null);
    setSelectedPublicProfile(null);
    setPublicProfilePosts([]);
    setPublicProfileError(null);
    setPublicProfilePostsError(null);
    setIsSelectedProfileUnavailable(false);
    setIsLoadingPublicProfile(false);
    setIsLoadingPublicProfilePosts(false);
    if (returnTab) {
      onPrefillPublicProfileBackRequested?.(returnTab);
    }
  }, [onPrefillPublicProfileBackRequested]);

  useEffect(() => {
    if (!isSearchOpen || selectedSearchUser) {
      return;
    }

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        handleSearchClose();
        return true;
      },
    );

    return () => {
      subscription.remove();
    };
  }, [handleSearchClose, isSearchOpen, selectedSearchUser]);

  useEffect(() => {
    if (!selectedSearchUser) {
      return;
    }

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        closePublicProfile();
        return true;
      },
    );

    return () => {
      subscription.remove();
    };
  }, [closePublicProfile, selectedSearchUser]);

  const resolveSearchActionError = useCallback((error: unknown) => {
    if (isApiRequestError(error) && typeof error.message === 'string') {
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'Islem tamamlanamadi.';
  }, []);

  const isProfileUnavailableError = useCallback((error: unknown) => {
    return (
      isApiRequestError(error) &&
      (error.code === 'profile_not_found' || error.status === 404)
    );
  }, []);

  const handleRemoveRecentUser = useCallback(
    (userId: string) => {
      const normalizedUserId = userId.trim();
      if (normalizedUserId.length === 0) {
        return;
      }
      setRecentUsers(previous =>
        previous.filter(item => item.id !== normalizedUserId),
      );
      removeExploreRecentUser(normalizedUserId).catch(error => {
        if (
          isApiRequestError(error) &&
          [404, 405, 501].includes(error.status)
        ) {
          return;
        }
        setSearchError(resolveSearchActionError(error));
      });
    },
    [resolveSearchActionError],
  );

  const handleClearRecentUsers = useCallback(() => {
    setRecentUsers([]);
    if (searchQuery.trim().length === 0) {
      setSelectedSearchUser(null);
      setSelectedPublicProfile(null);
    }
    clearExploreRecentUsers().catch(error => {
      if (isApiRequestError(error) && [404, 405, 501].includes(error.status)) {
        return;
      }
      setSearchError(resolveSearchActionError(error));
    });
  }, [resolveSearchActionError, searchQuery]);

  const normalizeRecentSearchTermForTab = useCallback(
    (tab: SearchRecentTermTab, rawQuery: string) => {
      const compactQuery = rawQuery.trim().replace(/\s+/g, ' ').slice(0, 120);
      if (compactQuery.length < 2) {
        return '';
      }
      if (tab === 'tags') {
        const normalizedTag = normalizeTrendingTagKey(compactQuery);
        return normalizedTag ? `#${normalizedTag}` : '';
      }
      return compactQuery;
    },
    [],
  );

  const recentSearchTermKeyForTab = useCallback(
    (tab: SearchRecentTermTab, query: string) => {
      if (tab === 'tags') {
        const normalizedTag = normalizeTrendingTagKey(query);
        if (normalizedTag.length > 0) {
          return normalizedTag;
        }
      }
      return query.trim().toLocaleLowerCase('tr-TR');
    },
    [],
  );

  const upsertRecentSearchTermState = useCallback(
    (tab: SearchRecentTermTab, query: string) => {
      setRecentSearchTermsByTab(previous => {
        const nextLookupKey = recentSearchTermKeyForTab(tab, query);
        const deduped = previous[tab].filter(
          item => recentSearchTermKeyForTab(tab, item.query) !== nextLookupKey,
        );
        const nextItem: ExploreRecentSearchTerm = {
          kind: tab,
          query,
          searchedAt: new Date().toISOString(),
        };
        return {
          ...previous,
          [tab]: [nextItem, ...deduped].slice(0, 8),
        };
      });
    },
    [recentSearchTermKeyForTab],
  );

  const saveRecentSearchTerm = useCallback(
    (tab: SearchRecentTermTab, rawQuery: string) => {
      const normalizedQuery = normalizeRecentSearchTermForTab(tab, rawQuery);
      if (!normalizedQuery) {
        return;
      }
      upsertRecentSearchTermState(tab, normalizedQuery);
      recordExploreRecentSearchTerm(tab, normalizedQuery).catch(error => {
        if (isApiRequestError(error) && [404, 405, 501].includes(error.status)) {
          return;
        }
      });
    },
    [normalizeRecentSearchTermForTab, upsertRecentSearchTermState],
  );

  const handleRemoveRecentSearchTerm = useCallback(
    (tab: SearchRecentTermTab, query: string) => {
      const normalizedQuery = normalizeRecentSearchTermForTab(tab, query);
      if (!normalizedQuery) {
        return;
      }
      const lookupKey = recentSearchTermKeyForTab(tab, normalizedQuery);
      setRecentSearchTermsByTab(previous => ({
        ...previous,
        [tab]: previous[tab].filter(
          item => recentSearchTermKeyForTab(tab, item.query) !== lookupKey,
        ),
      }));
      removeExploreRecentSearchTerm(tab, normalizedQuery).catch(error => {
        if (isApiRequestError(error) && [404, 405, 501].includes(error.status)) {
          return;
        }
      });
    },
    [normalizeRecentSearchTermForTab, recentSearchTermKeyForTab],
  );

  const handleClearRecentSearchTerms = useCallback((tab: SearchRecentTermTab) => {
    setRecentSearchTermsByTab(previous => ({
      ...previous,
      [tab]: [],
    }));
    clearExploreRecentSearchTerms(tab).catch(error => {
      if (isApiRequestError(error) && [404, 405, 501].includes(error.status)) {
        return;
      }
    });
  }, []);

  const handleSearchInputSubmit = useCallback(() => {
    if (!isRecentSearchTab(searchTab)) {
      return;
    }
    saveRecentSearchTerm(searchTab, searchQuery);
  }, [saveRecentSearchTerm, searchQuery, searchTab]);

  const buildOverlayRouteId = useCallback(
    (kind: ExploreOverlayRoute['kind']) => {
      overlayRouteIdRef.current += 1;
      return `${kind}_${overlayRouteIdRef.current}`;
    },
    [],
  );

  const popExploreOverlayRoute = useCallback(() => {
    setOverlayRoutes(previous => {
      if (previous.length === 0) {
        return previous;
      }
      return previous.slice(0, -1);
    });
  }, []);

  const closeTrendingTagPages = useCallback(() => {
    setOverlayRoutes(previous =>
      previous.filter(
        route =>
          route.kind !== 'trend-tag-detail' && route.kind !== 'trend-tag-feed',
      ),
    );
    setTrendingTagDetailTab('top');
    setTrendingTagDetailError(null);
    setIsFetchingMoreTrendingTagPosts(false);
  }, []);

  useEffect(() => {
    if (overlayRoutes.length === 0) {
      return;
    }

    const topRoute = overlayRoutes[overlayRoutes.length - 1];
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (topRoute.kind === 'trend-tag-feed') {
          popExploreOverlayRoute();
          return true;
        }

        closeTrendingTagPages();
        return true;
      },
    );

    return () => {
      subscription.remove();
    };
  }, [closeTrendingTagPages, overlayRoutes, popExploreOverlayRoute]);

  const loadTrendingTagDetail = useCallback(
    (
      rawTag: string,
      options?: {
        append?: boolean;
        cursor?: string | null;
        preferCache?: boolean;
      },
    ) => {
      const normalizedTag = normalizeTrendingTagKey(rawTag);
      if (!normalizedTag) {
        setTrendingTagDetailError('Etiket gecersiz.');
        return;
      }

      const append = options?.append === true;
      const detailCursor = options?.cursor?.trim() ?? '';

      if (!append) {
        setActiveTrendingTagKey(normalizedTag);
        setTrendingTagDetailError(null);

        const cached = trendingTagDetailCacheRef.current[normalizedTag];
        if (
          options?.preferCache !== false &&
          cached &&
          Date.now() - cached.cachedAt < TRENDING_TAG_DETAIL_CACHE_TTL_MS
        ) {
          setTrendingTagDetail(cached.value);
          setIsLoadingTrendingTagDetail(false);
          setIsFetchingMoreTrendingTagPosts(false);
          return;
        }

        setIsLoadingTrendingTagDetail(true);
        setTrendingTagDetail(null);
      } else {
        setIsFetchingMoreTrendingTagPosts(true);
        setTrendingTagDetailError(null);
      }

      const requestId = trendingTagDetailRequestIdRef.current + 1;
      trendingTagDetailRequestIdRef.current = requestId;
      trendingTagDetailAbortControllerRef.current?.abort();
      const requestAbortController = new AbortController();
      trendingTagDetailAbortControllerRef.current = requestAbortController;

      fetchExploreTagDetail(normalizedTag, {
        cursor: append ? detailCursor : undefined,
        limit: TRENDING_TAG_RECENT_PAGE_LIMIT,
        signal: requestAbortController.signal,
      })
        .then(response => {
          if (
            requestAbortController.signal.aborted ||
            trendingTagDetailRequestIdRef.current !== requestId
          ) {
            return;
          }

          const nextValue =
            append && trendingTagDetail
              ? {
                ...response,
                recentPosts: mergeFeedPosts(
                  trendingTagDetail.recentPosts,
                  response.recentPosts,
                ),
              }
              : response;

          trendingTagDetailCacheRef.current[normalizedTag] = {
            cachedAt: Date.now(),
            value: nextValue,
          };
          setTrendingTagDetail(nextValue);
        })
        .catch(error => {
          if (
            requestAbortController.signal.aborted ||
            trendingTagDetailRequestIdRef.current !== requestId
          ) {
            return;
          }
          setTrendingTagDetailError(
            resolveSearchActionError(error) ||
            'Etiket sayfasi su an acilamadi.',
          );
        })
        .finally(() => {
          if (
            trendingTagDetailAbortControllerRef.current === requestAbortController
          ) {
            trendingTagDetailAbortControllerRef.current = null;
          }
          if (
            requestAbortController.signal.aborted ||
            trendingTagDetailRequestIdRef.current !== requestId
          ) {
            return;
          }
          setIsLoadingTrendingTagDetail(false);
          setIsFetchingMoreTrendingTagPosts(false);
        });
    },
    [mergeFeedPosts, resolveSearchActionError, trendingTagDetail],
  );

  const openTrendingTagDetail = useCallback(
    (rawTag: string) => {
      const normalizedTag = normalizeTrendingTagKey(rawTag);
      if (!normalizedTag) {
        return;
      }

      saveRecentSearchTerm('tags', `#${normalizedTag}`);
      setTrendingTagDetailTab('top');
      setTrendingTagDetailError(null);
      setIsFetchingMoreTrendingTagPosts(false);
      setOverlayRoutes(previous => {
        const activeRoute = previous[previous.length - 1];
        if (activeRoute?.kind === 'trend-tag-detail') {
          return previous.map((route, index) =>
            index === previous.length - 1 ? { ...route, tag: normalizedTag } : route,
          );
        }
        return [
          ...previous,
          {
            id: buildOverlayRouteId('trend-tag-detail'),
            kind: 'trend-tag-detail',
            tag: normalizedTag,
          },
        ];
      });
      loadTrendingTagDetail(normalizedTag, { preferCache: true });
    },
    [buildOverlayRouteId, loadTrendingTagDetail, saveRecentSearchTerm],
  );

  const handleLoadMoreTrendingTagPosts = useCallback(() => {
    if (
      !activeTrendingTagKey ||
      !trendingTagDetail?.recentHasMore ||
      !trendingTagDetail.recentNextCursor ||
      isFetchingMoreTrendingTagPosts
    ) {
      return;
    }

    loadTrendingTagDetail(activeTrendingTagKey, {
      append: true,
      cursor: trendingTagDetail.recentNextCursor,
      preferCache: false,
    });
  }, [
    activeTrendingTagKey,
    isFetchingMoreTrendingTagPosts,
    loadTrendingTagDetail,
    trendingTagDetail,
  ]);


  const handleSearchFollow = useCallback((user: ExploreSearchUser) => {
    const current = relationshipForUser(user);
    const isCancellingPendingRequest =
      !current.isFollowing &&
      current.followRequestStatus === 'pending_outgoing';
    const optimisticFollowing = current.isFollowing
      ? false
      : isCancellingPendingRequest
        ? false
        : !user.isPrivateAccount;
    const optimisticFollowRequestStatus: FollowRequestStatus =
      current.isFollowing || isCancellingPendingRequest
        ? 'none'
        : user.isPrivateAccount
          ? 'pending_outgoing'
          : 'none';
    setSearchActionPendingUserId(user.id);
    setSearchError(null);

    commitRelationship(user.id, {
      followRequestStatus: optimisticFollowRequestStatus,
      isFollowing: optimisticFollowing,
    });

    followCreator(user.id)
      .then(response => {
        commitRelationship(response.creatorId, {
          followRequestStatus: response.followRequestStatus,
          followsYou: response.followsYou,
          isFollowing: response.isFollowing,
          ...(typeof response.followersCount === 'number' &&
          Number.isFinite(response.followersCount)
            ? { creatorFollowersCount: response.followersCount }
            : {}),
        });
      })
      .catch(error => {
        commitRelationship(user.id, {
          followRequestStatus: current.followRequestStatus,
          followsYou: current.followsYou,
          isFollowing: current.isFollowing,
          isStreetFriend: current.isStreetFriend,
          streetFriendStatus: current.streetFriendStatus,
        });
        setSearchError(resolveSearchActionError(error));
      })
      .finally(() => {
        setSearchActionPendingUserId(null);
      });
  }, [commitRelationship, relationshipForUser, resolveSearchActionError]);

  const handleIncomingFollowRequestDecision = useCallback(
    (user: ExploreSearchUser, accept: boolean) => {
      const current = relationshipForUser(user);
      if (current.followRequestStatus !== 'pending_incoming') {
        return;
      }
      setSearchActionPendingUserId(user.id);
      setSearchError(null);
      commitRelationship(user.id, {
        followRequestStatus: 'none',
        followsYou: accept,
      });
      const request = accept
        ? acceptFollowRequest(user.id)
        : rejectFollowRequest(user.id);
      request
        .then(() => {
          commitRelationship(user.id, {
            followRequestStatus: 'none',
            followsYou: accept,
          });
          if (accept) {
            setSelectedPublicProfile(previous =>
              previous && previous.id === user.id
                ? {
                    ...previous,
                    stats: {
                      ...previous.stats,
                      followingCount: previous.stats.followingCount + 1,
                    },
                    viewerState: {
                      ...previous.viewerState,
                      followRequestStatus: 'none',
                      followsYou: true,
                    },
                  }
                : previous,
            );
          }
        })
        .catch(error => {
          commitRelationship(user.id, {
            followRequestStatus: current.followRequestStatus,
            followsYou: current.followsYou,
            isFollowing: current.isFollowing,
            isStreetFriend: current.isStreetFriend,
            streetFriendStatus: current.streetFriendStatus,
          });
          setSearchError(resolveSearchActionError(error));
        })
        .finally(() => {
          setSearchActionPendingUserId(null);
        });
    },
    [commitRelationship, relationshipForUser, resolveSearchActionError],
  );

  const handleSearchStreetFriend = useCallback((user: ExploreSearchUser) => {
    const current = relationshipForUser(user);
    const isCancellingStreetRequest =
      current.streetFriendStatus === 'pending_outgoing' ||
      current.streetFriendStatus === 'accepted';
    const optimisticStreetFriendStatus: StreetFriendStatus =
      isCancellingStreetRequest
        ? 'none'
        : current.streetFriendStatus === 'pending_incoming'
          ? 'accepted'
          : 'pending_outgoing';
    const optimisticIsStreetFriend =
      optimisticStreetFriendStatus === 'accepted';

    setSearchActionPendingUserId(user.id);
    setSearchError(null);
    commitRelationship(user.id, {
      isStreetFriend: optimisticIsStreetFriend,
      streetFriendStatus: optimisticStreetFriendStatus,
    });
    setStreetFriendIds(previous => {
      const next = { ...previous };
      if (optimisticIsStreetFriend) {
        next[user.id] = true;
      } else {
        delete next[user.id];
      }
      return next;
    });

    const request = isCancellingStreetRequest
      ? removeStreetFriend(user.id)
      : upsertStreetFriend(user.id);
    request
      .then(response => {
        commitRelationship(response.creatorId, {
          isStreetFriend: response.isStreetFriend,
          streetFriendStatus: response.streetFriendStatus,
        });
        setStreetFriendIds(previous => {
          const next = { ...previous };
          if (response.isStreetFriend) {
            next[response.creatorId] = true;
          } else {
            delete next[response.creatorId];
          }
          return next;
        });
      })
      .catch(error => {
        commitRelationship(user.id, {
          isStreetFriend: current.isStreetFriend,
          streetFriendStatus: current.streetFriendStatus,
        });
        setStreetFriendIds(previous => {
          const next = { ...previous };
          if (current.isStreetFriend) {
            next[user.id] = true;
          } else {
            delete next[user.id];
          }
          return next;
        });
        setSearchError(resolveSearchActionError(error));
      })
      .finally(() => {
        setSearchActionPendingUserId(null);
      });
  }, [commitRelationship, relationshipForUser, resolveSearchActionError]);

  const handleRejectIncomingStreetRequest = useCallback(
    (user: ExploreSearchUser) => {
      const current = relationshipForUser(user);
      if (current.streetFriendStatus !== 'pending_incoming') {
        return;
      }
      setSearchActionPendingUserId(user.id);
      setSearchError(null);
      commitRelationship(user.id, {
        isStreetFriend: false,
        streetFriendStatus: 'none',
      });
      removeStreetFriend(user.id)
        .then(response => {
          commitRelationship(response.creatorId, {
            isStreetFriend: response.isStreetFriend,
            streetFriendStatus: response.streetFriendStatus,
          });
          setStreetFriendIds(previous => {
            const next = { ...previous };
            if (response.isStreetFriend) {
              next[response.creatorId] = true;
            } else {
              delete next[response.creatorId];
            }
            return next;
          });
        })
        .catch(error => {
          commitRelationship(user.id, {
            isStreetFriend: current.isStreetFriend,
            streetFriendStatus: current.streetFriendStatus,
          });
          setSearchError(resolveSearchActionError(error));
        })
        .finally(() => {
          setSearchActionPendingUserId(null);
        });
    },
    [commitRelationship, relationshipForUser, resolveSearchActionError],
  );

  function removeUserFromCollections(userId: string) {
    setSearchUsers(previous => previous.filter(item => item.id !== userId));
    setRecentUsers(previous => previous.filter(item => item.id !== userId));
    setSearchPosts(previous =>
      previous.filter(post => safeAuthorId(post.author) !== userId),
    );
    setPosts(previous =>
      previous.filter(post => safeAuthorId(post.author) !== userId),
    );
    setRelationshipByUserId(previous => {
      if (!previous[userId]) {
        return previous;
      }
      const next = { ...previous };
      delete next[userId];
      return next;
    });
    setStreetFriendIds(previous => {
      if (!previous[userId]) {
        return previous;
      }
      const next = { ...previous };
      delete next[userId];
      return next;
    });
    if (userId.trim().length > 0) {
      removeExploreRecentUser(userId).catch(() => {
        return;
      });
    }
  }

  const openPublicProfile = useCallback(
    (user: ExploreSearchUser) => {
      pushRecentUser(user);
      setIsProfileActionsVisible(false);
      setSelectedSearchUser(user);
      setSelectedPublicProfile(null);
      setPublicProfilePosts([]);
      setPublicProfileError(null);
      setPublicProfilePostsError(null);
      setIsSelectedProfileUnavailable(false);
      setIsLoadingPublicProfile(true);
      setIsLoadingPublicProfilePosts(true);
      const requestId = publicProfileRequestIdRef.current + 1;
      publicProfileRequestIdRef.current = requestId;

      fetchPublicProfile(user.id)
        .then(profile => {
          if (publicProfileRequestIdRef.current !== requestId) {
            return;
          }
          if (
            profile.viewerState.isBlockedByTarget ||
            profile.viewerState.isBlockedByViewer
          ) {
            setSelectedPublicProfile(null);
            setPublicProfilePosts([]);
            setPublicProfilePostsError(null);
            setIsSelectedProfileUnavailable(true);
            setIsLoadingPublicProfilePosts(false);
            return;
          }
          setSelectedPublicProfile(profile);
          commitRelationship(profile.id, {
            followRequestStatus: profile.viewerState.followRequestStatus,
            followsYou: profile.viewerState.followsYou,
            isFollowing: profile.viewerState.isFollowing,
            isStreetFriend: profile.viewerState.isStreetFriend,
            streetFriendStatus: profile.viewerState.streetFriendStatus,
          });
          fetchStreetFriendStatus(user.id)
            .then(streetStatus => {
              if (publicProfileRequestIdRef.current !== requestId) {
                return;
              }
              if (
                !streetStatus ||
                streetStatus.targetUserId.trim().length === 0 ||
                streetStatus.targetUserId !== user.id
              ) {
                return;
              }
              commitRelationship(user.id, {
                isStreetFriend: streetStatus.isStreetFriend,
                streetFriendStatus: streetStatus.streetFriendStatus,
              });
              setSelectedPublicProfile(previous =>
                previous && previous.id === user.id
                  ? {
                      ...previous,
                      viewerState: {
                        ...previous.viewerState,
                        isStreetFriend: streetStatus.isStreetFriend,
                        streetFriendStatus: streetStatus.streetFriendStatus,
                      },
                    }
                  : previous,
              );
            })
            .catch(() => {
              return;
            });

          const canViewPosts =
            !profile.isPrivateAccount || profile.viewerState.isFollowing;
          if (!canViewPosts) {
            setPublicProfilePosts([]);
            setPublicProfilePostsError(null);
            setIsLoadingPublicProfilePosts(false);
            return;
          }

          fetchPublicProfilePosts(user.id, { limit: 18 })
            .then(response => {
              if (publicProfileRequestIdRef.current !== requestId) {
                return;
              }
              setPublicProfilePosts(response.posts);
            })
            .catch(error => {
              if (publicProfileRequestIdRef.current !== requestId) {
                return;
              }
              setPublicProfilePostsError(resolveSearchActionError(error));
            })
            .finally(() => {
              if (publicProfileRequestIdRef.current !== requestId) {
                return;
              }
              setIsLoadingPublicProfilePosts(false);
            });
        })
        .catch(error => {
          if (publicProfileRequestIdRef.current !== requestId) {
            return;
          }
          if (isProfileUnavailableError(error)) {
            setSelectedPublicProfile(null);
            setPublicProfilePosts([]);
            setPublicProfilePostsError(null);
            setPublicProfileError(null);
            setIsSelectedProfileUnavailable(true);
            setIsLoadingPublicProfilePosts(false);
            return;
          }
          setPublicProfileError(resolveSearchActionError(error));
          setIsLoadingPublicProfilePosts(false);
        })
        .finally(() => {
          if (publicProfileRequestIdRef.current !== requestId) {
            return;
          }
          setIsLoadingPublicProfile(false);
        });
    },
    [
      commitRelationship,
      fetchStreetFriendStatus,
      isProfileUnavailableError,
      pushRecentUser,
      resolveSearchActionError,
    ],
  );

  useEffect(() => {
    if (!prefillPublicProfileUser) {
      return;
    }

    publicProfileReturnTabRef.current = prefillPublicProfileReturnTab ?? null;
    openPublicProfile(prefillPublicProfileUser);
    onPrefillPublicProfileUserConsumed?.();
  }, [
    prefillPublicProfileReturnTab,
    onPrefillPublicProfileUserConsumed,
    openPublicProfile,
    prefillPublicProfileUser,
  ]);

  useEffect(() => {
    if (!prefillViewerRequest) {
      return;
    }
    setIsProfileBackOnlyHeader(Boolean(prefillViewerRequest.fromProfile));
    setActiveTab(SEGMENT_EXPLORE);
    const prefillPosts = prefillViewerRequest.posts;
    profilePrefillLockRef.current = Boolean(prefillViewerRequest.fromProfile);
    if (prefillPosts.length === 0) {
      pendingPrefillPostIdRef.current = null;
      pendingPrefillLoadAttemptsRef.current = 0;
      onPrefillViewerRequestConsumed?.();
      return;
    }

    const boundedIndex = Math.max(
      0,
      Math.min(
        Math.trunc(prefillViewerRequest.initialIndex),
        prefillPosts.length - 1,
      ),
    );
    const targetPost = prefillPosts[boundedIndex];
    if (prefillViewerRequest.fromProfile) {
      const mappedPrefillPosts = prefillPosts.map(item =>
        mapViewerRequestPostToExplorePost(
          item,
          viewerId,
          viewerAvatarUrl,
          viewerUsername,
        ),
      );
      setPosts(mappedPrefillPosts);
      setFeedError(null);
      setHasMore(false);
      setNextCursor(null);
      setRankVersion(null);
      setLastFeedGeneratedAt(new Date().toISOString());
      setIsLoadingFeed(false);
      setIsRefreshing(false);
      setIsFetchingMore(false);
      feedCacheByTabRef.current[SEGMENT_EXPLORE] = {
        cachedAt: Date.now(),
        generatedAt: new Date().toISOString(),
        hasMore: false,
        nextCursor: null,
        posts: mappedPrefillPosts,
        rankVersion: null,
      };
      const targetIndex = mappedPrefillPosts.findIndex(
        post => post.id === targetPost?.id,
      );
      if (targetIndex >= 0) {
        requestAnimationFrame(() => {
          scrollToFeedPostIndex(targetIndex);
        });
      }
    } else if (targetPost) {
      seedExploreFeedPost(
        mapViewerRequestPostToExplorePost(
          targetPost,
          viewerId,
          viewerAvatarUrl,
          viewerUsername,
        ),
      );
    }
    const targetPostId = targetPost?.id?.trim() ?? '';
    pendingPrefillPostIdRef.current =
      targetPostId.length > 0 ? targetPostId : null;
    pendingPrefillLoadAttemptsRef.current = 0;
    onPrefillViewerRequestConsumed?.();
  }, [
    feedCacheByTabRef,
    onPrefillViewerRequestConsumed,
    prefillViewerRequest,
    seedExploreFeedPost,
    scrollToFeedPostIndex,
    viewerAvatarUrl,
    viewerId,
    viewerUsername,
  ]);

  useEffect(() => {
    const targetPostId = pendingPrefillPostIdRef.current;
    if (!targetPostId) {
      return;
    }

    if (activeTab !== SEGMENT_EXPLORE) {
      setActiveTab(SEGMENT_EXPLORE);
      return;
    }

    const targetIndex = posts.findIndex(post => post.id === targetPostId);
    if (targetIndex >= 0) {
      scrollToFeedPostIndex(targetIndex);
      pendingPrefillPostIdRef.current = null;
      pendingPrefillLoadAttemptsRef.current = 0;
      return;
    }

    if (isLoadingFeed || isFetchingMore || isRefreshing) {
      return;
    }

    if (hasMore && nextCursor && pendingPrefillLoadAttemptsRef.current < 8) {
      pendingPrefillLoadAttemptsRef.current += 1;
      handleLoadMore();
      return;
    }

    pendingPrefillPostIdRef.current = null;
    pendingPrefillLoadAttemptsRef.current = 0;
  }, [
    activeTab,
    handleLoadMore,
    hasMore,
    isFetchingMore,
    isLoadingFeed,
    isRefreshing,
    nextCursor,
    posts,
    scrollToFeedPostIndex,
  ]);

  function openBlockUserSheet(user: ExploreSearchUser) {
    if (searchActionPendingUserId) {
      return;
    }
    setBlockConfirmUser(user);
  }

  function applyExploreUserBlocked(user: ExploreSearchUser) {
    publicProfileRequestIdRef.current += 1;
    rememberHiddenExploreUser(user);
    removeUserFromCollections(user.id);
    setSelectedSearchUser(previous => (previous?.id === user.id ? null : previous));
    setSelectedPublicProfile(previous =>
      previous?.id === user.id ? null : previous,
    );
    setPublicProfilePosts([]);
    setPublicProfilePostsError(null);
  }

  function handleUnblockUser(user: ExploreSearchUser) {
    if (searchActionPendingUserId) {
      return;
    }

    void confirm({
      confirmLabel: 'Kaldir',
      message: `@${user.username} engeli kaldirilsin mi?`,
      title: 'Engeli kaldir',
      tone: 'warning',
    }).then(accepted => {
      if (!accepted) {
        return;
      }
      setSearchActionPendingUserId(user.id);
      setSearchError(null);
      unblockUser(user.id)
        .then(() => {
          revealHiddenExploreUser(user);
          setSelectedPublicProfile(previous =>
            previous?.id === user.id
              ? {
                  ...previous,
                  viewerState: {
                    ...previous.viewerState,
                    isBlockedByViewer: false,
                  },
                }
              : previous,
          );
          openPublicProfile(user);
        })
        .catch(error => {
          setSearchError(resolveSearchActionError(error));
        })
        .finally(() => {
          setSearchActionPendingUserId(null);
        });
    });
  }

  const handleToggleFollow = useCallback(
    (post: ExplorePost) => {
      const authorId = safeAuthorId(post.author);
      if (!authorId) {
        showToast({
          message:
            'Bu gonderinin sahibi bilgisi eksik oldugu icin islem su an tamamlanamiyor.',
          title: 'Takip islemi yapilamadi',
          tone: 'warning',
        });
        return;
      }

      const previousRelationship = relationshipByUserId[authorId] ?? {
        followRequestStatus: post.viewerState.followRequestStatus,
        followsYou: false,
        isFollowing: post.viewerState.isFollowing,
        isStreetFriend: post.viewerState.isStreetFriend,
        streetFriendStatus: post.viewerState.streetFriendStatus,
      };
      const optimisticFollowing = !previousRelationship.isFollowing;
      commitRelationship(authorId, {
        followRequestStatus: 'none',
        isFollowing: optimisticFollowing,
      });

      followCreator(authorId)
        .then(response => {
          commitRelationship(response.creatorId, {
            followRequestStatus: response.followRequestStatus,
            followsYou: response.followsYou,
            isFollowing: response.isFollowing,
            ...(typeof response.followersCount === 'number' &&
            Number.isFinite(response.followersCount)
              ? { creatorFollowersCount: response.followersCount }
              : {}),
          });
        })
        .catch(() => {
          commitRelationship(authorId, {
            followRequestStatus: previousRelationship.followRequestStatus,
            followsYou: previousRelationship.followsYou,
            isFollowing: previousRelationship.isFollowing,
            isStreetFriend: previousRelationship.isStreetFriend,
            streetFriendStatus: previousRelationship.streetFriendStatus,
          });
          setStreetFriendIds(previous => {
            const next = { ...previous };
            if (previousRelationship.isStreetFriend) {
              next[authorId] = true;
            } else {
              delete next[authorId];
            }
            return next;
          });
        });
    },
    [commitRelationship, relationshipByUserId, showToast],
  );

  const handleOpenProfileFromPost = useCallback(
    (post: ExplorePost) => {
      const authorId = safeAuthorId(post.author);
      if (!authorId || authorIdsEqual(authorId, viewerId)) {
        return;
      }

      openPublicProfile(
        mapExploreAuthorToSearchUser(
          post.author,
          post.viewerState,
          viewerId,
          viewerAvatarUrl,
          viewerUsername,
        ),
      );
    },
    [openPublicProfile, viewerAvatarUrl, viewerId, viewerUsername],
  );

  const handleReaction = useCallback(
    (
      post: ExplorePost,
      kind: ExploreReactionKind,
      options?: ReactionOptions,
    ) => {
      const isToggleable = kind === 'like' || kind === 'bookmark';
      const currentActiveState =
        kind === 'like'
          ? post.viewerState.isLiked
          : kind === 'bookmark'
            ? post.viewerState.isBookmarked
            : false;
      const nextActiveState =
        kind === 'share'
          ? true
          : options?.forceActive
            ? true
            : !currentActiveState;

      if (isToggleable && nextActiveState === currentActiveState) {
        return false;
      }

      const reactionFlightKey = `${post.id}:${kind}`;
      if (
        isToggleable &&
        pendingReactionKeysRef.current.has(reactionFlightKey)
      ) {
        return false;
      }
      if (isToggleable) {
        pendingReactionKeysRef.current.add(reactionFlightKey);
      }

      const reactionCollectionKind =
        kind === 'like' ? 'liked' : kind === 'bookmark' ? 'saved' : null;
      const reactionInput = {
        authorHandle: safeAuthorUsername(post.author),
        caption: post.caption,
        createdAt: post.createdAt,
        mediaUrl: post.mediaUrl,
        postId: post.id,
      };

      applyOptimisticReactionEverywhere(post.id, kind, nextActiveState);

      if (reactionCollectionKind) {
        syncExploreReactionCollection(
          viewerId,
          reactionCollectionKind,
          reactionInput,
          nextActiveState,
        ).catch(() => {
          return;
        });
      }

      sendExploreReaction(post.id, kind)
        .then(response => {
          if (reactionCollectionKind) {
            const activeFromServer =
              kind === 'like'
                ? response.viewerState.isLiked
                : response.viewerState.isBookmarked;
            syncExploreReactionCollection(
              viewerId,
              reactionCollectionKind,
              reactionInput,
              activeFromServer,
            ).catch(() => {
              return;
            });
          }

          syncPostSnapshotEverywhere(
            response.postId,
            response.stats,
            response.viewerState,
          );
        })
        .catch(() => {
          if (reactionCollectionKind) {
            const previousState =
              kind === 'like'
                ? post.viewerState.isLiked
                : post.viewerState.isBookmarked;
            syncExploreReactionCollection(
              viewerId,
              reactionCollectionKind,
              reactionInput,
              previousState,
            ).catch(() => {
              return;
            });
          }

          syncPostSnapshotEverywhere(post.id, post.stats, post.viewerState);
        })
        .finally(() => {
          if (isToggleable) {
            pendingReactionKeysRef.current.delete(reactionFlightKey);
          }
        });

      return true;
    },
    [applyOptimisticReactionEverywhere, syncPostSnapshotEverywhere, viewerId],
  );

  const handleDoubleTapLike = useCallback(
    (post: ExplorePost) => {
      handleReaction(post, 'like', { forceActive: true });
    },
    [handleReaction],
  );

  const handleSharePost = useCallback(
    async (post: ExplorePost) => {
      const normalizedPostId = post.id.trim();
      let hasClickedBefore = false;
      if (normalizedPostId.length > 0) {
        const cachedShareClickState =
          shareClickSeenByPostIdRef.current[normalizedPostId];
        if (typeof cachedShareClickState === 'boolean') {
          hasClickedBefore = cachedShareClickState;
        } else {
          hasClickedBefore = await hasStoredExploreShareClick(
            viewerId,
            normalizedPostId,
          );
          shareClickSeenByPostIdRef.current[normalizedPostId] =
            hasClickedBefore;
        }

        if (!hasClickedBefore) {
          shareClickSeenByPostIdRef.current[normalizedPostId] = true;
          storeExploreShareClick(viewerId, normalizedPostId).catch(() => undefined);
          handleReaction(post, 'share');
        }
      }

      try {
        const shareResult = await Share.share(buildExploreSharePayload(post));
        if (
          shareResult.action === Share.dismissedAction &&
          Platform.OS === 'ios'
        ) {
          return;
        }
      } catch (error) {
        showToast({
          message: resolveExploreCommentError(
            error,
            'Paylasim penceresi su an acilamadi. Tekrar deneyebilirsin.',
          ),
          title: 'Paylasim acilamadi',
          tone: 'warning',
        });
      }
    },
    [handleReaction, showToast, viewerId],
  );

  const closeReportModal = useCallback(() => {
    if (reportSubmitReasonKey) {
      return;
    }
    setIsReportModalVisible(false);
    setSelectedReportPost(null);
    setReportSubmitError(null);
  }, [reportSubmitReasonKey]);

  const submitPostReport = useCallback(
    async (option: PostReportReasonOption) => {
      if (!selectedReportPost || reportSubmitReasonKey) {
        return;
      }

      setReportSubmitReasonKey(option.key);
      setReportSubmitError(null);
      try {
        await reportExplorePost(selectedReportPost.id, option.backendReason);
        setIsReportModalVisible(false);
        setSelectedReportPost(null);
        showToast({
          message: 'Inceleme icin moderasyon sirasina eklendi.',
          title: 'Gonderi bildirildi',
          tone: 'success',
        });
      } catch (error) {
        setReportSubmitError(
          resolveExploreCommentError(
            error,
            'Gonderi simdi bildirilemedi. Birazdan tekrar deneyebilirsin.',
          ),
        );
      } finally {
        setReportSubmitReasonKey(null);
      }
    },
    [reportSubmitReasonKey, selectedReportPost, showToast],
  );

  const handleReportPost = useCallback((post: ExplorePost) => {
    setSelectedReportPost(post);
    setReportSubmitError(null);
    setReportSubmitReasonKey(null);
    setIsReportModalVisible(true);
  }, []);

  function handleSubmitComment() {
    const trimmedComment = newComment.trim();
    if (!selectedPost || trimmedComment.length === 0 || isSubmittingComment) {
      return;
    }

    setIsSubmittingComment(true);
    setCommentsError(null);

    sendExploreComment(selectedPost.id, trimmedComment)
      .then(response => {
        setNewComment('');
        setComments(previousComments => {
          const nextComments = mergeComment(previousComments, response.comment);
          replaceCommentsCache(response.postId, nextComments);
          return nextComments;
        });
        syncPostSnapshotEverywhere(response.postId, response.stats);
      })
      .catch(error => {
        setCommentsError(
          resolveExploreCommentError(error, 'Yorum su an gonderilemedi.'),
        );
      })
      .finally(() => {
        setIsSubmittingComment(false);
      });
  }

  const handleToggleCommentLike = useCallback(
    (comment: ExploreComment) => {
      if (!selectedPost || !comment.id) {
        return;
      }

      const postId = selectedPost.id;
      const commentId = comment.id;
      if (commentLikePendingIds[commentId]) {
        return;
      }

      const previousSnapshot = comment;
      const nextIsLiked = !previousSnapshot.isLiked;
      const nextLikeCount = Math.max(
        0,
        Number(previousSnapshot.likeCount || 0) + (nextIsLiked ? 1 : -1),
      );

      setCommentLikePendingIds(previous => ({
        ...previous,
        [commentId]: true,
      }));
      patchCommentEverywhere(postId, commentId, existing => ({
        ...existing,
        isLiked: nextIsLiked,
        likeCount: nextLikeCount,
      }));

      sendExploreCommentLike(commentId)
        .then(response => {
          patchCommentEverywhere(response.postId || postId, commentId, () => ({
            ...response.comment,
          }));
        })
        .catch(error => {
          patchCommentEverywhere(postId, commentId, () => ({
            ...previousSnapshot,
          }));
          setCommentsError(
            resolveExploreCommentError(
              error,
              'Yorum begenisi su an guncellenemedi.',
            ),
          );
        })
        .finally(() => {
          setCommentLikePendingIds(previous => {
            if (!previous[commentId]) {
              return previous;
            }
            const next = { ...previous };
            delete next[commentId];
            return next;
          });
        });
    },
    [commentLikePendingIds, patchCommentEverywhere, selectedPost],
  );

  function openPostDirectViewer(
    postId: string,
    options?: {
      seedPost?: ExplorePost;
    },
  ) {
    const normalizedPostId = postId.trim();
    if (!normalizedPostId) {
      return;
    }

    if (options?.seedPost) {
      seedExploreFeedPost(options.seedPost);
    }
    profilePrefillLockRef.current = false;

    handleSearchClose();
    pendingPrefillPostIdRef.current = normalizedPostId;
    pendingPrefillLoadAttemptsRef.current = 0;
    setActiveTab(SEGMENT_EXPLORE);

    if (options?.seedPost) {
      requestAnimationFrame(() => {
        scrollToFeedPostIndex(0);
      });
    }
  }

  const handleLoadMoreSearchPosts = useCallback(() => {
    if (
      !isSearchOpen ||
      searchTab !== 'posts' ||
      isSearchingPosts ||
      isFetchingMoreSearchPosts ||
      !searchPostsHasMore ||
      !searchPostsNextCursor
    ) {
      return;
    }

    const requestId = searchPostsLoadMoreRequestIdRef.current + 1;
    searchPostsLoadMoreRequestIdRef.current = requestId;
    const trimmed = searchQuery.trim();

    setIsFetchingMoreSearchPosts(true);
    setSearchPostsError(null);

    searchExplorePosts(trimmed, {
      cursor: searchPostsNextCursor,
      limit: 24,
      mediaType: searchPostsMediaType,
      sort: searchPostsSort,
    })
      .then(response => {
        if (searchPostsLoadMoreRequestIdRef.current !== requestId) {
          return;
        }
        setSearchPosts(previous => mergeFeedPosts(previous, response.posts));
        setSearchPostsHasMore(response.hasMore === true);
        setSearchPostsNextCursor(response.nextCursor ?? null);
      })
      .catch(error => {
        if (searchPostsLoadMoreRequestIdRef.current !== requestId) {
          return;
        }
        setSearchPostsError(
          error instanceof Error ? error.message : 'Gonderiler yuklenemedi.',
        );
      })
      .finally(() => {
        if (searchPostsLoadMoreRequestIdRef.current === requestId) {
          setIsFetchingMoreSearchPosts(false);
        }
      });
  }, [
    isFetchingMoreSearchPosts,
    isSearchOpen,
    isSearchingPosts,
    mergeFeedPosts,
    searchPostsHasMore,
    searchPostsMediaType,
    searchPostsNextCursor,
    searchPostsSort,
    searchQuery,
    searchTab,
  ]);

  const trimmedSearchQuery = searchQuery.trim();
  const filteredRecentUsers = useMemo(
    () => filterHiddenExploreUsers(cleanSearchUserList(recentUsers)),
    [filterHiddenExploreUsers, recentUsers],
  );
  const filteredSearchUsers = useMemo(
    () => filterHiddenExploreUsers(cleanSearchUserList(searchUsers)),
    [filterHiddenExploreUsers, searchUsers],
  );
  const isShowingRecentUsers =
    trimmedSearchQuery.length === 0 && filteredRecentUsers.length > 0;
  const isShowingSuggestedUsers =
    trimmedSearchQuery.length === 0 &&
    !isShowingRecentUsers &&
    filteredSearchUsers.length > 0;
  const suggestedUsers = useMemo(
    () =>
      applySuggestedUserQualityRules(rankSearchUsersForDisplay(filteredSearchUsers, '')),
    [filteredSearchUsers],
  );
  const displayedSearchUsers =
    trimmedSearchQuery.length > 0
      ? rankSearchUsersForDisplay(filteredSearchUsers, trimmedSearchQuery)
      : isShowingRecentUsers
        ? filteredRecentUsers
        : suggestedUsers;
  const sectionedSearchUserItems = useMemo<SearchUserListItem[]>(() => {
    if (isShowingRecentUsers || displayedSearchUsers.length === 0) {
      return displayedSearchUsers.map(user => ({ type: 'user', user }));
    }

    if (isShowingSuggestedUsers) {
      return displayedSearchUsers.map(user => ({ type: 'user', user }));
    }

    const following = displayedSearchUsers.filter(user => user.viewerState.isFollowing);
    const others = displayedSearchUsers.filter(user => !user.viewerState.isFollowing);

    const items: SearchUserListItem[] = [];
    const pushSection = (title: string, users: ExploreSearchUser[]) => {
      if (users.length === 0) {
        return;
      }
      items.push({
        id: `section_${title.toLowerCase().replace(/\s+/g, '_')}`,
        title,
        type: 'section',
      });
      users.forEach(user => {
        items.push({ type: 'user', user });
      });
    };

    pushSection(translateText('Takip Ettiklerin'), following);
    pushSection(translateText('Diğerleri'), others);
    return items;
  }, [
    displayedSearchUsers,
    i18nTick,
    isShowingRecentUsers,
    isShowingSuggestedUsers,
  ]);
  const visibleSearchUserItems = useMemo<SearchUserListItem[]>(
    () =>
      isShowingSuggestedUsers
        ? sectionedSearchUserItems.slice(0, suggestedUsersVisibleCount)
        : sectionedSearchUserItems,
    [isShowingSuggestedUsers, sectionedSearchUserItems, suggestedUsersVisibleCount],
  );
  const hasMoreSuggestedUsers =
    isShowingSuggestedUsers &&
    sectionedSearchUserItems.length > suggestedUsersVisibleCount;
  const handleLoadMoreSuggestedUsers = useCallback(() => {
    if (!hasMoreSuggestedUsers) {
      return;
    }
    setSuggestedUsersVisibleCount(previous =>
      Math.min(previous + SUGGESTED_USERS_PAGE_SIZE, sectionedSearchUserItems.length),
    );
  }, [hasMoreSuggestedUsers, sectionedSearchUserItems.length]);
  useEffect(() => {
    setSuggestedUsersVisibleCount(SUGGESTED_USERS_PAGE_SIZE);
  }, [searchTab, trimmedSearchQuery, isShowingRecentUsers]);
  const searchUsersSectionTitle =
    trimmedSearchQuery.length > 0
      ? translateText('Kullanıcı Sonuçları')
      : isShowingRecentUsers
        ? translateText('Son Aramalar')
        : isShowingSuggestedUsers
          ? translateText('Önerilen Hesaplar')
          : translateText('Kullanıcı Ara');
  const activeRecentSearchTab = isRecentSearchTab(searchTab) ? searchTab : null;
  const activeRecentSearchTerms = activeRecentSearchTab
    ? recentSearchTermsByTab[activeRecentSearchTab]
    : [];
  const activePopularSearchTerms = activeRecentSearchTab
    ? popularSearchTermsByTab[activeRecentSearchTab]
    : [];
  const isShowingRecentSearchTerms =
    trimmedSearchQuery.length === 0 && activeRecentSearchTerms.length > 0;
  const isShowingPopularSearchTerms = activePopularSearchTerms.length > 0;
  const displayedSearchPosts = useMemo(() => {
    return searchPosts.filter(
      post =>
        !hiddenExploreUserIds[safeAuthorId(post.author)] &&
        !isHiddenExploreUsername(safeAuthorUsername(post.author)),
    );
  }, [hiddenExploreUserIds, isHiddenExploreUsername, searchPosts]);
  const searchTagCandidate =
    (searchTab === 'posts' || searchTab === 'tags') &&
      trimmedSearchQuery.startsWith('#')
      ? normalizeTrendingTagKey(trimmedSearchQuery)
      : '';
  const displayedSearchTags = useMemo(() => {
    const normalizedQuery = normalizeTrendingTagKey(trimmedSearchQuery);
    if (!normalizedQuery) {
      return trendingTags;
    }
    return trendingTags.filter(item =>
      normalizeTrendingTagKey(item.tag).includes(normalizedQuery),
    );
  }, [trendingTags, trimmedSearchQuery]);
  const displayedSearchPlaces = useMemo<SearchPlaceItem[]>(() => {
    const query = trimmedSearchQuery
      .trim()
      .replace(/^#+/, '')
      .toLocaleLowerCase('tr-TR');
    const bucket = new Map<
      string,
      {
        hasVideo: boolean;
        latestTimestamp: number;
        postCount: number;
        previewPost: ExplorePost;
      }
    >();

    displayedSearchPosts.forEach(post => {
      const normalizedLocation = post.location.trim();
      if (!normalizedLocation) {
        return;
      }
      const createdAtValue = Date.parse(post.createdAt);
      const createdAtTimestamp = Number.isFinite(createdAtValue)
        ? createdAtValue
        : 0;
      const existing = bucket.get(normalizedLocation);
      if (!existing) {
        bucket.set(normalizedLocation, {
          hasVideo: post.mediaType === 'video',
          latestTimestamp: createdAtTimestamp,
          postCount: 1,
          previewPost: post,
        });
        return;
      }

      const shouldPromotePreview = createdAtTimestamp > existing.latestTimestamp;
      bucket.set(normalizedLocation, {
        hasVideo: existing.hasVideo || post.mediaType === 'video',
        latestTimestamp: Math.max(existing.latestTimestamp, createdAtTimestamp),
        postCount: existing.postCount + 1,
        previewPost: shouldPromotePreview ? post : existing.previewPost,
      });
    });

    return Array.from(bucket.entries())
      .filter(([location]) =>
        query.length === 0
          ? true
          : location.toLocaleLowerCase('tr-TR').includes(query),
      )
      .sort((a, b) => {
        if (b[1].postCount !== a[1].postCount) {
          return b[1].postCount - a[1].postCount;
        }
        if (b[1].latestTimestamp !== a[1].latestTimestamp) {
          return b[1].latestTimestamp - a[1].latestTimestamp;
        }
        return a[0].localeCompare(b[0], 'tr-TR');
      })
      .slice(0, 24)
      .map(([location, payload]) => ({
        hasVideo: payload.hasVideo,
        location,
        postCount: payload.postCount,
        previewPost: payload.previewPost,
      }));
  }, [displayedSearchPosts, trimmedSearchQuery]);
  const trendingTagPreview = useMemo(() => trendingTags.slice(0, 6), [trendingTags]);
  const searchInputPlaceholder =
    searchTab === 'users'
      ? translateText('Kullanıcı ara...')
      : translateText('Gönderi ara...');
  const searchLocationPreview = useMemo(
    () => displayedSearchPlaces.slice(0, 6),
    [displayedSearchPlaces],
  );
  function openSearchPlaceViewer(item: SearchPlaceItem) {
    saveRecentSearchTerm('places', item.location);
    openPostDirectViewer(item.previewPost.id, {
      seedPost: item.previewPost,
    });
  }
  const selectedSearchRelationship = selectedSearchUser
    ? relationshipForUser(selectedSearchUser)
    : null;
  const selectedProfileUnavailable =
    selectedSearchUser != null && isSelectedProfileUnavailable;
  const selectedIsPrivateAccount =
    selectedPublicProfile?.isPrivateAccount ??
    selectedSearchUser?.isPrivateAccount ??
    false;
  const selectedIdentity = resolveUserIdentity({
    avatarUrl:
      selectedPublicProfile?.avatarUrl ??
      selectedSearchUser?.avatarUrl ??
      '',
    fullName:
      selectedPublicProfile?.fullName ??
      selectedSearchUser?.fullName ??
      '',
    isHidden:
      selectedProfileUnavailable ||
      Boolean(selectedSearchUser?.isHiddenByRelationship),
    username:
      selectedPublicProfile?.username ??
      selectedSearchUser?.username ??
      '',
  });
  const selectedDisplayName = selectedIdentity.displayName;
  const selectedHasBlockedRelationship =
    (selectedPublicProfile?.viewerState.isBlockedByTarget ?? false) ||
    (selectedPublicProfile?.viewerState.isBlockedByViewer ?? false);
  const selectedStats = selectedPublicProfile?.stats ?? {
    followersCount: 0,
    followingCount: 0,
    routesCount: 0,
    streetFriendsCount: 0,
  };
  const selectedProfileStatItems = useMemo(
    () => [
      {
        label: translateText('GÖNDERİLER'),
        value: selectedHasBlockedRelationship
          ? '--'
          : formatCount(selectedStats.routesCount),
      },
      {
        label: translateText('TAKİPÇİ'),
        value: selectedHasBlockedRelationship
          ? '--'
          : formatCount(selectedStats.followersCount),
      },
      {
        label: translateText('TAKİP'),
        value: selectedHasBlockedRelationship
          ? '--'
          : formatCount(selectedStats.followingCount),
      },
      {
        label: translateText('YAKINDAKİLER'),
        value: selectedHasBlockedRelationship
          ? '--'
          : formatCount(selectedStats.streetFriendsCount),
      },
    ],
    [
      i18nTick,
      selectedHasBlockedRelationship,
      selectedStats.followersCount,
      selectedStats.followingCount,
      selectedStats.routesCount,
      selectedStats.streetFriendsCount,
    ],
  );
  const selectedBlockedByTarget =
    selectedPublicProfile?.viewerState.isBlockedByTarget ?? false;
  const selectedIsBlockedByViewer =
    selectedPublicProfile?.viewerState.isBlockedByViewer ?? false;
  const selectedUserPending =
    selectedSearchUser != null &&
    searchActionPendingUserId === selectedSearchUser.id;
  const selectedFollowRequestStatus: FollowRequestStatus =
    selectedSearchRelationship?.followRequestStatus ??
    selectedPublicProfile?.viewerState.followRequestStatus ??
    'none';
  const selectedFollowRequestPending =
    selectedFollowRequestStatus === 'pending_outgoing';
  const selectedFollowRequestIncoming =
    selectedFollowRequestStatus === 'pending_incoming';
  const selectedStreetFriendStatus: StreetFriendStatus =
    selectedSearchRelationship?.streetFriendStatus ??
    selectedPublicProfile?.viewerState.streetFriendStatus ??
    'none';
  const selectedIsStreetFriend =
    selectedSearchRelationship?.isStreetFriend ??
    selectedPublicProfile?.viewerState.isStreetFriend ??
    selectedStreetFriendStatus === 'accepted';
  const selectedStreetFriendPending =
    selectedStreetFriendStatus === 'pending_outgoing';
  const selectedStreetFriendIncoming =
    selectedStreetFriendStatus === 'pending_incoming';
  const selectedUsernameLabel = selectedIdentity.handleLabel;
  const selectedCanViewPosts =
    !selectedIsPrivateAccount ||
    Boolean(
      selectedPublicProfile?.viewerState.isFollowing ??
      selectedSearchRelationship?.isFollowing,
    );
  const selectedFollowButtonLabel = selectedSearchUser
    ? selectedSearchRelationship?.isFollowing
      ? translateText('Takiptesin')
      : selectedFollowRequestPending
        ? translateText('Istek Gonderildi')
        : translateText('Takip Et')
    : translateText('Takip Et');
  const selectedProfileContentContainerStyle = {
    paddingBottom: Math.max(resolvedSafeBottom, 20) + 28,
    paddingHorizontal: 12,
  };
  const selectedDisplayNameStyle = {
    fontSize:
      selectedDisplayName.length > 18
        ? 26
        : selectedDisplayName.length > 12
          ? 30
          : 34,
    lineHeight:
      selectedDisplayName.length > 18
        ? 32
        : selectedDisplayName.length > 12
          ? 36
          : 40,
  };
  const profileActionsSheetBottomInset = Math.max(
    resolvedSafeBottom,
    12,
  );
  const canShowStreetFriendProfileAction =
    Boolean(selectedSearchUser) && !selectedBlockedByTarget;
  const selectedStreetActionLabel = streetFriendActionLabel(
    selectedStreetFriendStatus,
  );
  const selectedStreetActionHint =
    selectedStreetFriendStatus === 'pending_outgoing'
      ? translateText(
          'Beklemede. Istersen Geri Cek ile istegi iptal edebilirsin.',
        )
      : selectedStreetFriendStatus === 'pending_incoming'
        ? translateText(
            'Bu kullanici sana Yakındakiler istegi gonderdi. Dokunarak kabul edebilirsin.',
          )
        : selectedStreetFriendStatus === 'accepted'
          ? translateText(
              'Artik yakindakilersiniz. Bu butona dokunarak Yakındakilerden cikabilirsin.',
            )
          : translateText(
              'Yakindakiler istegi gonderilir; kabul edilince otomatik yakindakiler olursunuz.',
            );
  const activeTrendingTagPosts = useMemo(
    () =>
      trendingTagDetailTab === 'top'
        ? trendingTagDetail?.topPosts ?? []
        : trendingTagDetail?.recentPosts ?? [],
    [trendingTagDetail, trendingTagDetailTab],
  );
  const openTrendingTagFeed = useCallback(
    (initialIndex: number) => {
      const normalizedTag = activeTrendingTagKey?.trim() ?? '';
      if (!normalizedTag || activeTrendingTagPosts.length === 0) {
        return;
      }

      setOverlayRoutes(previous => [
        ...previous,
        {
          id: buildOverlayRouteId('trend-tag-feed'),
          initialIndex,
          kind: 'trend-tag-feed',
          sourceTab: trendingTagDetailTab,
          tag: normalizedTag,
        },
      ]);
    },
    [
      activeTrendingTagKey,
      activeTrendingTagPosts.length,
      buildOverlayRouteId,
      trendingTagDetailTab,
    ],
  );
  const activeOverlayRoute =
    overlayRoutes.length > 0 ? overlayRoutes[overlayRoutes.length - 1] : null;
  const activeTrendFeedRoute =
    activeOverlayRoute?.kind === 'trend-tag-feed' ? activeOverlayRoute : null;
  const activeTrendFeedPosts = useMemo(
    () =>
      activeTrendFeedRoute?.sourceTab === 'recent'
        ? trendingTagDetail?.recentPosts ?? []
        : trendingTagDetail?.topPosts ?? [],
    [activeTrendFeedRoute, trendingTagDetail],
  );
  const mapPublicProfilePostToExplorePost = useCallback(
    (post: PublicProfilePostItem): ExplorePost => {
      const authorId =
        selectedPublicProfile?.id?.trim() ||
        selectedSearchUser?.id?.trim() ||
        `profile-${post.username}`;
      const authorUsername =
        post.username.trim() ||
        selectedPublicProfile?.username?.trim() ||
        selectedSearchUser?.username?.trim() ||
        'kullanici';
      const authorAvatarUrl =
        selectedPublicProfile?.avatarUrl ||
        selectedSearchUser?.avatarUrl ||
        FALLBACK_AVATAR;
      const authorIsVerified = false;
      const followRequestStatus =
        selectedSearchRelationship?.followRequestStatus ??
        selectedPublicProfile?.viewerState.followRequestStatus ??
        'none';
      const isFollowing =
        selectedSearchRelationship?.isFollowing ??
        selectedPublicProfile?.viewerState.isFollowing ??
        false;
      const streetFriendStatus =
        selectedSearchRelationship?.streetFriendStatus ??
        selectedPublicProfile?.viewerState.streetFriendStatus ??
        'none';
      const isStreetFriend =
        selectedSearchRelationship?.isStreetFriend ??
        selectedPublicProfile?.viewerState.isStreetFriend ??
        streetFriendStatus === 'accepted';
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

      return {
        author: {
          avatarUrl: authorAvatarUrl,
          id: authorId,
          isVerified: authorIsVerified,
          username: authorUsername,
        },
        caption: post.caption,
        createdAt: post.createdAt,
        id: post.id,
        location: post.location,
        mediaType: normalizedMediaType,
        mediaUrl: post.mediaUrl,
        rankingScore: popularityScore,
        segment: SEGMENT_EXPLORE,
        stats: post.stats,
        viewerState: {
          followRequestStatus,
          isBookmarked: false,
          isFollowing,
          isLiked: false,
          isStreetFriend,
          streetFriendStatus,
        },
      };
    },
    [selectedPublicProfile, selectedSearchRelationship, selectedSearchUser],
  );
  const commentsSheetStyle = useMemo(() => {
    const maxSheetHeight = WINDOW_HEIGHT * 0.7;
    const minSheetHeight = WINDOW_HEIGHT * 0.24;
    const availableHeight = WINDOW_HEIGHT - Math.max(resolvedSafeTop, 26) - 18;
    return {
      height: Math.max(minSheetHeight, Math.min(maxSheetHeight, availableHeight)),
    };
  }, [resolvedSafeTop]);
  const commentsComposerContainerStyle = useMemo(
    () => ({
      paddingBottom: Math.max(resolvedSafeBottom, 14),
      paddingTop: 8,
    }),
    [resolvedSafeBottom],
  );
  const commentsListContentStyle = useMemo(
    () => ({
      paddingBottom: Math.max(14, Math.max(resolvedSafeBottom, 12) + 48),
      paddingTop: 0,
    }),
    [resolvedSafeBottom],
  );
  const showFeedLoadingOverlay = isLoadingFeed && posts.length === 0;
  const showPublicProfileLoadingOverlay =
    selectedSearchUser != null &&
    ((isLoadingPublicProfile && !selectedPublicProfile) ||
      (isLoadingPublicProfilePosts &&
        publicProfilePosts.length === 0 &&
        publicProfilePostsError == null));
  const showCommentsLoadingOverlay =
    isCommentsVisible && commentsLoading && comments.length === 0;
  const activePostId = posts[activePostIndex]?.id ?? null;
  const renderFeedItem = useCallback(
    ({ item }: { item: ExplorePost }) => (
      <PostItem
        isActive={activePostId === item.id}
        item={item}
        safeBottom={resolvedPostSafeBottom}
        viewerAvatarUrl={viewerAvatarUrl}
        viewerId={viewerId}
        viewerUsername={viewerUsername}
        onDoubleTapLike={handleDoubleTapLike}
        onOpenAuthorProfile={handleOpenProfileFromPost}
        onOpenComments={openComments}
        onReport={handleReportPost}
        onReact={handleReaction}
        onShare={handleSharePost}
        onToggleFollow={handleToggleFollow}
      />
    ),
    [
      activePostId,
      handleDoubleTapLike,
      handleOpenProfileFromPost,
      handleReportPost,
      handleReaction,
      handleSharePost,
      handleToggleFollow,
      openComments,
      resolvedPostSafeBottom,
      viewerAvatarUrl,
      viewerId,
      viewerUsername,
    ],
  );
  const handleFeedRefresh = useCallback(() => {
    handleRefresh();
  }, [handleRefresh]);
  const handleFeedEndReached = useCallback(() => {
    handleLoadMore();
  }, [handleLoadMore]);
  const handleOpenOlderSuggestedFeed = useCallback(() => {
    if (activeTabRef.current === SEGMENT_FOR_YOU) {
      resetFeedViewport();
      return;
    }
    setActiveTab(SEGMENT_FOR_YOU);
  }, [resetFeedViewport]);
  const feedListFooter = useMemo(() => {
    if (
      activeTab !== SEGMENT_FOLLOWING ||
      isLoadingFeed ||
      isRefreshing ||
      hasMore ||
      posts.length === 0
    ) {
      return null;
    }

    return (
      <View style={FOLLOWING_COMPLETE_CARD_STYLE}>
        <View style={FOLLOWING_COMPLETE_ICON_WRAP_STYLE}>
          <FeatherIcon color="#ff5a1f" name="check" size={44} />
        </View>
        <Text style={FOLLOWING_COMPLETE_TITLE_STYLE}>Hepsini GÃƒÂ¶rdÃƒÂ¼n</Text>
        <Text style={FOLLOWING_COMPLETE_DESCRIPTION_STYLE}>
          Takip ettiÃ„Å¸in hesaplardaki yeni gÃƒÂ¶nderileri bitirdin. Ã„Â°stersen Ã…Å¸imdi
          sana ÃƒÂ¶nerilen daha eski gÃƒÂ¶nderilere geÃƒÂ§ebilirsin.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={handleOpenOlderSuggestedFeed}
          style={FOLLOWING_COMPLETE_BUTTON_STYLE}
        >
          <Text style={FOLLOWING_COMPLETE_BUTTON_TEXT_STYLE}>
            Daha Eski Gonderileri GÃƒÂ¶r
          </Text>
        </Pressable>
      </View>
    );
  }, [
    activeTab,
    handleOpenOlderSuggestedFeed,
    hasMore,
    isLoadingFeed,
    isRefreshing,
    posts.length,
  ]);

  const handleExploreTabPress = useCallback(
    (segment: ExploreSegment) => {
      if (segment === activeTabRef.current) {
        resetFeedViewport();
        return;
      }
      setActiveTab(segment);
    },
    [resetFeedViewport],
  );

  const renderSearchUserCard = useCallback(
    (
      item: ExploreSearchUser,
      options?: {
        isSearchingHistory?: boolean;
      },
    ) => (
      <SearchUserCard
        isActionPending={searchActionPendingUserId === item.id}
        isSearchingHistory={options?.isSearchingHistory ?? false}
        isSuggested={isShowingSuggestedUsers}
        onDismissUser={rememberHiddenExploreUser}
        onFollowUser={handleSearchFollow}
        onOpenProfile={openPublicProfile}
        onRemoveRecentUser={handleRemoveRecentUser}
        relationship={relationshipForUser(item)}
        user={item}
      />
    ),
    [
      handleRemoveRecentUser,
      handleSearchFollow,
      isShowingSuggestedUsers,
      openPublicProfile,
      relationshipForUser,
      rememberHiddenExploreUser,
      searchActionPendingUserId,
    ],
  );

  const renderSearchUserResult = useCallback(
    ({ item }: { item: SearchUserListItem }) => {
      if (item.type === 'section') {
        return <SearchUserSectionHeader title={item.title} />;
      }
      return renderSearchUserCard(item.user, {
        isSearchingHistory: isShowingRecentUsers,
      });
    },
    [isShowingRecentUsers, renderSearchUserCard],
  );

  const searchUsersListHeader = useMemo(
    () => (
      <View className="bg-white px-4 pb-3 pt-5">
        <View className="flex-row items-center justify-between">
          <Text className="text-[17px] font-semibold tracking-[-0.25px] text-[#111827]">
            {searchUsersSectionTitle}
          </Text>
          {isShowingRecentUsers ? (
            <Pressable className="active:opacity-70" onPress={handleClearRecentUsers}>
              <Text className="text-[13px] font-semibold text-[#ef4444]">
                {translateText('Tümünü Temizle')}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {searchError ? (
          <View className="mt-3 rounded-[14px] border border-rose-200 bg-rose-50 px-3 py-2.5">
            <Text className="text-[12px] text-rose-500">{searchError}</Text>
          </View>
        ) : null}
      </View>
    ),
    [
      handleClearRecentUsers,
      i18nTick,
      isShowingRecentUsers,
      searchError,
      searchUsersSectionTitle,
    ],
  );

  const searchUsersListEmptyState = useMemo(() => {
    if (isSearchingUsers) {
      return (
        <SearchUserSkeletonList />
      );
    }

    return (
      <View className="items-center justify-center px-8 py-16">
        <Text className="text-center text-[14px] text-[#8f94a1]">
          {trimmedSearchQuery.length > 0
            ? translateText('Aramaya uygun kullanıcı bulunamadı.')
            : isShowingRecentUsers
              ? translateText('Henüz bir arama geçmişin yok.')
              : translateText('Su anda oneri yok')}
        </Text>
      </View>
    );
  }, [i18nTick, isSearchingUsers, isShowingRecentUsers, trimmedSearchQuery.length]);

  const searchModalHeaderStyle = useMemo(
    () => [
      SEARCH_MODAL_HEADER_CHROME_STYLE,
      {
        paddingTop:
          Platform.OS === 'android'
            ? Math.max(StatusBar.currentHeight ?? 0, resolvedSafeTop, 10) + 8
            : Math.max(resolvedSafeTop, 12),
      },
    ],
    [resolvedSafeTop],
  );
  const searchPanelAnimatedStyle = useMemo(
    () => ({
      opacity: searchPanelOpacity,
      transform: [{ translateX: searchPanelTranslateX }],
    }),
    [searchPanelOpacity, searchPanelTranslateX],
  );

  const searchUsersListFooter = null;

  const handleExploreBack = useCallback(() => {
    profilePrefillLockRef.current = false;
    setIsProfileBackOnlyHeader(false);
    onBack?.();
  }, [onBack]);

  const searchUsersListContentStyle = useMemo(
    () => ({
      paddingBottom: Math.max(resolvedSafeBottom, 24) + 78,
      paddingHorizontal: 0,
      paddingTop: 0,
    }),
    [resolvedSafeBottom],
  );
  const reportModalSheetStyle = useMemo(
    () => [
      REPORT_MODAL_SHEET_BASE_STYLE,
      {
        paddingBottom: Math.max(resolvedSafeBottom, 14) + 8,
      },
    ],
    [resolvedSafeBottom],
  );
  return (
    <SafeAreaView edges={['left', 'right']} style={EXPLORE_ROOT_STYLE}>
      {!isSearchOpen && !selectedSearchUser ? (
        <>
          <StatusBar
            barStyle="dark-content"
            backgroundColor="#ffffff"
            translucent={false}
          />

          <View className="flex-1">
            <FlashList
              ref={feedListRef}
              data={posts}
              drawDistance={WINDOW_HEIGHT * 2.5}
              keyExtractor={item => item.id}
              keyboardDismissMode="on-drag"
              removeClippedSubviews={Platform.OS === 'android'}
              renderItem={renderFeedItem}
              pagingEnabled={true}
              showsVerticalScrollIndicator={false}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
              snapToAlignment="start"
              decelerationRate="fast"
              snapToInterval={WINDOW_HEIGHT}
              disableIntervalMomentum={true}
              refreshing={isRefreshing}
              onRefresh={handleFeedRefresh}
              onEndReachedThreshold={0.55}
              onEndReached={handleFeedEndReached}
              ListFooterComponent={feedListFooter}
              ListEmptyComponent={
                !isLoadingFeed ? (
                  <ScreenStateCenter
                    minHeight={WINDOW_HEIGHT}
                    paddingHorizontal={32}
                  >
                    <ScreenStateCard
                      description={emptyFeedState.description}
                      iconName="compass"
                      mode="dark"
                      title={emptyFeedState.title}
                    />
                  </ScreenStateCenter>
                ) : null
              }
            />
          </View>

          <ExploreHeader
            activeTab={activeTab}
            compactMode={isProfileBackOnlyHeader}
            onBack={handleExploreBack}
            onSearchPress={() => {
              setIsSearchOpen(true);
            }}
            onTabPress={handleExploreTabPress}
            safeTop={resolvedSafeTop}
            tabs={TABS}
          />

          {SHOW_RUNTIME_RIBBON ? (
            <View
              className="absolute left-4 right-4 z-30 rounded-[10px] border border-white/10 bg-black/45 px-3 py-2"
              style={{ top: Math.max(resolvedSafeTop, 12) + 48 }}
            >
              <Text className="text-[11px] text-slate-200">
                Socket: {socketStatus} | Sync:{' '}
                {formatBackendSyncTime(lastFeedGeneratedAt)} | Rank:{' '}
                {rankVersion ?? '-'}
              </Text>
            </View>
          ) : null}

          {feedError ? (
            <ScreenStateCard
              compact={true}
              description={feedError}
              mode="dark"
              style={[
                FEED_ERROR_OVERLAY_CARD_STYLE,
                {
                  top: Math.max(resolvedSafeTop, 12) + 84,
                },
              ]}
              title="Feed alinamadi"
              tone="error"
            />
          ) : null}

          {showFeedLoadingOverlay ? <LoadingOverlay tone="dark" /> : null}
        </>
      ) : null}

      {isSearchOpen && !selectedSearchUser ? (
        <>
          <StatusBar
            animated={true}
            backgroundColor="#ffffff"
            barStyle="dark-content"
            translucent={false}
          />
          <View className="flex-1 bg-white">
            <View
              className="border-b border-[#eceff4] bg-white px-5 pb-3"
              style={searchModalHeaderStyle}
            >
              <View className="flex-row items-center">
                <Pressable
                  className="mr-2 h-[40px] w-[40px] items-center justify-center rounded-full active:bg-[#f5f7fa]"
                  onPress={handleSearchClose}
                >
                  <FeatherIcon color="#111827" name="arrow-left" size={20} />
                </Pressable>

                <View className="h-[52px] flex-1 flex-row items-center rounded-[18px] bg-[#f3f4f7] px-4">
                  <FeatherIcon color="#98a2b3" name="search" size={18} />
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus={true}
                    className="ml-2.5 flex-1 py-0 text-[15px] text-[#111827]"
                    onChangeText={setSearchQuery}
                    onSubmitEditing={handleSearchInputSubmit}
                    placeholder={searchInputPlaceholder}
                    placeholderTextColor="#98a2b3"
                    returnKeyType="search"
                    value={searchQuery}
                  />
                </View>
              </View>

              <View className="mt-[16px] flex-row rounded-[23px] bg-[#f3f4f7] p-[4px]">
                <Pressable
                  className={`flex-1 items-center rounded-[16px] py-[10px] ${searchTab === 'users' ? 'bg-[#111827]' : 'bg-transparent'
                    }`}
                  onPress={() => handleSearchTabChange('users')}
                >
                  <Text
                    className={`text-[12.5px] ${searchTab === 'users'
                      ? 'font-semibold text-white'
                      : 'font-medium text-[#6b7280]'
                      }`}
                  >
                    Kullanıcılar
                  </Text>
                </Pressable>

                <Pressable
                  className={`flex-1 items-center rounded-[16px] py-[10px] ${searchTab === 'posts' ? 'bg-[#111827]' : 'bg-transparent'
                    }`}
                  onPress={() => handleSearchTabChange('posts')}
                >
                  <Text
                    className={`text-[12.5px] ${searchTab === 'posts'
                      ? 'font-semibold text-white'
                      : 'font-medium text-[#6b7280]'
                      }`}
                  >
                    Gönderiler
                  </Text>
                </Pressable>

                <Pressable
                  className={`flex-1 items-center rounded-[16px] py-[10px] ${searchTab === 'tags' ? 'bg-[#111827]' : 'bg-transparent'
                    }`}
                  onPress={() => handleSearchTabChange('tags')}
                >
                  <Text
                    className={`text-[12.5px] ${searchTab === 'tags'
                      ? 'font-semibold text-white'
                      : 'font-medium text-[#6b7280]'
                      }`}
                  >
                    Etiketler
                  </Text>
                </Pressable>

                <Pressable
                  className={`flex-1 items-center rounded-[16px] py-[10px] ${searchTab === 'places' ? 'bg-[#111827]' : 'bg-transparent'
                    }`}
                  onPress={() => handleSearchTabChange('places')}
                >
                  <Text
                    className={`text-[12.5px] ${searchTab === 'places'
                      ? 'font-semibold text-white'
                      : 'font-medium text-[#6b7280]'
                      }`}
                  >
                    Yerler
                  </Text>
                </Pressable>
              </View>
            </View>

            <RNAnimated.View
              style={[SEARCH_PANEL_ANIMATED_CONTAINER_STYLE, searchPanelAnimatedStyle]}
            >
              {searchTab === 'users' ? (
                <FlashList
                  className="flex-1 bg-white"
                  contentContainerStyle={searchUsersListContentStyle}
                  data={visibleSearchUserItems}
                  key={
                    isShowingRecentUsers
                      ? 'search-users-recent'
                      : trimmedSearchQuery.length > 0
                        ? 'search-users-query'
                        : 'search-users-suggested'
                  }
                  extraData={{
                    isShowingRecentUsers,
                    relationshipByUserId,
                    searchActionPendingUserId,
                    streetFriendIds,
                    suggestedUsersVisibleCount,
                    trimmedSearchQueryLength: trimmedSearchQuery.length,
                  }}
                  keyboardDismissMode="on-drag"
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  ItemSeparatorComponent={
                    isShowingRecentUsers
                      ? SearchUserHistorySeparator
                      : SearchUserListSeparator
                  }
                  keyExtractor={item =>
                    item.type === 'section' ? item.id : item.user.id
                  }
                  ListFooterComponent={searchUsersListFooter}
                  ListEmptyComponent={searchUsersListEmptyState}
                  ListHeaderComponent={searchUsersListHeader}
                  onEndReached={
                    isShowingSuggestedUsers ? handleLoadMoreSuggestedUsers : undefined
                  }
                  onEndReachedThreshold={0.45}
                  renderItem={renderSearchUserResult}
                />
              ) : (
                <ScrollView
                  className="flex-1 bg-white"
                  contentContainerStyle={{
                    paddingBottom: Math.max(resolvedSafeBottom, 24) + 78,
                  }}
                  keyboardDismissMode="on-drag"
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <View className="bg-white px-4 pb-2 pt-2">

                    {activeRecentSearchTab && isShowingRecentSearchTerms ? (
                      <View className="pb-3">
                        <View className="flex-row items-center justify-between px-[2px] pb-2">
                          <Text className="text-[13px] font-semibold text-[#111827]">
                            Son Aramalar
                          </Text>
                          <Pressable
                            onPress={() => {
                              handleClearRecentSearchTerms(activeRecentSearchTab);
                            }}
                          >
                            <Text className="text-[12px] font-semibold text-[#ff4d67]">
                              Tumunu Temizle
                            </Text>
                          </Pressable>
                        </View>
                        <View className="overflow-hidden rounded-[18px] border border-[#edf1f5] bg-white">
                          {activeRecentSearchTerms.map((item, index) => (
                            <View
                              className={`flex-row items-center px-4 py-3 ${index === activeRecentSearchTerms.length - 1
                                ? ''
                                : 'border-b border-[#edf1f5]'
                                }`}
                              key={`${activeRecentSearchTab}_${item.query}`}
                            >
                              <Pressable
                                className="mr-3 flex-1 flex-row items-center"
                                onPress={() => {
                                  setSearchQuery(item.query);
                                }}
                              >
                                <View className="h-[34px] w-[34px] items-center justify-center rounded-[12px] bg-[#f3f5f8]">
                                  <FeatherIcon
                                    color="#667085"
                                    name={
                                      activeRecentSearchTab === 'tags'
                                        ? 'hash'
                                        : activeRecentSearchTab === 'places'
                                          ? 'map-pin'
                                          : 'search'
                                    }
                                    size={14}
                                  />
                                </View>
                                <Text
                                  className="ml-3 flex-1 text-[13px] font-medium text-[#111827]"
                                  numberOfLines={1}
                                >
                                  {item.query}
                                </Text>
                              </Pressable>
                              <Pressable
                                className="h-[28px] w-[28px] items-center justify-center rounded-full"
                                onPress={() => {
                                  handleRemoveRecentSearchTerm(
                                    activeRecentSearchTab,
                                    item.query,
                                  );
                                }}
                              >
                                <FeatherIcon color="#98a2b3" name="x" size={15} />
                              </Pressable>
                            </View>
                          ))}
                        </View>
                      </View>
                    ) : null}

                    {activeRecentSearchTab && isShowingPopularSearchTerms ? (
                      <View className="pb-3">
                        <View className="flex-row items-center justify-between px-[2px] pb-2">
                          <Text className="text-[13px] font-semibold text-[#111827]">
                            One Cikanlar
                          </Text>
                          <View className="rounded-full bg-[#f3f5f8] px-2.5 py-1">
                            <Text className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[#667085]">
                              Trend
                            </Text>
                          </View>
                        </View>
                        <View className="overflow-hidden rounded-[18px] border border-[#edf1f5] bg-white">
                          {activePopularSearchTerms.map((item, index) => (
                            <Pressable
                              className={`flex-row items-center px-4 py-3 ${index === activePopularSearchTerms.length - 1
                                ? ''
                                : 'border-b border-[#edf1f5]'
                                }`}
                              key={`popular_${activeRecentSearchTab}_${item.query}`}
                              onPress={() => {
                                setSearchQuery(item.query);
                                saveRecentSearchTerm(activeRecentSearchTab, item.query);
                              }}
                            >
                              <View className="h-[34px] w-[34px] items-center justify-center rounded-[12px] bg-[#f3f5f8]">
                                <FeatherIcon color="#667085" name="trending-up" size={14} />
                              </View>
                              <Text
                                className="ml-3 flex-1 text-[13px] font-medium text-[#111827]"
                                numberOfLines={1}
                              >
                                {item.query}
                              </Text>
                              <FeatherIcon color="#98a2b3" name="chevron-right" size={16} />
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    ) : null}

                    {searchTab === 'posts' ? (
                      <View className="pb-3">
                        <View className="rounded-[16px] bg-[#f3f5f8] p-[3px]">
                          <View className="flex-row">
                            <Pressable
                              className={`flex-1 items-center rounded-[12px] py-[7px] ${searchPostsMediaType === 'all' ? 'bg-white' : 'bg-transparent'
                                }`}
                              onPress={() => {
                                setSearchPostsMediaType('all');
                              }}
                            >
                              <Text
                                className={`text-[11px] ${searchPostsMediaType === 'all'
                                  ? 'font-semibold text-[#111827]'
                                  : 'font-medium text-[#667085]'
                                  }`}
                              >
                                Tumu
                              </Text>
                            </Pressable>
                            <Pressable
                              className={`flex-1 items-center rounded-[12px] py-[7px] ${searchPostsMediaType === 'photo' ? 'bg-white' : 'bg-transparent'
                                }`}
                              onPress={() => {
                                setSearchPostsMediaType('photo');
                              }}
                            >
                              <Text
                                className={`text-[11px] ${searchPostsMediaType === 'photo'
                                  ? 'font-semibold text-[#111827]'
                                  : 'font-medium text-[#667085]'
                                  }`}
                              >
                                Fotograf
                              </Text>
                            </Pressable>
                            <Pressable
                              className={`flex-1 items-center rounded-[12px] py-[7px] ${searchPostsMediaType === 'video' ? 'bg-white' : 'bg-transparent'
                                }`}
                              onPress={() => {
                                setSearchPostsMediaType('video');
                              }}
                            >
                              <Text
                                className={`text-[11px] ${searchPostsMediaType === 'video'
                                  ? 'font-semibold text-[#111827]'
                                  : 'font-medium text-[#667085]'
                                  }`}
                              >
                                Video
                              </Text>
                            </Pressable>
                          </View>
                        </View>

                        <View className="mt-2 rounded-[16px] bg-[#f3f5f8] p-[3px]">
                          <View className="flex-row">
                            <Pressable
                              className={`flex-1 items-center rounded-[12px] py-[7px] ${searchPostsSort === 'relevant' ? 'bg-white' : 'bg-transparent'
                                }`}
                              onPress={() => {
                                setSearchPostsSort('relevant');
                              }}
                            >
                              <Text
                                className={`text-[11px] ${searchPostsSort === 'relevant'
                                  ? 'font-semibold text-[#111827]'
                                  : 'font-medium text-[#667085]'
                                  }`}
                              >
                                Ilgili
                              </Text>
                            </Pressable>
                            <Pressable
                              className={`flex-1 items-center rounded-[12px] py-[7px] ${searchPostsSort === 'popular' ? 'bg-white' : 'bg-transparent'
                                }`}
                              onPress={() => {
                                setSearchPostsSort('popular');
                              }}
                            >
                              <Text
                                className={`text-[11px] ${searchPostsSort === 'popular'
                                  ? 'font-semibold text-[#111827]'
                                  : 'font-medium text-[#667085]'
                                  }`}
                              >
                                Populer
                              </Text>
                            </Pressable>
                            <Pressable
                              className={`flex-1 items-center rounded-[12px] py-[7px] ${searchPostsSort === 'recent' ? 'bg-white' : 'bg-transparent'
                                }`}
                              onPress={() => {
                                setSearchPostsSort('recent');
                              }}
                            >
                              <Text
                                className={`text-[11px] ${searchPostsSort === 'recent'
                                  ? 'font-semibold text-[#111827]'
                                  : 'font-medium text-[#667085]'
                                  }`}
                              >
                                Yeni
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    ) : null}

                    {searchTagCandidate ? (
                      <View className="pb-3">
                        <View className="overflow-hidden rounded-[18px] border border-[#edf1f5] bg-white">
                          <Pressable
                            className="flex-row items-center px-4 py-3"
                            onPress={() => {
                              openTrendingTagDetail(searchTagCandidate);
                            }}
                          >
                            <View className="h-[34px] w-[34px] items-center justify-center rounded-[12px] bg-[#f3f5f8]">
                              <FeatherIcon color="#344054" name="hash" size={14} />
                            </View>
                            <View className="ml-3 flex-1">
                              <Text className="text-[13px] font-semibold text-[#111827]">
                                #{searchTagCandidate}
                              </Text>
                              <Text className="mt-[2px] text-[11px] text-[#667085]">
                                Etiket detayini ac
                              </Text>
                            </View>
                            <FeatherIcon color="#98a2b3" name="chevron-right" size={16} />
                          </Pressable>
                        </View>
                      </View>
                    ) : null}

                    {trimmedSearchQuery.length === 0 &&
                      searchTab !== 'places' &&
                      trendingTagPreview.length > 0 ? (
                      <View className="pb-3">
                        <View className="flex-row items-center justify-between px-[2px] pb-2">
                          <Text className="text-[13px] font-semibold text-[#111827]">
                            Trend Etiketler
                          </Text>
                        </View>
                        <View className="overflow-hidden rounded-[18px] border border-[#edf1f5] bg-white">
                          {trendingTagPreview.map((item, index) => (
                            <Pressable
                              className={`flex-row items-center px-4 py-3 ${index === trendingTagPreview.length - 1
                                ? ''
                                : 'border-b border-[#edf1f5]'
                                }`}
                              key={item.tag}
                              onPress={() => {
                                openTrendingTagDetail(item.tag);
                              }}
                            >
                              <View className="h-[34px] w-[34px] items-center justify-center rounded-[12px] bg-[#f3f5f8]">
                                <FeatherIcon color="#344054" name="hash" size={14} />
                              </View>
                              <Text
                                className="ml-3 flex-1 text-[13px] font-medium text-[#111827]"
                                numberOfLines={1}
                              >
                                #{item.tag}
                              </Text>
                              <FeatherIcon color="#98a2b3" name="chevron-right" size={16} />
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    ) : null}

                    {(searchTab === 'posts' || searchTab === 'places') &&
                      searchLocationPreview.length > 0 ? (
                      <View className="pb-3">
                        <View className="flex-row items-center justify-between px-[2px] pb-2">
                          <Text className="text-[13px] font-semibold text-[#111827]">
                            Yer Onerileri
                          </Text>
                        </View>
                        <View className="overflow-hidden rounded-[18px] border border-[#edf1f5] bg-white">
                          {searchLocationPreview.map((item, index) => (
                            <Pressable
                              className={`flex-row items-center px-4 py-3 ${index === searchLocationPreview.length - 1
                                ? ''
                                : 'border-b border-[#edf1f5]'
                                }`}
                              key={item.location}
                              onPress={() => {
                                openSearchPlaceViewer(item);
                              }}
                            >
                              <View className="h-[34px] w-[34px] items-center justify-center rounded-[12px] bg-[#f3f5f8]">
                                <FeatherIcon color="#344054" name="map-pin" size={14} />
                              </View>
                              <Text
                                className="ml-3 flex-1 text-[13px] font-medium text-[#111827]"
                                numberOfLines={1}
                              >
                                {item.location}
                              </Text>
                              <FeatherIcon color="#98a2b3" name="chevron-right" size={16} />
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    ) : null}
                  </View>

                  {searchTab === 'posts' ? (
                    isSearchingPosts ? (
                      <View className="items-center justify-center px-8 py-16">
                        <IosSpinner color="#111827" size="small" />
                        <Text className="mt-3 text-center text-[13px] text-[#98a2b3]">
                          Gonderiler yukleniyor...
                        </Text>
                      </View>
                    ) : searchPostsError ? (
                      <View className="mx-4 mt-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2.5">
                        <Text className="text-[12px] text-rose-500">
                          {searchPostsError}
                        </Text>
                      </View>
                    ) : displayedSearchPosts.length === 0 ? (
                      <View className="items-center justify-center px-8 py-16">
                        <Text className="text-center text-[14px] text-[#98a2b3]">
                          {trimmedSearchQuery.length > 0
                            ? 'Aramana uygun gonderi bulunamadi.'
                            : 'Henuz gosterilecek gonderi yok.'}
                        </Text>
                      </View>
                    ) : (
                      <View className="bg-white px-4">
                        {displayedSearchPosts.map((post, index) => (
                          <Pressable
                            className={`flex-row items-center py-3 ${index === displayedSearchPosts.length - 1
                              ? ''
                              : 'border-b border-[#edf1f5]'
                              }`}
                            key={post.id}
                            onPress={() => {
                              if (trimmedSearchQuery.length >= 2) {
                                saveRecentSearchTerm('posts', trimmedSearchQuery);
                              }
                              openPostDirectViewer(post.id, {
                                seedPost: post,
                              });
                            }}
                          >
                            <View className="h-[64px] w-[64px] overflow-hidden rounded-[18px] bg-[#f3f5f8]">
                              <AppMedia
                                durationLabelMode="remaining"
                                enableVideoPreviewInThumbnail={post.mediaType === 'video'}
                                mediaType={post.mediaType}
                                mediaUrl={post.mediaUrl}
                                mode="thumbnail"
                                paused={post.mediaType === 'video' ? index > 2 : undefined}
                                previewLoopFromOffset={true}
                                previewStartOffsetSec={VIDEO_PREVIEW_OFFSET_SEC}
                                showVideoBadge={post.mediaType === 'video'}
                                showVideoDurationLabel={post.mediaType === 'video'}
                                showVideoTypePill={post.mediaType === 'video'}
                                style={POST_ITEM_MEDIA_STYLE}
                              />
                            </View>
                            <View className="ml-3 flex-1">
                              <View className="flex-row items-center justify-between">
                                <Text
                                  className="flex-1 pr-2 text-[14px] font-semibold text-[#111827]"
                                  numberOfLines={1}
                                >
                                  @{safeAuthorUsername(post.author)}
                                </Text>
                                <Text className="text-[10px] font-semibold uppercase tracking-[0.6px] text-[#98a2b3]">
                                  {post.mediaType === 'video' ? 'Video' : 'Foto'}
                                </Text>
                              </View>
                              <Text
                                className="mt-1 text-[12px] leading-[18px] text-[#667085]"
                                numberOfLines={2}
                              >
                                {post.caption.trim().length > 0
                                  ? post.caption.trim()
                                  : 'Kesfet onizleme'}
                              </Text>
                              {post.location.trim().length > 0 ? (
                                <Text
                                  className="mt-1 text-[11px] text-[#98a2b3]"
                                  numberOfLines={1}
                                >
                                  {post.location}
                                </Text>
                              ) : null}
                            </View>
                            <FeatherIcon color="#98a2b3" name="chevron-right" size={18} />
                          </Pressable>
                        ))}
                      </View>
                    )
                  ) : searchTab === 'tags' ? (
                    isLoadingTrendingTags ? (
                      <View className="items-center justify-center px-8 py-16">
                        <IosSpinner color="#111827" size="small" />
                        <Text className="mt-3 text-center text-[13px] text-[#98a2b3]">
                          Etiketler yukleniyor...
                        </Text>
                      </View>
                    ) : trendingTagsError ? (
                      <View className="mx-4 mt-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2.5">
                        <Text className="text-[12px] text-rose-500">
                          {trendingTagsError}
                        </Text>
                      </View>
                    ) : displayedSearchTags.length === 0 ? (
                      <View className="items-center justify-center px-8 py-16">
                        <Text className="text-center text-[14px] text-[#98a2b3]">
                          Aramana uygun etiket bulunamadi.
                        </Text>
                      </View>
                    ) : (
                      <View className="bg-white px-4">
                        {displayedSearchTags.map((item, index) => (
                          <Pressable
                            className={`flex-row items-center py-3 ${index === displayedSearchTags.length - 1
                              ? ''
                              : 'border-b border-[#edf1f5]'
                              }`}
                            key={item.tag}
                            onPress={() => {
                              openTrendingTagDetail(item.tag);
                            }}
                          >
                            <View className="h-[44px] w-[44px] items-center justify-center rounded-[14px] bg-[#f3f5f8]">
                              <FeatherIcon color="#344054" name="hash" size={16} />
                            </View>
                            <View className="ml-3 flex-1">
                              <Text className="text-[14px] font-semibold text-[#111827]">
                                #{item.tag}
                              </Text>
                              <Text className="mt-1 text-[12px] text-[#667085]">
                                {formatTrendingTagMeta(item)}
                              </Text>
                            </View>
                            <FeatherIcon color="#98a2b3" name="chevron-right" size={18} />
                          </Pressable>
                        ))}
                      </View>
                    )
                  ) : isSearchingPosts ? (
                    <View className="items-center justify-center px-8 py-16">
                      <IosSpinner color="#111827" size="small" />
                      <Text className="mt-3 text-center text-[13px] text-[#98a2b3]">
                        Yerler yukleniyor...
                      </Text>
                    </View>
                  ) : searchPostsError ? (
                    <View className="mx-4 mt-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2.5">
                      <Text className="text-[12px] text-rose-500">{searchPostsError}</Text>
                    </View>
                  ) : displayedSearchPlaces.length === 0 ? (
                    <View className="items-center justify-center px-8 py-16">
                      <Text className="text-center text-[14px] text-[#98a2b3]">
                        Aramaya uygun yer bulunamadi.
                      </Text>
                    </View>
                  ) : (
                    <View className="bg-white px-4">
                      {displayedSearchPlaces.map((item, index) => (
                        <Pressable
                          className={`flex-row items-center py-3 ${index === displayedSearchPlaces.length - 1
                            ? ''
                            : 'border-b border-[#edf1f5]'
                            }`}
                          key={item.location}
                          onPress={() => {
                            openSearchPlaceViewer(item);
                          }}
                        >
                          <View className="h-[64px] w-[64px] overflow-hidden rounded-[18px] bg-[#f3f5f8]">
                            <AppMedia
                              durationLabelMode="remaining"
                              enableVideoPreviewInThumbnail={item.previewPost.mediaType === 'video'}
                              mediaType={item.previewPost.mediaType}
                              mediaUrl={item.previewPost.mediaUrl}
                              mode="thumbnail"
                              paused={item.previewPost.mediaType === 'video' ? index > 2 : undefined}
                              previewLoopFromOffset={true}
                              previewStartOffsetSec={VIDEO_PREVIEW_OFFSET_SEC}
                              showVideoBadge={item.previewPost.mediaType === 'video'}
                              showVideoDurationLabel={item.previewPost.mediaType === 'video'}
                              showVideoTypePill={item.previewPost.mediaType === 'video'}
                              style={POST_ITEM_MEDIA_STYLE}
                            />
                          </View>
                          <View className="ml-3 flex-1">
                            <View className="flex-row items-center justify-between">
                              <Text
                                className="mr-2 flex-1 text-[14px] font-semibold text-[#111827]"
                                numberOfLines={1}
                              >
                                {item.location}
                              </Text>
                              <Text className="text-[10px] font-semibold uppercase tracking-[0.6px] text-[#98a2b3]">
                                {item.postCount === 1 ? '1 Gonderi' : `${item.postCount} Gonderi`}
                              </Text>
                            </View>
                            <Text
                              className="mt-1 text-[12px] leading-[18px] text-[#667085]"
                              numberOfLines={2}
                            >
                              {item.hasVideo
                                ? 'Bu konumdaki foto ve videolari tek akista ac.'
                                : 'Bu konumdaki fotograflari tek akista ac.'}
                            </Text>
                            <Text className="mt-1 text-[11px] text-[#98a2b3]">
                              {item.hasVideo ? 'Foto + video' : 'Sadece foto'}
                            </Text>
                          </View>
                          <FeatherIcon color="#98a2b3" name="chevron-right" size={18} />
                        </Pressable>
                      ))}
                    </View>
                  )}

                  {searchTab === 'posts' && searchPostsHasMore ? (
                    <View className="px-4 pb-2 pt-3">
                      <Pressable
                        className="h-[46px] items-center justify-center rounded-[16px] bg-[#f3f5f8]"
                        disabled={isFetchingMoreSearchPosts}
                        onPress={handleLoadMoreSearchPosts}
                      >
                        <Text className="text-[12px] font-semibold text-[#344054]">
                          {isFetchingMoreSearchPosts
                            ? 'Guncelleniyor...'
                            : 'Daha fazla goster'}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </ScrollView>
              )}
            </RNAnimated.View>
          </View>
        </>
      ) : null}

      {overlayRoutes.length > 0 ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFillObject}>
          {overlayRoutes.map((route, index) => (
            <Animated.View
              entering={SlideInRight.duration(260).easing(Easing.out(Easing.cubic))}
              exiting={SlideOutRight.duration(220).easing(Easing.in(Easing.cubic))}
              key={route.id}
              style={[
                StyleSheet.absoluteFillObject,
                {
                  zIndex: 90 + index,
                },
              ]}
            >
              {route.kind === 'trend-tag-detail' ? (
                <TrendTagDetailPage
                  activePosts={activeTrendingTagPosts}
                  activeTagKey={activeTrendingTagKey}
                  detail={trendingTagDetail}
                  detailError={trendingTagDetailError}
                  isFetchingMore={isFetchingMoreTrendingTagPosts}
                  isLoading={isLoadingTrendingTagDetail}
                  onBack={closeTrendingTagPages}
                  onLoadMore={handleLoadMoreTrendingTagPosts}
                  onOpenPost={(_post, postIndex) => {
                    openTrendingTagFeed(postIndex);
                  }}
                  onOpenRelatedTag={openTrendingTagDetail}
                  onRefresh={() => {
                    if (!activeTrendingTagKey) {
                      return;
                    }
                    loadTrendingTagDetail(activeTrendingTagKey, {
                      preferCache: false,
                    });
                  }}
                  onSelectTab={setTrendingTagDetailTab}
                  safeBottom={resolvedSafeBottom}
                  safeTop={resolvedSafeTop}
                  tab={trendingTagDetailTab}
                />
              ) : (
                <TrendTagFeedPage
                  initialIndex={route.initialIndex}
                  onBack={popExploreOverlayRoute}
                  onDoubleTapLike={handleDoubleTapLike}
                  onOpenAuthorProfile={handleOpenProfileFromPost}
                  onOpenComments={openComments}
                  onReact={handleReaction}
                  onReport={handleReportPost}
                  onShare={handleSharePost}
                  onToggleFollow={handleToggleFollow}
                  posts={activeTrendFeedPosts}
                  safeBottom={resolvedPostSafeBottom}
                  safeTop={resolvedSafeTop}
                  tag={route.tag}
                  viewerAvatarUrl={viewerAvatarUrl}
                  viewerId={viewerId}
                  viewerUsername={viewerUsername}
                />
              )}
            </Animated.View>
          ))}
        </View>
      ) : null}

      {selectedSearchUser ? (
        <>
          <StatusBar
            animated={true}
            backgroundColor="#ffffff"
            barStyle="dark-content"
            translucent={false}
          />
          <View className="flex-1 bg-white">
            <View
              className="px-4 pb-2"
              style={{
                paddingTop:
                  Platform.OS === 'android'
                    ? Math.max(StatusBar.currentHeight ?? 0, resolvedSafeTop, 10) + 8
                    : Math.max(resolvedSafeTop, 12),
              }}
            >
              <View className="flex-row items-center justify-between">
                <Pressable
                  className="h-9 w-9 items-center justify-center rounded-full border border-[#e4e7ec] bg-white"
                  onPress={closePublicProfile}
                >
                  <FeatherIcon color="#23262f" name="arrow-left" size={18} />
                </Pressable>

                <Pressable
                  className="h-9 w-9 items-center justify-center rounded-full border border-[#e4e7ec] bg-white"
                  disabled={selectedUserPending || selectedProfileUnavailable}
                  onPress={() => {
                    setIsProfileActionsVisible(true);
                  }}
                >
                  <FeatherIcon color="#23262f" name="more-vertical" size={17} />
                </Pressable>
              </View>
            </View>

            {selectedProfileUnavailable ? (
              <View className="flex-1 items-center justify-center px-6 pb-16">
                <View className="h-16 w-16 items-center justify-center rounded-full border-2 border-[#e6e9ef] bg-[#f3f5f8]">
                  <FeatherIcon color="#8b93a3" name="slash" size={24} />
                </View>
                <Text className="mt-5 text-center text-[22px] font-semibold text-[#1f2937]">
                  {HIDDEN_USER_NOT_FOUND_LABEL}
                </Text>
                <Text className="mt-2 text-center text-[13px] leading-5 text-[#8a90a0]">
                  Bu hesap su an goruntulenemiyor.
                </Text>
              </View>
            ) : (
              <ScrollView
                className="flex-1"
                contentContainerStyle={selectedProfileContentContainerStyle}
                showsVerticalScrollIndicator={false}
              >
                <View className="items-center pt-2">
                  <View className="h-[96px] w-[96px] items-center justify-center rounded-full border-2 border-[#ececef] bg-[#d5d7db]">
                    {selectedIdentity.avatarUrl.length > 0 ? (
                      <Image
                        className="h-[88px] w-[88px] rounded-full"
                        resizeMode="cover"
                        source={{
                          uri: selectedIdentity.avatarUrl,
                        }}
                      />
                    ) : (
                      <Text className="text-[36px] font-medium text-[#7d7f87]">
                        {selectedIdentity.initials}
                      </Text>
                    )}
                  </View>

                  <Text
                    className="mt-3 text-center font-semibold tracking-tight text-[#181b22]"
                    style={selectedDisplayNameStyle}
                  >
                    {selectedDisplayName}
                  </Text>
                  {selectedUsernameLabel.length > 0 ? (
                    <Text className="mt-[2px] text-[14px] text-[#8a90a0]">
                      {selectedUsernameLabel}
                    </Text>
                  ) : null}
                </View>

                {publicProfileError ? (
                  <View className="mt-4 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2.5">
                    <Text className="text-[12px] text-rose-500">
                      {publicProfileError}
                    </Text>
                  </View>
                ) : null}

                <View className="mt-6 flex-row items-center rounded-[20px] border border-[#e4e7ec] bg-white px-3 py-3">
                  {selectedProfileStatItems.map((item, index) => (
                    <React.Fragment key={item.label}>
                      <View className="flex-1 items-center">
                        <Text className="text-[20px] font-bold text-[#181b22]">
                          {item.value}
                        </Text>
                        <Text className="mt-1 text-[10px] tracking-[0.6px] text-[#8f94a0]">
                          {item.label}
                        </Text>
                      </View>
                      {index < selectedProfileStatItems.length - 1 ? (
                        <View className="h-6 w-px bg-[#e1e3e8]" />
                      ) : null}
                    </React.Fragment>
                  ))}
                  {false ? (
                    <>
                  <View className="flex-1 items-center">
                    <Text className="text-[20px] font-bold text-[#181b22]">
                      {formatCount(selectedStats.routesCount)}
                    </Text>
                    <Text className="mt-1 text-[10px] tracking-[0.6px] text-[#8f94a0]">
                      Gönderiler
                    </Text>
                  </View>
                  <View className="h-6 w-px bg-[#e1e3e8]" />
                  <View className="flex-1 items-center">
                    <Text className="text-[20px] font-bold text-[#181b22]">
                      {formatCount(selectedStats.followersCount)}
                    </Text>
                    <Text className="mt-1 text-[10px] tracking-[0.6px] text-[#8f94a0]">
                      TAKIPCI
                    </Text>
                  </View>
                  <View className="h-6 w-px bg-[#e1e3e8]" />
                  <View className="flex-1 items-center">
                    <Text className="text-[20px] font-bold text-[#181b22]">
                      {formatCount(selectedStats.followingCount)}
                    </Text>
                    <Text className="mt-1 text-[10px] tracking-[0.6px] text-[#8f94a0]">
                      TAKIP
                    </Text>
                  </View>
                    </>
                  ) : null}
                </View>

                <View className="mt-5 flex-row items-center gap-3">
                  <Pressable
                    className={`h-[52px] flex-1 items-center justify-center rounded-full border ${selectedBlockedByTarget
                      ? 'border-[#d9e0e8] bg-[#eef2f6]'
                      : selectedSearchRelationship?.isFollowing ||
                        selectedFollowRequestPending
                        ? 'border-[#d9e0e8] bg-[#eef2f6]'
                        : 'border-[#171b2d] bg-[#171b2d]'
                      } ${selectedUserPending ? 'opacity-70' : ''}`}
                    disabled={selectedUserPending || selectedBlockedByTarget}
                    onPress={() => {
                      if (!selectedSearchUser) {
                        return;
                      }
                      handleSearchFollow(selectedSearchUser);
                    }}
                  >
                    <Text
                      className={`text-[14px] font-medium ${selectedSearchRelationship?.isFollowing ||
                        selectedFollowRequestPending
                        ? 'text-[#596273]'
                        : 'text-white'
                        }`}
                    >
                      {selectedUserPending
                        ? translateText('Bekleniyor...')
                        : selectedBlockedByTarget
                          ? translateText('Erisim Yok')
                          : selectedFollowButtonLabel}
                    </Text>
                  </Pressable>

                  {canShowStreetFriendProfileAction ? (
                    <Pressable
                      className={`h-[52px] flex-1 items-center justify-center rounded-full border ${
                        selectedStreetFriendPending ||
                        selectedStreetFriendStatus === 'accepted'
                        ? 'border-[#d8dee8] bg-[#f2f5f8]'
                        : 'border-[#f2ab72] bg-[#fff3e8]'
                      } ${selectedUserPending ? 'opacity-70' : ''}`}
                      disabled={
                        selectedUserPending ||
                        selectedBlockedByTarget
                      }
                      onPress={() => {
                        if (!selectedSearchUser) {
                          return;
                        }
                        handleSearchStreetFriend(selectedSearchUser);
                      }}
                    >
                      <Text
                        className={`text-[13px] font-semibold ${
                          selectedStreetFriendPending ||
                          selectedStreetFriendStatus === 'accepted'
                          ? 'text-[#667085]'
                          : 'text-[#c96f2d]'
                        }`}
                      >
                        {selectedUserPending
                          ? translateText('İşleniyor...')
                          : selectedStreetActionLabel}
                      </Text>
                    </Pressable>
                  ) : null}

                  <Pressable
                    className="h-[52px] w-[52px] items-center justify-center rounded-full border border-[#dce3eb] bg-white"
                    onPress={() => {
                      if (!selectedSearchUser) {
                        return;
                      }
                      closePublicProfile();
                      onOpenDirectMessage?.(selectedSearchUser);
                    }}
                  >
                    <FeatherIcon
                      color="#1f2937"
                      name="message-circle"
                      size={21}
                    />
                  </Pressable>
                </View>

                {selectedSearchUser && selectedFollowRequestIncoming ? (
                  <View className="mt-3 rounded-2xl border border-[#dbe7ff] bg-[#f8fbff] px-3 py-3">
                    <View className="flex-row items-start">
                      <View className="mt-[2px] h-5 w-5 items-center justify-center rounded-full bg-[#e7f0ff]">
                        <FeatherIcon color="#2563eb" name="user-plus" size={12} />
                      </View>
                      <View className="ml-2.5 flex-1">
                        <Text className="text-[12.5px] font-semibold text-[#1e3a8a]">
                          {translateText(
                            'Bu kullanıcı sana Takip isteği gönderdi.',
                          )}
                        </Text>
                        <Text className="mt-1 text-[11px] text-[#64748b]">
                          {translateText(
                            'Takip isteğini buradan kabul edebilir veya silebilirsin.',
                          )}
                        </Text>
                      </View>
                    </View>
                    <View className="mt-3 flex-row items-center gap-2">
                      <Pressable
                        className={`h-[40px] flex-1 items-center justify-center rounded-xl border border-[#1d4ed8] bg-[#1d4ed8] ${
                          selectedUserPending ? 'opacity-70' : ''
                        }`}
                        disabled={selectedUserPending}
                        onPress={() => {
                          handleIncomingFollowRequestDecision(
                            selectedSearchUser,
                            true,
                          );
                        }}
                      >
                        <Text className="text-[12px] font-semibold text-white">
                          {selectedUserPending
                            ? translateText('İşleniyor...')
                            : translateText('Kabul Et')}
                        </Text>
                      </Pressable>
                      <Pressable
                        className={`h-[40px] flex-1 items-center justify-center rounded-xl border border-[#d1d9e6] bg-white ${
                          selectedUserPending ? 'opacity-70' : ''
                        }`}
                        disabled={selectedUserPending}
                        onPress={() => {
                          handleIncomingFollowRequestDecision(
                            selectedSearchUser,
                            false,
                          );
                        }}
                      >
                        <Text className="text-[12px] font-semibold text-[#475569]">
                          {translateText('Sil')}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {selectedSearchUser && selectedStreetFriendIncoming ? (
                  <View className="mt-3 rounded-2xl border border-[#ffe4cf] bg-[#fff7ef] px-3 py-3">
                    <View className="flex-row items-start">
                      <View className="mt-[2px] h-5 w-5 items-center justify-center rounded-full bg-[#ffedd5]">
                        <FeatherIcon color="#c2410c" name="map-pin" size={12} />
                      </View>
                      <View className="ml-2.5 flex-1">
                        <Text className="text-[12.5px] font-semibold text-[#9a3412]">
                          {translateText(
                            'Bu kullanıcı sana Yakındakiler isteği gönderdi.',
                          )}
                        </Text>
                        <Text className="mt-1 text-[11px] text-[#78716c]">
                          {translateText(
                            'Yakındakiler isteğini buradan kabul edebilir veya silebilirsin.',
                          )}
                        </Text>
                      </View>
                    </View>
                    <View className="mt-3 flex-row items-center gap-2">
                      <Pressable
                        className={`h-[40px] flex-1 items-center justify-center rounded-xl border border-[#ea580c] bg-[#ea580c] ${
                          selectedUserPending ? 'opacity-70' : ''
                        }`}
                        disabled={selectedUserPending}
                        onPress={() => {
                          handleSearchStreetFriend(selectedSearchUser);
                        }}
                      >
                        <Text className="text-[12px] font-semibold text-white">
                          {selectedUserPending
                            ? translateText('İşleniyor...')
                            : translateText('Kabul Et')}
                        </Text>
                      </Pressable>
                      <Pressable
                        className={`h-[40px] flex-1 items-center justify-center rounded-xl border border-[#e2e8f0] bg-white ${
                          selectedUserPending ? 'opacity-70' : ''
                        }`}
                        disabled={selectedUserPending}
                        onPress={() => {
                          handleRejectIncomingStreetRequest(selectedSearchUser);
                        }}
                      >
                        <Text className="text-[12px] font-semibold text-[#475569]">
                          {translateText('Sil')}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {canShowStreetFriendProfileAction ? (
                  <Text className="mt-2 text-[11px] text-[#8f94a0]">
                    {selectedStreetActionHint}
                  </Text>
                ) : null}

                {selectedBlockedByTarget ? (
                  <Text className="mt-2 text-[12px] text-[#8f94a0]">
                    {translateText(
                      'Bu hesap sana kapali oldugu icin takip edemezsin.',
                    )}
                  </Text>
                ) : null}

                <View className="mt-6 flex-row items-center">
                  <FeatherIcon color="#23262f" name="grid" size={18} />
                  <Text className="ml-2 text-[20px] font-semibold text-[#181b22]">
                    {translateText('Gönderiler')}
                  </Text>
                </View>

                {selectedIsPrivateAccount && !selectedCanViewPosts ? (
                  <View className="mt-5 items-center rounded-[14px] px-4 py-8">
                    <View className="h-14 w-14 items-center justify-center rounded-full border-2 border-[#d8dde7] bg-[#eef1f5]">
                      <FeatherIcon color="#848b99" name="lock" size={22} />
                    </View>
                    <Text className="mt-4 text-[20px] font-semibold text-[#5d6472]">
                      {translateText('Bu Hesap Gizli.')}
                    </Text>
                    <Text className="mt-2 text-center text-[12px] text-[#8f94a0]">
                      {translateText('Takip etmeden gonderiler gorunmez.')}
                    </Text>
                  </View>
                ) : publicProfilePostsError ? (
                  <View className="mt-4 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2.5">
                    <Text className="text-[12px] text-rose-500">
                      {publicProfilePostsError}
                    </Text>
                  </View>
                ) : publicProfilePosts.length === 0 ? (
                  <View className="mt-10 items-center">
                    <View className="h-14 w-14 items-center justify-center rounded-full border-2 border-[#d4d7df] bg-[#e9ebf0]">
                      <FeatherIcon color="#a0a5b3" name="camera" size={24} />
                    </View>
                    <Text className="mt-4 text-[18px] font-medium text-[#9aa0ad]">
                      {translateText('Henüz Gönderi Yok')}
                    </Text>
                    <Text className="mt-2 text-center text-[12px] text-[#a0a5b3]">
                      {translateText('Bu Kullanıcı Henüz Gönderi Paylaşmadı.')}
                    </Text>
                  </View>
                ) : (
                  <View className="mt-4 flex-row flex-wrap">
                    {publicProfilePosts.map((post, index) => {
                      const isLastInRow = (index + 1) % 3 === 0;
                      const publicProfileCardStyle = {
                        marginRight: isLastInRow ? 0 : 8,
                        marginBottom:
                          index < publicProfilePosts.length - 1
                            ? PUBLIC_PROFILE_POST_CARD_GAP
                            : 0,
                      };
                      return (
                        <PostCard
                          key={post.id}
                          cardStyle={publicProfileCardStyle}
                          commentsText={formatCount(post.stats.commentsCount)}
                          likesText={formatCount(post.stats.likesCount)}
                          mediaType={post.mediaType}
                          mediaUrl={post.mediaUrl}
                          menuMode="indicator"
                          variant="compact"
                          onPress={() => {
                            openPostDirectViewer(post.id, {
                              seedPost: mapPublicProfilePostToExplorePost(post),
                            });
                          }}
                          thumbnailUrl={post.thumbnailUrl}
                        />
                      );
                    })}
                  </View>
                )}
              </ScrollView>
            )}

            {showPublicProfileLoadingOverlay ? (
              <LoadingOverlay tone="light" />
            ) : null}
          </View>
        </>
      ) : null}

      <Modal
        animationType="slide"
        onRequestClose={closeReportModal}
        statusBarTranslucent={true}
        transparent={true}
        visible={isReportModalVisible && selectedReportPost != null}
      >
        <StatusBar
          animated={true}
          backgroundColor="transparent"
          barStyle="dark-content"
          translucent={true}
        />
        <View className="flex-1 justify-end">
          <Pressable
            className="absolute inset-0 bg-black/34"
            disabled={Boolean(reportSubmitReasonKey)}
            onPress={closeReportModal}
          />

          <View
            className="w-full rounded-t-[36px] bg-[#f6f7f9]"
            style={reportModalSheetStyle}
          >
            <View
              className="border-b border-[#e7ebf0] px-5 pb-4"
              style={{ paddingTop: Math.max(resolvedSafeTop, 18) + 2 }}
            >
              <View className="flex-row items-center">
                <Pressable
                  className="h-10 w-10 items-center justify-center rounded-full"
                  disabled={Boolean(reportSubmitReasonKey)}
                  onPress={closeReportModal}
                >
                  <FeatherIcon color="#111827" name="x" size={24} />
                </Pressable>
                <Text className="flex-1 text-center text-[16px] font-medium text-[#111827]">
                  {translateText('Gönderiyi Şikayet Et')}
                </Text>
                <View className="h-10 w-10" />
              </View>
            </View>

            <View className="px-5 pt-4">
              <Text className="text-[14px] font-normal text-[#7f8796]">
                {translateText('Neden şikayet etmek istiyorsunuz?')}
              </Text>
            </View>

            {reportSubmitError ? (
              <View className="mx-5 mb-3 mt-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2.5">
                <Text className="text-[12px] font-normal text-rose-500">
                  {reportSubmitError}
                </Text>
              </View>
            ) : null}

            <ScrollView
              className="flex-1"
              contentContainerStyle={[
                REPORT_MODAL_SCROLL_CONTENT_STYLE,
                REPORT_MODAL_SCROLL_INSET_STYLE,
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View className="gap-3">
                {POST_REPORT_REASON_OPTIONS.map(option => {
                  const isPending = reportSubmitReasonKey === option.key;
                  return (
                    <Pressable
                      className={`h-[72px] flex-row items-center rounded-[16px] border border-[#eceff3] bg-[#f2f4f7] px-4 ${reportSubmitReasonKey && !isPending ? 'opacity-60' : ''
                        }`}
                      disabled={Boolean(reportSubmitReasonKey)}
                      key={option.key}
                      onPress={() => {
                        submitPostReport(option).catch(() => {
                          return;
                        });
                      }}
                    >
                      <View className="h-[38px] w-[38px] items-center justify-center rounded-full bg-[#fff1f2]">
                        <FeatherIcon color="#ef4444" name={option.icon} size={18} />
                      </View>
                      <Text className="ml-3 flex-1 text-[14px] font-normal text-[#1f2937]">
                        {translateText(option.label)}
                      </Text>
                      {isPending ? (
                        <IosSpinner color="#9ca3af" size="small" />
                      ) : (
                        <FeatherIcon color="#a5acb7" name="chevron-right" size={21} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <BlockUserConfirmSheet
        displayName={blockConfirmUser?.fullName}
        onBlock={async () => {
          const user = blockConfirmUser;
          if (!user) {
            return;
          }
          setSearchActionPendingUserId(user.id);
          setSearchError(null);
          try {
            await blockUser(user.id);
            applyExploreUserBlocked(user);
          } catch (error) {
            const msg = resolveSearchActionError(error);
            setSearchError(msg);
            throw new Error(msg);
          } finally {
            setSearchActionPendingUserId(null);
          }
        }}
        onBlockAndReport={async reason => {
          const user = blockConfirmUser;
          if (!user) {
            return;
          }
          setSearchActionPendingUserId(user.id);
          setSearchError(null);
          try {
            await reportUser(user.id, reason);
            await blockUser(user.id);
            applyExploreUserBlocked(user);
          } catch (error) {
            const msg = resolveSearchActionError(error);
            setSearchError(msg);
            throw new Error(msg);
          } finally {
            setSearchActionPendingUserId(null);
          }
        }}
        onClose={() => {
          setBlockConfirmUser(null);
        }}
        username={blockConfirmUser?.username ?? ''}
        visible={blockConfirmUser != null}
      />

      <Modal
        animationType="fade"
        onRequestClose={() => {
          setIsProfileActionsVisible(false);
        }}
        statusBarTranslucent={false}
        transparent={true}
        visible={isProfileActionsVisible && selectedSearchUser != null}
      >
        <StatusBar
          animated={true}
          backgroundColor="#ffffff"
          barStyle="dark-content"
          translucent={false}
        />
        <View className="flex-1 justify-end">
          <Pressable
            className="absolute inset-0 bg-black/30"
            onPress={() => {
              setIsProfileActionsVisible(false);
            }}
          />

          <View
            className="mx-3 rounded-[18px] border border-[#e4e6ee] bg-[#f7f8fb] px-3 py-3"
            style={{ marginBottom: profileActionsSheetBottomInset }}
          >
            <Pressable
              className={`mb-2 h-[48px] items-center justify-center rounded-[12px] border ${selectedIsBlockedByViewer
                ? 'border-[#d8dde8] bg-[#eef2f8]'
                : 'border-[#f5c2c7] bg-[#fff1f2]'
                } ${selectedUserPending ? 'opacity-70' : ''}`}
              disabled={selectedUserPending}
              onPress={() => {
                setIsProfileActionsVisible(false);
                if (!selectedSearchUser) {
                  return;
                }
                if (selectedIsBlockedByViewer) {
                  handleUnblockUser(selectedSearchUser);
                  return;
                }
                openBlockUserSheet(selectedSearchUser);
              }}
            >
              <Text
                className={`text-[13px] font-semibold ${selectedIsBlockedByViewer
                  ? 'text-[#3f4c63]'
                  : 'text-[#d62839]'
                  }`}
              >
                {selectedIsBlockedByViewer
                  ? translateText('Engeli Kaldır')
                  : translateText('Kullanıcıyı Engelle')}
              </Text>
            </Pressable>

            <Pressable
              className="h-[48px] items-center justify-center rounded-[12px] border border-[#d8dde8] bg-white"
              onPress={() => {
                setIsProfileActionsVisible(false);
              }}
            >
              <Text className="text-[13px] font-medium text-[#4f5b72]">
                {translateText('Kapat')}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isCommentsVisible}
        animationType="slide"
        transparent={true}
        statusBarTranslucent={true}
        onRequestClose={() => setIsCommentsVisible(false)}
      >
        <StatusBar
          animated={true}
          backgroundColor="transparent"
          barStyle="light-content"
          hidden={true}
          translucent={true}
        />
        <View className="flex-1 justify-end">
          <Pressable
            className="absolute bottom-0 left-0 right-0 top-0 bg-black/20"
            onPress={() => setIsCommentsVisible(false)}
            style={COMMENTS_BACKDROP_STYLE}
          />

          <KeyboardAvoidingView
            style={COMMENTS_KEYBOARD_AVOIDING_STYLE}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? resolvedSafeTop + 6 : 0}
          >
            <View
              className="w-full overflow-hidden rounded-t-[24px] border border-[#e8ebf2] bg-white"
              style={commentsSheetStyle}
            >
              <View className="z-10 border-b border-[#edf1f5] bg-white px-4 pb-3 pt-2">
                <View className="mb-3 h-[5px] w-11 self-center rounded-full bg-[#d6dde8]" />
                <View className="flex-row items-center">
                  <Text className="ml-8 flex-1 text-center text-[15px] font-semibold tracking-tight text-[#111827]">
                    {translateText('Yorumlar')} (
                    {selectedPost
                      ? formatCount(selectedPost.stats.commentsCount)
                      : '0'}
                    )
                  </Text>
                  <Pressable
                    className="h-8 w-8 items-center justify-center rounded-full bg-[#f3f4f6]"
                    onPress={() => setIsCommentsVisible(false)}
                  >
                    <FeatherIcon name="x" size={18} color="#6b7280" />
                  </Pressable>
                </View>
              </View>

              <ScrollView
                className="flex-1 bg-white px-4 pt-3"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                  COMMENTS_LIST_CONTENT_STYLE,
                  commentsListContentStyle,
                ]}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="always"
              >
                {!commentsLoading && commentsError ? (
                  <View className="rounded-[16px] border border-rose-200 bg-rose-50 px-4 py-4">
                    <Text className="text-[13px] leading-5 text-rose-500">
                      {commentsError ? translateText(commentsError) : null}
                    </Text>
                    {selectedPost ? (
                      <Pressable
                        className="mt-3 self-start rounded-full bg-[#ffe8dd] px-4 py-2"
                        onPress={() => {
                          loadComments(selectedPost.id);
                        }}
                      >
                        <Text className="text-[12px] font-semibold text-[#c2410c]">
                          Tekrar dene
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                {!commentsLoading && !commentsError && comments.length === 0 ? (
                  <View className="items-center justify-center py-16">
                    <Text className="text-[15px] font-semibold text-[#111827]">
                      Henuz yorum yok
                    </Text>
                    <Text className="mt-2 text-center text-[13px] leading-5 text-[#6b7280]">
                      Ilk yorumu birak ve bu postun realtime akisina dahil ol.
                    </Text>
                  </View>
                ) : null}

                {comments.map(comment => {
                  const isCommentLikePending = Boolean(
                    commentLikePendingIds[comment.id],
                  );
                  const likeCount = Math.max(0, Number(comment.likeCount || 0));
                  const isLiked = Boolean(comment.isLiked);
                  return (
                    <View key={comment.id} className="mb-4 flex-row">
                      <Image
                        source={{
                          uri: resolveDisplayedAuthorAvatar(
                            comment.author,
                            viewerId,
                            viewerAvatarUrl,
                            viewerUsername,
                          ),
                        }}
                        className="mr-3 h-9 w-9 rounded-full border border-[#eef0f4]"
                      />
                      <View className="flex-1 border-b border-[#f1f5f9] pb-4">
                        <Text className="mb-1 text-[12.5px] font-semibold tracking-tight text-[#111827]">
                          {safeAuthorUsername(comment.author)}{' '}
                          <Text className="text-[11.5px] font-normal text-[#94a3b8]">
                            {formatRelativeTime(comment.createdAt)}
                          </Text>
                        </Text>
                        <Text className="text-[13.5px] leading-5 text-[#374151]">
                          {comment.body}
                        </Text>
                      </View>

                      <Pressable
                        className="ml-2 items-center justify-start px-1 pt-1"
                        disabled={isCommentLikePending}
                        hitSlop={8}
                        onPress={() => {
                          handleToggleCommentLike(comment);
                        }}
                        style={
                          isCommentLikePending
                            ? COMMENT_LIKE_PENDING_STYLE
                            : undefined
                        }
                      >
                        <FeatherIcon
                          name="heart"
                          size={17}
                          color={isLiked ? '#f97316' : '#9ca3af'}
                          strokeWidth={1.5}
                        />
                        <Text
                          className={`mt-1 text-[11px] font-medium ${isLiked ? 'text-[#ea580c]' : 'text-slate-500'
                            }`}
                        >
                          {formatCount(likeCount)}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>

              <View
                className="border-t border-[#edf0f4] bg-white px-4"
                style={commentsComposerContainerStyle}
              >
                <View className="flex-row items-center gap-3">
                  <Image
                    source={{
                      uri:
                        viewerAvatarUrl.trim().length > 0
                          ? viewerAvatarUrl.trim()
                          : FALLBACK_AVATAR,
                    }}
                    className="h-9 w-9 rounded-full"
                  />
                  <Pressable
                    className="min-h-[42px] flex-1 flex-row items-center rounded-full border border-[#e5e7eb] bg-[#f8fafc] px-4"
                    onPress={() => {
                      commentInputRef.current?.focus?.();
                    }}
                  >
                    <TextInput
                      ref={commentInputRef}
                      placeholder="Yorum ekle..."
                      placeholderTextColor="#94a3b8"
                      className="flex-1 py-2 text-[14px] text-[#111827]"
                      multiline
                      value={newComment}
                      onChangeText={setNewComment}
                    />
                    {newComment.trim().length > 0 ? (
                      <RNAnimated.View
                        style={{ transform: [{ scale: sendScale }] }}
                      >
                        <Pressable
                          className="pl-1"
                          disabled={isSubmittingComment}
                          onPress={() => {
                            handleSubmitComment();
                          }}
                        >
                          <View className="h-7 w-7 items-center justify-center rounded-full bg-[#ff6a37]">
                            {isSubmittingComment ? (
                              <IosSpinner size="small" />
                            ) : (
                              <FeatherIcon
                                name="arrow-up"
                                size={16}
                                color="#FFF"
                                strokeWidth={2.5}
                              />
                            )}
                          </View>
                        </Pressable>
                      </RNAnimated.View>
                    ) : null}
                  </Pressable>
                </View>
              </View>

              {showCommentsLoadingOverlay ? (
                <LoadingOverlay tone="light" />
              ) : null}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
