import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AppState,
  type AppStateStatus,
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAlert } from '../../alerts/AlertProvider';
import PostComposerModal, {
  type PostComposerDraft,
} from '../../components/CameraCapture/PostComposerModal';
import CameraCaptureModal from '../../components/CameraCapture/CameraCaptureModal';
import FeatherIcon from '../../components/FeatherIcon/FeatherIcon';
import IosSpinner from '../../components/IosSpinner/IosSpinner';
import ProfileActionsHeader from '../../components/Headers/ProfileActionsHeader';
import PostCard from '../../components/PostCard/PostCard';
import PostViewerModal, {
  type PostViewerReportReason,
  type PostViewerItem,
  type PostViewerReactionKind,
} from '../../components/PostViewer/PostViewerModal';
import ScreenStateCard, {
  ScreenStateCenter,
} from '../../components/ScreenState/ScreenStateCard';
import { isApiRequestError } from '../../services/apiClient';
import {
  acceptFollowRequest,
  checkUsernameAvailability,
  deleteMyProfilePost,
  fetchBlockedUsers,
  fetchFollowRequests,
  fetchMyLikedPosts,
  fetchMyProfile,
  fetchMyProfilePosts,
  fetchMySavedPosts,
  fetchProfileAppSettings,
  rejectFollowRequest,
  uploadProfilePostMedia,
  updateMyProfilePost,
  updateMyProfile,
  updateProfileAppSettings,
} from '../../services/authService';
import {
  fetchStreetFriendRequests,
  fetchStreetFriends,
  fetchFollowers,
  fetchFollowing,
  followCreator,
  reportExplorePost,
  removeStreetFriend,
  sendExploreReaction,
  upsertStreetFriend,
} from '../../services/exploreService';
import { triggerImpactHaptic, triggerSelectionHaptic } from '../../services/haptics';
import { Text } from '../../theme/typography';
import type { ExploreViewerRequest } from '../../types/AppTypes/AppTypes';
import type {
  FollowRequestItem,
  ProfileGender,
  PublicProfilePostItem,
  UserProfile,
} from '../../types/AuthTypes/AuthTypes';
import type {
  ExploreReactionKind,
  ExploreSearchUser,
  ExploreStreetFriendListItem,
  ExploreStreetFriendRequestItem,
} from '../../types/ExploreTypes/ExploreTypes';
import type { PostLocationPayload } from '../../types/LocationTypes/LocationTypes';
import {
  resolveProfileAvatarUrl,
  withProfileAvatarVersion,
} from '../../utils/profileAvatar';
import { subscribeProfilePostCreated } from '../../services/profilePostEvents';
import {
  subscribeRealtimeFollowRequest,
  subscribeRealtimeStreetRequest,
} from '../../realtime/incomingRequestsBridge';
import { pickGalleryMedia } from '../../native/galleryPicker';
import { Camera } from 'react-native-vision-camera';
import { subscribeAppLanguage, translateText } from '../../i18n/runtime';
import { resolveProtectedMediaUrl } from '../../services/protectedMedia';
import ProfileEditModalContent from './ProfileEditModalContent';
import ProfileSettings from './ProfileSettings/ProfileSettings';

type ProfileScreenProps = {
  contentBottomInset: number;
  followRequestsBadgeCount?: number;
  openEditRequestId?: number;
  onOpenEditRequestConsumed?: () => void;
  onFollowRequestsCountChange?: (count: number) => void;
  onForgotPassword?: (email: string) => void;
  onOpenDirectMessage?: (user: ExploreSearchUser) => void;
  onOpenExploreViewer?: (request: ExploreViewerRequest) => void;
  onOpenPublicProfile?: (user: ExploreSearchUser) => void;
  onStreetRequestsCountChange?: (count: number) => void;
  onStreetRequestsViewed?: (count: number) => void;
  onLogout: () => void;
  onProfileChange: (profile: UserProfile) => void;
  profile: UserProfile;
  safeBottom: number;
  safeTop: number;
  streetRequestsBadgeCount?: number;
};

type ProfileTabKey = 'liked' | 'posts' | 'saved';

type ProfileListMemory = {
  activeTab: ProfileTabKey;
  offsets: Record<ProfileTabKey, number>;
};

type CollectionState = {
  error: string | null;
  hasNextPage: boolean;
  initialLoading: boolean;
  isInitialized: boolean;
  items: PublicProfilePostItem[];
  lastUpdatedAt: number;
  loadingMore: boolean;
  nextCursor: string | null;
  refreshing: boolean;
  signature: string;
};

type CollectionCacheEntry = Pick<
  CollectionState,
  | 'hasNextPage'
  | 'isInitialized'
  | 'items'
  | 'lastUpdatedAt'
  | 'nextCursor'
  | 'signature'
>;

type CollectionLoadReason = 'append' | 'initial' | 'refresh' | 'silent';
type UsernameAvailabilityStatus =
  | 'idle'
  | 'loading'
  | 'available'
  | 'taken'
  | 'error';

const FALLBACK_AVATAR =
  'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=240&q=80';
const PROFILE_POST_CARD_RADIUS = 26;
const PROFILE_POST_CARD_GAP = 16;
const PROFILE_POST_MEDIA_ASPECT = 1;
const PROFILE_PAGE_LIMIT = 24;
const PROFILE_EDIT_CITY_MAX_LENGTH = 48;
const PROFILE_EDIT_BIO_MAX_LENGTH = 220;
const USERNAME_CHECK_DEBOUNCE_MS = 350;
const FOLLOW_REQUESTS_RELOAD_COOLDOWN_MS = 750;
const STREET_REQUESTS_RELOAD_COOLDOWN_MS = 500;
const RELATION_LIST_RELOAD_COOLDOWN_MS = 8_000;
const STREET_REQUESTS_CACHE_TTL_MS = 2_000;
const REALTIME_REQUEST_REFRESH_DEBOUNCE_MS = 140;
const REQUEST_MODAL_FORCE_REFRESH_INTERVAL_MS = 1_200;
const profileListMemoryByProfileId = new Map<string, ProfileListMemory>();

// Cadde istekleri cache - kullanıcı onaylamadığı/silmediği sürece kalıcı
type StreetRequestsCacheEntry = {
  cachedAt: number;
  requests: ExploreStreetFriendRequestItem[];
};
const streetRequestsCacheByProfileId = new Map<string, StreetRequestsCacheEntry>();
const profileCollectionsCacheByProfileId = new Map<
  string,
  Record<ProfileTabKey, CollectionCacheEntry>
>();

function buildViewerReactionKey(postId: string, kind: PostViewerReactionKind) {
  return `${postId}:${kind}`;
}

function getOptimisticProfileStats(
  stats: PublicProfilePostItem['stats'],
  kind: ExploreReactionKind,
  active: boolean,
) {
  switch (kind) {
    case 'bookmark':
      return {
        ...stats,
        bookmarksCount: Math.max(
          Number(stats.bookmarksCount || 0) + (active ? 1 : -1),
          0,
        ),
      };
    case 'share':
      return {
        ...stats,
        sharesCount: Math.max(Number(stats.sharesCount || 0) + 1, 0),
      };
    default:
      return {
        ...stats,
        likesCount: Math.max(
          Number(stats.likesCount || 0) + (active ? 1 : -1),
          0,
        ),
      };
  }
}

function buildProfileSharePayload(post: PostViewerItem) {
  const author = (post.authorUsername || '').trim().replace(/^@+/, '');
  const caption = post.caption.trim();
  const location = post.location.trim();

  return {
    message: [
      author ? `@${author}` : 'MacRadar gonderisi',
      caption,
      location ? `Konum: ${location}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    title: author ? `@${author} gonderisi` : 'MacRadar gonderisi',
  };
}

function createInitialProfileOffsets() {
  return {
    liked: 0,
    posts: 0,
    saved: 0,
  } satisfies Record<ProfileTabKey, number>;
}

function buildCollectionPostSignature(item: PublicProfilePostItem) {
  return [
    item.id,
    item.updatedAt ?? '',
    item.createdAt,
    item.mediaType,
    item.mediaUrl,
    item.thumbnailUrl ?? '',
    item.visibility ?? '',
    item.isLive ? '1' : '0',
    item.isUnavailable ? '1' : '0',
    item.unavailableReason ?? '',
    item.stats.likesCount,
    item.stats.commentsCount,
    item.stats.bookmarksCount,
    item.stats.sharesCount,
  ].join('|');
}

function buildCollectionSignature(
  items: PublicProfilePostItem[],
  hasNextPage: boolean,
  nextCursor: string | null,
) {
  const cursorValue = nextCursor ?? '';
  return `${hasNextPage ? '1' : '0'}::${cursorValue}::${items
    .map(buildCollectionPostSignature)
    .join('||')}`;
}

function createCollectionState(cacheEntry?: CollectionCacheEntry): CollectionState {
  return {
    error: null,
    hasNextPage: cacheEntry?.hasNextPage ?? false,
    initialLoading: false,
    isInitialized: cacheEntry?.isInitialized ?? false,
    items: cacheEntry?.items ?? [],
    lastUpdatedAt: cacheEntry?.lastUpdatedAt ?? 0,
    loadingMore: false,
    nextCursor: cacheEntry?.nextCursor ?? null,
    refreshing: false,
    signature:
      cacheEntry?.signature ??
      buildCollectionSignature(
        cacheEntry?.items ?? [],
        cacheEntry?.hasNextPage ?? false,
        cacheEntry?.nextCursor ?? null,
      ),
  };
}

function createInitialCollections(
  profileId?: string,
): Record<ProfileTabKey, CollectionState> {
  const cached = profileId
    ? profileCollectionsCacheByProfileId.get(profileId)
    : null;
  return {
    liked: createCollectionState(cached?.liked),
    posts: createCollectionState(cached?.posts),
    saved: createCollectionState(cached?.saved),
  };
}

function persistCollectionsCache(
  profileId: string,
  collections: Record<ProfileTabKey, CollectionState>,
) {
  profileCollectionsCacheByProfileId.set(profileId, {
    liked: {
      hasNextPage: collections.liked.hasNextPage,
      isInitialized: collections.liked.isInitialized,
      items: collections.liked.items,
      lastUpdatedAt: collections.liked.lastUpdatedAt,
      nextCursor: collections.liked.nextCursor,
      signature: collections.liked.signature,
    },
    posts: {
      hasNextPage: collections.posts.hasNextPage,
      isInitialized: collections.posts.isInitialized,
      items: collections.posts.items,
      lastUpdatedAt: collections.posts.lastUpdatedAt,
      nextCursor: collections.posts.nextCursor,
      signature: collections.posts.signature,
    },
    saved: {
      hasNextPage: collections.saved.hasNextPage,
      isInitialized: collections.saved.isInitialized,
      items: collections.saved.items,
      lastUpdatedAt: collections.saved.lastUpdatedAt,
      nextCursor: collections.saved.nextCursor,
      signature: collections.saved.signature,
    },
  });
}

function formatCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace('.0', '')}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace('.0', '')}K`;
  }
  return String(value);
}

function dedupePosts(items: PublicProfilePostItem[]) {
  const seen = new Set<string>();
  const next: PublicProfilePostItem[] = [];
  items.forEach(item => {
    if (seen.has(item.id)) {
      return;
    }
    seen.add(item.id);
    next.push(item);
  });
  return next;
}

function splitNameParts(fullName: string) {
  const cleaned = fullName.trim().replace(/\s+/g, ' ');
  if (cleaned.length === 0) {
    return { firstName: '', lastName: '' };
  }

  const segments = cleaned.split(' ');
  if (segments.length === 1) {
    return { firstName: segments[0], lastName: '' };
  }

  return {
    firstName: segments.slice(0, -1).join(' '),
    lastName: segments[segments.length - 1],
  };
}

function profileCanonicalBirthDateDisplay(birthYear: number): string {
  const currentYear = new Date().getFullYear();
  const y = birthYear;
  if (y === 2000) {
    return '';
  }
  return y >= 1900 && y <= currentYear ? `${y}-01-01` : '';
}

function getInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');
}

function formatRequestAge(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    return 'Simdi';
  }

  const elapsedMinutes = Math.floor(elapsed / 60000);
  if (elapsedMinutes < 1) {
    return 'Simdi';
  }
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} dk`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours} sa`;
  }

  return `${Math.floor(elapsedHours / 24)} g`;
}

function normalizeCollectionErrorMessage(message: string) {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return 'Profil içeriği şu anda yüklenemedi.';
  }

  const lowered = trimmed.toLowerCase();
  if (
    lowered.includes('sqlstate') ||
    lowered.includes('query viewer engagement posts') ||
    lowered.includes('invalid input value for enum media_type')
  ) {
    return 'Profil içeriği şu anda yüklenemedi.';
  }

  return trimmed;
}

function isCollectionPostUnavailable(
  item: PublicProfilePostItem | undefined,
) {
  if (!item) {
    return true;
  }
  if (item.isUnavailable === true) {
    return true;
  }
  if (String(item.mediaType || '').trim().toLowerCase() === 'unavailable') {
    return true;
  }
  return String(item.mediaUrl || '').trim().length === 0;
}

type UnifiedRelationRowProps = {
  actionLabel: string;
  actionTone: 'danger' | 'primary' | 'secondary';
  avatarUri: string;
  isActionDisabled?: boolean;
  isPending: boolean;
  onAction: () => void;
  onProfilePress?: () => void;
  primaryText: string;
  secondaryText: string;
};

function UnifiedRelationRow({
  actionLabel,
  actionTone,
  avatarUri,
  isActionDisabled = false,
  isPending,
  onAction,
  onProfilePress,
  primaryText,
  secondaryText,
}: UnifiedRelationRowProps) {
  const actionContainerClassName =
    actionTone === 'primary'
      ? 'border-[#ff5a1f] bg-transparent'
      : actionTone === 'danger'
        ? 'border-[#f7c2b5] bg-[#fff3ef]'
        : 'border-[#dce4ee] bg-[#f4f7fb]';
  const actionTextClassName =
    actionTone === 'primary'
      ? 'text-[#ff5a1f]'
      : actionTone === 'danger'
        ? 'text-[#c2410c]'
        : 'text-[#475569]';
  const identityContent = (
    <>
      <Image
        className="h-12 w-12 rounded-full border border-[#e3e8f0] bg-[#f4f6fa]"
        source={{ uri: avatarUri }}
      />
      <View className="ml-3 min-h-[52px] flex-1 justify-center pr-2">
        <Text
          allowFontScaling={false}
          className="text-[14.5px] font-bold leading-[19px] text-[#111827]"
          numberOfLines={1}
        >
          {primaryText}
        </Text>
        <Text
          allowFontScaling={false}
          className="mt-0.5 text-[13px] leading-[18px] text-[#64748b]"
          numberOfLines={1}
        >
          {secondaryText}
        </Text>
      </View>
    </>
  );

  const actionButton = (
    <View className="ml-3 self-center">
      <Pressable
        disabled={isPending || isActionDisabled}
        onPress={event => {
          event.stopPropagation?.();
          onAction();
        }}
        className={`h-9 min-w-[112px] items-center justify-center rounded-xl border px-4 ${
          actionContainerClassName
        } ${isPending || isActionDisabled ? 'opacity-55' : ''}`}
      >
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          className={`text-[13px] font-bold ${actionTextClassName}`}
        >
          {actionLabel}
        </Text>
      </Pressable>
    </View>
  );

  if (onProfilePress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onProfilePress}
        className="min-h-[74px] flex-row items-center px-4 py-2.5 active:rounded-[14px] active:bg-[#f8fafd]"
      >
        <View className="min-h-[52px] flex-1 flex-row items-center">
          {identityContent}
        </View>
        {actionButton}
      </Pressable>
    );
  }

  return (
    <View className="min-h-[74px] flex-row items-center px-4 py-2.5">
      <View className="min-h-[52px] flex-1 flex-row items-center">
        {identityContent}
      </View>
      {actionButton}
    </View>
  );
}

