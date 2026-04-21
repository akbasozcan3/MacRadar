import React, { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AppState,
  type AppStateStatus,
  Modal,
  NativeModules,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Login from '../../screens/Login/Login';
import LoginPasswordReset from '../../screens/Login/LoginPasswordReset';
import ExploreScreen from '../../screens/ExploreScreen/ExploreScreen';
import HomeScreen from '../../screens/HomeScreen/HomeScreen';
import MessagesScreen from '../../screens/MessagesScreen/MessagesScreen';
import ProfileScreen from '../../screens/ProfileScreen/ProfileScreen';
import NotificationScreen from '../../screens/NotificationScreen/NotificationScreen';
import TabBar from '../../components/TabBar/TabBar';
import { emitProfilePostCreated } from '../../services/profilePostEvents';
import { publishProfilePost } from '../../services/profilePostPublisher';
import { queueExploreFeedSeedFromCreatedProfilePost } from '../../services/exploreFeedPendingSeed';
import { resolveProtectedMediaUrl } from '../../services/protectedMedia';
import { resolveProfileAvatarUrl } from '../../utils/profileAvatar';
import PostComposerModal, {
  type PostComposerDraft,
} from '../../components/CameraCapture/PostComposerModal';
import {
  confirmPasswordReset,
  fetchProfileNotifications,
  fetchMyProfile,
  fetchProfileAppSettings,
  fetchProfileRequestSummary,
  logoutUser,
  markProfileNotificationsRead,
  requestPasswordReset,
} from '../../services/authService';
import type { ProfileNotificationItem } from '../../services/authService';
import { getAppLanguage, setAppLanguage, subscribeAppLanguage, translateText } from '../../i18n/runtime';
import {
  isApiRequestError,
  setApiSessionToken,
  setApiUnauthorizedHandler,
} from '../../services/apiClient';
import { triggerSelectionHaptic } from '../../services/haptics';
import {
  bootstrapNotifications,
  createNotificationsSocket,
  displayRealtimeNotification,
} from '../../services/notificationService';
import {
  clearStoredProfileCache,
  clearStoredSessionToken,
  readStoredProfileCache,
  readStoredSessionToken,
  storeProfileCache,
  storeSessionToken,
} from '../../services/sessionStorage';
import { syncI18nBundleWithCurrentLanguage } from '../../services/i18nService';
import { Text } from '../../theme/typography';
import type {
  AuthResponse,
  UserProfile,
} from '../../types/AuthTypes/AuthTypes';
import type { ExploreSearchUser } from '../../types/ExploreTypes/ExploreTypes';
import type {
  PasswordResetFormState,
  PasswordResetSession,
} from '../../screens/Login/Login.types';
import {
  createInitialPasswordResetForm,
  normalizeOptionalResetEmail,
  sanitizePasswordResetValue,
} from '../../screens/Login/passwordResetFlow';
import type {
  ExploreViewerRequest,
  TabKey,
} from '../../types/AppTypes/AppTypes';
import LoginWelcomeModal from './LoginWelcomeModal';
import {
  emitRealtimeFollowRequest,
  emitRealtimeStreetRequest,
} from '../../realtime/incomingRequestsBridge';

const SESSION_RESTORE_MAX_RETRIES = 4;
const NOTIFICATION_CATCH_UP_FETCH_LIMIT = 24;
const NOTIFICATION_HEARTBEAT_MS = 25_000;
const NOTIFICATION_READ_FLUSH_MS = 700;
const NOTIFICATION_RECONNECT_BASE_DELAY_MS = 1_200;
const NOTIFICATION_RECONNECT_MAX_DELAY_MS = 12_000;
const REQUEST_SUMMARY_MIN_REFRESH_GAP_MS = 1_000;
const EXTERNAL_PUBLIC_PROFILE_RETURNABLE_TABS: readonly TabKey[] = [
  'home',
  'messages',
  'notifications',
  'profile',
];

type CameraCaptureModalComponentProps = {
  onCaptureComplete: (payload: {
    capturedAt: string;
    mediaType: 'photo' | 'video';
    mediaUrl: string;
    source?: 'camera' | 'gallery';
    thumbnailUrl?: string;
  }) => Promise<void> | void;
  onClose: () => void;
  safeBottom: number;
  safeTop: number;
  visible: boolean;
};

function isCachedProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<UserProfile> & {
    stats?: Partial<UserProfile['stats']>;
  };
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.email !== 'string' ||
    typeof candidate.username !== 'string'
  ) {
    return false;
  }
  if (!candidate.stats || typeof candidate.stats !== 'object') {
    return false;
  }

  return (
    typeof candidate.stats.followersCount === 'number' &&
    typeof candidate.stats.followingCount === 'number' &&
    typeof candidate.stats.routesCount === 'number' &&
    typeof candidate.stats.streetFriendsCount === 'number'
  );
}

function normalizeProfileMedia(profile: UserProfile): UserProfile {
  return {
    ...profile,
    avatarUrl: resolveProtectedMediaUrl(profile.avatarUrl),
  };
}

function isSessionInvalidError(error: unknown) {
  if (!isApiRequestError(error)) {
    return false;
  }

  return (
    error.status === 401 ||
    error.code === 'unauthorized' ||
    error.code === 'session_expired' ||
    error.code === 'invalid_session'
  );
}

