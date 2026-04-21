import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  type AppStateStatus,
  Image,
  Linking,
  Modal,
  PanResponder,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAlert } from '../alerts/AlertProvider';
import MemberProfileModal from '../components/MemberProfile/MemberProfileModal';
import { PLAYER_WS_URL } from '../config/exploreApi';
import MapMenuModal, {
  MAP_MENU_SHEET_CLOSE_DURATION,
  MAP_MENU_SHEET_GESTURE,
  MAP_MENU_SHEET_LAYOUT,
  MAP_MENU_SHEET_SPRING,
  type MapFilterMode,
  type MapMenuSection,
  type MapThemeMode,
} from './MapMenuModal';
import FeatherIcon from '../components/FeatherIcon/FeatherIcon';
import IosSpinner from '../components/IosSpinner/IosSpinner';
import LivePlayerMarker from '../realtime/components/LivePlayerMarker';
import ScreenStateCard from '../components/ScreenState/ScreenStateCard';
import { useRealtimePlayers } from '../realtime/useRealtimePlayers';
import {
  fetchBlockedUsers,
  fetchPublicProfile,
  fetchMapPreferences,
  fetchProfilePrivacy,
  startTrackingSession,
  stopTrackingSession,
  updateMapPreferences,
  updateProfilePrivacy,
} from '../services/authService';
import {
  fetchMapBootstrap,
  fetchTrackingFollowPath,
  fetchStreetFriends,
  fetchStreetFriendRequests,
  followCreator,
  removeStreetFriend,
  searchExploreUsers,
  triggerLiveFollowNotification,
  upsertStreetFriend,
} from '../services/exploreService';
import { isApiRequestError } from '../services/apiClient';
import { resolveProtectedMediaUrl } from '../services/protectedMedia';
import { Text, TextInput } from '../theme/typography';
import type {
  MapPreferences,
  PublicUserProfile,
  UpdateMapPreferencesPayload,
  UserProfile,
} from '../types/AuthTypes/AuthTypes';
import type {
  ExploreSearchUser,
  ExploreStreetFriendListItem,
  ExploreStreetFriendRequestListResponse,
  FollowRequestStatus,
  StreetFriendStatus,
} from '../types/ExploreTypes/ExploreTypes';
import { HIDDEN_USER_NOT_FOUND_LABEL } from '../utils/hiddenUser';
import { resolveProfileAvatarUrl } from '../utils/profileAvatar';

const INITIAL_COORDINATE: [number, number] = [28.9784, 41.0082];
const MAP_MENU_ICON = require('./menu.png');
const STREET_FRIENDS_SYNC_INTERVAL_MIN_MS = 5_000;
const STREET_FRIENDS_SYNC_INTERVAL_MAX_MS = 8_000;
const STREET_FRIENDS_MODAL_REFRESH_INTERVAL_MS = 5_000;
const BLOCKED_USERS_SYNC_INTERVAL_MS = 12_000;
const SF_LAST_SEEN_REQUEST_COUNT_KEY = 'macradar:sf-last-seen-request-count';
const MAP_MENU_SYNC_CACHE_TTL_MS = 12_000;
const STREET_FRIENDS_SNAPSHOT_CACHE_TTL_MS = 8_000;
const MEMBER_MODAL_CLEANUP_DELAY_MS = 220;
const MAX_VISIBLE_REMOTE_MARKERS = 120;
const SHOW_SIDE_MEMBER_PREVIEW = false;
const LIVE_FOLLOW_PATH_MAX_POINTS = 80;
const LIVE_FOLLOW_PATH_MIN_DELTA = 0.00006;
const LIVE_FOLLOW_NOTIFICATION_CLIENT_COOLDOWN_MS = 30_000;
const LIVE_FOLLOW_PATH_LINE_STYLE = {
  lineBlur: 0.4,
  lineCap: 'round',
  lineColor: '#22d3ee',
  lineJoin: 'round',
  lineOpacity: 0.9,
  lineWidth: 4,
} as const;
const DEFAULT_MAP_PREFERENCES: MapPreferences = {
  mapFilterMode: 'street_friends',
  mapThemeMode: 'dark',
  showLocalLayer: true,
  showRemoteLayer: true,
  trackingEnabled: true,
  updatedAt: new Date().toISOString(),
};

function getSafeProfileStats(profile: UserProfile) {
  const s = profile.stats;
  return {
    followersCount: typeof s?.followersCount === 'number' ? s.followersCount : 0,
    followingCount: typeof s?.followingCount === 'number' ? s.followingCount : 0,
    routesCount: typeof s?.routesCount === 'number' ? s.routesCount : 0,
    streetFriendsCount:
      typeof s?.streetFriendsCount === 'number' ? s.streetFriendsCount : 0,
  };
}

/** API/bootstrap bazen eksik alan döndürür; .trim() çökmesini önler. */
function safeProfileText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMapFilterMode(value: unknown): MapFilterMode {
  return value === 'street_friends' || value === 'all' ? value : 'street_friends';
}

function normalizeMapThemeMode(value: unknown): MapThemeMode {
  return value === 'dark' || value === 'light' || value === 'street'
    ? value
    : 'dark';
}

function normalizeMapPreferences(preferences: Partial<MapPreferences>): MapPreferences {
  return {
    mapFilterMode: normalizeMapFilterMode(preferences.mapFilterMode),
    mapThemeMode: normalizeMapThemeMode(preferences.mapThemeMode),
    showLocalLayer: typeof preferences.showLocalLayer === 'boolean'
      ? preferences.showLocalLayer
      : true,
    showRemoteLayer: typeof preferences.showRemoteLayer === 'boolean'
      ? preferences.showRemoteLayer
      : true,
    trackingEnabled: typeof preferences.trackingEnabled === 'boolean'
      ? preferences.trackingEnabled
      : true,
    updatedAt:
      typeof preferences.updatedAt === 'string' ? preferences.updatedAt : DEFAULT_MAP_PREFERENCES.updatedAt,
  };
}

function resolveMenuErrorMessage(error: unknown, fallback: string): string {
  if (!isApiRequestError(error)) {
    return fallback;
  }
  if (error.status === 401) {
    return 'Oturum dogrulanamadi. Lutfen yeniden giris yap.';
  }
  return error.message;
}

function isPublicProfileUnavailableError(error: unknown): boolean {
  return (
    isApiRequestError(error) &&
    (error.code === 'profile_not_found' || error.status === 404)
  );
}

function resolveInitials(value: string): string {
  const initials = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('');
  return initials || 'U';
}

function resolveStreetFriendRequestSummary(
  response: ExploreStreetFriendRequestListResponse,
) {
  const fallbackIncomingCount = response.requests.filter(
    request => request.streetFriendStatus === 'pending_incoming',
  ).length;
  const fallbackOutgoingCount = response.requests.filter(
    request => request.streetFriendStatus === 'pending_outgoing',
  ).length;

  return {
    incomingCount:
      typeof response.incomingCount === 'number'
        ? Math.max(0, Math.floor(response.incomingCount))
        : fallbackIncomingCount,
    outgoingCount:
      typeof response.outgoingCount === 'number'
        ? Math.max(0, Math.floor(response.outgoingCount))
        : fallbackOutgoingCount,
  };
}

function areMemberIdMapsEqual(
  current: Record<string, true>,
  next: Record<string, true>,
) {
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);
  if (currentKeys.length !== nextKeys.length) {
    return false;
  }
  return currentKeys.every(key => next[key] === true);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  map: {
    flex: 1,
  },
  overlayStateCard: {
    left: 16,
    maxWidth: 360,
    position: 'absolute',
    right: 16,
    zIndex: 40,
  },
  errorCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(248, 250, 252, 0.2)',
  },
  errorTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  errorText: {
    color: '#cbd5e1',
    fontSize: 12,
  },
  permissionCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(248, 250, 252, 0.2)',
  },
  permissionTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  permissionText: {
    marginTop: 4,
    color: '#cbd5e1',
    fontSize: 12,
  },
  permissionButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    borderRadius: 8,
    backgroundColor: '#FF5A1F',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  permissionButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  menuButton: {
    position: 'absolute',
    right: 16,
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#c9d3e1',
    shadowColor: '#0f172a',
    shadowOpacity: 0.26,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
    zIndex: 30,
  },
  menuButtonIcon: {
    width: 22,
    height: 22,
  },
  usersButton: {
    position: 'absolute',
    right: 16,
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#c9d3e1',
    shadowColor: '#0f172a',
    shadowOpacity: 0.26,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
    zIndex: 30,
  },
  streetFriendsBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  streetFriendsModalRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  streetFriendsModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.22)',
  },
  streetFriendsCard: {
    width: '100%',
    alignSelf: 'stretch',
    margin: 0,
    padding: 0,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderWidth: 1,
    paddingTop: 16,
    overflow: 'hidden',
  },
  streetFriendsInner: {
    paddingHorizontal: 16,
  },
  streetFriendsAura: {
    position: 'absolute',
    left: -112,
    top: -142,
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: 'rgba(249, 115, 22, 0.07)',
  },
  streetFriendsGrabber: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#cbd5e1',
    marginBottom: 12,
  },
  streetFriendsGrabberPress: {
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 6,
  },
  streetFriendsHeader: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    marginBottom: 4,
    position: 'relative',
  },
  streetFriendsTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
    textAlign: 'center',
    textTransform: 'none',
  },
  streetFriendsCount: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
  },
  streetFriendsCountRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 10,
  },
  streetFriendsCountSeparator: {
    backgroundColor: '#cbd5e1',
    height: 12,
    marginHorizontal: 8,
    width: 1,
  },
  streetFriendsNewRequestBadge: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  streetFriendsUnreadDot: {
    backgroundColor: '#ff5a1f',
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  streetFriendsCountUnread: {
    color: '#1e293b',
    fontWeight: '700',
  },
  streetFriendsNewRequestLabel: {
    color: '#334155',
    fontWeight: '700',
  },
  streetFriendsNewRequestLabelUnread: {
    color: '#0f172a',
  },
  streetFriendsHintCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  streetFriendsHintDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    borderColor: '#d1d5db',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  streetFriendsHintText: {
    color: '#4b5563',
    fontSize: 11.5,
    lineHeight: 16,
    flex: 1,
  },
  streetFriendsSummaryCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  streetFriendsSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  streetFriendsSummaryRowLast: {
    marginBottom: 0,
  },
  streetFriendsSummaryTitle: {
    color: '#64748b',
    fontSize: 11,
  },
  streetFriendsSummaryValue: {
    color: '#0f172a',
    fontSize: 11.5,
    fontWeight: '700',
  },
  streetFriendsSummaryValueLive: {
    color: '#111827',
  },
  streetFriendsSummaryValueIdle: {
    color: '#64748b',
  },
  streetFriendsPurposeCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  streetFriendsPurposeRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    marginBottom: 7,
  },
  streetFriendsPurposeText: {
    color: '#334155',
    flex: 1,
    fontSize: 11.5,
    lineHeight: 17,
    marginLeft: 8,
  },
  streetFriendsSectionLabel: {
    color: '#475569',
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  streetFriendsSearchShell: {
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    minHeight: 40,
    marginBottom: 10,
  },
  streetFriendsSearchInput: {
    color: '#0f172a',
    flex: 1,
    fontSize: 12.5,
    paddingVertical: 8,
  },
  streetFriendsActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  streetFriendsActionButton: {
    flexGrow: 1,
    minWidth: '48%',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    minHeight: 42,
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streetFriendsActionButtonPrimary: {
    backgroundColor: 'black',
  },
  streetFriendsActionText: {
    color: 'black',
    fontSize: 11.5,
    fontWeight: '700',
  },
  streetFriendsActionTextPrimary: {
    color: 'white',
  },
  streetFriendsCloseButton: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  streetFriendsEmptyCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    marginBottom: 6,
  },
  streetFriendsEmptyTitle: {
    color: '#0f172a',
    fontSize: 13.5,
    fontWeight: '700',
    marginTop: 7,
  },
  streetFriendsEmptyText: {
    color: '#64748b',
    fontSize: 11.5,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 5,
  },
  streetFriendsMessage: {
    color: '#64748b',
    fontSize: 12.5,
    lineHeight: 18,
    marginBottom: 12,
    textAlign: 'center',
  },
  streetFriendsError: {
    color: '#dc2626',
    fontSize: 12.5,
    lineHeight: 18,
    marginBottom: 12,
  },
  streetFriendsList: {
    maxHeight: 280,
  },
  streetFriendsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 10,
    marginBottom: 8,
  },
  streetFriendsAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  streetFriendsInitials: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  streetFriendsName: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '600',
  },
  streetFriendsHandle: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 1,
  },
  streetFriendsMeta: {
    color: '#475569',
    fontSize: 10.5,
    marginTop: 2,
  },
  streetFriendsIdentity: {
    flex: 1,
    marginLeft: 10,
  },
  streetFriendsRowRight: {
    alignItems: 'flex-end',
  },
  streetFriendsChevron: {
    marginTop: 4,
    opacity: 0.62,
  },
  streetFriendsStatusBadgeLive: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#ffffff',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  streetFriendsStatusBadgeIdle: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#ffffff',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  streetFriendsStatusTextLive: {
    color: '#111827',
    fontSize: 10,
    fontWeight: '700',
  },
  streetFriendsStatusTextIdle: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '700',
  },
  usersButtonBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ef4444',
    borderWidth: 1,
    borderColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  usersButtonBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  streetFriendsLoadingToast: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 35,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#020617',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  streetFriendsLoadingToastText: {
    color: '#f8fafc',
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginLeft: 8,
  },
  liveFollowStatusChip: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 35,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.35)',
    backgroundColor: 'rgba(6, 18, 34, 0.88)',
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveFollowStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22d3ee',
    marginRight: 8,
  },
  liveFollowStatusTitle: {
    color: '#e0f2fe',
    fontSize: 11.5,
    fontWeight: '800',
    marginRight: 8,
  },
  liveFollowStatusSubtitle: {
    color: '#bae6fd',
    fontSize: 11,
    flex: 1,
  },
  liveFollowToastCard: {
    width: '90%',
    maxWidth: 430,
    zIndex: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(249,115,22,0.4)',
    backgroundColor: 'rgba(7, 16, 30, 0.95)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    shadowColor: '#020617',
    shadowOpacity: 0.36,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 18,
  },
  liveFollowToastOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  liveFollowToastIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(249,115,22,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(249,115,22,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    marginRight: 9,
  },
  liveFollowToastOfflineIconLayer: {
    alignItems: 'center',
    height: 14,
    justifyContent: 'center',
    width: 14,
  },
  liveFollowToastOfflineSlash: {
    alignItems: 'center',
    backgroundColor: 'rgba(7, 16, 30, 0.9)',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(249,115,22,0.25)',
    height: 12,
    justifyContent: 'center',
    position: 'absolute',
    right: -4,
    top: -3,
    width: 12,
  },
  liveFollowToastCopy: {
    flex: 1,
  },
  liveFollowToastTitle: {
    color: '#fff7ed',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 2,
  },
  liveFollowToastDescription: {
    color: '#fed7aa',
    fontSize: 11.5,
    lineHeight: 16,
  },
});