export default function ProfileScreen({
  contentBottomInset,
  followRequestsBadgeCount = 0,
  openEditRequestId,
  onOpenEditRequestConsumed,
  onFollowRequestsCountChange,
  onForgotPassword,
  onOpenDirectMessage: _onOpenDirectMessage,
  onOpenExploreViewer,
  onOpenPublicProfile,
  onStreetRequestsCountChange,
  onStreetRequestsViewed,
  onLogout,
  onProfileChange,
  profile,
  safeBottom,
  safeTop,
  streetRequestsBadgeCount = 0,
}: ProfileScreenProps) {
  const { confirm, showToast } = useAlert();
  const [, setI18nBump] = useState(0);
  useEffect(() => {
    return subscribeAppLanguage(() => {
      setI18nBump(value => value + 1);
    });
  }, []);
  const initialListMemory = profileListMemoryByProfileId.get(profile.id);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsEntryScreen, setSettingsEntryScreen] = useState<
    'root' | 'account'
  >('root');
  const [activeTab, setActiveTab] = useState<ProfileTabKey>(
    initialListMemory?.activeTab ?? 'posts',
  );
  const activeTabRef = useRef<ProfileTabKey>(
    initialListMemory?.activeTab ?? 'posts',
  );
  const [collections, setCollections] = useState<
    Record<ProfileTabKey, CollectionState>
  >(() => createInitialCollections(profile.id));
  const [followRequests, setFollowRequests] = useState<FollowRequestItem[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [pendingFollowRequestId, setPendingFollowRequestId] = useState<
    string | null
  >(null);
  const [isRequestsModalVisible, setIsRequestsModalVisible] = useState(false);
  const [followers, setFollowers] = useState<ExploreSearchUser[]>([]);
  const [following, setFollowing] = useState<ExploreSearchUser[]>([]);
  const [streetFriends, setStreetFriends] = useState<
    ExploreStreetFriendListItem[]
  >([]);
  const [isFollowersModalVisible, setIsFollowersModalVisible] = useState(false);
  const [isFollowingModalVisible, setIsFollowingModalVisible] = useState(false);
  const [isStreetFriendsModalVisible, setIsStreetFriendsModalVisible] =
    useState(false);
  const [isLoadingFollowers, setIsLoadingFollowers] = useState(false);
  const [isLoadingFollowing, setIsLoadingFollowing] = useState(false);
  const [isLoadingStreetFriends, setIsLoadingStreetFriends] = useState(false);
  const [followersError, setFollowersError] = useState<string | null>(null);
  const [followingError, setFollowingError] = useState<string | null>(null);
  const [streetFriendsError, setStreetFriendsError] = useState<string | null>(
    null,
  );
  const [pendingFollowerActionId, setPendingFollowerActionId] = useState<
    string | null
  >(null);
  const [pendingFollowingActionId, setPendingFollowingActionId] = useState<
    string | null
  >(null);
  const [pendingStreetFriendActionId, setPendingStreetFriendActionId] =
    useState<string | null>(null);

  const [streetRequests, setStreetRequests] = useState<
    ExploreStreetFriendRequestItem[]
  >([]);
  const [isLoadingStreetRequests, setIsLoadingStreetRequests] = useState(false);
  const [streetRequestsError, setStreetRequestsError] = useState<string | null>(
    null,
  );
  const [blockedUserIds, setBlockedUserIds] = useState<Record<string, true>>({});
  const [pendingStreetRequestId, setPendingStreetRequestId] = useState<
    string | null
  >(null);
  const [isStreetRequestsModalVisible, setIsStreetRequestsModalVisible] =
    useState(false);

  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editUsernameStatus, setEditUsernameStatus] =
    useState<UsernameAvailabilityStatus>('idle');
  const [editUsernameStatusMessage, setEditUsernameStatusMessage] = useState<
    string | null
  >(null);
  const [editBirthDate, setEditBirthDate] = useState('');
  const [editGender, setEditGender] = useState<ProfileGender>('prefer_not_to_say');
  const [editPhoneDigits, setEditPhoneDigits] = useState('');
  const [editPhoneDialCode, setEditPhoneDialCode] = useState('90');
  const [editBio, setEditBio] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editGenderBaseline, setEditGenderBaseline] =
    useState<ProfileGender>('prefer_not_to_say');
  const [isAvatarActionSheetVisible, setIsAvatarActionSheetVisible] =
    useState(false);
  const [isAvatarActionSheetMounted, setIsAvatarActionSheetMounted] =
    useState(false);
  const [avatarActionSource, setAvatarActionSource] = useState<
    'edit' | 'profile'
  >('profile');
  const [isAvatarActionLoading, setIsAvatarActionLoading] = useState(false);
  const [avatarLocalPreviewUrl, setAvatarLocalPreviewUrl] = useState('');
  const [avatarImageLoadFailed, setAvatarImageLoadFailed] = useState(false);
  const [isAvatarCameraModalVisible, setIsAvatarCameraModalVisible] =
    useState(false);

  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [viewerStartIndex, setViewerStartIndex] = useState(0);
  const [pendingViewerReactionKeys, setPendingViewerReactionKeys] = useState<
    Record<string, true>
  >({});
  const [pendingViewerReportPostId, setPendingViewerReportPostId] = useState<
    string | null
  >(null);
  const [, setMediaLoadErrorByPostId] = useState<
    Record<string, true>
  >({});
  const [pendingDeletePostId, setPendingDeletePostId] = useState<string | null>(
    null,
  );
  const [pendingUpdatePostId, setPendingUpdatePostId] = useState<string | null>(
    null,
  );
  const [postActionsTarget, setPostActionsTarget] =
    useState<PublicProfilePostItem | null>(null);
  const [isPostActionsSheetVisible, setIsPostActionsSheetVisible] = useState(false);
  const [postActionsStep, setPostActionsStep] = useState<'menu' | 'confirm-delete'>(
    'menu',
  );
  const [editingPost, setEditingPost] = useState<PublicProfilePostItem | null>(
    null,
  );
  const [postNotice, setPostNotice] = useState<{
    message: string;
    tone: 'error' | 'success';
  } | null>(null);

  const scrollViewRef = useRef<ScrollView>(null);
  const restoreScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const listOffsetsByTabRef = useRef<Record<ProfileTabKey, number>>(
    initialListMemory
      ? { ...createInitialProfileOffsets(), ...initialListMemory.offsets }
      : createInitialProfileOffsets(),
  );
  const collectionsRef = useRef<Record<ProfileTabKey, CollectionState>>(
    createInitialCollections(profile.id),
  );
  const collectionAbortControllerRef = useRef<Record<ProfileTabKey, AbortController | null>>({
    liked: null,
    posts: null,
    saved: null,
  });
  const collectionRequestIdRef = useRef<Record<ProfileTabKey, number>>({
    liked: 0,
    posts: 0,
    saved: 0,
  });
  const requestsRequestIdRef = useRef(0);
  const followRequestsLastLoadAtRef = useRef(0);
  const followRequestsInFlightRef = useRef(false);
  const followRequestsAbortControllerRef = useRef<AbortController | null>(null);
  const streetRequestsRequestIdRef = useRef(0);
  const streetRequestsLastLoadAtRef = useRef(0);
  const streetRequestsInFlightRef = useRef(false);
  const streetRequestsAbortControllerRef = useRef<AbortController | null>(null);
  const streetRequestsCatchupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const realtimeFollowRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const realtimeStreetRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const streetRequestsCatchupAttemptsRef = useRef(0);
  const blockedUsersRequestIdRef = useRef(0);
  const followersRequestIdRef = useRef(0);
  const followingRequestIdRef = useRef(0);
  const streetFriendsRequestIdRef = useRef(0);
  const followersLastLoadAtRef = useRef(0);
  const followingLastLoadAtRef = useRef(0);
  const streetFriendsLastLoadAtRef = useRef(0);
  const followersInFlightRef = useRef(false);
  const followingInFlightRef = useRef(false);
  const streetFriendsInFlightRef = useRef(false);
  const followersAbortControllerRef = useRef<AbortController | null>(null);
  const followingAbortControllerRef = useRef<AbortController | null>(null);
  const streetFriendsAbortControllerRef = useRef<AbortController | null>(null);
  const editConfirmScale = useRef(new Animated.Value(1)).current;
  const editAvatarScale = useRef(new Animated.Value(1)).current;
  const avatarActionSheetTranslateY = useRef(new Animated.Value(36)).current;
  const avatarActionSheetOpacity = useRef(new Animated.Value(0)).current;
  const avatarActionSheetBackdropOpacity = useRef(new Animated.Value(0)).current;
  const lastHandledOpenEditRequestIdRef = useRef(0);
  const lastFollowRequestsBadgeCountRef = useRef(followRequestsBadgeCount);
  const lastStreetRequestsBadgeCountRef = useRef(streetRequestsBadgeCount);
  const lastFollowRequestsModalRefreshAtRef = useRef(0);
  const lastStreetRequestsModalRefreshAtRef = useRef(0);
  const onFollowRequestsCountChangeRef = useRef(onFollowRequestsCountChange);
  const onStreetRequestsViewedRef = useRef(onStreetRequestsViewed);
  const profileBootstrapKeyRef = useRef<string | null>(null);
  const postNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextPostTilePressIdRef = useRef<string | null>(null);
  const pendingViewerReactionKeysRef = useRef<Set<string>>(new Set());
  const profileAppStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isProfileScreenFocused = true;

  useEffect(() => {
    const collectionAbortControllers = collectionAbortControllerRef.current;
    return () => {
      collectionAbortControllers.liked?.abort();
      collectionAbortControllers.posts?.abort();
      collectionAbortControllers.saved?.abort();
      followRequestsAbortControllerRef.current?.abort();
      streetRequestsAbortControllerRef.current?.abort();
      followersAbortControllerRef.current?.abort();
      followingAbortControllerRef.current?.abort();
      streetFriendsAbortControllerRef.current?.abort();
      if (streetRequestsCatchupTimerRef.current) {
        clearTimeout(streetRequestsCatchupTimerRef.current);
        streetRequestsCatchupTimerRef.current = null;
      }
      if (realtimeFollowRefreshTimerRef.current) {
        clearTimeout(realtimeFollowRefreshTimerRef.current);
        realtimeFollowRefreshTimerRef.current = null;
      }
      if (realtimeStreetRefreshTimerRef.current) {
        clearTimeout(realtimeStreetRefreshTimerRef.current);
        realtimeStreetRefreshTimerRef.current = null;
      }
    };
  }, []);

  const avatarUrl = resolveProfileAvatarUrl(profile);
  const effectiveAvatarUrl = avatarLocalPreviewUrl.trim().length > 0
    ? avatarLocalPreviewUrl.trim()
    : avatarUrl;
  const hasProfileAvatar =
    effectiveAvatarUrl.length > 0 && !avatarImageLoadFailed;
  const isEmailLoginProfile = profile.authProvider === 'local';
  const canDeleteAvatarFromActionSheet =
    isEmailLoginProfile &&
    (avatarActionSource === 'edit'
      ? editAvatarUrl.trim().length > 0
      : hasProfileAvatar);
  const isAvatarActionBusy = isAvatarActionLoading || isSavingEdit;
  const displayName = profile.fullName.trim() || profile.username.trim();
  const avatarInitials =
    getInitials(profile.fullName.trim()) ||
    getInitials(profile.username.trim()) ||
    'U';
  const usernameText = `@${profile.username.trim().replace(/^@+/, '')}`;
  const profileBioText = profile.bio.trim();
  const topInset = Math.max(safeTop, 12);
  const footerInset = Math.max(contentBottomInset + 28, safeBottom + 124);
  const activeCollection = collections[activeTab];
  const isProfileScrollable = true;
  const showCollectionInitialLoading =
    activeCollection.initialLoading &&
    activeCollection.items.length === 0 &&
    !activeCollection.error;
  const isPrivateAccount = profile.privacy?.isPrivateAccount === true;
  const isAnyFollowRequestActionPending = pendingFollowRequestId != null;
  const persistProfileListMemory = useCallback(
    (nextActiveTab: ProfileTabKey = activeTabRef.current) => {
      profileListMemoryByProfileId.set(profile.id, {
        activeTab: nextActiveTab,
        offsets: {
          ...listOffsetsByTabRef.current,
        },
      });
    },
    [profile.id],
  );
  const handleSetActiveTab = useCallback(
    (nextTab: ProfileTabKey) => {
      persistProfileListMemory(nextTab);
      setActiveTab(nextTab);
    },
    [persistProfileListMemory],
  );
  const showPostNotice = useCallback(
    (message: string, tone: 'error' | 'success' = 'success') => {
      setPostNotice({ message, tone });
      if (postNoticeTimerRef.current) {
        clearTimeout(postNoticeTimerRef.current);
      }
      postNoticeTimerRef.current = setTimeout(() => {
        setPostNotice(null);
        postNoticeTimerRef.current = null;
      }, 2600);
    },
    [],
  );
  const patchPostAcrossCollections = useCallback(
    (postId: string, updater: (item: PublicProfilePostItem) => PublicProfilePostItem) => {
      setCollections(previous => ({
        liked: {
          ...previous.liked,
          items: previous.liked.items.map(item =>
            item.id === postId ? updater(item) : item,
          ),
        },
        posts: {
          ...previous.posts,
          items: previous.posts.items.map(item =>
            item.id === postId ? updater(item) : item,
          ),
        },
        saved: {
          ...previous.saved,
          items: previous.saved.items.map(item =>
            item.id === postId ? updater(item) : item,
          ),
        },
      }));
    },
    [],
  );
  const replacePostAcrossCollections = useCallback(
    (nextPost: PublicProfilePostItem) => {
      patchPostAcrossCollections(nextPost.id, item => ({
        ...item,
        ...nextPost,
      }));
    },
    [patchPostAcrossCollections],
  );

  const findPostAcrossCollections = useCallback((postId: string) => {
    const currentCollections = collectionsRef.current;
    return (
      currentCollections.posts.items.find(item => item.id === postId) ??
      currentCollections.liked.items.find(item => item.id === postId) ??
      currentCollections.saved.items.find(item => item.id === postId) ??
      null
    );
  }, []);

  const applyPostReactionSnapshot = useCallback(
    (
      postId: string,
      stats: PublicProfilePostItem['stats'],
      viewerState: NonNullable<PublicProfilePostItem['viewerState']>,
    ) => {
      patchPostAcrossCollections(postId, item => ({
        ...item,
        stats: {
          ...item.stats,
          ...stats,
        },
        viewerState: {
          followRequestStatus:
            viewerState.followRequestStatus ??
            item.viewerState?.followRequestStatus ??
            'none',
          isBookmarked: viewerState.isBookmarked,
          isFollowing:
            viewerState.isFollowing ?? item.viewerState?.isFollowing ?? false,
          isLiked: viewerState.isLiked,
          isStreetFriend:
            viewerState.isStreetFriend ??
            item.viewerState?.isStreetFriend ??
            false,
          streetFriendStatus:
            viewerState.streetFriendStatus ??
            item.viewerState?.streetFriendStatus ??
            'none',
        },
      }));
    },
    [patchPostAcrossCollections],
  );

  const syncProfileReactionCollection = useCallback(
    (
      post: PostViewerItem,
      kind: ExploreReactionKind,
      active: boolean,
      stats: PublicProfilePostItem['stats'],
      viewerState: NonNullable<PublicProfilePostItem['viewerState']>,
    ) => {
      const targetTab =
        kind === 'like' ? 'liked' : kind === 'bookmark' ? 'saved' : null;
      if (!targetTab) {
        return;
      }

      const existingPost = findPostAcrossCollections(post.id);
      const fallbackPost: PublicProfilePostItem = {
        caption: post.caption,
        createdAt: post.createdAt,
        id: post.id,
        isLive: true,
        location: post.location,
        mediaType: post.mediaType,
        mediaUrl: post.mediaUrl,
        stats,
        thumbnailUrl: post.thumbnailUrl,
        userId: post.authorId?.trim() || profile.id,
        username:
          post.authorUsername?.trim().replace(/^@+/, '') ||
          profile.username.trim(),
        viewerState,
      };
      const nextPost = {
        ...(existingPost ?? fallbackPost),
        stats,
        viewerState,
      };

      setCollections(previous => {
        const currentItems = previous[targetTab].items.filter(
          item => item.id !== post.id,
        );
        return {
          ...previous,
          [targetTab]: {
            ...previous[targetTab],
            isInitialized: true,
            items: active ? [nextPost, ...currentItems] : currentItems,
          },
        };
      });
    },
    [findPostAcrossCollections, profile.id, profile.username],
  );

  const postViewerItems = useMemo<PostViewerItem[]>(
    () =>
      activeCollection.items.map(item => ({
        authorAvatarUrl: effectiveAvatarUrl,
        authorId: profile.id,
        authorUsername: item.username,
        caption: item.caption,
        createdAt: item.createdAt,
        id: item.id,
        location: item.location,
        mediaType: item.mediaType,
        mediaUrl: item.mediaUrl,
        thumbnailUrl: item.thumbnailUrl,
        stats: item.stats,
        viewerState: {
          isBookmarked:
            item.viewerState?.isBookmarked === true || activeTab === 'saved',
          isLiked: item.viewerState?.isLiked === true || activeTab === 'liked',
        },
      })),
    [activeCollection.items, activeTab, effectiveAvatarUrl, profile.id],
  );
  const editingPostDraft = useMemo<PostComposerDraft | null>(() => {
    if (!editingPost) {
      return null;
    }

    return {
      capturedAt: editingPost.createdAt,
      mediaType: editingPost.mediaType === 'video' ? 'video' : 'photo',
      mediaUrl: editingPost.mediaUrl,
      source: 'gallery',
      thumbnailUrl: editingPost.thumbnailUrl,
    };
  }, [editingPost]);

  const visibleFollowRequests = useMemo(
    () => followRequests.filter(request => !blockedUserIds[request.id]),
    [blockedUserIds, followRequests],
  );
  const requestPreviewItems = visibleFollowRequests.slice(0, 3);
  const followPendingRequestsCount = visibleFollowRequests.length;
  const followUnseenRequestsBadgeCount = Number.isFinite(followRequestsBadgeCount)
    ? Math.max(0, Math.floor(followRequestsBadgeCount))
    : 0;
  const streetIncomingRequests = useMemo(
    () =>
      streetRequests.filter(
        request =>
          request.streetFriendStatus === 'pending_incoming' &&
          !blockedUserIds[request.id],
      ),
    [blockedUserIds, streetRequests],
  );
  const streetRequestPreviewItems = streetIncomingRequests.slice(0, 3);
  const streetIncomingRequestsCount = streetIncomingRequests.length;
  const streetUnseenRequestsBadgeCount = Number.isFinite(
    streetRequestsBadgeCount,
  )
    ? Math.max(0, Math.floor(streetRequestsBadgeCount))
    : 0;
  const effectiveFollowRequestsCount = Math.max(
    visibleFollowRequests.length,
    followUnseenRequestsBadgeCount,
  );
  const effectiveStreetIncomingRequestsCount = Math.max(
    streetIncomingRequestsCount,
    streetUnseenRequestsBadgeCount,
  );
  const followRequestInfoLabel =
    followPendingRequestsCount > 0
      ? translateText(`${followPendingRequestsCount} bekleyen takip isteği`)
      : followUnseenRequestsBadgeCount > 0
        ? translateText(`${followUnseenRequestsBadgeCount} yeni takip isteği`)
        : translateText('Yeni takip isteğin yok.');
  const streetRequestInfoLabel =
    streetIncomingRequestsCount > 0
      ? translateText(
          `${streetIncomingRequestsCount} bekleyen Yakındakiler isteği`,
        )
      : streetUnseenRequestsBadgeCount > 0
        ? translateText(
            `${streetUnseenRequestsBadgeCount} yeni Yakındakiler isteği`,
          )
        : translateText('Yeni Yakındakiler isteğin yok.');
  const followRequestStateLabel =
    followUnseenRequestsBadgeCount > 0
      ? translateText('Yeni')
      : followPendingRequestsCount > 0
        ? translateText('Bekliyor')
        : null;
  const streetRequestStateLabel =
    streetUnseenRequestsBadgeCount > 0
      ? translateText('Yeni')
      : streetIncomingRequestsCount > 0
        ? translateText('Bekliyor')
        : null;

  const animatePressScale = useCallback(
    (target: Animated.Value, value: number) => {
      Animated.spring(target, {
        friction: 7,
        tension: 220,
        toValue: value,
        useNativeDriver: true,
      }).start();
    },
    [],
  );

  const resolveAvatarActionErrorMessage = useCallback(
    (error: unknown, fallback: string) => {
      if (isApiRequestError(error)) {
        return error.message;
      }
      if (error instanceof Error && error.message.trim().length > 0) {
        return error.message.trim();
      }
      return fallback;
    },
    [],
  );

  const updateProfileAvatarWithMedia = useCallback(
    async (mediaUrl: string) => {
      const normalizedMediaUrl = mediaUrl.trim();
      if (normalizedMediaUrl.length === 0) {
        throw new Error('Profil fotoğrafı seçilemedi.');
      }

      const uploaded = await uploadProfilePostMedia({
        mediaType: 'photo',
        mediaUrl: normalizedMediaUrl,
      });
      const uploadedMediaUrl = uploaded.asset.mediaUrl.trim();
      if (uploadedMediaUrl.length === 0) {
        throw new Error('Profil fotoğrafı yüklenemedi.');
      }

      const updatedProfile = withProfileAvatarVersion(
        await updateMyProfile({ avatarUrl: uploadedMediaUrl }),
        uploaded.asset.uploadedAt || Date.now(),
      );
      onProfileChange(updatedProfile);
      setAvatarLocalPreviewUrl(resolveProfileAvatarUrl(updatedProfile));
      setAvatarImageLoadFailed(false);
      setEditAvatarUrl(resolveProfileAvatarUrl(updatedProfile));
    },
    [onProfileChange],
  );

  const openProfilePhotoActionSheet = useCallback(
    (source: 'edit' | 'profile') => {
      if (isAvatarActionBusy) {
        return;
      }
      triggerImpactHaptic('soft');
      setIsAvatarActionSheetMounted(true);
      setAvatarActionSource(source);
      setIsAvatarActionSheetVisible(true);
    },
    [isAvatarActionBusy],
  );

  const closeProfilePhotoActionSheet = useCallback(() => {
    if (isAvatarActionLoading) {
      return;
    }
    if (!isAvatarActionSheetVisible) {
      return;
    }
    triggerSelectionHaptic();
    setIsAvatarActionSheetVisible(false);
  }, [isAvatarActionLoading, isAvatarActionSheetVisible]);

  const handleProfilePhotoPress = useCallback(
    (source: 'edit' | 'profile') => {
      openProfilePhotoActionSheet(source);
    },
    [openProfilePhotoActionSheet],
  );

  const ensureCameraPermissionForAvatar = useCallback(async () => {
    try {
      const initialStatus = Camera.getCameraPermissionStatus();
      if (initialStatus === 'granted') {
        return true;
      }

      const requestedStatus = await Camera.requestCameraPermission();
      if (requestedStatus === 'granted') {
        return true;
      }

      showToast({
        message: 'Fotoğraf çekmek için kamera izni vermen gerekiyor.',
        title: 'Kamera izni gerekli',
        tone: 'warning',
      });
      return false;
    } catch (error) {
      showToast({
        message: resolveAvatarActionErrorMessage(
          error,
          'Kamera izni kontrol edilirken bir sorun oluştu.',
        ),
        title: 'Kamera acilamadi',
        tone: 'danger',
      });
      return false;
    }
  }, [resolveAvatarActionErrorMessage, showToast]);

  const handleSelectPhotoFromCamera = useCallback(async () => {
    if (isAvatarActionBusy) {
      return;
    }
    triggerSelectionHaptic();

    const granted = await ensureCameraPermissionForAvatar();
    if (!granted) {
      return;
    }

    setIsAvatarActionSheetVisible(false);
    setIsAvatarCameraModalVisible(true);
  }, [ensureCameraPermissionForAvatar, isAvatarActionBusy]);

  const handleSelectPhotoFromGallery = useCallback(async () => {
    if (isAvatarActionBusy) {
      return;
    }
    triggerSelectionHaptic();

    setIsAvatarActionSheetVisible(false);
    setIsAvatarActionLoading(true);
    try {
      const selection = await pickGalleryMedia('photo');
      if (!selection || selection.mediaUrl.trim().length === 0) {
        return;
      }
      if (selection.mediaType !== 'photo') {
        showToast({
          message: 'Profil fotoğrafı için galeriden bir fotoğraf seçmelisin.',
          title: 'Geçersiz seçim',
          tone: 'warning',
        });
        return;
      }

      setAvatarLocalPreviewUrl(selection.mediaUrl.trim());
      setAvatarImageLoadFailed(false);
      await updateProfileAvatarWithMedia(selection.mediaUrl);
    } catch (error) {
      setAvatarLocalPreviewUrl('');
      const message = resolveAvatarActionErrorMessage(
        error,
        'Galeriden fotoğraf seçilemedi.',
      );
      const lowered = message.toLowerCase();
      if (
        lowered.includes('permission') ||
        lowered.includes('denied') ||
        lowered.includes('restricted') ||
        lowered.includes('izin')
      ) {
        showToast({
          message: 'Galeriden fotoğraf seçmek için gerekli izni vermelisin.',
          title: 'Galeri izni gerekli',
          tone: 'warning',
        });
      } else {
        showToast({
          message,
          title: 'Galeri hatası',
          tone: 'danger',
        });
      }
    } finally {
      setIsAvatarActionLoading(false);
    }
  }, [
    isAvatarActionBusy,
    resolveAvatarActionErrorMessage,
    showToast,
    updateProfileAvatarWithMedia,
  ]);

  const handleRemoveProfilePhoto = useCallback(async () => {
    if (isAvatarActionBusy) {
      return;
    }
    triggerSelectionHaptic();

    if (!isEmailLoginProfile) {
      showToast({
        message:
          'Profil fotoğrafını kaldırma özelliği yalnızca e-posta ile giriş yapan hesaplarda kullanılabilir.',
        title: 'Fotoğraf kaldırılamıyor',
        tone: 'warning',
      });
      return;
    }

    setIsAvatarActionSheetVisible(false);
    setIsAvatarActionLoading(true);
    try {
      const updatedProfile = await updateMyProfile({ avatarUrl: '' });
      onProfileChange(updatedProfile);
      setAvatarLocalPreviewUrl('');
      setAvatarImageLoadFailed(false);
      setEditAvatarUrl(resolveProfileAvatarUrl(updatedProfile));
    } catch (error) {
      showToast({
        message: resolveAvatarActionErrorMessage(
          error,
          'Profil fotoğrafı kaldırılırken bir sorun oluştu.',
        ),
        title: 'Profil fotoğrafı kaldırılamadı',
        tone: 'danger',
      });
    } finally {
      setIsAvatarActionLoading(false);
    }
  }, [
    isAvatarActionBusy,
    isEmailLoginProfile,
    onProfileChange,
    resolveAvatarActionErrorMessage,
    showToast,
  ]);

  const handleDeletePhotoOptionPress = useCallback(() => {
    if (isAvatarActionBusy) {
      return;
    }

    void confirm({
      cancelLabel: 'İptal',
      confirmLabel: 'Fotoğrafı Sil',
      message: 'Profil fotoğrafını kaldırmak istiyor musun?',
      title: 'Fotoğrafı Sil',
      tone: 'danger',
    }).then(accepted => {
      if (!accepted) {
        return;
      }
      handleRemoveProfilePhoto().catch(() => {
        return;
      });
    });
  }, [confirm, handleRemoveProfilePhoto, isAvatarActionBusy]);

  const handleAvatarCameraCapture = useCallback(
    async (payload: {
      capturedAt: string;
      mediaType: 'photo' | 'video';
      mediaUrl: string;
      source?: 'camera' | 'gallery';
      thumbnailUrl?: string;
    }) => {
      if (payload.mediaType !== 'photo') {
        showToast({
          message: 'Profil fotoğrafı için sadece fotoğraf kullanabilirsin.',
          title: 'Geçersiz seçim',
          tone: 'warning',
        });
        return;
      }

      setIsAvatarCameraModalVisible(false);
      setIsAvatarActionLoading(true);
      try {
        setAvatarLocalPreviewUrl(payload.mediaUrl.trim());
        setAvatarImageLoadFailed(false);
        await updateProfileAvatarWithMedia(payload.mediaUrl);
      } catch (error) {
        setAvatarLocalPreviewUrl('');
        showToast({
          message: resolveAvatarActionErrorMessage(
            error,
            'Profil fotoğrafı güncellenirken bir sorun oluştu.',
          ),
          title: 'Profil fotoğrafı güncellenemedi',
          tone: 'danger',
        });
      } finally {
        setIsAvatarActionLoading(false);
      }
    },
    [resolveAvatarActionErrorMessage, showToast, updateProfileAvatarWithMedia],
  );

  useEffect(() => {
    avatarActionSheetTranslateY.stopAnimation();
    avatarActionSheetOpacity.stopAnimation();
    avatarActionSheetBackdropOpacity.stopAnimation();

    let cancelled = false;
    if (isAvatarActionSheetVisible) {
      setIsAvatarActionSheetMounted(true);
      Animated.parallel([
        Animated.timing(avatarActionSheetBackdropOpacity, {
          duration: 210,
          easing: Easing.out(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.spring(avatarActionSheetTranslateY, {
          damping: 19,
          mass: 0.9,
          stiffness: 210,
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.timing(avatarActionSheetOpacity, {
          duration: 180,
          easing: Easing.out(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
      ]).start();
      return () => {
        cancelled = true;
      };
    }

    if (!isAvatarActionSheetMounted) {
      return;
    }

    Animated.parallel([
      Animated.timing(avatarActionSheetBackdropOpacity, {
        duration: 170,
        easing: Easing.in(Easing.quad),
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(avatarActionSheetTranslateY, {
        duration: 180,
        easing: Easing.inOut(Easing.quad),
        toValue: 36,
        useNativeDriver: true,
      }),
      Animated.timing(avatarActionSheetOpacity, {
        duration: 140,
        easing: Easing.in(Easing.quad),
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (
        finished &&
        !cancelled &&
        !isAvatarActionSheetVisible &&
        !isAvatarActionLoading
      ) {
        setIsAvatarActionSheetMounted(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    avatarActionSheetBackdropOpacity,
    avatarActionSheetOpacity,
    avatarActionSheetTranslateY,
    isAvatarActionLoading,
    isAvatarActionSheetMounted,
    isAvatarActionSheetVisible,
  ]);

  useEffect(() => {
    onFollowRequestsCountChangeRef.current = onFollowRequestsCountChange;
  }, [onFollowRequestsCountChange]);

  useEffect(() => {
    onStreetRequestsViewedRef.current = onStreetRequestsViewed;
  }, [onStreetRequestsViewed]);

  // Component mount olduğunda cache'den instant yükle
  useEffect(() => {
    const cached = streetRequestsCacheByProfileId.get(profile.id);
    if (cached && Date.now() - cached.cachedAt < STREET_REQUESTS_CACHE_TTL_MS) {
      setStreetRequests(cached.requests);
    }
  }, [profile.id]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    collectionsRef.current = collections;
    persistCollectionsCache(profile.id, collections);
  }, [collections, profile.id]);

  useEffect(() => {
    setAvatarImageLoadFailed(false);
  }, [effectiveAvatarUrl]);

  useEffect(() => {
    const saved = profileListMemoryByProfileId.get(profile.id);
    listOffsetsByTabRef.current = saved
      ? { ...createInitialProfileOffsets(), ...saved.offsets }
      : createInitialProfileOffsets();
    setActiveTab(saved?.activeTab ?? 'posts');
    const nextCollections = createInitialCollections(profile.id);
    setCollections(nextCollections);
    collectionsRef.current = nextCollections;
    setMediaLoadErrorByPostId({});
    setPendingDeletePostId(null);
    setPendingUpdatePostId(null);
    setEditingPost(null);
    setPostNotice(null);
    suppressNextPostTilePressIdRef.current = null;
    setAvatarLocalPreviewUrl('');
    setAvatarImageLoadFailed(false);
  }, [profile.id]);

  useEffect(() => {
    if (activeCollection.items.length === 0) {
      return;
    }
    const targetOffset = Math.max(
      0,
      listOffsetsByTabRef.current[activeTab] ?? 0,
    );
    if (targetOffset < 2) {
      return;
    }

    if (restoreScrollTimerRef.current) {
      clearTimeout(restoreScrollTimerRef.current);
      restoreScrollTimerRef.current = null;
    }
    restoreScrollTimerRef.current = setTimeout(() => {
      scrollViewRef.current?.scrollTo({ animated: false, y: targetOffset });
      restoreScrollTimerRef.current = null;
    }, 0);

    return () => {
      if (restoreScrollTimerRef.current) {
        clearTimeout(restoreScrollTimerRef.current);
        restoreScrollTimerRef.current = null;
      }
    };
  }, [activeCollection.items.length, activeTab]);

  useEffect(() => {
    return () => {
      persistProfileListMemory();
      if (restoreScrollTimerRef.current) {
        clearTimeout(restoreScrollTimerRef.current);
        restoreScrollTimerRef.current = null;
      }
      if (postNoticeTimerRef.current) {
        clearTimeout(postNoticeTimerRef.current);
        postNoticeTimerRef.current = null;
      }
    };
  }, [persistProfileListMemory]);

  const loadCollection = useCallback(
    async (tab: ProfileTabKey, reason: CollectionLoadReason = 'initial') => {
      const current = collectionsRef.current[tab];
      const isAppend = reason === 'append';
      if (isAppend) {
        if (current.loadingMore || !current.hasNextPage || !current.nextCursor) {
          return;
        }
      } else if (current.initialLoading || current.refreshing) {
        return;
      }

      collectionRequestIdRef.current[tab] += 1;
      const requestId = collectionRequestIdRef.current[tab];
      const cursor = isAppend ? current.nextCursor ?? undefined : undefined;
      collectionAbortControllerRef.current[tab]?.abort();
      const controller = new AbortController();
      collectionAbortControllerRef.current[tab] = controller;

      setCollections(previous => {
        const previousTab = previous[tab];
        let nextTab = previousTab;

        if (isAppend) {
          nextTab = {
            ...previousTab,
            error: null,
            loadingMore: true,
          };
        } else if (reason === 'refresh') {
          nextTab = {
            ...previousTab,
            error: null,
            initialLoading: previousTab.items.length === 0,
            refreshing: previousTab.items.length > 0,
          };
        } else if (reason === 'initial') {
          nextTab = {
            ...previousTab,
            error: null,
            initialLoading: previousTab.items.length === 0,
            refreshing: false,
          };
        } else if (
          previousTab.items.length === 0 &&
          !previousTab.isInitialized
        ) {
          nextTab = {
            ...previousTab,
            error: null,
            initialLoading: true,
          };
        }

        if (nextTab === previousTab) {
          return previous;
        }

        return {
          ...previous,
          [tab]: nextTab,
        };
      });

      try {
        const response =
          tab === 'posts'
            ? await fetchMyProfilePosts({
              cursor,
              limit: PROFILE_PAGE_LIMIT,
              signal: controller.signal,
            })
            : tab === 'liked'
              ? await fetchMyLikedPosts({
                cursor,
                limit: PROFILE_PAGE_LIMIT,
                signal: controller.signal,
              })
              : await fetchMySavedPosts({
                cursor,
                limit: PROFILE_PAGE_LIMIT,
                signal: controller.signal,
              });

        if (
          controller.signal.aborted ||
          collectionRequestIdRef.current[tab] !== requestId
        ) {
          return;
        }

        setCollections(previous => {
          const previousTab = previous[tab];
          const nextItems = isAppend
            ? dedupePosts([...previousTab.items, ...response.posts])
            : response.posts;
          const nextCursor = response.nextCursor ?? null;
          const nextHasNextPage = response.hasMore;
          const nextSignature = buildCollectionSignature(
            nextItems,
            nextHasNextPage,
            nextCursor,
          );
          const nextTimestamp = Date.now();
          const hasDataChanged =
            previousTab.signature !== nextSignature ||
            previousTab.hasNextPage !== nextHasNextPage ||
            previousTab.nextCursor !== nextCursor ||
            previousTab.items.length !== nextItems.length;
          const nextTab: CollectionState = {
            ...previousTab,
            error: null,
            hasNextPage: nextHasNextPage,
            initialLoading: false,
            isInitialized: true,
            items: hasDataChanged ? nextItems : previousTab.items,
            lastUpdatedAt: nextTimestamp,
            loadingMore: false,
            nextCursor,
            refreshing: false,
            signature: hasDataChanged ? nextSignature : previousTab.signature,
          };

          if (
            !hasDataChanged &&
            previousTab.error === null &&
            previousTab.initialLoading === nextTab.initialLoading &&
            previousTab.loadingMore === nextTab.loadingMore &&
            previousTab.refreshing === nextTab.refreshing &&
            previousTab.isInitialized === nextTab.isInitialized
          ) {
            const nextCollections = {
              ...collectionsRef.current,
              [tab]: nextTab,
            };
            collectionsRef.current = nextCollections;
            persistCollectionsCache(profile.id, nextCollections);
            return previous;
          }

          return {
            ...previous,
            [tab]: nextTab,
          };
        });
      } catch (error) {
        if (collectionRequestIdRef.current[tab] !== requestId) {
          return;
        }

        setCollections(previous => ({
          ...previous,
          [tab]: {
            ...previous[tab],
            error: isApiRequestError(error)
              ? normalizeCollectionErrorMessage(error.message)
              : 'Profil içeriği şu anda yüklenemedi.',
            initialLoading: false,
            isInitialized: true,
            loadingMore: false,
            refreshing: false,
          },
        }));
      }
    },
    [profile.id],
  );

  const loadFollowRequests = useCallback(
    async (options?: { force?: boolean; showLoader?: boolean }) => {
      if (!isPrivateAccount) {
        followRequestsAbortControllerRef.current?.abort();
        followRequestsAbortControllerRef.current = null;
        followRequestsInFlightRef.current = false;
        setFollowRequests([]);
        setRequestsError(null);
        setIsLoadingRequests(false);
        onFollowRequestsCountChangeRef.current?.(0);
        return;
      }

      const force = options?.force === true;
      const showLoader = options?.showLoader ?? true;
      const now = Date.now();
      if (
        !force &&
        (followRequestsInFlightRef.current ||
          now - followRequestsLastLoadAtRef.current <
          FOLLOW_REQUESTS_RELOAD_COOLDOWN_MS)
      ) {
        return;
      }

      followRequestsInFlightRef.current = true;
      requestsRequestIdRef.current += 1;
      const requestId = requestsRequestIdRef.current;

      followRequestsAbortControllerRef.current?.abort();
      const requestAbortController = new AbortController();
      followRequestsAbortControllerRef.current = requestAbortController;

      if (showLoader) {
        setIsLoadingRequests(true);
      }
      setRequestsError(null);

      try {
        const response = await fetchFollowRequests({
          force,
          signal: requestAbortController.signal,
        });
        if (
          requestId !== requestsRequestIdRef.current ||
          requestAbortController.signal.aborted
        ) {
          return;
        }

        setFollowRequests(response.requests);
        const visibleRequestCount = response.requests.filter(
          request => !blockedUserIds[request.id],
        ).length;
        onFollowRequestsCountChangeRef.current?.(visibleRequestCount);
        followRequestsLastLoadAtRef.current = Date.now();
      } catch (error) {
        if (
          requestId !== requestsRequestIdRef.current ||
          requestAbortController.signal.aborted
        ) {
          return;
        }

        setRequestsError(
          isApiRequestError(error)
            ? error.message
            : 'Takip istekleri şu an yüklenemedi.',
        );
        onFollowRequestsCountChangeRef.current?.(0);
      } finally {
        if (
          followRequestsAbortControllerRef.current === requestAbortController
        ) {
          followRequestsAbortControllerRef.current = null;
        }
        if (requestId === requestsRequestIdRef.current) {
          if (showLoader) {
            setIsLoadingRequests(false);
          }
          followRequestsInFlightRef.current = false;
        }
      }
    },
    [blockedUserIds, isPrivateAccount],
  );

  const loadStreetRequests = useCallback(
    async (options?: { force?: boolean; showLoader?: boolean }) => {
      const force = options?.force === true;
      const showLoader = options?.showLoader ?? false; // Varsayılan false - loading gösterme
      const now = Date.now();

      // Cache kontrolü
      if (!force) {
        const cached = streetRequestsCacheByProfileId.get(profile.id);
        if (cached && now - cached.cachedAt < STREET_REQUESTS_CACHE_TTL_MS) {
          // Cache'den instant yükle
          setStreetRequests(cached.requests);
          return;
        }
      }

      if (
        !force &&
        (streetRequestsInFlightRef.current ||
          now - streetRequestsLastLoadAtRef.current <
          STREET_REQUESTS_RELOAD_COOLDOWN_MS)
      ) {
        return;
      }

      streetRequestsInFlightRef.current = true;
      streetRequestsRequestIdRef.current += 1;
      const requestId = streetRequestsRequestIdRef.current;

      streetRequestsAbortControllerRef.current?.abort();
      const requestAbortController = new AbortController();
      streetRequestsAbortControllerRef.current = requestAbortController;

      if (showLoader) {
        setIsLoadingStreetRequests(true);
      }
      setStreetRequestsError(null);

      try {
        const response = await fetchStreetFriendRequests({
          force,
          signal: requestAbortController.signal,
        });
        if (
          requestId !== streetRequestsRequestIdRef.current ||
          requestAbortController.signal.aborted
        ) {
          return;
        }

        setStreetRequests(response.requests);


        streetRequestsLastLoadAtRef.current = Date.now();

        // Cache'e kaydet
        streetRequestsCacheByProfileId.set(profile.id, {
          cachedAt: Date.now(),
          requests: response.requests,
        });
      } catch (error) {
        if (
          requestId !== streetRequestsRequestIdRef.current ||
          requestAbortController.signal.aborted
        ) {
          return;
        }

        setStreetRequestsError(
          isApiRequestError(error)
            ? error.message
            : 'Yakındakiler istekleri şu an yüklenemedi.',
        );
      } finally {
        if (
          streetRequestsAbortControllerRef.current === requestAbortController
        ) {
          streetRequestsAbortControllerRef.current = null;
        }
        if (requestId === streetRequestsRequestIdRef.current) {
          if (showLoader) {
            setIsLoadingStreetRequests(false);
          }
          streetRequestsInFlightRef.current = false;
        }
      }
    },
    [profile.id],
  );

  const loadBlockedUsers = useCallback(async () => {
    blockedUsersRequestIdRef.current += 1;
    const requestId = blockedUsersRequestIdRef.current;
    try {
      const response = await fetchBlockedUsers();
      if (requestId !== blockedUsersRequestIdRef.current) {
        return;
      }
      const nextBlockedIds: Record<string, true> = {};
      response.users.forEach(user => {
        const userId = user.id.trim();
        if (userId.length > 0) {
          nextBlockedIds[userId] = true;
        }
      });
      setBlockedUserIds(nextBlockedIds);
    } catch {
      if (requestId !== blockedUsersRequestIdRef.current) {
        return;
      }
      setBlockedUserIds({});
    }
  }, []);

  const scheduleRealtimeFollowRequestsRefresh = useCallback(
    (payload?: { delta?: number; requesterId?: string }) => {
      if (typeof payload?.delta === 'number') {
        const requesterId = payload.requesterId?.trim() ?? '';
        if (payload.delta < 0 && requesterId.length > 0) {
          setFollowRequests(previous =>
            previous.filter(request => request.id !== requesterId),
          );
          return;
        }
        if (payload.delta === 0) {
          return;
        }
      }
      if (realtimeFollowRefreshTimerRef.current) {
        clearTimeout(realtimeFollowRefreshTimerRef.current);
      }
      realtimeFollowRefreshTimerRef.current = setTimeout(() => {
        realtimeFollowRefreshTimerRef.current = null;
        void loadFollowRequests({ force: true, showLoader: false });
      }, REALTIME_REQUEST_REFRESH_DEBOUNCE_MS);
    },
    [loadFollowRequests],
  );

  const scheduleRealtimeStreetRequestsRefresh = useCallback(
    (payload?: { delta?: number; requesterId?: string }) => {
      if (typeof payload?.delta === 'number') {
        const requesterId = payload.requesterId?.trim() ?? '';
        if (payload.delta < 0 && requesterId.length > 0) {
          setStreetRequests(previous =>
            previous.filter(request => request.id !== requesterId),
          );
          return;
        }
        if (payload.delta === 0) {
          return;
        }
      }
      if (realtimeStreetRefreshTimerRef.current) {
        clearTimeout(realtimeStreetRefreshTimerRef.current);
      }
      realtimeStreetRefreshTimerRef.current = setTimeout(() => {
        realtimeStreetRefreshTimerRef.current = null;
        void loadStreetRequests({ force: true, showLoader: false });
      }, REALTIME_REQUEST_REFRESH_DEBOUNCE_MS);
    },
    [loadStreetRequests],
  );

  useEffect(() => {
    const unsubFollow = subscribeRealtimeFollowRequest(
      scheduleRealtimeFollowRequestsRefresh,
    );
    const unsubStreet = subscribeRealtimeStreetRequest(
      scheduleRealtimeStreetRequestsRefresh,
    );
    return () => {
      unsubFollow();
      unsubStreet();
    };
  }, [scheduleRealtimeFollowRequestsRefresh, scheduleRealtimeStreetRequestsRefresh]);

  const loadFollowers = useCallback(
    async (options?: { force?: boolean; showLoader?: boolean }) => {
      const force = options?.force === true;
      const showLoader = options?.showLoader ?? true;
      const now = Date.now();
      if (
        !force &&
        (followersInFlightRef.current ||
          now - followersLastLoadAtRef.current < RELATION_LIST_RELOAD_COOLDOWN_MS)
      ) {
        return;
      }

      followersInFlightRef.current = true;
      followersRequestIdRef.current += 1;
      const requestId = followersRequestIdRef.current;

      followersAbortControllerRef.current?.abort();
      const requestAbortController = new AbortController();
      followersAbortControllerRef.current = requestAbortController;

      if (showLoader) {
        setIsLoadingFollowers(true);
      }
      setFollowersError(null);

      try {
        const response = await fetchFollowers({
          force,
          signal: requestAbortController.signal,
        });
        if (
          requestId !== followersRequestIdRef.current ||
          requestAbortController.signal.aborted
        ) {
          return;
        }

        setFollowers(response.users);
        followersLastLoadAtRef.current = Date.now();
      } catch (error) {
        if (
          requestId !== followersRequestIdRef.current ||
          requestAbortController.signal.aborted
        ) {
          return;
        }

        setFollowersError(
          isApiRequestError(error)
            ? error.message
            : 'Takipçiler şu an yüklenemedi.',
        );
      } finally {
        if (followersAbortControllerRef.current === requestAbortController) {
          followersAbortControllerRef.current = null;
        }
        if (requestId === followersRequestIdRef.current) {
          followersInFlightRef.current = false;
          if (showLoader) {
            setIsLoadingFollowers(false);
          }
        }
      }
    },
    [],
  );

  const loadFollowing = useCallback(
    async (options?: { force?: boolean; showLoader?: boolean }) => {
      const force = options?.force === true;
      const showLoader = options?.showLoader ?? true;
      const now = Date.now();
      if (
        !force &&
        (followingInFlightRef.current ||
          now - followingLastLoadAtRef.current < RELATION_LIST_RELOAD_COOLDOWN_MS)
      ) {
        return;
      }

      followingInFlightRef.current = true;
      followingRequestIdRef.current += 1;
      const requestId = followingRequestIdRef.current;

      followingAbortControllerRef.current?.abort();
      const requestAbortController = new AbortController();
      followingAbortControllerRef.current = requestAbortController;

      if (showLoader) {
        setIsLoadingFollowing(true);
      }
      setFollowingError(null);

      try {
        const response = await fetchFollowing({
          force,
          signal: requestAbortController.signal,
        });
        if (
          requestId !== followingRequestIdRef.current ||
          requestAbortController.signal.aborted
        ) {
          return;
        }

        setFollowing(response.users);
        followingLastLoadAtRef.current = Date.now();
      } catch (error) {
        if (
          requestId !== followingRequestIdRef.current ||
          requestAbortController.signal.aborted
        ) {
          return;
        }

        setFollowingError(
          isApiRequestError(error)
            ? error.message
            : 'Takip listesi şu an yüklenemedi.',
        );
      } finally {
        if (followingAbortControllerRef.current === requestAbortController) {
          followingAbortControllerRef.current = null;
        }
        if (requestId === followingRequestIdRef.current) {
          followingInFlightRef.current = false;
          if (showLoader) {
            setIsLoadingFollowing(false);
          }
        }
      }
    },
    [],
  );

  const loadStreetFriends = useCallback(
    async (options?: { force?: boolean; showLoader?: boolean }) => {
      const force = options?.force === true;
      const showLoader = options?.showLoader ?? true;
      const now = Date.now();
      if (
        !force &&
        (streetFriendsInFlightRef.current ||
          now - streetFriendsLastLoadAtRef.current <
          RELATION_LIST_RELOAD_COOLDOWN_MS)
      ) {
        return;
      }

      streetFriendsInFlightRef.current = true;
      streetFriendsRequestIdRef.current += 1;
      const requestId = streetFriendsRequestIdRef.current;

      streetFriendsAbortControllerRef.current?.abort();
      const requestAbortController = new AbortController();
      streetFriendsAbortControllerRef.current = requestAbortController;

      if (showLoader) {
        setIsLoadingStreetFriends(true);
      }
      setStreetFriendsError(null);

      try {
        const response = await fetchStreetFriends({
          force,
          signal: requestAbortController.signal,
        });
        if (
          requestId !== streetFriendsRequestIdRef.current ||
          requestAbortController.signal.aborted
        ) {
          return;
        }

        setStreetFriends(response.friends);
        streetFriendsLastLoadAtRef.current = Date.now();
      } catch (error) {
        if (
          requestId !== streetFriendsRequestIdRef.current ||
          requestAbortController.signal.aborted
        ) {
          return;
        }

        setStreetFriendsError(
          isApiRequestError(error)
            ? error.message
            : 'Yakındakiler şu an yüklenemedi.',
        );
      } finally {
        if (streetFriendsAbortControllerRef.current === requestAbortController) {
          streetFriendsAbortControllerRef.current = null;
        }
        if (requestId === streetFriendsRequestIdRef.current) {
          streetFriendsInFlightRef.current = false;
          if (showLoader) {
            setIsLoadingStreetFriends(false);
          }
        }
      }
    },
    [],
  );

  const updateProfileStats = useCallback(
    (next: Partial<UserProfile['stats']>) => {
      onProfileChange({
        ...profile,
        stats: {
          ...profile.stats,
          ...next,
        },
      });
    },
    [onProfileChange, profile],
  );

  const updateFollowersItem = useCallback(
    (
      userId: string,
      updater: (user: ExploreSearchUser) => ExploreSearchUser,
    ) => {
      setFollowers(previous =>
        previous.map(item => (item.id === userId ? updater(item) : item)),
      );
    },
    [],
  );

  const updateFollowingItem = useCallback(
    (
      userId: string,
      updater: (user: ExploreSearchUser) => ExploreSearchUser,
    ) => {
      setFollowing(previous =>
        previous.map(item => (item.id === userId ? updater(item) : item)),
      );
    },
    [],
  );

  useEffect(() => {
    const bootstrapKey = `${profile.id}:${isPrivateAccount ? 'private' : 'public'
      }`;
    if (profileBootstrapKeyRef.current === bootstrapKey) {
      return;
    }
    profileBootstrapKeyRef.current = bootstrapKey;

    const next = createInitialCollections();
    setCollections(next);
    collectionsRef.current = next;
    setActiveTab('posts');
    // Street requests cache'den yüklenecek, sıfırlamıyoruz
    // setStreetRequests([]);
    collectionRequestIdRef.current = { liked: 0, posts: 0, saved: 0 };

    loadCollection('posts', 'initial').catch(() => {
      return;
    });
    loadCollection('liked', 'silent').catch(() => {
      return;
    });
    loadCollection('saved', 'silent').catch(() => {
      return;
    });
    loadBlockedUsers().catch(() => {
      return;
    });
    loadStreetRequests({ force: true, showLoader: false }).catch(() => {
      return;
    });
    if (isPrivateAccount) {
      loadFollowRequests({ force: true, showLoader: true }).catch(() => {
        return;
      });
      return;
    }

    setFollowRequests([]);
    setIsLoadingRequests(false);
    setRequestsError(null);
    onFollowRequestsCountChangeRef.current?.(0);
  }, [
    isPrivateAccount,
    loadBlockedUsers,
    loadCollection,
    loadFollowRequests,
    loadStreetRequests,
    profile.id,
  ]);

  useEffect(() => {
    const current = collections[activeTab];
    if (current.isInitialized || current.initialLoading || current.refreshing) {
      return;
    }

    loadCollection(activeTab, 'initial').catch(() => {
      return;
    });
  }, [activeTab, collections, loadCollection]);

  useEffect(() => {
    return subscribeProfilePostCreated(createdPost => {
      if (createdPost.userId !== profile.id) {
        return;
      }

      setActiveTab('posts');
      setMediaLoadErrorByPostId(previous => {
        if (!previous[createdPost.id]) {
          return previous;
        }
        const next = { ...previous };
        delete next[createdPost.id];
        return next;
      });
      setCollections(previous => ({
        ...previous,
        posts: {
          ...previous.posts,
          error: null,
          isInitialized: true,
          items: dedupePosts([createdPost, ...previous.posts.items]),
        },
      }));
      loadCollection('posts', 'silent').catch(() => {
        return;
      });
    });
  }, [loadCollection, profile.id]);

  useEffect(() => {
    onFollowRequestsCountChange?.(isPrivateAccount ? effectiveFollowRequestsCount : 0);
  }, [effectiveFollowRequestsCount, isPrivateAccount, onFollowRequestsCountChange]);

  useEffect(() => {
    onStreetRequestsCountChange?.(effectiveStreetIncomingRequestsCount);
  }, [effectiveStreetIncomingRequestsCount, onStreetRequestsCountChange]);

  useEffect(() => {
    const normalizedCount = Number.isFinite(followRequestsBadgeCount)
      ? Math.max(0, Math.floor(followRequestsBadgeCount))
      : 0;
    const previousCount = lastFollowRequestsBadgeCountRef.current;
    lastFollowRequestsBadgeCountRef.current = normalizedCount;

    if (!isPrivateAccount || normalizedCount <= 0) {
      return;
    }

    if (
      normalizedCount > previousCount ||
      normalizedCount > visibleFollowRequests.length
    ) {
      loadFollowRequests({ force: true, showLoader: false }).catch(() => {
        return;
      });
    }
  }, [
    visibleFollowRequests.length,
    followRequestsBadgeCount,
    isPrivateAccount,
    loadFollowRequests,
  ]);

  useEffect(() => {
    const normalizedCount = Number.isFinite(streetRequestsBadgeCount)
      ? Math.max(0, Math.floor(streetRequestsBadgeCount))
      : 0;
    const previousCount = lastStreetRequestsBadgeCountRef.current;
    lastStreetRequestsBadgeCountRef.current = normalizedCount;

    if (normalizedCount <= 0) {
      return;
    }

    if (
      normalizedCount > previousCount ||
      normalizedCount > streetIncomingRequestsCount
    ) {
      streetRequestsCacheByProfileId.delete(profile.id);
      loadStreetRequests({ force: true, showLoader: false }).catch(() => {
        return;
      });
    }
  }, [
    loadStreetRequests,
    profile.id,
    streetIncomingRequestsCount,
    streetRequestsBadgeCount,
  ]);

  useEffect(() => {
    const normalizedCount = Number.isFinite(streetRequestsBadgeCount)
      ? Math.max(0, Math.floor(streetRequestsBadgeCount))
      : 0;
    const missingCount = Math.max(0, normalizedCount - streetIncomingRequestsCount);
    if (missingCount <= 0) {
      streetRequestsCatchupAttemptsRef.current = 0;
      if (streetRequestsCatchupTimerRef.current) {
        clearTimeout(streetRequestsCatchupTimerRef.current);
        streetRequestsCatchupTimerRef.current = null;
      }
      return;
    }

    if (streetRequestsCatchupAttemptsRef.current === 0) {
      streetRequestsCatchupAttemptsRef.current = 1;
      streetRequestsCacheByProfileId.delete(profile.id);
      loadStreetRequests({ force: true, showLoader: false }).catch(() => {
        return;
      });
    }

    if (streetRequestsCatchupAttemptsRef.current >= 8) {
      return;
    }

    if (streetRequestsCatchupTimerRef.current) {
      clearTimeout(streetRequestsCatchupTimerRef.current);
    }

    streetRequestsCatchupTimerRef.current = setTimeout(() => {
      streetRequestsCatchupTimerRef.current = null;
      streetRequestsCatchupAttemptsRef.current += 1;
      streetRequestsCacheByProfileId.delete(profile.id);
      loadStreetRequests({ force: true, showLoader: false }).catch(() => {
        return;
      });
    }, 360);

    return () => {
      if (streetRequestsCatchupTimerRef.current) {
        clearTimeout(streetRequestsCatchupTimerRef.current);
        streetRequestsCatchupTimerRef.current = null;
      }
    };
  }, [loadStreetRequests, profile.id, streetIncomingRequestsCount, streetRequestsBadgeCount]);

  useEffect(() => {
    if (!isStreetRequestsModalVisible) {
      return;
    }
    onStreetRequestsViewedRef.current?.(streetIncomingRequestsCount);
  }, [isStreetRequestsModalVisible, streetIncomingRequestsCount]);

  useEffect(() => {
    if (isPrivateAccount) {
      return;
    }
    setIsRequestsModalVisible(false);
  }, [isPrivateAccount]);

  useEffect(() => {
    if (isRequestsModalVisible) {
      return;
    }
    followRequestsAbortControllerRef.current?.abort();
    followRequestsAbortControllerRef.current = null;
    followRequestsInFlightRef.current = false;
    setIsLoadingRequests(false);
  }, [isRequestsModalVisible]);

  useEffect(() => {
    if (isStreetRequestsModalVisible) {
      return;
    }
    streetRequestsAbortControllerRef.current?.abort();
    streetRequestsAbortControllerRef.current = null;
    streetRequestsInFlightRef.current = false;
    setIsLoadingStreetRequests(false);
  }, [isStreetRequestsModalVisible]);

  useEffect(() => {
    if (isFollowersModalVisible) {
      return;
    }
    followersAbortControllerRef.current?.abort();
    followersInFlightRef.current = false;
    setIsLoadingFollowers(false);
  }, [isFollowersModalVisible]);

  useEffect(() => {
    if (isFollowingModalVisible) {
      return;
    }
    followingAbortControllerRef.current?.abort();
    followingInFlightRef.current = false;
    setIsLoadingFollowing(false);
  }, [isFollowingModalVisible]);

  useEffect(() => {
    if (isStreetFriendsModalVisible) {
      return;
    }
    streetFriendsAbortControllerRef.current?.abort();
    streetFriendsInFlightRef.current = false;
    setIsLoadingStreetFriends(false);
  }, [isStreetFriendsModalVisible]);

  useEffect(() => {
    if (!isProfileScreenFocused) {
      return;
    }

    let active = true;
    let appState: AppStateStatus = profileAppStateRef.current;

    const syncVisibleRelationLists = () => {
      if (!active || !isProfileScreenFocused || appState !== 'active') {
        return;
      }

      if (isFollowersModalVisible && !followersInFlightRef.current) {
        loadFollowers({ force: true, showLoader: false }).catch(() => {
          return;
        });
      }
      if (isFollowingModalVisible && !followingInFlightRef.current) {
        loadFollowing({ force: true, showLoader: false }).catch(() => {
          return;
        });
      }
      if (isStreetFriendsModalVisible && !streetFriendsInFlightRef.current) {
        loadStreetFriends({ force: true, showLoader: false }).catch(() => {
          return;
        });
      }
    };

    const appStateSubscription = AppState.addEventListener('change', nextState => {
      const becameActive =
        (appState === 'background' || appState === 'inactive') &&
        nextState === 'active';
      appState = nextState;
      if (becameActive) {
        syncVisibleRelationLists();
      }
    });

    return () => {
      active = false;
      appStateSubscription.remove();
    };
  }, [
    isFollowersModalVisible,
    isFollowingModalVisible,
    isProfileScreenFocused,
    isStreetFriendsModalVisible,
    loadFollowers,
    loadFollowing,
    loadStreetFriends,
  ]);

  useEffect(() => {
    if (!isProfileScreenFocused) {
      return;
    }

    let active = true;
    let appState: AppStateStatus = profileAppStateRef.current;

    const syncVisibleRequestLists = () => {
      if (!active || !isProfileScreenFocused || appState !== 'active') {
        return;
      }

      if (
        isPrivateAccount &&
        isRequestsModalVisible &&
        !followRequestsInFlightRef.current
      ) {
        loadFollowRequests({ force: true, showLoader: false }).catch(() => {
          return;
        });
      }

      if (
        isStreetRequestsModalVisible &&
        !streetRequestsInFlightRef.current
      ) {
        loadStreetRequests({ force: true, showLoader: false }).catch(() => {
          return;
        });
      }
    };

    const appStateSubscription = AppState.addEventListener('change', nextState => {
      const becameActive =
        (appState === 'background' || appState === 'inactive') &&
        nextState === 'active';
      appState = nextState;
      if (becameActive) {
        syncVisibleRequestLists();
      }
    });

    return () => {
      active = false;
      appStateSubscription.remove();
    };
  }, [
    isPrivateAccount,
    isProfileScreenFocused,
    isRequestsModalVisible,
    isStreetRequestsModalVisible,
    loadFollowRequests,
    loadStreetRequests,
  ]);

  const openEditModal = useCallback(() => {
    const parsedName = splitNameParts(profile.fullName);
    setEditError(null);
    setEditFirstName(parsedName.firstName);
    setEditLastName(parsedName.lastName);
    setEditUsername(profile.username.trim().replace(/^@+/, '').toLowerCase());
    setEditUsernameStatus('idle');
    setEditUsernameStatusMessage(null);
    setEditBirthDate(profileCanonicalBirthDateDisplay(profile.birthYear));
    setEditBio(profile.bio);
    setEditAvatarUrl(avatarUrl);
    const storedDial = String(profile.phoneDialCode ?? '90')
      .replace(/\D/g, '')
      .slice(0, 4);
    setEditPhoneDialCode(storedDial.length > 0 ? storedDial : '90');
    const maxNat = Math.min(
      14,
      Math.max(4, 15 - (storedDial.length > 0 ? storedDial : '90').length),
    );
    const storedPhone = String(profile.phone ?? '')
      .replace(/\D/g, '')
      .slice(0, maxNat);
    setEditPhoneDigits(storedPhone);
    editConfirmScale.setValue(1);
    editAvatarScale.setValue(1);
    setEditGender('prefer_not_to_say');
    setEditGenderBaseline('prefer_not_to_say');
    fetchProfileAppSettings()
      .then(settings => {
        setEditGender(settings.gender);
        setEditGenderBaseline(settings.gender);
      })
      .catch(() => {
        setEditGender('prefer_not_to_say');
        setEditGenderBaseline('prefer_not_to_say');
      });
    setIsEditModalVisible(true);
  }, [
    avatarUrl,
    editAvatarScale,
    editConfirmScale,
    profile.bio,
    profile.birthYear,
    profile.fullName,
    profile.username,
    profile.phone,
    profile.phoneDialCode,
  ]);

  const isEditFormDirty = useMemo(() => {
    if (!isEditModalVisible) {
      return false;
    }
    const fullName = `${editFirstName.trim()} ${editLastName.trim()}`
      .trim()
      .replace(/\s+/g, ' ');
    const normalizedEditUsername = editUsername
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    const normalizedCurrentName = profile.fullName.trim().replace(/\s+/g, ' ');
    const normalizedCurrentUsername = profile.username
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    const trimmedBio = editBio.trim().replace(/\s+/g, ' ');
    const normalizedCurrentBio = profile.bio.trim().replace(/\s+/g, ' ');
    if (fullName !== normalizedCurrentName) {
      return true;
    }
    if (
      profile.authProvider === 'local' &&
      normalizedEditUsername !== normalizedCurrentUsername
    ) {
      return true;
    }
    if (trimmedBio !== normalizedCurrentBio) {
      return true;
    }
    if (editGender !== editGenderBaseline) {
      return true;
    }
    const dialDigits = editPhoneDialCode.replace(/\D/g, '').slice(0, 4) || '90';
    const maxNat = Math.min(14, Math.max(4, 15 - dialDigits.length));
    const phoneDigits = editPhoneDigits.replace(/\D/g, '').slice(0, maxNat);
    const profileDial =
      String(profile.phoneDialCode ?? '90')
        .replace(/\D/g, '')
        .slice(0, 4) || '90';
    const profileMaxNat = Math.min(14, Math.max(4, 15 - profileDial.length));
    const profilePhone = String(profile.phone ?? '')
      .replace(/\D/g, '')
      .slice(0, profileMaxNat);
    if (phoneDigits !== profilePhone || dialDigits !== profileDial) {
      return true;
    }
    const canonicalBirth = profileCanonicalBirthDateDisplay(profile.birthYear);
    return editBirthDate.trim() !== canonicalBirth;
  }, [
    isEditModalVisible,
    editFirstName,
    editLastName,
    editUsername,
    editBio,
    editGender,
    editGenderBaseline,
    editPhoneDigits,
    editPhoneDialCode,
    editBirthDate,
    profile.fullName,
    profile.username,
    profile.authProvider,
    profile.bio,
    profile.phone,
    profile.phoneDialCode,
    profile.birthYear,
  ]);

  useEffect(() => {
    if (!isEditModalVisible || profile.authProvider !== 'local') {
      setEditUsernameStatus('idle');
      setEditUsernameStatusMessage(null);
      return;
    }

    const normalizedCurrent = profile.username
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    const normalizedCandidate = editUsername.trim().replace(/^@+/, '').toLowerCase();

    if (normalizedCandidate === normalizedCurrent) {
      setEditUsernameStatus('idle');
      setEditUsernameStatusMessage('Mevcut kullanıcı adın.');
      return;
    }

    if (
      normalizedCandidate.length < 3 ||
      normalizedCandidate.length > 20 ||
      !/^[a-z0-9]+$/.test(normalizedCandidate)
    ) {
      setEditUsernameStatus('idle');
      setEditUsernameStatusMessage(
        'Kullanıcı adı 3-20 karakter olmalı ve yalnızca harf/rakam içermeli.',
      );
      return;
    }

    setEditUsernameStatus('loading');
    setEditUsernameStatusMessage('Kullanıcı adı kontrol ediliyor...');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      checkUsernameAvailability(normalizedCandidate, { signal: controller.signal })
        .then(response => {
          setEditUsernameStatus(response.available ? 'available' : 'taken');
          setEditUsernameStatusMessage(
            response.available ? 'Kullanılabilir.' : 'Bu kullanıcı adı alınmış.',
          );
        })
        .catch(error => {
          if (controller.signal.aborted) {
            return;
          }
          setEditUsernameStatus('error');
          setEditUsernameStatusMessage(
            isApiRequestError(error)
              ? error.message
              : 'Kullanıcı adı şu an kontrol edilemedi.',
          );
        });
    }, USERNAME_CHECK_DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [editUsername, isEditModalVisible, profile.authProvider, profile.username]);

  useEffect(() => {
    if (!openEditRequestId) {
      lastHandledOpenEditRequestIdRef.current = 0;
      return;
    }
    if (openEditRequestId === lastHandledOpenEditRequestIdRef.current) {
      return;
    }
    lastHandledOpenEditRequestIdRef.current = openEditRequestId;
    openEditModal();
    onOpenEditRequestConsumed?.();
  }, [openEditRequestId, openEditModal, onOpenEditRequestConsumed]);

  async function handleSaveProfileEdit() {
    if (isSavingEdit) {
      return;
    }

    const fullName = `${editFirstName.trim()} ${editLastName.trim()}`
      .trim()
      .replace(/\s+/g, ' ');
    const normalizedUsername = editUsername
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    const trimmedBio = editBio.trim().replace(/\s+/g, ' ');
    const trimmedCity = profile.city.trim().replace(/\s+/g, ' ');
    const birthTrim = editBirthDate.trim();
    const currentYear = new Date().getFullYear();

    if (fullName.length === 0) {
      setEditError('Ad alani bos birakilamaz.');
      return;
    }
    if (profile.authProvider === 'local') {
      if (normalizedUsername.length < 3 || normalizedUsername.length > 20) {
        setEditError('Kullanıcı adı 3-20 karakter arasında olmalı.');
        return;
      }
      if (!/^[a-z0-9]+$/.test(normalizedUsername)) {
        setEditError('Kullanıcı adı yalnızca harf ve rakam içerebilir.');
        return;
      }
    }

    let nextBirthYear = 0;
    if (birthTrim.length > 0) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthTrim);
      if (!m) {
        setEditError('Dogum tarihi YYYY-AA-GG formatinda olmali.');
        return;
      }
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const d = Number(m[3]);
      const dt = new Date(y, mo, d, 12, 0, 0, 0);
      if (
        dt.getFullYear() !== y ||
        dt.getMonth() !== mo ||
        dt.getDate() !== d
      ) {
        setEditError('Gecersiz dogum tarihi.');
        return;
      }
      if (y < 1900 || y > currentYear) {
        setEditError(`Dogum yili 1900-${currentYear} arasinda olmali.`);
        return;
      }
      nextBirthYear = y;
    }

    if (trimmedBio.length > PROFILE_EDIT_BIO_MAX_LENGTH) {
      setEditError(
        `Bio en fazla ${PROFILE_EDIT_BIO_MAX_LENGTH} karakter olabilir.`,
      );
      return;
    }
    if (trimmedCity.length > PROFILE_EDIT_CITY_MAX_LENGTH) {
      setEditError(
        `Şehir en fazla ${PROFILE_EDIT_CITY_MAX_LENGTH} karakter olabilir.`,
      );
      return;
    }

    const dialDigits = editPhoneDialCode.replace(/\D/g, '').slice(0, 4) || '90';
    const maxNat = Math.min(14, Math.max(4, 15 - dialDigits.length));
    const phoneDigits = editPhoneDigits.replace(/\D/g, '').slice(0, maxNat);
    const profileDial =
      String(profile.phoneDialCode ?? '90')
        .replace(/\D/g, '')
        .slice(0, 4) || '90';
    const profileMaxNat = Math.min(14, Math.max(4, 15 - profileDial.length));
    const profilePhone = String(profile.phone ?? '')
      .replace(/\D/g, '')
      .slice(0, profileMaxNat);
    if (dialDigits.length < 1 || dialDigits.length > 4) {
      setEditError('Ulke kodu gecersiz.');
      return;
    }
    if (phoneDigits.length > 0) {
      if (phoneDigits.length < 4) {
        setEditError('Telefon numarasi cok kisa.');
        return;
      }
      if (dialDigits.length + phoneDigits.length > 15) {
        setEditError('Telefon numarasi cok uzun.');
        return;
      }
      if (dialDigits === '90') {
        if (phoneDigits.length !== 10 || !/^5\d{9}$/.test(phoneDigits)) {
          setEditError('Turkiye cep numarasi 10 hane ve 5 ile baslamali.');
          return;
        }
      }
    }

    const normalizedCurrentName = profile.fullName.trim().replace(/\s+/g, ' ');
    const normalizedCurrentUsername = profile.username
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    const usernameChanged =
      profile.authProvider === 'local' &&
      normalizedUsername !== normalizedCurrentUsername;
    if (usernameChanged) {
      if (editUsernameStatus === 'loading') {
        setEditError('Kullanıcı adı kontrolü tamamlanmadan kaydedemezsin.');
        return;
      }
      if (editUsernameStatus === 'taken') {
        setEditError(editUsernameStatusMessage || 'Bu kullanıcı adı alınmış.');
        return;
      }
      if (editUsernameStatus === 'error') {
        setEditError(
          editUsernameStatusMessage || 'Kullanıcı adı kontrolünde hata oluştu.',
        );
        return;
      }
    }
    const normalizedCurrentBio = profile.bio.trim().replace(/\s+/g, ' ');
    const normalizedCurrentCity = profile.city.trim().replace(/\s+/g, ' ');
    const genderChanged = editGender !== editGenderBaseline;
    const phoneChanged =
      phoneDigits !== profilePhone || dialDigits !== profileDial;
    const profileFieldsChanged =
      fullName !== normalizedCurrentName ||
      usernameChanged ||
      trimmedBio !== normalizedCurrentBio ||
      trimmedCity !== normalizedCurrentCity ||
      nextBirthYear !== profile.birthYear ||
      phoneChanged;

    if (!profileFieldsChanged && !genderChanged) {
      setEditError(null);
      setIsEditModalVisible(false);
      return;
    }

    setIsSavingEdit(true);
    setEditError(null);

    try {
      if (genderChanged) {
        await updateProfileAppSettings({ gender: editGender });
        setEditGenderBaseline(editGender);
      }
      if (profileFieldsChanged) {
        const updatedProfile = await updateMyProfile({
          bio: trimmedBio,
          birthYear: nextBirthYear,
          city: trimmedCity,
          favoriteCar: profile.favoriteCar,
          fullName,
          heroTagline: profile.heroTagline,
          phone: phoneDigits,
          phoneDialCode: dialDigits,
          username:
            profile.authProvider === 'local' ? normalizedUsername : undefined,
        });
        onProfileChange(updatedProfile);
      }
      setIsEditModalVisible(false);
    } catch (error) {
      setEditError(
        isApiRequestError(error)
          ? error.message
          : 'Profil degisiklikleri kaydedilemedi.',
      );
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleFollowRequestDecision(
    requesterId: string,
    accept: boolean,
  ) {
    if (pendingFollowRequestId || requesterId.trim().length === 0) {
      return;
    }

    setPendingFollowRequestId(requesterId);
    setRequestsError(null);

    try {
      if (accept) {
        await acceptFollowRequest(requesterId);
      } else {
        await rejectFollowRequest(requesterId);
      }

      setFollowRequests(previous =>
        previous.filter(item => item.id !== requesterId),
      );

      if (accept) {
        updateProfileStats({
          followersCount: Math.max(0, profile.stats.followersCount + 1),
        });
        // Keep counters exact with backend commit immediately after optimistic bump.
        fetchMyProfile()
          .then(nextProfile => {
            onProfileChange(nextProfile);
          })
          .catch(() => {
            return;
          });
      }
    } catch (error) {
      setRequestsError(
        isApiRequestError(error)
          ? error.message
          : 'Takip isteği işlemi tamamlanamadı.',
      );
    } finally {
      setPendingFollowRequestId(null);
    }
  }

  function openFollowRequestsModal() {
    if (!isPrivateAccount) {
      return;
    }
    setIsRequestsModalVisible(true);
    const now = Date.now();
    const shouldForceRefresh =
      now - lastFollowRequestsModalRefreshAtRef.current >
      REQUEST_MODAL_FORCE_REFRESH_INTERVAL_MS;
    lastFollowRequestsModalRefreshAtRef.current = now;
    loadBlockedUsers().catch(() => {
      return;
    });
    loadFollowRequests({
      force: shouldForceRefresh,
      showLoader: visibleFollowRequests.length === 0,
    }).catch(() => {
      return;
    });
  }

  function openStreetRequestsModal() {
    setIsStreetRequestsModalVisible(true);
    onStreetRequestsViewedRef.current?.(streetIncomingRequestsCount);
    const now = Date.now();
    const shouldForceRefresh =
      now - lastStreetRequestsModalRefreshAtRef.current >
      REQUEST_MODAL_FORCE_REFRESH_INTERVAL_MS;
    lastStreetRequestsModalRefreshAtRef.current = now;
    loadBlockedUsers().catch(() => {
      return;
    });
    if (shouldForceRefresh) {
      streetRequestsCacheByProfileId.delete(profile.id);
    }
    loadStreetRequests({
      force: shouldForceRefresh,
      showLoader: streetIncomingRequests.length === 0,
    }).catch(() => {
      return;
    });
  }

  function openFollowersModal() {
    setIsFollowersModalVisible(true);
    loadFollowers({ force: false, showLoader: true }).catch(() => {
      return;
    });
  }

  function openFollowingModal() {
    setIsFollowingModalVisible(true);
    loadFollowing({ force: false, showLoader: true }).catch(() => {
      return;
    });
  }

  function openStreetFriendsModal() {
    setIsStreetFriendsModalVisible(true);
    loadStreetFriends({ force: false, showLoader: true }).catch(() => {
      return;
    });
  }

  const closeRelationModals = useCallback(() => {
    setIsRequestsModalVisible(false);
    setIsStreetRequestsModalVisible(false);
    setIsFollowersModalVisible(false);
    setIsFollowingModalVisible(false);
    setIsStreetFriendsModalVisible(false);
  }, []);

  const buildSearchUserFromStreetFriend = useCallback(
    (friend: ExploreStreetFriendListItem): ExploreSearchUser => {
      const normalizedUsername =
        friend.username.trim().length > 0
          ? friend.username.trim()
          : 'kullanici';
      return {
        avatarUrl: friend.avatarUrl,
        fullName: friend.fullName,
        id: friend.id,
        isPrivateAccount: false,
        isVerified: friend.isVerified,
        username: normalizedUsername,
        viewerState: {
          followRequestStatus: 'none',
          followsYou: true,
          isFollowing: true,
          isStreetFriend: true,
          streetFriendStatus: 'accepted',
        },
      };
    },
    [],
  );

  const buildSearchUserFromStreetRequest = useCallback(
    (request: ExploreStreetFriendRequestItem): ExploreSearchUser => {
      const normalizedUsername =
        request.username.trim().length > 0
          ? request.username.trim()
          : 'kullanici';
      const normalizedStreetStatus =
        request.streetFriendStatus === 'pending_incoming' ||
          request.streetFriendStatus === 'pending_outgoing'
          ? request.streetFriendStatus
          : 'none';
      return {
        avatarUrl:
          request.avatarUrl.trim().length > 0 ? request.avatarUrl : FALLBACK_AVATAR,
        fullName: request.fullName,
        id: request.id,
        isPrivateAccount: false,
        isVerified: request.isVerified,
        username: normalizedUsername,
        viewerState: {
          followRequestStatus: 'none',
          followsYou: false,
          isFollowing: false,
          isStreetFriend: false,
          streetFriendStatus: normalizedStreetStatus,
        },
      };
    },
    [],
  );

  const buildSearchUserFromFollowRequest = useCallback(
    (request: FollowRequestItem): ExploreSearchUser => {
      const normalizedUsername =
        request.username.trim().length > 0 ? request.username.trim() : 'kullanici';
      const relatedStreetRequest = streetRequests.find(
        item => item.id === request.id,
      );
      const normalizedStreetStatus =
        relatedStreetRequest?.streetFriendStatus === 'pending_incoming' ||
        relatedStreetRequest?.streetFriendStatus === 'pending_outgoing' ||
        relatedStreetRequest?.streetFriendStatus === 'accepted'
          ? relatedStreetRequest.streetFriendStatus
          : 'none';
      return {
        avatarUrl:
          request.avatarUrl.trim().length > 0 ? request.avatarUrl : FALLBACK_AVATAR,
        fullName: request.fullName,
        id: request.id,
        isPrivateAccount: false,
        isVerified: request.isVerified,
        username: normalizedUsername,
        viewerState: {
          followRequestStatus: 'pending_incoming',
          followsYou: false,
          isFollowing: false,
          isStreetFriend: normalizedStreetStatus === 'accepted',
          streetFriendStatus: normalizedStreetStatus,
        },
      };
    },
    [streetRequests],
  );

  const handleOpenRelationProfile = useCallback(
    (user: ExploreSearchUser) => {
      if (!onOpenPublicProfile) {
        return;
      }
      closeRelationModals();
      onOpenPublicProfile(user);
    },
    [closeRelationModals, onOpenPublicProfile],
  );

  const handleOpenStreetFriendProfile = useCallback(
    (friend: ExploreStreetFriendListItem) => {
      handleOpenRelationProfile(buildSearchUserFromStreetFriend(friend));
    },
    [buildSearchUserFromStreetFriend, handleOpenRelationProfile],
  );

  const handleOpenStreetRequestProfile = useCallback(
    (request: ExploreStreetFriendRequestItem) => {
      handleOpenRelationProfile(buildSearchUserFromStreetRequest(request));
    },
    [buildSearchUserFromStreetRequest, handleOpenRelationProfile],
  );

  const handleOpenFollowRequestProfile = useCallback(
    (request: FollowRequestItem) => {
      handleOpenRelationProfile(buildSearchUserFromFollowRequest(request));
    },
    [buildSearchUserFromFollowRequest, handleOpenRelationProfile],
  );

  async function handleFollowToggle(
    user: ExploreSearchUser,
    source: 'followers' | 'following',
  ) {
    const setPending =
      source === 'followers'
        ? setPendingFollowerActionId
        : setPendingFollowingActionId;
    const updateItem =
      source === 'followers' ? updateFollowersItem : updateFollowingItem;
    const isPending =
      source === 'followers'
        ? pendingFollowerActionId === user.id
        : pendingFollowingActionId === user.id;
    if (isPending) {
      return;
    }

    const previousIsFollowing = user.viewerState.isFollowing;
    const performToggle = async () => {
      setPending(user.id);
      try {
        const response = await followCreator(user.id);
        updateItem(user.id, current => ({
          ...current,
          viewerState: {
            ...current.viewerState,
            followRequestStatus: response.followRequestStatus,
            followsYou: response.followsYou,
            isFollowing: response.isFollowing,
          },
        }));

        if (previousIsFollowing !== response.isFollowing) {
          const delta = response.isFollowing ? 1 : -1;
          updateProfileStats({
            followingCount: Math.max(0, profile.stats.followingCount + delta),
          });
        }

        if (
          source === 'following' &&
          previousIsFollowing &&
          !response.isFollowing
        ) {
          setFollowing(previous =>
            previous.filter(item => item.id !== user.id),
          );
        }
      } catch (error) {
        const message = isApiRequestError(error)
          ? error.message
          : 'Takip işlemi tamamlanamadı.';
        if (source === 'followers') {
          setFollowersError(message);
        } else {
          setFollowingError(message);
        }
      } finally {
        setPending(null);
      }
    };

    if (previousIsFollowing) {
      void confirm({
        confirmLabel: 'Takipten Çık',
        message: `@${user.username} artik takip edilmeyecek.`,
        title: 'Takipten çık',
        tone: 'danger',
      }).then(accepted => {
        if (!accepted) {
          return;
        }
        performToggle().catch(() => {
          return;
        });
      });
      return;
    }

    performToggle().catch(() => {
      return;
    });
  }

  function handleRemoveStreetFriend(friend: ExploreStreetFriendListItem) {
    if (pendingStreetFriendActionId === friend.id) {
      return;
    }

    void confirm({
      confirmLabel: 'Kaldır',
      message: `@${friend.username} Yakındakiler listesinden çıkarılsın mı?`,
      title: 'Yakındakilerden kaldır',
      tone: 'danger',
    }).then(accepted => {
      if (!accepted) {
        return;
      }
      setPendingStreetFriendActionId(friend.id);
      setStreetFriendsError(null);
      removeStreetFriend(friend.id)
        .then(() => {
          setStreetFriends(previous =>
            previous.filter(item => item.id !== friend.id),
          );
          updateProfileStats({
            streetFriendsCount: Math.max(
              0,
              profile.stats.streetFriendsCount - 1,
            ),
          });
        })
        .catch(error => {
          setStreetFriendsError(
            isApiRequestError(error)
              ? error.message
              : 'Yakındakiler arkadaşı kaldırma işlemi tamamlanamadı.',
          );
        })
        .finally(() => {
          setPendingStreetFriendActionId(null);
        });
    });
  }

  async function handleStreetRequestAccept(requesterId: string) {
    if (pendingStreetRequestId || requesterId.trim().length === 0) {
      return;
    }

    setPendingStreetRequestId(requesterId);
    setStreetRequestsError(null);

    try {
      const response = await upsertStreetFriend(requesterId);
      if (
        response.isStreetFriend ||
        response.streetFriendStatus === 'accepted'
      ) {
        const updatedRequests = streetRequests.filter(item => item.id !== requesterId);
        setStreetRequests(updatedRequests);

        // Cache'i güncelle
        streetRequestsCacheByProfileId.set(profile.id, {
          cachedAt: Date.now(),
          requests: updatedRequests,
        });

        onProfileChange({
          ...profile,
          stats: {
            ...profile.stats,
            streetFriendsCount: profile.stats.streetFriendsCount + 1,
          },
        });
      } else {
        await loadStreetRequests({ force: true, showLoader: false });
      }
    } catch (error) {
      setStreetRequestsError(
        isApiRequestError(error)
          ? error.message
          : 'Yakındakiler isteği işlemi tamamlanamadı.',
      );
    } finally {
      setPendingStreetRequestId(null);
    }
  }

  async function handleStreetRequestReject(requesterId: string) {
    if (pendingStreetRequestId || requesterId.trim().length === 0) {
      return;
    }

    setPendingStreetRequestId(requesterId);
    setStreetRequestsError(null);

    try {
      await removeStreetFriend(requesterId);
      const updatedRequests = streetRequests.filter(item => item.id !== requesterId);
      setStreetRequests(updatedRequests);

      // Cache'i güncelle
      streetRequestsCacheByProfileId.set(profile.id, {
        cachedAt: Date.now(),
        requests: updatedRequests,
      });
    } catch (error) {
      setStreetRequestsError(
        isApiRequestError(error)
          ? error.message
          : 'Yakındakiler isteği silinemedi. Lütfen tekrar dene.',
      );
    } finally {
      setPendingStreetRequestId(null);
    }
  }

  const handlePostViewerReaction = useCallback(
    async (post: PostViewerItem, kind: PostViewerReactionKind) => {
      const normalizedPostId = post.id.trim();
      if (!normalizedPostId) {
        return;
      }

      const reactionKey = buildViewerReactionKey(normalizedPostId, kind);
      if (pendingViewerReactionKeysRef.current.has(reactionKey)) {
        return;
      }

      const isToggleable = kind === 'like' || kind === 'bookmark';
      const previousViewerState = {
        followRequestStatus: 'none' as const,
        isBookmarked: Boolean(post.viewerState?.isBookmarked),
        isFollowing: false,
        isLiked: Boolean(post.viewerState?.isLiked),
        isStreetFriend: false,
        streetFriendStatus: 'none' as const,
      };
      const previousStats = {
        bookmarksCount: Number(post.stats?.bookmarksCount ?? 0),
        commentsCount: Number(post.stats?.commentsCount ?? 0),
        likesCount: Number(post.stats?.likesCount ?? 0),
        sharesCount: Number(post.stats?.sharesCount ?? 0),
      };
      const wasActive =
        kind === 'like'
          ? previousViewerState.isLiked
          : kind === 'bookmark'
            ? previousViewerState.isBookmarked
            : false;
      const nextActive = kind === 'share' ? true : !wasActive;

      const optimisticStats = getOptimisticProfileStats(
        previousStats,
        kind,
        nextActive,
      );
      const optimisticViewerState = {
        ...previousViewerState,
        ...(kind === 'like' ? { isLiked: nextActive } : {}),
        ...(kind === 'bookmark' ? { isBookmarked: nextActive } : {}),
      };

      pendingViewerReactionKeysRef.current.add(reactionKey);
      setPendingViewerReactionKeys(previous => ({
        ...previous,
        [reactionKey]: true,
      }));

      if (isToggleable) {
        applyPostReactionSnapshot(
          normalizedPostId,
          optimisticStats,
          optimisticViewerState,
        );
        syncProfileReactionCollection(
          post,
          kind,
          nextActive,
          optimisticStats,
          optimisticViewerState,
        );
      }

      try {
        if (kind === 'share') {
          const shareResult = await Share.share(buildProfileSharePayload(post));
          if (
            shareResult.action === Share.dismissedAction &&
            Platform.OS === 'ios'
          ) {
            return;
          }
          applyPostReactionSnapshot(
            normalizedPostId,
            optimisticStats,
            optimisticViewerState,
          );
          syncProfileReactionCollection(
            post,
            kind,
            nextActive,
            optimisticStats,
            optimisticViewerState,
          );
        }

        triggerSelectionHaptic();

        const response = await sendExploreReaction(normalizedPostId, kind);
        const serverViewerState = {
          followRequestStatus:
            response.viewerState.followRequestStatus ?? 'none',
          isBookmarked: Boolean(response.viewerState.isBookmarked),
          isFollowing: Boolean(response.viewerState.isFollowing),
          isLiked: Boolean(response.viewerState.isLiked),
          isStreetFriend: Boolean(response.viewerState.isStreetFriend),
          streetFriendStatus: response.viewerState.streetFriendStatus ?? 'none',
        };
        applyPostReactionSnapshot(
          response.postId,
          response.stats,
          serverViewerState,
        );
        syncProfileReactionCollection(
          post,
          kind,
          kind === 'like'
            ? serverViewerState.isLiked
            : kind === 'bookmark'
              ? serverViewerState.isBookmarked
              : true,
          response.stats,
          serverViewerState,
        );
      } catch (error) {
        if (isToggleable) {
          applyPostReactionSnapshot(
            normalizedPostId,
            previousStats,
            previousViewerState,
          );
          syncProfileReactionCollection(
            post,
            kind,
            wasActive,
            previousStats,
            previousViewerState,
          );
        }
        showPostNotice(
          isApiRequestError(error)
            ? error.message
            : 'Gonderi etkilesimi su an kaydedilemedi.',
          'error',
        );
      } finally {
        pendingViewerReactionKeysRef.current.delete(reactionKey);
        setPendingViewerReactionKeys(previous => {
          if (!previous[reactionKey]) {
            return previous;
          }
          const next = { ...previous };
          delete next[reactionKey];
          return next;
        });
      }
    },
    [
      applyPostReactionSnapshot,
      showPostNotice,
      syncProfileReactionCollection,
    ],
  );

  const handlePostViewerReport = useCallback(
    async (post: PostViewerItem, reason: PostViewerReportReason) => {
      const normalizedPostId = post.id.trim();
      if (!normalizedPostId || pendingViewerReportPostId === normalizedPostId) {
        return;
      }
      setPendingViewerReportPostId(normalizedPostId);
      try {
        await reportExplorePost(normalizedPostId, reason);
        showToast({
          message: 'Inceleme icin moderasyon sirasina eklendi.',
          title: 'Gonderi bildirildi',
          tone: 'success',
        });
      } catch (error) {
        showToast({
          message: isApiRequestError(error)
            ? error.message
            : 'Gonderi simdi bildirilemedi. Birazdan tekrar deneyebilirsin.',
          title: 'Bildirim gonderilemedi',
          tone: 'warning',
        });
      } finally {
        setPendingViewerReportPostId(null);
      }
    },
    [pendingViewerReportPostId, showToast],
  );

  function openPostViewer(postId: string) {
    const normalizedPostId = postId.trim();
    const resolvedIndex =
      normalizedPostId.length > 0
        ? postViewerItems.findIndex(item => item.id === normalizedPostId)
        : -1;
    if (resolvedIndex < 0) {
      showToast({
        message: 'Gonderi listesi guncellendigi icin yeniden dene.',
        title: 'Gönderi açılamadı',
        tone: 'warning',
      });
      return;
    }
    const safeIndex = Math.max(
      0,
      Math.min(
        resolvedIndex,
        Math.max(postViewerItems.length - 1, 0),
      ),
    );
    const targetItem = activeCollection.items[safeIndex];
    if (!targetItem) {
      return;
    }
    const targetUnavailable = isCollectionPostUnavailable(targetItem);
    if ((activeTab === 'liked' || activeTab === 'saved') && targetUnavailable) {
      showToast({
        message: 'Bu gönderi silinmiş veya artık mevcut değil.',
        title: 'Gönderiye ulaşılamıyor',
        tone: 'warning',
      });
      return;
    }
    persistProfileListMemory(activeTab);
    // Kendi profilindeki "Gönderiler" sekmesinde kullanıcıyı explore'a atmayız.
    // Sadece beğenilen/kaydedilen akışında explore viewer kullanılır.
    if (activeTab !== 'posts' && onOpenExploreViewer) {
      onOpenExploreViewer({
        fromProfile: true,
        initialIndex: safeIndex,
        posts: postViewerItems,
        ...(activeTab === 'liked' || activeTab === 'saved'
          ? { sourceTab: activeTab }
          : {}),
      });
      return;
    }
    setViewerStartIndex(safeIndex);
    setIsViewerVisible(true);
  }

  function closeOwnPostActionsSheet() {
    if (pendingDeletePostId || pendingUpdatePostId) {
      return;
    }
    setIsPostActionsSheetVisible(false);
    setPostActionsStep('menu');
    setPostActionsTarget(null);
  }

  function handleDeleteOwnPostConfirmed(post: PublicProfilePostItem) {
    if (pendingDeletePostId || pendingUpdatePostId) {
      return;
    }
    setPendingDeletePostId(post.id);

    // Optimistic update - UI'ı hemen güncelle
    const previousRoutesCount = profile.stats.routesCount;
    onProfileChange({
      ...profile,
      stats: {
        ...profile.stats,
        routesCount: Math.max(0, profile.stats.routesCount - 1),
      },
    });

    deleteMyProfilePost(post.id)
      .then(() => {
        const zeroStats = {
          bookmarksCount: 0,
          commentsCount: 0,
          likesCount: 0,
          sharesCount: 0,
        };
        setCollections(previous => ({
          ...previous,
          liked: {
            ...previous.liked,
            items: previous.liked.items.map(item =>
              item.id === post.id
                ? {
                  ...item,
                  caption: '',
                  isLive: false,
                  isUnavailable: true,
                  location: '',
                  mediaType: 'unavailable',
                  mediaUrl: '',
                  stats: zeroStats,
                  unavailableReason: 'soft_deleted',
                }
                : item,
            ),
          },
          posts: {
            ...previous.posts,
            items: previous.posts.items.filter(item => item.id !== post.id),
          },
          saved: {
            ...previous.saved,
            items: previous.saved.items.map(item =>
              item.id === post.id
                ? {
                  ...item,
                  caption: '',
                  isLive: false,
                  isUnavailable: true,
                  location: '',
                  mediaType: 'unavailable',
                  mediaUrl: '',
                  stats: zeroStats,
                  unavailableReason: 'soft_deleted',
                }
                : item,
            ),
          },
        }));
        setMediaLoadErrorByPostId(previous => {
          if (!previous[post.id]) {
            return previous;
          }
          const next = { ...previous };
          delete next[post.id];
          return next;
        });
        setEditingPost(current => (current?.id === post.id ? null : current));
        setIsPostActionsSheetVisible(false);
        setPostActionsStep('menu');
        setPostActionsTarget(null);
      })
      .catch(() => {
        // Hata olursa geri al (rollback)
        onProfileChange({
          ...profile,
          stats: {
            ...profile.stats,
            routesCount: previousRoutesCount,
          },
        });
      })
      .finally(() => {
        setPendingDeletePostId(null);
      });
  }

  function openOwnPostActions(post: PublicProfilePostItem) {
    if (pendingDeletePostId || pendingUpdatePostId) {
      return;
    }
    setPostActionsTarget(post);
    setPostActionsStep('menu');
    setIsPostActionsSheetVisible(true);
  }

  async function handleSavePostEdit(
    payload: {
      caption: string;
      location?: string;
      locationPayload?: PostLocationPayload;
      visibility: 'friends' | 'private' | 'public';
    },
    postId: string,
  ) {
    setPendingUpdatePostId(postId);
    try {
      const updatedPost = await updateMyProfilePost(postId, {
        caption: payload.caption,
        location: payload.location,
        locationPayload: payload.locationPayload,
        visibility: payload.visibility,
      });
      replacePostAcrossCollections(updatedPost);
      setMediaLoadErrorByPostId(previous => {
        if (!previous[postId]) {
          return previous;
        }
        const next = { ...previous };
        delete next[postId];
        return next;
      });
      setEditingPost(null);
      showPostNotice('Gönderi güncellendi.');
    } catch (error) {
      const message = isApiRequestError(error)
        ? error.message
        : 'Gönderi güncellenemedi.';
      showPostNotice(message, 'error');
      throw error;
    } finally {
      setPendingUpdatePostId(null);
    }
  }

  if (isSettingsOpen) {
    return (
      <ProfileSettings
        contentBottomInset={contentBottomInset}
        initialEntryScreen={settingsEntryScreen}
        onBack={() => {
          setIsSettingsOpen(false);
        }}
        onEditProfile={() => {
          setIsSettingsOpen(false);
          openEditModal();
        }}
        onForgotPassword={onForgotPassword}
        onLogout={onLogout}
        onDeleteAccount={async () => {
          onLogout();
        }}
        onProfileChange={onProfileChange}
        profile={profile}
        safeBottom={safeBottom}
        safeTop={safeTop}
      />
    );
  }

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <ScrollView
        bounces={isProfileScrollable}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: footerInset,
            paddingTop: topInset,
          },
        ]}
        onScroll={event => {
          const { contentOffset, contentSize, layoutMeasurement } =
            event.nativeEvent;
          listOffsetsByTabRef.current[activeTab] = Math.max(
            0,
            contentOffset.y,
          );
          const distanceFromBottom =
            contentSize.height - (layoutMeasurement.height + contentOffset.y);
          if (
            distanceFromBottom < 420 &&
            activeCollection.hasNextPage &&
            !activeCollection.initialLoading &&
            !activeCollection.loadingMore
          ) {
            loadCollection(activeTab, 'append').catch(() => {
              return;
            });
          }
        }}
        ref={scrollViewRef}
        scrollEnabled={isProfileScrollable}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <ProfileActionsHeader
          onAccountPress={openEditModal}
          onSettingsPress={() => {
            setSettingsEntryScreen('root');
            setIsSettingsOpen(true);
          }}
        />

        <View style={styles.avatarSection}>
          <Pressable
            disabled={isAvatarActionBusy}
            onPress={() => {
              handleProfilePhotoPress('profile');
            }}
            style={styles.avatarWrap}
          >
            {hasProfileAvatar ? (
              <Image
                source={{ uri: effectiveAvatarUrl }}
                style={styles.avatar}
                onError={() => {
                  setAvatarImageLoadFailed(true);
                }}
              />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text
                  allowFontScaling={false}
                  style={styles.avatarInitialsText}
                >
                  {avatarInitials}
                </Text>
              </View>
            )}
            {!hasProfileAvatar ? (
              <View style={styles.cameraBadge}>
                <FeatherIcon color="#ffffff" name="camera" size={11} />
              </View>
            ) : null}
          </Pressable>
          <Text allowFontScaling={false} style={styles.nameText}>
            {displayName}
          </Text>
          <Text allowFontScaling={false} style={styles.usernameText}>
            {usernameText}
          </Text>
          <View style={styles.profileBioCard}>
            <Text
              allowFontScaling={false}
              style={[
                styles.profileBioText,
                profileBioText.length === 0 ? styles.profileBioTextPlaceholder : null,
              ]}
            >
              {profileBioText.length > 0
                ? profileBioText
                : translateText('Bio eklenmemiş')}
            </Text>
          </View>
        </View>

        <View style={styles.statsCard}>
          <View style={styles.statCell}>
            <Text allowFontScaling={false} style={styles.statValue}>
              {formatCount(profile.stats.routesCount)}
            </Text>
            <Text allowFontScaling={false} style={styles.statLabel}>
              {translateText('Gönderiler')}
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Pressable
              onPress={openFollowersModal}
              style={styles.statCellPressable}
            >
              <Text allowFontScaling={false} style={styles.statValue}>
                {formatCount(profile.stats.followersCount)}
              </Text>
              <Text allowFontScaling={false} style={styles.statLabel}>
                {translateText('TAKİPÇİLER')}
              </Text>
            </Pressable>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Pressable
              onPress={openFollowingModal}
              style={styles.statCellPressable}
            >
              <Text allowFontScaling={false} style={styles.statValue}>
                {formatCount(profile.stats.followingCount)}
              </Text>
              <Text allowFontScaling={false} style={styles.statLabel}>
                {translateText('TAKİP')}
              </Text>
            </Pressable>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Pressable
              onPress={openStreetFriendsModal}
              style={styles.statCellPressable}
            >
              <Text allowFontScaling={false} style={styles.statValue}>
                {formatCount(profile.stats.streetFriendsCount)}
              </Text>
              <Text allowFontScaling={false} style={styles.statLabel}>
                {translateText('YAKINDAKİLER')}
              </Text>
            </Pressable>
          </View>
        </View>

        <Pressable onPress={openEditModal} style={styles.editButton}>
          <Text allowFontScaling={false} style={styles.editButtonText}>
            {translateText('Profili Düzenle')}
          </Text>
        </Pressable>

        {isPrivateAccount ? (
          <Pressable
            onPress={openFollowRequestsModal}
            style={styles.requestsEntryCard}
          >
            <View style={styles.requestsEntryLeft}>
              <View style={styles.requestsEntryIconWrap}>
                <FeatherIcon color="#111827" name="user-check" size={13} />
              </View>
              <View style={styles.requestsEntryMeta}>
                <View style={styles.requestsEntryTitleRow}>
                  <Text
                    allowFontScaling={false}
                    style={styles.requestsEntryTitle}
                  >
                    {translateText('Takip İstekleri')}
                  </Text>
                  {followRequestStateLabel ? (
                    <View style={styles.requestsEntryStateChip}>
                      <Text
                        allowFontScaling={false}
                        style={styles.requestsEntryStateChipText}
                      >
                        {followRequestStateLabel}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <Text
                  allowFontScaling={false}
                  style={styles.requestsEntrySubtitle}
                >
                  {followRequestInfoLabel}
                </Text>

                {requestPreviewItems.length > 0 ? (
                  <View style={styles.requestsEntryPreviewRow}>
                    <View style={styles.requestsEntryAvatarStack}>
                      {requestPreviewItems.map((request, index) => {
                        const requestAvatar =
                          request.avatarUrl.trim().length > 0
                            ? resolveProtectedMediaUrl(request.avatarUrl)
                            : FALLBACK_AVATAR;
                        return (
                          <Image
                            key={request.id}
                            source={{ uri: requestAvatar }}
                            style={[
                              styles.requestsEntryPreviewAvatar,
                              index > 0
                                ? styles.requestsEntryPreviewAvatarOffset
                                : null,
                              index === 0
                                ? styles.requestsEntryPreviewAvatarTop
                                : null,
                              index === 1
                                ? styles.requestsEntryPreviewAvatarMiddle
                                : null,
                            ]}
                          />
                        );
                      })}
                    </View>
                    <Text
                      allowFontScaling={false}
                      style={styles.requestsEntryPreviewText}
                    >
                      {translateText(
                        `Son istek @${requestPreviewItems[0]?.username}`,
                      )}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            <FeatherIcon color="#6b7280" name="chevron-right" size={16} />
          </Pressable>
        ) : null}

        <Pressable
          onPress={openStreetRequestsModal}
          style={[styles.requestsEntryCard, styles.streetRequestsEntryCard]}
        >
          <View style={styles.requestsEntryLeft}>
            <View
              style={[
                styles.requestsEntryIconWrap,
                styles.streetRequestsEntryIconWrap,
              ]}
            >
              <FeatherIcon color="#1d4ed8" name="map-pin" size={13} />
            </View>
            <View style={styles.requestsEntryMeta}>
              <View style={styles.requestsEntryTitleRow}>
                <Text
                  allowFontScaling={false}
                  style={styles.requestsEntryTitle}
                >
                  {translateText('Yakındakiler İstekleri')}
                </Text>
                {streetRequestStateLabel ? (
                  <View
                    style={[
                      styles.requestsEntryStateChip,
                      styles.streetRequestsEntryStateChip,
                    ]}
                  >
                    <Text
                      allowFontScaling={false}
                      style={[
                        styles.requestsEntryStateChipText,
                        styles.streetRequestsEntryStateChipText,
                      ]}
                    >
                      {streetRequestStateLabel}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text
                allowFontScaling={false}
                style={[
                  styles.requestsEntrySubtitle,
                  effectiveStreetIncomingRequestsCount > 0
                    ? styles.requestsEntrySubtitleUnread
                    : null,
                ]}
              >
                {streetRequestInfoLabel}
              </Text>

              {streetRequestPreviewItems.length > 0 ? (
                <View style={styles.requestsEntryPreviewRow}>
                  <View style={styles.requestsEntryAvatarStack}>
                    {streetRequestPreviewItems.map((request, index) => {
                      const requestAvatar =
                        request.avatarUrl.trim().length > 0
                        ? resolveProtectedMediaUrl(request.avatarUrl)
                          : FALLBACK_AVATAR;
                      return (
                        <Image
                          key={request.id}
                          source={{ uri: requestAvatar }}
                          style={[
                            styles.requestsEntryPreviewAvatar,
                            index > 0
                              ? styles.requestsEntryPreviewAvatarOffset
                              : null,
                            index === 0
                              ? styles.requestsEntryPreviewAvatarTop
                              : null,
                            index === 1
                              ? styles.requestsEntryPreviewAvatarMiddle
                              : null,
                          ]}
                        />
                      );
                    })}
                  </View>
                  <Text
                    allowFontScaling={false}
                    style={styles.requestsEntryPreviewText}
                  >
                    {translateText(
                      `Son istek @${streetRequestPreviewItems[0]?.username}`,
                    )}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          <FeatherIcon color="#2563eb" name="chevron-right" size={16} />
        </Pressable>

        {isPrivateAccount && requestsError ? (
          <View style={styles.requestsInlineError}>
            <Text allowFontScaling={false} style={styles.requestsError}>
              {translateText(requestsError)}
            </Text>
          </View>
        ) : null}

        {streetRequestsError ? (
          <View style={styles.requestsInlineError}>
            <Text allowFontScaling={false} style={styles.requestsError}>
              {translateText(streetRequestsError)}
            </Text>
          </View>
        ) : null}

        <View style={styles.segmentWrap}>
          <Pressable
            onPress={() => {
              handleSetActiveTab('posts');
            }}
            style={[
              styles.segmentItem,
              activeTab === 'posts' ? styles.segmentItemActive : null,
            ]}
          >
            <FeatherIcon
              color={activeTab === 'posts' ? '#ffffff' : '#6a6f7b'}
              name="grid"
              size={19}
            />
          </Pressable>
          <Pressable
            onPress={() => {
              handleSetActiveTab('liked');
            }}
            style={[
              styles.segmentItem,
              activeTab === 'liked' ? styles.segmentItemActive : null,
            ]}
          >
            <FeatherIcon
              color={activeTab === 'liked' ? '#ffffff' : '#6a6f7b'}
              name="heart"
              size={19}
            />
          </Pressable>
          <Pressable
            onPress={() => {
              handleSetActiveTab('saved');
            }}
            style={[
              styles.segmentItem,
              activeTab === 'saved' ? styles.segmentItemActive : null,
            ]}
          >
            <FeatherIcon
              color={activeTab === 'saved' ? '#ffffff' : '#6a6f7b'}
              name="bookmark"
              size={19}
            />
          </Pressable>
        </View>

        <View style={styles.segmentDivider} />
        {showCollectionInitialLoading ? (
          <ScreenStateCenter minHeight={188}>
            <View style={styles.collectionLoadingState}>
              <IosSpinner color="#ff5a16" size="large" />
              <Text allowFontScaling={false} style={styles.collectionLoadingText}>
                İçerik yükleniyor...
              </Text>
            </View>
          </ScreenStateCenter>
        ) : activeCollection.error ? (
          <ScreenStateCenter minHeight={188}>
            <ScreenStateCard
              actionLabel="Tekrar dene"
              description={activeCollection.error}
              iconName="alert-triangle"
              onActionPress={() => {
                loadCollection(activeTab, 'refresh').catch(() => {
                  return;
                });
              }}
              style={styles.collectionStateCard}
              title="İçerik alınamadı"
              tone="error"
            />
          </ScreenStateCenter>
        ) : activeCollection.items.length === 0 ? (
          <ScreenStateCenter
            minHeight={188}
            style={{ paddingBottom: Math.max(safeBottom + 26, 42) }}
          >
            {activeTab === 'posts' ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIconWrap}>
                  <FeatherIcon color="#9ca3af" name="camera" size={28} />
                </View>
                <Text allowFontScaling={false} style={styles.emptyPrimaryText}>
                  Henüz gönderi yok
                </Text>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <View style={styles.emptyIconWrap}>
                  <FeatherIcon
                    color="#8b95a7"
                    name={activeTab === 'liked' ? 'heart' : 'bookmark'}
                    size={24}
                  />
                </View>
                <Text allowFontScaling={false} style={styles.emptyPrimaryText}>
                  Henüz gönderi yok
                </Text>
                <Text allowFontScaling={false} style={styles.emptyText}>
                  {activeTab === 'liked'
                    ? 'Beğendiğin gönderiler burada görünecek'
                    : 'Kaydettiğin gönderiler burada görünecek'}
                </Text>
              </View>
            )}
          </ScreenStateCenter>
        ) : (
          <>
            {activeTab === 'posts' ? (
              <View style={styles.postsSectionHeader}>
                <FeatherIcon color="#0f172a" name="grid" size={20} />
                <Text allowFontScaling={false} style={styles.postsSectionTitle}>
                  Gönderiler
                </Text>
              </View>
            ) : null}

            <View style={styles.postsFeed}>
              {activeCollection.items.map((post, index) => {
                const postDeletePending =
                  activeTab === 'posts' && pendingDeletePostId === post.id;
                const postUpdatePending =
                  activeTab === 'posts' && pendingUpdatePostId === post.id;
                const postMutationPending = postDeletePending || postUpdatePending;
                const isLastInRow = (index + 1) % 3 === 0;
                const postUnavailable =
                  (activeTab === 'liked' || activeTab === 'saved') &&
                  isCollectionPostUnavailable(post);
                return (
                  <PostCard
                    key={post.id}
                    cardStyle={[
                      !isLastInRow ? styles.compactPostCardWithGap : null,
                      postMutationPending ? styles.postCardPending : null,
                    ]}
                    commentsText={formatCount(post.stats.commentsCount)}
                    disabled={postMutationPending}
                    likesText={formatCount(post.stats.likesCount)}
                    mediaType={post.mediaType}
                    mediaUrl={post.mediaUrl}
                    menuDisabled={postMutationPending}
                    menuMode={activeTab === 'posts' && !postUnavailable ? 'action' : 'none'}
                    menuPending={postMutationPending}
                    variant="compact"
                    onPress={() => {
                      if (suppressNextPostTilePressIdRef.current === post.id) {
                        suppressNextPostTilePressIdRef.current = null;
                        return;
                      }
                      if (postMutationPending) {
                        return;
                      }
                      if (postUnavailable) {
                        showToast({
                          message: 'Bu gonderi silinmis veya artik mevcut degil.',
                          title: 'Gönderiye ulaşılamıyor',
                          tone: 'warning',
                        });
                        return;
                      }
                      openPostViewer(post.id);
                    }}
                    onLongPress={() => {
                      if (activeTab !== 'posts' || postMutationPending) {
                        return;
                      }
                      suppressNextPostTilePressIdRef.current = post.id;
                      openOwnPostActions(post);
                    }}
                    onMediaError={() => {
                      if (activeTab !== 'liked' && activeTab !== 'saved') {
                        return;
                      }
                      setMediaLoadErrorByPostId(previous => {
                        if (previous[post.id]) {
                          return previous;
                        }
                        return {
                          ...previous,
                          [post.id]: true,
                        };
                      });
                    }}
                    onMenuPress={() => {
                      suppressNextPostTilePressIdRef.current = post.id;
                      openOwnPostActions(post);
                    }}
                    thumbnailUrl={post.thumbnailUrl}
                    unavailable={postUnavailable}
                  />
                );
              })}
            </View>

            {activeCollection.hasNextPage ? (
              <Pressable
                disabled={activeCollection.loadingMore || activeCollection.initialLoading}
                onPress={() => {
                  loadCollection(activeTab, 'append').catch(() => {
                    return;
                  });
                }}
                style={styles.loadMoreButton}
              >
                <Text allowFontScaling={false} style={styles.loadMoreText}>
                  Daha fazla yukle
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>

      {editingPost && editingPostDraft ? (
        <PostComposerModal
          draft={editingPostDraft}
          initialValues={{
            caption: editingPost.caption,
            location:
              editingPost.location === 'Konum belirtilmedi'
                ? ''
                : editingPost.location,
            visibility:
              editingPost.visibility === 'friends' ||
                editingPost.visibility === 'private' ||
                editingPost.visibility === 'public'
                ? editingPost.visibility
                : profile.privacy?.isPrivateAccount
                  ? 'friends'
                  : 'public',
          }}
          mode="edit"
          onClose={() => {
            if (pendingUpdatePostId) {
              return;
            }
            setEditingPost(null);
          }}
          onSubmit={async payload => {
            await handleSavePostEdit(payload, editingPost.id);
          }}
          safeBottom={safeBottom}
          safeTop={safeTop}
          viewerAvatarUrl={avatarUrl}
          viewerDisplayName={displayName}
          viewerIsPrivateAccount={Boolean(profile.privacy?.isPrivateAccount)}
          visible={Boolean(editingPost)}
        />
      ) : null}

      <PostViewerModal
        direction="vertical"
        immersiveBottomVariant="engagement-bar"
        initialIndex={viewerStartIndex}
        onClose={() => {
          setIsViewerVisible(false);
        }}
        onReport={handlePostViewerReport}
        onReact={handlePostViewerReaction}
        pendingReportPostId={pendingViewerReportPostId}
        pendingReactionKeys={pendingViewerReactionKeys}
        posts={postViewerItems}
        safeBottom={safeBottom}
        safeTop={safeTop}
        showImmersiveHeaderMeta={false}
        viewerAvatarUrl={avatarUrl}
        visible={isViewerVisible}
      />

      {postNotice ? (
        <View
          pointerEvents="none"
          style={[
            styles.postNoticeWrap,
            { bottom: Math.max(safeBottom, 12) + 12 },
          ]}
        >
          <View
            style={[
              styles.postNoticeCard,
              postNotice.tone === 'error'
                ? styles.postNoticeCardError
                : styles.postNoticeCardSuccess,
            ]}
          >
            <Text allowFontScaling={false} style={styles.postNoticeText}>
              {postNotice.message}
            </Text>
          </View>
        </View>
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={closeOwnPostActionsSheet}
        statusBarTranslucent={true}
        transparent={true}
        visible={isPostActionsSheetVisible}
      >
        <StatusBar
          animated={true}
          backgroundColor="transparent"
          barStyle="light-content"
          translucent={true}
        />
        <View style={styles.postActionsSheetRoot}>
          <Pressable
            onPress={closeOwnPostActionsSheet}
            style={styles.postActionsSheetBackdrop}
          />
          <View
            style={[
              styles.postActionsSheetCard,
              { paddingBottom: Math.max(safeBottom, 14) + 8 },
            ]}
          >
            <View style={styles.postActionsSheetHandle} />
            <Text allowFontScaling={false} style={styles.postActionsSheetTitle}>
              {postActionsStep === 'confirm-delete'
                ? 'Gönderi silinsin mi?'
                : 'Gönderi işlemleri'}
            </Text>
            <Text allowFontScaling={false} style={styles.postActionsSheetSubtitle}>
              {postActionsStep === 'confirm-delete'
                ? 'Bu gönderi profil akışından kaldırılır ve geri alınamaz.'
                : 'Bu gönderiyi düzenleyebilir veya silebilirsin.'}
            </Text>

            {postActionsStep === 'confirm-delete' ? (
              <>
                <Pressable
                  disabled={!postActionsTarget || pendingDeletePostId != null}
                  onPress={() => {
                    if (!postActionsTarget) {
                      return;
                    }
                    handleDeleteOwnPostConfirmed(postActionsTarget);
                  }}
                  style={[
                    styles.postActionsSheetItem,
                    styles.postActionsSheetItemDanger,
                    pendingDeletePostId != null ? styles.postActionsSheetItemDisabled : null,
                  ]}
                >
                  <FeatherIcon color="#b42318" name="trash-2" size={17} />
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.postActionsSheetItemText,
                      styles.postActionsSheetItemTextDanger,
                    ]}
                  >
                    {pendingDeletePostId != null ? 'Siliniyor...' : 'Evet, Sil'}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={pendingDeletePostId != null}
                  onPress={() => {
                    setPostActionsStep('menu');
                  }}
                  style={[
                    styles.postActionsSheetCancelButton,
                    pendingDeletePostId != null ? styles.postActionsSheetItemDisabled : null,
                  ]}
                >
                  <Text
                    allowFontScaling={false}
                    style={styles.postActionsSheetCancelText}
                  >
                    Vazgeç
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  disabled={!postActionsTarget || pendingUpdatePostId != null}
                  onPress={() => {
                    if (!postActionsTarget) {
                      return;
                    }
                    setIsPostActionsSheetVisible(false);
                    setPostActionsStep('menu');
                    setEditingPost(postActionsTarget);
                    setPostActionsTarget(null);
                  }}
                  style={[
                    styles.postActionsSheetItem,
                    pendingUpdatePostId != null ? styles.postActionsSheetItemDisabled : null,
                  ]}
                >
                  <FeatherIcon color="#111827" name="edit-2" size={17} />
                  <Text allowFontScaling={false} style={styles.postActionsSheetItemText}>
                    Düzenle
                  </Text>
                </Pressable>
                <Pressable
                  disabled={!postActionsTarget || pendingDeletePostId != null}
                  onPress={() => {
                    setPostActionsStep('confirm-delete');
                  }}
                  style={[
                    styles.postActionsSheetItem,
                    pendingDeletePostId != null ? styles.postActionsSheetItemDisabled : null,
                  ]}
                >
                  <FeatherIcon color="#b42318" name="trash-2" size={17} />
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.postActionsSheetItemText,
                      styles.postActionsSheetItemTextDanger,
                    ]}
                  >
                    Sil
                  </Text>
                </Pressable>
                <Pressable
                  disabled={pendingDeletePostId != null || pendingUpdatePostId != null}
                  onPress={closeOwnPostActionsSheet}
                  style={[
                    styles.postActionsSheetCancelButton,
                    pendingDeletePostId != null || pendingUpdatePostId != null
                      ? styles.postActionsSheetItemDisabled
                      : null,
                  ]}
                >
                  <Text
                    allowFontScaling={false}
                    style={styles.postActionsSheetCancelText}
                  >
                    Vazgeç
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => {
          setIsRequestsModalVisible(false);
        }}
        navigationBarTranslucent={true}
        statusBarTranslucent={true}
        transparent={false}
        visible={isRequestsModalVisible}
      >
        <StatusBar
          animated={true}
          backgroundColor="transparent"
          barStyle="dark-content"
          translucent={true}
        />
        <View style={styles.requestsModalScreen}>
          <View
            style={[
              styles.requestsModalHeader,
              { paddingTop: Math.max(safeTop + 6, 16) },
            ]}
          >
            <Pressable
              onPress={() => {
                setIsRequestsModalVisible(false);
              }}
              style={styles.requestsModalIconButton}
            >
              <FeatherIcon color="#1f2937" name="arrow-left" size={18} />
            </Pressable>

            <View style={styles.requestsModalTitleWrap}>
              <Text allowFontScaling={false} style={styles.requestsModalTitle}>
                {translateText('Takip İstekleri')}
              </Text>
              <Text
                allowFontScaling={false}
                style={styles.requestsModalSubtitle}
              >
                {translateText(`${effectiveFollowRequestsCount} bekleyen`)}
              </Text>
            </View>

            <View style={styles.requestsModalHeaderSpacer} />
          </View>

          {requestsError ? (
            <View style={styles.requestsModalErrorWrap}>
              <Text allowFontScaling={false} style={styles.requestsError}>
                {translateText(requestsError)}
              </Text>
            </View>
          ) : null}

          <ScrollView
            contentContainerStyle={[
              styles.requestsModalList,
              styles.requestsModalListGrow,
              { paddingBottom: Math.max(safeBottom + 22, 30) },
            ]}
            refreshControl={
              <RefreshControl
                colors={['#ff5a1f']}
                onRefresh={() => {
                  loadFollowRequests({ force: true, showLoader: true }).catch(() => {
                    return;
                  });
                }}
                progressViewOffset={6}
                refreshing={isLoadingRequests}
                tintColor="#ff5a1f"
              />
            }
            showsVerticalScrollIndicator={false}
          >
            {visibleFollowRequests.length === 0 ? (
              <View style={styles.requestsModalEmpty}>
                <View style={styles.requestsModalEmptyIconWrap}>
                  <FeatherIcon color="#6b7280" name="users" size={18} />
                </View>
                <Text
                  allowFontScaling={false}
                  style={styles.requestsModalEmptyTitle}
                >
                  {effectiveFollowRequestsCount > 0
                    ? translateText('Yeni istekler yükleniyor...')
                    : translateText('Şimdilik bekleyen istek yok')}
                </Text>
                <Text
                  allowFontScaling={false}
                  style={styles.requestsModalEmptyText}
                >
                  {effectiveFollowRequestsCount > 0
                    ? translateText(
                        'Liste kısa süre içinde güncellenecek, lütfen bekle.',
                      )
                    : translateText(
                        'Yeni takip istekleri geldiğinde burada görünecek.',
                      )}
                </Text>
              </View>
            ) : (
              visibleFollowRequests.map((request, index) => {
                const requestAvatar =
                  request.avatarUrl.trim().length > 0
                    ? resolveProtectedMediaUrl(request.avatarUrl)
                    : FALLBACK_AVATAR;

                return (
                  <View key={request.id}>
                    <View className="min-h-[86px] flex-row items-center px-4 py-2.5">
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          handleOpenFollowRequestProfile(request);
                        }}
                        className="min-h-[60px] flex-1 flex-row items-center active:rounded-[14px] active:bg-[#f8fafd]"
                      >
                        <Image
                          className="h-12 w-12 rounded-full border border-[#e3e8f0] bg-[#f4f6fa]"
                          source={{ uri: requestAvatar }}
                        />

                        <View className="ml-3 mr-2 min-h-[52px] flex-1 justify-center">
                          <Text
                            allowFontScaling={false}
                            className="text-[14.5px] font-bold leading-[19px] text-[#111827]"
                          >
                            {request.fullName || request.username}
                          </Text>
                          <Text
                            allowFontScaling={false}
                            className="mt-0.5 text-[13px] text-[#6b7280]"
                          >
                            @{request.username}
                          </Text>
                          <Text
                            allowFontScaling={false}
                            className="mt-0.5 text-[11px] text-[#9aa2af]"
                          >
                            {translateText(
                              `${formatRequestAge(request.requestedAt)} once`,
                            )}
                          </Text>
                        </View>
                      </Pressable>

                      <View className="ml-2 gap-2">
                        <Pressable
                          disabled={isAnyFollowRequestActionPending}
                          onPress={() => {
                            handleFollowRequestDecision(request.id, true).catch(
                              () => {
                                return;
                              },
                            );
                          }}
                          className={`h-9 min-w-[96px] items-center justify-center rounded-[10px] bg-[#3797ef] px-4 ${
                            isAnyFollowRequestActionPending ? 'opacity-55' : ''
                          }`}
                        >
                          <Text
                            allowFontScaling={false}
                            className="text-[12px] font-semibold text-white"
                          >
                            {translateText('Onayla')}
                          </Text>
                        </Pressable>

                        <Pressable
                          disabled={isAnyFollowRequestActionPending}
                          onPress={() => {
                            handleFollowRequestDecision(
                              request.id,
                              false,
                            ).catch(() => {
                              return;
                            });
                          }}
                          className={`h-9 min-w-[96px] items-center justify-center rounded-[10px] border border-[#d9dde3] bg-[#f2f3f5] px-4 ${
                            isAnyFollowRequestActionPending ? 'opacity-55' : ''
                          }`}
                        >
                          <Text
                            allowFontScaling={false}
                            className="text-[12px] font-semibold text-[#374151]"
                          >
                            {translateText('Sil')}
                          </Text>
                        </Pressable>
                      </View>
                    </View>

                    {index < visibleFollowRequests.length - 1 ? (
                      <View className="ml-[82px] mr-4 h-px bg-[#e6ebf2]" />
                    ) : null}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => {
          setIsStreetRequestsModalVisible(false);
        }}
        navigationBarTranslucent={true}
        statusBarTranslucent={true}
        transparent={false}
        visible={isStreetRequestsModalVisible}
      >
        <StatusBar
          animated={true}
          backgroundColor="transparent"
          barStyle="dark-content"
          translucent={true}
        />
        <View style={styles.requestsModalScreen}>
          <View
            style={[
              styles.requestsModalHeader,
              { paddingTop: Math.max(safeTop + 6, 16) },
            ]}
          >
            <Pressable
              onPress={() => {
                setIsStreetRequestsModalVisible(false);
              }}
              style={styles.requestsModalIconButton}
            >
              <FeatherIcon color="#1f2937" name="arrow-left" size={18} />
            </Pressable>

            <View style={styles.requestsModalTitleWrap}>
              <Text allowFontScaling={false} style={styles.requestsModalTitle}>
                {translateText('Yakındakiler İstekleri')}
              </Text>
              <Text
                allowFontScaling={false}
                style={styles.requestsModalSubtitle}
              >
                {translateText(`${effectiveStreetIncomingRequestsCount} gelen istek`)}
              </Text>
            </View>

            <View style={styles.requestsModalHeaderSpacer} />
          </View>

          {streetRequestsError ? (
            <View style={styles.requestsModalErrorWrap}>
              <Text allowFontScaling={false} style={styles.requestsError}>
                {translateText(streetRequestsError)}
              </Text>
            </View>
          ) : null}

          <ScrollView
            contentContainerStyle={[
              styles.requestsModalList,
              styles.requestsModalListGrow,
              { paddingBottom: Math.max(safeBottom + 22, 30) },
            ]}
            refreshControl={
              <RefreshControl
                colors={['#ff5a1f']}
                onRefresh={() => {
                  loadStreetRequests({ force: true, showLoader: true }).catch(() => {
                    return;
                  });
                }}
                progressViewOffset={6}
                refreshing={isLoadingStreetRequests}
                tintColor="#ff5a1f"
              />
            }
            showsVerticalScrollIndicator={false}
          >
            {streetIncomingRequests.length === 0 ? (
              <View style={styles.requestsModalEmpty}>
                <View style={styles.requestsModalEmptyIconWrap}>
                  <FeatherIcon color="#6b7280" name="map-pin" size={18} />
                </View>
                <Text
                  allowFontScaling={false}
                  style={styles.requestsModalEmptyTitle}
                >
                  {effectiveStreetIncomingRequestsCount > 0
                    ? translateText('Yeni istekler yükleniyor...')
                    : translateText('Şimdilik bekleyen Yakındakiler isteği yok')}
                </Text>
                <Text
                  allowFontScaling={false}
                  style={styles.requestsModalEmptyText}
                >
                  {effectiveStreetIncomingRequestsCount > 0
                    ? translateText(
                        'Liste kısa süre içinde güncellenecek, lütfen bekle.',
                      )
                    : translateText(
                        'Sana gelen Yakındakiler istekleri geldiğinde burada görünecek.',
                      )}
                </Text>
              </View>
            ) : (
              streetIncomingRequests.map((request, index) => {
                const requestAvatar =
                  request.avatarUrl.trim().length > 0
                    ? resolveProtectedMediaUrl(request.avatarUrl)
                    : FALLBACK_AVATAR;
                const statusText = translateText(
                  'Sana Yakındakiler isteği gönderdi.',
                );
                const isStreetRequestActionPending = pendingStreetRequestId != null;

                return (
                  <View key={request.id}>
                    <View className="min-h-[96px] flex-row items-start px-4 py-2.5">
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          handleOpenStreetRequestProfile(request);
                        }}
                        className="min-h-[60px] flex-1 flex-row items-start active:rounded-[14px] active:bg-[#f8fafd]"
                      >
                        <Image
                          className="h-12 w-12 rounded-full border border-[#e3e8f0] bg-[#f4f6fa]"
                          source={{ uri: requestAvatar }}
                        />

                        <View className="ml-3 mr-2 min-h-[60px] flex-1 justify-center">
                          <Text
                            allowFontScaling={false}
                            className="text-[14.5px] font-bold leading-[19px] text-[#111827]"
                          >
                            {request.fullName || request.username}
                          </Text>
                          <Text
                            allowFontScaling={false}
                            className="mt-0.5 text-[13px] text-[#6b7280]"
                          >
                            @{request.username}
                          </Text>
                          <Text
                            allowFontScaling={false}
                            className="mt-0.5 text-[11px] text-[#9aa2af]"
                          >
                            {translateText(
                              `${formatRequestAge(request.requestedAt)} once`,
                            )}
                          </Text>
                          <Text
                            allowFontScaling={false}
                            className="mt-1 text-[11.5px] font-medium text-[#64748b]"
                          >
                            {statusText}
                          </Text>
                        </View>
                      </Pressable>

                      <View className="ml-2 gap-2">
                        <Pressable
                          disabled={isStreetRequestActionPending}
                          onPress={() => {
                            handleStreetRequestAccept(request.id).catch(
                              () => {
                                return;
                              },
                            );
                          }}
                          className={`h-9 min-w-[96px] items-center justify-center rounded-[10px] bg-[#3797ef] px-4 ${
                            isStreetRequestActionPending ? 'opacity-55' : ''
                          }`}
                        >
                          <Text
                            allowFontScaling={false}
                            className="text-[12px] font-semibold text-white"
                          >
                            {translateText('Onayla')}
                          </Text>
                        </Pressable>

                        <Pressable
                          disabled={isStreetRequestActionPending}
                          onPress={() => {
                            handleStreetRequestReject(request.id).catch(() => {
                              return;
                            });
                          }}
                          className={`h-9 min-w-[96px] items-center justify-center rounded-[10px] border border-[#d9dde3] bg-[#f2f3f5] px-4 ${
                            isStreetRequestActionPending ? 'opacity-55' : ''
                          }`}
                        >
                          <Text
                            allowFontScaling={false}
                            className="text-[12px] font-semibold text-[#374151]"
                          >
                            {translateText('Sil')}
                          </Text>
                        </Pressable>
                      </View>
                    </View>

                    {index < streetIncomingRequests.length - 1 ? (
                      <View className="ml-[82px] mr-4 h-px bg-[#e6ebf2]" />
                    ) : null}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => {
          setIsFollowersModalVisible(false);
        }}
        navigationBarTranslucent={true}
        statusBarTranslucent={true}
        transparent={false}
        visible={isFollowersModalVisible}
      >
        <StatusBar
          animated={true}
          backgroundColor="transparent"
          barStyle="dark-content"
          translucent={true}
        />
        <View style={styles.requestsModalScreen}>
          <View
            style={[
              styles.requestsModalHeader,
              { paddingTop: Math.max(safeTop + 6, 16) },
            ]}
          >
            <Pressable
              onPress={() => {
                setIsFollowersModalVisible(false);
              }}
              style={styles.requestsModalIconButton}
            >
              <FeatherIcon color="#1f2937" name="arrow-left" size={18} />
            </Pressable>

            <View style={styles.requestsModalTitleWrap}>
              <Text allowFontScaling={false} style={styles.requestsModalTitle}>
                Takipçiler
              </Text>
              <Text
                allowFontScaling={false}
                style={styles.requestsModalSubtitle}
              >
                {followers.length} kişi
              </Text>
            </View>

            <View style={styles.requestsModalHeaderSpacer} />
          </View>

          {followersError ? (
            <View style={styles.requestsModalErrorWrap}>
              <Text allowFontScaling={false} style={styles.requestsError}>
                {followersError}
              </Text>
            </View>
          ) : null}

          <ScrollView
            contentContainerStyle={[
              styles.requestsModalList,
              styles.requestsModalListGrow,
              { paddingBottom: Math.max(safeBottom + 22, 30) },
            ]}
            refreshControl={
              <RefreshControl
                colors={['#ff5a1f']}
                onRefresh={() => {
                  loadFollowers({ force: true, showLoader: true }).catch(() => {
                    return;
                  });
                }}
                progressViewOffset={6}
                refreshing={isLoadingFollowers}
                tintColor="#ff5a1f"
              />
            }
            showsVerticalScrollIndicator={false}
          >
            {followers.length === 0 ? (
              <View style={styles.requestsModalEmpty}>
                <View style={styles.requestsModalEmptyIconWrap}>
                  <FeatherIcon color="#6b7280" name="users" size={18} />
                </View>
                <Text
                  allowFontScaling={false}
                  style={styles.requestsModalEmptyTitle}
                >
                  Henüz takipçin yok
                </Text>
                <Text
                  allowFontScaling={false}
                  style={styles.requestsModalEmptyText}
                >
                  Takipçilerin burada listelenecek.
                </Text>
              </View>
            ) : (
              followers.map((user, index) => {
                const avatar =
                  user.avatarUrl.trim().length > 0
                    ? user.avatarUrl
                    : FALLBACK_AVATAR;
                const isPending = pendingFollowerActionId === user.id;
                const followStatus = user.viewerState.followRequestStatus;
                const isFollowing = user.viewerState.isFollowing;
                const isIncomingRequest = followStatus === 'pending_incoming';
                const isOutgoingRequest = followStatus === 'pending_outgoing';
                const followLabel = isFollowing
                  ? 'Takipten Çık'
                  : isOutgoingRequest
                    ? 'İstek Gönderildi'
                    : isIncomingRequest
                      ? 'İstek Bekliyor'
                      : 'Takip Et';
                const primaryIdentityText = user.username.trim();
                const secondaryIdentityText =
                  user.fullName.trim().length > 0
                    ? user.fullName.trim()
                    : `@${user.username.trim()}`;
                const followActionTone =
                  isFollowing || isOutgoingRequest || isIncomingRequest
                    ? 'secondary'
                    : 'primary';

                return (
                  <View key={user.id}>
                    <UnifiedRelationRow
                      actionLabel={followLabel}
                      actionTone={followActionTone}
                      avatarUri={avatar}
                      isActionDisabled={isIncomingRequest}
                      isPending={isPending}
                      onAction={() => {
                        handleFollowToggle(user, 'followers').catch(() => {
                          return;
                        });
                      }}
                      onProfilePress={() => {
                        handleOpenRelationProfile(user);
                      }}
                      primaryText={primaryIdentityText}
                      secondaryText={secondaryIdentityText}
                    />
                    {index < followers.length - 1 ? (
                      <View className="ml-[82px] mr-4 h-px bg-[#e6ebf2]" />
                    ) : null}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => {
          setIsFollowingModalVisible(false);
        }}
        navigationBarTranslucent={true}
        statusBarTranslucent={true}
        transparent={false}
        visible={isFollowingModalVisible}
      >
        <StatusBar
          animated={true}
          backgroundColor="transparent"
          barStyle="dark-content"
          translucent={true}
        />
        <View style={styles.requestsModalScreen}>
          <View
            style={[
              styles.requestsModalHeader,
              { paddingTop: Math.max(safeTop + 6, 16) },
            ]}
          >
            <Pressable
              onPress={() => {
                setIsFollowingModalVisible(false);
              }}
              style={styles.requestsModalIconButton}
            >
              <FeatherIcon color="#1f2937" name="arrow-left" size={18} />
            </Pressable>

            <View style={styles.requestsModalTitleWrap}>
              <Text allowFontScaling={false} style={styles.requestsModalTitle}>
                Takip Edilenler
              </Text>
              <Text
                allowFontScaling={false}
                style={styles.requestsModalSubtitle}
              >
                {following.length} kişi
              </Text>
            </View>

            <View style={styles.requestsModalHeaderSpacer} />
          </View>

          {followingError ? (
            <View style={styles.requestsModalErrorWrap}>
              <Text allowFontScaling={false} style={styles.requestsError}>
                {followingError}
              </Text>
            </View>
          ) : null}

          <ScrollView
            contentContainerStyle={[
              styles.requestsModalList,
              styles.requestsModalListGrow,
              { paddingBottom: Math.max(safeBottom + 22, 30) },
            ]}
            refreshControl={
              <RefreshControl
                colors={['#ff5a1f']}
                onRefresh={() => {
                  loadFollowing({ force: true, showLoader: true }).catch(() => {
                    return;
                  });
                }}
                progressViewOffset={6}
                refreshing={isLoadingFollowing}
                tintColor="#ff5a1f"
              />
            }
            showsVerticalScrollIndicator={false}
          >
            {following.length === 0 ? (
              <View style={styles.requestsModalEmpty}>
                <View style={styles.requestsModalEmptyIconWrap}>
                  <FeatherIcon color="#6b7280" name="user-plus" size={18} />
                </View>
                <Text
                  allowFontScaling={false}
                  style={styles.requestsModalEmptyTitle}
                >
                  Henüz takip ettiğin yok
                </Text>
                <Text
                  allowFontScaling={false}
                  style={styles.requestsModalEmptyText}
                >
                  Yeni kişileri takip etmeye buradan başlayabilirsin.
                </Text>
              </View>
            ) : (
              following.map((user, index) => {
                const avatar =
                  user.avatarUrl.trim().length > 0
                    ? user.avatarUrl
                    : FALLBACK_AVATAR;
                const isPending = pendingFollowingActionId === user.id;
                const followStatus = user.viewerState.followRequestStatus;
                const isFollowing = user.viewerState.isFollowing;
                const isOutgoingRequest = followStatus === 'pending_outgoing';
                const followLabel = isFollowing
                  ? 'Takipten Çık'
                  : isOutgoingRequest
                    ? 'İstek Gönderildi'
                    : 'Takip Et';
                const primaryIdentityText = user.username.trim();
                const secondaryIdentityText =
                  user.fullName.trim().length > 0
                    ? user.fullName.trim()
                    : `@${user.username.trim()}`;
                const followActionTone =
                  isFollowing || isOutgoingRequest ? 'secondary' : 'primary';

                return (
                  <View key={user.id}>
                    <UnifiedRelationRow
                      actionLabel={followLabel}
                      actionTone={followActionTone}
                      avatarUri={avatar}
                      isPending={isPending}
                      onAction={() => {
                        handleFollowToggle(user, 'following').catch(() => {
                          return;
                        });
                      }}
                      onProfilePress={() => {
                        handleOpenRelationProfile(user);
                      }}
                      primaryText={primaryIdentityText}
                      secondaryText={secondaryIdentityText}
                    />
                    {index < following.length - 1 ? (
                      <View className="ml-[82px] mr-4 h-px bg-[#e6ebf2]" />
                    ) : null}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => {
          setIsStreetFriendsModalVisible(false);
        }}
        navigationBarTranslucent={true}
        statusBarTranslucent={true}
        transparent={false}
        visible={isStreetFriendsModalVisible}
      >
        <StatusBar
          animated={true}
          backgroundColor="transparent"
          barStyle="dark-content"
          translucent={true}
        />
        <View style={styles.requestsModalScreen}>
          <View
            style={[
              styles.requestsModalHeader,
              { paddingTop: Math.max(safeTop + 6, 16) },
            ]}
          >
            <Pressable
              onPress={() => {
                setIsStreetFriendsModalVisible(false);
              }}
              style={styles.requestsModalIconButton}
            >
              <FeatherIcon color="#1f2937" name="arrow-left" size={18} />
            </Pressable>

            <View style={styles.requestsModalTitleWrap}>
              <Text allowFontScaling={false} style={styles.requestsModalTitle}>
                Yakındakiler
              </Text>
              <Text
                allowFontScaling={false}
                style={styles.requestsModalSubtitle}
              >
                {streetFriends.length} kişi
              </Text>
            </View>

            <View style={styles.requestsModalHeaderSpacer} />
          </View>

          {streetFriendsError ? (
            <View style={styles.requestsModalErrorWrap}>
              <Text allowFontScaling={false} style={styles.requestsError}>
                {streetFriendsError}
              </Text>
            </View>
          ) : null}

          <ScrollView
            contentContainerStyle={[
              styles.requestsModalList,
              styles.requestsModalListGrow,
              { paddingBottom: Math.max(safeBottom + 22, 30) },
            ]}
            refreshControl={
              <RefreshControl
                colors={['#ff5a1f']}
                onRefresh={() => {
                  loadStreetFriends({ force: true, showLoader: true }).catch(() => {
                    return;
                  });
                }}
                progressViewOffset={6}
                refreshing={isLoadingStreetFriends}
                tintColor="#ff5a1f"
              />
            }
            showsVerticalScrollIndicator={false}
          >
            {streetFriends.length === 0 ? (
              <View style={styles.requestsModalEmpty}>
                <View style={styles.requestsModalEmptyIconWrap}>
                  <FeatherIcon color="#6b7280" name="map-pin" size={18} />
                </View>
                <Text
                  allowFontScaling={false}
                  style={styles.requestsModalEmptyTitle}
                >
                  Henüz Yakındakiler listen boş
                </Text>
                <Text
                  allowFontScaling={false}
                  style={styles.requestsModalEmptyText}
                >
                  Yakındakiler burada görünecek.
                </Text>
              </View>
            ) : (
              streetFriends.map((friend, index) => {
                const avatar =
                  friend.avatarUrl.trim().length > 0
                    ? friend.avatarUrl
                    : FALLBACK_AVATAR;
                const isPending = pendingStreetFriendActionId === friend.id;
                const primaryIdentityText = friend.username.trim();
                const secondaryIdentityText =
                  friend.fullName.trim().length > 0
                    ? friend.fullName.trim()
                    : `@${friend.username.trim()}`;

                return (
                  <View key={friend.id}>
                    <UnifiedRelationRow
                      actionLabel="Kaldır"
                      actionTone="danger"
                      avatarUri={avatar}
                      isPending={isPending}
                      onAction={() => {
                        handleRemoveStreetFriend(friend);
                      }}
                      onProfilePress={() => {
                        handleOpenStreetFriendProfile(friend);
                      }}
                      primaryText={primaryIdentityText}
                      secondaryText={secondaryIdentityText}
                    />
                    {index < streetFriends.length - 1 ? (
                      <View className="ml-[82px] mr-4 h-px bg-[#e6ebf2]" />
                    ) : null}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => {
          if (!isSavingEdit) {
            setIsEditModalVisible(false);
          }
        }}
        navigationBarTranslucent={true}
        statusBarTranslucent={true}
        transparent={false}
        visible={isEditModalVisible}
      >
        <StatusBar
          animated={true}
          backgroundColor="transparent"
          barStyle="dark-content"
          translucent={true}
        />
        <ProfileEditModalContent
          animatePressScale={animatePressScale}
          bioMaxLength={PROFILE_EDIT_BIO_MAX_LENGTH}
          contentBottomInset={contentBottomInset}
          editAvatarScale={editAvatarScale}
          editAvatarUrl={editAvatarUrl}
          editBio={editBio}
          editBirthDate={editBirthDate}
          editConfirmScale={editConfirmScale}
          editError={editError}
          editFirstName={editFirstName}
          editGender={editGender}
          editLastName={editLastName}
          editUsername={editUsername}
          editPhoneDialCode={editPhoneDialCode}
          editPhoneDigits={editPhoneDigits}
          isUsernameChecking={editUsernameStatus === 'loading'}
          isSaveEnabled={isEditFormDirty}
          isSavingEdit={isSavingEdit}
          onChangePhoto={() => {
            handleProfilePhotoPress('edit');
          }}
          onClose={() => {
            if (!isSavingEdit) {
              setIsEditModalVisible(false);
            }
          }}
          onOpenAccountInfo={() => {
            if (!isSavingEdit) {
              setIsEditModalVisible(false);
              setSettingsEntryScreen('account');
              setIsSettingsOpen(true);
            }
          }}
          onSave={() => {
            handleSaveProfileEdit().catch(() => {
              return;
            });
          }}
          setEditBio={setEditBio}
          setEditBirthDate={setEditBirthDate}
          setEditFirstName={setEditFirstName}
          setEditGender={setEditGender}
          setEditLastName={setEditLastName}
          setEditUsername={setEditUsername}
          setEditPhoneDialCode={setEditPhoneDialCode}
          setEditPhoneDigits={setEditPhoneDigits}
          canEditUsername={profile.authProvider === 'local'}
          usernameStatusMessage={editUsernameStatusMessage}
          usernameStatusTone={
            editUsernameStatus === 'available'
              ? 'success'
              : editUsernameStatus === 'taken' || editUsernameStatus === 'error'
                ? 'error'
                : 'muted'
          }
          safeBottom={safeBottom}
          safeTop={safeTop}
        />
      </Modal>

      {isAvatarActionLoading ? (
        <View style={styles.avatarActionLoadingOverlay}>
          <View style={styles.avatarActionLoadingCard}>
            <IosSpinner color="#ff5a1f" size="small" />
            <Text allowFontScaling={false} style={styles.avatarActionLoadingText}>
              Profil fotoğrafı güncelleniyor...
            </Text>
          </View>
        </View>
      ) : null}

      <Modal
        animationType="none"
        navigationBarTranslucent={true}
        onRequestClose={closeProfilePhotoActionSheet}
        statusBarTranslucent={true}
        transparent={true}
        visible={isAvatarActionSheetMounted}
      >
        <StatusBar
          animated={true}
          backgroundColor="transparent"
          barStyle="light-content"
          hidden={true}
          translucent={true}
        />
        <View style={styles.avatarActionSheetRoot}>
          <Animated.View
            pointerEvents="box-none"
            style={[
              styles.avatarActionSheetBackdropLayer,
              { opacity: avatarActionSheetBackdropOpacity },
            ]}
          >
            <Pressable
              onPress={closeProfilePhotoActionSheet}
              style={styles.avatarActionSheetBackdrop}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.avatarActionSheetCard,
              {
                opacity: avatarActionSheetOpacity,
                transform: [{ translateY: avatarActionSheetTranslateY }],
              },
              { paddingBottom: Math.max(safeBottom, 14) + 8 },
            ]}
          >
            <View style={styles.avatarActionSheetHandle} />
            <Text allowFontScaling={false} style={styles.avatarActionSheetTitle}>
              Profil Fotoğrafı
            </Text>
            <Text allowFontScaling={false} style={styles.avatarActionSheetSubtitle}>
              {isEmailLoginProfile
                ? 'Fotoğraf çek, galeriden seç veya mevcut fotoğrafını kaldır.'
                : 'Fotoğraf çek veya galeriden seç. Sosyal giriş hesaplarında kaldırma seçeneği gizlidir.'}
            </Text>

            <Pressable
              disabled={isAvatarActionBusy}
              onPress={() => {
                handleSelectPhotoFromCamera().catch(() => {
                  return;
                });
              }}
              style={[
                styles.avatarActionSheetItem,
                isAvatarActionBusy ? styles.avatarActionSheetItemDisabled : null,
              ]}
            >
              <FeatherIcon color="#111827" name="camera" size={17} />
              <Text allowFontScaling={false} style={styles.avatarActionSheetItemText}>
                Fotoğraf Çek
              </Text>
            </Pressable>

            <Pressable
              disabled={isAvatarActionBusy}
              onPress={() => {
                handleSelectPhotoFromGallery().catch(() => {
                  return;
                });
              }}
              style={[
                styles.avatarActionSheetItem,
                isAvatarActionBusy ? styles.avatarActionSheetItemDisabled : null,
              ]}
            >
              <FeatherIcon color="#111827" name="image" size={17} />
              <Text allowFontScaling={false} style={styles.avatarActionSheetItemText}>
                Galeriden Seç
              </Text>
            </Pressable>

            {canDeleteAvatarFromActionSheet ? (
              <Pressable
                disabled={isAvatarActionBusy}
                onPress={handleDeletePhotoOptionPress}
                style={[
                  styles.avatarActionSheetItem,
                  isAvatarActionBusy ? styles.avatarActionSheetItemDisabled : null,
                ]}
              >
                <FeatherIcon color="#b42318" name="trash-2" size={17} />
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.avatarActionSheetItemText,
                    styles.avatarActionSheetItemTextDanger,
                  ]}
                >
                  Fotoğrafı Sil
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              disabled={isAvatarActionLoading}
              onPress={closeProfilePhotoActionSheet}
              style={[
                styles.avatarActionSheetCancelButton,
                isAvatarActionLoading ? styles.avatarActionSheetItemDisabled : null,
              ]}
            >
              <Text allowFontScaling={false} style={styles.avatarActionSheetCancelText}>
                İptal
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>

      <CameraCaptureModal
        onCaptureComplete={handleAvatarCameraCapture}
        onClose={() => {
          setIsAvatarCameraModalVisible(false);
        }}
        safeBottom={safeBottom}
        safeTop={safeTop}
        visible={isAvatarCameraModalVisible}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderColor: '#f4f4f6',
    borderRadius: 56,
    borderWidth: 3,
    height: 112,
    width: 112,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    backgroundColor: '#eaedf3',
    justifyContent: 'center',
  },
  avatarInitialsText: {
    color: '#6b7280',
    fontSize: 32,
    fontWeight: '600',
    letterSpacing: 1,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 18,
  },
  avatarWrap: {
    marginBottom: 10,
    position: 'relative',
  },
  avatarActionLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(6, 10, 18, 0.26)',
    justifyContent: 'center',
    zIndex: 140,
  },
  avatarActionLoadingCard: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e3e7ef',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 48,
    paddingHorizontal: 14,
    shadowColor: '#020617',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
  },
  avatarActionLoadingText: {
    color: '#1f2937',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 10,
  },
  avatarActionSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9, 13, 24, 0.44)',
  },
  avatarActionSheetBackdropLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  avatarActionSheetCard: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  avatarActionSheetCancelButton: {
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderColor: '#e5e7eb',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 48,
  },
  avatarActionSheetCancelText: {
    color: '#4b5563',
    fontSize: 14.5,
    fontWeight: '700',
  },
  avatarActionSheetHandle: {
    alignSelf: 'center',
    backgroundColor: '#d5dbe6',
    borderRadius: 999,
    height: 5,
    marginBottom: 10,
    width: 44,
  },
  avatarActionSheetItem: {
    alignItems: 'center',
    borderColor: '#eef2f7',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 10,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  avatarActionSheetItemDisabled: {
    opacity: 0.56,
  },
  avatarActionSheetItemText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 10,
  },
  avatarActionSheetItemTextDanger: {
    color: '#b42318',
  },
  avatarActionSheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  avatarActionSheetTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
    marginTop: 2,
    textAlign: 'center',
  },
  avatarActionSheetSubtitle: {
    color: '#64748b',
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 4,
    textAlign: 'center',
  },
  cameraBadge: {
    alignItems: 'center',
    backgroundColor: '#ff6b1a',
    borderColor: '#f4f4f6',
    borderRadius: 13,
    borderWidth: 2,
    bottom: 2,
    height: 26,
    justifyContent: 'center',
    position: 'absolute',
    right: -2,
    width: 26,
  },
  content: {
    paddingHorizontal: 14,
  },
  collectionStateCard: {
    maxWidth: 336,
  },
  collectionLoadingState: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 188,
  },
  collectionLoadingText: {
    color: '#6b7280',
    fontSize: 13.5,
    marginTop: 12,
    textAlign: 'center',
  },
  editButton: {
    alignItems: 'center',
    backgroundColor: '#ff5a16',
    borderRadius: 28,
    height: 48,
    justifyContent: 'center',
    marginBottom: 14,
  },
  editButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '500',
  },
  emptyIconWrap: {
    alignItems: 'center',
    backgroundColor: '#eef2f7',
    borderColor: '#d8dfeb',
    borderRadius: 42,
    borderWidth: 1.5,
    height: 84,
    justifyContent: 'center',
    width: 84,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 188,
  },
  emptyText: {
    color: '#798194',
    fontSize: 13.5,
    lineHeight: 20,
    marginTop: 8,
    maxWidth: 260,
    textAlign: 'center',
  },
  emptyPrimaryText: {
    color: '#6d7484',
    fontSize: 14.5,
    fontWeight: '400',
    marginTop: 12,
    textAlign: 'center',
  },
  errorText: {
    color: '#a0422b',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  loadMoreButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#ff5a16',
    borderRadius: 18,
    height: 38,
    justifyContent: 'center',
    marginTop: 6,
    paddingHorizontal: 18,
  },
  loadMoreText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '500',
  },
  nameText: {
    color: '#1a1d24',
    fontSize: 18,
    fontWeight: '500',
    letterSpacing: -0.2,
    marginBottom: 1,
  },
  postsSectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
    marginTop: 2,
  },
  postsSectionTitle: {
    color: '#0f172a',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  postsFeed: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingBottom: 8,
    width: '100%',
  },
  compactPostCardWithGap: {
    marginRight: 8,
  },
  postCard: {
    alignSelf: 'center',
    backgroundColor: '#e7ebf2',
    borderColor: '#e5e9f0',
    borderRadius: PROFILE_POST_CARD_RADIUS,
    borderWidth: 1,
    elevation: 4,
    marginBottom: PROFILE_POST_CARD_GAP,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    width: '94%',
  },
  postCardPending: {
    opacity: 0.58,
  },
  postCardMediaShell: {
    aspectRatio: PROFILE_POST_MEDIA_ASPECT,
    backgroundColor: '#0f172a',
    position: 'relative',
    width: '100%',
  },
  postCardImage: {
    height: '100%',
    width: '100%',
  },
  postCardOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    bottom: 0,
    flexDirection: 'row',
    left: 0,
    paddingBottom: 12,
    paddingHorizontal: 14,
    paddingTop: 28,
    position: 'absolute',
    right: 0,
  },
  postCardStat: {
    alignItems: 'center',
    flexDirection: 'row',
    marginRight: 18,
  },
  postCardStatText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 7,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  postCardMenuButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.76)',
    borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: 16,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    position: 'absolute',
    right: 12,
    top: 12,
    width: 34,
    zIndex: 6,
  },
  postCardMenuButtonDisabled: {
    opacity: 0.72,
  },
  postCardMenuPendingText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginTop: -1,
  },
  postCardUnavailableBody: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 168,
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  postNoticeCard: {
    borderRadius: 999,
    minHeight: 36,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  postNoticeCardError: {
    backgroundColor: 'rgba(127, 29, 29, 0.95)',
  },
  postNoticeCardSuccess: {
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
  },
  postNoticeText: {
    color: '#f8fafc',
    fontSize: 12.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  postNoticeWrap: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 120,
  },
  postActionsSheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  postActionsSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3, 7, 18, 0.52)',
  },
  postActionsSheetCard: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  postActionsSheetHandle: {
    alignSelf: 'center',
    backgroundColor: '#d5dbe6',
    borderRadius: 999,
    height: 5,
    marginBottom: 12,
    width: 44,
  },
  postActionsSheetTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  postActionsSheetSubtitle: {
    color: '#64748b',
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 4,
    textAlign: 'center',
  },
  postActionsSheetItem: {
    alignItems: 'center',
    borderColor: '#e6ebf4',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 50,
    paddingHorizontal: 14,
    marginTop: 12,
  },
  postActionsSheetItemDanger: {
    backgroundColor: '#fff7f7',
    borderColor: '#fde5e5',
  },
  postActionsSheetItemDisabled: {
    opacity: 0.58,
  },
  postActionsSheetItemText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 10,
  },
  postActionsSheetItemTextDanger: {
    color: '#b42318',
  },
  postActionsSheetCancelButton: {
    alignItems: 'center',
    backgroundColor: '#f3f6fb',
    borderRadius: 14,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 50,
  },
  postActionsSheetCancelText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
  },
  unavailablePostTile: {
    backgroundColor: '#f3f6fb',
    borderColor: '#dbe3f0',
    borderWidth: 1,
  },
  unavailableTileIconWrap: {
    alignItems: 'center',
    backgroundColor: '#e4eaf4',
    borderRadius: 999,
    height: 28,
    justifyContent: 'center',
    marginBottom: 7,
    width: 28,
  },
  unavailableTileTitle: {
    color: '#4b5567',
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
    textAlign: 'center',
  },
  unavailableTileSubtitle: {
    color: '#7b8798',
    fontSize: 10,
    fontWeight: '500',
    lineHeight: 13,
    textAlign: 'center',
  },
  stateChipsRow: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  privacyStateChip: {
    alignItems: 'center',
    backgroundColor: '#eef1f6',
    borderColor: '#dde2eb',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  privacyStateText: {
    color: '#4b5563',
    fontSize: 11.5,
    fontWeight: '500',
  },
  streetRequestsCountPill: {
    alignItems: 'center',
    backgroundColor: '#dbeafe',
    borderColor: '#bfdbfe',
    borderRadius: 99,
    borderWidth: 1,
    justifyContent: 'center',
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  streetRequestsCountText: {
    color: '#1d4ed8',
    fontSize: 11,
    fontWeight: '600',
  },
  requestAcceptButton: {
    alignItems: 'center',
    backgroundColor: '#16a34a',
    borderRadius: 12,
    height: 28,
    justifyContent: 'center',
    minWidth: 62,
    paddingHorizontal: 10,
  },
  requestAcceptText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '500',
  },
  requestActionDisabled: {
    opacity: 0.7,
  },
  requestActionWrap: {
    flexDirection: 'row',
    gap: 8,
  },
  streetRequestActions: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
    marginTop: 0,
    minWidth: 158,
  },
  streetRequestIdentityPressable: {
    alignItems: 'flex-start',
    flex: 1,
    flexDirection: 'row',
    marginRight: 8,
  },
  streetRequestPendingPill: {
    alignItems: 'center',
    backgroundColor: '#f2f4f8',
    borderColor: '#d8dde7',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 28,
    minWidth: 108,
    paddingHorizontal: 10,
  },
  streetRequestPendingText: {
    color: '#616a79',
    fontSize: 10.5,
    fontWeight: '600',
  },
  streetRequestStatusText: {
    color: '#7d8797',
    fontSize: 11.5,
    lineHeight: 15,
    marginTop: 4,
  },
  requestAvatar: {
    borderRadius: 18,
    height: 36,
    width: 36,
  },
  requestMeta: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  requestName: {
    color: '#1f2530',
    fontSize: 13,
    fontWeight: '500',
  },
  requestRejectButton: {
    alignItems: 'center',
    backgroundColor: '#f2f4f8',
    borderColor: '#d8dde7',
    borderRadius: 12,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    minWidth: 56,
    paddingHorizontal: 10,
  },
  requestRejectText: {
    color: '#5e6778',
    fontSize: 11,
    fontWeight: '500',
  },
  requestRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 10,
  },
  requestUsername: {
    color: '#7f8694',
    fontSize: 11,
  },
  requestsCard: {
    backgroundColor: '#f9f9fb',
    borderColor: '#e3e7ef',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  requestsCountPill: {
    alignItems: 'center',
    backgroundColor: '#eaf0fa',
    borderRadius: 11,
    justifyContent: 'center',
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  requestsCountText: {
    color: '#465167',
    fontSize: 11,
    fontWeight: '600',
  },
  requestsError: {
    color: '#ab3f2f',
    fontSize: 11,
    marginBottom: 8,
  },
  requestsEntryAvatarStack: {
    flexDirection: 'row',
  },
  requestsEntryCard: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e6ebf2',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 9,
    position: 'relative',
  },
  requestsEntryStateChip: {
    alignItems: 'center',
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  requestsEntryStateChipText: {
    color: '#92400e',
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  streetRequestsEntryCard: {
    backgroundColor: '#f2f7ff',
    borderColor: '#d6e5ff',
  },
  streetRequestsEntryStateChip: {
    backgroundColor: '#dbeafe',
    borderColor: '#bfdbfe',
  },
  streetRequestsEntryStateChipText: {
    color: '#1d4ed8',
  },
  streetRequestsEntryIconWrap: {
    backgroundColor: '#e8f0ff',
    borderColor: '#cfe1ff',
    borderWidth: 1,
  },
  requestsEntryIconWrap: {
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    marginRight: 9,
    width: 24,
  },
  requestsEntryLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
  },
  requestsEntryMeta: {
    flex: 1,
  },
  requestsEntryPreviewAvatar: {
    borderColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1.5,
    height: 16,
    width: 16,
  },
  requestsEntryPreviewAvatarMiddle: {
    zIndex: 2,
  },
  requestsEntryPreviewAvatarOffset: {
    marginLeft: -7,
  },
  requestsEntryPreviewAvatarTop: {
    zIndex: 3,
  },
  requestsEntryPreviewRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 4,
  },
  requestsEntryPreviewText: {
    color: '#7b8796',
    fontSize: 10.5,
    marginLeft: 7,
  },
  requestsEntrySubtitle: {
    color: '#6b7788',
    fontSize: 11.5,
    marginTop: 1,
  },
  requestsEntrySubtitleUnread: {
    color: '#1f3b8c',
    fontWeight: '700',
  },
  requestsEntryTitle: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '600',
  },
  requestsEntryTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  requestsInlineError: {
    marginBottom: 12,
    marginTop: -1,
    paddingHorizontal: 4,
  },
  requestsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  requestsInfoText: {
    color: '#707887',
    fontSize: 12,
    marginBottom: 10,
  },
  requestsLoadingWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  requestsRefreshButton: {
    alignItems: 'center',
    borderTopColor: '#e8ebf1',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: 2,
    paddingBottom: 10,
    paddingTop: 9,
  },
  requestsRefreshText: {
    color: '#5d6678',
    fontSize: 11,
    fontWeight: '500',
  },
  requestsTitle: {
    color: '#1f2531',
    fontSize: 13,
    fontWeight: '600',
  },
  requestsTitleWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  requestsModalAcceptButton: {
    alignItems: 'center',
    backgroundColor: '#3797ef',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    minWidth: 78,
    paddingHorizontal: 14,
  },
  requestsModalAcceptText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  requestsModalActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  requestsModalAvatar: {
    backgroundColor: '#f4f6fa',
    borderColor: '#e3e8f0',
    borderWidth: 1,
    borderRadius: 24,
    height: 48,
    width: 48,
  },
  requestsModalDivider: {
    backgroundColor: '#eceff4',
    height: 1,
    marginHorizontal: 14,
    opacity: 0.9,
  },
  requestsModalEmpty: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  requestsModalEmptyIconWrap: {
    alignItems: 'center',
    backgroundColor: '#eef1f4',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    marginBottom: 12,
    width: 48,
  },
  requestsModalEmptyText: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
  requestsModalEmptyTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  requestsModalErrorWrap: {
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  requestsModalHeader: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderBottomColor: '#e9edf4',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  requestsModalHeaderSpacer: {
    height: 34,
    width: 34,
  },
  requestsModalIconButton: {
    alignItems: 'center',
    backgroundColor: '#f2f4f8',
    borderColor: '#e4e8ef',
    borderRadius: 17,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  requestsModalList: {
    backgroundColor: '#ffffff',
    paddingTop: 2,
  },
  requestsModalListGrow: {
    flexGrow: 1,
  },
  requestsModalMeta: {
    flex: 1,
    marginLeft: 11,
    marginRight: 8,
  },
  streetRequestsModalMeta: {
    marginTop: 1,
  },
  requestsModalName: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
  },
  requestsModalNameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  requestsModalRejectButton: {
    alignItems: 'center',
    backgroundColor: '#f2f3f5',
    borderColor: '#d9dde3',
    borderRadius: 10,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    minWidth: 70,
    paddingHorizontal: 12,
  },
  requestsModalRejectText: {
    color: '#374151',
    fontSize: 12,
    fontWeight: '600',
  },
  relationActionButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    minWidth: 104,
    paddingHorizontal: 12,
  },
  relationActionDisabled: {
    opacity: 0.55,
  },
  relationActionPressed: {
    opacity: 0.84,
  },
  relationIdentityPressable: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    minHeight: 52,
  },
  relationIdentityPressed: {
    backgroundColor: '#f8fafd',
    borderRadius: 14,
  },
  relationListDivider: {
    backgroundColor: '#e6ebf2',
    height: 1,
    marginLeft: 82,
    marginRight: 16,
  },
  relationSimpleAvatar: {
    backgroundColor: '#f4f6fa',
    borderColor: '#e3e8f0',
    borderRadius: 26,
    borderWidth: 1,
    height: 52,
    width: 52,
  },
  relationSimpleMeta: {
    flex: 1,
    justifyContent: 'center',
    marginLeft: 12,
    marginRight: 10,
    minHeight: 52,
  },
  relationSimplePrimaryTextLabel: {
    color: '#111827',
    fontSize: 14.5,
    fontWeight: '700',
    lineHeight: 19,
  },
  relationSimpleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 74,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  relationSimpleSecondaryTextLabel: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  requestsModalRow: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  streetRequestsModalRow: {
    alignItems: 'flex-start',
    paddingBottom: 12,
    paddingTop: 12,
  },
  requestsModalScreen: {
    backgroundColor: '#ffffff',
    flex: 1,
  },
  requestsModalSubtitle: {
    color: '#7c8495',
    fontSize: 11.5,
    marginTop: 2,
    textAlign: 'center',
  },
  requestsModalTime: {
    color: '#9aa2af',
    fontSize: 11,
    marginTop: 2,
  },
  requestsModalTitle: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  requestsModalTitleWrap: {
    alignItems: 'center',
    flex: 1,
  },
  requestsModalUsername: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 2,
  },
  relationSimpleActionWrap: {
    alignItems: 'stretch',
    justifyContent: 'center',
    marginLeft: 12,
  },
  relationSimpleActionButton: {
    borderRadius: 11,
    height: 36,
    minWidth: 112,
    paddingHorizontal: 16,
  },
  relationSimplePrimaryButton: {
    backgroundColor: 'transparent',
    borderColor: '#ff5a1f',
    borderWidth: 1.5,
  },
  relationSimplePrimaryText: {
    color: '#ff5a1f',
    fontSize: 13,
    fontWeight: '700',
  },
  relationSimpleSecondaryButton: {
    backgroundColor: '#f4f7fb',
    borderColor: '#dce4ee',
    borderWidth: 1,
  },
  relationSimpleSecondaryText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
  },
  relationSimpleDangerButton: {
    backgroundColor: '#fff3ef',
    borderColor: '#f7c2b5',
    borderWidth: 1,
  },
  relationSimpleDangerText: {
    color: '#c2410c',
    fontSize: 13,
    fontWeight: '700',
  },
  requestsToggleButton: {
    alignItems: 'center',
    marginBottom: 10,
    marginTop: -2,
  },
  requestsToggleText: {
    color: '#ff5a16',
    fontSize: 11,
    fontWeight: '600',
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: '#ff5a16',
    borderRadius: 14,
    height: 38,
    justifyContent: 'center',
    marginTop: 10,
    paddingHorizontal: 16,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '500',
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: '#ff5a16',
    borderRadius: 14,
    height: 42,
    justifyContent: 'center',
    marginTop: 8,
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  screen: {
    backgroundColor: '#f2f2f5',
    flex: 1,
  },
  segmentDivider: {
    backgroundColor: '#e2e5ec',
    height: 1,
    marginBottom: 16,
    marginTop: 8,
  },
  segmentItem: {
    alignItems: 'center',
    backgroundColor: '#e7e9ee',
    borderColor: '#dadde5',
    borderRadius: 20,
    borderWidth: 1,
    flex: 1,
    height: 44,
    justifyContent: 'center',
  },
  segmentItemActive: {
    backgroundColor: '#ff5a16',
    borderColor: '#ff5a16',
  },
  segmentWrap: {
    flexDirection: 'row',
    gap: 10,
  },
  statCell: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  statCellPressable: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    width: '100%',
  },
  statDivider: {
    backgroundColor: '#e2e3e7',
    height: 28,
    width: 1,
  },
  statLabel: {
    color: '#8f94a0',
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 0.2,
    marginTop: 2,
    textAlign: 'center',
  },
  statValue: {
    color: '#333',
    fontSize: 18,
    fontWeight: '600',
  },
  statsCard: {
    alignItems: 'center',
    backgroundColor: '#f9f9fa',
    borderColor: '#e2e4ea',
    borderRadius: 19,
    borderWidth: 1,
    flexDirection: 'row',
    height: 84,
    marginBottom: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
  },
  usernameText: {
    color: '#687182',
    fontSize: 12,
  },
  profileBioCard: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  profileBioText: {
    color: '#334155',
    fontSize: 13,
    lineHeight: 16,
    textAlign: 'center',
  },
  profileBioTextPlaceholder: {
    color: '#94a3b8',
    fontStyle: 'italic',
  },
});