function normalizeNotificationId(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getRequesterIdFromNotification(notification: ProfileNotificationItem) {
  const meta =
    notification.metadata && typeof notification.metadata === 'object'
      ? (notification.metadata as Record<string, unknown>)
      : null;
  const fromMeta =
    meta && typeof meta.requesterId === 'string' ? meta.requesterId.trim() : '';
  if (fromMeta) {
    return fromMeta;
  }
  const fromUser =
    typeof notification.fromUserId === 'string' ? notification.fromUserId.trim() : '';
  if (fromUser) {
    return fromUser;
  }
  return typeof notification.actorId === 'string' ? notification.actorId.trim() : '';
}

function getActorIdFromNotification(notification: ProfileNotificationItem) {
  const actorId =
    typeof notification.actorId === 'string' ? notification.actorId.trim() : '';
  if (actorId) {
    return actorId;
  }
  const fromUserId =
    typeof notification.fromUserId === 'string'
      ? notification.fromUserId.trim()
      : '';
  if (fromUserId) {
    return fromUserId;
  }
  return getRequesterIdFromNotification(notification);
}

function getIncomingRequestNotificationKind(
  notification: ProfileNotificationItem,
) {
  const type = String(notification.type || '').trim();
  if (type === 'follow.request.created' || type === 'follow_request') {
    return 'follow' as const;
  }
  if (
    type === 'street_friend.request.created' ||
    type === 'street_friend_request'
  ) {
    return 'street' as const;
  }
  return null;
}

function rememberNotificationIds(target: Set<string>, items: ProfileNotificationItem[]) {
  items.forEach(item => {
    const nextId = normalizeNotificationId(item.id);
    if (!nextId) {
      return;
    }
    target.add(nextId);
  });

  while (target.size > 240) {
    const oldest = target.values().next().value;
    if (typeof oldest !== 'string') {
      break;
    }
    target.delete(oldest);
  }
}

function renderActiveScreen(
  activeTab: TabKey,
  safeTop: number,
  safeBottom: number,
  contentBottomInset: number,
  onBack: () => void,
  onOpenProfileTab: () => void,
  openProfileEditRequestId: number,
  onProfileEditRequestConsumed: () => void,
  profile: UserProfile,
  viewerId: string,
  onProfileChange: (profile: UserProfile) => void,
  onLogout: () => void,
  onForgotPassword?: (email: string) => void,
  onFollowRequestsCountChange?: (count: number) => void,
  onStreetRequestsCountChange?: (count: number) => void,
  onStreetRequestsViewed?: (count: number) => void,
  followRequestsBadgeCount?: number,
  streetRequestsBadgeCount?: number,
  onOpenDirectMessageFromExplore?: (user: ExploreSearchUser) => void,
  onOpenPublicProfileFromMessages?: (user: ExploreSearchUser) => void,
  onOpenPublicProfileFromProfile?: (user: ExploreSearchUser) => void,
  prefillExploreProfileUser?: ExploreSearchUser | null,
  prefillExploreProfileReturnTab?: TabKey | null,
  onPrefillExploreProfileUserConsumed?: () => void,
  onPrefillExploreProfileBackRequested?: (returnTab: TabKey) => void,
  prefillExploreViewerRequest?: ExploreViewerRequest | null,
  onPrefillExploreViewerRequestConsumed?: () => void,
  directMessageRecipient?: ExploreSearchUser | null,
  onDirectMessageRecipientConsumed?: () => void,
  onConversationOpenChange?: (open: boolean) => void,
  onOpenExploreViewerFromProfile?: (request: ExploreViewerRequest) => void,
  onHomeOverlayVisibilityChange?: (visible: boolean) => void,
  onOpenNotifications?: () => void,
  onOpenMessages?: () => void,
  onNotificationPress?: (notification: ProfileNotificationItem) => void,
  unreadMessagesCount?: number,
  unreadNotificationsCount?: number,
) {
  switch (activeTab) {
    case 'home':
      return (
        <HomeScreen
          contentBottomInset={contentBottomInset}
          onOpenDirectMessage={onOpenDirectMessageFromExplore}
          onOpenMessages={onOpenMessages}
          onOpenNotifications={onOpenNotifications}
          onOpenProfile={onOpenProfileTab}
          onOverlayVisibilityChange={onHomeOverlayVisibilityChange}
          onProfileChange={onProfileChange}
          onStreetRequestsViewed={onStreetRequestsViewed}
          profile={profile}
          safeTop={safeTop}
          unreadMessagesCount={unreadMessagesCount}
          unreadNotificationsCount={unreadNotificationsCount}
        />
      );
    case 'explore':
      return (
        <ExploreScreen
          contentBottomInset={contentBottomInset}
          onBack={onBack}
          onOpenDirectMessage={onOpenDirectMessageFromExplore}
          onPrefillPublicProfileUserConsumed={
            onPrefillExploreProfileUserConsumed
          }
          onPrefillPublicProfileBackRequested={
            onPrefillExploreProfileBackRequested
          }
          onPrefillViewerRequestConsumed={onPrefillExploreViewerRequestConsumed}
          prefillPublicProfileUser={prefillExploreProfileUser}
          prefillPublicProfileReturnTab={prefillExploreProfileReturnTab}
          prefillViewerRequest={prefillExploreViewerRequest}
          safeBottom={safeBottom}
          safeTop={safeTop}
          viewerAvatarUrl={resolveProfileAvatarUrl(profile)}
          viewerId={viewerId}
          viewerUsername={String(profile.username ?? '').trim()}
        />
      );
    case 'messages':
      return (
        <MessagesScreen
          contentBottomInset={contentBottomInset}
          displayName={profile.fullName}
          onConversationOpenChange={onConversationOpenChange}
          onOpenPublicProfile={onOpenPublicProfileFromMessages}
          onPrefillRecipientConsumed={onDirectMessageRecipientConsumed}
          prefillRecipient={directMessageRecipient}
          safeTop={safeTop}
          viewerId={viewerId}
        />
      );
    case 'profile':
      return (
        <ProfileScreen
          contentBottomInset={contentBottomInset}
          openEditRequestId={openProfileEditRequestId}
          onOpenEditRequestConsumed={onProfileEditRequestConsumed}
          onFollowRequestsCountChange={onFollowRequestsCountChange}
          onForgotPassword={onForgotPassword}
          onOpenDirectMessage={onOpenDirectMessageFromExplore}
          onOpenExploreViewer={onOpenExploreViewerFromProfile}
          onOpenPublicProfile={onOpenPublicProfileFromProfile}
          onLogout={onLogout}
          onProfileChange={onProfileChange}
          onStreetRequestsCountChange={onStreetRequestsCountChange}
          onStreetRequestsViewed={onStreetRequestsViewed}
          followRequestsBadgeCount={followRequestsBadgeCount}
          profile={profile}
          safeBottom={safeBottom}
          safeTop={safeTop}
          streetRequestsBadgeCount={streetRequestsBadgeCount}
        />
      );
    case 'notifications':
      return (
        <NotificationScreen
          onBack={onBack}
          onNotificationPress={onNotificationPress}
          safeTop={safeTop}
        />
      );
    default:
      return (
        <HomeScreen
          contentBottomInset={contentBottomInset}
          onOpenDirectMessage={onOpenDirectMessageFromExplore}
          onOpenMessages={onOpenMessages}
          onOpenNotifications={onOpenNotifications}
          onOpenProfile={onOpenProfileTab}
          onOverlayVisibilityChange={onHomeOverlayVisibilityChange}
          onProfileChange={onProfileChange}
          onStreetRequestsViewed={onStreetRequestsViewed}
          profile={profile}
          safeTop={safeTop}
          unreadMessagesCount={unreadMessagesCount}
          unreadNotificationsCount={unreadNotificationsCount}
        />
      );
  }
}

function runTabHapticSafely() {
  try {
    triggerSelectionHaptic();
  } catch {
    return;
  }
}

function normalizeNonNegativeInt(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function buildStreetRequestsSeenStorageKey(profileId: string) {
  return `macradar:street-requests-seen:${profileId}`;
}

function buildFollowRequestsSeenStorageKey(profileId: string) {
  return `macradar:follow-requests-seen:${profileId}`;
}

export default function AppShell() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [authRestoreComplete, setAuthRestoreComplete] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [welcomeModalVisible, setWelcomeModalVisible] = useState(false);
  const [cameraModalVisible, setCameraModalVisible] = useState(false);
  const [pendingCapturedPost, setPendingCapturedPost] =
    useState<PostComposerDraft | null>(null);
  const [pendingFollowRequestsCount, setPendingFollowRequestsCount] =
    useState(0);
  const [pendingMessagesUnreadCount, setPendingMessagesUnreadCount] =
    useState(0);
  const [pendingNotificationsUnreadCount, setPendingNotificationsUnreadCount] =
    useState(0);
  const [pendingStreetRequestsCount, setPendingStreetRequestsCount] =
    useState(0);
  const [pendingDirectMessageRecipient, setPendingDirectMessageRecipient] =
    useState<ExploreSearchUser | null>(null);
  const [pendingExploreProfileUser, setPendingExploreProfileUser] =
    useState<ExploreSearchUser | null>(null);
  const [pendingExploreProfileReturnTab, setPendingExploreProfileReturnTab] =
    useState<TabKey | null>(null);
  const [pendingExploreViewerRequest, setPendingExploreViewerRequest] =
    useState<ExploreViewerRequest | null>(null);
  const [pendingProfileEditRequestId, setPendingProfileEditRequestId] = useState(0);
  const [messagesConversationOpen, setMessagesConversationOpen] =
    useState(false);
  const [homeOverlayVisible, setHomeOverlayVisible] = useState(false);
  const [profileResetVisible, setProfileResetVisible] = useState(false);
  const [profileResetForm, setProfileResetForm] =
    useState<PasswordResetFormState>(() => createInitialPasswordResetForm());
  const [profileResetSession, setProfileResetSession] =
    useState<PasswordResetSession | null>(null);
  const [profileResetError, setProfileResetError] = useState<string | null>(
    null,
  );
  const [profileResetInfo, setProfileResetInfo] = useState<string | null>(null);
  const [profileResetSubmitting, setProfileResetSubmitting] = useState(false);
  const activeTabRef = useRef<TabKey>('home');
  const tabHistoryRef = useRef<TabKey[]>(['home']);
  const messagesConversationOpenRef = useRef(false);
  const requestSummarySyncInFlightRef = useRef(false);
  const requestSummaryLastSyncAtRef = useRef(0);
  const requestSummaryInitializedRef = useRef(false);
  const requestSummaryRefreshRef = useRef<
    ((force?: boolean) => Promise<void>) | null
  >(null);
  const requestTotalCountRef = useRef(0);
  const followRequestsSeenBaselineRef = useRef(0);
  const latestFollowRequestsRawCountRef = useRef(0);
  const streetRequestsSeenBaselineRef = useRef(0);
  const latestStreetRequestsRawCountRef = useRef(0);
  const requestSummaryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const profileResetLockRef = useRef(false);
  const sessionTokenRef = useRef<string | null>(null);
  const notificationsSocketRef = useRef<WebSocket | null>(null);
  const notificationsBaselineReadyRef = useRef(false);
  const notificationsPresentationQueueRef = useRef<ProfileNotificationItem[]>([]);
  const notificationsPresentationInFlightRef = useRef(false);
  const notificationsReadQueueRef = useRef<Set<string>>(new Set());
  const notificationsReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const notificationsReconnectTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const notificationsReconnectAttemptRef = useRef(0);
  const surfacedNotificationIdsRef = useRef<Set<string>>(new Set());
  const profileId = profile?.id;
  const profileBadgeCount =
    pendingFollowRequestsCount + pendingStreetRequestsCount;

  function applyFollowRequestRawCount(rawCount: number) {
    const normalizedRaw = normalizeNonNegativeInt(rawCount);
    latestFollowRequestsRawCountRef.current = normalizedRaw;

    if (followRequestsSeenBaselineRef.current > normalizedRaw) {
      followRequestsSeenBaselineRef.current = normalizedRaw;
    }
    const unseenCount = Math.max(
      0,
      normalizedRaw - followRequestsSeenBaselineRef.current,
    );
    setPendingFollowRequestsCount(unseenCount);
    return normalizedRaw;
  }

  function markFollowRequestsSeen(seenCount: number) {
    const normalizedSeen = normalizeNonNegativeInt(seenCount);
    latestFollowRequestsRawCountRef.current = Math.max(
      latestFollowRequestsRawCountRef.current,
      normalizedSeen,
    );
    followRequestsSeenBaselineRef.current = Math.max(
      followRequestsSeenBaselineRef.current,
      normalizedSeen,
    );
    setPendingFollowRequestsCount(0);
    if (profileId) {
      AsyncStorage.setItem(
        buildFollowRequestsSeenStorageKey(profileId),
        String(followRequestsSeenBaselineRef.current),
      ).catch(() => {});
    }
  }

  function applyStreetRequestRawCount(rawCount: number) {
    const normalizedRaw = normalizeNonNegativeInt(rawCount);
    latestStreetRequestsRawCountRef.current = normalizedRaw;

    if (streetRequestsSeenBaselineRef.current > normalizedRaw) {
      streetRequestsSeenBaselineRef.current = normalizedRaw;
    }
    const unseenCount = Math.max(
      0,
      normalizedRaw - streetRequestsSeenBaselineRef.current,
    );
    setPendingStreetRequestsCount(unseenCount);
    return normalizedRaw;
  }

  function markStreetRequestsSeen(seenCount: number) {
    const normalizedSeen = normalizeNonNegativeInt(seenCount);
    latestStreetRequestsRawCountRef.current = Math.max(
      latestStreetRequestsRawCountRef.current,
      normalizedSeen,
    );
    streetRequestsSeenBaselineRef.current = Math.max(
      streetRequestsSeenBaselineRef.current,
      normalizedSeen,
    );
    setPendingStreetRequestsCount(0);
    if (profileId) {
      AsyncStorage.setItem(
        buildStreetRequestsSeenStorageKey(profileId),
        String(streetRequestsSeenBaselineRef.current),
      ).catch(() => {});
    }
  }

  useEffect(() => {
    if (!profileId) {
      followRequestsSeenBaselineRef.current = 0;
      latestFollowRequestsRawCountRef.current = 0;
      setPendingFollowRequestsCount(0);
      return;
    }

    const storageKey = buildFollowRequestsSeenStorageKey(profileId);
    let cancelled = false;

    AsyncStorage.getItem(storageKey)
      .then(value => {
        if (cancelled) {
          return;
        }
        const parsed = Number.parseInt(String(value ?? '').trim(), 10);
        const baseline = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
        followRequestsSeenBaselineRef.current = baseline;
        const unseenCount = Math.max(
          0,
          latestFollowRequestsRawCountRef.current - baseline,
        );
        setPendingFollowRequestsCount(unseenCount);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        followRequestsSeenBaselineRef.current = 0;
        setPendingFollowRequestsCount(latestFollowRequestsRawCountRef.current);
      });

    return () => {
      cancelled = true;
    };
  }, [profileId]);

  useEffect(() => {
    if (!profileId) {
      streetRequestsSeenBaselineRef.current = 0;
      setPendingStreetRequestsCount(0);
      return;
    }

    const storageKey = buildStreetRequestsSeenStorageKey(profileId);
    let cancelled = false;

    AsyncStorage.getItem(storageKey)
      .then(value => {
        if (cancelled) {
          return;
        }
        const parsed = Number.parseInt(String(value ?? '').trim(), 10);
        const baseline = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
        streetRequestsSeenBaselineRef.current = baseline;
        const unseenCount = Math.max(
          0,
          latestStreetRequestsRawCountRef.current - baseline,
        );
        setPendingStreetRequestsCount(unseenCount);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        streetRequestsSeenBaselineRef.current = 0;
        setPendingStreetRequestsCount(latestStreetRequestsRawCountRef.current);
      });

    return () => {
      cancelled = true;
    };
  }, [profileId]);

  useEffect(() => {
    if (!authRestoreComplete || !profileId) {
      setWelcomeModalVisible(false);
      return;
    }
    // Show instantly after auth/profile restoration (no async storage wait).
    setWelcomeModalVisible(true);
  }, [authRestoreComplete, profileId]);
  const shouldShowWelcomeModal = welcomeModalVisible;
  const isCameraCaptureAvailable = Boolean(
    NativeModules.CameraView && NativeModules.CameraDevices,
  );
  const CameraCaptureModalComponent = isCameraCaptureAvailable
    ? (require('../../components/CameraCapture/CameraCaptureModal')
        .default as React.ComponentType<CameraCaptureModalComponentProps>)
    : null;

  function navigateToTab(nextTab: TabKey) {
    const currentTab = activeTabRef.current;
    if (nextTab === currentTab) {
      return;
    }
    tabHistoryRef.current = [...tabHistoryRef.current, nextTab].slice(-12);
    activeTabRef.current = nextTab;
    setActiveTab(nextTab);
    runTabHapticSafely();
  }

  function setTabDirect(nextTab: TabKey) {
    tabHistoryRef.current = [nextTab];
    activeTabRef.current = nextTab;
    setActiveTab(nextTab);
  }

  function goBackTab() {
    const history = tabHistoryRef.current;
    if (history.length > 1) {
      history.pop();
      const previousTab = history[history.length - 1] ?? 'home';
      activeTabRef.current = previousTab;
      setActiveTab(previousTab);
      runTabHapticSafely();
      return;
    }

    if (activeTabRef.current !== 'home') {
      setTabDirect('home');
      runTabHapticSafely();
    }
  }

  function openProfileEditFromHome() {
    tabHistoryRef.current = [
      ...tabHistoryRef.current,
      'profile' as TabKey,
    ].slice(-12);
    activeTabRef.current = 'profile';
    setActiveTab('profile');
    setPendingProfileEditRequestId(previous => previous + 1);
  }

  const clearPendingProfileEditRequest = useCallback(() => {
    setPendingProfileEditRequestId(0);
  }, []);

  function clearProfileResetFeedback() {
    setProfileResetError(null);
    setProfileResetInfo(null);
  }

  function getProfileResetErrorMessage(error: unknown) {
    if (isApiRequestError(error)) {
      if (error.code === 'invalid_password_reset_code') {
        const remainingAttempts = error.details?.remainingAttempts;
        if (
          typeof remainingAttempts === 'number' &&
          Number.isFinite(remainingAttempts) &&
          remainingAttempts >= 0
        ) {
          return `${error.message} ${translateText(
            `Kalan deneme: ${remainingAttempts}.`,
          )}`;
        }
      }

      return error.message;
    }

    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }

    return translateText('Islem tamamlanamadi.');
  }

  function applyProfileResetRateLimit(
    current: PasswordResetSession | null,
    error: unknown,
  ) {
    if (
      !current ||
      !isApiRequestError(error) ||
      error.code !== 'password_reset_rate_limited'
    ) {
      return current;
    }

    const resendAvailableAt =
      typeof error.details?.resendAvailableAt === 'string'
        ? error.details.resendAvailableAt
        : '';
    if (!resendAvailableAt) {
      return current;
    }

    return {
      ...current,
      resendAvailableAt,
    };
  }

  function resetProfileResetState() {
    setProfileResetVisible(false);
    setProfileResetForm(createInitialPasswordResetForm());
    setProfileResetSession(null);
    setProfileResetError(null);
    setProfileResetInfo(null);
    setProfileResetSubmitting(false);
    profileResetLockRef.current = false;
  }

  function openProfilePasswordReset(email: string) {
    const normalizedEmail = normalizeOptionalResetEmail(email);
    profileResetLockRef.current = false;
    setProfileResetForm(createInitialPasswordResetForm(normalizedEmail));
    setProfileResetSession(null);
    setProfileResetError(null);
    setProfileResetInfo(null);
    setProfileResetSubmitting(false);
    setProfileResetVisible(true);
  }

  function closeProfilePasswordReset() {
    if (profileResetSubmitting) {
      return;
    }
    setProfileResetVisible(false);
    profileResetLockRef.current = false;
  }

  function updateProfileResetField<Key extends keyof PasswordResetFormState>(
    field: Key,
    value: PasswordResetFormState[Key],
  ) {
    setProfileResetForm(current => ({
      ...current,
      [field]: sanitizePasswordResetValue(field, value),
    }));
  }

  async function handleProfileResetRequest() {
    if (profileResetLockRef.current) {
      return;
    }

    profileResetLockRef.current = true;
    setProfileResetSubmitting(true);
    clearProfileResetFeedback();

    try {
      const response = await requestPasswordReset({
        email: profileResetForm.email.trim(),
      });

      setProfileResetSession(response);
      setProfileResetForm(current => ({
        ...current,
        code: '',
        confirmPassword: '',
        email: response.email,
        newPassword: '',
      }));
      setProfileResetInfo(
        response.debugCode
          ? `${response.message} Test kodu: ${response.debugCode}`
          : response.message,
      );
    } catch (error) {
      setProfileResetSession(current =>
        applyProfileResetRateLimit(current, error),
      );
      setProfileResetError(getProfileResetErrorMessage(error));
    } finally {
      profileResetLockRef.current = false;
      setProfileResetSubmitting(false);
    }
  }

  async function handleProfileResetConfirm() {
    if (profileResetLockRef.current) {
      return;
    }

    profileResetLockRef.current = true;
    setProfileResetSubmitting(true);
    clearProfileResetFeedback();

    try {
      const response = await confirmPasswordReset({
        code: profileResetForm.code.trim(),
        email: profileResetForm.email.trim(),
        newPassword: profileResetForm.newPassword,
      });

      setProfileResetSession(null);
      setProfileResetForm(
        createInitialPasswordResetForm(profileResetForm.email.trim()),
      );
      setProfileResetInfo(response.message);
    } catch (error) {
      setProfileResetError(getProfileResetErrorMessage(error));
    } finally {
      profileResetLockRef.current = false;
      setProfileResetSubmitting(false);
    }
  }

  async function handleProfileResetResend() {
    await handleProfileResetRequest();
  }

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    messagesConversationOpenRef.current = messagesConversationOpen;
  }, [messagesConversationOpen]);

  useEffect(() => {
    setApiUnauthorizedHandler(error => {
      if (isSessionInvalidError(error)) {
        handleLogout({ remote: false });
      }
    });

    return () => {
      setApiUnauthorizedHandler(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAuthenticated(response: AuthResponse) {
    const normalizedProfile = normalizeProfileMedia(response.profile);
    // Keep auth/session writes and state updates immediate to avoid landing flicker on reload.
    sessionTokenRef.current = response.session.token;
    setApiSessionToken(response.session.token);
    storeSessionToken(response.session.token).catch(() => {
      return;
    });
    storeProfileCache(normalizedProfile).catch(() => {
      return;
    });

    resetProfileResetState();
    setAuthRestoreComplete(true);
    setProfile(normalizedProfile);
    setTabDirect('home');
    setWelcomeModalVisible(true);
    setCameraModalVisible(false);
    setPendingCapturedPost(null);
    setPendingDirectMessageRecipient(null);
    setPendingExploreProfileUser(null);
    setPendingExploreProfileReturnTab(null);
    setPendingExploreViewerRequest(null);
    setMessagesConversationOpen(false);
    setPendingFollowRequestsCount(0);
    setPendingMessagesUnreadCount(0);
    setPendingNotificationsUnreadCount(0);
    setPendingStreetRequestsCount(0);
    followRequestsSeenBaselineRef.current = 0;
    latestFollowRequestsRawCountRef.current = 0;
    streetRequestsSeenBaselineRef.current = 0;
    latestStreetRequestsRawCountRef.current = 0;
    requestSummaryInitializedRef.current = false;
    requestSummaryLastSyncAtRef.current = 0;
    requestTotalCountRef.current = 0;
  }

  function clearLocalSessionState() {
    sessionTokenRef.current = null;
    setApiSessionToken(null);
    clearStoredSessionToken().catch(() => {
      return;
    });
    clearStoredProfileCache().catch(() => {
      return;
    });
    resetProfileResetState();
    setAuthRestoreComplete(true);
    setProfile(null);
    setTabDirect('home');
    setWelcomeModalVisible(false);
    setCameraModalVisible(false);
    setPendingCapturedPost(null);
    setPendingDirectMessageRecipient(null);
    setPendingExploreProfileUser(null);
    setPendingExploreProfileReturnTab(null);
    setPendingExploreViewerRequest(null);
    setMessagesConversationOpen(false);
    setPendingFollowRequestsCount(0);
    setPendingMessagesUnreadCount(0);
    setPendingNotificationsUnreadCount(0);
    setPendingStreetRequestsCount(0);
    followRequestsSeenBaselineRef.current = 0;
    latestFollowRequestsRawCountRef.current = 0;
    streetRequestsSeenBaselineRef.current = 0;
    latestStreetRequestsRawCountRef.current = 0;
    requestSummaryInitializedRef.current = false;
    requestSummaryLastSyncAtRef.current = 0;
    requestTotalCountRef.current = 0;
    setAppLanguage('tr');
  }

  function handleLogout(options?: { remote?: boolean }) {
    const shouldNotifyBackend = options?.remote !== false;
    const currentSessionToken = sessionTokenRef.current;

    clearLocalSessionState();

    if (!shouldNotifyBackend || !currentSessionToken) {
      return;
    }

    logoutUser({
      preserveLocalSession: true,
      tokenOverride: currentSessionToken,
    }).catch(() => {
      return;
    });
  }

  function handleOpenDirectMessageFromExplore(user: ExploreSearchUser) {
    setPendingDirectMessageRecipient(user);
    navigateToTab('messages');
  }

  function handleOpenPublicProfileFromProfile(user: ExploreSearchUser) {
    const sourceTab = activeTabRef.current;
    setPendingExploreProfileUser(user);
    setPendingExploreProfileReturnTab(
      EXTERNAL_PUBLIC_PROFILE_RETURNABLE_TABS.includes(sourceTab)
        ? sourceTab
        : 'home',
    );
    navigateToTab('explore');
  }

  function handleOpenExploreViewerFromProfile(request: ExploreViewerRequest) {
    setPendingExploreViewerRequest(request);
    navigateToTab('explore');
  }

  const handleNotificationPress = useCallback(
    (notification: ProfileNotificationItem) => {
      const actorId = getActorIdFromNotification(notification);
      if (!actorId || actorId === profile?.id) {
        return;
      }
      const actorUsername = String(notification.actorUsername || '')
        .trim()
        .replace(/^@+/, '');
      const fallbackUsername = actorUsername.length > 0 ? actorUsername : 'kullanici';
      const actorFullName = String(notification.actorFullName || '').trim();
      handleOpenPublicProfileFromProfile({
        avatarUrl: String(notification.actorAvatarUrl || '').trim(),
        fullName: actorFullName || fallbackUsername,
        id: actorId,
        isPrivateAccount: false,
        isVerified: false,
        username: fallbackUsername,
        viewerState: {
          followRequestStatus: 'none',
          followsYou: false,
          isFollowing: false,
          isStreetFriend: false,
          streetFriendStatus: 'none',
        },
      });
    },
    [handleOpenPublicProfileFromProfile, profile?.id],
  );

  useEffect(() => {
    if (activeTab !== 'messages' && messagesConversationOpen) {
      setMessagesConversationOpen(false);
    }
  }, [activeTab, messagesConversationOpen]);

  useEffect(() => {
    if (activeTab !== 'home' && homeOverlayVisible) {
      setHomeOverlayVisible(false);
    }
  }, [activeTab, homeOverlayVisible]);

  useEffect(() => {
    let active = true;

    const wait = (durationMs: number) =>
      new Promise<void>(resolve => {
        setTimeout(() => resolve(), durationMs);
      });

    function jumpToHome() {
      setTabDirect('home');
    }

    async function clearSessionState(clearProfileCache = true) {
      sessionTokenRef.current = null;
      setApiSessionToken(null);
      await clearStoredSessionToken();
      if (clearProfileCache) {
        await clearStoredProfileCache();
      }
      if (active) {
        setProfile(null);
      }
    }

    async function refreshProfileWithRetry(
      keepCachedProfileOnUnauthorized: boolean,
    ) {
      let retryDelayMs = 900;
      let attempts = 0;

      while (active) {
        attempts += 1;
        try {
          const restoredProfile = await fetchMyProfile();
          if (!active) {
            return;
          }

          await storeProfileCache(restoredProfile);
          setProfile(restoredProfile);
          jumpToHome();
          return;
        } catch (error) {
          if (isSessionInvalidError(error)) {
            await clearSessionState(!keepCachedProfileOnUnauthorized);
            if (active && !keepCachedProfileOnUnauthorized) {
              setProfile(null);
            }
            return;
          }

          if (attempts >= SESSION_RESTORE_MAX_RETRIES) {
            console.warn(
              'Session restore retries exhausted, keeping current UI state.',
              error,
            );
            return;
          }

          console.warn(
            'Session restore temporarily unavailable, retrying...',
            error,
          );
          await wait(retryDelayMs);
          retryDelayMs = Math.min(retryDelayMs * 2, 5000);
        }
      }
    }

    async function restoreSession() {
      if (active) {
        setAuthRestoreComplete(false);
      }

      try {
        const [cachedProfileRaw, token] = await Promise.all([
          readStoredProfileCache<unknown>(),
          readStoredSessionToken(),
        ]);
        const cachedProfile = isCachedProfile(cachedProfileRaw)
          ? cachedProfileRaw
          : null;

        if (!token) {
          if (cachedProfileRaw) {
            await clearStoredProfileCache();
          }
          if (active) {
            setAuthRestoreComplete(true);
          }
          return;
        }

        sessionTokenRef.current = token;
        setApiSessionToken(token);

        if (cachedProfile) {
          const normalizedCachedProfile = normalizeProfileMedia(cachedProfile);
          if (active) {
            setProfile(normalizedCachedProfile);
            setAuthRestoreComplete(true);
          }
          storeProfileCache(normalizedCachedProfile).catch(() => {
            return;
          });
          jumpToHome();
          refreshProfileWithRetry(false).catch(() => {
            return;
          });
          return;
        }

        await refreshProfileWithRetry(false);
      } catch (error) {
        if (isSessionInvalidError(error)) {
          await clearSessionState(true);
        } else {
          console.warn('Session restore failed', error);
        }
      } finally {
        if (active) {
          setAuthRestoreComplete(true);
        }
      }
    }

    restoreSession();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!profile) {
      resetProfileResetState();
      clearStoredProfileCache().catch(() => {
        return;
      });
      setPendingFollowRequestsCount(0);
      setPendingStreetRequestsCount(0);
      streetRequestsSeenBaselineRef.current = 0;
      latestStreetRequestsRawCountRef.current = 0;
      notificationsBaselineReadyRef.current = false;
      notificationsPresentationQueueRef.current = [];
      notificationsPresentationInFlightRef.current = false;
      notificationsReadQueueRef.current.clear();
      if (notificationsReadTimerRef.current) {
        clearTimeout(notificationsReadTimerRef.current);
        notificationsReadTimerRef.current = null;
      }
      if (notificationsReconnectTimerRef.current) {
        clearTimeout(notificationsReconnectTimerRef.current);
        notificationsReconnectTimerRef.current = null;
      }
      notificationsReconnectAttemptRef.current = 0;
      if (notificationsSocketRef.current) {
        try {
          notificationsSocketRef.current.close();
        } catch {
          // Ignore close race during auth transitions.
        } finally {
          notificationsSocketRef.current = null;
        }
      }
      surfacedNotificationIdsRef.current.clear();
      requestSummaryInitializedRef.current = false;
      requestSummaryLastSyncAtRef.current = 0;
      requestTotalCountRef.current = 0;
      return;
    }

    storeProfileCache(profile).catch(() => {
      return;
    });
  }, [profile]);

  useEffect(() => {
    if (!profileId) {
      setPendingFollowRequestsCount(0);
      setPendingMessagesUnreadCount(0);
      setPendingStreetRequestsCount(0);
      followRequestsSeenBaselineRef.current = 0;
      latestFollowRequestsRawCountRef.current = 0;
      streetRequestsSeenBaselineRef.current = 0;
      latestStreetRequestsRawCountRef.current = 0;
      notificationsBaselineReadyRef.current = false;
      notificationsPresentationQueueRef.current = [];
      notificationsPresentationInFlightRef.current = false;
      notificationsReadQueueRef.current.clear();
      if (notificationsReadTimerRef.current) {
        clearTimeout(notificationsReadTimerRef.current);
        notificationsReadTimerRef.current = null;
      }
      if (notificationsReconnectTimerRef.current) {
        clearTimeout(notificationsReconnectTimerRef.current);
        notificationsReconnectTimerRef.current = null;
      }
      notificationsReconnectAttemptRef.current = 0;
      if (notificationsSocketRef.current) {
        try {
          notificationsSocketRef.current.close();
        } catch {
          // Ignore close race during auth transitions.
        } finally {
          notificationsSocketRef.current = null;
        }
      }
      surfacedNotificationIdsRef.current.clear();
      requestSummaryInitializedRef.current = false;
      requestSummaryLastSyncAtRef.current = 0;
      requestSummaryRefreshRef.current = null;
      requestTotalCountRef.current = 0;
      return;
    }

    let active = true;
    let appState: AppStateStatus = AppState.currentState;

    const refresh = async (force = false) => {
      if (!active) {
        return;
      }

      const now = Date.now();
      if (
        !force &&
        (requestSummarySyncInFlightRef.current ||
          now - requestSummaryLastSyncAtRef.current <
            REQUEST_SUMMARY_MIN_REFRESH_GAP_MS)
      ) {
        return;
      }

      requestSummarySyncInFlightRef.current = true;
      try {
        const response = await fetchProfileRequestSummary({ force });
        if (active) {
          const followCount = Number.isFinite(response.followRequestsCount)
            ? Math.max(0, Math.floor(response.followRequestsCount))
            : 0;
          const rawMessagesUnreadCount = response.messagesUnreadCount;
          const messagesUnreadCount =
            typeof rawMessagesUnreadCount === 'number' &&
            Number.isFinite(rawMessagesUnreadCount)
              ? Math.max(0, Math.floor(rawMessagesUnreadCount))
              : 0;
          const streetCount = Number.isFinite(response.streetRequestsCount)
            ? Math.max(0, Math.floor(response.streetRequestsCount))
            : 0;
          const notificationsUnreadCount = Number.isFinite(response.notificationsUnreadCount)
            ? Math.max(0, Math.floor(response.notificationsUnreadCount!))
            : 0;
          const nextTotal = followCount + streetCount + notificationsUnreadCount;
          const previousTotal = requestTotalCountRef.current;

          applyFollowRequestRawCount(followCount);
          setPendingMessagesUnreadCount(messagesUnreadCount);
          setPendingNotificationsUnreadCount(notificationsUnreadCount);
          applyStreetRequestRawCount(streetCount);
          requestSummaryInitializedRef.current = true;
          requestSummaryLastSyncAtRef.current = Date.now();
          requestTotalCountRef.current = nextTotal;
        }
      } catch (error) {
        if (isSessionInvalidError(error)) {
          handleLogout({ remote: false });
          return;
        }
        if (active && !requestSummaryInitializedRef.current) {
          setPendingFollowRequestsCount(0);
          setPendingMessagesUnreadCount(0);
          setPendingStreetRequestsCount(0);
          followRequestsSeenBaselineRef.current = 0;
          latestFollowRequestsRawCountRef.current = 0;
          streetRequestsSeenBaselineRef.current = 0;
          latestStreetRequestsRawCountRef.current = 0;
          requestTotalCountRef.current = 0;
        }
      } finally {
        requestSummarySyncInFlightRef.current = false;
      }
    };
    requestSummaryRefreshRef.current = refresh;

    refresh(true).catch(() => {
      return;
    });
    const appStateSubscription = AppState.addEventListener(
      'change',
      nextState => {
        const becameActive =
          (appState === 'background' || appState === 'inactive') &&
          nextState === 'active';
        appState = nextState;
        if (becameActive) {
          refresh(true).catch(() => {
            return;
          });
        }
      },
    );

    return () => {
      active = false;
      if (requestSummaryRefreshRef.current === refresh) {
        requestSummaryRefreshRef.current = null;
      }
      appStateSubscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  useEffect(() => {
    if (!profileId) {
      notificationsBaselineReadyRef.current = false;
      notificationsPresentationQueueRef.current = [];
      notificationsPresentationInFlightRef.current = false;
      notificationsReadQueueRef.current.clear();
      if (notificationsReadTimerRef.current) {
        clearTimeout(notificationsReadTimerRef.current);
        notificationsReadTimerRef.current = null;
      }
      if (notificationsReconnectTimerRef.current) {
        clearTimeout(notificationsReconnectTimerRef.current);
        notificationsReconnectTimerRef.current = null;
      }
      notificationsReconnectAttemptRef.current = 0;
      notificationsSocketRef.current = null;
      surfacedNotificationIdsRef.current.clear();
      return;
    }

    let active = true;
    let appState: AppStateStatus = AppState.currentState;
    bootstrapNotifications().catch(() => {
      return;
    });

    const clearReconnectTimer = () => {
      if (notificationsReconnectTimerRef.current) {
        clearTimeout(notificationsReconnectTimerRef.current);
        notificationsReconnectTimerRef.current = null;
      }
    };

    const clearReadTimer = () => {
      if (notificationsReadTimerRef.current) {
        clearTimeout(notificationsReadTimerRef.current);
        notificationsReadTimerRef.current = null;
      }
    };

    const closeNotificationsSocket = () => {
      const socket = notificationsSocketRef.current;
      notificationsSocketRef.current = null;
      if (!socket) {
        return;
      }

      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        return;
      }
    };

    const scheduleNotificationReadFlush = () => {
      if (notificationsReadTimerRef.current) {
        return;
      }

      notificationsReadTimerRef.current = setTimeout(() => {
        notificationsReadTimerRef.current = null;
        flushNotificationReadQueue().catch(() => {
          return;
        });
      }, NOTIFICATION_READ_FLUSH_MS);
    };

    const flushNotificationReadQueue = async () => {
      clearReadTimer();

      const ids = Array.from(notificationsReadQueueRef.current);
      if (ids.length === 0) {
        return;
      }

      notificationsReadQueueRef.current.clear();
      try {
        await markProfileNotificationsRead({ ids });
      } catch (error) {
        ids.forEach(id => {
          notificationsReadQueueRef.current.add(id);
        });
        if (isSessionInvalidError(error)) {
          handleLogout({ remote: false });
          return;
        }
        scheduleNotificationReadFlush();
      }
    };

    const markNotificationAsRead = (notificationId: string) => {
      if (!notificationId) {
        return;
      }
      notificationsReadQueueRef.current.add(notificationId);
      scheduleNotificationReadFlush();
    };

    const handleNotificationFetchFailure = (error: unknown) => {
      if (isSessionInvalidError(error)) {
        handleLogout({ remote: false });
      }
    };

    const drainNotificationQueue = async () => {
      if (notificationsPresentationInFlightRef.current) {
        return;
      }

      notificationsPresentationInFlightRef.current = true;
      try {
        while (active && notificationsPresentationQueueRef.current.length > 0) {
          const nextNotification = notificationsPresentationQueueRef.current.shift();
          if (!nextNotification) {
            continue;
          }

          const notificationId = normalizeNotificationId(nextNotification.id);
          if (!notificationId) {
            continue;
          }

          const isForegroundConversationNotification =
            nextNotification.channel === 'messages' &&
            activeTabRef.current === 'messages' &&
            messagesConversationOpenRef.current;

          if (isForegroundConversationNotification) {
            markNotificationAsRead(notificationId);
            continue;
          }

          const displayed = await displayRealtimeNotification(nextNotification).catch(() => {
            surfacedNotificationIdsRef.current.delete(notificationId);
            return null;
          });

          if (displayed !== null) {
            markNotificationAsRead(notificationId);
          }
        }
      } finally {
        notificationsPresentationInFlightRef.current = false;
      }
    };

    const scheduleSoftRequestSummarySync = () => {
      if (requestSummaryDebounceRef.current) {
        clearTimeout(requestSummaryDebounceRef.current);
      }
      requestSummaryDebounceRef.current = setTimeout(() => {
        requestSummaryDebounceRef.current = null;
        requestSummaryRefreshRef.current
          ?.(false)
          .catch(handleNotificationFetchFailure);
      }, 160);
    };

    const applyRequestDelta = (
      kind: 'follow' | 'street',
      delta: number,
      source:
        | 'notifications_catchup'
        | 'notifications_socket'
        | 'request_summary_sync',
      requesterId: string,
    ) => {
      const normalizedDelta = Math.trunc(delta);
      if (normalizedDelta === 0) {
        return;
      }

      if (kind === 'follow') {
        const nextFollowRaw = Math.max(
          0,
          latestFollowRequestsRawCountRef.current + normalizedDelta,
        );
        applyFollowRequestRawCount(nextFollowRaw);
        emitRealtimeFollowRequest({
          delta: normalizedDelta,
          requesterId,
          source,
        });
      } else {
        const nextStreetRaw = Math.max(
          0,
          latestStreetRequestsRawCountRef.current + normalizedDelta,
        );
        applyStreetRequestRawCount(nextStreetRaw);
        emitRealtimeStreetRequest({
          delta: normalizedDelta,
          rawCount: nextStreetRaw,
          requesterId,
          source,
        });
      }

      setPendingNotificationsUnreadCount(current =>
        Math.max(0, current + normalizedDelta),
      );
      requestTotalCountRef.current = Math.max(
        0,
        requestTotalCountRef.current + normalizedDelta,
      );
    };

    const applyIncomingRequestDeltasFromNotifications = (
      items: ProfileNotificationItem[],
      source: 'notifications_catchup' | 'notifications_socket',
    ) => {
      items.forEach(item => {
        const kind = getIncomingRequestNotificationKind(item);
        if (!kind) {
          return;
        }
        applyRequestDelta(kind, 1, source, getRequesterIdFromNotification(item));
      });
    };

    const queueFreshNotifications = (
      items: ProfileNotificationItem[],
      source: 'notifications_catchup' | 'notifications_socket' = 'notifications_catchup',
    ) => {
      const seenIds = surfacedNotificationIdsRef.current;
      const freshItems = items
        .filter(item => {
          const notificationId = normalizeNotificationId(item.id);
          return (
            notificationId.length > 0 &&
            item.isRead !== true &&
            !seenIds.has(notificationId)
          );
        })
        .sort((left, right) => {
          const leftTime = new Date(left.createdAt || 0).getTime();
          const rightTime = new Date(right.createdAt || 0).getTime();
          return leftTime - rightTime;
        });

      if (freshItems.length === 0) {
        return;
      }

      if (source === 'notifications_catchup') {
        applyIncomingRequestDeltasFromNotifications(freshItems, source);
      }

      if (freshItems.some(item => !getIncomingRequestNotificationKind(item))) {
        scheduleSoftRequestSummarySync();
      }

      rememberNotificationIds(seenIds, freshItems);
      notificationsPresentationQueueRef.current.push(...freshItems);
      drainNotificationQueue().catch(() => {
        return;
      });
    };

    const fetchNotificationsOnce = async (mode: 'baseline' | 'surface') => {
      const response = await fetchProfileNotifications({
        limit: NOTIFICATION_CATCH_UP_FETCH_LIMIT,
      });
      if (!active) {
        return;
      }

      const items = Array.isArray(response.notifications)
        ? response.notifications
        : [];

      if (mode === 'baseline') {
        rememberNotificationIds(surfacedNotificationIdsRef.current, items);
        notificationsBaselineReadyRef.current = true;
        return;
      }

      queueFreshNotifications(items, 'notifications_catchup');
    };

    const scheduleReconnect = () => {
      if (
        !active ||
        appState !== 'active' ||
        notificationsReconnectTimerRef.current
      ) {
        return;
      }

      const delayMs = Math.min(
        NOTIFICATION_RECONNECT_BASE_DELAY_MS *
          2 ** notificationsReconnectAttemptRef.current,
        NOTIFICATION_RECONNECT_MAX_DELAY_MS,
      );

      notificationsReconnectTimerRef.current = setTimeout(() => {
        notificationsReconnectTimerRef.current = null;
        notificationsReconnectAttemptRef.current += 1;
        connectSocket();
      }, delayMs);
    };

    const connectSocket = () => {
      if (!active || notificationsSocketRef.current) {
        return;
      }

      try {
        const socket = createNotificationsSocket({
          onEvent: event => {
            if (
              event.type === 'request.created' ||
              event.type === 'request.resolved' ||
              event.type === 'request.cancelled'
            ) {
              applyRequestDelta(
                event.request.kind,
                event.request.delta,
                'notifications_socket',
                event.request.requesterId,
              );
              return;
            }
            if (event.type === 'notification.created' && event.notification) {
              queueFreshNotifications([event.notification], 'notifications_socket');
            }
          },
        });

        notificationsSocketRef.current = socket;
        socket.onopen = () => {
          notificationsReconnectAttemptRef.current = 0;
          clearReconnectTimer();
          if (notificationsBaselineReadyRef.current) {
            fetchNotificationsOnce('surface').catch(handleNotificationFetchFailure);
          }
        };
        socket.onclose = () => {
          if (notificationsSocketRef.current === socket) {
            notificationsSocketRef.current = null;
          }
          scheduleReconnect();
        };
      } catch {
        scheduleReconnect();
      }
    };

    connectSocket();
    fetchNotificationsOnce('baseline').catch(error => {
      notificationsBaselineReadyRef.current = true;
      handleNotificationFetchFailure(error);
    });

    const heartbeatTimer = setInterval(() => {
      const socket = notificationsSocketRef.current;
      if (!socket || socket.readyState !== 1) {
        return;
      }

      try {
        socket.send(JSON.stringify({ type: 'heartbeat' }));
      } catch {
        return;
      }
    }, NOTIFICATION_HEARTBEAT_MS);

    const appStateSubscription = AppState.addEventListener('change', nextState => {
      const becameActive =
        (appState === 'background' || appState === 'inactive') &&
        nextState === 'active';
      const becameInactive =
        nextState === 'background' || nextState === 'inactive';

      appState = nextState;

      if (becameInactive) {
        flushNotificationReadQueue().catch(() => {
          return;
        });
      }

      if (becameActive) {
        connectSocket();
        if (notificationsBaselineReadyRef.current) {
          fetchNotificationsOnce('surface').catch(handleNotificationFetchFailure);
        }
      }
    });

    return () => {
      active = false;
      clearReconnectTimer();
      clearReadTimer();
      if (requestSummaryDebounceRef.current) {
        clearTimeout(requestSummaryDebounceRef.current);
        requestSummaryDebounceRef.current = null;
      }
      clearInterval(heartbeatTimer);
      appStateSubscription.remove();
      closeNotificationsSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  useEffect(() => {
    if (!profileId || activeTab !== 'notifications') {
      return;
    }
    setPendingNotificationsUnreadCount(0);
    markFollowRequestsSeen(latestFollowRequestsRawCountRef.current);
    markStreetRequestsSeen(latestStreetRequestsRawCountRef.current);
  }, [activeTab, profileId]);

  useEffect(() => {
    let active = true;

    if (!profileId) {
      setAppLanguage('tr');
      return () => {
        active = false;
      };
    }

    fetchProfileAppSettings({ force: true })
      .then(response => {
        if (!active) {
          return;
        }
        setAppLanguage(response.language);
        syncI18nBundleWithCurrentLanguage().catch(() => {
          return;
        });
      })
      .catch(error => {
        if (isSessionInvalidError(error)) {
          handleLogout({ remote: false });
        }
        return;
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      if (cancelled) {
        return;
      }
      syncI18nBundleWithCurrentLanguage().catch(() => {
        return;
      });
    };
    if (getAppLanguage() === 'en') {
      pull();
    }
    return subscribeAppLanguage(() => {
      if (!cancelled) {
        pull();
      }
    });
  }, []);

  let content: React.ReactNode;
  if (!profile) {
    content = authRestoreComplete ? (
      <Login
        onAuthenticated={handleAuthenticated}
        safeBottom={insets.bottom}
        safeTop={insets.top}
      />
    ) : (
      <View style={styles.authBootstrapHold} />
    );
  } else {
    content = (
      <>
        <View style={styles.sceneContainer}>
          <View style={styles.sceneLayer}>
            {renderActiveScreen(
              activeTab,
              insets.top,
              insets.bottom,
              activeTab === 'messages' && messagesConversationOpen
                ? insets.bottom
                : insets.bottom,
              () => {
                goBackTab();
              },
              () => {
                openProfileEditFromHome();
              },
              pendingProfileEditRequestId,
              clearPendingProfileEditRequest,
              profile,
              profile.id,
              nextProfile => {
                setProfile(normalizeProfileMedia(nextProfile));
              },
              handleLogout,
              email => {
                openProfilePasswordReset(email);
              },
              count => {
                applyFollowRequestRawCount(count);
              },
              count => {
                applyStreetRequestRawCount(count);
              },
              count => {
                markStreetRequestsSeen(count);
              },
              pendingFollowRequestsCount,
              pendingStreetRequestsCount,
              user => {
                handleOpenDirectMessageFromExplore(user);
              },
              user => {
                handleOpenPublicProfileFromProfile(user);
              },
              user => {
                handleOpenPublicProfileFromProfile(user);
              },
              pendingExploreProfileUser,
              pendingExploreProfileReturnTab,
              () => {
                setPendingExploreProfileUser(null);
                setPendingExploreProfileReturnTab(null);
              },
              returnTab => {
                setPendingExploreProfileUser(null);
                setPendingExploreProfileReturnTab(null);
                navigateToTab(returnTab);
              },
              pendingExploreViewerRequest,
              () => {
                setPendingExploreViewerRequest(null);
              },
              pendingDirectMessageRecipient,
              () => {
                setPendingDirectMessageRecipient(null);
              },
              open => {
                setMessagesConversationOpen(open);
              },
              request => {
                handleOpenExploreViewerFromProfile(request);
              },
              visible => {
                setHomeOverlayVisible(visible);
              },
              () => {
                navigateToTab('notifications');
              },
              () => {
                navigateToTab('messages');
              },
              notification => {
                handleNotificationPress(notification);
              },
              pendingMessagesUnreadCount,
              pendingNotificationsUnreadCount,
            )}
          </View>
        </View>


        {profileResetVisible ? (
          <Modal
            animationType="slide"
            onRequestClose={closeProfilePasswordReset}
            statusBarTranslucent={false}
            transparent={false}
            visible={profileResetVisible}
          >
            <StatusBar
              animated={true}
              backgroundColor="#ffffff"
              barStyle="dark-content"
              hidden={false}
              translucent={false}
            />
            <LoginPasswordReset
              code={profileResetForm.code}
              confirmPassword={profileResetForm.confirmPassword}
              email={profileResetForm.email}
              emailLocked={true}
              entryPoint="profile"
              errorMessage={profileResetError}
              infoMessage={profileResetInfo}
              isSubmitting={profileResetSubmitting}
              newPassword={profileResetForm.newPassword}
              onBack={closeProfilePasswordReset}
              onChangeField={updateProfileResetField}
              onConfirm={handleProfileResetConfirm}
              onRequestCode={handleProfileResetRequest}
              onResend={handleProfileResetResend}
              resetSession={profileResetSession}
              safeBottom={insets.bottom}
              safeTop={insets.top}
            />
          </Modal>
        ) : null}

        <LoginWelcomeModal
          onClose={() => {
            setWelcomeModalVisible(false);
          }}
          userName={
            profile.fullName.trim() ||
            profile.username.trim() ||
            undefined
          }
          visible={shouldShowWelcomeModal}
        />
        {cameraModalVisible && CameraCaptureModalComponent ? (
          <CameraCaptureModalComponent
            onClose={() => {
              setCameraModalVisible(false);
            }}
            onCaptureComplete={async payload => {
              setPendingCapturedPost(payload);
              setCameraModalVisible(false);
            }}
            safeBottom={insets.bottom}
            safeTop={insets.top}
            visible={cameraModalVisible}
          />
        ) : null}
        {pendingCapturedPost ? (
          <View style={styles.composerScreenOverlay}>
            <PostComposerModal
              draft={pendingCapturedPost}
              mode="create"
              onBackToCamera={() => {
                setPendingCapturedPost(null);
                if (isCameraCaptureAvailable) {
                  setCameraModalVisible(true);
                }
              }}
              onClose={() => {
                setPendingCapturedPost(null);
              }}
              onSubmit={async (payload, submitOptions) => {
                try {
                  const createdPost = await publishProfilePost(
                    {
                      caption: payload.caption,
                      location: payload.location,
                      locationPayload: payload.locationPayload,
                      mediaType: payload.mediaType,
                      mediaUrl: payload.mediaUrl,
                      thumbnailUrl: payload.thumbnailUrl,
                      visibility: profile.privacy?.isPrivateAccount ? 'friends' : 'public',
                    },
                    {
                      onProgress: submitOptions?.onProgress,
                    },
                  );
                  emitProfilePostCreated(createdPost);
                  queueExploreFeedSeedFromCreatedProfilePost(
                    createdPost,
                    profile.id,
                    resolveProfileAvatarUrl(profile),
                    String(profile.username ?? '').trim(),
                  );
                  setProfile(previous =>
                    previous
                      ? {
                          ...previous,
                          stats: {
                            ...previous.stats,
                            routesCount: previous.stats.routesCount + 1,
                          },
                        }
                      : previous,
                  );
                } catch (error) {
                  if (isSessionInvalidError(error)) {
                    handleLogout({ remote: false });
                  }
                  throw error;
                }

                setPendingCapturedPost(null);
                navigateToTab('profile');
              }}
              presentation="screen"
              safeBottom={insets.bottom}
              safeTop={insets.top}
              viewerAvatarUrl={resolveProfileAvatarUrl(profile)}
              viewerDisplayName={profile.fullName}
              viewerIsPrivateAccount={Boolean(profile.privacy?.isPrivateAccount)}
              visible={Boolean(pendingCapturedPost)}
            />
          </View>
        ) : null}

        {/* TabBar - Keşfet ve Mesaj yazarken gizle */}
        {!(
          activeTab === 'explore' ||
          (activeTab === 'messages' && messagesConversationOpen) ||
          pendingCapturedPost
        ) && (
          <TabBar
            actionActive={cameraModalVisible}
            activeTab={activeTab}
            messagesBadgeCount={pendingMessagesUnreadCount}
            onActionPress={() => {
              if (isCameraCaptureAvailable) {
                setCameraModalVisible(true);
              }
            }}
            onTabPress={navigateToTab}
            profileBadgeCount={profileBadgeCount}
            safeBottom={insets.bottom}
          />
        )}
      </>
    );
  }

  return <View className="flex-1 bg-midnight">{content}</View>;
}

const styles = StyleSheet.create({
  authBootstrapHold: {
    backgroundColor: '#000000',
    flex: 1,
  },
  composerScreenOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 130,
  },
  sceneContainer: {
    flex: 1,
  },
  sceneLayer: {
    flex: 1,
  },
  tabBarAnimatedWrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 90,
  },
});