type MapboxScreenProps = {
  onOpenDirectMessage?: (user: ExploreSearchUser) => void;
  onOpenProfile?: () => void;
  onOverlayVisibilityChange?: (visible: boolean) => void;
  onProfileChange?: (profile: UserProfile) => void;
  onRegisterOpenMemberProfileModal?: (
    open: ((user: ExploreSearchUser) => void) | null,
  ) => void;
  /** Register handler to open the street-friends sheet from outside (e.g. Live Nearby “Tümü”). */
  onRegisterOpenStreetFriendsModal?: (open: (() => void) | null) => void;
  onStreetFriendsListChange?: (friends: ExploreStreetFriendListItem[]) => void;
  onStreetRequestsViewed?: (count: number) => void;
  profile: UserProfile;
};

type StreetFriendsSnapshot = {
  cachedAt: number;
  friends: ExploreStreetFriendListItem[];
  requestSummary:
  | {
    incomingCount: number;
    outgoingCount: number;
  }
  | null;
};

type SelectedMemberProfile = {
  avatarUrl: string;
  bio: string;
  birthYear: number | null;
  coordinate: [number, number] | null;
  displayName: string;
  handle: string;
  id: string;
  isLocal: boolean;
  photoUrl: string;
  statusLabel: string;
  stats: {
    buddies: number;
    followers: number;
    following: number;
    posts: number;
  };
  vehicleLabel: string;
  username: string;
};

type MemberRelationship = {
  followRequestStatus: FollowRequestStatus;
  followsYou: boolean;
  isFollowing: boolean;
  streetFriendStatus: StreetFriendStatus;
};

type TestStreetFriendPreview = {
  avatarUrl: string;
  displayName: string;
  id: string;
};

const MapboxScreen = ({
  onOpenDirectMessage,
  onOpenProfile,
  onOverlayVisibilityChange,
  onProfileChange,
  onRegisterOpenMemberProfileModal,
  onRegisterOpenStreetFriendsModal,
  onStreetFriendsListChange,
  onStreetRequestsViewed,
  profile,
}: MapboxScreenProps) => {
  const { showToast } = useAlert();
  const viewerProfileId = String(profile.id ?? '');
  const cameraRef = useRef<Mapbox.Camera>(null);
  const isMapReadyRef = useRef(false);
  const pendingCameraCoordinateRef = useRef<[number, number] | null>(null);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [hasLocationPermission, setHasLocationPermission] = useState(
    Platform.OS !== 'android',
  );
  const [permissionChecked, setPermissionChecked] = useState(
    Platform.OS !== 'android',
  );
  const [permissionPermanentlyDenied, setPermissionPermanentlyDenied] =
    useState(false);
  const [hasCenteredOnUser, setHasCenteredOnUser] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuSection, setMenuSection] = useState<MapMenuSection>('root');
  const [menuError, setMenuError] = useState<string | null>(null);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [mapPreferencesSaving, setMapPreferencesSaving] = useState(false);
  const [isTrackingEnabled, setIsTrackingEnabled] = useState(
    DEFAULT_MAP_PREFERENCES.trackingEnabled,
  );
  const [mapFilterMode, setMapFilterMode] = useState<MapFilterMode>(
    DEFAULT_MAP_PREFERENCES.mapFilterMode,
  );
  const [mapThemeMode, setMapThemeMode] = useState<MapThemeMode>(
    DEFAULT_MAP_PREFERENCES.mapThemeMode,
  );
  const [showRemoteLayer, setShowRemoteLayer] = useState(
    DEFAULT_MAP_PREFERENCES.showRemoteLayer,
  );
  const [showLocalLayer, setShowLocalLayer] = useState(
    DEFAULT_MAP_PREFERENCES.showLocalLayer,
  );
  const [memberModalVisible, setMemberModalVisible] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [relationshipByMember, setRelationshipByMember] = useState<
    Record<string, MemberRelationship>
  >({});
  const [followPendingMemberId, setFollowPendingMemberId] = useState<
    string | null
  >(null);
  const [streetFriendPendingMemberId, setStreetFriendPendingMemberId] = useState<
    string | null
  >(null);
  const [blockedByViewerMemberIds, setBlockedByViewerMemberIds] = useState<
    Record<string, true>
  >({});
  const [blockedByRelationshipMemberIds, setBlockedByRelationshipMemberIds] =
    useState<Record<string, true>>({});
  const [streetFriendIds, setStreetFriendIds] = useState<Record<string, true>>({});
  const [streetFriendsList, setStreetFriendsList] = useState<
    ExploreStreetFriendListItem[]
  >([]);
  const [streetFriendsModalVisible, setStreetFriendsModalVisible] = useState(false);
  const [streetFriendsModalLoading, setStreetFriendsModalLoading] = useState(false);
  const [streetFriendsModalError, setStreetFriendsModalError] = useState<string | null>(
    null,
  );
  const [streetFriendsLoadingToastVisible, setStreetFriendsLoadingToastVisible] =
    useState(false);
  const [sideBackendPreviewUser, setSideBackendPreviewUser] =
    useState<TestStreetFriendPreview | null>(null);
  const [streetFriendsSearchQuery, setStreetFriendsSearchQuery] = useState('');
  const [streetFriendIncomingRequestCount, setStreetFriendIncomingRequestCount] =
    useState(0);
  const [streetFriendRequestsUnread, setStreetFriendRequestsUnread] = useState(false);
  const lastSeenRequestCountRef = useRef<number | null>(null);
  const currentRequestCountRef = useRef(0);
  const streetFriendsTranslateY = useRef(new Animated.Value(0)).current;
  const streetFriendsOffsetRef = useRef(0);
  const streetFriendsSheetModeRef = useRef<'half' | 'full'>('full');
  const streetFriendsClosingRef = useRef(false);
  const [publicProfileByMemberId, setPublicProfileByMemberId] = useState<
    Record<string, PublicUserProfile>
  >({});
  const [relationshipError, setRelationshipError] = useState<string | null>(null);
  const [liveFollowToast, setLiveFollowToast] = useState<{
    message: string;
    title: string;
    variant: 'default' | 'offline' | 'pending';
  } | null>(null);
  const [liveFollowPath, setLiveFollowPath] = useState<[number, number][]>([]);
  const memberModalCleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveFollowToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveFollowToastOpacity = useRef(new Animated.Value(0)).current;
  const liveFollowToastTranslateY = useRef(new Animated.Value(-18)).current;
  const liveFollowToastScale = useRef(new Animated.Value(0.96)).current;
  const [liveFollowTargetId, setLiveFollowTargetId] = useState<string | null>(
    null,
  );
  const previousLiveFollowNotificationTargetRef = useRef<string | null>(null);
  const liveFollowNotificationCooldownRef = useRef<Map<string, number>>(new Map());
  const mapPreferencesMutationRef = useRef(0);
  const menuSyncFlightRef = useRef<Promise<void> | null>(null);
  const menuSyncCacheRef = useRef<{
    cachedAt: number;
    preferences: MapPreferences | null;
    privacy: UserProfile['privacy'] | null;
  }>({
    cachedAt: 0,
    preferences: null,
    privacy: profile.privacy ?? null,
  });
  const streetFriendsSnapshotRef = useRef<StreetFriendsSnapshot | null>(null);
  const streetFriendsModalRequestIdRef = useRef(0);
  const streetFriendsModalInFlightRef = useRef<Promise<void> | null>(null);
  const streetFriendsModalAbortControllerRef = useRef<AbortController | null>(null);
  const streetFriendsLoadingToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const currentProfilePrivacy = profile.privacy ?? null;
  const resolvedLocalAvatarUrl = resolveProfileAvatarUrl(profile);
  const profileStatsSafe = useMemo(
    () => getSafeProfileStats(profile),
    [
      profile.stats?.followersCount,
      profile.stats?.followingCount,
      profile.stats?.routesCount,
      profile.stats?.streetFriendsCount,
    ],
  );
  const currentMember = useMemo(() => {
    const fullName = safeProfileText(profile.fullName);
    const username = safeProfileText(profile.username);
    const displayName = fullName || username;
    const statusLabel = safeProfileText(profile.heroTagline);

    return {
      bio: safeProfileText(profile.bio),
      displayName,
      handle: username.length > 0 ? `@${username}` : '@',
      photoUrl: resolvedLocalAvatarUrl,
      statusLabel,
      stats: {
        buddies: profileStatsSafe.streetFriendsCount,
        followers: profileStatsSafe.followersCount,
        following: profileStatsSafe.followingCount,
        posts: profileStatsSafe.routesCount,
      },
      vehicleLabel: safeProfileText(profile.favoriteCar),
    };
  }, [
    profile.bio,
    profile.favoriteCar,
    profile.fullName,
    profile.heroTagline,
    profile.username,
    profileStatsSafe,
    resolvedLocalAvatarUrl,
  ]);
  const localRealtimeProfile = useMemo(
    () => ({
      displayName: currentMember.displayName,
      photoUrl: currentMember.photoUrl,
      statusLine: currentMember.statusLabel,
    }),
    [
      currentMember.displayName,
      currentMember.photoUrl,
      currentMember.statusLabel,
    ],
  );
  const isMapVisibilityEnabled = profile.privacy?.isMapVisible ?? true;
  const mapStyleURL = useMemo(() => {
    const darkStyle = Mapbox.StyleURL.Dark ?? 'mapbox://styles/mapbox/dark-v11';
    const lightStyle = Mapbox.StyleURL.Light ?? 'mapbox://styles/mapbox/light-v11';
    const streetStyle =
      Mapbox.StyleURL.Street ?? 'mapbox://styles/mapbox/streets-v12';

    switch (mapThemeMode) {
      case 'light':
        return lightStyle;
      case 'street':
        return streetStyle;
      case 'dark':
      default:
        return darkStyle;
    }
  }, [mapThemeMode]);
  const {
    ingestGpsFix,
    localPlayer,
    remotePlayers,
    socketStatus,
  } = useRealtimePlayers({
    // Connect immediately for fast map presence; only gate local publishing by permission.
    enabled: isMapVisibilityEnabled && viewerProfileId.trim().length > 0,
    publishEnabled: isTrackingEnabled && hasLocationPermission,
    localProfile: localRealtimeProfile,
    playerId: viewerProfileId,
    roomId: 'istanbul-night-drive',
    socketUrl: PLAYER_WS_URL,
  });
  const displayLocalCoordinate = localPlayer?.coordinate ?? INITIAL_COORDINATE;
  const blockedMapMemberIds = useMemo(() => {
    const next = new Set<string>();
    Object.keys(blockedByViewerMemberIds).forEach(memberId => {
      if (memberId.trim().length > 0) {
        next.add(memberId);
      }
    });
    Object.keys(blockedByRelationshipMemberIds).forEach(memberId => {
      if (memberId.trim().length > 0) {
        next.add(memberId);
      }
    });
    return next;
  }, [blockedByRelationshipMemberIds, blockedByViewerMemberIds]);
  const displayLocalStatus = !isMapVisibilityEnabled
    ? 'Harita gorunurlugu kapali'
    : !isTrackingEnabled
      ? 'Canli takip durduruldu'
      : localPlayer
        ? currentMember.statusLabel
        : hasLocationPermission
          ? 'Konum aliniyor'
          : 'Konum izni bekleniyor';
  const visibleRemotePlayers = useMemo(
    () => {
      if (!showRemoteLayer) {
        return [];
      }

      const filteredByRelationship =
        mapFilterMode === 'all'
          ? remotePlayers
          : remotePlayers.filter(player => Boolean(streetFriendIds[player.id]));

      const filteredPlayers = filteredByRelationship.filter(
        player =>
          player.id !== viewerProfileId && !blockedMapMemberIds.has(player.id),
      );
      const normalizedPlayers = filteredPlayers.map(player => ({
        ...player,
        coordinate: [
          Number(player.coordinate[0].toFixed(6)),
          Number(player.coordinate[1].toFixed(6)),
        ] as [number, number],
      }));
      if (normalizedPlayers.length > MAX_VISIBLE_REMOTE_MARKERS) {
        return normalizedPlayers.slice(0, MAX_VISIBLE_REMOTE_MARKERS);
      }
      return normalizedPlayers;
    },
    [
      blockedMapMemberIds,
      mapFilterMode,
      remotePlayers,
      showRemoteLayer,
      streetFriendIds,
      viewerProfileId,
    ],
  );
  const isLowEndDevice = useMemo(() => {
    if (Platform.OS !== 'android') {
      return false;
    }
    return typeof Platform.Version === 'number' && Platform.Version <= 29;
  }, []);
  const isPerformanceModeEnabled = useMemo(
    () => isLowEndDevice || visibleRemotePlayers.length >= 70,
    [isLowEndDevice, visibleRemotePlayers.length],
  );
  const mapPreferredFramesPerSecond = useMemo(
    () => (isPerformanceModeEnabled ? 30 : visibleRemotePlayers.length > 60 ? 45 : 60),
    [isPerformanceModeEnabled, visibleRemotePlayers.length],
  );
  const maxVisibleRemoteMarkers = isPerformanceModeEnabled ? 80 : MAX_VISIBLE_REMOTE_MARKERS;
  const optimizedVisibleRemotePlayers = useMemo(
    () => visibleRemotePlayers.slice(0, maxVisibleRemoteMarkers),
    [maxVisibleRemoteMarkers, visibleRemotePlayers],
  );
  const streetFriendMetaById = useMemo(() => {
    const m = new Map<string, ExploreStreetFriendListItem>();
    streetFriendsList.forEach(friend => {
      m.set(friend.id, friend);
    });
    return m;
  }, [streetFriendsList]);
  const enrichedOptimizedVisibleRemotePlayers = useMemo(() => {
    return optimizedVisibleRemotePlayers.map(player => {
      if (!streetFriendIds[player.id]) {
        return player;
      }
      const friend = streetFriendMetaById.get(player.id);
      if (!friend) {
        return player;
      }
      const resolvedAvatar = resolveProtectedMediaUrl(
        String(friend.avatarUrl || '').trim(),
      );
      const label =
        friend.fullName.trim() ||
        friend.username.trim().replace(/^@+/, '') ||
        player.displayName;
      const nextPhoto =
        resolvedAvatar.trim().length > 0 ? resolvedAvatar : player.photoUrl;
      if (nextPhoto === player.photoUrl && label === player.displayName) {
        return player;
      }
      return {
        ...player,
        displayName: label,
        photoUrl: nextPhoto,
      };
    });
  }, [
    optimizedVisibleRemotePlayers,
    streetFriendIds,
    streetFriendMetaById,
  ]);
  const visibleStreetFriendsList = useMemo(
    () =>
      streetFriendsList.filter(friend => !blockedMapMemberIds.has(friend.id)),
    [blockedMapMemberIds, streetFriendsList],
  );
  const streetFriendsCount = useMemo(
    () => visibleStreetFriendsList.length,
    [visibleStreetFriendsList],
  );
  const activeStreetFriendPlayers = useMemo(
    () =>
      remotePlayers.filter(
        player =>
          Boolean(streetFriendIds[player.id]) &&
          !blockedMapMemberIds.has(player.id),
      ),
    [blockedMapMemberIds, remotePlayers, streetFriendIds],
  );
  const activeStreetFriendById = useMemo(() => {
    const map: Record<string, true> = {};
    activeStreetFriendPlayers.forEach(player => {
      map[player.id] = true;
    });
    return map;
  }, [activeStreetFriendPlayers]);
  const activeStreetFriendsCount = activeStreetFriendPlayers.length;
  const offlineStreetFriendsCount = Math.max(
    0,
    streetFriendsCount - activeStreetFriendsCount,
  );
  const normalizedStreetFriendsSearchQuery = streetFriendsSearchQuery.trim().toLowerCase();
  const filteredStreetFriendsList = useMemo(() => {
    if (normalizedStreetFriendsSearchQuery.length === 0) {
      return visibleStreetFriendsList;
    }
    return visibleStreetFriendsList.filter(friend => {
      const fullName = friend.fullName.trim().toLowerCase();
      const username = friend.username.trim().toLowerCase();
      return (
        fullName.includes(normalizedStreetFriendsSearchQuery) ||
        username.includes(normalizedStreetFriendsSearchQuery)
      );
    });
  }, [normalizedStreetFriendsSearchQuery, visibleStreetFriendsList]);
  const streetFriendsListSignatureRef = useRef<string>('');
  useEffect(() => {
    if (!onStreetFriendsListChange) {
      streetFriendsListSignatureRef.current = '';
      return;
    }
    const signature = visibleStreetFriendsList
      .map(
        friend =>
          `${friend.id}|${friend.username}|${friend.fullName}|${String(friend.avatarUrl || '')}|${
            friend.isVerified ? '1' : '0'
          }`,
      )
      .join('||');
    if (streetFriendsListSignatureRef.current === signature) {
      return;
    }
    streetFriendsListSignatureRef.current = signature;
    onStreetFriendsListChange(visibleStreetFriendsList);
  }, [onStreetFriendsListChange, visibleStreetFriendsList]);
  const sideMemberPreviewPlayer = useMemo(() => {
    if (
      !SHOW_SIDE_MEMBER_PREVIEW ||
      !isMapVisibilityEnabled ||
      !showLocalLayer ||
      !sideBackendPreviewUser
    ) {
      return null;
    }
    if (visibleRemotePlayers.some(player => player.id === sideBackendPreviewUser.id)) {
      return null;
    }
    return {
      coordinate: [
        Number((displayLocalCoordinate[0] + 0.0012).toFixed(6)),
        Number((displayLocalCoordinate[1] + 0.0007).toFixed(6)),
      ] as [number, number],
      displayName: sideBackendPreviewUser.displayName,
      id: sideBackendPreviewUser.id,
      photoUrl: sideBackendPreviewUser.avatarUrl,
    };
  }, [
    displayLocalCoordinate,
    isMapVisibilityEnabled,
    visibleRemotePlayers,
    showLocalLayer,
    sideBackendPreviewUser,
  ]);

  useEffect(() => {
    AsyncStorage.getItem(SF_LAST_SEEN_REQUEST_COUNT_KEY)
      .then(stored => {
        const parsed = stored !== null ? parseInt(stored, 10) : 0;
        lastSeenRequestCountRef.current = isNaN(parsed) ? 0 : parsed;
      })
      .catch(() => {
        lastSeenRequestCountRef.current = 0;
      });
  }, []);

  useEffect(() => {
    if (lastSeenRequestCountRef.current === null) {
      return;
    }
    currentRequestCountRef.current = streetFriendIncomingRequestCount;
    if (streetFriendIncomingRequestCount > lastSeenRequestCountRef.current) {
      setStreetFriendRequestsUnread(true);
    }
  }, [streetFriendIncomingRequestCount]);

  useEffect(() => {
    if (!SHOW_SIDE_MEMBER_PREVIEW) {
      return;
    }
    let active = true;
    searchExploreUsers('', { limit: 30 })
      .then(response => {
        if (!active) {
          return;
        }
        const candidate = response.users.find(user => user.id !== viewerProfileId);
        if (!candidate) {
          return;
        }
        setSideBackendPreviewUser({
          avatarUrl: candidate.avatarUrl,
          displayName: candidate.fullName.trim() || candidate.username,
          id: candidate.id,
        });
      })
      .catch(() => {
        return;
      });
    return () => {
      active = false;
    };
  }, [viewerProfileId]);
  const selectedRealtimePlayer = useMemo(() => {
    if (!selectedMemberId) {
      return null;
    }

    if (localPlayer?.id === selectedMemberId) {
      return localPlayer;
    }

    return (
      remotePlayers.find(
        player =>
          player.id === selectedMemberId && !blockedMapMemberIds.has(player.id),
      ) ?? null
    );
  }, [blockedMapMemberIds, localPlayer, remotePlayers, selectedMemberId]);
  const selectedMemberProfile = useMemo<SelectedMemberProfile | null>(() => {
    if (!selectedMemberId) {
      return null;
    }

    const isLocal = selectedMemberId === viewerProfileId;
    if (isLocal) {
      const usernameSafe = safeProfileText(profile.username);
      const normalizedLocalUsername =
        usernameSafe.length > 0
          ? usernameSafe
          : currentMember.handle.replace(/^@/, '').trim() || viewerProfileId;
      return {
        avatarUrl: resolvedLocalAvatarUrl,
        bio: currentMember.bio,
        birthYear: profile.birthYear,
        coordinate: localPlayer?.coordinate ?? displayLocalCoordinate,
        displayName: currentMember.displayName,
        handle: currentMember.handle,
        id: selectedMemberId,
        isLocal: true,
        photoUrl: currentMember.photoUrl,
        statusLabel: displayLocalStatus,
        stats: currentMember.stats,
        vehicleLabel: currentMember.vehicleLabel,
        username: normalizedLocalUsername,
      };
    }

    const publicProfile = publicProfileByMemberId[selectedMemberId];
    const resolvedUsername = publicProfile?.username?.trim() || selectedMemberId;
    const resolvedName =
      publicProfile?.fullName?.trim() ||
      selectedRealtimePlayer?.displayName?.trim() ||
      resolvedUsername;
    const resolvedBio = publicProfile?.bio?.trim() || '';
    const resolvedHandle = `@${resolvedUsername}`;
    const resolvedStatusLine = selectedRealtimePlayer?.statusLine?.trim() || '';
    const resolvedPhoto =
      publicProfile?.avatarUrl?.trim() ||
      selectedRealtimePlayer?.photoUrl ||
      '';

    return {
      avatarUrl: resolvedPhoto,
      bio: resolvedBio,
      birthYear: typeof publicProfile?.birthYear === 'number' ? publicProfile.birthYear : null,
      coordinate: selectedRealtimePlayer?.coordinate ?? null,
      displayName: resolvedName,
      handle: resolvedHandle,
      id: selectedMemberId,
      isLocal: false,
      photoUrl: resolvedPhoto,
      statusLabel: resolvedStatusLine,
      stats: {
        buddies: publicProfile?.stats?.streetFriendsCount ?? 0,
        followers: publicProfile?.stats?.followersCount ?? 0,
        following: publicProfile?.stats?.followingCount ?? 0,
        posts: publicProfile?.stats?.routesCount ?? 0,
      },
      vehicleLabel: resolvedStatusLine,
      username: resolvedUsername,
    };
  }, [
    currentMember.bio,
    currentMember.displayName,
    currentMember.handle,
    currentMember.photoUrl,
    currentMember.stats,
    currentMember.vehicleLabel,
    displayLocalCoordinate,
    displayLocalStatus,
    localPlayer?.coordinate,
    profile.birthYear,
    profile.username,
    publicProfileByMemberId,
    viewerProfileId,
    resolvedLocalAvatarUrl,
    selectedMemberId,
    selectedRealtimePlayer,
  ]);
  const selectedMemberRelationship = selectedMemberProfile
    ? relationshipByMember[selectedMemberProfile.id]
    : undefined;
  const selectedMemberFollowRequestStatus: FollowRequestStatus = selectedMemberProfile
    ? selectedMemberRelationship?.followRequestStatus ?? 'none'
    : 'none';
  const selectedMemberIsFollowing = selectedMemberProfile
    ? selectedMemberRelationship?.isFollowing ?? false
    : false;
  const selectedMemberFollowsYou = selectedMemberProfile
    ? selectedMemberRelationship?.followsYou ?? false
    : false;
  const selectedMemberStreetStatus: StreetFriendStatus = selectedMemberProfile
    ? selectedMemberRelationship?.streetFriendStatus ?? 'none'
    : 'none';
  const selectedMemberIsStreetFriend =
    selectedMemberProfile != null
      ? selectedMemberStreetStatus === 'accepted' || Boolean(streetFriendIds[selectedMemberProfile.id])
      : false;
  const selectedMemberIsOnline = useMemo(() => {
    if (!selectedMemberProfile) {
      return false;
    }

    if (selectedMemberProfile.isLocal) {
      return (
        socketStatus === 'live' &&
        isTrackingEnabled &&
        isMapVisibilityEnabled &&
        hasLocationPermission
      );
    }

    return Boolean(selectedRealtimePlayer);
  }, [
    hasLocationPermission,
    isMapVisibilityEnabled,
    isTrackingEnabled,
    selectedMemberProfile,
    selectedRealtimePlayer,
    socketStatus,
  ]);
  const selectedMemberExploreUser = useMemo<ExploreSearchUser | null>(() => {
    if (!selectedMemberProfile || selectedMemberProfile.isLocal) {
      return null;
    }

    return {
      avatarUrl: selectedMemberProfile.avatarUrl,
      fullName:
        selectedMemberProfile.displayName.trim().length > 0
          ? selectedMemberProfile.displayName
          : selectedMemberProfile.username,
      id: selectedMemberProfile.id,
      isPrivateAccount: false,
      isVerified: false,
      username: selectedMemberProfile.username,
      viewerState: {
        followRequestStatus: selectedMemberFollowRequestStatus,
        followsYou: selectedMemberFollowsYou,
        isFollowing: selectedMemberIsFollowing,
        isStreetFriend: selectedMemberIsStreetFriend,
        streetFriendStatus: selectedMemberStreetStatus,
      },
    };
  }, [
    selectedMemberFollowRequestStatus,
    selectedMemberFollowsYou,
    selectedMemberIsFollowing,
    selectedMemberIsStreetFriend,
    selectedMemberProfile,
    selectedMemberStreetStatus,
  ]);

  const openSelectedMemberModal = useCallback((memberId: string) => {
    if (memberModalCleanupTimerRef.current) {
      clearTimeout(memberModalCleanupTimerRef.current);
      memberModalCleanupTimerRef.current = null;
    }
    setRelationshipError(null);
    setSelectedMemberId(memberId);
    setMemberModalVisible(true);
  }, []);

  const closeSelectedMemberModal = useCallback(() => {
    setMemberModalVisible(false);
    setRelationshipError(null);
    if (memberModalCleanupTimerRef.current) {
      clearTimeout(memberModalCleanupTimerRef.current);
    }
    memberModalCleanupTimerRef.current = setTimeout(() => {
      setSelectedMemberId(null);
      memberModalCleanupTimerRef.current = null;
    }, MEMBER_MODAL_CLEANUP_DELAY_MS);
  }, []);

  const openSelectedMemberFromUser = useCallback(
    (user: ExploreSearchUser) => {
      const memberId = user.id.trim();
      if (memberId.length === 0) {
        return;
      }
      setMenuVisible(false);
      openSelectedMemberModal(memberId);
    },
    [openSelectedMemberModal],
  );

  useEffect(() => {
    return () => {
      if (memberModalCleanupTimerRef.current) {
        clearTimeout(memberModalCleanupTimerRef.current);
      }
      if (liveFollowToastTimerRef.current) {
        clearTimeout(liveFollowToastTimerRef.current);
      }
    };
  }, []);
  const showLiveFollowToast = useCallback(
    (
      payload:
        | string
        | {
          message: string;
          title?: string;
          variant?: 'default' | 'offline' | 'pending';
        },
    ) => {
      const normalizedMessage =
        typeof payload === 'string'
          ? payload
          : String(payload.message ?? '').trim();
      if (normalizedMessage.length === 0) {
        return;
      }
      const normalizedTitle =
        typeof payload === 'string'
          ? 'Canlı takip şu an başlatılamadı'
          : String(payload.title ?? '').trim() ||
            'Canlı takip şu an başlatılamadı';
      const normalizedVariant: 'default' | 'offline' | 'pending' =
        typeof payload === 'string' ? 'default' : payload.variant ?? 'default';
    if (liveFollowToastTimerRef.current) {
      clearTimeout(liveFollowToastTimerRef.current);
    }
      setLiveFollowToast({
        message: normalizedMessage,
        title: normalizedTitle,
        variant: normalizedVariant,
      });
    liveFollowToastOpacity.stopAnimation();
    liveFollowToastTranslateY.stopAnimation();
    liveFollowToastScale.stopAnimation();
    liveFollowToastOpacity.setValue(0);
    liveFollowToastTranslateY.setValue(-18);
    liveFollowToastScale.setValue(0.96);
    Animated.parallel([
      Animated.timing(liveFollowToastOpacity, {
        duration: 220,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.spring(liveFollowToastTranslateY, {
        damping: 14,
        mass: 0.85,
        stiffness: 250,
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.spring(liveFollowToastScale, {
        damping: 12,
        mass: 0.82,
        stiffness: 260,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
    liveFollowToastTimerRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(liveFollowToastOpacity, {
          duration: 180,
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.timing(liveFollowToastTranslateY, {
          duration: 180,
          toValue: -12,
          useNativeDriver: true,
        }),
        Animated.timing(liveFollowToastScale, {
          duration: 180,
          toValue: 0.97,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setLiveFollowToast(null);
      });
      liveFollowToastTimerRef.current = null;
    }, 2400);
    },
    [liveFollowToastOpacity, liveFollowToastScale, liveFollowToastTranslateY],
  );

  const handleOpenSelectedMemberMessages = useCallback(() => {
    if (!selectedMemberExploreUser || !onOpenDirectMessage) {
      return;
    }

    closeSelectedMemberModal();
    onOpenDirectMessage(selectedMemberExploreUser);
  }, [closeSelectedMemberModal, onOpenDirectMessage, selectedMemberExploreUser]);

  const upsertRelationship = useCallback(
    (memberId: string, patch: Partial<MemberRelationship>) => {
      setRelationshipByMember(previous => {
        const current = previous[memberId] ?? {
          followRequestStatus: 'none',
          followsYou: false,
          isFollowing: false,
          streetFriendStatus: 'none',
        };
        const next = {
          ...current,
          ...patch,
        };
        if (
          current.followRequestStatus === next.followRequestStatus &&
          current.followsYou === next.followsYou &&
          current.isFollowing === next.isFollowing &&
          current.streetFriendStatus === next.streetFriendStatus
        ) {
          return previous;
        }
        return {
          ...previous,
          [memberId]: next,
        };
      });
    },
    [],
  );

  const applyStreetFriendsSnapshot = useCallback(
    (
      friends: ExploreStreetFriendListItem[],
      requestSummary?:
        | {
          incomingCount: number;
          outgoingCount: number;
        }
        | null,
      cachedAt?: number,
    ) => {
      streetFriendsSnapshotRef.current = {
        cachedAt: cachedAt ?? Date.now(),
        friends,
        requestSummary:
          requestSummary ?? streetFriendsSnapshotRef.current?.requestSummary ?? null,
      };
      const accepted: Record<string, true> = {};
      friends.forEach(friend => {
        accepted[friend.id] = true;
      });

      setStreetFriendIds(accepted);
      setStreetFriendsList(friends);
      setRelationshipByMember(previous => {
        let changed = false;
        const next = { ...previous };

        Object.keys(next).forEach(memberId => {
          const current = next[memberId];
          const shouldBeAccepted = Boolean(accepted[memberId]);
          const desiredStatus: StreetFriendStatus = shouldBeAccepted
            ? 'accepted'
            : current.streetFriendStatus === 'accepted'
              ? 'none'
              : current.streetFriendStatus;

          if (current.streetFriendStatus !== desiredStatus) {
            next[memberId] = {
              ...current,
              streetFriendStatus: desiredStatus,
            };
            changed = true;
          }
        });

        Object.keys(accepted).forEach(memberId => {
          if (next[memberId]) {
            return;
          }
          next[memberId] = {
            followRequestStatus: 'none',
            followsYou: false,
            isFollowing: false,
            streetFriendStatus: 'accepted',
          };
          changed = true;
        });

        return changed ? next : previous;
      });

      if (requestSummary) {
        setStreetFriendIncomingRequestCount(requestSummary.incomingCount);
      }
    },
    [],
  );

  useEffect(() => {
    menuSyncCacheRef.current = {
      ...menuSyncCacheRef.current,
      privacy: currentProfilePrivacy,
    };
  }, [currentProfilePrivacy]);

  useEffect(() => {
    if (!memberModalVisible || !selectedMemberId || selectedMemberId === viewerProfileId) {
      return;
    }

    let active = true;
    const memberId = selectedMemberId;

    fetchPublicProfile(memberId)
      .then(response => {
        if (!active) {
          return;
        }

        const isBlockedRelationship =
          response.viewerState.isBlockedByTarget ||
          response.viewerState.isBlockedByViewer;
        if (isBlockedRelationship) {
          setBlockedByRelationshipMemberIds(previous => {
            if (previous[memberId]) {
              return previous;
            }
            return {
              ...previous,
              [memberId]: true,
            };
          });
          if (selectedMemberId === memberId) {
            setMemberModalVisible(false);
            setSelectedMemberId(null);
            setRelationshipError(null);
            setLiveFollowTargetId(previous =>
              previous === memberId ? null : previous,
            );
            showToast({
              message: 'Bu hesap su an goruntulenemiyor.',
              title: HIDDEN_USER_NOT_FOUND_LABEL,
              tone: 'warning',
            });
          }
          return;
        }

        setBlockedByRelationshipMemberIds(previous => {
          if (!previous[memberId]) {
            return previous;
          }
          const next = { ...previous };
          delete next[memberId];
          return next;
        });
        setPublicProfileByMemberId(previous => ({
          ...previous,
          [memberId]: response,
        }));
        upsertRelationship(memberId, {
          followRequestStatus: response.viewerState.followRequestStatus,
          followsYou: response.viewerState.followsYou,
          isFollowing: response.viewerState.isFollowing,
        });
      })
      .catch(error => {
        if (!active) {
          return;
        }
        if (isPublicProfileUnavailableError(error)) {
          if (selectedMemberId === memberId) {
            setMemberModalVisible(false);
            setSelectedMemberId(null);
          }
          return;
        }
        console.warn('Member public profile could not be loaded.', error);
      });

    return () => {
      active = false;
    };
  }, [
    memberModalVisible,
    selectedMemberId,
    showToast,
    upsertRelationship,
    viewerProfileId,
  ]);

  const syncBlockedUsers = useCallback(async () => {
    try {
      const response = await fetchBlockedUsers();
      const nextBlockedByViewer: Record<string, true> = {};
      response.users.forEach(user => {
        const memberId = user.id.trim();
        if (memberId.length > 0) {
          nextBlockedByViewer[memberId] = true;
        }
      });
      setBlockedByViewerMemberIds(previous =>
        areMemberIdMapsEqual(previous, nextBlockedByViewer)
          ? previous
          : nextBlockedByViewer,
      );
    } catch (error) {
      console.warn('Blocked users sync failed.', error);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let appState: AppStateStatus = AppState.currentState;
    const syncBlockedState = () => {
      if (!active || appState !== 'active') {
        return;
      }
      syncBlockedUsers().catch(() => {
        return;
      });
    };

    syncBlockedState();
    const timer = setInterval(syncBlockedState, BLOCKED_USERS_SYNC_INTERVAL_MS);
    const appStateSubscription = AppState.addEventListener('change', nextState => {
      const becameActive =
        (appState === 'background' || appState === 'inactive') &&
        nextState === 'active';
      appState = nextState;
      if (becameActive) {
        syncBlockedState();
      }
    });

    return () => {
      active = false;
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [syncBlockedUsers]);

  useEffect(() => {
    if (
      !selectedMemberId ||
      selectedMemberId === viewerProfileId ||
      !blockedMapMemberIds.has(selectedMemberId)
    ) {
      return;
    }
    setMemberModalVisible(false);
    setSelectedMemberId(null);
    setRelationshipError(null);
  }, [blockedMapMemberIds, selectedMemberId, viewerProfileId]);

  useEffect(() => {
    if (!liveFollowTargetId || !blockedMapMemberIds.has(liveFollowTargetId)) {
      return;
    }
    setLiveFollowTargetId(null);
  }, [blockedMapMemberIds, liveFollowTargetId]);

  useEffect(() => {
    let active = true;
    let appState: AppStateStatus = AppState.currentState;
    let syncInFlight = false;
    let syncTimer: ReturnType<typeof setTimeout> | null = null;

    const resolveNextDelay = () =>
      Math.floor(
        STREET_FRIENDS_SYNC_INTERVAL_MIN_MS +
        Math.random() *
        (STREET_FRIENDS_SYNC_INTERVAL_MAX_MS -
          STREET_FRIENDS_SYNC_INTERVAL_MIN_MS),
      );

    const clearSyncTimer = () => {
      if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
      }
    };

    const scheduleNextSync = (delayMs?: number) => {
      clearSyncTimer();
      if (!active || appState !== 'active') {
        return;
      }
      syncTimer = setTimeout(() => {
        syncStreetFriends();
      }, typeof delayMs === 'number' ? delayMs : resolveNextDelay());
    };

    const syncStreetFriends = () => {
      if (!active || appState !== 'active') {
        scheduleNextSync();
        return;
      }
      if (syncInFlight) {
        scheduleNextSync(STREET_FRIENDS_SYNC_INTERVAL_MAX_MS);
        return;
      }

      syncInFlight = true;
      Promise.allSettled([fetchStreetFriends(), fetchStreetFriendRequests()])
        .then(([friendsResult, requestsResult]) => {
          if (!active) {
            return;
          }

          if (friendsResult.status === 'fulfilled') {
            applyStreetFriendsSnapshot(
              friendsResult.value.friends,
              requestsResult.status === 'fulfilled'
                ? resolveStreetFriendRequestSummary(requestsResult.value)
                : null,
            );
          } else if (requestsResult.status === 'fulfilled') {
            const requestSummary = resolveStreetFriendRequestSummary(
              requestsResult.value,
            );
            setStreetFriendIncomingRequestCount(requestSummary.incomingCount);
          }
        })
        .finally(() => {
          syncInFlight = false;
          scheduleNextSync();
        });
    };

    syncStreetFriends();

    const appStateSubscription = AppState.addEventListener('change', nextState => {
      const becameActive =
        (appState === 'background' || appState === 'inactive') &&
        nextState === 'active';
      appState = nextState;
      if (becameActive) {
        syncStreetFriends();
        return;
      }
      if (nextState !== 'active') {
        clearSyncTimer();
      }
    });
    return () => {
      active = false;
      clearSyncTimer();
      appStateSubscription.remove();
    };
  }, [
    applyStreetFriendsSnapshot,
    profile.stats?.streetFriendsCount,
    upsertRelationship,
  ]);

  useEffect(() => {
    onOverlayVisibilityChange?.(menuVisible || streetFriendsModalVisible);
  }, [menuVisible, onOverlayVisibilityChange, streetFriendsModalVisible]);

  useEffect(() => {
    return () => {
      onOverlayVisibilityChange?.(false);
    };
  }, [onOverlayVisibilityChange]);

  useEffect(() => {
    return () => {
      streetFriendsModalAbortControllerRef.current?.abort();
      streetFriendsModalAbortControllerRef.current = null;
      streetFriendsModalInFlightRef.current = null;
      if (streetFriendsLoadingToastTimerRef.current) {
        clearTimeout(streetFriendsLoadingToastTimerRef.current);
        streetFriendsLoadingToastTimerRef.current = null;
      }
    };
  }, []);

  const runMapboxCommandSafely = useCallback((command: () => unknown) => {
    try {
      const result = command();
      if (
        result &&
        typeof result === 'object' &&
        'catch' in result &&
        typeof (result as Promise<unknown>).catch === 'function'
      ) {
        (result as Promise<unknown>).catch(() => undefined);
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('Mapbox command skipped', error);
      }
    }
  }, []);

  const centerCameraOnCoordinate = useCallback(
    (coordinate: [number, number]) => {
      if (!isMapReadyRef.current) {
        pendingCameraCoordinateRef.current = coordinate;
        return;
      }

      runMapboxCommandSafely(() =>
        cameraRef.current?.setCamera({
          animationDuration: 0,
          animationMode: 'moveTo',
          centerCoordinate: coordinate,
          heading: 0,
          pitch: 0,
          zoomLevel: 14.5,
        }),
      );
    },
    [runMapboxCommandSafely],
  );

  useEffect(() => {
    return () => {
      isMapReadyRef.current = false;
      pendingCameraCoordinateRef.current = null;
    };
  }, []);

  const requestLocationPermission = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setHasLocationPermission(true);
      setPermissionChecked(true);
      return;
    }

    try {
      const permission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
      const alreadyGranted = await PermissionsAndroid.check(permission);

      if (alreadyGranted) {
        setHasLocationPermission(true);
        setPermissionChecked(true);
        setPermissionPermanentlyDenied(false);
        return;
      }

      const result = await PermissionsAndroid.request(permission, {
        title: 'Location permission',
        message: 'Allow location to show your current position on map.',
        buttonPositive: 'Allow',
        buttonNegative: 'Cancel',
      });

      setHasLocationPermission(result === PermissionsAndroid.RESULTS.GRANTED);
      setPermissionPermanentlyDenied(
        result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
      );
      if (result !== PermissionsAndroid.RESULTS.GRANTED) {
        setHasCenteredOnUser(false);
      }
      setPermissionChecked(true);
    } catch (error) {
      console.warn('Location permission request failed', error);
      setHasLocationPermission(false);
      setPermissionPermanentlyDenied(false);
      setPermissionChecked(true);
    }
  }, []);

  useEffect(() => {
    requestLocationPermission();
  }, [requestLocationPermission]);

  const closeMenu = useCallback(() => {
    setMenuVisible(false);
    setMenuSection('root');
    setMenuError(null);
  }, []);

  const applyMapPreferences = useCallback((preferences: MapPreferences) => {
    const safePreferences = normalizeMapPreferences(preferences);

    setMapFilterMode(safePreferences.mapFilterMode);
    setMapThemeMode(safePreferences.mapThemeMode);
    setShowLocalLayer(safePreferences.showLocalLayer);
    setShowRemoteLayer(safePreferences.showRemoteLayer);
    setIsTrackingEnabled(safePreferences.trackingEnabled);
    if (!safePreferences.trackingEnabled) {
      setLiveFollowTargetId(null);
    }
  }, []);

  const applyPrivacySnapshot = useCallback(
    (privacy: UserProfile['privacy']) => {
      onProfileChange?.({
        ...profile,
        privacy,
      });
    },
    [onProfileChange, profile],
  );

  const syncMenuStateFromBackend = useCallback(async (force = true) => {
    const cached = menuSyncCacheRef.current;
    if (
      !force &&
      cached.preferences &&
      cached.privacy &&
      Date.now() - cached.cachedAt < MAP_MENU_SYNC_CACHE_TTL_MS
    ) {
      setMenuError(null);
      applyMapPreferences(cached.preferences);
      applyPrivacySnapshot(cached.privacy);
      return;
    }

    if (menuSyncFlightRef.current) {
      return menuSyncFlightRef.current;
    }

    setMenuError(null);
    setMapPreferencesSaving(true);
    setVisibilitySaving(true);

    const flight = (async () => {
      let nextError: string | null = null;
      let nextPreferences = cached.preferences;
      let nextPrivacy = cached.privacy;

      try {
        const [preferencesResult, privacyResult] = await Promise.allSettled([
          fetchMapPreferences(),
          fetchProfilePrivacy(),
        ]);

        if (preferencesResult.status === 'fulfilled') {
          nextPreferences = preferencesResult.value;
        } else {
          console.warn('Map preferences sync failed.', preferencesResult.reason);
        }

        if (privacyResult.status === 'fulfilled') {
          nextPrivacy = {
            isMapVisible: privacyResult.value.isMapVisible,
            isPrivateAccount: privacyResult.value.isPrivateAccount,
          };
        } else {
          console.warn('Profile privacy sync failed.', privacyResult.reason);
        }

        if (nextPreferences) {
          applyMapPreferences(nextPreferences);
        }
        if (nextPrivacy) {
          applyPrivacySnapshot(nextPrivacy);
        }

        if (nextPreferences || nextPrivacy) {
          menuSyncCacheRef.current = {
            cachedAt: Date.now(),
            preferences: nextPreferences,
            privacy: nextPrivacy,
          };
        } else {
          nextError = resolveMenuErrorMessage(
            preferencesResult.status === 'rejected'
              ? preferencesResult.reason
              : privacyResult.status === 'rejected'
                ? privacyResult.reason
                : null,
            "Menu backend'den senkronize edilemedi.",
          );
        }
      } finally {
        if (nextError) {
          setMenuError(nextError);
        }
        setMapPreferencesSaving(false);
        setVisibilitySaving(false);
      }
    })().finally(() => {
      if (menuSyncFlightRef.current === flight) {
        menuSyncFlightRef.current = null;
      }
    });

    menuSyncFlightRef.current = flight;
    return flight;
  }, [applyMapPreferences, applyPrivacySnapshot]);

  const openMenu = useCallback(() => {
    setMenuError(null);
    setMenuSection('root');
    setMenuVisible(true);
    syncMenuStateFromBackend(true).catch(() => {
      return;
    });
  }, [syncMenuStateFromBackend]);

  const refreshStreetFriendsModal = useCallback(
    async (options?: { force?: boolean; showLoader?: boolean }) => {
      const force = options?.force ?? true;
      const showLoader = options?.showLoader ?? true;
      const cached = streetFriendsSnapshotRef.current;
      if (
        !force &&
        cached &&
        Date.now() - cached.cachedAt < STREET_FRIENDS_SNAPSHOT_CACHE_TTL_MS
      ) {
        if (showLoader) {
          setStreetFriendsModalLoading(false);
        }
        applyStreetFriendsSnapshot(
          cached.friends,
          cached.requestSummary,
          cached.cachedAt,
        );
        setStreetFriendsModalError(null);
        return;
      }

      if (streetFriendsModalInFlightRef.current) {
        return streetFriendsModalInFlightRef.current;
      }

      const requestId = streetFriendsModalRequestIdRef.current + 1;
      streetFriendsModalRequestIdRef.current = requestId;
      streetFriendsModalAbortControllerRef.current?.abort();
      const requestAbortController = new AbortController();
      streetFriendsModalAbortControllerRef.current = requestAbortController;

      if (showLoader) {
        setStreetFriendsModalLoading(true);
        setStreetFriendsLoadingToastVisible(true);
        if (streetFriendsLoadingToastTimerRef.current) {
          clearTimeout(streetFriendsLoadingToastTimerRef.current);
          streetFriendsLoadingToastTimerRef.current = null;
        }
      }
      setStreetFriendsModalError(null);

      const flight = (async () => {
        try {
          const [friendsResult, requestsResult] = await Promise.allSettled([
            fetchStreetFriends({ signal: requestAbortController.signal }),
            fetchStreetFriendRequests({ signal: requestAbortController.signal }),
          ]);

          if (
            requestAbortController.signal.aborted ||
            requestId !== streetFriendsModalRequestIdRef.current
          ) {
            return;
          }

          if (friendsResult.status === 'fulfilled') {
            const requestSummary =
              requestsResult.status === 'fulfilled'
                ? resolveStreetFriendRequestSummary(requestsResult.value)
                : streetFriendsSnapshotRef.current?.requestSummary ?? null;
            applyStreetFriendsSnapshot(
              friendsResult.value.friends,
              requestSummary,
            );
            return;
          }

          if (requestsResult.status === 'fulfilled') {
            const requestSummary = resolveStreetFriendRequestSummary(
              requestsResult.value,
            );
            setStreetFriendIncomingRequestCount(requestSummary.incomingCount);
          }

          setStreetFriendsModalError(
            resolveMenuErrorMessage(
              friendsResult.reason,
              'Yakındakiler MacRadar ile senkronize edilemedi.',
            ),
          );
        } finally {
          if (
            streetFriendsModalAbortControllerRef.current === requestAbortController
          ) {
            streetFriendsModalAbortControllerRef.current = null;
          }
          if (requestId === streetFriendsModalRequestIdRef.current) {
            streetFriendsModalInFlightRef.current = null;
          }
          if (
            showLoader &&
            requestId === streetFriendsModalRequestIdRef.current &&
            !requestAbortController.signal.aborted
          ) {
            setStreetFriendsModalLoading(false);
            streetFriendsLoadingToastTimerRef.current = setTimeout(() => {
              setStreetFriendsLoadingToastVisible(false);
              streetFriendsLoadingToastTimerRef.current = null;
            }, 420);
          }
        }
      })();

      streetFriendsModalInFlightRef.current = flight;
      return flight;
    },
    [applyStreetFriendsSnapshot],
  );

  const openStreetFriendsModal = useCallback(() => {
    setStreetFriendsSearchQuery('');
    setStreetFriendsModalVisible(true);
    const hasWarmSnapshot = Boolean(streetFriendsSnapshotRef.current);
    refreshStreetFriendsModal({
      force: !hasWarmSnapshot,
      showLoader: !hasWarmSnapshot,
    }).catch(() => {
      return;
    });
  }, [refreshStreetFriendsModal]);

  useEffect(() => {
    if (!onRegisterOpenStreetFriendsModal) {
      return undefined;
    }
    onRegisterOpenStreetFriendsModal(openStreetFriendsModal);
    return () => {
      onRegisterOpenStreetFriendsModal(null);
    };
  }, [onRegisterOpenStreetFriendsModal, openStreetFriendsModal]);

  useEffect(() => {
    if (!onRegisterOpenMemberProfileModal) {
      return undefined;
    }
    onRegisterOpenMemberProfileModal(openSelectedMemberFromUser);
    return () => {
      onRegisterOpenMemberProfileModal(null);
    };
  }, [onRegisterOpenMemberProfileModal, openSelectedMemberFromUser]);

  useEffect(() => {
    if (!streetFriendsModalVisible) {
      return;
    }

    setStreetFriendRequestsUnread(false);
    const countToStore = currentRequestCountRef.current;
    lastSeenRequestCountRef.current = countToStore;
    AsyncStorage.setItem(SF_LAST_SEEN_REQUEST_COUNT_KEY, String(countToStore)).catch(() => {
      return;
    });

    let active = true;
    let appState: AppStateStatus = AppState.currentState;

    const syncStreetFriendsModal = () => {
      if (!active || appState !== 'active') {
        return;
      }
      refreshStreetFriendsModal({ force: true, showLoader: false }).catch(() => {
        return;
      });
    };

    const timer = setInterval(() => {
      syncStreetFriendsModal();
    }, STREET_FRIENDS_MODAL_REFRESH_INTERVAL_MS);

    const appStateSubscription = AppState.addEventListener('change', nextState => {
      const becameActive =
        (appState === 'background' || appState === 'inactive') &&
        nextState === 'active';
      appState = nextState;
      if (becameActive) {
        syncStreetFriendsModal();
      }
    });

    return () => {
      active = false;
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [refreshStreetFriendsModal, streetFriendsModalVisible]);

  useEffect(() => {
    if (streetFriendsModalVisible) {
      return;
    }
    streetFriendsModalAbortControllerRef.current?.abort();
    streetFriendsModalAbortControllerRef.current = null;
    streetFriendsModalInFlightRef.current = null;
    setStreetFriendsModalLoading(false);
    setStreetFriendsLoadingToastVisible(false);
    if (streetFriendsLoadingToastTimerRef.current) {
      clearTimeout(streetFriendsLoadingToastTimerRef.current);
      streetFriendsLoadingToastTimerRef.current = null;
    }
  }, [streetFriendsModalVisible]);

  const streetFriendsSheetMaxHeight = useMemo(() => {
    return Math.min(
      windowHeight -
      Math.max(
        insets.bottom +
        MAP_MENU_SHEET_LAYOUT.tabBarOffset +
        MAP_MENU_SHEET_LAYOUT.safeBottomPadding,
        MAP_MENU_SHEET_LAYOUT.minTopGap,
      ),
      Math.max(
        MAP_MENU_SHEET_LAYOUT.minHeight,
        Math.round(windowHeight * MAP_MENU_SHEET_LAYOUT.heightRatio),
      ),
    );
  }, [insets.bottom, windowHeight]);

  const streetFriendsHalfOffset = useMemo(() => {
    const halfVisibleHeight = Math.min(
      MAP_MENU_SHEET_LAYOUT.halfVisibleMax,
      Math.max(
        MAP_MENU_SHEET_LAYOUT.halfVisibleMin,
        Math.round(windowHeight * 0.5),
      ),
    );
    return Math.max(0, streetFriendsSheetMaxHeight - halfVisibleHeight);
  }, [streetFriendsSheetMaxHeight, windowHeight]);

  const streetFriendsClosedOffset = useMemo(
    () => streetFriendsSheetMaxHeight + MAP_MENU_SHEET_LAYOUT.closedOffset,
    [streetFriendsSheetMaxHeight],
  );

  const animateStreetFriendsSheet = useCallback(
    (nextOffset: number, nextMode: 'half' | 'full') => {
      Animated.spring(streetFriendsTranslateY, {
        damping: MAP_MENU_SHEET_SPRING.damping,
        mass: MAP_MENU_SHEET_SPRING.mass,
        stiffness: MAP_MENU_SHEET_SPRING.stiffness,
        toValue: nextOffset,
        useNativeDriver: true,
      }).start(() => {
        streetFriendsOffsetRef.current = nextOffset;
        streetFriendsSheetModeRef.current = nextMode;
      });
    },
    [streetFriendsTranslateY],
  );

  const closeStreetFriendsSheet = useCallback(
    (onClosed?: () => void) => {
      if (streetFriendsClosingRef.current) {
        return;
      }
      streetFriendsModalAbortControllerRef.current?.abort();
      streetFriendsModalAbortControllerRef.current = null;
      streetFriendsModalInFlightRef.current = null;
      setStreetFriendsModalLoading(false);
      streetFriendsClosingRef.current = true;
      Animated.timing(streetFriendsTranslateY, {
        duration: MAP_MENU_SHEET_CLOSE_DURATION,
        toValue: streetFriendsClosedOffset,
        useNativeDriver: true,
      }).start(({ finished }) => {
        streetFriendsClosingRef.current = false;
        if (!finished) {
          return;
        }
        setStreetFriendsModalVisible(false);
        setStreetFriendsModalError(null);
        setStreetFriendsSearchQuery('');
        onClosed?.();
      });
    },
    [streetFriendsClosedOffset, streetFriendsTranslateY],
  );

  const handleStreetFriendsModalRequestClose = useCallback(() => {
    closeStreetFriendsSheet();
  }, [closeStreetFriendsSheet]);

  const toggleStreetFriendsSnap = useCallback(() => {
    if (streetFriendsClosingRef.current || !streetFriendsModalVisible) {
      return;
    }
    if (streetFriendsSheetModeRef.current === 'full') {
      animateStreetFriendsSheet(streetFriendsHalfOffset, 'half');
      return;
    }
    animateStreetFriendsSheet(0, 'full');
  }, [animateStreetFriendsSheet, streetFriendsHalfOffset, streetFriendsModalVisible]);

  useEffect(() => {
    if (!streetFriendsModalVisible) {
      return;
    }
    streetFriendsSheetModeRef.current = 'full';
    streetFriendsTranslateY.setValue(streetFriendsClosedOffset);
    streetFriendsOffsetRef.current = streetFriendsClosedOffset;
    const frame = requestAnimationFrame(() => {
      animateStreetFriendsSheet(0, 'full');
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    animateStreetFriendsSheet,
    streetFriendsClosedOffset,
    streetFriendsModalVisible,
    streetFriendsTranslateY,
  ]);

  const streetFriendsPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dy) > 6 &&
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderMove: (_, gestureState) => {
          if (streetFriendsClosingRef.current) {
            return;
          }
          const nextValue = Math.max(0, streetFriendsOffsetRef.current + gestureState.dy);
          streetFriendsTranslateY.setValue(nextValue);
        },
        onPanResponderRelease: (_, gestureState) => {
          if (streetFriendsClosingRef.current) {
            return;
          }
          const projectedOffset = streetFriendsOffsetRef.current + gestureState.dy;
          const velocityBoost =
            gestureState.vy * MAP_MENU_SHEET_GESTURE.velocityBoost;
          const settleOffset = projectedOffset + velocityBoost;
          const shouldClose =
            settleOffset >
            streetFriendsHalfOffset + MAP_MENU_SHEET_GESTURE.closeBuffer ||
            gestureState.vy > MAP_MENU_SHEET_GESTURE.closeVelocity;
          if (shouldClose) {
            closeStreetFriendsSheet();
            return;
          }
          const shouldSnapHalf =
            settleOffset >
            streetFriendsHalfOffset * MAP_MENU_SHEET_GESTURE.halfSnapRatio;
          if (shouldSnapHalf) {
            animateStreetFriendsSheet(streetFriendsHalfOffset, 'half');
            return;
          }
          animateStreetFriendsSheet(0, 'full');
        },
        onPanResponderTerminate: () => {
          if (streetFriendsClosingRef.current) {
            return;
          }
          animateStreetFriendsSheet(
            streetFriendsSheetModeRef.current === 'full' ? 0 : streetFriendsHalfOffset,
            streetFriendsSheetModeRef.current,
          );
        },
      }),
    [
      animateStreetFriendsSheet,
      closeStreetFriendsSheet,
      streetFriendsHalfOffset,
      streetFriendsTranslateY,
    ],
  );

  useEffect(() => {
    let active = true;
    
    const bootstrapMap = async () => {
      setMapPreferencesSaving(true);
      try {
        const data = await fetchMapBootstrap();
        if (!active) return;

        // Apply preferences immediately
        const prefs = normalizeMapPreferences({
          mapFilterMode: data.preferences.mapFilterMode as any,
          mapThemeMode: data.preferences.mapThemeMode as any,
          showLocalLayer: data.preferences.showLocalLayer,
          showRemoteLayer: data.preferences.showRemoteLayer,
          trackingEnabled: data.preferences.trackingEnabled,
        });
        applyMapPreferences(prefs);

        // Apply friends and requests
        applyStreetFriendsSnapshot(
          data.streetFriends.friends,
          resolveStreetFriendRequestSummary(data.streetRequests)
        );

        setMenuError(null);
      } catch (error) {
        if (!active) return;
        setMenuError(resolveMenuErrorMessage(error, "Harita verileri backend'den alinamadi."));
      } finally {
        if (active) setMapPreferencesSaving(false);
      }
    };

    bootstrapMap();

    return () => {
      active = false;
    };
  }, [applyMapPreferences, applyStreetFriendsSnapshot]);

  const persistMapPreferences = useCallback(
    async (
      payload: UpdateMapPreferencesPayload,
      onRevert?: () => void,
    ) => {
      const mutationID = mapPreferencesMutationRef.current + 1;
      mapPreferencesMutationRef.current = mutationID;
      setMapPreferencesSaving(true);
      setMenuError(null);

      try {
        const response = await updateMapPreferences(payload);
        if (mutationID !== mapPreferencesMutationRef.current) {
          return;
        }
        applyMapPreferences(response);
        menuSyncCacheRef.current = {
          cachedAt: Date.now(),
          preferences: response,
          privacy: menuSyncCacheRef.current.privacy,
        };
      } catch (error) {
        if (mutationID !== mapPreferencesMutationRef.current) {
          return;
        }
        onRevert?.();
        setMenuError(
          resolveMenuErrorMessage(error, "Harita ayari backend'e kaydedilemedi."),
        );
      } finally {
        if (mutationID === mapPreferencesMutationRef.current) {
          setMapPreferencesSaving(false);
        }
      }
    },
    [applyMapPreferences],
  );

  const handleTrackingToggle = useCallback(
    async (nextEnabled: boolean) => {
      if (mapPreferencesSaving || nextEnabled === isTrackingEnabled) {
        return;
      }

      const previousValue = isTrackingEnabled;
      setIsTrackingEnabled(nextEnabled);

      try {
        if (nextEnabled) {
          await startTrackingSession();
        } else {
          await stopTrackingSession();
        }

        await persistMapPreferences(
          { trackingEnabled: nextEnabled },
          () => {
            setIsTrackingEnabled(previousValue);
          }
        );
      } catch (error) {
        setIsTrackingEnabled(previousValue);
        setMenuError(
          resolveMenuErrorMessage(error, 'Canli takip durumu guncellenemedi.'),
        );
      }
    },
    [isTrackingEnabled, mapPreferencesSaving, persistMapPreferences],
  );

  const handleUserLocationUpdate = useCallback(
    (location: {
      coords?: {
        accuracy?: number;
        heading?: number;
        latitude?: number;
        longitude?: number;
        speed?: number;
      };
      timestamp?: number;
    }) => {
      const lng = location?.coords?.longitude;
      const lat = location?.coords?.latitude;

      if (typeof lng !== 'number' || typeof lat !== 'number') {
        return;
      }

      const nextCoordinate: [number, number] = [lng, lat];
      ingestGpsFix({
        accuracy: location?.coords?.accuracy ?? 0,
        heading: location?.coords?.heading ?? 0,
        latitude: lat,
        longitude: lng,
        speed: location?.coords?.speed ?? 0,
        timestamp: location?.timestamp ?? Date.now(),
      });

      if (!hasCenteredOnUser) {
        centerCameraOnCoordinate(nextCoordinate);
        setHasCenteredOnUser(true);
      }
    },
    [centerCameraOnCoordinate, hasCenteredOnUser, ingestGpsFix],
  );

  const handleMenuRecenterPress = useCallback(() => {
    closeMenu();
    centerCameraOnCoordinate(displayLocalCoordinate);
  }, [centerCameraOnCoordinate, closeMenu, displayLocalCoordinate]);

  const handleOpenStreetRequests = useCallback(() => {
    closeStreetFriendsSheet(() => {
      onStreetRequestsViewed?.(streetFriendIncomingRequestCount);
      openMenu();
      setMenuSection('street_requests');
    });
  }, [
    closeStreetFriendsSheet,
    onStreetRequestsViewed,
    openMenu,
    streetFriendIncomingRequestCount,
  ]);

  const activateStreetOnlyMode = useCallback(() => {
    if (mapFilterMode === 'street_friends' && showRemoteLayer) {
      return;
    }
    const previousFilter = mapFilterMode;
    const previousRemoteLayer = showRemoteLayer;
    setMapFilterMode('street_friends');
    setShowRemoteLayer(true);
    persistMapPreferences(
      {
        mapFilterMode: 'street_friends',
        showRemoteLayer: true,
      },
      () => {
        setMapFilterMode(previousFilter);
        setShowRemoteLayer(previousRemoteLayer);
      },
    ).catch(() => {
      return;
    });
  }, [mapFilterMode, persistMapPreferences, showRemoteLayer]);

  const followFirstActiveStreetFriend = useCallback(() => {
    const firstLiveFriend = activeStreetFriendPlayers[0];
    if (!firstLiveFriend?.coordinate) {
      setStreetFriendsModalError('Haritada aktif Yakındakiler su an yok.');
      return;
    } 
    const liveFriendDetails = visibleStreetFriendsList.find(
      friend => friend.id === firstLiveFriend.id,
    );
    const liveFriendDisplayNameRaw = liveFriendDetails?.fullName?.trim() ?? '';
    const liveFriendDisplayName =
      liveFriendDisplayNameRaw.length > 0
        ? liveFriendDisplayNameRaw
        : `@${liveFriendDetails?.username ?? firstLiveFriend.id}`;
    centerCameraOnCoordinate(firstLiveFriend.coordinate);
    setLiveFollowTargetId(firstLiveFriend.id);
    setStreetFriendsModalVisible(false);
    setStreetFriendsModalError(null);
    showToast({
      message: `${liveFriendDisplayName} takip ediliyor.`,
      title: 'Canlı takip başlatıldı',
      tone: 'success',
    });
  }, [
    activeStreetFriendPlayers,
    centerCameraOnCoordinate,
    showToast,
    visibleStreetFriendsList,
  ]);

  const handlePermissionAction = useCallback(() => {
    if (permissionPermanentlyDenied) {
      Linking.openSettings().catch(error => {
        console.warn('Failed to open app settings', error);
      });
      return;
    }

    requestLocationPermission();
  }, [permissionPermanentlyDenied, requestLocationPermission]);

  const handleVisibilitySelection = useCallback(
    async (nextVisible: boolean) => {
      if (visibilitySaving || nextVisible === isMapVisibilityEnabled) {
        return;
      }

      setVisibilitySaving(true);
      setMenuError(null);

      try {
        const response = await updateProfilePrivacy({
          isMapVisible: nextVisible,
        });

        const nextPrivacy = {
          isMapVisible: response.isMapVisible,
          isPrivateAccount: response.isPrivateAccount,
        };
        applyPrivacySnapshot(nextPrivacy);
        menuSyncCacheRef.current = {
          cachedAt: Date.now(),
          preferences: menuSyncCacheRef.current.preferences,
          privacy: nextPrivacy,
        };

        if (!response.isMapVisible) {
          setLiveFollowTargetId(null);
        }
      } catch (error) {
        setMenuError(
          resolveMenuErrorMessage(error, 'Gorunurluk ayari kaydedilemedi.'),
        );
      } finally {
        setVisibilitySaving(false);
      }
    },
    [applyPrivacySnapshot, isMapVisibilityEnabled, visibilitySaving],
  );

  const toggleFollowForSelectedMember = useCallback(async () => {
    if (!selectedMemberProfile || selectedMemberProfile.isLocal) {
      return;
    }

    const previousRelationship =
      relationshipByMember[selectedMemberProfile.id] ?? {
        followRequestStatus: 'none',
        followsYou: selectedMemberFollowsYou,
        isFollowing: selectedMemberIsFollowing,
        streetFriendStatus: selectedMemberStreetStatus,
      };
    const optimisticIsFollowing = !previousRelationship.isFollowing;

    setFollowPendingMemberId(selectedMemberProfile.id);
    setRelationshipError(null);
    upsertRelationship(selectedMemberProfile.id, {
      followsYou: previousRelationship.followsYou,
      isFollowing: optimisticIsFollowing,
      streetFriendStatus: previousRelationship.streetFriendStatus,
    });

    try {
      const response = await followCreator(selectedMemberProfile.id);
      upsertRelationship(response.creatorId, {
        followRequestStatus: response.followRequestStatus,
        followsYou: response.followsYou,
        isFollowing: response.isFollowing,
        streetFriendStatus: previousRelationship.streetFriendStatus,
      });
    } catch (error) {
      upsertRelationship(selectedMemberProfile.id, previousRelationship);
      setRelationshipError(
        isApiRequestError(error) ? error.message : 'Takip islemi basarisiz oldu.',
      );
    } finally {
      setFollowPendingMemberId(null);
    }
  }, [
    relationshipByMember,
    selectedMemberFollowsYou,
    selectedMemberIsFollowing,
    selectedMemberProfile,
    selectedMemberStreetStatus,
    upsertRelationship,
  ]);

  const toggleStreetFriendForSelectedMember = useCallback(async () => {
    if (!selectedMemberProfile || selectedMemberProfile.isLocal) {
      return;
    }
    const isCancellingStreetRequest =
      selectedMemberStreetStatus === 'pending_outgoing' ||
      selectedMemberStreetStatus === 'accepted';

    setStreetFriendPendingMemberId(selectedMemberProfile.id);
    setRelationshipError(null);
    try {
      const response = isCancellingStreetRequest
        ? await removeStreetFriend(selectedMemberProfile.id)
        : await upsertStreetFriend(selectedMemberProfile.id);
      upsertRelationship(response.creatorId, {
        followsYou: selectedMemberFollowsYou,
        isFollowing: selectedMemberIsFollowing,
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
      setStreetFriendsList(previous => {
        if (response.isStreetFriend) {
          if (previous.some(item => item.id === response.creatorId)) {
            return previous;
          }
          const fallbackHandle =
            selectedMemberProfile.username.trim().length > 0
              ? selectedMemberProfile.username
              : selectedMemberProfile.id;
          const fallbackName =
            selectedMemberProfile.displayName.trim().length > 0
              ? selectedMemberProfile.displayName
              : fallbackHandle;
          return [
            {
              avatarUrl: selectedMemberProfile.avatarUrl,
              fullName: fallbackName,
              id: response.creatorId,
              isVerified: false,
              username: fallbackHandle,
            },
            ...previous,
          ];
        }
        return previous.filter(item => item.id !== response.creatorId);
      });
      if (response.isStreetFriend) {
        setLiveFollowTargetId(response.creatorId);
      } else {
        setLiveFollowTargetId(previous =>
          previous === response.creatorId ? null : previous,
        );
      }
    } catch (error) {
      setRelationshipError(
        isApiRequestError(error)
          ? error.message
          : 'Yakındakiler arkadaşlık işlemi başarısız oldu.',
      );
    } finally {
      setStreetFriendPendingMemberId(null);
    }
  }, [
    selectedMemberIsFollowing,
    selectedMemberFollowsYou,
    selectedMemberProfile,
    selectedMemberStreetStatus,
    upsertRelationship,
  ]);

  const toggleLiveFollowForSelectedMember = useCallback(() => {
    if (!selectedMemberProfile || selectedMemberProfile.isLocal) {
      return;
    }
    if (!isTrackingEnabled) {
      showLiveFollowToast(
        'Canli takip kapali. Harita menüsünden Canli Takip acilmali.',
      );
      return;
    }
    if (!selectedMemberIsOnline) {
      showLiveFollowToast({
        message:
          'Kullanıcı çevrimdışı olduğundan kaynaklı haritada görünürlüğü yok.',
        title: 'Haritada görünürlük yok',
        variant: 'offline',
      });
      return;
    }

    const nextLiveFollowTargetId =
      liveFollowTargetId === selectedMemberProfile.id ? null : selectedMemberProfile.id;
    setLiveFollowTargetId(nextLiveFollowTargetId);

    if (nextLiveFollowTargetId) {
      if (selectedMemberProfile.coordinate) {
        centerCameraOnCoordinate(selectedMemberProfile.coordinate);
      }
      closeSelectedMemberModal();
      return;
    }
  }, [
    centerCameraOnCoordinate,
    closeSelectedMemberModal,
    isTrackingEnabled,
    liveFollowTargetId,
    selectedMemberIsOnline,
    selectedMemberProfile,
    showLiveFollowToast,
  ]);

  const navigateToSelectedMemberOnMap = useCallback(() => {
    if (!selectedMemberProfile || selectedMemberProfile.isLocal) {
      if (displayLocalCoordinate) {
        centerCameraOnCoordinate(displayLocalCoordinate);
      }
      closeSelectedMemberModal();
      return;
    }
    if (!selectedMemberIsOnline) {
      showLiveFollowToast({
        message:
          'Kullanıcı çevrimdışı olduğundan kaynaklı haritada görünürlüğü yok.',
        title: 'Haritada görünürlük yok',
        variant: 'offline',
      });
      return;
    }
    if (!selectedMemberProfile.coordinate) {
      showLiveFollowToast({
        message:
          'Konum verisi backend senkronunda henüz alınamadı. Kısa süre sonra tekrar dene.',
        title: 'Konum verisi bekleniyor',
        variant: 'pending',
      });
      return;
    }
    centerCameraOnCoordinate(selectedMemberProfile.coordinate);
    setLiveFollowTargetId(selectedMemberProfile.id);
    closeSelectedMemberModal();
  }, [
    centerCameraOnCoordinate,
    closeSelectedMemberModal,
    displayLocalCoordinate,
    selectedMemberIsOnline,
    selectedMemberProfile,
    showLiveFollowToast,
  ]);

  const liveFollowTarget = useMemo(() => {
    if (!liveFollowTargetId) {
      return null;
    }

    if (localPlayer?.id === liveFollowTargetId) {
      return localPlayer;
    }

    const enriched = enrichedOptimizedVisibleRemotePlayers.find(
      player => player.id === liveFollowTargetId,
    );
    if (enriched) {
      return enriched;
    }

    return remotePlayers.find(player => player.id === liveFollowTargetId) ?? null;
  }, [
    enrichedOptimizedVisibleRemotePlayers,
    liveFollowTargetId,
    localPlayer,
    remotePlayers,
  ]);
  const liveFollowTargetLabel = useMemo(() => {
    if (!liveFollowTargetId) {
      return '';
    }
    if (liveFollowTarget?.displayName?.trim()) {
      return liveFollowTarget.displayName.trim();
    }
    if (selectedMemberProfile?.id === liveFollowTargetId) {
      return selectedMemberProfile.displayName;
    }
    return 'Hedef üye';
  }, [liveFollowTarget?.displayName, liveFollowTargetId, selectedMemberProfile]);
  const liveFollowPathGeoJson = useMemo<
    {
      type: 'FeatureCollection';
      features: Array<{
        type: 'Feature';
        properties: Record<string, never>;
        geometry: {
          type: 'LineString';
          coordinates: [number, number][];
        };
      }>;
    }
  >(
    () => ({
      features: [
        {
          geometry: {
            coordinates: liveFollowPath,
            type: 'LineString',
          },
          properties: {},
          type: 'Feature',
        },
      ],
      type: 'FeatureCollection',
    }),
    [liveFollowPath],
  );

  useEffect(() => {
    if (!liveFollowTargetId) {
      setLiveFollowPath([]);
      return;
    }

    const targetStillActive =
      localPlayer?.id === liveFollowTargetId ||
      remotePlayers.some(player => player.id === liveFollowTargetId);

    if (!targetStillActive) {
      setLiveFollowTargetId(null);
      setLiveFollowPath([]);
      showLiveFollowToast(
        'Canli takip sonlandirildi. Kullanici haritada aktif degil.',
      );
    }
  }, [liveFollowTargetId, localPlayer, remotePlayers, showLiveFollowToast]);

  useEffect(() => {
    const normalizedTargetId = liveFollowTargetId?.trim() ?? '';
    if (!normalizedTargetId) {
      previousLiveFollowNotificationTargetRef.current = null;
      return;
    }
    if (previousLiveFollowNotificationTargetRef.current === normalizedTargetId) {
      return;
    }

    previousLiveFollowNotificationTargetRef.current = normalizedTargetId;

    const now = Date.now();
    liveFollowNotificationCooldownRef.current.forEach((startedAt, targetId) => {
      if (now - startedAt >= LIVE_FOLLOW_NOTIFICATION_CLIENT_COOLDOWN_MS) {
        liveFollowNotificationCooldownRef.current.delete(targetId);
      }
    });

    const lastTriggeredAt =
      liveFollowNotificationCooldownRef.current.get(normalizedTargetId) ?? 0;
    if (now - lastTriggeredAt < LIVE_FOLLOW_NOTIFICATION_CLIENT_COOLDOWN_MS) {
      return;
    }

    liveFollowNotificationCooldownRef.current.set(normalizedTargetId, now);
    triggerLiveFollowNotification(normalizedTargetId)
      .then(response => {
        if (
          response.suppressed &&
          typeof response.retryAfterMs === 'number' &&
          Number.isFinite(response.retryAfterMs)
        ) {
          const clampedRetryAfterMs = Math.max(
            0,
            Math.min(
              response.retryAfterMs,
              LIVE_FOLLOW_NOTIFICATION_CLIENT_COOLDOWN_MS,
            ),
          );
          liveFollowNotificationCooldownRef.current.set(
            normalizedTargetId,
            Date.now()
              - (
                LIVE_FOLLOW_NOTIFICATION_CLIENT_COOLDOWN_MS
                - clampedRetryAfterMs
              ),
          );
        }
      })
      .catch(() => {
        liveFollowNotificationCooldownRef.current.delete(normalizedTargetId);
      });
  }, [liveFollowTargetId]);

  useEffect(() => {
    if (!liveFollowTargetId) {
      return;
    }
    let cancelled = false;
    fetchTrackingFollowPath(liveFollowTargetId, {
      limit: LIVE_FOLLOW_PATH_MAX_POINTS,
      window: '1h',
    })
      .then(response => {
        if (cancelled || !Array.isArray(response.points)) {
          return;
        }
        const restored = response.points
          .map(point => [point.longitude, point.latitude] as [number, number])
          .filter(
            coordinate =>
              Number.isFinite(coordinate[0]) &&
              Number.isFinite(coordinate[1]) &&
              !(coordinate[0] === 0 && coordinate[1] === 0),
          );
        if (restored.length > 0) {
          setLiveFollowPath(
            restored.slice(Math.max(0, restored.length - LIVE_FOLLOW_PATH_MAX_POINTS)),
          );
        }
      })
      .catch(() => {
        return;
      });
    return () => {
      cancelled = true;
    };
  }, [liveFollowTargetId]);

  useEffect(() => {
    if (!liveFollowTarget?.coordinate) {
      return;
    }

    centerCameraOnCoordinate(liveFollowTarget.coordinate);
  }, [centerCameraOnCoordinate, liveFollowTarget?.coordinate]);
  useEffect(() => {
    if (!liveFollowTarget?.coordinate || !liveFollowTargetId) {
      return;
    }
    setLiveFollowPath(previous => {
      const last = previous[previous.length - 1];
      if (last) {
        const deltaLng = Math.abs(last[0] - liveFollowTarget.coordinate[0]);
        const deltaLat = Math.abs(last[1] - liveFollowTarget.coordinate[1]);
        if (deltaLng < LIVE_FOLLOW_PATH_MIN_DELTA && deltaLat < LIVE_FOLLOW_PATH_MIN_DELTA) {
          return previous;
        }
      }
      const next = [...previous, liveFollowTarget.coordinate];
      if (next.length > LIVE_FOLLOW_PATH_MAX_POINTS) {
        return next.slice(next.length - LIVE_FOLLOW_PATH_MAX_POINTS);
      }
      return next;
    });
  }, [liveFollowTarget?.coordinate, liveFollowTargetId]);

  const overlayTop = insets.top + 72;
  const permissionTop = loadError ? insets.top + 108 : overlayTop;

  return (
    <View style={styles.container}>
      <Mapbox.MapView
        attributionEnabled={false}
        compassEnabled={false}
        logoEnabled={false}
        onDidFailLoadingMap={() => {
          isMapReadyRef.current = false;
          setIsMapReady(false);
          setLoadError('Map style could not be loaded.');
          console.warn('Mapbox load failed');
        }}
        onDidFinishLoadingMap={() => {
          isMapReadyRef.current = true;
          setIsMapReady(true);
          setLoadError(null);
          const pendingCoordinate = pendingCameraCoordinateRef.current;
          if (pendingCoordinate) {
            pendingCameraCoordinateRef.current = null;
            centerCameraOnCoordinate(pendingCoordinate);
          }
        }}
        onPress={() => {
          closeMenu();
        }}
        onUserLocationUpdate={handleUserLocationUpdate}
        pitchEnabled={false}
        preferredFramesPerSecond={mapPreferredFramesPerSecond}
        rotateEnabled={false}
        scaleBarEnabled={false}
        style={styles.map}
        styleURL={mapStyleURL}
        surfaceView={isPerformanceModeEnabled}
      >
        <Mapbox.Camera
          ref={cameraRef}
          animationDuration={0}
          defaultSettings={{
            centerCoordinate: INITIAL_COORDINATE,
            heading: 0,
            pitch: 0,
            zoomLevel: 12,
          }}
        />
        {isMapReady && liveFollowTargetId && liveFollowPath.length > 1 ? (
          <Mapbox.ShapeSource id="live-follow-path" shape={liveFollowPathGeoJson}>
            <Mapbox.LineLayer
              id="live-follow-path-line"
              style={LIVE_FOLLOW_PATH_LINE_STYLE}
            />
          </Mapbox.ShapeSource>
        ) : null}

        {isMapReady && viewerProfileId.length > 0 && isMapVisibilityEnabled && showLocalLayer ? (
          <LivePlayerMarker
            coordinate={displayLocalCoordinate}
            displayName={currentMember.displayName}
            id={viewerProfileId}
            isLocal={true}
            onPress={() => {
              closeMenu();
              openSelectedMemberModal(viewerProfileId);
            }}
            photoUrl={currentMember.photoUrl}
            showNamePill={true}
          />
        ) : null}

        {isMapReady
          ? enrichedOptimizedVisibleRemotePlayers.map(player => (
            <LivePlayerMarker
              coordinate={player.coordinate}
              displayName={player.displayName}
              id={player.id}
              key={player.id}
              onPress={() => {
                closeMenu();
                openSelectedMemberModal(player.id);
                if (streetFriendIds[player.id]) {
                  setLiveFollowTargetId(player.id);
                }
              }}
              photoUrl={player.photoUrl}
              showNamePill={!isPerformanceModeEnabled}
            />
          ))
          : null}
        {isMapReady && sideMemberPreviewPlayer ? (
          <LivePlayerMarker
            coordinate={sideMemberPreviewPlayer.coordinate}
            displayName={sideMemberPreviewPlayer.displayName}
            id={sideMemberPreviewPlayer.id}
            onPress={() => {
              closeMenu();
              openSelectedMemberModal(sideMemberPreviewPlayer.id);
            }}
            photoUrl={sideMemberPreviewPlayer.photoUrl}
            showNamePill={!isPerformanceModeEnabled}
          />
        ) : null}
      </Mapbox.MapView>

      {!menuVisible ? (
        <Pressable
          accessibilityLabel="Map menu"
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => {
            openMenu();
          }}
          style={[styles.menuButton, { top: overlayTop }]}
        >
          <Image
            resizeMode="contain"
            source={MAP_MENU_ICON}
            style={styles.menuButtonIcon}
          />
        </Pressable>
      ) : null}

      {!menuVisible && streetFriendsLoadingToastVisible ? (
        <View style={[styles.streetFriendsLoadingToast, { top: overlayTop + 134 }]}>
          <IosSpinner color="#f8fafc" size="small" />
          <Text style={styles.streetFriendsLoadingToastText}>
            Yakındakiler Yükleniyor...
          </Text>
        </View>
      ) : null}
      {!menuVisible && liveFollowTargetId ? (
        <View style={[styles.liveFollowStatusChip, { top: overlayTop + 134 }]}>
          <View style={styles.liveFollowStatusDot} />
          <Text style={styles.liveFollowStatusTitle}>Canlı takip aktif</Text>
          <Text numberOfLines={1} style={styles.liveFollowStatusSubtitle}>
            {liveFollowTargetLabel}
          </Text>
        </View>
      ) : null}

      {!menuVisible ? (
        <Pressable
          accessibilityLabel="Yakındakiler"
          accessibilityRole="button"
          hitSlop={10}
          onPress={openStreetFriendsModal}
          style={[styles.usersButton, { top: overlayTop + 66 }]}
        >
          <FeatherIcon color="#1e293b" name="users" size={20} />
        </Pressable>
      ) : null}

      <MapMenuModal
        activeSection={menuSection}
        activeStreetFriendsCount={activeStreetFriendsCount}
        canRecenter={Boolean(displayLocalCoordinate)}
        hasLocationPermission={hasLocationPermission}
        isPreferencesSaving={mapPreferencesSaving}
        isTrackingEnabled={isTrackingEnabled}
        socketStatus={socketStatus}
        streetFriendIncomingRequestCount={streetFriendIncomingRequestCount}
        streetFriendsCount={streetFriendsCount}
        visibleDriversCount={visibleRemotePlayers.length}
        isVisibilityEnabled={isMapVisibilityEnabled}
        isVisibilitySaving={visibilitySaving}
        localLayerEnabled={showLocalLayer}
        mapFilterMode={mapFilterMode}
        mapThemeMode={mapThemeMode}
        menuError={menuError}
        permissionPermanentlyDenied={permissionPermanentlyDenied}
        remoteLayerEnabled={showRemoteLayer}
        safeBottom={insets.bottom}
        visible={menuVisible}
        onBackToRoot={() => {
          setMenuError(null);
          setMenuSection('root');
        }}
        onClose={closeMenu}
        onLocalLayerToggle={nextValue => {
          if (nextValue === showLocalLayer) {
            return;
          }
          const previousValue = showLocalLayer;
          setShowLocalLayer(nextValue);
          persistMapPreferences(
            { showLocalLayer: nextValue },
            () => {
              setShowLocalLayer(previousValue);
            },
          ).catch(() => {
            return;
          });
        }}
        onOpenSection={nextSection => {
          setMenuError(null);
          setMenuSection(nextSection);
        }}
        onOpenStreetFriends={openStreetFriendsModal}
        onPermissionAction={handlePermissionAction}
        onRecenter={handleMenuRecenterPress}
        onRemoteLayerToggle={nextValue => {
          if (nextValue === showRemoteLayer) {
            return;
          }
          const previousValue = showRemoteLayer;
          setShowRemoteLayer(nextValue);
          persistMapPreferences(
            { showRemoteLayer: nextValue },
            () => {
              setShowRemoteLayer(previousValue);
            },
          ).catch(() => {
            return;
          });
        }}
        onRetryMenuSync={() => {
          syncMenuStateFromBackend().catch(() => {
            return;
          });
        }}
        onFilterModeChange={nextMode => {
          if (nextMode === mapFilterMode) {
            return;
          }
          const previousMode = mapFilterMode;
          const previousRemoteLayer = showRemoteLayer;
          const nextPayload: UpdateMapPreferencesPayload =
            nextMode === 'street_friends'
              ? { mapFilterMode: nextMode, showRemoteLayer: true }
              : { mapFilterMode: nextMode };
          setMapFilterMode(nextMode);
          if (nextMode === 'street_friends' && !showRemoteLayer) {
            setShowRemoteLayer(true);
          }
          persistMapPreferences(
            nextPayload,
            () => {
              setMapFilterMode(previousMode);
              setShowRemoteLayer(previousRemoteLayer);
            },
          ).catch(() => {
            return;
          });
        }}
        onThemeChange={nextTheme => {
          if (nextTheme === mapThemeMode) {
            return;
          }
          const previousTheme = mapThemeMode;
          setMapThemeMode(nextTheme);
          persistMapPreferences(
            { mapThemeMode: nextTheme },
            () => {
              setMapThemeMode(previousTheme);
            },
          ).catch(() => {
            return;
          });
        }}
        onTrackingToggle={handleTrackingToggle}
        onVisibilityChange={nextVisible => {
          handleVisibilitySelection(nextVisible).catch(() => {
            return;
          });
        }}
        onStreetRequestsViewed={onStreetRequestsViewed}
      />

      {!menuVisible && loadError ? (
        <ScreenStateCard
          compact={true}
          description={loadError}
          mode="dark"
          style={[styles.overlayStateCard, { top: overlayTop }]}
          title="Harita yuklenemedi"
          tone="error"
        />
      ) : null}

      {!menuVisible && relationshipError ? (
        <ScreenStateCard
          compact={true}
          description={relationshipError}
          mode="dark"
          style={[styles.overlayStateCard, { top: overlayTop + 86 }]}
          title="Iliski islemi basarisiz"
          tone="error"
        />
      ) : null}

      {!menuVisible &&
        permissionChecked &&
        hasLocationPermission &&
        !isMapVisibilityEnabled ? (
        <ScreenStateCard
          compact={true}
          description="Konumun backend tarafinda gizli. Profil gizlilik ayarindan tekrar acabilirsin."
          mode="dark"
          style={[styles.overlayStateCard, { top: permissionTop }]}
          title="Harita gorunurlugu kapali"
        />
      ) : null}

      {!menuVisible &&
        permissionChecked &&
        !hasLocationPermission &&
        isMapVisibilityEnabled ? (
        <ScreenStateCard
          actionLabel={permissionPermanentlyDenied ? 'Ayarlar' : 'Izin ver'}
          compact={true}
          description="Konumun haritada gorunmesi icin konum iznini ac."
          mode="dark"
          onActionPress={handlePermissionAction}
          style={[styles.overlayStateCard, { top: permissionTop }]}
          title="Konum izni kapali"
        />
      ) : null}

      {liveFollowToast ? (
        <Modal
          animationType="none"
          onRequestClose={() => {
            return;
          }}
          statusBarTranslucent={true}
          transparent={true}
          visible={true}
        >
          <View pointerEvents="none" style={styles.liveFollowToastOverlay}>
            <Animated.View
              style={[
                styles.liveFollowToastCard,
                {
                  opacity: liveFollowToastOpacity,
                  transform: [
                    { translateY: liveFollowToastTranslateY },
                    { scale: liveFollowToastScale },
                  ],
                },
              ]}
            >
              <View style={styles.liveFollowToastIconWrap}>
                {liveFollowToast.variant === 'offline' ? (
                  <View style={styles.liveFollowToastOfflineIconLayer}>
                    <FeatherIcon color="#f97316" name="map-pin" size={12} />
                    <View style={styles.liveFollowToastOfflineSlash}>
                      <FeatherIcon color="#f97316" name="x" size={9} />
                    </View>
                  </View>
                ) : liveFollowToast.variant === 'pending' ? (
                  <FeatherIcon color="#f59e0b" name="clock" size={14} />
                ) : (
                  <FeatherIcon color="#f97316" name="alert-triangle" size={14} />
                )}
              </View>
              <View style={styles.liveFollowToastCopy}>
                <Text style={styles.liveFollowToastTitle}>
                  {liveFollowToast.title}
                </Text>
                <Text style={styles.liveFollowToastDescription}>
                  {liveFollowToast.message}
                </Text>
              </View>
            </Animated.View>
          </View>
        </Modal>
      ) : null}

      {streetFriendsModalVisible ? (
        <Modal
          animationType="fade"
          onRequestClose={handleStreetFriendsModalRequestClose}
          navigationBarTranslucent={true}
          statusBarTranslucent={true}
          transparent={true}
          visible={streetFriendsModalVisible}
        >
          <StatusBar
            animated={true}
            backgroundColor="transparent"
            barStyle="dark-content"
            hidden={false}
            translucent={true}
          />
          <View style={styles.streetFriendsModalRoot}>
            <Pressable
              onPress={() => {
                closeStreetFriendsSheet();
              }}
              style={styles.streetFriendsModalBackdrop}
            />
            <Animated.View
              style={[
                styles.streetFriendsCard,
                {
                  maxHeight: streetFriendsSheetMaxHeight,
                  paddingBottom: Math.max(insets.bottom + 24, 24),
                  transform: [{ translateY: streetFriendsTranslateY }],
                },
              ]}
            >
              <Pressable
                onPress={toggleStreetFriendsSnap}
                style={styles.streetFriendsGrabberPress}
                {...streetFriendsPanResponder.panHandlers}
              >
                <View style={styles.streetFriendsGrabber} />
              </Pressable>
              <View style={styles.streetFriendsInner}>
                <View style={styles.streetFriendsHeader}>
                  <Text style={styles.streetFriendsTitle}>Yakındakiler</Text>
                  <Pressable
                    onPress={() => {
                      closeStreetFriendsSheet();
                    }}
                    style={styles.streetFriendsCloseButton}
                  >
                    <FeatherIcon color="#64748b" name="x" size={16} />
                  </Pressable>
                </View>
                <View style={styles.streetFriendsCountRow}>
                  <Text style={styles.streetFriendsCount}>
                    Toplam: {streetFriendsCount}
                  </Text>
                  <View style={styles.streetFriendsCountSeparator} />
                  <Pressable
                    onPress={handleOpenStreetRequests}
                    style={styles.streetFriendsNewRequestBadge}
                  >
                    {streetFriendRequestsUnread ? (
                      <View style={styles.streetFriendsUnreadDot} />
                    ) : null}
                    <Text
                      style={[
                        styles.streetFriendsCount,
                        streetFriendRequestsUnread
                          ? styles.streetFriendsCountUnread
                          : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.streetFriendsNewRequestLabel,
                          streetFriendRequestsUnread
                            ? styles.streetFriendsNewRequestLabelUnread
                            : null,
                        ]}
                      >
                        Yeni İstek
                      </Text>
                      : {streetFriendIncomingRequestCount}
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.streetFriendsHintCard}>
                  <View style={styles.streetFriendsHintDot}>
                    <FeatherIcon color="#6b7280" name="info" size={8} />
                  </View>
                  <Text style={styles.streetFriendsHintText}>
                    Yakındakiler, kabul edilmiş bağlantılarını haritada ile senkron
                    tutar. Liste otomatik güncellenir, haritayı sadece Yakındakiler moduna
                    alabilir ve canlı üyelere anında odaklanabilirsin.
                  </Text>
                </View>

                <View style={styles.streetFriendsSummaryCard}>
                  <View style={styles.streetFriendsSummaryRow}>
                    <Text style={styles.streetFriendsSummaryTitle}>Realtime durum</Text>
                    <Text
                      style={[
                        styles.streetFriendsSummaryValue,
                        socketStatus === 'live'
                          ? styles.streetFriendsSummaryValueLive
                          : styles.streetFriendsSummaryValueIdle,
                      ]}
                    >
                      {socketStatus === 'live' ? 'CANLI' : 'OFFLINE'}
                    </Text>
                  </View>
                  <View style={styles.streetFriendsSummaryRow}>
                    <Text style={styles.streetFriendsSummaryTitle}>Haritada aktif</Text>
                    <Text style={styles.streetFriendsSummaryValue}>
                      {activeStreetFriendsCount}
                    </Text>
                  </View>
                  <View style={styles.streetFriendsSummaryRow}>
                    <Text style={styles.streetFriendsSummaryTitle}>Çevrimdışı</Text>
                    <Text style={styles.streetFriendsSummaryValue}>
                      {offlineStreetFriendsCount}
                    </Text>
                  </View>
                  <View style={[styles.streetFriendsSummaryRow, styles.streetFriendsSummaryRowLast]}>
                    <Text style={styles.streetFriendsSummaryTitle}>Filtre modu</Text>
                    <Text style={styles.streetFriendsSummaryValue}>
                      {mapFilterMode === 'street_friends' ? 'Yakındakiler' : 'Tum uyeler'}
                    </Text>
                  </View>
                </View>

                <View style={styles.streetFriendsPurposeCard}>
                  <View style={styles.streetFriendsPurposeRow}>
                    <FeatherIcon color="#6b7280" name="users" size={14} />
                    <Text style={styles.streetFriendsPurposeText}>
                      Yakındakiler modu, haritada sadece kabul ettigin Yakındakileri gosterir.
                    </Text>
                  </View>
                  <View style={styles.streetFriendsPurposeRow}>
                    <FeatherIcon color="#6b7280" name="navigation" size={14} />
                    <Text style={styles.streetFriendsPurposeText}>
                      Canli takip, aktif bir Yakındakiler uyesine odaklanip hareketini izlemeni
                      saglar.
                    </Text>
                  </View>
                </View>

                <View style={styles.streetFriendsActions}>
                  <Pressable
                    onPress={activateStreetOnlyMode}
                    style={[
                      styles.streetFriendsActionButton,
                      mapFilterMode === 'street_friends'
                        ? styles.streetFriendsActionButtonPrimary
                        : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.streetFriendsActionText,
                        mapFilterMode === 'street_friends'
                          ? styles.streetFriendsActionTextPrimary
                          : null,
                      ]}
                    >
                      Yakındakiler modu
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={followFirstActiveStreetFriend}
                    style={styles.streetFriendsActionButton}
                  >
                    <Text style={styles.streetFriendsActionText}>Canlıya Odaklan</Text>
                  </Pressable>
                </View>

                <Text style={styles.streetFriendsSectionLabel}>Yakındakiler Listesi</Text>
                <View style={styles.streetFriendsSearchShell}>
                  <FeatherIcon color="#94a3b8" name="search" size={14} />
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={setStreetFriendsSearchQuery}
                    placeholder="Yakındakiler ara..."
                    placeholderTextColor="#94a3b8"
                    returnKeyType="search"
                    style={styles.streetFriendsSearchInput}
                    value={streetFriendsSearchQuery}
                  />
                </View>

                {streetFriendsModalLoading ? (
                  <Text style={styles.streetFriendsMessage}>Liste yukleniyor...</Text>
                ) : null}

                {!streetFriendsModalLoading && streetFriendsModalError ? (
                  <Text style={styles.streetFriendsError}>{streetFriendsModalError}</Text>
                ) : null}

                {!streetFriendsModalLoading &&
                  !streetFriendsModalError &&
                  streetFriendsCount === 0 ? (
                  <View style={styles.streetFriendsEmptyCard}>
                    <FeatherIcon color="#6b7280" name="users" size={18} />
                    <Text style={styles.streetFriendsEmptyTitle}>
                      Henuz Yakındakiler listen bos
                    </Text>
                    <Text style={styles.streetFriendsEmptyText}>
                      Profil veya kesfet ekranindan Yakındakiler istegi gonder. Kabul edilen
                      kullanicilar burada canli durumuyla listelenir.
                    </Text>
                  </View>
                ) : null}

                {!streetFriendsModalLoading &&
                  !streetFriendsModalError &&
                  streetFriendsCount > 0 &&
                  filteredStreetFriendsList.length === 0 ? (
                  <View style={styles.streetFriendsEmptyCard}>
                    <FeatherIcon color="#6b7280" name="search" size={18} />
                    <Text style={styles.streetFriendsEmptyTitle}>
                      Sonuc bulunamadi
                    </Text>
                    <Text style={styles.streetFriendsEmptyText}>
                      Arama ifadesini degistirip tekrar dene.
                    </Text>
                  </View>
                ) : null}

                {!streetFriendsModalLoading && filteredStreetFriendsList.length > 0 ? (
                  <ScrollView
                    bounces={false}
                    nestedScrollEnabled={true}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    style={styles.streetFriendsList}
                  >
                    {filteredStreetFriendsList.map(friend => {
                      const friendName = friend.fullName.trim() || friend.username;
                      const isLiveOnMap = Boolean(activeStreetFriendById[friend.id]);
                      return (
                        <Pressable
                          key={friend.id}
                          onPress={() => {
                            closeStreetFriendsSheet(() => {
                              openSelectedMemberModal(friend.id);
                              if (isLiveOnMap) {
                                setLiveFollowTargetId(friend.id);
                              }
                            });
                          }}
                          style={styles.streetFriendsRow}
                        >
                          <View style={styles.streetFriendsAvatar}>
                            {friend.avatarUrl ? (
                              <Image
                                source={{ uri: friend.avatarUrl }}
                                style={styles.streetFriendsAvatar}
                              />
                            ) : (
                              <Text style={styles.streetFriendsInitials}>
                                {resolveInitials(friendName)}
                              </Text>
                            )}
                          </View>
                          <View style={styles.streetFriendsIdentity}>
                            <Text numberOfLines={1} style={styles.streetFriendsName}>
                              {friendName}
                            </Text>
                            <Text numberOfLines={1} style={styles.streetFriendsHandle}>
                              @{friend.username}
                            </Text>
                            <Text numberOfLines={1} style={styles.streetFriendsMeta}>
                              {isLiveOnMap
                                ? 'Haritada canli, profile dokun takip ac.'
                                : 'Çevrimdışı, profile dokun detay göster.'}
                            </Text>
                          </View>
                          <View style={styles.streetFriendsRowRight}>
                            <View
                              style={
                                isLiveOnMap
                                  ? styles.streetFriendsStatusBadgeLive
                                  : styles.streetFriendsStatusBadgeIdle
                              }
                            >
                              <Text
                                style={
                                  isLiveOnMap
                                    ? styles.streetFriendsStatusTextLive
                                    : styles.streetFriendsStatusTextIdle
                                }
                              >
                                {isLiveOnMap ? 'Canlı' : 'Çevrimdışı'}
                              </Text>
                            </View>
                            <FeatherIcon
                              color="#94a3b8"
                              name="chevron-right"
                              size={14}
                              style={styles.streetFriendsChevron}
                            />
                          </View>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                ) : null}
              </View>
            </Animated.View>
          </View>
        </Modal>
      ) : null}

      <MemberProfileModal
        bio={selectedMemberProfile?.bio}
        birthYear={selectedMemberProfile?.birthYear ?? null}
        coordinate={selectedMemberProfile?.coordinate ?? null}
        displayName={selectedMemberProfile?.displayName}
        followRequestStatus={selectedMemberFollowRequestStatus}
        handle={selectedMemberProfile?.handle}
        isFollowPending={
          selectedMemberProfile
            ? followPendingMemberId === selectedMemberProfile.id
            : false
        }
        followsYou={selectedMemberFollowsYou}
        isFollowing={selectedMemberIsFollowing}
        isOnline={selectedMemberIsOnline}
        isLiveFollowing={
          selectedMemberProfile
            ? liveFollowTargetId === selectedMemberProfile.id
            : false
        }
        isLiveFollowEnabled={isTrackingEnabled}
        isLocalMember={selectedMemberProfile?.isLocal ?? true}
        isStreetFriend={selectedMemberIsStreetFriend}
        isStreetFriendPending={
          selectedMemberProfile
            ? streetFriendPendingMemberId === selectedMemberProfile.id
            : false
        }
        onClose={closeSelectedMemberModal}
        onLiveFollowToggle={toggleLiveFollowForSelectedMember}
        onNavigatePress={navigateToSelectedMemberOnMap}
        onMessagePress={handleOpenSelectedMemberMessages}
        onPrimaryAction={() => {
          if (!selectedMemberProfile) {
            return;
          }

          if (selectedMemberProfile.isLocal) {
            closeSelectedMemberModal();
            onOpenProfile?.();
            return;
          }

          toggleFollowForSelectedMember().catch(() => {
            return;
          });
        }}
        onStreetFriendAction={() => {
          toggleStreetFriendForSelectedMember().catch(() => {
            return;
          });
        }}
        photoUrl={selectedMemberProfile?.photoUrl}
        secondaryActionLabel={isTrackingEnabled ? undefined : 'Canlı Takip (Kapalı)'}
        stats={selectedMemberProfile?.stats}
        streetFriendStatus={selectedMemberStreetStatus}
        statusLabel={selectedMemberProfile?.statusLabel}
        vehicleLabel={selectedMemberProfile?.vehicleLabel}
        visible={memberModalVisible}
      />
    </View>
  );
};

export default MapboxScreen;
