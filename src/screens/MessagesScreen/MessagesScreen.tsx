import React, {
  Fragment,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FlashList,
  type FlashListRef,
  type ListRenderItemInfo,
} from '@shopify/flash-list';
import { BlurView } from '@react-native-community/blur';
import {
  AppState,
  type AppStateStatus,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAlert } from '../../alerts/AlertProvider';
import { useApiActionFeedback } from '../../alerts/useApiActionFeedback';
import FeatherIcon from '../../components/FeatherIcon/FeatherIcon';
import IosSpinner from '../../components/IosSpinner/IosSpinner';
import BlockUserConfirmSheet from '../../components/BlockUserConfirmSheet/BlockUserConfirmSheet';
import CameraCaptureModal from '../../components/CameraCapture/CameraCaptureModal';
import { isApiRequestError } from '../../services/apiClient';
import {
  acceptConversationRequest,
  clearConversationMessages,
  createConversation,
  createMessagesSocket,
  deleteConversation,
  deleteConversationForAll,
  fetchConversationMessages,
  fetchConversations,
  markConversationRead,
  rejectConversationRequest,
  setConversationMuted,
  sendConversationMessage,
  sendConversationVoiceMessage,
} from '../../services/messagesService';
import { searchExploreUsers } from '../../services/exploreService';
import { resolveProtectedMediaUrl } from '../../services/protectedMedia';
import {
  readStoredPendingConversationMessages,
  storePendingConversationMessages,
  type StoredPendingConversationMessage,
  type StoredPendingVoiceDraft,
} from '../../services/sessionStorage';
import ScreenStateCard, {
  ScreenStateCenter,
} from '../../components/ScreenState/ScreenStateCard';
import {
  blockUser,
  reportUser,
  unblockUser,
} from '../../services/authService';
import { Text, TextInput } from '../../theme/typography';
import type { ExploreSearchUser } from '../../types/ExploreTypes/ExploreTypes';
import type {
  ConversationMessage,
  ConversationSummary,
  MessageRealtimeEvent,
} from '../../types/MessagesTypes/MessagesTypes';
import type { SocketStatus } from '../../realtime/types';
import {
  parseMessageContent,
  encodeRichMessagePayload,
  type OutboundRichMessagePayload,
} from '../../features/messages/messageContent';
import {
  appendMessagePage,
  findMatchingLocalOutgoingMessageId,
  mergeServerMessagesWithLocalState,
  prependMessage,
  removeMessageById,
  replaceMessageById,
  updateLocalMessageStatus,
} from '../../features/messages/messageListState';
import {
  getConversationComposerPlaceholder,
  getConversationLockText,
  getConversationUIState,
  getEmptyStateText,
  getRequestBannerText,
  shouldShowConversationRequestBanner,
} from '../../features/messages/conversationUiState';
import {
  clampRatio,
  formatVoicePlaybackClock,
  formatVoiceSeconds,
  formatVoicePlaybackRate,
  resolveVoiceDurationSec,
  resolveVoiceWaveformBars,
  type VoicePlaybackRate,
} from '../../features/messages/voiceMessageUi';
import { useVoicePlaybackController } from './useVoicePlaybackController';
import {
  useVoiceRecorderComposer,
  type VoiceDraft,
} from './useVoiceRecorderComposer';
import { pickGalleryMedia } from '../../native/galleryPicker';
import {
  HIDDEN_USER_NOT_FOUND_LABEL,
  resolveUserIdentity,
} from '../../utils/hiddenUser';
import { appendAvatarVersionParam } from '../../utils/profileAvatar';
import NewConversationModal from './components/NewConversationModal';

type MessagesScreenProps = {
  contentBottomInset: number;
  displayName?: string;
  onConversationOpenChange?: (open: boolean) => void;
  onOpenPublicProfile?: (user: ExploreSearchUser) => void;
  onPrefillRecipientConsumed?: () => void;
  prefillRecipient?: ExploreSearchUser | null;
  safeTop: number;
  viewerId: string;
};

const CONVERSATION_PAGE_LIMIT = 36;
const MESSAGE_PAGE_LIMIT = 40;
const MESSAGE_SEARCH_USERS_LIMIT = 6;
const NEW_CONVERSATION_SEARCH_LIMIT = 8;
const NEW_CONVERSATION_SEARCH_DELAY_MS = 240;
const SOCKET_RECONNECT_DELAY_MS = 1800;
const SOCKET_RECONNECT_MAX_DELAY_MS = 12000;
const SOCKET_CONNECTING_STALE_MS = 11000;
const SOCKET_HEARTBEAT_IDLE_MS = 45000;
const SOCKET_HEARTBEAT_ACK_TIMEOUT_MS = 14000;
const SOCKET_HEARTBEAT_CHECK_INTERVAL_MS = 9000;
const SOCKET_OFFLINE_BANNER_GRACE_MS = 2400;
const POLL_INTERVAL_MS = 45000;
const RECOVERY_SNAPSHOT_COOLDOWN_MS = 6500;
const TYPING_IDLE_TIMEOUT_MS = 1500;
const READ_SYNC_DEBOUNCE_MS = 160;
const READ_SYNC_MIN_INTERVAL_MS = 380;
const DETAIL_SCROLL_TO_LATEST_SHOW_OFFSET = 120;
const DETAIL_SCROLL_TO_LATEST_HIDE_OFFSET = 44;
const DETAIL_SCROLL_TO_LATEST_SNAP_DELAY_MS = 28;
const DETAIL_SCROLL_TO_LATEST_SHOW_ANIMATION_MS = 190;
const DETAIL_SCROLL_TO_LATEST_HIDE_ANIMATION_MS = 130;
const NEW_CONVERSATION_OPEN_ANIMATION_MS = 280;
const NEW_CONVERSATION_CLOSE_ANIMATION_MS = 220;
const MESSAGE_REQUEST_EVENT_ID_CACHE_LIMIT = 320;
const VOICE_HOLD_MIN_DURATION_SEC = 1;
const VOICE_HOLD_MAX_DURATION_SEC = 180;
const VOICE_LONG_PRESS_DELAY_MS = 120;
const VOICE_WAVEFORM_BAR_COUNT = 22;
const CONVERSATION_ESTIMATED_ITEM_SIZE = 92;
const MESSAGE_ESTIMATED_ITEM_SIZE = 104;
const LOCAL_MESSAGE_ID_PREFIX = 'local_msg_';
const SHOW_VOICE_DEBUG_OVERLAY =
  __DEV__ &&
  Boolean(
    (globalThis as { __MACRADAR_VOICE_DEBUG__?: boolean })
      .__MACRADAR_VOICE_DEBUG__,
  );

type PendingSendQueueItem = StoredPendingConversationMessage;
type RecoverySnapshotReason = 'socket-open' | 'app-active' | 'queue-hydrated';

function ignorePromise(promise: Promise<unknown>) {
  promise.catch(() => undefined);
}

function isConnectivityIssue(error: unknown) {
  return (
    isApiRequestError(error) &&
    (error.status === 0 ||
      error.status === 408 ||
      error.code === 'network_error' ||
      error.code === 'request_timeout')
  );
}

function isBlockedRelationshipError(error: unknown) {
  return isApiRequestError(error) && error.code === 'blocked_relationship';
}

function getSocketReconnectDelayMs(attempt: number) {
  return Math.min(
    SOCKET_RECONNECT_MAX_DELAY_MS,
    SOCKET_RECONNECT_DELAY_MS * 2 ** Math.max(0, Math.min(attempt, 3)),
  );
}

function getSendFailureMessage(error: unknown, fallbackMessage: string) {
  if (
    isBlockedRelationshipError(error) ||
    (isApiRequestError(error) && error.status === 404)
  ) {
    return HIDDEN_USER_NOT_FOUND_LABEL;
  }
  if (isConnectivityIssue(error)) {
    return 'Bağlantı şu an zayıf. İçerik hazır tutuldu, tekrar deneyebilirsin.';
  }
  return isApiRequestError(error) ? error.message : fallbackMessage;
}

function resolveConversationAccessError(
  error: unknown,
  fallbackMessage: string,
) {
  if (
    isBlockedRelationshipError(error) ||
    (isApiRequestError(error) && error.status === 404)
  ) {
    return HIDDEN_USER_NOT_FOUND_LABEL;
  }

  return isApiRequestError(error) ? error.message : fallbackMessage;
}

function resolveConversationPeerIdentity(conversation: ConversationSummary) {
  return resolveUserIdentity({
    avatarUrl: conversation.peer.avatarUrl,
    fullName: conversation.peer.fullName,
    isHidden: conversation.isViewerBlockedByPeer,
    username: conversation.peer.username,
  });
}

type MessagesBlockUserSheetContext = {
  conversationId: string;
  displayName?: string;
  peerId: string;
  source: 'header' | 'message_request';
  username: string;
};

function resolveAvatarUriWithCacheBust(rawAvatarUrl: string, cacheSeed: string) {
  const resolved = resolveProtectedMediaUrl(rawAvatarUrl);
  return appendAvatarVersionParam(resolved, cacheSeed);
}

function createLocalMessageId() {
  return `${LOCAL_MESSAGE_ID_PREFIX}${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function toStoredPendingVoiceDraft(recording: VoiceDraft): StoredPendingVoiceDraft {
  return {
    base64: recording.base64,
    durationSec: recording.durationSec,
    fileName: recording.fileName,
    filePath: recording.filePath,
    mimeType: recording.mimeType,
    sizeBytes: recording.sizeBytes,
    waveform: recording.waveform,
  };
}

function fromStoredPendingVoiceDraft(recording: StoredPendingVoiceDraft): VoiceDraft {
  return {
    base64: recording.base64,
    durationSec: recording.durationSec,
    fileName: recording.fileName,
    filePath: recording.filePath,
    mimeType: recording.mimeType,
    sizeBytes: recording.sizeBytes,
    waveform: recording.waveform,
  };
}

function getWaveformBarHeightStyle(amplitude: number) {
  if (amplitude < 0.16) {
    return styles.richMessageWaveBarHeightXs;
  }
  if (amplitude < 0.3) {
    return styles.richMessageWaveBarHeightSm;
  }
  if (amplitude < 0.44) {
    return styles.richMessageWaveBarHeightMd;
  }
  if (amplitude < 0.58) {
    return styles.richMessageWaveBarHeightLg;
  }
  if (amplitude < 0.72) {
    return styles.richMessageWaveBarHeightXl;
  }
  if (amplitude < 0.86) {
    return styles.richMessageWaveBarHeight2xl;
  }
  return styles.richMessageWaveBarHeight3xl;
}

const previewPlaybackPauseIconStyle = {
  marginLeft: 0,
};

const previewPlaybackPlayIconStyle = {
  marginLeft: 2,
};

const voiceRecordingLockChevronStyle = {
  marginTop: 2,
};

function getVoiceRecordingPreviewBarStyle(
  amplitude: number,
  isPlayed: boolean,
) {
  return {
    backgroundColor: isPlayed ? '#ef4444' : '#94a3b8',
    height: Math.max(4, amplitude * 20),
    opacity: isPlayed ? 1 : 0.5 + Math.min(0.5, amplitude),
  };
}

function getPreviewPlaybackIconStyle(previewPlaybackPlaying: boolean) {
  return previewPlaybackPlaying
    ? previewPlaybackPauseIconStyle
    : previewPlaybackPlayIconStyle;
}

function canRenderInlinePhoto(photoUrl: string) {
  const normalized = String(photoUrl || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith('https://') ||
    normalized.startsWith('http://') ||
    normalized.startsWith('file://') ||
    normalized.startsWith('content://') ||
    normalized.startsWith('data:image/')
  );
}

function mergeConversationLists(
  existing: ConversationSummary[],
  incoming: ConversationSummary[],
) {
  const map = new Map<string, ConversationSummary>();
  existing.forEach(item => {
    map.set(item.conversationId, item);
  });

  const merged = [...existing];
  incoming.forEach(item => {
    const previous = map.get(item.conversationId);
    if (!previous) {
      map.set(item.conversationId, item);
      merged.push(item);
      return;
    }

    const index = merged.findIndex(
      candidate => candidate.conversationId === item.conversationId,
    );
    if (index >= 0) {
      merged[index] = item;
    }
  });

  return merged;
}

function updateConversationListItem(
  list: ConversationSummary[],
  conversationId: string,
  updater: (item: ConversationSummary) => ConversationSummary,
  moveToTop = false,
) {
  const index = list.findIndex(item => item.conversationId === conversationId);
  if (index < 0) {
    return list;
  }

  const current = list[index];
  const updated = updater(current);
  if (!moveToTop) {
    if (updated === current) {
      return list;
    }
    const next = [...list];
    next[index] = updated;
    return next;
  }

  if (index === 0 && updated === current) {
    return list;
  }

  const next = [...list];
  next.splice(index, 1);
  next.unshift(updated);
  return next;
}

function formatConversationTime(value: string) {
  return formatPremiumDateTime(value);
}

function formatBubbleTime(value: string) {
  return formatPremiumDateTime(value);
}

function formatReadAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) {
    return '';
  }
  return formatPremiumDateTime(value);
}

function formatClockTime(value: Date) {
  return value.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getRelativeDayDiff(value: Date, now = new Date()) {
  const currentDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  return Math.round(
    (currentDay.getTime() - targetDay.getTime()) / (24 * 60 * 60 * 1000),
  );
}

function formatPremiumDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const diffDays = getRelativeDayDiff(date, now);
  const timeLabel = formatClockTime(date);

  if (diffDays === 0) {
    return `Bugun, ${timeLabel}`;
  }
  if (diffDays === 1) {
    return `Dun, ${timeLabel}`;
  }
  if (now.getFullYear() === date.getFullYear()) {
    return `${date.toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
    })}, ${timeLabel}`;
  }

  return `${date.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })}, ${timeLabel}`;
}

function getMessageDayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isSameMessageDay(firstValue: string, secondValue: string) {
  const firstKey = getMessageDayKey(firstValue);
  const secondKey = getMessageDayKey(secondValue);
  return firstKey.length > 0 && firstKey === secondKey;
}

function formatMessageDayLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const diffDays = getRelativeDayDiff(date, now);

  if (diffDays === 0) {
    return 'Bugun';
  }
  if (diffDays === 1) {
    return 'Dun';
  }
  if (now.getFullYear() === date.getFullYear()) {
    return date.toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'long',
      weekday: 'long',
    });
  }

  return date.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function areMessagesGrouped(
  current: ConversationMessage | null | undefined,
  adjacent: ConversationMessage | null | undefined,
) {
  if (!current || !adjacent) {
    return false;
  }
  if (current.isMine !== adjacent.isMine) {
    return false;
  }
  if (current.senderId !== adjacent.senderId) {
    return false;
  }

  const currentDate = new Date(current.createdAt);
  const adjacentDate = new Date(adjacent.createdAt);
  if (
    Number.isNaN(currentDate.getTime()) ||
    Number.isNaN(adjacentDate.getTime()) ||
    !isSameMessageDay(current.createdAt, adjacent.createdAt)
  ) {
    return false;
  }

  return Math.abs(currentDate.getTime() - adjacentDate.getTime()) <= 8 * 60 * 1000;
}

type RenderedConversationMessage = ConversationMessage & {
  renderedContent: ReturnType<typeof parseMessageContent>;
  voiceDurationSec: number;
  voiceWaveformBars: number[];
};

type RenderedMessageCacheEntry = {
  message: RenderedConversationMessage;
  signature: string;
};

type ConversationMessageCacheEntry = {
  hasMore: boolean;
  messages: ConversationMessage[];
  nextCursor: string | null;
};

function buildConversationSummaryFromUser(
  user: ExploreSearchUser,
  conversationId: string,
  messageText: string,
): ConversationSummary {
  const messageContent = parseMessageContent(messageText);
  return {
    canSendMessage: true,
    chatRequestDirection: 'none',
    chatRequestStatus: 'none',
    conversationId,
    isMessageRequest: false,
    isMuted: false,
    isPeerBlockedByViewer: false,
    isUnread: false,
    isViewerBlockedByPeer: false,
    lastMessage: messageText.trim() || 'Yeni sohbet',
    lastMessageAt: new Date().toISOString(),
    lastLocationMessage: messageContent.locationMessage,
    lastMessageKind: messageContent.kind,
    lastMessagePreview: messageContent.preview,
    lastPhotoMessage: messageContent.photoMessage,
    lastVoiceMessage: messageContent.voiceMessage,
    messagingHint: '',
    messagingMode: 'direct',
    peerLastReadAt: undefined,
    peerLastReadMessageId: undefined,
    peer: {
      avatarUrl: user.avatarUrl,
      fullName: user.fullName,
      id: user.id,
      isVerified: user.isVerified,
      username: user.username,
    },
    unreadCount: 0,
  };
}

function toExploreSearchUserFromConversation(
  conversation: ConversationSummary,
): ExploreSearchUser {
  const peerIdentity = resolveConversationPeerIdentity(conversation);

  return {
    avatarUrl: peerIdentity.avatarUrl,
    fullName: peerIdentity.displayName,
    id: conversation.peer.id,
    isHiddenByRelationship: conversation.isViewerBlockedByPeer,
    isPrivateAccount: false,
    isVerified: conversation.peer.isVerified,
    username: peerIdentity.handle,
    viewerState: {
      followRequestStatus: 'none',
      followsYou: false,
      isFollowing: false,
      isStreetFriend: false,
      streetFriendStatus: 'none',
    },
  };
}

function normalizeMessagesSearchValue(value: string) {
  return value
    .toLowerCase()
    .replace(/^@+/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0131/g, 'i')
    .replace(/\u0130/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();
}

function conversationMatchesSearch(
  conversation: ConversationSummary,
  previewText: string,
  rawQuery: string,
) {
  const normalizedQuery = normalizeMessagesSearchValue(rawQuery);
  if (!normalizedQuery) {
    return true;
  }

  const fields = [
    conversation.peer.fullName,
    conversation.peer.username,
    previewText,
    conversation.lastMessage,
  ]
    .map(value => normalizeMessagesSearchValue(value))
    .filter(Boolean);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);

  return queryTokens.every(token =>
    fields.some(field => field.includes(token)),
  );
}

function isMessageReadByPeer(
  message: ConversationMessage,
  peerLastReadAt: string | null,
  peerLastReadMessageId: string | null,
) {
  if (!message.isMine) {
    return false;
  }

  if (peerLastReadMessageId && message.id === peerLastReadMessageId) {
    return true;
  }
  if (!peerLastReadAt) {
    return false;
  }

  const readAt = new Date(peerLastReadAt).getTime();
  const createdAt = new Date(message.createdAt).getTime();
  if (!Number.isFinite(readAt) || !Number.isFinite(createdAt)) {
    return false;
  }

  return createdAt <= readAt;
}

type MessageBubbleRowProps = {
  item: RenderedConversationMessage;
  latestOwnMessageId: string | null;
  olderMessage: RenderedConversationMessage | null;
  onOpenPhotoPreview: (photoUrl: string, title: string) => void;
  onCyclePlaybackRate: () => void;
  onTogglePlayback: (
    messageId: string,
    voiceMessage: RenderedConversationMessage['renderedContent']['voiceMessage'],
  ) => void;
  peerLastReadAt: string | null;
  peerLastReadMessageId: string | null;
  playingVoiceElapsedSec: number;
  playingVoiceMessageId: string | null;
  voicePlaybackRate: VoicePlaybackRate;
  newerMessage: RenderedConversationMessage | null;
};

const MessageBubbleRow = React.memo(function MessageBubbleRow({
  item,
  latestOwnMessageId,
  olderMessage,
  onOpenPhotoPreview,
  onCyclePlaybackRate,
  onTogglePlayback,
  peerLastReadAt,
  peerLastReadMessageId,
  playingVoiceElapsedSec,
  playingVoiceMessageId,
  voicePlaybackRate,
  newerMessage,
}: MessageBubbleRowProps) {
  const mine = item.isMine;
  const joinsBelow = areMessagesGrouped(item, newerMessage);
  const joinsAbove = areMessagesGrouped(item, olderMessage);
  const showDayDivider =
    !olderMessage || !isSameMessageDay(item.createdAt, olderMessage.createdAt);
  const localStatus = mine ? item.localStatus ?? null : null;
  const isPendingLocally = localStatus === 'pending';
  const isSendingLocally = localStatus === 'sending';
  const showDeliveryState =
    mine && (latestOwnMessageId === item.id || isPendingLocally || isSendingLocally);
  const isRead = mine && isMessageReadByPeer(item, peerLastReadAt, peerLastReadMessageId);
  const messageTimeLabel = showDeliveryState ? '' : formatBubbleTime(item.createdAt);
  const deliveredAtLabel =
    mine && !isPendingLocally && !isSendingLocally
      ? formatBubbleTime(item.createdAt)
      : '';
  const statusLabel = !showDeliveryState
    ? ''
    : isPendingLocally
      ? 'Beklemede'
      : isSendingLocally
        ? 'Gönderiliyor'
        : isRead
          ? `Okundu${peerLastReadAt ? ` ${formatBubbleTime(peerLastReadAt)}` : ''}`
          : `Teslim${deliveredAtLabel ? ` ${deliveredAtLabel}` : ''}`;
  const showMeta = !joinsBelow || showDeliveryState;
  const parsedMessage = item.renderedContent;
  const isVoiceMessage = parsedMessage.kind === 'voice';
  const isVoicePlaying = isVoiceMessage && playingVoiceMessageId === item.id;
  const voiceDurationSec = item.voiceDurationSec;
  const voiceElapsedSec = isVoicePlaying ? playingVoiceElapsedSec : 0;
  const voiceProgressRatio =
    isVoiceMessage ? clampRatio(voiceElapsedSec / Math.max(1, voiceDurationSec)) : 0;
  const voiceWaveformBars = item.voiceWaveformBars;
  const voiceIsUploading =
    isVoiceMessage &&
    mine &&
    (isPendingLocally || isSendingLocally) &&
    !parsedMessage.voiceMessage?.url;
  const voiceSecondaryLabel = isVoicePlaying
    ? 'Oynatılıyor'
    : voiceIsUploading
      ? isSendingLocally
        ? 'Gönderiliyor...'
        : 'Bağlantı bekleniyor'
      : parsedMessage.voiceMessage?.url
        ? 'Dinlemek için dokun'
        : 'Hazırlanıyor...';
  const voicePrimaryTimeLabel = isVoicePlaying
    ? formatVoicePlaybackClock(voiceElapsedSec, { includeTenths: true })
    : formatVoiceSeconds(voiceDurationSec);
  const voiceMetaTimeLabel = isVoicePlaying
    ? `${formatVoicePlaybackClock(voiceElapsedSec, { includeTenths: true })} / ${formatVoiceSeconds(
        voiceDurationSec,
      )}`
    : formatVoiceSeconds(voiceDurationSec);
  const photoPreviewUrl =
    parsedMessage.kind === 'photo' &&
    typeof parsedMessage.photoMessage?.url === 'string'
      ? parsedMessage.photoMessage.url.trim()
      : '';
  const canShowPhotoPreview =
    parsedMessage.kind === 'photo' && canRenderInlinePhoto(photoPreviewUrl);
  const photoTitle =
    parsedMessage.kind === 'photo' &&
    typeof parsedMessage.photoMessage?.title === 'string' &&
    parsedMessage.photoMessage.title.trim().length > 0
      ? parsedMessage.photoMessage.title.trim()
      : parsedMessage.text;

  return (
    <View
      style={[
        styles.messageRow,
        mine ? styles.messageRowMine : styles.messageRowPeer,
        joinsAbove ? styles.messageRowJoinAbove : null,
        joinsBelow ? styles.messageRowJoinBelow : null,
      ]}
    >
      {showDayDivider ? (
        <View style={styles.messageDayDivider}>
          <View style={styles.messageDayDividerLine} />
          <Text allowFontScaling={false} style={styles.messageDayDividerText}>
            {formatMessageDayLabel(item.createdAt)}
          </Text>
          <View style={styles.messageDayDividerLine} />
        </View>
      ) : null}
      <View
        style={[
          styles.messageBubble,
          mine ? styles.messageBubbleMine : styles.messageBubblePeer,
          joinsAbove
            ? mine
              ? styles.messageBubbleMineJoinedAbove
              : styles.messageBubblePeerJoinedAbove
            : null,
          joinsBelow
            ? mine
              ? styles.messageBubbleMineJoinedBelow
              : styles.messageBubblePeerJoinedBelow
            : null,
          isVoiceMessage ? styles.messageBubbleVoice : null,
          parsedMessage.kind === 'photo' ? styles.messageBubblePhoto : null,
        ]}
      >
        {isVoiceMessage ? (
          <View style={styles.richMessageVoiceCard}>
            {voiceIsUploading ? (
              <View style={styles.richMessageVoiceUploadingOverlay}>
                <IosSpinner color={mine ? '#ff6a2f' : '#6b7280'} size="small" />
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.richMessageVoiceUploadingText,
                    mine
                      ? styles.richMessageVoiceUploadingTextMine
                      : styles.richMessageVoiceUploadingTextPeer,
                  ]}
                >
                  {isSendingLocally ? 'Ses gönderiliyor...' : 'Bağlantı bekleniyor'}
                </Text>
              </View>
            ) : null}
            <View style={styles.richMessageVoiceCardInner}>
              <Pressable
                disabled={!parsedMessage.voiceMessage?.url || voiceIsUploading}
                onPress={() => {
                  onTogglePlayback(item.id, parsedMessage.voiceMessage);
                }}
                style={[
                  styles.richMessageVoicePlayButton,
                  mine
                    ? styles.richMessageVoicePlayButtonMine
                    : styles.richMessageVoicePlayButtonPeer,
                  isVoicePlaying ? styles.richMessageVoicePlayButtonActive : null,
                  !parsedMessage.voiceMessage?.url
                    ? styles.richMessageVoicePlayButtonDisabled
                    : null,
                ]}
              >
                <View
                  style={[
                    styles.richMessageVoicePlayButtonCore,
                    mine
                      ? styles.richMessageVoicePlayButtonCoreMine
                      : styles.richMessageVoicePlayButtonCorePeer,
                    isVoicePlaying ? styles.richMessageVoicePlayButtonCoreActive : null,
                  ]}
                >
                  <FeatherIcon
                    color={isVoicePlaying ? '#ffffff' : mine ? '#ff6a2f' : '#1f2937'}
                    name={isVoicePlaying ? 'pause' : 'play'}
                    size={16}
                    style={!isVoicePlaying ? styles.richMessageVoicePlayIconPlay : null}
                  />
                </View>
              </Pressable>

              <View style={styles.richMessageVoiceMain}>
                <View style={styles.richMessageVoiceTopRow}>
                  <View style={styles.richMessageVoiceHeadline}>
                    <Text
                      allowFontScaling={false}
                      style={[
                        styles.richMessageVoiceLabel,
                        mine
                          ? styles.richMessageVoiceLabelMine
                          : styles.richMessageVoiceLabelPeer,
                      ]}
                    >
                      Ses kaydi
                    </Text>
                    <Text
                      allowFontScaling={false}
                      style={[
                        styles.richMessageVoiceTime,
                        mine
                          ? styles.richMessageVoiceTimeMine
                          : styles.richMessageVoiceTimePeer,
                        isVoicePlaying ? styles.richMessageVoiceTimeLive : null,
                      ]}
                    >
                      {voicePrimaryTimeLabel}
                    </Text>
                  </View>
                  <Pressable
                    onPress={onCyclePlaybackRate}
                    style={[
                      styles.richMessageVoiceRateButton,
                      mine
                        ? styles.richMessageVoiceRateButtonMine
                        : styles.richMessageVoiceRateButtonPeer,
                      isVoicePlaying ? styles.richMessageVoiceRateButtonActive : null,
                    ]}
                  >
                    <Text
                      allowFontScaling={false}
                      style={[
                        styles.richMessageVoiceRateText,
                        mine
                          ? styles.richMessageVoiceRateTextMine
                          : styles.richMessageVoiceRateTextPeer,
                      ]}
                    >
                      {formatVoicePlaybackRate(voicePlaybackRate)}
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.richMessageVoiceWaveStage}>
                  <View style={styles.richMessageWaveRow}>
                    {voiceWaveformBars.map((amplitude, index) => {
                      const progressThreshold =
                        voiceWaveformBars.length > 1
                          ? index / (voiceWaveformBars.length - 1)
                          : 1;
                      const isPlayed = isVoicePlaying && progressThreshold <= voiceProgressRatio;

                      return (
                        <View
                          key={`${item.id}_wave_${index}`}
                          style={[
                            styles.richMessageWaveBar,
                            mine
                              ? styles.richMessageWaveBarMine
                              : styles.richMessageWaveBarPeer,
                            getWaveformBarHeightStyle(amplitude),
                            isPlayed
                              ? mine
                                ? styles.richMessageWaveBarMineActive
                                : styles.richMessageWaveBarPeerActive
                              : null,
                          ]}
                        />
                      );
                    })}
                  </View>
                </View>
                <View style={styles.richMessageVoiceMetaRow}>
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.richMessageVoiceSubLabel,
                      mine
                        ? styles.richMessageVoiceSubLabelMine
                        : styles.richMessageVoiceSubLabelPeer,
                    ]}
                  >
                    {voiceSecondaryLabel}
                  </Text>
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.richMessageVoiceSubLabel,
                      mine
                        ? styles.richMessageVoiceSubLabelMine
                        : styles.richMessageVoiceSubLabelPeer,
                    ]}
                  >
                    {voiceMetaTimeLabel}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        ) : parsedMessage.kind === 'photo' ? (
          <View style={styles.richPhotoMessageCard}>
            {canShowPhotoPreview ? (
              <Pressable
                onPress={() => {
                  onOpenPhotoPreview(photoPreviewUrl, photoTitle);
                }}
                style={({ pressed }) => [
                  styles.richPhotoPreviewShell,
                  pressed ? styles.richPhotoPreviewShellPressed : null,
                ]}
              >
                <Image
                  resizeMode="cover"
                  source={{ uri: photoPreviewUrl }}
                  style={styles.richPhotoPreviewImage}
                />
              </Pressable>
            ) : (
              <View style={styles.richMessageRow}>
                <View
                  style={[
                    styles.richMessageIconWrap,
                    mine ? styles.richMessageIconWrapMine : styles.richMessageIconWrapPeer,
                  ]}
                >
                  <FeatherIcon color={mine ? '#ffffff' : '#1b1f29'} name="image" size={13} />
                </View>
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.messageBody,
                    mine ? styles.messageBodyMine : styles.messageBodyPeer,
                    styles.richMessageLabel,
                  ]}
                >
                  {parsedMessage.text}
                </Text>
              </View>
            )}
            <View style={styles.richPhotoMetaRow}>
              <View
                style={[
                  styles.richMessageIconWrap,
                  mine ? styles.richMessageIconWrapMine : styles.richMessageIconWrapPeer,
                ]}
              >
                <FeatherIcon color={mine ? '#ffffff' : '#1b1f29'} name="camera" size={13} />
              </View>
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                style={[
                  styles.messageBody,
                  mine ? styles.messageBodyMine : styles.messageBodyPeer,
                  styles.richMessageLabel,
                  styles.richPhotoTitle,
                ]}
              >
                {photoTitle}
              </Text>
            </View>
          </View>
        ) : parsedMessage.kind === 'location' ? (
          <View style={styles.richMessageRow}>
            <View
              style={[
                styles.richMessageIconWrap,
                mine ? styles.richMessageIconWrapMine : styles.richMessageIconWrapPeer,
              ]}
            >
              <FeatherIcon color={mine ? '#ffffff' : '#1b1f29'} name="map-pin" size={13} />
            </View>
            <Text
              allowFontScaling={false}
              style={[
                styles.messageBody,
                mine ? styles.messageBodyMine : styles.messageBodyPeer,
                styles.richMessageLabel,
              ]}
            >
              {parsedMessage.text}
            </Text>
          </View>
        ) : (
          <Text
            allowFontScaling={false}
            style={[
              styles.messageBody,
              mine ? styles.messageBodyMine : styles.messageBodyPeer,
            ]}
          >
            {parsedMessage.text}
          </Text>
        )}
      </View>
      {showMeta ? (
        <View
          style={[
            styles.messageMetaRow,
            mine ? styles.messageMetaRowMine : styles.messageMetaRowPeer,
            joinsBelow ? styles.messageMetaRowCompact : null,
          ]}
        >
          {messageTimeLabel ? (
            <Text
              allowFontScaling={false}
              style={[
                styles.messageBubbleTime,
                mine ? styles.messageBubbleTimeMine : styles.messageBubbleTimePeer,
              ]}
            >
              {messageTimeLabel}
            </Text>
          ) : null}
          {mine ? (
            <View style={styles.messageMetaStatusGroup}>
              {isSendingLocally ? (
                <View
                  style={[
                    styles.messageDeliveryStatusPill,
                    styles.messageDeliveryStatusPillSending,
                  ]}
                >
                  <IosSpinner color="#64748b" size="small" />
                </View>
              ) : isPendingLocally ? (
                <View
                  style={[
                    styles.messageDeliveryStatusPill,
                    styles.messageDeliveryStatusPillPending,
                  ]}
                >
                  <FeatherIcon color="#b45309" name="clock" size={11} />
                </View>
              ) : (
                <View
                  style={[
                    styles.messageDeliveryIconWrap,
                    mine
                      ? styles.messageDeliveryIconMine
                      : styles.messageDeliveryIconPeer,
                  ]}
                >
                  <FeatherIcon
                    color={isRead ? '#34d399' : '#9ca3af'}
                    name="check"
                    size={11}
                  />
                  <FeatherIcon
                    color={isRead ? '#34d399' : '#c4c9d4'}
                    name="check"
                    size={11}
                    style={styles.messageDeliveryIconSecond}
                  />
                </View>
              )}
              {showDeliveryState ? (
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.messageStatusLabel,
                    isPendingLocally
                      ? styles.messageStatusLabelPending
                      : isSendingLocally
                        ? styles.messageStatusLabelSending
                        : isRead
                          ? styles.messageStatusLabelRead
                          : styles.messageStatusLabelDelivered,
                  ]}
                >
                  {statusLabel}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}, (previous, next) => {
  if (previous.item !== next.item) {
    return false;
  }
  if (previous.newerMessage !== next.newerMessage || previous.olderMessage !== next.olderMessage) {
    return false;
  }
  if (previous.latestOwnMessageId !== next.latestOwnMessageId) {
    return false;
  }
  if (previous.peerLastReadAt !== next.peerLastReadAt) {
    return false;
  }
  if (previous.peerLastReadMessageId !== next.peerLastReadMessageId) {
    return false;
  }
  if (previous.voicePlaybackRate !== next.voicePlaybackRate) {
    return false;
  }

  const previousIsPlaying = previous.playingVoiceMessageId === previous.item.id;
  const nextIsPlaying = next.playingVoiceMessageId === next.item.id;
  if (previousIsPlaying !== nextIsPlaying) {
    return false;
  }
  if (
    nextIsPlaying &&
    Math.abs(previous.playingVoiceElapsedSec - next.playingVoiceElapsedSec) > 0.01
  ) {
    return false;
  }

  return true;
});

export default function MessagesScreen({
  contentBottomInset,
  displayName,
  onConversationOpenChange,
  onOpenPublicProfile,
  onPrefillRecipientConsumed,
  prefillRecipient,
  safeTop,
  viewerId,
}: MessagesScreenProps) {
  const { confirm, showDialog } = useAlert();
  const { resolveErrorMessage } = useApiActionFeedback();
  const { height: viewportHeight } = useWindowDimensions();
  const newConversationSheetHalfOpenOffset = Math.max(
    72,
    Math.min(118, Math.round(viewportHeight * 0.1)),
  );
  const newConversationSheetHiddenOffset = Math.max(
    420,
    Math.round(viewportHeight * 0.92),
  );
  const conversationRequestIDRef = useRef(0);
  const messageRequestIDRef = useRef(0);
  const newConversationSearchRequestIDRef = useRef(0);
  const activeConversationIdRef = useRef<string | null>(null);
  const searchInputRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const newConversationSearchInputRef =
    useRef<React.ElementRef<typeof TextInput>>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const socketReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketConnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketHeartbeatCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketHeartbeatAckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const socketReconnectAttemptRef = useRef(0);
  const socketStatusRef = useRef<SocketStatus>('connecting');
  const socketOfflineBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const awaitingSocketHeartbeatAckRef = useRef(false);
  const lastSocketActivityAtRef = useRef(Date.now());
  const lastRecoverySnapshotAtRef = useRef(0);
  const connectSocketRef = useRef<(() => void) | null>(null);
  const flushPendingQueueRef = useRef<
    ((conversationId?: string | null) => Promise<void>) | null
  >(null);
  const runRecoverySnapshotRef = useRef<
    ((reason: RecoverySnapshotReason) => Promise<void>) | null
  >(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const pendingSendQueueRef = useRef<PendingSendQueueItem[]>([]);
  const pendingQueueHydratedRef = useRef(false);
  const pendingQueueFlushInFlightRef = useRef(false);
  const recoverySnapshotInFlightRef = useRef(false);
  const displayedMessagesRef = useRef<ConversationMessage[]>([]);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTypingConversationIdRef = useRef<string | null>(null);
  const voicePressActiveRef = useRef(false);
  const voicePressHandledRef = useRef(false);
  const readSyncRef = useRef({
    flushTimer: null as ReturnType<typeof setTimeout> | null,
    inFlight: false,
    lastSyncedAtMs: 0,
    lastSyncedMessageId: '' as string | '',
    queuedMessageId: '' as string | '',
  });
  const prefillRecipientInFlightRef = useRef<string | null>(null);
  const messageCacheRef = useRef<Map<string, ConversationMessageCacheEntry>>(new Map());
  const conversationsRef = useRef<ConversationSummary[]>([]);
  const lastMessageRequestsBaseCountRef = useRef(0);
  const messageRequestEventIdsRef = useRef<Set<string>>(new Set());
  const renderedMessageCacheRef = useRef<Map<string, RenderedMessageCacheEntry>>(
    new Map(),
  );
  const detailListRef = useRef<FlashListRef<RenderedConversationMessage> | null>(null);
  const detailScrollToLatestVisibleRef = useRef(false);
  const detailInitialSnapConversationIdRef = useRef<string | null>(null);
  const messagesContextRef = useRef<{
    conversationId: string | null;
    hasMore: boolean;
    nextCursor: string | null;
  }>({
    conversationId: null,
    hasMore: false,
    nextCursor: null,
  });
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchUsers, setSearchUsers] = useState<ExploreSearchUser[]>([]);
  const [searchUsersLoading, setSearchUsersLoading] = useState(false);
  const [searchUsersError, setSearchUsersError] = useState<string | null>(null);
  const [searchUserActionPendingId, setSearchUserActionPendingId] = useState<
    string | null
  >(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'unread' | 'requests'>(
    'all',
  );
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messageRequestRealtimeDelta, setMessageRequestRealtimeDelta] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isNewConversationOpen, setIsNewConversationOpen] = useState(false);
  const [newConversationQuery, setNewConversationQuery] = useState('');
  const [newConversationSearchQuery, setNewConversationSearchQuery] =
    useState('');
  const [newConversationUsers, setNewConversationUsers] = useState<
    ExploreSearchUser[]
  >([]);
  const [newConversationLoading, setNewConversationLoading] = useState(false);
  const [newConversationError, setNewConversationError] = useState<
    string | null
  >(null);
  const [newConversationRecipient, setNewConversationRecipient] =
    useState<ExploreSearchUser | null>(null);
  const [newConversationInitialMessage, setNewConversationInitialMessage] =
    useState('');
  const [newConversationCreating, setNewConversationCreating] = useState(false);
  const [activeConversation, setActiveConversation] =
    useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messagesNextCursor, setMessagesNextCursor] = useState<string | null>(
    null,
  );
  const [messagesHasMore, setMessagesHasMore] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesRefreshing, setMessagesRefreshing] = useState(false);
  const [messagesFetchingMore, setMessagesFetchingMore] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [composerText, setComposerText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isVoiceUploading, setIsVoiceUploading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [peerLastReadAt, setPeerLastReadAt] = useState<string | null>(null);
  const [peerLastReadMessageId, setPeerLastReadMessageId] = useState<
    string | null
  >(null);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('connecting');
  const [socketReconnectAttemptCount, setSocketReconnectAttemptCount] = useState(0);
  const [isSocketOfflineBannerVisible, setIsSocketOfflineBannerVisible] =
    useState(false);
  const [pendingSendQueue, setPendingSendQueue] = useState<PendingSendQueueItem[]>(
    [],
  );
  const [showDetailScrollToLatest, setShowDetailScrollToLatest] = useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [isAttachmentCameraVisible, setIsAttachmentCameraVisible] = useState(false);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [photoPreviewState, setPhotoPreviewState] = useState<{
    title: string;
    uri: string;
  } | null>(null);
  const [headerMenuPendingAction, setHeaderMenuPendingAction] = useState<
    'none' | 'mute' | 'clear' | 'delete' | 'block'
  >('none');
  const [messageRequestActionPending, setMessageRequestActionPending] = useState<
    'accept' | 'block' | 'none' | 'reject'
  >('none');
  const [messageRequestActionConversationId, setMessageRequestActionConversationId] =
    useState<string | null>(null);
  const [blockUserSheet, setBlockUserSheet] =
    useState<MessagesBlockUserSheetContext | null>(null);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  const detailScrollToLatestAnimationProgress = useRef(new Animated.Value(0)).current;
  const newConversationBackdropOpacity = useRef(new Animated.Value(0)).current;
  const newConversationCardOpacity = useRef(new Animated.Value(0)).current;
  const newConversationCardTranslateY = useRef(
    new Animated.Value(newConversationSheetHiddenOffset),
  ).current;
  const newConversationAnimatingRef = useRef(false);
  const searchUsersAbortControllerRef = useRef<AbortController | null>(null);
  const searchUsersRequestIdRef = useRef(0);
  const activeConversationId = activeConversation?.conversationId ?? null;
  const shouldShowDetailScrollToLatestBar =
    showDetailScrollToLatest && !isAttachmentMenuOpen;
  const detailScrollToLatestAnimatedStyle = useMemo(
    () => ({
      opacity: detailScrollToLatestAnimationProgress,
      transform: [
        {
          translateY: detailScrollToLatestAnimationProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [8, 0],
          }),
        },
        {
          scale: detailScrollToLatestAnimationProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [0.96, 1],
          }),
        },
      ],
    }),
    [detailScrollToLatestAnimationProgress],
  );

  useEffect(() => {
    displayedMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    pendingSendQueueRef.current = pendingSendQueue;
  }, [pendingSendQueue]);

  useEffect(() => {
    Animated.timing(detailScrollToLatestAnimationProgress, {
      duration: shouldShowDetailScrollToLatestBar
        ? DETAIL_SCROLL_TO_LATEST_SHOW_ANIMATION_MS
        : DETAIL_SCROLL_TO_LATEST_HIDE_ANIMATION_MS,
      easing: shouldShowDetailScrollToLatestBar
        ? Easing.out(Easing.cubic)
        : Easing.in(Easing.quad),
      toValue: shouldShowDetailScrollToLatestBar ? 1 : 0,
      useNativeDriver: true,
    }).start();
  }, [detailScrollToLatestAnimationProgress, shouldShowDetailScrollToLatestBar]);

  useEffect(() => {
    const clearOfflineTimer = () => {
      if (!socketOfflineBannerTimerRef.current) {
        return;
      }
      clearTimeout(socketOfflineBannerTimerRef.current);
      socketOfflineBannerTimerRef.current = null;
    };

    socketStatusRef.current = socketStatus;

    if (socketStatus === 'live' || socketStatus === 'connecting') {
      clearOfflineTimer();
      setIsSocketOfflineBannerVisible(false);
      return;
    }

    clearOfflineTimer();
    socketOfflineBannerTimerRef.current = setTimeout(() => {
      socketOfflineBannerTimerRef.current = null;
      setIsSocketOfflineBannerVisible(true);
    }, SOCKET_OFFLINE_BANNER_GRACE_MS);

    return () => {
      clearOfflineTimer();
    };
  }, [socketStatus]);

  useEffect(() => {
    let cancelled = false;
    pendingQueueHydratedRef.current = false;

    readStoredPendingConversationMessages(viewerId)
      .then(items => {
        if (cancelled) {
          return;
        }
        pendingSendQueueRef.current = items;
        setPendingSendQueue(items);
        if (
          items.length > 0 &&
          socketRef.current?.readyState === WebSocket.OPEN &&
          runRecoverySnapshotRef.current
        ) {
          ignorePromise(runRecoverySnapshotRef.current('queue-hydrated'));
        }
      })
      .catch(() => {
        if (!cancelled) {
          pendingSendQueueRef.current = [];
          setPendingSendQueue([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          pendingQueueHydratedRef.current = true;
        }
      });

    return () => {
      cancelled = true;
      pendingQueueHydratedRef.current = false;
    };
  }, [viewerId]);

  useEffect(() => {
    if (!pendingQueueHydratedRef.current) {
      return;
    }
    ignorePromise(storePendingConversationMessages(viewerId, pendingSendQueue));
  }, [pendingSendQueue, viewerId]);

  const createLocalTextMessage = useCallback(
    (conversationId: string, text: string): ConversationMessage => {
      const now = new Date().toISOString();
      const clientNonce = createLocalMessageId();
      return {
        body: text,
        clientNonce,
        conversationId,
        createdAt: now,
        id: clientNonce,
        isMine: true,
        kind: 'text',
        localStatus: 'sending',
        preview: text,
        senderId: viewerId,
      };
    },
    [viewerId],
  );

  const createLocalVoiceMessage = useCallback(
    (conversationId: string, recording: VoiceDraft): ConversationMessage => {
      const now = new Date().toISOString();
      const clientNonce = createLocalMessageId();
      const durationSec = resolveVoiceDurationSec(recording.durationSec, 6);
      const body = encodeRichMessagePayload({
        durationSec,
        kind: 'voice',
        mimeType: recording.mimeType,
        sizeBytes: recording.sizeBytes,
        title: 'Sesli mesaj',
        waveform: recording.waveform,
      });
      return {
        body,
        clientNonce,
        conversationId,
        createdAt: now,
        id: clientNonce,
        isMine: true,
        kind: 'voice',
        localStatus: 'sending',
        preview: `Sesli mesaj (${durationSec} sn)`,
        senderId: viewerId,
        voiceMessage: {
          conversationId,
          createdAt: now,
          durationSec,
          fileName: recording.fileName,
          id: '',
          mimeType: recording.mimeType,
          sizeBytes: Number.isFinite(recording.sizeBytes)
            ? Math.max(0, Math.floor(recording.sizeBytes))
            : 0,
          url: '',
          waveform: recording.waveform,
        },
      };
    },
    [viewerId],
  );

  const {
    beginVoiceRecording,
    cancelActiveVoiceRecording,
    finishVoiceRecording,
    handleVoiceActionPressIn,
    handleVoiceActionPressMove,
    isVoiceRecording,
    resetRecordingState,
    voiceHoldGuideText,
    voiceRecordingGestureOffsetX,
    voiceRecordingGuideOpacity,
    voiceRecordingMode,
    voiceRecordingModeRef,
    voiceRecordingPressStartRef,
    voiceRecordingPreviewBars,
    voiceRecordingSeconds,
    stopAndPreviewVoiceRecording,
    togglePreviewPlayback,
    previewPlaybackPlaying,
    previewPlaybackElapsedSec,
    voiceRecordingDraft,
  } = useVoiceRecorderComposer({
    activeConversationId,
    composerText,
    isBusy: isSending || isVoiceUploading,
    onError: setSendError,
    onSendVoice: async (recording: VoiceDraft) => {
      const conversationId = activeConversationIdRef.current;
      if (!conversationId) {
        return;
      }
      const localMessage = createLocalVoiceMessage(conversationId, recording);
      mutateConversationMessages(conversationId, previous =>
        prependMessage(previous, localMessage),
      );
      touchConversationWithMessage(localMessage, false);
      await sendVoiceDraft(conversationId, recording, localMessage);
    },
  });
  const {
    cyclePlaybackRate,
    playingVoiceElapsedSec,
    playingVoiceMessageId,
    stopPlayback,
    togglePlayback,
    voicePlaybackRate,
  } = useVoicePlaybackController({
    onError: setSendError,
    viewerId,
  });
  const handleToggleVoicePlayback = useCallback(
    (
      messageId: string,
      voiceMessage: RenderedConversationMessage['renderedContent']['voiceMessage'],
    ) => {
      ignorePromise(togglePlayback(messageId, voiceMessage));
    },
    [togglePlayback],
  );
  const greetingName = useMemo(() => {
    const first = (displayName ?? '').trim().split(/\s+/)[0];
    return first && first.length > 0 ? first : 'Sürücü';
  }, [displayName]);
  const greetingLabel = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) {
      return 'Günaydın';
    }
    if (hour < 18) {
      return 'İyi günler';
    }
    return 'İyi akşamlar';
  }, []);
  const isPeerBlockedByViewer = Boolean(activeConversation?.isPeerBlockedByViewer);
  const isViewerBlockedByPeer = Boolean(activeConversation?.isViewerBlockedByPeer);
  const conversationUIState = getConversationUIState(activeConversation);
  const isConversationRequest = conversationUIState === 'request_received';
  const isRejectedConversationRequest = conversationUIState === 'request_rejected';
  const isRestrictedConversation = conversationUIState === 'restricted';
  const isConversationBlocked =
    conversationUIState === 'blocked_by_me' ||
    conversationUIState === 'blocked_by_them';
  const isConversationInteractionLocked =
    isConversationBlocked || activeConversation?.canSendMessage === false;
  const requestBannerText = getRequestBannerText(conversationUIState);
  const shouldShowRequestBanner =
    shouldShowConversationRequestBanner(conversationUIState);
  const conversationLockMessage = getConversationLockText(conversationUIState, {
    blockedByThemLabel: HIDDEN_USER_NOT_FOUND_LABEL,
    messagingHint: activeConversation?.messagingHint,
  });
  const headerMenuActionPending = headerMenuPendingAction !== 'none';
  const newConversationSuggestedUsers = useMemo(() => {
    const uniqueUsers = new Map<string, ExploreSearchUser>();
    conversations.forEach(item => {
      const peerId = item.peer.id.trim();
      if (!peerId || peerId === viewerId || uniqueUsers.has(peerId)) {
        return;
      }
      uniqueUsers.set(peerId, toExploreSearchUserFromConversation(item));
    });
    return Array.from(uniqueUsers.values()).slice(0, NEW_CONVERSATION_SEARCH_LIMIT);
  }, [conversations, viewerId]);
  const newConversationPanelUsers = useMemo(
    () =>
      newConversationSearchQuery.trim().length > 0
        ? newConversationUsers
        : newConversationSuggestedUsers,
    [
      newConversationSearchQuery,
      newConversationSuggestedUsers,
      newConversationUsers,
    ],
  );
  const newConversationResultsTitle =
    newConversationSearchQuery.trim().length > 0 ? 'Arama Sonuclari' : 'Son sohbetler';
  const showNewConversationEmpty =
    !newConversationLoading &&
    newConversationSearchQuery.length > 0 &&
    newConversationUsers.length === 0 &&
    !newConversationError;
  const showNewConversationIdleState =
    !newConversationLoading &&
    newConversationSearchQuery.length === 0 &&
    newConversationPanelUsers.length === 0 &&
    !newConversationError;

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    onConversationOpenChange?.(Boolean(activeConversation));
    return () => {
      onConversationOpenChange?.(false);
    };
  }, [activeConversation, onConversationOpenChange]);

  const clearTypingTimer = useCallback(() => {
    if (!typingStopTimerRef.current) {
      return;
    }
    clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = null;
  }, []);

  const clearReadSyncTimer = useCallback(() => {
    const timer = readSyncRef.current.flushTimer;
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    readSyncRef.current.flushTimer = null;
  }, []);

  const clearSocketReconnectTimer = useCallback(() => {
    if (!socketReconnectTimerRef.current) {
      return;
    }
    clearTimeout(socketReconnectTimerRef.current);
    socketReconnectTimerRef.current = null;
  }, []);

  const clearSocketConnectTimeout = useCallback(() => {
    if (!socketConnectTimeoutRef.current) {
      return;
    }
    clearTimeout(socketConnectTimeoutRef.current);
    socketConnectTimeoutRef.current = null;
  }, []);

  const clearSocketHeartbeatCheckTimer = useCallback(() => {
    if (!socketHeartbeatCheckTimerRef.current) {
      return;
    }
    clearTimeout(socketHeartbeatCheckTimerRef.current);
    socketHeartbeatCheckTimerRef.current = null;
  }, []);

  const clearSocketHeartbeatAckTimeout = useCallback(() => {
    if (!socketHeartbeatAckTimeoutRef.current) {
      return;
    }
    clearTimeout(socketHeartbeatAckTimeoutRef.current);
    socketHeartbeatAckTimeoutRef.current = null;
  }, []);

  const clearSocketOfflineBannerTimer = useCallback(() => {
    if (!socketOfflineBannerTimerRef.current) {
      return;
    }
    clearTimeout(socketOfflineBannerTimerRef.current);
    socketOfflineBannerTimerRef.current = null;
  }, []);

  const replacePendingSendQueue = useCallback(
    (
      updater: (
        previous: PendingSendQueueItem[],
      ) => PendingSendQueueItem[],
    ) => {
      setPendingSendQueue(previous => {
        const nextQueue = updater(previous)
          .filter(item => item.messageId.trim().length > 0)
          .sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt),
          );
        pendingSendQueueRef.current = nextQueue;
        return nextQueue;
      });
    },
    [],
  );

  const upsertPendingQueueItem = useCallback(
    (item: PendingSendQueueItem) => {
      replacePendingSendQueue(previous => [
        item,
        ...previous.filter(entry => entry.messageId !== item.messageId),
      ]);
    },
    [replacePendingSendQueue],
  );

  const updatePendingQueueItem = useCallback(
    (
      messageId: string,
      updater: (item: PendingSendQueueItem) => PendingSendQueueItem | null,
    ) => {
      replacePendingSendQueue(previous =>
        previous.flatMap(item => {
          if (item.messageId !== messageId) {
            return [item];
          }
          const nextItem = updater(item);
          return nextItem ? [nextItem] : [];
        }),
      );
    },
    [replacePendingSendQueue],
  );

  const removePendingQueueItem = useCallback(
    (messageId: string) => {
      replacePendingSendQueue(previous =>
        previous.filter(item => item.messageId !== messageId),
      );
    },
    [replacePendingSendQueue],
  );

  const clearComposerIfMatches = useCallback((expectedText: string) => {
    const normalizedExpected = expectedText.trim();
    setComposerText(current =>
      current.trim() === normalizedExpected ? '' : current,
    );
  }, []);

  const mutateConversationMessages = useCallback(
    (
      conversationId: string,
      updater: (previous: ConversationMessage[]) => ConversationMessage[],
    ) => {
      const normalizedConversationId = conversationId.trim();
      if (!normalizedConversationId) {
        return;
      }

      const applyAndPersist = (source: ConversationMessage[]) => {
        const nextMessages = updater(source);
        const cached = messageCacheRef.current.get(normalizedConversationId);
        messageCacheRef.current.set(normalizedConversationId, {
          hasMore:
            cached?.hasMore ??
            (messagesContextRef.current.conversationId === normalizedConversationId
              ? messagesContextRef.current.hasMore
              : false),
          messages: nextMessages,
          nextCursor:
            cached?.nextCursor ??
            (messagesContextRef.current.conversationId === normalizedConversationId
              ? messagesContextRef.current.nextCursor
              : null),
        });
        return nextMessages;
      };

      if (activeConversationIdRef.current === normalizedConversationId) {
        startTransition(() => {
          setMessages(previous => {
            const nextMessages = applyAndPersist(previous);
            displayedMessagesRef.current = nextMessages;
            return nextMessages;
          });
        });
        return;
      }

      const cached = messageCacheRef.current.get(normalizedConversationId);
      applyAndPersist(cached?.messages ?? []);
    },
    [],
  );

  const emitTyping = useCallback((conversationId: string, isTyping: boolean) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      socket.send(
        JSON.stringify({
          conversationId,
          isTyping,
          type: 'typing',
        }),
      );
    } catch {
      return;
    }
  }, []);

  const stopLocalTyping = useCallback(
    (conversationId?: string | null) => {
      const activeTypingConversationId =
        conversationId ?? localTypingConversationIdRef.current;
      if (!activeTypingConversationId) {
        return;
      }

      emitTyping(activeTypingConversationId, false);
      if (localTypingConversationIdRef.current === activeTypingConversationId) {
        localTypingConversationIdRef.current = null;
      }
    },
    [emitTyping],
  );

  const closeAttachmentMenu = useCallback(() => {
    setIsAttachmentMenuOpen(false);
  }, []);

  const toggleAttachmentMenu = useCallback(() => {
    if (isConversationInteractionLocked) {
      return;
    }
    setIsAttachmentMenuOpen(previous => !previous);
  }, [isConversationInteractionLocked]);

  const scrollDetailToLatest = useCallback((animated = true) => {
    const list = detailListRef.current;
    if (!list) {
      return;
    }
    try {
      list.scrollToOffset({
        animated,
        offset: 0,
      });
    } catch {
      return;
    }
  }, []);

  const handleDetailListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = Math.max(0, event.nativeEvent.contentOffset.y ?? 0);
      const wasVisible = detailScrollToLatestVisibleRef.current;
      const shouldShow = wasVisible
        ? offsetY > DETAIL_SCROLL_TO_LATEST_HIDE_OFFSET
        : offsetY > DETAIL_SCROLL_TO_LATEST_SHOW_OFFSET;
      if (shouldShow === wasVisible) {
        return;
      }
      detailScrollToLatestVisibleRef.current = shouldShow;
      setShowDetailScrollToLatest(shouldShow);
    },
    [],
  );

  const handleDetailListContentSizeChange = useCallback(() => {
    const conversationId = activeConversationIdRef.current;
    if (!conversationId) {
      return;
    }
    if (detailInitialSnapConversationIdRef.current !== conversationId) {
      return;
    }
    scrollDetailToLatest(false);
    detailInitialSnapConversationIdRef.current = null;
  }, [scrollDetailToLatest]);

  const handlePressDetailScrollToLatest = useCallback(() => {
    detailScrollToLatestVisibleRef.current = false;
    setShowDetailScrollToLatest(false);
    scrollDetailToLatest(true);
  }, [scrollDetailToLatest]);

  useEffect(() => {
    if (!isSearchOpen) {
      setSearchText('');
      setSearchQuery('');
      setSearchUsers([]);
      setSearchUsersLoading(false);
      setSearchUsersError(null);
      setSearchUserActionPendingId(null);
      searchUsersAbortControllerRef.current?.abort();
      searchUsersAbortControllerRef.current = null;
      return;
    }

    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 20);
    return () => {
      clearTimeout(timer);
    };
  }, [isSearchOpen]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchText.trim());
    }, 220);
    return () => {
      clearTimeout(timer);
    };
  }, [searchText]);

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }

    const query = searchQuery.trim();
    if (query.length === 0) {
      setSearchUsers([]);
      setSearchUsersLoading(false);
      setSearchUsersError(null);
      searchUsersAbortControllerRef.current?.abort();
      searchUsersAbortControllerRef.current = null;
      return;
    }

    searchUsersRequestIdRef.current += 1;
    const requestId = searchUsersRequestIdRef.current;
    searchUsersAbortControllerRef.current?.abort();
    const requestAbortController = new AbortController();
    searchUsersAbortControllerRef.current = requestAbortController;
    setSearchUsersLoading(true);
    setSearchUsersError(null);

    searchExploreUsers(query, {
      limit: MESSAGE_SEARCH_USERS_LIMIT,
      signal: requestAbortController.signal,
    })
      .then(response => {
        if (
          requestId !== searchUsersRequestIdRef.current ||
          requestAbortController.signal.aborted
        ) {
          return;
        }

        setSearchUsers(response.users.filter(user => user.id !== viewerId));
      })
      .catch(error => {
        if (
          requestId !== searchUsersRequestIdRef.current ||
          requestAbortController.signal.aborted
        ) {
          return;
        }

        setSearchUsers([]);
        setSearchUsersError(
          isApiRequestError(error)
            ? error.message
            : 'Kullanıcı araması şu an tamamlanamadı.',
        );
      })
      .finally(() => {
        if (
          requestId !== searchUsersRequestIdRef.current ||
          requestAbortController.signal.aborted
        ) {
          return;
        }

        if (searchUsersAbortControllerRef.current === requestAbortController) {
          searchUsersAbortControllerRef.current = null;
        }
        setSearchUsersLoading(false);
      });

    return () => {
      requestAbortController.abort();
      if (searchUsersAbortControllerRef.current === requestAbortController) {
        searchUsersAbortControllerRef.current = null;
      }
    };
  }, [isSearchOpen, searchQuery, viewerId]);

  useEffect(() => {
    return () => {
      searchUsersAbortControllerRef.current?.abort();
    };
  }, []);

  const resetNewConversationState = useCallback(() => {
    setNewConversationQuery('');
    setNewConversationSearchQuery('');
    setNewConversationUsers([]);
    setNewConversationLoading(false);
    setNewConversationError(null);
    setNewConversationRecipient(null);
    setNewConversationInitialMessage('');
    setNewConversationCreating(false);
  }, []);

  const openNewConversationPanel = useCallback(() => {
    if (isNewConversationOpen || newConversationAnimatingRef.current) {
      return;
    }
    setIsSearchOpen(false);
    resetNewConversationState();
    setIsNewConversationOpen(true);
  }, [isNewConversationOpen, resetNewConversationState]);

  const closeNewConversationPanel = useCallback(() => {
    if (!isNewConversationOpen || newConversationAnimatingRef.current) {
      return;
    }

    newConversationAnimatingRef.current = true;
    Animated.parallel([
      Animated.timing(newConversationBackdropOpacity, {
        duration: NEW_CONVERSATION_CLOSE_ANIMATION_MS,
        easing: Easing.bezier(0.4, 0, 1, 1),
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(newConversationCardOpacity, {
        duration: NEW_CONVERSATION_CLOSE_ANIMATION_MS,
        easing: Easing.bezier(0.4, 0, 1, 1),
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(newConversationCardTranslateY, {
        duration: NEW_CONVERSATION_CLOSE_ANIMATION_MS,
        easing: Easing.bezier(0.4, 0, 1, 1),
        toValue: newConversationSheetHiddenOffset,
        useNativeDriver: true,
      }),
    ]).start(() => {
      newConversationAnimatingRef.current = false;
      setIsNewConversationOpen(false);
      resetNewConversationState();
    });
  }, [
    isNewConversationOpen,
    newConversationBackdropOpacity,
    newConversationCardOpacity,
    newConversationCardTranslateY,
    newConversationSheetHiddenOffset,
    resetNewConversationState,
  ]);

  useEffect(() => {
    if (!isNewConversationOpen) {
      newConversationBackdropOpacity.setValue(0);
      newConversationCardOpacity.setValue(0);
      newConversationCardTranslateY.setValue(newConversationSheetHiddenOffset);
      return;
    }

    newConversationAnimatingRef.current = true;
    newConversationBackdropOpacity.setValue(0);
    newConversationCardOpacity.setValue(0);
    newConversationCardTranslateY.setValue(newConversationSheetHiddenOffset);
    Animated.parallel([
      Animated.timing(newConversationBackdropOpacity, {
        duration: NEW_CONVERSATION_OPEN_ANIMATION_MS,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(newConversationCardOpacity, {
        duration: 170,
        easing: Easing.out(Easing.quad),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.spring(newConversationCardTranslateY, {
        friction: 16,
        overshootClamping: true,
        tension: 110,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start(() => {
      newConversationAnimatingRef.current = false;
    });
  }, [
    isNewConversationOpen,
    newConversationBackdropOpacity,
    newConversationCardOpacity,
    newConversationCardTranslateY,
    newConversationSheetHiddenOffset,
  ]);

  useEffect(() => {
    if (!isNewConversationOpen) {
      return;
    }

    const timer = setTimeout(() => {
      newConversationSearchInputRef.current?.focus();
    }, 20);
    return () => {
      clearTimeout(timer);
    };
  }, [isNewConversationOpen]);

  useEffect(() => {
    if (!isNewConversationOpen) {
      return;
    }

    const timer = setTimeout(() => {
      setNewConversationSearchQuery(newConversationQuery.trim());
    }, NEW_CONVERSATION_SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [isNewConversationOpen, newConversationQuery]);

  useEffect(() => {
    if (!isNewConversationOpen) {
      return;
    }

    const query = newConversationSearchQuery.trim();
    if (query.length === 0) {
      setNewConversationUsers([]);
      setNewConversationLoading(false);
      setNewConversationError(null);
      return;
    }

    const requestID = newConversationSearchRequestIDRef.current + 1;
    newConversationSearchRequestIDRef.current = requestID;
    let active = true;
    setNewConversationLoading(true);
    setNewConversationError(null);

    searchExploreUsers(query, NEW_CONVERSATION_SEARCH_LIMIT)
      .then(response => {
        if (!active || requestID !== newConversationSearchRequestIDRef.current) {
          return;
        }
        setNewConversationUsers(response.users.filter(user => user.id !== viewerId));
      })
      .catch(error => {
        if (!active || requestID !== newConversationSearchRequestIDRef.current) {
          return;
        }
        setNewConversationUsers([]);
        setNewConversationError(
          isApiRequestError(error)
            ? error.message
            : 'Kullanıcı araması şu an yapılamıyor.',
        );
      })
      .finally(() => {
        if (!active || requestID !== newConversationSearchRequestIDRef.current) {
          return;
        }
        setNewConversationLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isNewConversationOpen, newConversationSearchQuery, viewerId]);

  const patchConversation = useCallback(
    (
      conversationId: string,
      updater: (item: ConversationSummary) => ConversationSummary,
      moveToTop = false,
    ) => {
      setConversations(previous =>
        updateConversationListItem(previous, conversationId, updater, moveToTop),
      );
      setActiveConversation(previous => {
        if (!previous || previous.conversationId !== conversationId) {
          return previous;
        }
        return updater(previous);
      });
    },
    [],
  );

  const patchPeerConversations = useCallback(
    (
      peerId: string,
      updater: (item: ConversationSummary) => ConversationSummary,
    ) => {
      const normalizedPeerId = peerId.trim();
      if (!normalizedPeerId) {
        return;
      }

      setConversations(previous =>
        previous.map(item =>
          item.peer.id.trim() === normalizedPeerId ? updater(item) : item,
        ),
      );
      setActiveConversation(previous => {
        if (!previous || previous.peer.id.trim() !== normalizedPeerId) {
          return previous;
        }
        return updater(previous);
      });
    },
    [],
  );

  const clearUnreadLocally = useCallback(
    (conversationId: string, unreadCount = 0) => {
      patchConversation(conversationId, item => {
        const normalizedUnreadCount = Math.max(0, unreadCount);
        const shouldBeUnread = normalizedUnreadCount > 0;
        if (
          item.unreadCount === normalizedUnreadCount &&
          item.isUnread === shouldBeUnread
        ) {
          return item;
        }
        return {
          ...item,
          isUnread: shouldBeUnread,
          unreadCount: normalizedUnreadCount,
        };
      });
    },
    [patchConversation],
  );

  const replaceDisplayedMessages = useCallback(
    (
      conversationId: string,
      nextMessages: ConversationMessage[],
      options?: {
        hasMore?: boolean;
        nextCursor?: string | null;
      },
    ) => {
      const normalizedConversationId = conversationId.trim();
      if (!normalizedConversationId) {
        return;
      }

      const nextHasMore = Boolean(options?.hasMore);
      const nextCursorValue = options?.nextCursor ?? null;
      messagesContextRef.current = {
        conversationId: normalizedConversationId,
        hasMore: nextHasMore,
        nextCursor: nextCursorValue,
      };
      messageCacheRef.current.set(normalizedConversationId, {
        hasMore: nextHasMore,
        messages: nextMessages,
        nextCursor: nextCursorValue,
      });
      displayedMessagesRef.current = nextMessages;
      startTransition(() => {
        setMessages(nextMessages);
      });
      setMessagesHasMore(nextHasMore);
      setMessagesNextCursor(nextCursorValue);
    },
    [],
  );

  const clearDisplayedMessages = useCallback(() => {
    messagesContextRef.current = {
      conversationId: null,
      hasMore: false,
      nextCursor: null,
    };
    displayedMessagesRef.current = [];
    startTransition(() => {
      setMessages([]);
    });
    setMessagesHasMore(false);
    setMessagesNextCursor(null);
  }, []);

  const touchConversationWithMessage = useCallback(
    (message: ConversationMessage, markUnread: boolean) => {
      patchConversation(
        message.conversationId,
        item => {
          const unreadCount = markUnread ? Math.max(1, item.unreadCount + 1) : 0;
          return {
            ...item,
            isUnread: markUnread,
            lastLocationMessage: message.locationMessage,
            lastMessage: message.body,
            lastMessageAt: message.createdAt,
            lastMessageKind: message.kind,
            lastMessagePreview: message.preview,
            lastPhotoMessage: message.photoMessage,
            lastVoiceMessage: message.voiceMessage,
            unreadCount,
          };
        },
        true,
      );
    },
    [patchConversation],
  );

  useEffect(() => {
    if (pendingSendQueue.length === 0) {
      return;
    }

    pendingSendQueue.forEach(item => {
      mutateConversationMessages(item.conversationId, previous =>
        previous.some(message => message.id === item.messageId)
          ? previous
          : prependMessage(previous, item.localMessage),
      );
      touchConversationWithMessage(item.localMessage, false);
    });
  }, [mutateConversationMessages, pendingSendQueue, touchConversationWithMessage]);

  const applyFirstPage = useCallback(
    (response: Awaited<ReturnType<typeof fetchConversations>>) => {
      startTransition(() => {
        setConversations(response.conversations);
      });
      setHasMore(response.hasMore);
      setNextCursor(response.nextCursor ?? null);

      const currentConversationId = activeConversationIdRef.current;
      if (!currentConversationId) {
        return;
      }
      const matched = response.conversations.find(
        item => item.conversationId === currentConversationId,
      );
      if (matched) {
        setActiveConversation(matched);
      }
    },
    [],
  );

  const flushReadState = useCallback(
    async (conversationId: string) => {
      const state = readSyncRef.current;
      if (state.inFlight) {
        return;
      }

      const now = Date.now();
      const queuedMessageId = state.queuedMessageId.trim();
      if (
        queuedMessageId.length > 0 &&
        queuedMessageId === state.lastSyncedMessageId &&
        now - state.lastSyncedAtMs < READ_SYNC_MIN_INTERVAL_MS
      ) {
        state.queuedMessageId = '';
        return;
      }
      if (
        queuedMessageId.length === 0 &&
        state.lastSyncedAtMs > 0 &&
        now - state.lastSyncedAtMs < READ_SYNC_MIN_INTERVAL_MS
      ) {
        return;
      }

      state.inFlight = true;
      const messageId = queuedMessageId;
      state.queuedMessageId = '';

      try {
        const response = await markConversationRead(
          conversationId,
          messageId.length > 0 ? messageId : undefined,
        );
        state.lastSyncedAtMs = Date.now();
        if (messageId.length > 0) {
          state.lastSyncedMessageId = messageId;
        }
        clearUnreadLocally(conversationId, Number(response.unreadCount ?? 0));
      } catch (error) {
        if (messageId.length > 0) {
          state.queuedMessageId = messageId;
        }
        if (__DEV__) {
          console.warn('Conversation read sync failed', error);
        }
      } finally {
        state.inFlight = false;
        if (
          activeConversationIdRef.current === conversationId &&
          state.queuedMessageId.trim().length > 0
        ) {
          if (state.flushTimer) {
            clearTimeout(state.flushTimer);
          }
          state.flushTimer = setTimeout(() => {
            state.flushTimer = null;
            flushReadState(conversationId).catch(() => {
              return;
            });
          }, READ_SYNC_DEBOUNCE_MS);
        }
      }
    },
    [clearUnreadLocally],
  );

  const scheduleReadSync = useCallback(
    (conversationId: string) => {
      const state = readSyncRef.current;
      if (state.flushTimer) {
        return;
      }
      state.flushTimer = setTimeout(() => {
        state.flushTimer = null;
        flushReadState(conversationId).catch(() => {
          return;
        });
      }, READ_SYNC_DEBOUNCE_MS);
    },
    [flushReadState],
  );

  const requestReadSync = useCallback(
    (conversationId: string, messageId?: string) => {
      if (!conversationId || conversationId.trim().length === 0) {
        return;
      }
      if (messageId && messageId.trim().length > 0) {
        const normalizedMessageId = messageId.trim();
        readSyncRef.current.queuedMessageId = normalizedMessageId;
      }
      scheduleReadSync(conversationId);
    },
    [scheduleReadSync],
  );

  const loadFirstPage = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent') => {
      const requestID = conversationRequestIDRef.current + 1;
      conversationRequestIDRef.current = requestID;

      if (mode === 'initial') {
        setIsLoading(true);
      } else if (mode === 'refresh') {
        setIsRefreshing(true);
      }
      if (mode !== 'silent') {
        setErrorMessage(null);
      }

      try {
        const response = await fetchConversations({
          limit: CONVERSATION_PAGE_LIMIT,
          requestsOnly: activeFilter === 'requests',
          unreadOnly: activeFilter === 'unread',
        });
        if (requestID !== conversationRequestIDRef.current) {
          return;
        }
        applyFirstPage(response);
        setErrorMessage(null);
      } catch (error) {
        if (requestID !== conversationRequestIDRef.current) {
          return;
        }
        setErrorMessage(
          isApiRequestError(error)
            ? error.message
            : 'Mesajlar şu an yüklenemiyor.',
        );
      } finally {
        if (requestID === conversationRequestIDRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [activeFilter, applyFirstPage],
  );

  const loadMore = useCallback(async () => {
    if (searchQuery.trim().length > 0) {
      return;
    }
    if (isLoading || isRefreshing || isFetchingMore || !hasMore || !nextCursor) {
      return;
    }

    const cursor = nextCursor;
    setIsFetchingMore(true);
    try {
      const response = await fetchConversations({
        cursor,
        limit: CONVERSATION_PAGE_LIMIT,
        requestsOnly: activeFilter === 'requests',
        unreadOnly: activeFilter === 'unread',
      });
      setConversations(previous =>
        mergeConversationLists(previous, response.conversations),
      );
      setHasMore(response.hasMore);
      setNextCursor(response.nextCursor ?? null);
    } catch (error) {
      if (isApiRequestError(error)) {
        setErrorMessage(error.message);
      }
    } finally {
      setIsFetchingMore(false);
    }
  }, [
    activeFilter,
    hasMore,
    isFetchingMore,
    isLoading,
    isRefreshing,
    nextCursor,
    searchQuery,
  ]);

  const loadConversationMessages = useCallback(
    async (conversationId: string, mode: 'initial' | 'refresh' | 'silent') => {
      if (!conversationId || conversationId.trim().length === 0) {
        return;
      }

      const requestID = messageRequestIDRef.current + 1;
      messageRequestIDRef.current = requestID;

      if (mode === 'initial') {
        setMessagesLoading(true);
        messagesContextRef.current = {
          conversationId,
          hasMore: false,
          nextCursor: null,
        };
        startTransition(() => {
          setMessages([]);
        });
        setMessagesHasMore(false);
        setMessagesNextCursor(null);
      } else if (mode === 'refresh') {
        setMessagesRefreshing(true);
      }
      if (mode !== 'silent') {
        setMessagesError(null);
      }

      try {
        const response = await fetchConversationMessages(conversationId, {
          limit: MESSAGE_PAGE_LIMIT,
        });
        if (requestID !== messageRequestIDRef.current) {
          return;
        }
        const existingTimeline =
          messageCacheRef.current.get(conversationId)?.messages ??
          (activeConversationIdRef.current === conversationId
            ? displayedMessagesRef.current
            : []);
        replaceDisplayedMessages(
          conversationId,
          mergeServerMessagesWithLocalState(existingTimeline, response.messages),
          {
            hasMore: response.hasMore,
            nextCursor: response.nextCursor ?? null,
          },
        );
        setMessagesError(null);
        clearUnreadLocally(conversationId, 0);
        if (mode !== 'silent') {
          requestReadSync(conversationId, response.messages[0]?.id);
        }
      } catch (error) {
        if (requestID !== messageRequestIDRef.current) {
          return;
        }
        setMessagesError(
          isApiRequestError(error)
            ? error.message
            : 'Konuşma mesajları şu an yüklenemiyor.',
        );
      } finally {
        if (requestID === messageRequestIDRef.current) {
          setMessagesLoading(false);
          setMessagesRefreshing(false);
        }
      }
    },
    [clearUnreadLocally, requestReadSync, replaceDisplayedMessages],
  );

  const loadMoreMessages = useCallback(async () => {
    const conversationId = activeConversationIdRef.current;
    if (
      !conversationId ||
      conversationId.trim().length === 0 ||
      messagesLoading ||
      messagesRefreshing ||
      messagesFetchingMore ||
      !messagesHasMore ||
      !messagesNextCursor
    ) {
      return;
    }

    const cursor = messagesNextCursor;
    setMessagesFetchingMore(true);
    try {
      const response = await fetchConversationMessages(conversationId, {
        cursor,
        limit: MESSAGE_PAGE_LIMIT,
      });
      if (activeConversationIdRef.current !== conversationId) {
        return;
      }
      startTransition(() => {
        setMessages(previous => {
          const nextMessages = appendMessagePage(previous, response.messages);
          messageCacheRef.current.set(conversationId, {
            hasMore: response.hasMore,
            messages: nextMessages,
            nextCursor: response.nextCursor ?? null,
          });
          messagesContextRef.current = {
            conversationId,
            hasMore: response.hasMore,
            nextCursor: response.nextCursor ?? null,
          };
          return nextMessages;
        });
      });
      setMessagesHasMore(response.hasMore);
      setMessagesNextCursor(response.nextCursor ?? null);
    } catch (error) {
      if (isApiRequestError(error)) {
        setMessagesError(error.message);
      }
    } finally {
      setMessagesFetchingMore(false);
    }
  }, [
    messagesFetchingMore,
    messagesHasMore,
    messagesLoading,
    messagesNextCursor,
    messagesRefreshing,
  ]);

  const queueSilentRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      return;
    }

    if (appStateRef.current !== 'active') {
      return;
    }

    const socket = socketRef.current;
    const isSocketHealthy =
      socketStatusRef.current === 'live' &&
      socket?.readyState === WebSocket.OPEN;
    if (isSocketHealthy && pendingSendQueueRef.current.length === 0) {
      return;
    }

    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      loadFirstPage('silent').catch(() => {
        return;
      });
    }, 260);
  }, [loadFirstPage]);

  const sendVoiceDraft = useCallback(
    async (
      conversationId: string,
      recording: VoiceDraft,
      localMessage?: ConversationMessage,
    ) => {
      if (!conversationId) {
        return false;
      }
      if (isSending || isVoiceUploading) {
        if (localMessage?.id) {
          mutateConversationMessages(conversationId, previous =>
            updateLocalMessageStatus(previous, localMessage.id, 'pending'),
          );
          upsertPendingQueueItem({
            conversationId,
            kind: 'voice',
            localMessage: {
              ...localMessage,
              localStatus: 'pending',
            },
            messageId: localMessage.id,
            updatedAt: new Date().toISOString(),
            voiceDraft: toStoredPendingVoiceDraft(recording),
          });
        }
        queueSilentRefresh();
        setSendError(
          'Sesli mesaj kuyruğa alındı. Bağlantı stabil olduğunda otomatik gönderilecek.',
        );
        return false;
      }

      const normalizedDuration = Math.max(
        VOICE_HOLD_MIN_DURATION_SEC,
        Math.min(
          VOICE_HOLD_MAX_DURATION_SEC,
          Math.floor(Number(recording.durationSec) || VOICE_HOLD_MIN_DURATION_SEC),
        ),
      );

      setIsVoiceUploading(true);
      setSendError(null);
      try {
        const response = await sendConversationVoiceMessage(conversationId, {
          base64: recording.base64,
          clientNonce: localMessage?.clientNonce,
          durationSec: normalizedDuration,
          fileName: recording.fileName,
          mimeType: recording.mimeType,
          waveform: recording.waveform,
        });
        if (localMessage?.id) {
          mutateConversationMessages(conversationId, previous =>
            replaceMessageById(previous, localMessage.id, response.message),
          );
          removePendingQueueItem(localMessage.id);
        }
        if (response.conversation) {
          patchConversation(
            conversationId,
            () => response.conversation as ConversationSummary,
            true,
          );
        } else {
          touchConversationWithMessage(response.message, false);
        }
        return true;
      } catch (error) {
        if (isBlockedRelationshipError(error)) {
          patchConversation(conversationId, item => ({
            ...item,
            isPeerBlockedByViewer: false,
            isViewerBlockedByPeer: true,
          }));
        }
        if (isConnectivityIssue(error)) {
          if (localMessage?.id) {
            mutateConversationMessages(conversationId, previous =>
              updateLocalMessageStatus(previous, localMessage.id, 'pending'),
            );
            upsertPendingQueueItem({
              conversationId,
              kind: 'voice',
              localMessage: {
                ...localMessage,
                localStatus: 'pending',
              },
              messageId: localMessage.id,
              updatedAt: new Date().toISOString(),
              voiceDraft: toStoredPendingVoiceDraft(recording),
            });
          }
        } else {
          if (localMessage?.id) {
            mutateConversationMessages(conversationId, previous =>
              removeMessageById(previous, localMessage.id),
            );
            removePendingQueueItem(localMessage.id);
          }
          queueSilentRefresh();
        }
        setSendError(getSendFailureMessage(error, 'Sesli mesaj şu an gönderilemedi.'));
        return false;
      } finally {
        setIsVoiceUploading(false);
      }
    },
    [
      isSending,
      isVoiceUploading,
      mutateConversationMessages,
      patchConversation,
      queueSilentRefresh,
      removePendingQueueItem,
      touchConversationWithMessage,
      upsertPendingQueueItem,
    ],
  );

  const runRecoverySnapshot = useCallback(
    async (reason: RecoverySnapshotReason) => {
      if (recoverySnapshotInFlightRef.current) {
        return;
      }

      const now = Date.now();
      if (
        reason !== 'queue-hydrated' &&
        now - lastRecoverySnapshotAtRef.current < RECOVERY_SNAPSHOT_COOLDOWN_MS
      ) {
        return;
      }

      recoverySnapshotInFlightRef.current = true;
      lastRecoverySnapshotAtRef.current = now;
      try {
        const currentConversationId = activeConversationIdRef.current;
        const recoveryTasks: Promise<unknown>[] = [loadFirstPage('silent')];
        if (currentConversationId) {
          recoveryTasks.push(
            loadConversationMessages(currentConversationId, 'silent'),
          );
        }
        await Promise.allSettled(recoveryTasks);

        if (currentConversationId) {
          await flushReadState(currentConversationId).catch(() => {
            return;
          });
        }

        if (pendingSendQueueRef.current.length > 0) {
          if (currentConversationId && reason !== 'queue-hydrated') {
            await flushPendingQueueRef.current?.(currentConversationId);
          }
          if (pendingSendQueueRef.current.length > 0) {
            await flushPendingQueueRef.current?.();
          }
        }
      } finally {
        recoverySnapshotInFlightRef.current = false;
      }
    },
    [flushReadState, loadConversationMessages, loadFirstPage],
  );
  runRecoverySnapshotRef.current = runRecoverySnapshot;

  const handleSocketEvent = useCallback(
    (event: MessageRealtimeEvent) => {
      lastSocketActivityAtRef.current = Date.now();
      awaitingSocketHeartbeatAckRef.current = false;
      clearSocketHeartbeatAckTimeout();
      setSocketStatus('live');

      if (event.type === 'heartbeat' || event.type === 'welcome') {
        return;
      }

      const conversationId = event.conversationId ?? event.message?.conversationId;
      if (event.type === 'message.created' && event.message && conversationId) {
        const isActive = activeConversationIdRef.current === conversationId;
        const isFromViewer = event.message.senderId === viewerId;
        const cached = messageCacheRef.current.get(conversationId);
        const localMessageId = isFromViewer
          ? findMatchingLocalOutgoingMessageId(
            cached?.messages ??
            (isActive ? displayedMessagesRef.current : []),
            event.message as ConversationMessage,
          )
          : null;
        messageCacheRef.current.set(conversationId, {
          hasMore: cached?.hasMore ?? false,
          messages: localMessageId
            ? replaceMessageById(
              cached?.messages ?? [],
              localMessageId,
              event.message as ConversationMessage,
            )
            : prependMessage(cached?.messages ?? [], event.message as ConversationMessage),
          nextCursor: cached?.nextCursor ?? null,
        });
        touchConversationWithMessage(event.message, !isActive && !isFromViewer);
        if (isActive) {
          startTransition(() => {
            setMessages(previous => {
              const nextMessages = localMessageId
                ? replaceMessageById(
                  previous,
                  localMessageId,
                  event.message as ConversationMessage,
                )
                : prependMessage(previous, event.message as ConversationMessage);
              messageCacheRef.current.set(conversationId, {
                hasMore: messagesContextRef.current.hasMore,
                messages: nextMessages,
                nextCursor: messagesContextRef.current.nextCursor,
              });
              messagesContextRef.current = {
                conversationId,
                hasMore: messagesContextRef.current.hasMore,
                nextCursor: messagesContextRef.current.nextCursor,
              };
              return nextMessages;
            });
          });
          setMessagesError(null);
          if (!isFromViewer) {
            setPeerTyping(false);
            requestReadSync(conversationId, event.message.id);
          }
        }
        queueSilentRefresh();
        return;
      }

      if (event.type === 'message.read' && conversationId) {
        if (event.fromUserId === viewerId) {
          clearUnreadLocally(conversationId, Number(event.unreadCount ?? 0));
          return;
        }

        if (activeConversationIdRef.current === conversationId) {
          setPeerLastReadAt(event.lastReadAt ?? null);
          setPeerLastReadMessageId(event.messageId ?? null);
        }
        queueSilentRefresh();
        return;
      }

      if (
        (event.type === 'message_request.created' ||
          event.type === 'message_request.resolved' ||
          event.type === 'message_request.cancelled') &&
        conversationId
      ) {
        const eventId = String(event.eventId || '').trim();
        if (eventId) {
          if (messageRequestEventIdsRef.current.has(eventId)) {
            return;
          }
          messageRequestEventIdsRef.current.add(eventId);
          while (
            messageRequestEventIdsRef.current.size >
            MESSAGE_REQUEST_EVENT_ID_CACHE_LIMIT
          ) {
            const oldest = messageRequestEventIdsRef.current.values().next().value;
            if (typeof oldest !== 'string') {
              break;
            }
            messageRequestEventIdsRef.current.delete(oldest);
          }
        }
        const hasConversation = conversationsRef.current.some(
          item => item.conversationId === conversationId,
        );
        const isRequester = event.fromUserId === viewerId;
        if (hasConversation) {
          patchConversation(conversationId, item => {
            if (event.type === 'message_request.created') {
              return {
                ...item,
                chatRequestDirection: isRequester ? 'outgoing' : 'incoming',
                chatRequestStatus: 'pending',
                isMessageRequest: true,
                messagingMode: isRequester
                  ? 'request_pending_outgoing'
                  : 'request_pending_incoming',
              };
            }
            if (event.type === 'message_request.resolved') {
              return {
                ...item,
                chatRequestDirection: 'none',
                chatRequestStatus: 'accepted',
                isMessageRequest: false,
                messagingMode: 'direct',
              };
            }
            return {
              ...item,
              chatRequestDirection: 'none',
              chatRequestStatus: event.requestReason === 'removed' ? 'none' : 'rejected',
              isMessageRequest: false,
              messagingMode:
                event.requestReason === 'removed' ? 'direct' : 'request_rejected',
            };
          });
        } else if (typeof event.requestDelta === 'number' && event.requestDelta !== 0) {
          setMessageRequestRealtimeDelta(previous => {
            const minDelta = -lastMessageRequestsBaseCountRef.current;
            return Math.max(minDelta, previous + Math.trunc(event.requestDelta ?? 0));
          });
        }
        return;
      }

      if (event.type === 'message.request.updated' && conversationId) {
        const normalizedStatus = String(event.status || '').trim().toLowerCase();
        if (normalizedStatus === 'accepted' || normalizedStatus === 'rejected') {
          patchConversation(conversationId, item => ({
            ...item,
            chatRequestDirection: 'none',
            chatRequestStatus: normalizedStatus === 'accepted' ? 'accepted' : 'rejected',
            isMessageRequest: false,
            messagingMode:
              normalizedStatus === 'accepted' ? 'direct' : 'request_rejected',
          }));
        } else if (normalizedStatus === 'pending') {
          patchConversation(conversationId, item => {
            const isRequester = event.fromUserId === viewerId;
            return {
              ...item,
              chatRequestDirection: isRequester ? 'outgoing' : 'incoming',
              chatRequestStatus: 'pending',
              isMessageRequest: true,
              messagingMode: isRequester
                ? 'request_pending_outgoing'
                : 'request_pending_incoming',
            };
          });
        }
        return;
      }

      if (
        (event.type === 'relationship.blocked' ||
          event.type === 'relationship.unblocked') &&
        event.fromUserId &&
        event.peerUserId
      ) {
        const blocked = event.type === 'relationship.blocked';
        const actorUserId = event.fromUserId.trim();
        const peerUserId = event.peerUserId.trim();
        if (!actorUserId || !peerUserId) {
          return;
        }

        if (actorUserId === viewerId) {
          patchPeerConversations(peerUserId, item => ({
            ...item,
            isPeerBlockedByViewer: blocked,
          }));
        } else if (peerUserId === viewerId) {
          patchPeerConversations(actorUserId, item => ({
            ...item,
            isViewerBlockedByPeer: blocked,
          }));
        }
        setPeerTyping(false);
        return;
      }

      if (
        event.type === 'typing' &&
        conversationId &&
        activeConversationIdRef.current === conversationId &&
        event.fromUserId !== viewerId
      ) {
        setPeerTyping(Boolean(event.isTyping));
      }
    },
    [
      clearSocketHeartbeatAckTimeout,
      clearUnreadLocally,
      patchPeerConversations,
      queueSilentRefresh,
      requestReadSync,
      setSocketStatus,
      touchConversationWithMessage,
      viewerId,
    ],
  );

  useEffect(() => {
    loadFirstPage('initial').catch(() => {
      return;
    });
  }, [loadFirstPage]);

  useEffect(() => {
    const interval = setInterval(() => {
      const socket = socketRef.current;
      const isSocketHealthy =
        socketStatusRef.current === 'live' &&
        socket?.readyState === WebSocket.OPEN;
      if (isSocketHealthy && pendingSendQueueRef.current.length === 0) {
        return;
      }
      queueSilentRefresh();
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [queueSilentRefresh]);

  const sendSocketHeartbeat = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (awaitingSocketHeartbeatAckRef.current) {
      return;
    }

    awaitingSocketHeartbeatAckRef.current = true;
    try {
      socket.send(
        JSON.stringify({
          type: 'heartbeat',
        }),
      );
    } catch {
      awaitingSocketHeartbeatAckRef.current = false;
      clearSocketHeartbeatAckTimeout();
      if (socket.readyState !== WebSocket.CLOSED) {
        socket.close();
      }
      return;
    }

    clearSocketHeartbeatAckTimeout();
    socketHeartbeatAckTimeoutRef.current = setTimeout(() => {
      socketHeartbeatAckTimeoutRef.current = null;
      if (socketRef.current !== socket || socket.readyState !== WebSocket.OPEN) {
        awaitingSocketHeartbeatAckRef.current = false;
        return;
      }
      awaitingSocketHeartbeatAckRef.current = false;
      setSocketStatus('offline');
      socket.close();
    }, SOCKET_HEARTBEAT_ACK_TIMEOUT_MS);
  }, [clearSocketHeartbeatAckTimeout]);

  const scheduleSocketHeartbeatHealthCheck = useCallback(() => {
    clearSocketHeartbeatCheckTimer();
    socketHeartbeatCheckTimerRef.current = setTimeout(() => {
      socketHeartbeatCheckTimerRef.current = null;
      if (appStateRef.current !== 'active') {
        scheduleSocketHeartbeatHealthCheck();
        return;
      }

      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        scheduleSocketHeartbeatHealthCheck();
        return;
      }

      const idleDurationMs = Date.now() - lastSocketActivityAtRef.current;
      if (idleDurationMs >= SOCKET_HEARTBEAT_IDLE_MS) {
        sendSocketHeartbeat();
      }
      scheduleSocketHeartbeatHealthCheck();
    }, SOCKET_HEARTBEAT_CHECK_INTERVAL_MS);
  }, [clearSocketHeartbeatCheckTimer, sendSocketHeartbeat]);

  useEffect(() => {
    let active = true;

    const connect = () => {
      if (!active || appStateRef.current !== 'active') {
        return;
      }

      clearSocketReconnectTimer();
      clearSocketConnectTimeout();
      clearSocketHeartbeatAckTimeout();
      clearSocketHeartbeatCheckTimer();
      if (socketRef.current && socketRef.current.readyState !== WebSocket.CLOSED) {
        try {
          socketRef.current.close();
        } catch {
          socketRef.current = null;
        }
      }

      setSocketStatus('connecting');
      const socket = createMessagesSocket({
        onMessage: handleSocketEvent,
      });
      socketRef.current = socket;
      awaitingSocketHeartbeatAckRef.current = false;
      socketConnectTimeoutRef.current = setTimeout(() => {
        if (!active || socketRef.current !== socket || socket.readyState === WebSocket.OPEN) {
          return;
        }
        try {
          socket.close();
        } catch {
          return;
        }
      }, SOCKET_CONNECTING_STALE_MS);

      socket.onopen = () => {
        if (!active || socketRef.current !== socket) {
          return;
        }
        clearSocketConnectTimeout();
        clearSocketReconnectTimer();
        clearSocketOfflineBannerTimer();
        socketReconnectAttemptRef.current = 0;
        setSocketReconnectAttemptCount(0);
        awaitingSocketHeartbeatAckRef.current = false;
        lastSocketActivityAtRef.current = Date.now();
        setSocketStatus('live');
        scheduleSocketHeartbeatHealthCheck();
        ignorePromise(runRecoverySnapshot('socket-open'));
      };

      socket.onclose = () => {
        const isCurrentSocket = socketRef.current === socket;
        if (isCurrentSocket) {
          socketRef.current = null;
        }
        clearSocketConnectTimeout();
        clearSocketHeartbeatAckTimeout();
        clearSocketHeartbeatCheckTimer();
        awaitingSocketHeartbeatAckRef.current = false;
        if (!active || !isCurrentSocket) {
          return;
        }
        setSocketStatus('offline');
        if (appStateRef.current !== 'active') {
          return;
        }

        const nextAttempt = socketReconnectAttemptRef.current + 1;
        socketReconnectAttemptRef.current = nextAttempt;
        setSocketReconnectAttemptCount(nextAttempt);
        const reconnectDelay = getSocketReconnectDelayMs(nextAttempt);
        clearSocketReconnectTimer();
        socketReconnectTimerRef.current = setTimeout(() => {
          socketReconnectTimerRef.current = null;
          connect();
        }, reconnectDelay);
      };

      socket.onerror = () => {
        if (socket.readyState !== WebSocket.CLOSED) {
          socket.close();
        }
      };
    };

    connectSocketRef.current = connect;
    connect();

    const appStateSubscription = AppState.addEventListener('change', nextState => {
      const wasActive = appStateRef.current === 'active';
      appStateRef.current = nextState;
      if (nextState === 'active') {
        socketReconnectAttemptRef.current = 0;
        setSocketReconnectAttemptCount(0);
        lastSocketActivityAtRef.current = Date.now();
        scheduleSocketHeartbeatHealthCheck();
        ignorePromise(runRecoverySnapshot('app-active'));
        if (!socketRef.current || socketRef.current.readyState === WebSocket.CLOSED) {
          connect();
        }
        return;
      }

      if (wasActive) {
        clearSocketReconnectTimer();
        clearSocketConnectTimeout();
        clearSocketHeartbeatAckTimeout();
        clearSocketHeartbeatCheckTimer();
        clearSocketOfflineBannerTimer();
        awaitingSocketHeartbeatAckRef.current = false;
        if (socketRef.current) {
          socketRef.current.close();
          socketRef.current = null;
        }
        setSocketStatus('offline');
        setSocketReconnectAttemptCount(0);
      }
    });
    const appFocusSubscription = AppState.addEventListener('focus', () => {
      if (!active) {
        return;
      }
      // Extra focus-time invalidation for immediate UI consistency
      // when returning from external/system surfaces.
      ignorePromise(runRecoverySnapshot('app-active'));
    });

    return () => {
      active = false;
      connectSocketRef.current = null;
      appStateSubscription.remove();
      appFocusSubscription.remove();
      clearSocketReconnectTimer();
      clearSocketConnectTimeout();
      clearSocketHeartbeatAckTimeout();
      clearSocketHeartbeatCheckTimer();
      clearSocketOfflineBannerTimer();
      awaitingSocketHeartbeatAckRef.current = false;
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [
    clearSocketOfflineBannerTimer,
    clearSocketConnectTimeout,
    clearSocketHeartbeatAckTimeout,
    clearSocketHeartbeatCheckTimer,
    clearSocketReconnectTimer,
    flushReadState,
    handleSocketEvent,
    loadConversationMessages,
    queueSilentRefresh,
    runRecoverySnapshot,
    scheduleSocketHeartbeatHealthCheck,
    viewerId,
  ]);

  useEffect(() => {
    const conversationId = activeConversationId;
    setComposerText('');
    setPhotoPreviewState(null);
    setSendError(null);
    setIsVoiceUploading(false);
    resetRecordingState(0);
    voicePressActiveRef.current = false;
    voicePressHandledRef.current = false;
    ignorePromise(cancelActiveVoiceRecording());
    ignorePromise(stopPlayback());
    setIsHeaderMenuOpen(false);
    setHeaderMenuPendingAction('none');
    closeAttachmentMenu();
    setPeerTyping(false);
    setPeerLastReadAt(null);
    setPeerLastReadMessageId(null);
    clearTypingTimer();
    stopLocalTyping();
    readSyncRef.current.queuedMessageId = '';
    readSyncRef.current.lastSyncedMessageId = '';
    readSyncRef.current.lastSyncedAtMs = 0;
    clearReadSyncTimer();
    detailScrollToLatestVisibleRef.current = false;
    setShowDetailScrollToLatest(false);
    detailInitialSnapConversationIdRef.current = conversationId;

    if (!conversationId) {
      detailInitialSnapConversationIdRef.current = null;
      return;
    }

    clearUnreadLocally(conversationId, 0);
    const cached = messageCacheRef.current.get(conversationId);
    if (cached) {
      replaceDisplayedMessages(conversationId, cached.messages, {
        hasMore: cached.hasMore,
        nextCursor: cached.nextCursor,
      });
      setMessagesError(null);
      requestReadSync(conversationId, cached.messages[0]?.id);
      loadConversationMessages(conversationId, 'silent').catch(() => {
        return;
      });
      return;
    }

    loadConversationMessages(conversationId, 'initial').catch(() => {
      return;
    });
  }, [
    activeConversationId,
    closeAttachmentMenu,
    clearReadSyncTimer,
    clearTypingTimer,
    clearUnreadLocally,
    loadConversationMessages,
    replaceDisplayedMessages,
    requestReadSync,
    cancelActiveVoiceRecording,
    resetRecordingState,
    stopLocalTyping,
    stopPlayback,
  ]);

  useEffect(() => {
    const conversationId = activeConversationId;
    if (!conversationId) {
      return;
    }
    if (detailInitialSnapConversationIdRef.current !== conversationId) {
      return;
    }
    const timer = setTimeout(() => {
      if (detailInitialSnapConversationIdRef.current !== conversationId) {
        return;
      }
      scrollDetailToLatest(false);
      detailInitialSnapConversationIdRef.current = null;
    }, DETAIL_SCROLL_TO_LATEST_SNAP_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [activeConversationId, messages.length, scrollDetailToLatest]);

  useEffect(() => {
    if (!activeConversation || peerTyping) {
      return;
    }
    setPeerLastReadAt(activeConversation.peerLastReadAt ?? null);
    setPeerLastReadMessageId(activeConversation.peerLastReadMessageId ?? null);
  }, [
    activeConversation,
    peerTyping,
  ]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      clearSocketOfflineBannerTimer();
      voicePressActiveRef.current = false;
      voicePressHandledRef.current = false;
      resetRecordingState(0);
      ignorePromise(cancelActiveVoiceRecording());
      ignorePromise(stopPlayback());
      clearTypingTimer();
      stopLocalTyping();
      clearReadSyncTimer();
    };
  }, [
    cancelActiveVoiceRecording,
    clearSocketOfflineBannerTimer,
    clearReadSyncTimer,
    clearTypingTimer,
    resetRecordingState,
    stopLocalTyping,
    stopPlayback,
  ]);

  const handleComposerChange = useCallback(
    (value: string) => {
      setComposerText(value);
      setSendError(null);

      const conversationId = activeConversationIdRef.current;
      if (!conversationId || isConversationInteractionLocked) {
        clearTypingTimer();
        stopLocalTyping(conversationId);
        return;
      }

      const hasText = value.trim().length > 0;
      if (!hasText) {
        clearTypingTimer();
        stopLocalTyping(conversationId);
        return;
      }

      if (localTypingConversationIdRef.current !== conversationId) {
        if (localTypingConversationIdRef.current) {
          stopLocalTyping(localTypingConversationIdRef.current);
        }
        emitTyping(conversationId, true);
        localTypingConversationIdRef.current = conversationId;
      }

      clearTypingTimer();
      typingStopTimerRef.current = setTimeout(() => {
        typingStopTimerRef.current = null;
        stopLocalTyping(conversationId);
      }, TYPING_IDLE_TIMEOUT_MS);
    },
    [
      clearTypingTimer,
      emitTyping,
      isConversationInteractionLocked,
      stopLocalTyping,
    ],
  );

  const sendRawMessage = useCallback(
    async (rawText: string, clearComposer = false) => {
      const conversationId = activeConversationIdRef.current;
      const trimmed = rawText.trim();
      if (
        !conversationId ||
        trimmed.length === 0 ||
        isSending ||
        isConversationInteractionLocked
      ) {
        if (isConversationInteractionLocked) {
          setSendError(conversationLockMessage);
        }
        return;
      }

      const localMessage = createLocalTextMessage(conversationId, trimmed);
      mutateConversationMessages(conversationId, previous =>
        prependMessage(previous, localMessage),
      );
      touchConversationWithMessage(localMessage, false);
      setIsSending(true);
      setSendError(null);
      clearTypingTimer();
      stopLocalTyping(conversationId);

      try {
        const response = await sendConversationMessage(conversationId, trimmed, {
          clientNonce: localMessage.clientNonce,
        });
        mutateConversationMessages(conversationId, previous =>
          replaceMessageById(previous, localMessage.id, response.message),
        );
        removePendingQueueItem(localMessage.id);
        if (activeConversationIdRef.current === conversationId) {
          setMessagesError(null);
        }
        if (response.conversation) {
          patchConversation(
            conversationId,
            () => response.conversation as ConversationSummary,
            true,
          );
        } else {
          touchConversationWithMessage(response.message, false);
        }
        queueSilentRefresh();
        if (clearComposer) {
          clearComposerIfMatches(trimmed);
        }
      } catch (error) {
        if (isBlockedRelationshipError(error)) {
          patchConversation(conversationId, item => ({
            ...item,
            isPeerBlockedByViewer: false,
            isViewerBlockedByPeer: true,
          }));
        }
        if (isConnectivityIssue(error)) {
          mutateConversationMessages(conversationId, previous =>
            updateLocalMessageStatus(previous, localMessage.id, 'pending'),
          );
          upsertPendingQueueItem({
            conversationId,
            kind: 'text',
            localMessage: {
              ...localMessage,
              localStatus: 'pending',
            },
            messageId: localMessage.id,
            text: trimmed,
            updatedAt: new Date().toISOString(),
          });
        } else {
          mutateConversationMessages(conversationId, previous =>
            removeMessageById(previous, localMessage.id),
          );
          removePendingQueueItem(localMessage.id);
          queueSilentRefresh();
        }
        setSendError(getSendFailureMessage(error, 'Mesaj gönderilemedi.'));
      } finally {
        setIsSending(false);
      }
    },
    [
      clearComposerIfMatches,
      clearTypingTimer,
      createLocalTextMessage,
      conversationLockMessage,
      isConversationInteractionLocked,
      isSending,
      mutateConversationMessages,
      patchConversation,
      removePendingQueueItem,
      queueSilentRefresh,
      stopLocalTyping,
      touchConversationWithMessage,
      upsertPendingQueueItem,
    ],
  );

  const flushPendingQueueItem = useCallback(
    async (pending: PendingSendQueueItem) => {
      setSendError(null);
      if (pending.kind === 'text') {
        mutateConversationMessages(pending.conversationId, previous =>
          updateLocalMessageStatus(previous, pending.messageId, 'sending'),
        );
        updatePendingQueueItem(pending.messageId, item => ({
          ...item,
          localMessage: {
            ...item.localMessage,
            localStatus: 'sending',
          },
          updatedAt: new Date().toISOString(),
        }));
        setIsSending(true);
        clearTypingTimer();
        stopLocalTyping(pending.conversationId);
        try {
          const response = await sendConversationMessage(
            pending.conversationId,
            pending.text ?? pending.localMessage.body,
            {
              clientNonce: pending.localMessage.clientNonce,
            },
          );
          mutateConversationMessages(pending.conversationId, previous =>
            replaceMessageById(previous, pending.messageId, response.message),
          );
          removePendingQueueItem(pending.messageId);
          if (activeConversationIdRef.current === pending.conversationId) {
            setMessagesError(null);
          }
          if (response.conversation) {
            patchConversation(
              pending.conversationId,
              () => response.conversation as ConversationSummary,
              true,
            );
          } else {
            touchConversationWithMessage(response.message, false);
          }
          queueSilentRefresh();
          clearComposerIfMatches(pending.text ?? pending.localMessage.body);
          return true;
        } catch (error) {
          if (isBlockedRelationshipError(error)) {
            patchConversation(pending.conversationId, item => ({
              ...item,
              isPeerBlockedByViewer: false,
              isViewerBlockedByPeer: true,
            }));
          }
          setSendError(getSendFailureMessage(error, 'Mesaj gönderilemedi.'));
          if (!isConnectivityIssue(error)) {
            mutateConversationMessages(pending.conversationId, previous =>
              removeMessageById(previous, pending.messageId),
            );
            removePendingQueueItem(pending.messageId);
            queueSilentRefresh();
            return false;
          }
          mutateConversationMessages(pending.conversationId, previous =>
            updateLocalMessageStatus(previous, pending.messageId, 'pending'),
          );
          updatePendingQueueItem(pending.messageId, item => ({
            ...item,
            localMessage: {
              ...item.localMessage,
              localStatus: 'pending',
            },
            updatedAt: new Date().toISOString(),
          }));
          return false;
        } finally {
          setIsSending(false);
        }
      }

      mutateConversationMessages(pending.conversationId, previous =>
        updateLocalMessageStatus(previous, pending.messageId, 'sending'),
      );
      updatePendingQueueItem(pending.messageId, item => ({
        ...item,
        localMessage: {
          ...item.localMessage,
          localStatus: 'sending',
        },
        updatedAt: new Date().toISOString(),
      }));
      if (!pending.voiceDraft) {
        removePendingQueueItem(pending.messageId);
        mutateConversationMessages(pending.conversationId, previous =>
          removeMessageById(previous, pending.messageId),
        );
        return false;
      }
      return sendVoiceDraft(
        pending.conversationId,
        fromStoredPendingVoiceDraft(pending.voiceDraft),
        pending.localMessage,
      );
    },
    [
      clearComposerIfMatches,
      clearTypingTimer,
      mutateConversationMessages,
      patchConversation,
      queueSilentRefresh,
      removePendingQueueItem,
      sendVoiceDraft,
      stopLocalTyping,
      touchConversationWithMessage,
      updatePendingQueueItem,
    ],
  );

  const flushPendingQueue = useCallback(
    async (conversationId?: string | null) => {
      if (pendingQueueFlushInFlightRef.current) {
        return;
      }
      pendingQueueFlushInFlightRef.current = true;
      try {
        const targets = pendingSendQueueRef.current
          .filter(item =>
            conversationId ? item.conversationId === conversationId : true,
          )
          .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));

        for (const item of targets) {
          const stillQueued = pendingSendQueueRef.current.some(
            queued => queued.messageId === item.messageId,
          );
          if (!stillQueued) {
            continue;
          }
          await flushPendingQueueItem(item);
        }
      } finally {
        pendingQueueFlushInFlightRef.current = false;
      }
    },
    [flushPendingQueueItem],
  );
  flushPendingQueueRef.current = flushPendingQueue;

  async function retryPendingSend() {
    const pending =
      pendingSendQueueRef.current.find(
        item => item.conversationId === activeConversationIdRef.current,
      ) ?? pendingSendQueueRef.current[0];
    if (!pending || isSending || isVoiceUploading) {
      return;
    }
    await flushPendingQueue(pending.conversationId);
  }

  const handleSend = useCallback(async () => {
    const trimmed = composerText.trim();
    if (trimmed.length === 0) {
      return;
    }
    await sendRawMessage(trimmed, true);
  }, [composerText, sendRawMessage]);

  const handlePickGalleryPhoto = useCallback(async () => {
    if (isConversationInteractionLocked) {
      setSendError(conversationLockMessage);
      closeAttachmentMenu();
      return;
    }

    closeAttachmentMenu();
    setSendError(null);
    try {
      const selected = await pickGalleryMedia('photo');
      if (!selected) {
        return;
      }

      const normalizedFileName =
        typeof selected.fileName === 'string' ? selected.fileName.trim() : '';
      const normalizedMimeType =
        typeof selected.mimeType === 'string'
          ? selected.mimeType.trim().toLowerCase()
          : '';
      const normalizedMediaUrl =
        typeof selected.mediaUrl === 'string' ? selected.mediaUrl.trim() : '';
      if (!normalizedMediaUrl) {
        return;
      }

      const payload: OutboundRichMessagePayload = {
        kind: 'photo',
        mimeType: normalizedMimeType || undefined,
        sizeBytes:
          Number.isFinite(selected.sizeBytes) && Number(selected.sizeBytes) > 0
            ? Number(selected.sizeBytes)
            : undefined,
        title:
          normalizedFileName.length > 0
            ? `Galeri: ${normalizedFileName}`
            : 'Galeriden fotograf paylasildi',
        url: normalizedMediaUrl,
      };
      await sendRawMessage(encodeRichMessagePayload(payload), false);
    } catch (error) {
      setSendError(getSendFailureMessage(error, 'Galeri seçimi şu an tamamlanamadı.'));
    }
  }, [
    closeAttachmentMenu,
    conversationLockMessage,
    isConversationInteractionLocked,
    sendRawMessage,
  ]);

  const handleOpenCameraPicker = useCallback(() => {
    if (isConversationInteractionLocked) {
      setSendError(conversationLockMessage);
      closeAttachmentMenu();
      return;
    }
    closeAttachmentMenu();
    setSendError(null);
    setIsAttachmentCameraVisible(true);
  }, [closeAttachmentMenu, conversationLockMessage, isConversationInteractionLocked]);

  const handleAttachmentCameraCapture = useCallback(
    async (payload: {
      capturedAt: string;
      mediaType: 'photo' | 'video';
      mediaUrl: string;
      source?: 'camera' | 'gallery';
      thumbnailUrl?: string;
    }) => {
      if (payload.mediaType !== 'photo') {
        setSendError('Bu alanda sadece fotograf destekleniyor.');
        return;
      }

      const normalizedMediaUrl = String(payload.mediaUrl ?? '').trim();
      if (!normalizedMediaUrl) {
        return;
      }

      setIsAttachmentCameraVisible(false);
      setSendError(null);
      try {
        const richPayload: OutboundRichMessagePayload = {
          kind: 'photo',
          title: 'Kameradan fotograf paylasildi',
          url: normalizedMediaUrl,
        };
        await sendRawMessage(encodeRichMessagePayload(richPayload), false);
      } catch (error) {
        setSendError(getSendFailureMessage(error, 'Kamera fotoğrafı gönderilemedi.'));
      }
    },
    [sendRawMessage],
  );

  const handleSelectNewConversationRecipient = useCallback(
    (user: ExploreSearchUser) => {
      setNewConversationRecipient(current =>
        current?.id === user.id ? null : user,
      );
      setNewConversationError(null);
    },
    [],
  );

  const handleCreateConversation = useCallback(async () => {
    const recipient = newConversationRecipient;
    if (!recipient || newConversationCreating) {
      return;
    }

    const initialMessage = newConversationInitialMessage.trim();
    setNewConversationCreating(true);
    setNewConversationError(null);

    try {
      const response = await createConversation({
        initialMessage,
        recipientId: recipient.id,
      });

      const fallbackConversation =
        response.conversation ??
        buildConversationSummaryFromUser(
          recipient,
          response.conversationId,
          response.message?.body ?? initialMessage,
        );
      if (response.message) {
        messageCacheRef.current.set(response.conversationId, {
          hasMore: false,
          messages: [response.message],
          nextCursor: null,
        });
      }
      if (activeFilter === 'all') {
        setConversations(previous => [
          fallbackConversation,
          ...previous.filter(
            item => item.conversationId !== fallbackConversation.conversationId,
          ),
        ]);
      }
      setActiveConversation(fallbackConversation);
      closeNewConversationPanel();
      queueSilentRefresh();
    } catch (error) {
      if (isApiRequestError(error)) {
        if (error.status === 404 || isBlockedRelationshipError(error)) {
          setNewConversationError(HIDDEN_USER_NOT_FOUND_LABEL);
        } else {
          setNewConversationError(error.message);
        }
      } else {
        setNewConversationError('Konuşma şu an oluşturulamıyor.');
      }
    } finally {
      setNewConversationCreating(false);
    }
  }, [
    activeFilter,
    closeNewConversationPanel,
    newConversationCreating,
    newConversationInitialMessage,
    newConversationRecipient,
    queueSilentRefresh,
  ]);

  useEffect(() => {
    if (!prefillRecipient) {
      return;
    }
    const normalizedRecipientId = prefillRecipient.id.trim();
    if (!normalizedRecipientId) {
      onPrefillRecipientConsumed?.();
      return;
    }
    if (prefillRecipientInFlightRef.current === normalizedRecipientId) {
      return;
    }

    prefillRecipientInFlightRef.current = normalizedRecipientId;
    let cancelled = false;

    const openDirectConversation = async () => {
      setErrorMessage(null);
      try {
        const response = await createConversation({
          recipientId: normalizedRecipientId,
        });
        if (cancelled) {
          return;
        }
        const fallbackConversation =
          response.conversation ??
          buildConversationSummaryFromUser(
            prefillRecipient,
            response.conversationId,
            response.message?.body ?? '',
          );
        if (response.message) {
          messageCacheRef.current.set(response.conversationId, {
            hasMore: false,
            messages: [response.message],
            nextCursor: null,
          });
        }
        if (activeFilter === 'all') {
          setConversations(previous => [
            fallbackConversation,
            ...previous.filter(
              item => item.conversationId !== fallbackConversation.conversationId,
            ),
          ]);
        }
        setActiveConversation(fallbackConversation);
        closeNewConversationPanel();
        queueSilentRefresh();
      } catch (error) {
        if (cancelled) {
          return;
        }
        setErrorMessage(resolveConversationAccessError(error, 'Sohbet acilamadi.'));
      } finally {
        if (prefillRecipientInFlightRef.current === normalizedRecipientId) {
          prefillRecipientInFlightRef.current = null;
        }
        if (!cancelled) {
          onPrefillRecipientConsumed?.();
        }
      }
    };

    openDirectConversation().catch(() => {
      return;
    });

    return () => {
      cancelled = true;
      if (prefillRecipientInFlightRef.current === normalizedRecipientId) {
        prefillRecipientInFlightRef.current = null;
      }
    };
  }, [
    activeFilter,
    closeNewConversationPanel,
    onPrefillRecipientConsumed,
    prefillRecipient,
    queueSilentRefresh,
  ]);

  const openConversation = useCallback(
    (item: ConversationSummary) => {
      if (isNewConversationOpen) {
        closeNewConversationPanel();
      }
      if (activeConversationIdRef.current === item.conversationId) {
        return;
      }
      const cached = messageCacheRef.current.get(item.conversationId);
      if (cached) {
        replaceDisplayedMessages(item.conversationId, cached.messages, {
          hasMore: cached.hasMore,
          nextCursor: cached.nextCursor,
        });
      }
      setActiveConversation(item);
    },
    [closeNewConversationPanel, isNewConversationOpen, replaceDisplayedMessages],
  );

  const handleOpenSearchUserConversation = useCallback(
    async (user: ExploreSearchUser) => {
      const normalizedUserId = user.id.trim();
      if (!normalizedUserId || searchUserActionPendingId === normalizedUserId) {
        return;
      }

      const existingConversation = conversations.find(
        item => item.peer.id.trim() === normalizedUserId,
      );
      if (existingConversation) {
        setIsSearchOpen(false);
        openConversation(existingConversation);
        return;
      }

      setSearchUserActionPendingId(normalizedUserId);
      setSearchUsersError(null);
      setErrorMessage(null);

      try {
        const response = await createConversation({
          recipientId: normalizedUserId,
        });

        const fallbackConversation =
          response.conversation ??
          buildConversationSummaryFromUser(
            user,
            response.conversationId,
            response.message?.body ?? '',
          );

        if (response.message) {
          messageCacheRef.current.set(response.conversationId, {
            hasMore: false,
            messages: [response.message],
            nextCursor: null,
          });
        }

        if (activeFilter === 'all') {
          setConversations(previous => [
            fallbackConversation,
            ...previous.filter(
              item => item.conversationId !== fallbackConversation.conversationId,
            ),
          ]);
        }

        setIsSearchOpen(false);
        setActiveConversation(fallbackConversation);
        queueSilentRefresh();
      } catch (error) {
        setSearchUsersError(
          resolveConversationAccessError(error, 'Sohbet olusturulamadi.'),
        );
      } finally {
        setSearchUserActionPendingId(current =>
          current === normalizedUserId ? null : current,
        );
      }
    },
    [
      activeFilter,
      conversations,
      openConversation,
      queueSilentRefresh,
      searchUserActionPendingId,
    ],
  );

  const closeConversation = useCallback(() => {
    clearTypingTimer();
    stopLocalTyping(activeConversationIdRef.current);
    voicePressActiveRef.current = false;
    voicePressHandledRef.current = false;
    setPhotoPreviewState(null);
    setIsVoiceUploading(false);
    resetRecordingState(0);
    ignorePromise(cancelActiveVoiceRecording());
    ignorePromise(stopPlayback());
    setIsHeaderMenuOpen(false);
    closeAttachmentMenu();
    setActiveConversation(null);
    clearDisplayedMessages();
    setMessagesError(null);
    setMessagesLoading(false);
    setMessagesRefreshing(false);
    setMessagesFetchingMore(false);
    setComposerText('');
    setSendError(null);
    setMessageRequestActionPending('none');
    setMessageRequestActionConversationId(null);
    setPeerTyping(false);
    setPeerLastReadAt(null);
    setPeerLastReadMessageId(null);
  }, [
    cancelActiveVoiceRecording,
    clearTypingTimer,
    clearDisplayedMessages,
    closeAttachmentMenu,
    resetRecordingState,
    stopLocalTyping,
    stopPlayback,
  ]);

  const applyAfterViewerBlockedPeerFromHeader = useCallback(
    (peerId: string, conversationId: string) => {
      const normalizedPeerId = peerId.trim();
      const removedConversationIds = conversationsRef.current
        .filter(item => item.peer.id.trim() === normalizedPeerId)
        .map(item => item.conversationId);
      if (removedConversationIds.length > 0) {
        setConversations(previous =>
          previous.filter(item => item.peer.id.trim() !== normalizedPeerId),
        );
        removedConversationIds.forEach(id => {
          const normalizedId = id.trim();
          if (normalizedId.length > 0) {
            messageCacheRef.current.delete(normalizedId);
          }
        });
        if (activeConversation?.peer.id.trim() === normalizedPeerId) {
          closeConversation();
        }
      } else {
        patchConversation(conversationId, item => ({
          ...item,
          isPeerBlockedByViewer: true,
        }));
      }
      queueSilentRefresh();
    },
    [
      activeConversation,
      closeConversation,
      patchConversation,
      queueSilentRefresh,
    ],
  );

  const isMessageRequestActionBusy = messageRequestActionPending !== 'none';

  const handleAcceptMessageRequest = useCallback((conversation: ConversationSummary) => {
    if (isMessageRequestActionBusy) {
      return;
    }

    const conversationId = conversation.conversationId;
    if (!conversationId) {
      return;
    }

    setMessageRequestActionPending('accept');
    setMessageRequestActionConversationId(conversationId);
    setSendError(null);
    acceptConversationRequest(conversationId)
      .then(response => {
        if (response.conversation) {
          patchConversation(
            conversationId,
            () => response.conversation as ConversationSummary,
          );
        } else {
          patchConversation(conversationId, item => ({
            ...item,
            canSendMessage: true,
            chatRequestDirection: 'none',
            chatRequestStatus: 'accepted',
            isMessageRequest: false,
            messagingHint: '',
            messagingMode: 'direct',
          }));
        }
        if (activeFilter === 'requests') {
          setConversations(previous =>
            previous.filter(item => item.conversationId !== conversationId),
          );
        }
        queueSilentRefresh();
      })
      .catch(error => {
        setSendError(
          isApiRequestError(error)
            ? error.message
            : 'Mesaj isteği kabul edilemedi.',
        );
      })
      .finally(() => {
        setMessageRequestActionPending('none');
        setMessageRequestActionConversationId(null);
      });
  }, [
    activeFilter,
    isMessageRequestActionBusy,
    patchConversation,
    queueSilentRefresh,
  ]);

  const handleAcceptActiveMessageRequest = useCallback(() => {
    if (!activeConversation) {
      return;
    }
    handleAcceptMessageRequest(activeConversation);
  }, [activeConversation, handleAcceptMessageRequest]);

  const handleRejectMessageRequest = useCallback((conversation: ConversationSummary) => {
    if (isMessageRequestActionBusy) {
      return;
    }

    const conversationId = conversation.conversationId;
    if (!conversationId) {
      return;
    }

    setMessageRequestActionPending('reject');
    setMessageRequestActionConversationId(conversationId);
    setSendError(null);
    rejectConversationRequest(conversationId)
      .then(() => {
        setConversations(previous =>
          previous.filter(item => item.conversationId !== conversationId),
        );
        messageCacheRef.current.delete(conversationId);
        if (activeConversation?.conversationId === conversationId) {
          closeConversation();
        }
        queueSilentRefresh();
      })
      .catch(error => {
        setSendError(
          isApiRequestError(error)
            ? error.message
            : 'Mesaj isteği reddedilemedi.',
        );
      })
      .finally(() => {
        setMessageRequestActionPending('none');
        setMessageRequestActionConversationId(null);
      });
  }, [
    activeConversation,
    closeConversation,
    isMessageRequestActionBusy,
    queueSilentRefresh,
  ]);

  const handleRejectActiveMessageRequest = useCallback(() => {
    if (!activeConversation) {
      return;
    }
    handleRejectMessageRequest(activeConversation);
  }, [activeConversation, handleRejectMessageRequest]);

  const handleBlockMessageRequest = useCallback(
    (conversation: ConversationSummary) => {
      if (isMessageRequestActionBusy) {
        return;
      }

      const conversationId = conversation.conversationId;
      const peerId = conversation.peer.id.trim();
      if (!conversationId || !peerId || peerId === viewerId) {
        return;
      }

      setSendError(null);
      setBlockUserSheet({
        conversationId,
        displayName: conversation.peer.fullName?.trim() || undefined,
        peerId,
        source: 'message_request',
        username: conversation.peer.username?.trim() || '',
      });
    },
    [isMessageRequestActionBusy, viewerId],
  );

  const handleBlockActiveMessageRequest = useCallback(() => {
    if (!activeConversation) {
      return;
    }
    handleBlockMessageRequest(activeConversation);
  }, [activeConversation, handleBlockMessageRequest]);

  const emptyMessageTitle = searchQuery.length > 0
    ? 'Sonuç bulunamadı'
    : activeFilter === 'requests'
      ? 'Mesaj isteğin yok'
      : 'Henüz mesajınız yok';
  const emptyMessageDescription = searchQuery.length > 0
    ? 'Farklı bir isim, kullanıcı adı veya mesaj kelimesi ile tekrar dene.'
    : activeFilter === 'requests'
      ? 'Takip etmeden yazan kişiler burada listelenir.'
      : 'Arkadaşlarınla sohbet etmeye başla';
  const emptyStateMinHeight = Math.max(420, Math.round(viewportHeight * 0.62));
  const globalPendingQueueBadgeLabel = useMemo(() => {
    const count = pendingSendQueue.length;
    if (count <= 0) {
      return '';
    }
    if (count > 99) {
      return 'Kuyruk 99+';
    }
    return `Kuyruk ${count}`;
  }, [pendingSendQueue.length]);
  const messageRequestsBaseCount = useMemo(
    () =>
      conversations.reduce((count, item) => {
        return item.isMessageRequest ? count + 1 : count;
      }, 0),
    [conversations],
  );
  const messageRequestsCount = Math.max(
    0,
    messageRequestsBaseCount + messageRequestRealtimeDelta,
  );
  useEffect(() => {
    const previousBaseCount = lastMessageRequestsBaseCountRef.current;
    lastMessageRequestsBaseCountRef.current = messageRequestsBaseCount;
    if (previousBaseCount !== messageRequestsBaseCount) {
      setMessageRequestRealtimeDelta(0);
    }
  }, [messageRequestsBaseCount]);
  const messageRequestPreviewConversations = useMemo(
    () => conversations.filter(item => item.isMessageRequest).slice(0, 3),
    [conversations],
  );
  const conversationPreviewById = useMemo(() => {
    const previewMap = new Map<string, string>();
    conversations.forEach(item => {
      const resolvedPreview =
        item.lastMessagePreview ??
        parseMessageContent(item.lastMessage, {
          kind: item.lastMessageKind,
          locationMessage: item.lastLocationMessage,
          photoMessage: item.lastPhotoMessage,
          preview: item.lastMessagePreview,
          voiceMessage: item.lastVoiceMessage,
        }).preview;
      previewMap.set(item.conversationId, resolvedPreview);
    });
    return previewMap;
  }, [conversations]);
  const conversationByPeerId = useMemo(() => {
    const nextMap = new Map<string, ConversationSummary>();
    conversations.forEach(item => {
      const peerId = item.peer.id.trim();
      if (!peerId || nextMap.has(peerId)) {
        return;
      }
      nextMap.set(peerId, item);
    });
    return nextMap;
  }, [conversations]);
  const filteredConversations = useMemo(() => {
    if (searchQuery.trim().length === 0) {
      return conversations;
    }

    return conversations.filter(item =>
      conversationMatchesSearch(
        item,
        conversationPreviewById.get(item.conversationId) ?? item.lastMessagePreview ?? '',
        searchQuery,
      ),
    );
  }, [conversationPreviewById, conversations, searchQuery]);
  const showSearchUserSection = isSearchOpen && searchQuery.trim().length > 0;
  const showConversationSearchSection =
    showSearchUserSection && filteredConversations.length > 0;
  const shouldSuppressSearchEmptyState =
    showSearchUserSection &&
    (searchUsersLoading || searchUsers.length > 0 || searchUsersError !== null);
  const listHeader = useMemo(
    () => (
      <>
        <View
          style={[
            styles.headerContainer,
            { paddingTop: Math.max(safeTop, 8) + 2 },
          ]}
        >
          <View className="mb-[10px] flex-row items-start justify-between">
            <View>
              <Text allowFontScaling={false} className="text-[11px] text-[#8d92a0]">
                {greetingLabel}, {greetingName}
              </Text>
              <View style={styles.headerTitleRow}>
                <Text
                  allowFontScaling={false}
                  className="mt-[2px] text-[23px] text-[#15171c]"
                >
                  Mesajlar
                </Text>
                {globalPendingQueueBadgeLabel ? (
                  <View style={styles.globalQueueBadge}>
                    <FeatherIcon color="#9a3412" name="clock" size={11} />
                    <Text allowFontScaling={false} style={styles.globalQueueBadgeText}>
                      {globalPendingQueueBadgeLabel}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.headerActions}>
              <Pressable
                className="mt-[2px] h-[36px] w-[36px] items-center justify-center rounded-full"
                onPress={openNewConversationPanel}
                style={[
                  styles.headerActionButton,
                  styles.headerComposeActionButton,
                ]}
              >
                <FeatherIcon color="#12141a" name="edit-3" size={18} />
              </Pressable>
              <Pressable
                className="mt-[2px] h-[36px] w-[36px] items-center justify-center rounded-full"
                onPress={() => {
                  setIsSearchOpen(previous => !previous);
                }}
                style={[styles.headerActionButton, styles.headerActionButtonSpacing]}
              >
                <FeatherIcon
                  color="#12141a"
                  name={isSearchOpen ? 'x' : 'search'}
                  size={18}
                />
              </Pressable>
            </View>
          </View>

          {isSearchOpen ? (
            <View className="mb-[10px] h-[38px] flex-row items-center rounded-[12px] bg-[#eceef3] px-3">
              <FeatherIcon color="#9ca2ad" name="search" size={17} />
              <TextInput
                allowFontScaling={false}
                ref={searchInputRef}
                autoCapitalize="none"
                autoCorrect={false}
                className="ml-2 flex-1 py-0 text-[14px] text-[#22242a]"
                onChangeText={setSearchText}
                placeholder="Konuşma ara..."
                placeholderTextColor="#9ca2ad"
                returnKeyType="search"
                value={searchText}
              />
            </View>
          ) : null}

          {showSearchUserSection ? (
            <View style={styles.searchUsersCard}>
              <View style={styles.searchUsersHeader}>
                <Text allowFontScaling={false} style={styles.searchUsersTitle}>
                  Kisiler
                </Text>
                {searchUsersLoading ? (
                  <IosSpinner color="#ff5a1f" size="small" />
                ) : (
                  <Text allowFontScaling={false} style={styles.searchUsersMeta}>
                    {searchUsers.length > 0 ? `${searchUsers.length} kisi` : 'Anlik'}
                  </Text>
                )}
              </View>

              {searchUsersError ? (
                <Text allowFontScaling={false} style={styles.searchUsersErrorText}>
                  {searchUsersError}
                </Text>
              ) : null}

              {searchUsers.map(user => {
                const existingConversation = conversationByPeerId.get(user.id);
                const userDisplayName =
                  user.fullName.trim().length > 0 ? user.fullName : user.username;
                const isPending = searchUserActionPendingId === user.id;
                const statusPillLabel =
                  user.viewerState.streetFriendStatus === 'accepted'
                    ? 'Yakındakiler'
                    : user.viewerState.isFollowing
                      ? 'Takipte'
                      : '';

                return (
                  <Pressable
                    key={user.id}
                    onPress={() => {
                      handleOpenSearchUserConversation(user).catch(() => {
                        return;
                      });
                    }}
                    style={styles.searchUserRow}
                  >
                    <View style={styles.searchUserAvatarShell}>
                      {user.avatarUrl.trim().length > 0 ? (
                        <Image
                          source={{
                            uri: resolveAvatarUriWithCacheBust(user.avatarUrl, user.id),
                          }}
                          style={styles.searchUserAvatarImage}
                        />
                      ) : (
                        <Text allowFontScaling={false} style={styles.searchUserAvatarFallback}>
                          {userDisplayName.slice(0, 1).toUpperCase()}
                        </Text>
                      )}
                    </View>
                    <View style={styles.searchUserTextBlock}>
                      <View style={styles.searchUserNameRow}>
                        <Text
                          allowFontScaling={false}
                          numberOfLines={1}
                          style={styles.searchUserName}
                        >
                          {userDisplayName}
                        </Text>
                        {statusPillLabel ? (
                          <View style={styles.searchUserStatusPill}>
                            <Text
                              allowFontScaling={false}
                              style={styles.searchUserStatusPillText}
                            >
                              {statusPillLabel}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        style={styles.searchUserHandle}
                      >
                        @{user.username}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.searchUserActionButton,
                        existingConversation
                          ? styles.searchUserActionButtonSecondary
                          : null,
                      ]}
                    >
                      {isPending ? (
                        <IosSpinner
                          color={existingConversation ? '#111827' : '#ffffff'}
                          size="small"
                        />
                      ) : (
                        <Text
                          allowFontScaling={false}
                          style={[
                            styles.searchUserActionButtonText,
                            existingConversation
                              ? styles.searchUserActionButtonTextSecondary
                              : null,
                          ]}
                        >
                          {existingConversation ? 'Mesaja Git' : 'Yaz'}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}

              {!searchUsersLoading &&
              searchUsers.length === 0 &&
              !searchUsersError ? (
                <Text allowFontScaling={false} style={styles.searchUsersEmptyText}>
                  Yazdıkça kullanıcı araması devam eder.
                </Text>
              ) : null}
            </View>
          ) : null}

          {messageRequestsCount > 0 || activeFilter === 'requests' ? (
            <Pressable
              onPress={() => {
                setActiveFilter('requests');
              }}
              style={[
                styles.requestInboxCard,
                activeFilter === 'requests' ? styles.requestInboxCardActive : null,
              ]}
            >
              <View style={styles.requestInboxPreview}>
                {messageRequestPreviewConversations.length > 0 ? (
                  messageRequestPreviewConversations.map((conversation, index) => {
                    const fallbackLabel =
                      conversation.peer.fullName.trim().length > 0
                        ? conversation.peer.fullName.trim()
                        : conversation.peer.username;
                    return (
                      <View
                        key={conversation.conversationId}
                        style={[
                          styles.requestInboxAvatarShell,
                          index > 0 ? styles.requestInboxAvatarOverlap : null,
                        ]}
                      >
                        {conversation.peer.avatarUrl.trim().length > 0 ? (
                          <Image
                            source={{
                              uri: resolveAvatarUriWithCacheBust(
                                conversation.peer.avatarUrl,
                                `${conversation.conversationId}:${conversation.lastMessageAt}`,
                              ),
                            }}
                            style={styles.requestInboxAvatarImage}
                          />
                        ) : (
                          <Text allowFontScaling={false} style={styles.requestInboxAvatarFallback}>
                            {fallbackLabel.slice(0, 1).toUpperCase()}
                          </Text>
                        )}
                      </View>
                    );
                  })
                ) : (
                  <View
                    style={[
                      styles.requestInboxIconWrap,
                      activeFilter === 'requests'
                        ? styles.requestInboxIconWrapActive
                        : null,
                    ]}
                  >
                    <FeatherIcon
                      color={activeFilter === 'requests' ? '#111827' : '#4b5563'}
                      name="inbox"
                      size={18}
                    />
                  </View>
                )}
              </View>
              <View style={styles.requestInboxCopy}>
                <Text allowFontScaling={false} style={styles.requestInboxTitle}>
                  Mesaj istekleri
                </Text>
                <Text allowFontScaling={false} style={styles.requestInboxSubtitle}>
                  {activeFilter === 'requests'
                    ? 'İstekleri inceliyorsun. Kabul etmeden okundu olarak işaretlenmez.'
                    : messageRequestsCount === 1
                      ? '1 yeni mesaj isteği seni bekliyor.'
                      : `${messageRequestsCount} yeni mesaj isteği seni bekliyor.`}
                </Text>
              </View>
              <View style={styles.requestInboxMeta}>
                <View style={styles.requestInboxCountBadge}>
                  <Text allowFontScaling={false} style={styles.requestInboxCountText}>
                    {messageRequestsCount > 99 ? '99+' : String(messageRequestsCount)}
                  </Text>
                </View>
                <FeatherIcon color="#98a2b3" name="chevron-right" size={18} />
              </View>
            </Pressable>
          ) : null}

          <View className="mb-[10px] flex-row items-center">
            <Pressable
              className={`mr-2 rounded-full px-[15px] py-[6px] ${activeFilter === 'all' ? 'bg-[#0f1115]' : 'bg-[#e6e8ed]'
                }`}
              onPress={() => {
                setActiveFilter('all');
              }}
            >
              <Text
                allowFontScaling={false}
                className={`text-[11px] ${activeFilter === 'all' ? 'text-white' : 'text-[#7f8491]'
                  }`}
              >
                Tümü
              </Text>
            </Pressable>
            <Pressable
              className={`rounded-full px-[15px] py-[6px] ${activeFilter === 'unread' ? 'bg-[#0f1115]' : 'bg-[#e6e8ed]'
                }`}
              onPress={() => {
                setActiveFilter('unread');
              }}
            >
              <Text
                allowFontScaling={false}
                className={`text-[11px] ${activeFilter === 'unread' ? 'text-white' : 'text-[#7f8491]'
                  }`}
              >
                Okunmamış
              </Text>
            </Pressable>
          </View>
          {activeFilter === 'requests' ? (
            <View style={styles.requestHeaderCard}>
              <Text allowFontScaling={false} style={styles.requestHeaderTitle}>
                Mesaj istekleri, kabul edene kadar görüldü olarak işaretlenmez.
              </Text>
              <View style={styles.requestHeaderDivider} />
              <View style={styles.requestHeaderRow}>
                <View style={styles.requestHeaderRowLead}>
                  <FeatherIcon color="#6b7280" name="eye-off" size={14} />
                  <Text allowFontScaling={false} style={styles.requestHeaderRowText}>
                    Bekleyen istekler
                  </Text>
                </View>
                <Text allowFontScaling={false} style={styles.requestHeaderRowCount}>
                  {messageRequestsCount}
                </Text>
              </View>
            </View>
          ) : null}

          {showConversationSearchSection ? (
            <View style={styles.searchConversationHeader}>
              <Text allowFontScaling={false} style={styles.searchConversationHeaderTitle}>
                Sohbetler
              </Text>
              <Text allowFontScaling={false} style={styles.searchConversationHeaderMeta}>
                {filteredConversations.length} Sonuç
              </Text>
            </View>
          ) : null}

        </View>
        <View style={styles.headerDivider} />
      </>
    ),
    [
      activeFilter,
      conversationByPeerId,
      filteredConversations.length,
      greetingLabel,
      greetingName,
      globalPendingQueueBadgeLabel,
      handleOpenSearchUserConversation,
      isSearchOpen,
      messageRequestPreviewConversations,
      messageRequestsCount,
      openNewConversationPanel,
      safeTop,
      searchUserActionPendingId,
      searchText,
      searchUsers,
      searchUsersError,
      searchUsersLoading,
      showConversationSearchSection,
      showSearchUserSection,
    ],
  );

  const renderConversation = useCallback(
    ({ item }: ListRenderItemInfo<ConversationSummary>) => {
      const peerIdentity = resolveConversationPeerIdentity(item);
      const displayHandle = peerIdentity.displayName;
      const fallbackInitial = peerIdentity.initials.slice(0, 1).toUpperCase();
      const lastMessage =
        conversationPreviewById.get(item.conversationId) ?? item.lastMessagePreview ?? '';
      const rawUnreadCount = Math.max(0, item.unreadCount);
      const unreadCount = Math.max(1, Math.min(99, rawUnreadCount));
      const showUnreadDot = item.isUnread || rawUnreadCount > 0;
      const chatRequestStatus =
        item.chatRequestStatus ?? (item.isMessageRequest ? 'pending' : 'none');
      const chatRequestDirection =
        item.chatRequestDirection ?? (item.isMessageRequest ? 'incoming' : 'none');
      const isIncomingRequest =
        chatRequestStatus === 'pending' && chatRequestDirection === 'incoming';
      const isOutgoingRequest =
        chatRequestStatus === 'pending' && chatRequestDirection === 'outgoing';
      const isRejectedRequest = chatRequestStatus === 'rejected';
      const showInlineRequestActions = activeFilter === 'requests' && isIncomingRequest;
      const isPendingRequestAction =
        isMessageRequestActionBusy &&
        messageRequestActionConversationId === item.conversationId;
      const isAcceptPending =
        isPendingRequestAction && messageRequestActionPending === 'accept';
      const isBlockPending =
        isPendingRequestAction && messageRequestActionPending === 'block';
      const isRejectPending =
        isPendingRequestAction && messageRequestActionPending === 'reject';
      const previewText = isIncomingRequest
        ? 'Mesaj isteği - Kabul bekliyor'
        : isOutgoingRequest
          ? 'Mesaj isteği - Kabul edildi'
          : isRejectedRequest
            ? 'Mesaj isteği - Reddedildi'
            : item.isViewerBlockedByPeer
              ? HIDDEN_USER_NOT_FOUND_LABEL
              : lastMessage || item.messagingHint || 'Yeni sohbet - Kabul ediniz';

      const rowContent = (
        <>
          <View style={styles.avatarShell}>
            {peerIdentity.avatarUrl.length > 0 ? (
              <Image
                source={{
                  uri: resolveAvatarUriWithCacheBust(
                    peerIdentity.avatarUrl,
                    `${item.conversationId}:${item.lastMessageAt}`,
                  ),
                }}
                style={styles.avatarImage}
              />
            ) : (
              <Text allowFontScaling={false} style={styles.avatarFallback}>
                {fallbackInitial}
              </Text>
            )}
          </View>

          <View style={styles.conversationBody}>
            <View style={styles.rowTop}>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.peerName}>
                {displayHandle}
              </Text>
              {isIncomingRequest || isOutgoingRequest || isRejectedRequest ? (
                <View style={styles.requestPill}>
                  <Text allowFontScaling={false} style={styles.requestPillText}>
                    {isIncomingRequest
                      ? 'İstek'
                      : isOutgoingRequest
                        ? 'Gönderildi'
                        : 'Reddedildi'}
                  </Text>
                </View>
              ) : item.isMuted ? (
                <View style={styles.conversationMutedPill}>
                  <FeatherIcon color="#7c8596" name="bell" size={10} />
                </View>
              ) : null}
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                style={styles.messageTime}
              >
                {formatConversationTime(item.lastMessageAt)}
              </Text>
            </View>
            <View style={styles.rowBottom}>
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                style={styles.messagePreview}
              >
                {previewText}
              </Text>
              {showUnreadDot ? (
                <View style={styles.unreadBadge}>
                  <Text allowFontScaling={false} style={styles.unreadBadgeText}>
                    {unreadCount}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </>
      );

      if (!showInlineRequestActions) {
        return (
          <Pressable
            onPress={() => {
              openConversation(item);
            }}
            style={styles.conversationRow}
          >
            {rowContent}
          </Pressable>
        );
      }

      return (
        <View style={[styles.conversationRow, styles.requestConversationRow]}>
          <Pressable
            onPress={() => {
              openConversation(item);
            }}
            style={styles.requestConversationPressable}
          >
            {rowContent}
          </Pressable>
          <View style={styles.requestActionRow}>
            <Pressable
              disabled={isMessageRequestActionBusy}
              onPress={() => {
                handleBlockMessageRequest(item);
              }}
              style={[
                styles.requestActionButton,
                styles.requestActionButtonDanger,
                isMessageRequestActionBusy ? styles.requestActionButtonDisabled : null,
              ]}
            >
              {isBlockPending ? (
                <IosSpinner color="#dc2626" size="small" />
              ) : (
                <Text allowFontScaling={false} style={styles.requestActionButtonDangerText}>
                  Engelle
                </Text>
              )}
            </Pressable>
            <Pressable
              disabled={isMessageRequestActionBusy}
              onPress={() => {
                handleAcceptMessageRequest(item);
              }}
              style={[
                styles.requestActionButton,
                styles.requestActionButtonPrimary,
                isMessageRequestActionBusy ? styles.requestActionButtonDisabled : null,
              ]}
            >
              {isAcceptPending ? (
                <IosSpinner color="#ffffff" size="small" />
              ) : (
                <Text allowFontScaling={false} style={styles.requestActionButtonPrimaryText}>
                  Kabul et
                </Text>
              )}
            </Pressable>
            <Pressable
              disabled={isMessageRequestActionBusy}
              onPress={() => {
                handleRejectMessageRequest(item);
              }}
              style={[
                styles.requestActionButton,
                styles.requestActionButtonSecondary,
                isMessageRequestActionBusy ? styles.requestActionButtonDisabled : null,
              ]}
            >
              {isRejectPending ? (
                <IosSpinner color="#4b5563" size="small" />
                ) : (
                  <Text allowFontScaling={false} style={styles.requestActionButtonSecondaryText}>
                    Sil
                  </Text>
                )}
              </Pressable>
          </View>
        </View>
      );
    },
    [
      activeFilter,
      conversationPreviewById,
      handleAcceptMessageRequest,
      handleBlockMessageRequest,
      handleRejectMessageRequest,
      isMessageRequestActionBusy,
      messageRequestActionConversationId,
      messageRequestActionPending,
      openConversation,
    ],
  );

  const renderEmptyState = useCallback(() => {
    if (isLoading) {
      return null;
    }

    if (shouldSuppressSearchEmptyState) {
      return null;
    }

    if (errorMessage) {
      return (
        <View style={styles.contentPad}>
          <ScreenStateCenter minHeight={emptyStateMinHeight}>
            <ScreenStateCard
              actionLabel="Tekrar dene"
              actionLoading={isRefreshing}
              description={errorMessage}
              iconName="alert-triangle"
              onActionPress={() => {
                loadFirstPage('refresh').catch(() => {
                  return;
                });
              }}
              style={styles.stateCard}
              title="Mesajlar alınamadı"
              tone="error"
            />
          </ScreenStateCenter>
        </View>
      );
    }

    return (
      <View style={styles.contentPad}>
        <ScreenStateCenter minHeight={emptyStateMinHeight}>
          <View style={styles.emptyState}>
            <View style={styles.emptyStateIconWrap}>
              <FeatherIcon
                color={searchQuery.length > 0 ? '#5f6675' : '#171b22'}
                name={searchQuery.length > 0 ? 'search' : 'message-circle'}
                size={32}
              />
            </View>
            <Text allowFontScaling={false} style={styles.emptyStateTitle}>
              {emptyMessageTitle}
            </Text>
            <Text allowFontScaling={false} style={styles.emptyStateSubtitle}>
              {emptyMessageDescription}
            </Text>
          </View>
        </ScreenStateCenter>
      </View>
    );
  }, [
    emptyMessageDescription,
    emptyMessageTitle,
    errorMessage,
    isLoading,
    isRefreshing,
    loadFirstPage,
    searchQuery,
    shouldSuppressSearchEmptyState,
    emptyStateMinHeight,
  ]);

  const latestOwnMessageId = useMemo(() => {
    return messages.find(item => item.isMine)?.id ?? null;
  }, [messages]);

  const renderedMessages = useMemo<RenderedConversationMessage[]>(
    () => {
      const previousCache = renderedMessageCacheRef.current;
      const nextCache = new Map<string, RenderedMessageCacheEntry>();
      const hydrated = messages.map(message => {
        const signature = [
          message.id,
          message.body,
          message.clientNonce ?? '',
          message.localStatus ?? '',
          message.kind,
          message.preview,
          message.voiceMessage?.id ?? '',
          message.voiceMessage?.durationSec ?? '',
          Array.isArray(message.voiceMessage?.waveform)
            ? message.voiceMessage?.waveform?.length ?? 0
            : 0,
          message.photoMessage?.url ?? '',
          message.locationMessage?.latitude ?? '',
          message.locationMessage?.longitude ?? '',
        ].join('|');
        const cached = previousCache.get(message.id);
        if (cached && cached.signature === signature) {
          nextCache.set(message.id, cached);
          return cached.message;
        }

        const renderedContent = parseMessageContent(message.body, {
          kind: message.kind,
          locationMessage: message.locationMessage,
          photoMessage: message.photoMessage,
          preview: message.preview,
          voiceMessage: message.voiceMessage,
        });
        const voiceDurationSec =
          renderedContent.kind === 'voice'
            ? resolveVoiceDurationSec(renderedContent.voiceMessage?.durationSec, 6)
            : 0;
        const voiceWaveformBars =
          renderedContent.kind === 'voice'
            ? resolveVoiceWaveformBars(
              message.id,
              renderedContent.voiceMessage?.id ?? '',
              voiceDurationSec,
              renderedContent.voiceMessage?.waveform,
              VOICE_WAVEFORM_BAR_COUNT,
            )
            : [];
        const renderedMessage = {
          ...message,
          renderedContent,
          voiceDurationSec,
          voiceWaveformBars,
        };
        nextCache.set(message.id, {
          message: renderedMessage,
          signature,
        });
        return renderedMessage;
      });
      renderedMessageCacheRef.current = nextCache;
      return hydrated;
    },
    [messages],
  );

  const closePhotoPreview = useCallback(() => {
    setPhotoPreviewState(null);
  }, []);

  const openPhotoPreview = useCallback((photoUrl: string, title: string) => {
    const normalizedPhotoUrl = String(photoUrl || '').trim();
    if (!canRenderInlinePhoto(normalizedPhotoUrl)) {
      return;
    }
    const normalizedTitle = String(title || '').trim();
    setPhotoPreviewState({
      title: normalizedTitle.length > 0 ? normalizedTitle : 'Fotograf',
      uri: normalizedPhotoUrl,
    });
  }, []);

  const renderMessageBubble = useCallback(
    ({ item, index }: ListRenderItemInfo<RenderedConversationMessage>) => {
      const newerMessage = index > 0 ? renderedMessages[index - 1] : null;
      const olderMessage =
        index < renderedMessages.length - 1 ? renderedMessages[index + 1] : null;
      return (
        <MessageBubbleRow
          item={item}
          latestOwnMessageId={latestOwnMessageId}
          newerMessage={newerMessage}
          olderMessage={olderMessage}
          onOpenPhotoPreview={openPhotoPreview}
          onCyclePlaybackRate={cyclePlaybackRate}
          onTogglePlayback={handleToggleVoicePlayback}
          peerLastReadAt={peerLastReadAt}
          peerLastReadMessageId={peerLastReadMessageId}
          playingVoiceElapsedSec={playingVoiceElapsedSec}
          playingVoiceMessageId={playingVoiceMessageId}
          voicePlaybackRate={voicePlaybackRate}
        />
      );
    },
    [
      cyclePlaybackRate,
      handleToggleVoicePlayback,
      latestOwnMessageId,
      openPhotoPreview,
      peerLastReadAt,
      peerLastReadMessageId,
      playingVoiceElapsedSec,
      playingVoiceMessageId,
      renderedMessages,
      voicePlaybackRate,
    ],
  );

  const detailSubtitle = useMemo(() => {
    if (!activeConversation) {
      return '';
    }
    if (isViewerBlockedByPeer) {
      return HIDDEN_USER_NOT_FOUND_LABEL;
    }
    if (isPeerBlockedByViewer) {
      return 'Bu kullanıcıyı engelledin';
    }
    if (isConversationRequest) {
      return 'Mesaj isteği bekliyor';
    }
    if (peerTyping) {
      return 'Yazıyor...';
    }
    if (peerLastReadAt) {
      const readLabel = formatReadAt(peerLastReadAt);
      if (readLabel.length > 0) {
        return `Son okuma: ${readLabel}`;
      }
    }
    if (socketStatus === 'live') {
      return 'Çevrimici';
    }
    if (socketStatus === 'connecting') {
      return 'Bağlanıyor...';
    }
    return 'Çevrimdışı';
  }, [
    activeConversation,
    isConversationRequest,
    isPeerBlockedByViewer,
    isViewerBlockedByPeer,
    peerLastReadAt,
    peerTyping,
    socketStatus,
  ]);

  useEffect(() => {
    if (!activeConversationId || !isConversationInteractionLocked) {
      return;
    }

    clearTypingTimer();
    stopLocalTyping(activeConversationId);
    setPeerTyping(false);
    closeAttachmentMenu();
    resetRecordingState(0);
    ignorePromise(cancelActiveVoiceRecording());
  }, [
    activeConversationId,
    cancelActiveVoiceRecording,
    clearTypingTimer,
    closeAttachmentMenu,
    isConversationInteractionLocked,
    resetRecordingState,
    stopLocalTyping,
  ]);

  const detailListEmptyComponent = useMemo(() => {
    if (!messagesError) {
      return null;
    }

    return (
      <View style={styles.detailStateContainer}>
        <ScreenStateCard
          actionLabel="Tekrar dene"
          actionLoading={messagesRefreshing}
          description={messagesError}
          iconName="alert-triangle"
          onActionPress={() => {
            if (!activeConversationIdRef.current) {
              return;
            }
            loadConversationMessages(
              activeConversationIdRef.current,
              'refresh',
            ).catch(() => {
              return;
            });
          }}
          style={styles.stateCard}
          title="Konuşma Açılamadı"
          tone="error"
        />
      </View>
    );
  }, [loadConversationMessages, messagesError, messagesRefreshing]);

  const detailEmptyState = useMemo(() => {
    if (messagesLoading || messagesError) {
      return null;
    }

    const emptyStateText = getEmptyStateText(conversationUIState);
    return (
      <View pointerEvents="none" style={styles.detailEmptyOverlay}>
        <View style={styles.detailEmptyState}>
          <FeatherIcon color="#1f2937" name="message-circle" size={34} style={styles.detailEmptyIcon} />
          <Text allowFontScaling={false} style={styles.detailEmptyTitle}>
            {emptyStateText.title}
          </Text>
          <Text allowFontScaling={false} style={styles.detailEmptyText}>
            {emptyStateText.description}
          </Text>
        </View>
      </View>
    );
  }, [conversationUIState, messagesError, messagesLoading]);

  const listContentStyle = useMemo(
    () => ({
      flexGrow:
        filteredConversations.length === 0 && !shouldSuppressSearchEmptyState
          ? 1
          : undefined,
      paddingBottom: contentBottomInset + 24,
    }),
    [contentBottomInset, filteredConversations.length, shouldSuppressSearchEmptyState],
  );

  const detailContentStyle = useMemo(
    () => ({
      flexGrow: messages.length === 0 ? 1 : undefined,
      paddingBottom: 18,
      paddingTop: 18,
    }),
    [messages.length],
  );
  const conversationListFooterComponent = useMemo(() => {
    if (!isFetchingMore || searchQuery.trim().length > 0) {
      return null;
    }

    return (
      <View style={styles.footerLoader}>
        <IosSpinner color="#ff5a1f" size="small" />
      </View>
    );
  }, [isFetchingMore, searchQuery]);
  const detailListFooterComponent = useMemo(() => {
    if (!messagesFetchingMore) {
      return null;
    }

    return (
      <View style={styles.footerLoader}>
        <IosSpinner color="#ff5a1f" size="small" />
      </View>
    );
  }, [messagesFetchingMore]);
  const handleConversationRefresh = useCallback(() => {
    loadFirstPage('refresh').catch(() => {
      return;
    });
  }, [loadFirstPage]);
  const handleMessagesRefresh = useCallback(() => {
    const conversationId = activeConversationIdRef.current;
    if (!conversationId) {
      return;
    }

    loadConversationMessages(conversationId, 'refresh').catch(() => {
      return;
    });
  }, [loadConversationMessages]);

  const handleSocketReconnect = useCallback(() => {
    socketReconnectAttemptRef.current = 0;
    setSocketReconnectAttemptCount(0);
    clearSocketOfflineBannerTimer();
    clearSocketReconnectTimer();
    clearSocketConnectTimeout();
    clearSocketHeartbeatAckTimeout();
    clearSocketHeartbeatCheckTimer();
    awaitingSocketHeartbeatAckRef.current = false;
    lastSocketActivityAtRef.current = Date.now();
    setSocketStatus('connecting');
    if (socketRef.current && socketRef.current.readyState !== WebSocket.CLOSED) {
      socketRef.current.close();
      return;
    }
    connectSocketRef.current?.();
  }, [
    clearSocketConnectTimeout,
    clearSocketHeartbeatAckTimeout,
    clearSocketHeartbeatCheckTimer,
    clearSocketReconnectTimer,
    clearSocketOfflineBannerTimer,
  ]);

  const isComposerBusy = isSending || isVoiceUploading;
  const activeConversationPendingItems = useMemo(
    () =>
      activeConversationId
        ? pendingSendQueue.filter(item => item.conversationId === activeConversationId)
        : [],
    [activeConversationId, pendingSendQueue],
  );
  const activeConversationPendingPrimary =
    activeConversationPendingItems.length > 0 ? activeConversationPendingItems[0] : null;
  const pendingSendRetryKind = activeConversationPendingPrimary?.kind ?? null;
  const isRetryAvailableForActiveConversation =
    activeConversationPendingPrimary !== null;
  const activeConversationQueueBanner = useMemo(() => {
    if (!activeConversationPendingPrimary) {
      return null;
    }

    const count = activeConversationPendingItems.length;
    const title =
      count === 1 ? '1 gönderim kuyrukta' : `${count} gönderim kuyrukta`;
    const descriptionBase =
      count === 1
        ? 'Bu sohbette bağlantı bekleyen bir ileti var.'
        : 'Bu sohbette bağlantı bekleyen iletiler var.';
    const updatedAtLabel =
      activeConversationPendingPrimary.updatedAt.trim().length > 0
        ? formatReadAt(activeConversationPendingPrimary.updatedAt)
        : '';

    return {
      actionLabel: count > 1 ? 'Kuyruğu dene' : 'Şimdi dene',
      description: updatedAtLabel
        ? `${descriptionBase} Son deneme ${updatedAtLabel}.`
        : descriptionBase,
      title,
    };
  }, [activeConversationPendingItems.length, activeConversationPendingPrimary]);
  const connectionBanner = useMemo(() => {
    if (socketStatus === 'live') {
      return null;
    }

    if (socketStatus === 'connecting') {
      if (socketReconnectAttemptCount === 0) {
        return null;
      }
      return {
        actionLabel: null,
        message: 'Bağlantı yeniden kuruluyor. Son mesajlar arka planda senkronize ediliyor.',
        tone: 'info' as const,
      };
    }

    if (!isSocketOfflineBannerVisible) {
      return null;
    }

    return {
      actionLabel: 'Yeniden bağlan',
      message:
        'Canlı bağlantı geçici olarak kesildi. Sohbet listesi arka planda yenilenmeye devam ediyor.',
      tone: 'warning' as const,
    };
  }, [isSocketOfflineBannerVisible, socketReconnectAttemptCount, socketStatus]);
  const composerPlaceholder = getConversationComposerPlaceholder(
    conversationUIState,
    conversationLockMessage,
  );
  const isComposerActionDisabled = isComposerBusy || isConversationInteractionLocked;
  const canSend =
    composerText.trim().length > 0 &&
    !isComposerBusy &&
    !isVoiceRecording &&
    !isConversationInteractionLocked;
  const isVoiceRecordingLocked = isVoiceRecording && voiceRecordingMode === 'tap';
  const isVoiceRecordingPreview = isVoiceRecording && voiceRecordingMode === 'preview';
  const isVoiceRecordingDraftState = isVoiceRecordingLocked || isVoiceRecordingPreview;
  const voiceRecordingPreviewProgressWidth =
    isVoiceRecordingPreview && voiceRecordingDraft
      ? (`${clampRatio(
          previewPlaybackElapsedSec /
            Math.max(voiceRecordingDraft.durationSec || 1, 1),
        ) * 100}%` as `${number}%`)
      : ('0%' as const);
  const voiceRecordingPreviewProgressStyle = {
    width: voiceRecordingPreviewProgressWidth,
  };
  const voiceDebugChips = useMemo(() => {
    if (!SHOW_VOICE_DEBUG_OVERLAY || !activeConversationId) {
      return [];
    }

    const previewDuration =
      voiceRecordingDraft && Number.isFinite(voiceRecordingDraft.durationSec)
        ? Math.max(0, Math.round(voiceRecordingDraft.durationSec * 10) / 10)
        : 0;
    const previewElapsed = Math.max(
      0,
      Math.round(previewPlaybackElapsedSec * 10) / 10,
    );
    const activePlaybackElapsed = Math.max(
      0,
      Math.round(playingVoiceElapsedSec * 10) / 10,
    );

    return [
      `ws:${socketStatus}`,
      `rec:${isVoiceRecording ? voiceRecordingMode ?? 'live' : 'idle'}`,
      `upload:${isVoiceUploading ? 'busy' : 'idle'}`,
      `preview:${previewPlaybackPlaying ? 'play' : 'stop'} ${previewElapsed}/${previewDuration}s`,
      `player:${playingVoiceMessageId ? `${activePlaybackElapsed}s` : 'idle'}`,
      `queue:${activeConversationPendingItems.length}`,
      `retry:${pendingSendRetryKind ?? 'none'}`,
    ];
  }, [
    activeConversationId,
    activeConversationPendingItems.length,
    isVoiceRecording,
    isVoiceUploading,
    pendingSendRetryKind,
    playingVoiceElapsedSec,
    playingVoiceMessageId,
    previewPlaybackElapsedSec,
    previewPlaybackPlaying,
    socketStatus,
    voiceRecordingDraft,
    voiceRecordingMode,
  ]);
  useEffect(() => {
    if (!SHOW_VOICE_DEBUG_OVERLAY || !activeConversationId) {
      return;
    }

    console.debug('[voice-flow]', {
      conversationId: activeConversationId,
      pendingQueueSize: activeConversationPendingItems.length,
      playingVoiceMessageId,
      previewPlaybackPlaying,
      recording: isVoiceRecording ? voiceRecordingMode ?? 'live' : 'idle',
      retryKind: pendingSendRetryKind ?? null,
      socketStatus,
      voiceUploading: isVoiceUploading,
    });
  }, [
    activeConversationId,
    activeConversationPendingItems.length,
    isVoiceRecording,
    isVoiceUploading,
    pendingSendRetryKind,
    playingVoiceMessageId,
    previewPlaybackPlaying,
    socketStatus,
    voiceRecordingMode,
  ]);
  const composerActionIconName = canSend
    ? 'send'
    : isVoiceRecording
      ? isVoiceRecordingDraftState
        ? 'send'
        : 'mic'
      : 'mic';
  const composerActionIconColor =
    canSend || isVoiceRecordingDraftState ? '#ffffff' : '#70798a';
  const showListLoadingOverlay = isLoading && conversations.length === 0;
  const showDetailLoadingOverlay = messagesLoading && messages.length === 0;

  const handleHeaderOpenPeerProfile = useCallback(() => {
    if (!activeConversation || !onOpenPublicProfile) {
      return;
    }

    const peerId = activeConversation.peer.id.trim();
    if (!peerId || peerId === viewerId) {
      return;
    }

    onOpenPublicProfile(toExploreSearchUserFromConversation(activeConversation));
  }, [activeConversation, onOpenPublicProfile, viewerId]);

  const handleHeaderToggleMuteConversation = useCallback(() => {
    if (!activeConversation || headerMenuActionPending) {
      return;
    }

    const conversationId = activeConversation.conversationId;
    const nextMuted = !activeConversation.isMuted;
    setHeaderMenuPendingAction('mute');
    setIsHeaderMenuOpen(false);
    setSendError(null);

    setConversationMuted(conversationId, nextMuted)
      .then(response => {
        patchConversation(conversationId, item => ({
          ...item,
          isMuted: response.muted,
        }));
        queueSilentRefresh();
      })
      .catch(error => {
        setSendError(
          isApiRequestError(error)
            ? error.message
            : 'Sohbet sessize alma ayarı güncellenemedi.',
        );
      })
      .finally(() => {
        setHeaderMenuPendingAction('none');
      });
  }, [
    activeConversation,
    headerMenuActionPending,
    patchConversation,
    queueSilentRefresh,
  ]);

  const handleHeaderClearConversation = useCallback(() => {
    if (!activeConversation || headerMenuActionPending) {
      return;
    }
    setIsHeaderMenuOpen(false);
    void (async () => {
      const approved = await confirm({
        confirmLabel: 'Temizle',
        message:
          'Bu sohbetteki mesajlar sadece senin ekranindan temizlenecek. Devam edilsin mi?',
        title: 'Sohbeti Temizle',
        tone: 'warning',
      });
      if (!approved) {
        return;
      }
      const conversationId = activeConversation.conversationId;
      setHeaderMenuPendingAction('clear');
      setSendError(null);
      clearConversationMessages(conversationId)
        .then(response => {
          messageCacheRef.current.set(conversationId, {
            hasMore: false,
            messages: [],
            nextCursor: null,
          });
          clearDisplayedMessages();
          clearUnreadLocally(
            conversationId,
            Number(response.unreadCount ?? 0),
          );
          queueSilentRefresh();
        })
        .catch(error => {
          setSendError(resolveErrorMessage(error, 'Sohbet temizlenemedi.'));
        })
        .finally(() => {
          setHeaderMenuPendingAction('none');
        });
    })();
  }, [
    activeConversation,
    clearDisplayedMessages,
    clearUnreadLocally,
    confirm,
    headerMenuActionPending,
    queueSilentRefresh,
    resolveErrorMessage,
  ]);

  const handleDeleteConversationByMode = useCallback(
    (conversationId: string, mode: 'hard' | 'self') => {
      setHeaderMenuPendingAction('delete');
      setIsHeaderMenuOpen(false);
      setSendError(null);
      const request =
        mode === 'hard'
          ? deleteConversationForAll(conversationId)
          : deleteConversation(conversationId);
      request
        .then(() => {
          messageCacheRef.current.delete(conversationId);
          setConversations(previous =>
            previous.filter(item => item.conversationId !== conversationId),
          );
          closeConversation();
          queueSilentRefresh();
        })
        .catch(error => {
          setSendError(
            resolveErrorMessage(
              error,
              mode === 'hard'
                ? 'Sohbet herkes için silinemedi.'
                : 'Sohbet silinemedi.',
            ),
          );
        })
        .finally(() => {
          setHeaderMenuPendingAction('none');
        });
    },
    [closeConversation, queueSilentRefresh, resolveErrorMessage],
  );

  const handleHeaderDeleteConversation = useCallback(() => {
    if (!activeConversation || headerMenuActionPending) {
      return;
    }
    setIsHeaderMenuOpen(false);
    void (async () => {
      const deleteMode = await showDialog<'self' | 'hard' | 'cancel'>({
        actions: [
          { key: 'cancel', label: 'Vazgeç', style: 'cancel' },
          { key: 'self', label: 'Bende Sil', style: 'destructive' },
          { key: 'hard', label: 'Herkesten Sil', style: 'destructive' },
        ],
        message: 'Sohbeti nasıl silmek istiyorsun?',
        title: 'Sohbeti Sil',
      });
      if (deleteMode !== 'self' && deleteMode !== 'hard') {
        return;
      }
      const approved = await confirm({
        confirmLabel: deleteMode === 'hard' ? 'Herkesten Sil' : 'Bende Sil',
        message:
          deleteMode === 'hard'
            ? 'Bu sohbet iki taraftan da kalıcı silinecek. Onaylıyor musun?'
            : 'Bu sohbet sadece kendi listenden kaldırılacak. Devam edilsin mi?',
        title: 'Sohbeti Sil',
        tone: 'danger',
      });
      if (!approved) {
        return;
      }
      handleDeleteConversationByMode(activeConversation.conversationId, deleteMode);
    })();
  }, [
    activeConversation,
    confirm,
    handleDeleteConversationByMode,
    headerMenuActionPending,
    showDialog,
  ]);

  const handleHeaderToggleBlockPeer = useCallback(() => {
    if (!activeConversation || headerMenuActionPending) {
      return;
    }

    const conversationId = activeConversation.conversationId;
    const peerId = activeConversation.peer.id.trim();
    if (!conversationId || !peerId || peerId === viewerId) {
      return;
    }

    const peerIdentity = resolveConversationPeerIdentity(activeConversation);
    const peerActionLabel = peerIdentity.handleLabel || peerIdentity.displayName;
    const shouldUnblock = isPeerBlockedByViewer;

    setIsHeaderMenuOpen(false);

    if (!shouldUnblock) {
      setSendError(null);
      setBlockUserSheet({
        conversationId,
        displayName: peerIdentity.displayName?.trim() || undefined,
        peerId,
        source: 'header',
        username: activeConversation.peer.username?.trim() || '',
      });
      return;
    }

    void (async () => {
      const approved = await confirm({
        confirmLabel: 'Kaldır',
        message: `${peerActionLabel} engeli kaldırılsın mı?`,
        title: 'Engeli kaldır',
        tone: 'warning',
      });
      if (!approved) {
        return;
      }
      setHeaderMenuPendingAction('block');
      unblockUser(peerId)
        .then(() => {
          const removedConversationIds = conversationsRef.current
            .filter(item => item.peer.id.trim() === peerId)
            .map(item => item.conversationId);
          if (removedConversationIds.length > 0) {
            setConversations(previous =>
              previous.filter(item => item.peer.id.trim() !== peerId),
            );
            removedConversationIds.forEach(id => {
              const normalizedId = id.trim();
              if (normalizedId.length > 0) {
                messageCacheRef.current.delete(normalizedId);
              }
            });
            if (activeConversation?.peer.id.trim() === peerId) {
              closeConversation();
            }
          } else {
            patchConversation(conversationId, item => ({
              ...item,
              isPeerBlockedByViewer: false,
            }));
          }
          queueSilentRefresh();
        })
        .catch(error => {
          setSendError(
            resolveErrorMessage(error, 'Kullanıcı engeli kaldırılamadı.'),
          );
        })
        .finally(() => {
          setHeaderMenuPendingAction('none');
        });
    })();
  }, [
    activeConversation,
    closeConversation,
    confirm,
    headerMenuActionPending,
    isPeerBlockedByViewer,
    patchConversation,
    queueSilentRefresh,
    resolveErrorMessage,
    viewerId,
  ]);

  const blockUserConfirmSheet = (
    <BlockUserConfirmSheet
      displayName={blockUserSheet?.displayName}
      onBlock={async () => {
        const ctx = blockUserSheet;
        if (!ctx) {
          return;
        }
        try {
          await blockUser(ctx.peerId);
          if (ctx.source === 'message_request') {
            await deleteConversation(ctx.conversationId);
            setConversations(previous =>
              previous.filter(item => item.conversationId !== ctx.conversationId),
            );
            messageCacheRef.current.delete(ctx.conversationId);
            if (activeConversation?.conversationId === ctx.conversationId) {
              closeConversation();
            }
            queueSilentRefresh();
          } else {
            applyAfterViewerBlockedPeerFromHeader(ctx.peerId, ctx.conversationId);
          }
        } catch (error) {
          const msg = resolveErrorMessage(error, 'Kullanıcı engellenemedi.');
          setSendError(msg);
          throw new Error(msg);
        }
      }}
      onBlockAndReport={async reason => {
        const ctx = blockUserSheet;
        if (!ctx) {
          return;
        }
        try {
          await reportUser(ctx.peerId, reason);
          await blockUser(ctx.peerId);
          if (ctx.source === 'message_request') {
            await deleteConversation(ctx.conversationId);
            setConversations(previous =>
              previous.filter(item => item.conversationId !== ctx.conversationId),
            );
            messageCacheRef.current.delete(ctx.conversationId);
            if (activeConversation?.conversationId === ctx.conversationId) {
              closeConversation();
            }
            queueSilentRefresh();
          } else {
            applyAfterViewerBlockedPeerFromHeader(ctx.peerId, ctx.conversationId);
          }
        } catch (error) {
          const msg = resolveErrorMessage(
            error,
            'Şikayet veya engelleme tamamlanamadı.',
          );
          setSendError(msg);
          throw new Error(msg);
        }
      }}
      onClose={() => {
        setBlockUserSheet(null);
      }}
      username={blockUserSheet?.username ?? ''}
      visible={blockUserSheet != null}
    />
  );

  if (activeConversation) {
    const isConversationMuted = Boolean(activeConversation.isMuted);
    const isMutePending = headerMenuPendingAction === 'mute';
    const isClearPending = headerMenuPendingAction === 'clear';
    const isDeletePending = headerMenuPendingAction === 'delete';
    const isBlockPending = headerMenuPendingAction === 'block';
    const peerIdentity = resolveConversationPeerIdentity(activeConversation);
    const isBlockedIdentity = isPeerBlockedByViewer || isViewerBlockedByPeer;
    const peerName = isBlockedIdentity
      ? HIDDEN_USER_NOT_FOUND_LABEL
      : peerIdentity.displayName;
    const peerHandleLabel = isBlockedIdentity
      ? HIDDEN_USER_NOT_FOUND_LABEL
      : peerIdentity.handleLabel || HIDDEN_USER_NOT_FOUND_LABEL;
    const canOpenPeerProfile =
      Boolean(onOpenPublicProfile) &&
      activeConversation.peer.id.trim().length > 0 &&
      activeConversation.peer.id !== viewerId &&
      !isBlockedIdentity;
    const canBlockPeer =
      activeConversation.peer.id.trim().length > 0 &&
      activeConversation.peer.id !== viewerId;
    const fallbackInitial = isBlockedIdentity
      ? 'U'
      : peerIdentity.initials.slice(0, 1).toUpperCase() || 'U';
    const subtitleText =
      detailSubtitle.trim().length > 0
        ? detailSubtitle
        : peerIdentity.handleLabel.length > 0
          ? peerIdentity.handleLabel
          : 'Mesajlaşma';
    const isPresenceOnline =
      !isViewerBlockedByPeer && (peerTyping || socketStatus === 'live');
    const muteMenuLabel = isConversationMuted ? 'Sesi Aç' : 'Sessize Al';
    const muteMenuIcon = isConversationMuted ? 'zap' : 'bell';
    const photoPreviewUri = photoPreviewState?.uri ?? '';
    const photoPreviewTitle = photoPreviewState?.title ?? '';
    const isPhotoPreviewVisible = photoPreviewUri.length > 0;
    const photoPreviewFrameHeight = Math.max(
      360,
      Math.min(760, Math.floor(viewportHeight * 0.82)),
    );

    return (
      <Fragment>
        <SafeAreaView edges={['left', 'right']} style={styles.screen}>
          <StatusBar
            animated={true}
            backgroundColor="#ffffff"
            barStyle="dark-content"
            translucent={false}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.flex}
          >
            <View
              style={[
                styles.detailHeader,
                { paddingTop: Math.max(safeTop, 8) + 2 },
              ]}
            >
              <Pressable onPress={closeConversation} style={styles.backButton}>
                <FeatherIcon color="#171b22" name="chevron-left" size={24} />
              </Pressable>
            <View style={styles.detailHeaderProfile}>
              <Pressable
                disabled={!canOpenPeerProfile}
                onPress={handleHeaderOpenPeerProfile}
                style={styles.detailHeaderAvatarPressTarget}
              >
                <View style={styles.detailAvatarShell}>
                  {!isBlockedIdentity && peerIdentity.avatarUrl.length > 0 ? (
                    <Image
                      source={{
                        uri: resolveAvatarUriWithCacheBust(
                          peerIdentity.avatarUrl,
                          `${activeConversation.conversationId}:${activeConversation.lastMessageAt}`,
                        ),
                      }}
                      style={styles.detailAvatarImage}
                    />
                  ) : (
                    <Text allowFontScaling={false} style={styles.avatarFallback}>
                      {fallbackInitial}
                    </Text>
                  )}
                </View>
              </Pressable>
              <Pressable
                disabled={!canOpenPeerProfile}
                onPress={handleHeaderOpenPeerProfile}
                style={styles.detailHeaderTextPressTarget}
              >
                <View style={styles.detailHeaderTextBlock}>
                  <Text allowFontScaling={false} numberOfLines={1} style={styles.detailPeerName}>
                    {peerName}
                  </Text>
                  <View style={styles.detailPresenceRow}>
                    <View
                      style={[
                        styles.detailPresenceDot,
                        isPresenceOnline ? styles.detailPresenceDotOnline : null,
                      ]}
                    />
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      style={styles.detailPeerSubtitle}
                    >
                      {subtitleText}
                    </Text>
                  </View>
                </View>
              </Pressable>
            </View>
            <Pressable
              onPress={() => {
                closeAttachmentMenu();
                setIsHeaderMenuOpen(true);
              }}
              style={styles.headerMenuButton}
            >
              <FeatherIcon color="#70798a" name="more-vertical" size={18} />
            </Pressable>
          </View>
          <View style={styles.detailDivider} />

          <View style={styles.detailTimelineStage}>
            {renderedMessages.length === 0 ? detailEmptyState : null}
            <FlashList
              contentContainerStyle={detailContentStyle}
              data={renderedMessages}
              drawDistance={MESSAGE_ESTIMATED_ITEM_SIZE * 8}
              inverted={true}
              keyExtractor={item => item.id}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={detailListEmptyComponent}
              ListFooterComponent={detailListFooterComponent}
              maintainVisibleContentPosition={{
                autoscrollToBottomThreshold: 0.2,
                startRenderingFromBottom: true,
              }}
              onContentSizeChange={handleDetailListContentSizeChange}
              onEndReached={loadMoreMessages}
              onEndReachedThreshold={0.45}
              onRefresh={handleMessagesRefresh}
              onScroll={handleDetailListScroll}
              refreshing={messagesRefreshing}
              ref={detailListRef}
              removeClippedSubviews={Platform.OS === 'android'}
              renderItem={renderMessageBubble}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
            />
          </View>
          <View
            style={[
              styles.composerContainer,
              { paddingBottom: Math.max(contentBottomInset, 12) + 12 },
            ]}
          >
            <Animated.View
              pointerEvents={shouldShowDetailScrollToLatestBar ? 'auto' : 'none'}
              style={[styles.detailScrollToLatestDock, detailScrollToLatestAnimatedStyle]}
            >
              <Pressable
                accessibilityLabel="En son mesaja in"
                onPress={handlePressDetailScrollToLatest}
                style={({ pressed }) => [
                  styles.detailScrollToLatestBar,
                  pressed ? styles.detailScrollToLatestBarPressed : null,
                ]}
              >
                <FeatherIcon color="#f8fafc" name="arrow-down" size={12} />
                <Text allowFontScaling={false} style={styles.detailScrollToLatestText}>
                  Asagi in
                </Text>
              </Pressable>
            </Animated.View>
            {connectionBanner ? (
              <View
                style={[
                  styles.connectionBanner,
                  connectionBanner.tone === 'warning'
                    ? styles.connectionBannerWarning
                    : styles.connectionBannerInfo,
                ]}
              >
                <View style={styles.connectionBannerBody}>
                  {connectionBanner.tone === 'warning' ? (
                    <FeatherIcon color="#b45309" name="wifi-off" size={15} />
                  ) : (
                    <IosSpinner color="#2563eb" size="small" />
                  )}
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.connectionBannerText,
                      connectionBanner.tone === 'warning'
                        ? styles.connectionBannerTextWarning
                        : styles.connectionBannerTextInfo,
                    ]}
                  >
                    {connectionBanner.message}
                  </Text>
                </View>
                {connectionBanner.actionLabel ? (
                  <Pressable
                    accessibilityLabel="Mesaj bağlantısını yeniden kur"
                    onPress={handleSocketReconnect}
                    style={styles.connectionBannerAction}
                  >
                    <Text
                      allowFontScaling={false}
                      style={styles.connectionBannerActionText}
                    >
                      {connectionBanner.actionLabel}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {activeConversationQueueBanner ? (
              <View style={styles.pendingQueueCard}>
                <View style={styles.pendingQueueCardBody}>
                  <View style={styles.pendingQueueCardIconWrap}>
                    <FeatherIcon color="#b45309" name="clock" size={14} />
                  </View>
                  <View style={styles.pendingQueueCardCopy}>
                    <Text allowFontScaling={false} style={styles.pendingQueueCardTitle}>
                      {activeConversationQueueBanner.title}
                    </Text>
                    <Text allowFontScaling={false} style={styles.pendingQueueCardText}>
                      {activeConversationQueueBanner.description}
                    </Text>
                  </View>
                </View>
                <Pressable
                  accessibilityLabel="Gönderim kuyruğunu yeniden dene"
                  disabled={isComposerBusy}
                  onPress={() => {
                    retryPendingSend().catch(() => {
                      return;
                    });
                  }}
                  style={[
                    styles.pendingQueueCardAction,
                    isComposerBusy ? styles.pendingQueueCardActionDisabled : null,
                  ]}
                >
                  <Text
                    allowFontScaling={false}
                    style={styles.pendingQueueCardActionText}
                  >
                    {activeConversationQueueBanner.actionLabel}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {shouldShowRequestBanner && requestBannerText.length > 0 ? (
              <View style={styles.requestComposerBanner}>
                <View style={styles.requestComposerBannerIconWrap}>
                  <FeatherIcon color="#c2410c" name="mail" size={14} />
                </View>
                <Text allowFontScaling={false} style={styles.requestComposerBannerText}>
                  {requestBannerText}
                </Text>
              </View>
            ) : null}
            {isConversationRequest ? (
              <View style={styles.messageRequestCard}>
                <View style={styles.messageRequestIdentityRow}>
                  <View style={styles.messageRequestAvatarWrap}>
                    {peerIdentity.avatarUrl.length > 0 ? (
                      <Image
                        source={{
                          uri: resolveAvatarUriWithCacheBust(
                            peerIdentity.avatarUrl,
                            `${activeConversation.conversationId}:${activeConversation.lastMessageAt}`,
                          ),
                        }}
                        style={styles.messageRequestAvatar}
                      />
                    ) : (
                      <Text allowFontScaling={false} style={styles.messageRequestAvatarFallback}>
                        {fallbackInitial}
                      </Text>
                    )}
                  </View>
                  <View style={styles.messageRequestIdentityText}>
                    <Text allowFontScaling={false} style={styles.messageRequestTitle}>
                      {peerName}
                    </Text>
                    <Text allowFontScaling={false} style={styles.messageRequestHandle}>
                      {peerHandleLabel}
                    </Text>
                    <Text allowFontScaling={false} style={styles.messageRequestHint}>
                      Kabul edersen bu kisi seninle normal sohbet kurabilir ve
                      mesajlarini ne zaman gordugunu gorebilir.
                    </Text>
                  </View>
                </View>
                {isBlockedIdentity ? (
                  <Text allowFontScaling={false} style={styles.messageRequestHint}>
                    Bu kullanici engelli oldugu icin mesaj istegi islemleri kapali.
                  </Text>
                ) : (
                  <View style={styles.messageRequestActionRow}>
                    <Pressable
                      disabled={isMessageRequestActionBusy}
                      onPress={handleBlockActiveMessageRequest}
                      style={[
                        styles.messageRequestActionButton,
                        styles.messageRequestActionButtonDanger,
                        isMessageRequestActionBusy
                          ? styles.messageRequestActionButtonDisabled
                          : null,
                      ]}
                    >
                      {messageRequestActionConversationId ===
                        activeConversation.conversationId &&
                      messageRequestActionPending === 'block' ? (
                        <IosSpinner color="#dc2626" size="small" />
                      ) : (
                        <Text
                          allowFontScaling={false}
                          style={[
                            styles.messageRequestActionText,
                            styles.messageRequestActionTextDanger,
                          ]}
                        >
                          Engelle
                        </Text>
                      )}
                    </Pressable>
                    <Pressable
                      disabled={isMessageRequestActionBusy}
                      onPress={handleRejectActiveMessageRequest}
                      style={[
                        styles.messageRequestActionButton,
                        styles.messageRequestActionButtonGhost,
                        isMessageRequestActionBusy
                          ? styles.messageRequestActionButtonDisabled
                          : null,
                      ]}
                    >
                      {messageRequestActionConversationId ===
                        activeConversation.conversationId &&
                      messageRequestActionPending === 'reject' ? (
                        <IosSpinner color="#4b5563" size="small" />
                      ) : (
                        <Text
                          allowFontScaling={false}
                          style={[
                            styles.messageRequestActionText,
                            styles.messageRequestActionTextGhost,
                          ]}
                        >
                          Sil
                        </Text>
                      )}
                    </Pressable>
                    <Pressable
                      disabled={isMessageRequestActionBusy}
                      onPress={handleAcceptActiveMessageRequest}
                      style={[
                        styles.messageRequestActionButton,
                        styles.messageRequestActionButtonPrimary,
                        isMessageRequestActionBusy
                          ? styles.messageRequestActionButtonDisabled
                          : null,
                      ]}
                    >
                      {messageRequestActionConversationId ===
                        activeConversation.conversationId &&
                      messageRequestActionPending === 'accept' ? (
                        <IosSpinner color="#ffffff" size="small" />
                      ) : (
                        <Text
                          allowFontScaling={false}
                          style={[
                            styles.messageRequestActionText,
                            styles.messageRequestActionTextPrimary,
                          ]}
                        >
                          Kabul Et
                        </Text>
                      )}
                    </Pressable>
                  </View>
                )}
              </View>
            ) : null}
            {!isConversationRequest &&
            (isRejectedConversationRequest || isRestrictedConversation) ? (
              <View style={[styles.messageRequestCard, styles.messageRequestInfoCard]}>
                <View style={styles.messageRequestIdentityRow}>
                  <View style={styles.messageRequestAvatarWrap}>
                    {!isBlockedIdentity && peerIdentity.avatarUrl.length > 0 ? (
                      <Image
                        source={{
                          uri: resolveAvatarUriWithCacheBust(
                            peerIdentity.avatarUrl,
                            `${activeConversation.conversationId}:${activeConversation.lastMessageAt}`,
                          ),
                        }}
                        style={styles.messageRequestAvatar}
                      />
                    ) : (
                      <Text allowFontScaling={false} style={styles.messageRequestAvatarFallback}>
                        {fallbackInitial}
                      </Text>
                    )}
                  </View>
                  <View style={styles.messageRequestIdentityText}>
                    <Text allowFontScaling={false} style={styles.messageRequestTitle}>
                      {isRejectedConversationRequest
                        ? 'Mesaj isteği reddedildi'
                        : 'Mesaj gönderimi kısıtlı'}
                    </Text>
                    <Text allowFontScaling={false} style={styles.messageRequestHandle}>
                      {peerHandleLabel}
                    </Text>
                    <Text allowFontScaling={false} style={styles.messageRequestHint}>
                      {conversationLockMessage}
                    </Text>
                  </View>
                </View>
              </View>
            ) : null}
            {conversationLockMessage ? (
              <View
                style={[styles.connectionBanner, styles.connectionBannerWarning]}
              >
                <View style={styles.connectionBannerBody}>
                  <FeatherIcon
                    color="#b45309"
                    name={
                      conversationUIState === 'blocked_by_me'
                        ? 'shield'
                        : conversationUIState === 'request_rejected'
                          ? 'x-circle'
                          : conversationUIState === 'restricted'
                            ? 'mail'
                            : 'slash'
                    }
                    size={15}
                  />
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.connectionBannerText,
                      styles.connectionBannerTextWarning,
                    ]}
                  >
                    {conversationLockMessage}
                  </Text>
                </View>
              </View>
            ) : null}
            {sendError ? (
              <View style={styles.sendErrorContainer}>
                <Text allowFontScaling={false} style={styles.sendErrorText}>
                  {sendError}
                </Text>
                {!isConversationInteractionLocked && isRetryAvailableForActiveConversation ? (
                  <Pressable
                    accessibilityLabel="Başarısız gönderimi tekrar dene"
                    disabled={isComposerBusy}
                    onPress={() => {
                      retryPendingSend().catch(() => {
                        return;
                      });
                    }}
                    style={[
                      styles.retryButton,
                      isComposerBusy ? styles.retryButtonDisabled : null,
                    ]}
                  >
                    {isComposerBusy ? (
                      <IosSpinner color="#ffffff" size="small" />
                    ) : (
                      <Text allowFontScaling={false} style={styles.retryButtonText}>
                        {pendingSendRetryKind === 'voice'
                          ? 'Sesliyi tekrar dene'
                          : 'Mesaji tekrar dene'}
                      </Text>
                    )}
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {voiceDebugChips.length > 0 ? (
              <View style={styles.voiceDebugBanner}>
                <View style={styles.voiceDebugIconWrap}>
                  <FeatherIcon color="#0f766e" name="activity" size={12} />
                </View>
                <View style={styles.voiceDebugChipWrap}>
                  {voiceDebugChips.map(chip => (
                    <View key={chip} style={styles.voiceDebugChip}>
                      <Text allowFontScaling={false} style={styles.voiceDebugChipText}>
                        {chip}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            <View style={[styles.composerRow, styles.composerRowRelative]}>
              {isVoiceRecording ? (
                <Animated.View
                  style={[
                    styles.voiceRecordingComposerOverlay,
                    { transform: [{ translateX: voiceRecordingGestureOffsetX }] },
                  ]}
                  className="rounded-full"
                >
                  <View className="flex-1 flex-row items-center rounded-full border border-[#dbe3ee] bg-white px-2 py-[3px] shadow-sm">
                      {isVoiceRecordingDraftState ? (
                          <View className="h-[20px] flex-1 flex-row items-center overflow-hidden">
                            <View className="h-[4px] flex-1 rounded-full bg-[#dbe3ee]">
                              <View
                                className="h-full bg-[#ef4444]"
                                style={voiceRecordingPreviewProgressStyle}
                              />
                            </View>
                          </View>
                      ) : (
                        <View className="flex-1 justify-center">
                          <Animated.View
                            style={{ opacity: voiceRecordingGuideOpacity }}
                            className="flex-row items-center justify-start ml-2"
                          >
                            <FeatherIcon color="#64748b" name="chevron-left" size={14} />
                            <Text
                              allowFontScaling={false}
                              className="ml-2 text-[13px] font-medium text-[#64748b]"
                              numberOfLines={1}
                            >
                              {voiceHoldGuideText.length > 0
                                ? voiceHoldGuideText
                                : 'Sola kaydir, iptal et'}
                            </Text>
                          </Animated.View>
                        </View>
                      )}

                    <View className="mx-2 flex-1 flex-row items-center">
                      <Text
                        allowFontScaling={false}
                        className="mr-2 text-[14px] font-bold tracking-tight text-[#111827]"
                      >
                        {formatVoiceSeconds(
                          isVoiceRecordingPreview && voiceRecordingDraft
                            ? previewPlaybackElapsedSec
                            : voiceRecordingSeconds
                        )}
                      </Text>

                      {isVoiceRecordingDraftState ? (
                        <View className="h-[20px] flex-1 flex-row items-center overflow-hidden">
                          {voiceRecordingPreviewBars.slice(0, 18).map((amplitude, barIndex, arr) => {
                            const isPlayed = isVoiceRecordingPreview && voiceRecordingDraft
                              ? (barIndex / arr.length) <= (previewPlaybackElapsedSec / voiceRecordingDraft.durationSec)
                              : false;
                            return (
                              <View
                                key={`recording-preview-${barIndex}`}
                                className="mr-[2.5px] w-[2.5px] rounded-full"
                                style={[
                                  getWaveformBarHeightStyle(amplitude),
                                  getVoiceRecordingPreviewBarStyle(
                                    amplitude,
                                    isPlayed,
                                  ),
                                ]}
                              />
                            );
                          })}
                        </View>
                      ) : (
                        <View className="flex-1">
                          <View className="h-[20px] flex-row items-center overflow-hidden">
                            {voiceRecordingPreviewBars.slice(0, 18).map((amplitude, barIndex) => (
                              <View
                                key={`recording-live-${barIndex}`}
                                className="mr-[2.5px] w-[2.5px] rounded-full"
                                style={[
                                  getWaveformBarHeightStyle(amplitude),
                                  getVoiceRecordingPreviewBarStyle(amplitude, amplitude >= 0.22),
                                ]}
                              />
                            ))}
                          </View>
                          <Animated.View
                            style={{ opacity: voiceRecordingGuideOpacity }}
                            className="mt-[2px] flex-row items-center justify-end pr-2"
                          >
                            <FeatherIcon color="#64748b" name="chevron-left" size={12} />
                            <Text
                              allowFontScaling={false}
                              className="ml-1 text-[11px] font-medium text-[#64748b]"
                              numberOfLines={1}
                            >
                              {voiceHoldGuideText.length > 0
                                ? voiceHoldGuideText
                                : 'Sola kaydir, iptal et'}
                            </Text>
                          </Animated.View>
                        </View>
                      )}
                    </View>

                    {isVoiceRecordingLocked ? (
                      <Pressable
                        className="mr-1 h-[28px] w-[28px] items-center justify-center rounded-full bg-[#f1f5f9]"
                        onPress={() => {
                          stopAndPreviewVoiceRecording().catch(() => { });
                        }}
                      >
                        <FeatherIcon color="#ef4444" name="square" size={12} />
                      </Pressable>
                    ) : isVoiceRecordingPreview ? (
                      <Pressable
                        className="mr-1 h-[28px] w-[28px] items-center justify-center rounded-full bg-[#f1f5f9]"
                        onPress={() => {
                          togglePreviewPlayback().catch(() => { });
                        }}
                      >
                        <FeatherIcon
                          color="#ef4444"
                          name={previewPlaybackPlaying ? 'pause' : 'play'}
                          size={12}
                          style={getPreviewPlaybackIconStyle(
                            previewPlaybackPlaying,
                          )}
                        />
                      </Pressable>
                    ) : null}
                  </View>
                </Animated.View>
              ) : null}
              <Pressable
                disabled={isVoiceRecording || isComposerActionDisabled}
                onPress={toggleAttachmentMenu}
                style={({ pressed }) => [
                  styles.composerSideButton,
                  isConversationInteractionLocked ? styles.composerSideButtonDisabled : null,
                  isAttachmentMenuOpen ? styles.composerSideButtonActive : null,
                  pressed ? styles.composerSideButtonPressed : null,
                  isVoiceRecording ? styles.composerHiddenWhileRecording : null,
                ]}
              >
                <FeatherIcon
                  color={isAttachmentMenuOpen ? '#2563eb' : '#6d7688'}
                  name="plus"
                  size={18}
                />
              </Pressable>
              <View
                style={[
                  styles.composerInputShell,
                  isVoiceRecording ? styles.composerHiddenWhileRecording : null,
                ]}
              >
                <TextInput
                  allowFontScaling={false}
                  autoCapitalize="sentences"
                  autoCorrect={true}
                  className="flex-1 py-0 text-[14px] text-[#1f232d]"
                  editable={!isComposerActionDisabled && !isVoiceRecording}
                  multiline={true}
                  onChangeText={handleComposerChange}
                  placeholder={composerPlaceholder}
                  placeholderTextColor="#7b8598"
                  style={styles.composerInput}
                  value={composerText}
                />
              </View>
              {isVoiceRecording && !isVoiceRecordingDraftState ? (
                <View
                  pointerEvents="none"
                  className="absolute bottom-[54px] right-2 w-[34px] items-center justify-center rounded-full border border-[#e2e8f0] bg-white/95 py-2 shadow-sm"
                >
                  <FeatherIcon color="#64748b" name="lock" size={13} />
                  <FeatherIcon
                    color="#94a3b8"
                    name="chevron-up"
                    size={14}
                    style={voiceRecordingLockChevronStyle}
                  />
                </View>
              ) : null}
              <Pressable
                disabled={isComposerActionDisabled}
                delayLongPress={VOICE_LONG_PRESS_DELAY_MS}
                onPressIn={(e) => {
                  voicePressActiveRef.current = true;
                  if (!isVoiceRecording) {
                    voicePressHandledRef.current = false;
                  }
                  setSendError(null);
                  handleVoiceActionPressIn(e);
                }}
                onLongPress={() => {
                  if (canSend || isVoiceRecording || !voicePressActiveRef.current) {
                    return;
                  }
                  voicePressHandledRef.current = true;
                  beginVoiceRecording('hold', () => voicePressActiveRef.current).catch(
                    () => {
                      voicePressHandledRef.current = false;
                    },
                  );
                }}
                onTouchMove={handleVoiceActionPressMove}
                onPress={() => {
                  if (!canSend && voicePressHandledRef.current) {
                    voicePressHandledRef.current = false;
                    return;
                  }

                  if (canSend) {
                    voicePressHandledRef.current = false;
                    voicePressActiveRef.current = false;
                    handleSend().catch(() => {
                      return;
                    });
                    return;
                  }

                  if (voiceRecordingModeRef.current === 'tap' || voiceRecordingModeRef.current === 'preview') {
                    voicePressHandledRef.current = false;
                    finishVoiceRecording().catch(() => {
                      return;
                    });
                  }
                }}
                onPressOut={() => {
                  voicePressActiveRef.current = false;
                  voiceRecordingPressStartRef.current = null;

                  if (
                    !canSend &&
                    isVoiceRecording &&
                    voiceRecordingModeRef.current === 'hold'
                  ) {
                    finishVoiceRecording().catch(() => {
                      return;
                    });
                  }
                }}
                style={[
                  styles.composerActionButton,
                  canSend ? styles.composerActionButtonSend : null,
                  isVoiceRecording
                    ? isVoiceRecordingDraftState
                      ? styles.composerActionButtonVoiceSend
                      : styles.composerActionButtonRecording
                    : null,
                ]}
              >
                {isComposerBusy ? (
                  <IosSpinner color="#ffffff" size="small" />
                ) : (
                  <FeatherIcon
                    color={composerActionIconColor}
                    name={composerActionIconName}
                    size={18}
                  />
                )}
              </Pressable>
            </View>
          </View>
          {showDetailLoadingOverlay ? (
            <View style={styles.loadingOverlayRoot}>
              <BlurView
                blurAmount={13}
                blurType="light"
                reducedTransparencyFallbackColor="rgba(240, 242, 247, 0.9)"
                style={styles.loadingOverlayBlur}
              />
              <View style={styles.loadingOverlayTint} />
              <IosSpinner color="#ff5a1f" size="large" />
            </View>
          ) : null}
          <Modal
            animationType="fade"
            onRequestClose={closePhotoPreview}
            statusBarTranslucent={true}
            transparent={true}
            visible={isPhotoPreviewVisible}
          >
            <StatusBar
              animated={true}
              backgroundColor="#000000"
              barStyle="light-content"
              hidden={false}
              translucent={true}
            />
            <View style={styles.photoPreviewModalRoot}>
              <Pressable onPress={closePhotoPreview} style={styles.photoPreviewBackdrop} />
              <View style={styles.photoPreviewContent}>
                <Pressable
                  onPress={closePhotoPreview}
                  style={({ pressed }) => [
                    styles.photoPreviewCloseButton,
                    pressed ? styles.photoPreviewCloseButtonPressed : null,
                  ]}
                >
                  <FeatherIcon color="#f8fafc" name="x" size={18} />
                </Pressable>
                <View
                  style={[
                    styles.photoPreviewFrame,
                    { height: photoPreviewFrameHeight },
                  ]}
                >
                  {photoPreviewUri.length > 0 ? (
                    <Image
                      resizeMode="contain"
                      source={{ uri: photoPreviewUri }}
                      style={styles.photoPreviewImage}
                    />
                  ) : null}
                </View>
                {photoPreviewTitle.length > 0 ? (
                  <Text allowFontScaling={false} numberOfLines={1} style={styles.photoPreviewTitle}>
                    {photoPreviewTitle}
                  </Text>
                ) : null}
              </View>
            </View>
          </Modal>
          <Modal
            animationType="fade"
            onRequestClose={() => {
              setIsHeaderMenuOpen(false);
            }}
            statusBarTranslucent={true}
            transparent={true}
            visible={isHeaderMenuOpen}
          >
            <StatusBar
              animated={true}
              backgroundColor="#ffffff"
              barStyle="dark-content"
              hidden={false}
              translucent={false}
            />
            <View style={styles.headerMenuModalRoot}>
              <Pressable
                onPress={() => {
                  setIsHeaderMenuOpen(false);
                }}
                style={styles.headerMenuBackdrop}
              />
              <View
                style={[
                  styles.headerMenuSheet,
                  { top: Math.max(safeTop, 8) + 44 },
                ]}
              >
                <View style={styles.headerMenuInfoCard}>
                  <Text allowFontScaling={false} style={styles.headerMenuInfoText}>
                    {isBlockedIdentity
                      ? 'Bu kullaniciyi engelledin. Sadece sohbeti temizleyebilir veya engeli yonetebilirsin.'
                      : 'Sohbeti yönet ve kullanıcı ayarlarını düzenle.'}
                  </Text>
                </View>
                {!isBlockedIdentity ? (
                  <>
                    <Pressable
                      disabled={headerMenuActionPending}
                      onPress={handleHeaderToggleMuteConversation}
                      style={[
                        styles.headerMenuItem,
                        headerMenuActionPending ? styles.headerMenuItemDisabled : null,
                      ]}
                    >
                      {isMutePending ? (
                        <IosSpinner color="#f8fafc" size="small" />
                      ) : (
                        <FeatherIcon color="#f8fafc" name={muteMenuIcon} size={18} />
                      )}
                      <Text allowFontScaling={false} style={styles.headerMenuItemText}>
                        {isMutePending ? 'İşleniyor...' : muteMenuLabel}
                      </Text>
                    </Pressable>
                    <View style={styles.headerMenuDivider} />
                  </>
                ) : null}
                <Pressable
                  disabled={headerMenuActionPending}
                  onPress={handleHeaderClearConversation}
                  style={[
                    styles.headerMenuItem,
                    headerMenuActionPending ? styles.headerMenuItemDisabled : null,
                  ]}
                >
                  {isClearPending ? (
                    <IosSpinner color="#fde68a" size="small" />
                  ) : (
                    <FeatherIcon color="#fde68a" name="refresh-cw" size={18} />
                  )}
                  <Text
                    allowFontScaling={false}
                    style={[styles.headerMenuItemText, styles.headerMenuItemTextWarning]}
                  >
                    {isClearPending ? 'Temizleniyor...' : 'Sohbeti Temizle'}
                  </Text>
                </Pressable>
                {!isBlockedIdentity ? (
                  <Pressable
                    disabled={headerMenuActionPending}
                    onPress={handleHeaderDeleteConversation}
                    style={[
                      styles.headerMenuItem,
                      headerMenuActionPending ? styles.headerMenuItemDisabled : null,
                    ]}
                  >
                    {isDeletePending ? (
                      <IosSpinner color="#fb7185" size="small" />
                    ) : (
                      <FeatherIcon color="#fb7185" name="x" size={18} />
                    )}
                    <Text
                      allowFontScaling={false}
                      style={[styles.headerMenuItemText, styles.headerMenuItemTextDanger]}
                    >
                      {isDeletePending ? 'Siliniyor...' : 'Sohbeti Sil'}
                    </Text>
                  </Pressable>
                ) : null}
                {canBlockPeer ? (
                  <>
                    <View style={styles.headerMenuDivider} />
                    <Pressable
                      disabled={headerMenuActionPending}
                      onPress={handleHeaderToggleBlockPeer}
                      style={[
                        styles.headerMenuItem,
                        headerMenuActionPending ? styles.headerMenuItemDisabled : null,
                      ]}
                    >
                      {isBlockPending ? (
                        <IosSpinner color="#fb7185" size="small" />
                      ) : (
                        <FeatherIcon
                          color={isPeerBlockedByViewer ? '#facc15' : '#fb7185'}
                          name={isPeerBlockedByViewer ? 'shield' : 'slash'}
                          size={18}
                        />
                      )}
                      <Text
                        allowFontScaling={false}
                        style={[styles.headerMenuItemText, styles.headerMenuItemTextDanger]}
                      >
                        {isBlockPending
                          ? 'İşleniyor...'
                          : isPeerBlockedByViewer
                            ? 'Engeli kaldır'
                            : 'Kullanıcıyı engelle'}
                      </Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            </View>
          </Modal>
          <Modal
            animationType="fade"
            onRequestClose={closeAttachmentMenu}
            statusBarTranslucent={true}
            transparent={true}
            visible={isAttachmentMenuOpen}
          >
            <View style={styles.attachmentSheetModalRoot}>
              <Pressable
                onPress={closeAttachmentMenu}
                style={styles.attachmentSheetBackdrop}
              />
              <View
                style={[
                  styles.attachmentSheetDock,
                  { bottom: Math.max(contentBottomInset, 12) + 82 },
                ]}
              >
                <View style={styles.attachmentSheetCard}>
                  <Text allowFontScaling={false} style={styles.attachmentSheetTitle}>
                    Medya ekle
                  </Text>
                  <View style={styles.attachmentSheetDivider} />
                  <Pressable
                    disabled={isConversationInteractionLocked}
                    onPress={() => {
                      handlePickGalleryPhoto().catch(() => {
                        return;
                      });
                    }}
                    style={({ pressed }) => [
                      styles.attachmentSheetItem,
                      pressed ? styles.attachmentSheetItemPressed : null,
                      isConversationInteractionLocked
                        ? styles.attachmentSheetItemDisabled
                        : null,
                    ]}
                  >
                    <View
                      style={[
                        styles.attachmentSheetIconWrap,
                        styles.attachmentSheetIconWrapGallery,
                      ]}
                    >
                      <FeatherIcon color="#2563eb" name="image" size={13} />
                    </View>
                    <Text allowFontScaling={false} style={styles.attachmentSheetText}>
                      Galeriden fotoğraf seç
                    </Text>
                  </Pressable>
                  <View style={styles.attachmentSheetDivider} />
                  <Pressable
                    disabled={isConversationInteractionLocked}
                    onPress={handleOpenCameraPicker}
                    style={({ pressed }) => [
                      styles.attachmentSheetItem,
                      pressed ? styles.attachmentSheetItemPressed : null,
                      isConversationInteractionLocked
                        ? styles.attachmentSheetItemDisabled
                        : null,
                    ]}
                  >
                    <View
                      style={[
                        styles.attachmentSheetIconWrap,
                        styles.attachmentSheetIconWrapCamera,
                      ]}
                    >
                      <FeatherIcon color="#0ea5e9" name="camera" size={13} />
                    </View>
                    <Text allowFontScaling={false} style={styles.attachmentSheetText}>
                      Kameradan fotoğraf çek
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
          <CameraCaptureModal
            onCaptureComplete={handleAttachmentCameraCapture}
            onClose={() => {
              setIsAttachmentCameraVisible(false);
            }}
            safeBottom={contentBottomInset}
            safeTop={safeTop}
            visible={isAttachmentCameraVisible}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
      {blockUserConfirmSheet}
    </Fragment>
    );
  }

  return (
    <Fragment>
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <StatusBar
        animated={true}
        backgroundColor="#ffffff"
        barStyle="dark-content"
        translucent={false}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <FlashList
          contentContainerStyle={listContentStyle}
          data={filteredConversations}
          drawDistance={CONVERSATION_ESTIMATED_ITEM_SIZE * 10}
          keyExtractor={item => item.conversationId}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={renderEmptyState}
          ListFooterComponent={conversationListFooterComponent}
          ListHeaderComponent={listHeader}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          onRefresh={handleConversationRefresh}
          refreshing={isRefreshing}
          removeClippedSubviews={Platform.OS === 'android'}
          renderItem={renderConversation}
          showsVerticalScrollIndicator={false}
        />
        {showListLoadingOverlay ? (
          <View style={styles.loadingOverlayRoot}>
            <BlurView
              blurAmount={13}
              blurType="light"
              reducedTransparencyFallbackColor="rgba(240, 242, 247, 0.9)"
              style={styles.loadingOverlayBlur}
            />
            <View style={styles.loadingOverlayTint} />
            <IosSpinner color="#ff5a1f" size="large" />
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <NewConversationModal
        backdropOpacity={newConversationBackdropOpacity}
        cardOpacity={newConversationCardOpacity}
        cardTranslateY={newConversationCardTranslateY}
        contentBottomInset={contentBottomInset}
        errorMessage={newConversationError}
        initialMessage={newConversationInitialMessage}
        inputRef={newConversationSearchInputRef}
        isCreating={newConversationCreating}
        isLoading={newConversationLoading}
        isOpen={isNewConversationOpen}
        onChangeInitialMessage={setNewConversationInitialMessage}
        onChangeQuery={value => {
          setNewConversationQuery(value);
          if (newConversationRecipient) {
            setNewConversationRecipient(null);
          }
        }}
        onClose={closeNewConversationPanel}
        onSelectUser={handleSelectNewConversationRecipient}
        onSubmit={() => {
          handleCreateConversation().catch(() => {
            return;
          });
        }}
        query={newConversationQuery}
        resultsTitle={newConversationResultsTitle}
        selectedUser={newConversationRecipient}
        sheetHalfOpenOffset={newConversationSheetHalfOpenOffset}
        sheetHiddenOffset={newConversationSheetHiddenOffset}
        showEmptyState={showNewConversationEmpty}
        showIdleState={showNewConversationIdleState}
        users={newConversationPanelUsers}
      />
    </SafeAreaView>
    {blockUserConfirmSheet}
    </Fragment>
  );
}

const styles = StyleSheet.create({
  avatarFallback: {
    color: '#171a21',
    fontSize: 16,
    fontWeight: '400',
  },
  avatarImage: {
    height: 52,
    width: 52,
  },
  avatarShell: {
    alignItems: 'center',
    backgroundColor: '#e8ebf2',
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
    width: 52,
  },
  backButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    marginRight: 6,
    width: 36,
  },
  composerContainer: {
    backgroundColor: '#f6f8fc',
    borderTopColor: '#d8e0ee',
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
    position: 'relative',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 5,
    zIndex: 30,
  },
  detailScrollToLatestDock: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: -14,
    zIndex: 70,
  },
  detailScrollToLatestBar: {
    alignItems: 'center',
    backgroundColor: '#111827',
    borderColor: '#243047',
    borderRadius: 999,
    borderWidth: 1,
    elevation: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 30,
    paddingHorizontal: 12,
    paddingVertical: 5,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  detailScrollToLatestBarPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.97 }],
  },
  detailScrollToLatestText: {
    color: '#f8fafc',
    fontSize: 11.5,
    fontWeight: '700',
    marginLeft: 5,
  },
  composerInput: {
    maxHeight: 116,
    minHeight: 46,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  voiceDebugBanner: {
    alignItems: 'flex-start',
    backgroundColor: '#f5fbfa',
    borderColor: '#cfe8e4',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  voiceDebugChip: {
    backgroundColor: '#ffffff',
    borderColor: '#d9ece8',
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 6,
    marginRight: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  voiceDebugChipText: {
    color: '#0f172a',
    fontSize: 10.5,
    fontWeight: '700',
  },
  voiceDebugChipWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  voiceDebugIconWrap: {
    alignItems: 'center',
    backgroundColor: '#e6f6f3',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 2,
    width: 24,
  },
  composerInputShell: {
    backgroundColor: '#ffffff',
    borderColor: '#cfd8e7',
    borderRadius: 26,
    borderWidth: 1.2,
    flex: 1,
    marginHorizontal: 8,
    minHeight: 48,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  composerRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  composerRowRelative: {
    position: 'relative',
  },
  attachmentSheetModalRoot: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  attachmentSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.2)',
  },
  attachmentSheetDock: {
    left: 8,
    position: 'absolute',
    zIndex: 60,
  },
  attachmentSheetCard: {
    backgroundColor: '#ffffff',
    borderColor: '#d8e1ef',
    borderRadius: 14,
    borderWidth: 1,
    width: 244,
    paddingVertical: 8,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 12,
    overflow: 'hidden',
  },
  attachmentSheetTitle: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
    paddingBottom: 6,
    paddingHorizontal: 12,
  },
  attachmentSheetDivider: {
    backgroundColor: '#edf2f7',
    height: 1,
    marginHorizontal: 10,
  },
  attachmentSheetItem: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  attachmentSheetItemPressed: {
    backgroundColor: '#f7faff',
  },
  attachmentSheetItemDisabled: {
    opacity: 0.58,
  },
  attachmentSheetIconWrap: {
    alignItems: 'center',
    borderRadius: 11,
    height: 28,
    justifyContent: 'center',
    marginRight: 10,
    width: 28,
  },
  attachmentSheetIconWrapGallery: {
    backgroundColor: '#eaf2ff',
  },
  attachmentSheetIconWrapCamera: {
    backgroundColor: '#e8f7ff',
  },
  attachmentSheetText: {
    color: '#1f2937',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0,
    lineHeight: 18,
  },
  composerHiddenWhileRecording: {
    opacity: 0,
  },
  composerSideButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#cfd8e7',
    borderRadius: 24,
    borderWidth: 1.2,
    height: 48,
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    width: 48,
    elevation: 2,
  },
  composerSideButtonActive: {
    backgroundColor: '#fff5ef',
    borderColor: '#ffd8c5',
    shadowColor: '#ff5a1f',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
  },
  composerSideButtonPressed: {
    transform: [{ scale: 0.96 }],
  },
  composerSideButtonDisabled: {
    opacity: 0.58,
  },
  composerActionButton: {
    alignItems: 'center',
    backgroundColor: '#dfe6f1',
    borderColor: '#c8d2e3',
    borderRadius: 24,
    borderWidth: 1.2,
    height: 48,
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    width: 48,
    elevation: 2,
  },
  composerActionButtonSend: {
    backgroundColor: '#ff6a1f',
  },
  composerActionButtonRecording: {
    backgroundColor: '#ef4444',
  },
  composerActionButtonVoiceSend: {
    backgroundColor: '#22c55e',
  },
  voiceRecordingComposerOverlay: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 52,
    top: 0,
    zIndex: 10,
  },
  voiceRecordingPulseHalo: {
    transform: [{ scale: 1.5 }],
  },
  contentPad: {
    paddingHorizontal: 12,
  },
  stateCard: {
    maxWidth: 340,
  },
  conversationBody: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 54,
  },
  conversationMutedPill: {
    alignItems: 'center',
    backgroundColor: '#eef1f6',
    borderRadius: 99,
    height: 16,
    justifyContent: 'center',
    marginLeft: 6,
    width: 16,
  },
  requestInboxCard: {
    alignItems: 'center',
    backgroundColor: '#fbfcfe',
    borderColor: '#dbe3ef',
    borderRadius: 22,
    borderWidth: 1,
    elevation: 3,
    flexDirection: 'row',
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
  },
  requestInboxCardActive: {
    backgroundColor: '#f3f6fb',
    borderColor: '#c7d5ea',
  },
  requestInboxPreview: {
    alignItems: 'center',
    flexDirection: 'row',
    width: 56,
  },
  requestInboxAvatarShell: {
    alignItems: 'center',
    backgroundColor: '#eef2f7',
    borderColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 2,
    height: 36,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 36,
  },
  requestInboxAvatarOverlap: {
    marginLeft: -10,
  },
  requestInboxAvatarImage: {
    height: '100%',
    width: '100%',
  },
  requestInboxAvatarFallback: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  requestInboxIconWrap: {
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  requestInboxIconWrapActive: {
    backgroundColor: '#e5e7eb',
  },
  requestInboxCopy: {
    flex: 1,
    marginLeft: 12,
    marginRight: 10,
  },
  requestInboxTitle: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
  },
  requestInboxSubtitle: {
    color: '#64748b',
    fontSize: 11.75,
    lineHeight: 16,
    marginTop: 2,
  },
  requestInboxMeta: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  requestInboxCountBadge: {
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 999,
    justifyContent: 'center',
    marginRight: 8,
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  requestInboxCountText: {
    color: '#ffffff',
    fontSize: 10.5,
    fontWeight: '700',
  },
  requestPill: {
    alignItems: 'center',
    backgroundColor: '#e9f2ff',
    borderColor: '#bfdbfe',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    marginLeft: 6,
    minHeight: 18,
    minWidth: 42,
    paddingHorizontal: 8,
  },
  requestPillText: {
    color: '#1d4ed8',
    fontSize: 10.5,
    fontWeight: '700',
  },
  requestHeaderCard: {
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 2,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  requestHeaderTitle: {
    color: '#6b7280',
    fontSize: 11,
    lineHeight: 16,
  },
  requestHeaderDivider: {
    backgroundColor: '#e5e7eb',
    height: 1,
    marginVertical: 8,
    width: '100%',
  },
  requestHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  requestHeaderRowLead: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  requestHeaderRowText: {
    color: '#4b5563',
    fontSize: 11.5,
    marginLeft: 6,
  },
  requestHeaderRowCount: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '700',
  },
  searchUsersCard: {
    backgroundColor: '#fbfcfe',
    borderColor: '#dbe3ef',
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  searchUsersHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  searchUsersTitle: {
    color: '#111827',
    fontSize: 13.5,
    fontWeight: '700',
  },
  searchUsersMeta: {
    color: '#64748b',
    fontSize: 11.5,
    fontWeight: '600',
  },
  searchUsersErrorText: {
    color: '#b42318',
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 8,
  },
  searchUsersEmptyText: {
    color: '#64748b',
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 10,
  },
  searchUserRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 12,
  },
  searchUserAvatarShell: {
    alignItems: 'center',
    backgroundColor: '#ecf0f6',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
    width: 44,
  },
  searchUserAvatarImage: {
    height: '100%',
    width: '100%',
  },
  searchUserAvatarFallback: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
  },
  searchUserTextBlock: {
    flex: 1,
    marginRight: 12,
    minWidth: 0,
  },
  searchUserNameRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  searchUserName: {
    color: '#111827',
    flexShrink: 1,
    fontSize: 13.5,
    fontWeight: '700',
  },
  searchUserHandle: {
    color: '#64748b',
    fontSize: 11.5,
    marginTop: 2,
  },
  searchUserStatusPill: {
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    marginLeft: 8,
    minHeight: 18,
    paddingHorizontal: 8,
  },
  searchUserStatusPillText: {
    color: '#1d4ed8',
    fontSize: 10.5,
    fontWeight: '700',
  },
  searchUserActionButton: {
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 999,
    justifyContent: 'center',
    minHeight: 34,
    minWidth: 88,
    paddingHorizontal: 14,
  },
  searchUserActionButtonSecondary: {
    backgroundColor: '#eef2f7',
    borderColor: '#dbe3ef',
    borderWidth: 1,
  },
  searchUserActionButtonText: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '700',
  },
  searchUserActionButtonTextSecondary: {
    color: '#111827',
  },
  searchConversationHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  searchConversationHeaderTitle: {
    color: '#475467',
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  searchConversationHeaderMeta: {
    color: '#98a2b3',
    fontSize: 11,
    fontWeight: '600',
  },
  requestConversationPressable: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
  },
  requestConversationRow: {
    alignItems: 'stretch',
    backgroundColor: '#ffffff',
    borderBottomWidth: 0,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e6edf5',
    flexDirection: 'column',
    marginBottom: 10,
    paddingBottom: 12,
    paddingTop: 12,
  },
  requestActionButton: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 14,
  },
  requestActionButtonDisabled: {
    opacity: 0.65,
  },
  requestActionButtonPrimary: {
    backgroundColor: '#1d9bf0',
  },
  requestActionButtonPrimaryText: {
    color: '#ffffff',
    fontSize: 12.5,
    fontWeight: '700',
  },
  requestActionButtonDanger: {
    backgroundColor: '#fff5f5',
    borderColor: '#fecaca',
    borderWidth: 1,
  },
  requestActionButtonDangerText: {
    color: '#dc2626',
    fontSize: 12.5,
    fontWeight: '700',
  },
  requestActionButtonSecondary: {
    backgroundColor: '#f8fafc',
    borderColor: '#d8e1ec',
    borderWidth: 1,
  },
  requestActionButtonSecondaryText: {
    color: '#475569',
    fontSize: 12.5,
    fontWeight: '700',
  },
  requestActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 18,
  },
  conversationRow: {
    alignItems: 'center',
    borderBottomColor: '#e5e8ee',
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  detailAvatarImage: {
    height: 38,
    width: 38,
  },
  detailAvatarShell: {
    alignItems: 'center',
    backgroundColor: '#e8ebf2',
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    marginRight: 9,
    overflow: 'hidden',
    width: 38,
  },
  detailDivider: {
    backgroundColor: '#dde2ea',
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
  detailTimelineBackdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  detailTimelineGlow: {
    borderRadius: 999,
    height: 240,
    position: 'absolute',
    width: 240,
  },
  detailTimelineGlowPrimary: {
    backgroundColor: 'rgba(255, 117, 73, 0.10)',
    right: -56,
    top: -28,
  },
  detailTimelineGlowSecondary: {
    backgroundColor: 'rgba(148, 163, 184, 0.10)',
    bottom: -72,
    left: -74,
  },
  detailTimelineStage: {
    backgroundColor: '#ffffff',
    flex: 1,
    overflow: 'hidden',
  },
  detailEmptyIcon: {
    marginBottom: 12,
  },
  detailEmptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    zIndex: 1,
  },
  detailEmptyState: {
    alignItems: 'center',
    maxWidth: 280,
  },
  detailEmptyText: {
    color: '#697080',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    textAlign: 'center',
  },
  detailEmptyTitle: {
    color: '#15171c',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  detailHeader: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    paddingBottom: 8,
    paddingHorizontal: 8,
  },
  detailHeaderProfile: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
  },
  detailHeaderAvatarPressTarget: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 40,
    paddingHorizontal: 1,
    paddingVertical: 1,
  },
  detailHeaderTextPressTarget: {
    borderRadius: 12,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  detailHeaderTextBlock: {
    flex: 1,
    paddingRight: 8,
  },
  detailPresenceDot: {
    backgroundColor: '#b9c1d0',
    borderRadius: 4,
    height: 8,
    marginRight: 6,
    width: 8,
  },
  detailPresenceDotOnline: {
    backgroundColor: '#22c55e',
  },
  detailPresenceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: -3,
  },
  detailPeerName: {
    color: '#171a21',
    fontSize: 15,
    fontWeight: '400',
  },
  detailPeerSubtitle: {
    color: '#7e8594',
    fontSize: 11,
    marginTop: 1,
  },
  detailStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 360,
    paddingHorizontal: 16,
    width: '100%',
  },
  detailStateText: {
    color: '#697080',
    fontSize: 14,
    marginTop: 10,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 18,
    width: '100%',
  },
  emptyStateIconWrap: {
    alignItems: 'center',
    backgroundColor: '#e8ebf1',
    borderRadius: 34,
    height: 68,
    justifyContent: 'center',
    marginBottom: 20,
    width: 68,
  },
  emptyStateTitle: {
    color: '#15171c',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyStateSubtitle: {
    color: '#646c7d',
    fontSize: 14,
    marginTop: 6,
    textAlign: 'center',
  },
  voiceRecordingPill: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#fff2f0',
    borderColor: '#fecaca',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  voiceRecordingDot: {
    backgroundColor: '#ef4444',
    borderRadius: 4,
    height: 8,
    marginRight: 8,
    width: 8,
  },
  voiceRecordingText: {
    color: '#9f1239',
    fontSize: 11.5,
    fontWeight: '600',
    marginRight: 8,
  },
  voiceRecordingHintText: {
    color: '#991b1b',
    fontSize: 10.5,
    marginBottom: 6,
    marginLeft: 4,
  },
  voiceRecordingWaveBar: {
    backgroundColor: '#ef4444',
    borderRadius: 999,
    marginRight: 2,
    width: 2.5,
  },
  voiceRecordingWaveRow: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    minHeight: 22,
  },
  voiceRecordingCancelButton: {
    alignItems: 'center',
    backgroundColor: '#fee2e2',
    borderColor: '#fecaca',
    borderRadius: 11,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    marginLeft: 8,
    width: 22,
  },
  errorCard: {
    backgroundColor: '#fff4f2',
    borderColor: '#ffd4cc',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorText: {
    color: '#a0422b',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  errorTitle: {
    color: '#782e1f',
    fontSize: 14,
    fontWeight: '400',
  },
  flex: {
    flex: 1,
  },
  loadingOverlayBlur: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingOverlayRoot: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
  },
  loadingOverlayTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(16, 22, 34, 0.16)',
  },
  footerLoader: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  headerMenuButton: {
    alignItems: 'center',
    backgroundColor: '#eef1f6',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  headerMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(7, 12, 24, 0.2)',
  },
  headerMenuItem: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  headerMenuItemDisabled: {
    opacity: 0.62,
  },
  headerMenuItemText: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 12,
  },
  headerMenuInfoCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(148, 163, 184, 0.18)',
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerMenuInfoText: {
    color: '#cbd5e1',
    fontSize: 12.5,
    lineHeight: 18,
  },
  headerMenuItemTextDanger: {
    color: '#fb7185',
  },
  headerMenuItemTextWarning: {
    color: '#fde68a',
  },
  headerMenuDivider: {
    backgroundColor: 'rgba(148, 163, 184, 0.26)',
    height: 1,
    marginHorizontal: 10,
    marginVertical: 8,
  },
  headerMenuModalRoot: {
    flex: 1,
  },
  headerMenuSheet: {
    backgroundColor: '#0f172a',
    borderColor: 'rgba(148, 163, 184, 0.28)',
    borderRadius: 14,
    borderWidth: 1,
    width: 260,
    paddingHorizontal: 10,
    paddingVertical: 10,
    position: 'absolute',
    right: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  headerContainer: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
  },
  headerActionButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dbe4ef',
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    width: 36,
  },
  headerActionButtonSpacing: {
    marginLeft: 6,
  },
  headerComposeActionButton: {
    backgroundColor: '#fcfdff',
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  headerTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 2,
  },
  headerDivider: {
    backgroundColor: '#e3e6ed',
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
  globalQueueBadge: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    marginLeft: 10,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  globalQueueBadgeText: {
    color: '#9a3412',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 5,
  },
  messageBody: {
    fontSize: 14.5,
    lineHeight: 20,
  },
  messageBodyMine: {
    color: '#18202c',
  },
  messageBodyPeer: {
    color: '#18202c',
  },
  messageBubble: {
    borderRadius: 22,
    borderWidth: 1,
    maxWidth: '84%',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  messageBubbleMine: {
    backgroundColor: '#ffffff',
    borderColor: '#e5ebf3',
    elevation: 0,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0,
    shadowRadius: 0,
  },
  messageBubblePeer: {
    backgroundColor: '#ffffff',
    borderColor: '#e5ebf3',
    elevation: 0,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0,
    shadowRadius: 0,
  },
  messageBubbleMineJoinedAbove: {
    borderTopRightRadius: 10,
  },
  messageBubbleMineJoinedBelow: {
    borderBottomRightRadius: 10,
  },
  messageBubblePeerJoinedAbove: {
    borderTopLeftRadius: 10,
  },
  messageBubblePeerJoinedBelow: {
    borderBottomLeftRadius: 10,
  },
  messageBubbleVoice: {
    maxWidth: 296,
    minWidth: 220,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  messageBubblePhoto: {
    maxWidth: 272,
    minWidth: 188,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  messageBubbleTime: {
    fontSize: 10.5,
    letterSpacing: 0.2,
  },
  messageDeliveryText: {
    fontSize: 10,
    marginLeft: 8,
  },
  messageDeliveryTextDelivered: {
    color: '#f2c8b7',
  },
  messageDeliveryIconMine: {
    marginLeft: 0,
  },
  messageDeliveryIconPeer: {
    marginLeft: 0,
  },
  messageDeliveryIconWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    minWidth: 14,
  },
  messageDeliveryStatusPill: {
    alignItems: 'center',
    borderRadius: 999,
    height: 18,
    justifyContent: 'center',
    minWidth: 18,
    paddingHorizontal: 4,
  },
  messageDeliveryStatusPillPending: {
    backgroundColor: '#fff7ed',
  },
  messageDeliveryStatusPillSending: {
    backgroundColor: '#eef2f7',
  },
  messageDeliveryIconSecond: {
    marginLeft: -5,
  },
  messageDeliveryTextRead: {
    color: '#f7f8fb',
  },
  messageBubbleTimeMine: {
    color: '#9ca3af',
    textAlign: 'right',
  },
  messageBubbleTimePeer: {
    color: '#7b8494',
    textAlign: 'left',
  },
  messagePreview: {
    color: '#656d7c',
    flex: 1,
    fontSize: 12,
    marginRight: 8,
  },
  messageRow: {
    paddingHorizontal: 14,
    paddingVertical: 2,
  },
  messageRowJoinAbove: {
    marginTop: 0,
  },
  messageRowJoinBelow: {
    marginBottom: 0,
  },
  messageDayDivider: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 12,
    marginTop: 10,
    paddingHorizontal: 12,
  },
  messageDayDividerLine: {
    backgroundColor: 'rgba(148, 163, 184, 0.24)',
    flex: 1,
    height: 1,
  },
  messageDayDividerText: {
    color: '#7a8395',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginHorizontal: 10,
    textTransform: 'uppercase',
  },
  messageMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 6,
    paddingHorizontal: 4,
  },
  messageMetaRowCompact: {
    marginTop: 4,
  },
  messageMetaRowMine: {
    justifyContent: 'flex-end',
  },
  messageMetaRowPeer: {
    justifyContent: 'flex-start',
  },
  messageMetaStatusGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    marginLeft: 6,
  },
  messageStatusLabel: {
    fontSize: 10.5,
    marginLeft: 4,
  },
  messageStatusLabelDelivered: {
    color: '#98a2b3',
  },
  messageStatusLabelPending: {
    color: '#b45309',
  },
  messageStatusLabelRead: {
    color: '#0f766e',
  },
  messageStatusLabelSending: {
    color: '#64748b',
  },
  richMessageIconWrap: {
    alignItems: 'center',
    borderRadius: 10,
    height: 20,
    justifyContent: 'center',
    marginRight: 6,
    width: 20,
  },
  richMessageIconWrapMine: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  richMessageIconWrapPeer: {
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
  },
  richMessageLabel: {
    flexShrink: 1,
    marginLeft: 8,
  },
  richMessageRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  richPhotoMessageCard: {
    width: '100%',
  },
  richPhotoMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  richPhotoPreviewShell: {
    aspectRatio: 4 / 3,
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
    overflow: 'hidden',
    width: '100%',
  },
  richPhotoPreviewShellPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.992 }],
  },
  richPhotoPreviewImage: {
    height: '100%',
    width: '100%',
  },
  richPhotoTitle: {
    marginLeft: 6,
  },
  richMessageVoiceCard: {
    alignItems: 'stretch',
    flexDirection: 'column',
    minWidth: 214,
  },
  richMessageVoiceUploadingOverlay: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.2)',
  },
  richMessageVoiceUploadingText: {
    flex: 1,
    fontSize: 11,
    marginLeft: 8,
  },
  richMessageVoiceUploadingTextMine: {
    color: '#ff6a2f',
  },
  richMessageVoiceUploadingTextPeer: {
    color: '#6b7280',
  },
  richMessageVoiceCardInner: {
    alignItems: 'stretch',
    flexDirection: 'row',
  },
  richMessageVoiceMain: {
    flex: 1,
    minWidth: 0,
  },
  richMessageVoiceHeadline: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  richMessageVoiceTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  richMessageVoiceLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.08,
  },
  richMessageVoiceLabelMine: {
    color: '#374151',
  },
  richMessageVoiceLabelPeer: {
    color: '#374151',
  },
  richMessageVoiceMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  richMessageVoicePlayButton: {
    alignItems: 'center',
    borderRadius: 23,
    borderWidth: 1,
    height: 46,
    justifyContent: 'center',
    marginRight: 10,
    width: 46,
  },
  richMessageVoicePlayButtonMine: {
    backgroundColor: '#f8fafc',
    borderColor: '#dbe4ee',
  },
  richMessageVoicePlayButtonPeer: {
    backgroundColor: '#f8fafc',
    borderColor: '#dbe4ee',
  },
  richMessageVoicePlayButtonActive: {
    backgroundColor: '#fff1ea',
    borderColor: '#ffd1be',
  },
  richMessageVoicePlayButtonDisabled: {
    opacity: 0.55,
  },
  richMessageVoicePlayButtonCore: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  richMessageVoicePlayButtonCoreMine: {
    backgroundColor: '#ffffff',
  },
  richMessageVoicePlayButtonCorePeer: {
    backgroundColor: '#ffffff',
  },
  richMessageVoicePlayButtonCoreActive: {
    backgroundColor: '#ff6a2f',
  },
  richMessageVoicePlayIconPlay: {
    marginLeft: 2,
  },
  richMessageVoiceRateButton: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 22,
    minWidth: 38,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  richMessageVoiceRateButtonMine: {
    backgroundColor: '#f8fafc',
    borderColor: '#dbe4ee',
  },
  richMessageVoiceRateButtonPeer: {
    backgroundColor: '#f8fafc',
    borderColor: '#dbe4ee',
  },
  richMessageVoiceRateButtonActive: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
  },
  richMessageVoiceRateText: {
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  richMessageVoiceRateTextMine: {
    color: '#1f2937',
  },
  richMessageVoiceRateTextPeer: {
    color: '#1f2937',
  },
  richMessageVoiceTime: {
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.2,
    fontSize: 14,
    fontWeight: '800',
  },
  richMessageVoiceTimeLive: {
    color: '#111827',
  },
  richMessageVoiceTimeMine: {
    color: '#243142',
  },
  richMessageVoiceTimePeer: {
    color: '#243142',
  },
  richMessageVoiceSubLabel: {
    fontVariant: ['tabular-nums'],
    fontSize: 10.5,
    fontWeight: '600',
  },
  richMessageVoiceSubLabelMine: {
    color: '#6b7280',
  },
  richMessageVoiceSubLabelPeer: {
    color: '#6b7280',
  },
  richMessageVoiceWaveStage: {
    justifyContent: 'center',
    minHeight: 22,
  },
  richMessageVoiceProgressTrack: {
    backgroundColor: 'rgba(255, 106, 47, 0.12)',
    borderRadius: 999,
    height: 3,
    overflow: 'hidden',
    width: '100%',
  },
  richMessageVoiceProgressFill: {
    borderRadius: 999,
    height: '100%',
    minWidth: 2,
  },
  richMessageVoiceProgressFillMine: {
    backgroundColor: '#ff6a2f',
  },
  richMessageVoiceProgressFillPeer: {
    backgroundColor: '#ff6a2f',
  },
  richMessageWaveBar: {
    borderRadius: 999,
    marginRight: 2,
    width: 3,
  },
  richMessageWaveBarMine: {
    backgroundColor: 'rgba(148, 163, 184, 0.42)',
  },
  richMessageWaveBarPeer: {
    backgroundColor: 'rgba(148, 163, 184, 0.42)',
  },
  richMessageWaveBarMineActive: {
    backgroundColor: '#ff6a2f',
  },
  richMessageWaveBarPeerActive: {
    backgroundColor: '#ff6a2f',
  },
  richMessageWaveBarHeightXs: {
    height: 4,
  },
  richMessageWaveBarHeightSm: {
    height: 6,
  },
  richMessageWaveBarHeightMd: {
    height: 8,
  },
  richMessageWaveBarHeightLg: {
    height: 10,
  },
  richMessageWaveBarHeightXl: {
    height: 12,
  },
  richMessageWaveBarHeight2xl: {
    height: 14,
  },
  richMessageWaveBarHeight3xl: {
    height: 15,
  },
  richMessageWaveRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: -4,
    minHeight: 20,
  },
  messageRowMine: {
    alignItems: 'flex-end',
  },
  messageRowPeer: {
    alignItems: 'flex-start',
  },
  messageTime: {
    color: '#8a90a0',
    flexShrink: 0,
    fontSize: 10,
    marginLeft: 8,
    textAlign: 'right',
  },
  pendingQueueCard: {
    alignItems: 'center',
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pendingQueueCardAction: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    marginLeft: 10,
    minWidth: 92,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pendingQueueCardActionDisabled: {
    opacity: 0.72,
  },
  pendingQueueCardActionText: {
    color: '#9a3412',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  pendingQueueCardBody: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
  },
  pendingQueueCardCopy: {
    flex: 1,
    marginLeft: 10,
  },
  pendingQueueCardIconWrap: {
    alignItems: 'center',
    backgroundColor: '#ffedd5',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  pendingQueueCardText: {
    color: '#9a3412',
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 2,
  },
  pendingQueueCardTitle: {
    color: '#7c2d12',
    fontSize: 12.5,
    fontWeight: '600',
  },
  messageRequestCard: {
    backgroundColor: '#f8fafc',
    borderColor: '#dbe3f0',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  requestComposerBanner: {
    alignItems: 'center',
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  requestComposerBannerIconWrap: {
    alignItems: 'center',
    backgroundColor: '#ffedd5',
    borderRadius: 999,
    height: 24,
    justifyContent: 'center',
    marginRight: 10,
    width: 24,
  },
  requestComposerBannerText: {
    color: '#9a3412',
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
  },
  messageRequestInfoCard: {
    backgroundColor: '#fbfdff',
  },
  messageRequestIdentityRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  messageRequestAvatarWrap: {
    alignItems: 'center',
    backgroundColor: '#e9eef7',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    marginRight: 10,
    overflow: 'hidden',
    width: 44,
  },
  messageRequestAvatar: {
    height: '100%',
    width: '100%',
  },
  messageRequestAvatarFallback: {
    color: '#425066',
    fontSize: 14,
    fontWeight: '700',
  },
  messageRequestIdentityText: {
    flex: 1,
    minWidth: 0,
  },
  messageRequestTitle: {
    color: '#172034',
    fontSize: 13.5,
    fontWeight: '700',
  },
  messageRequestHandle: {
    color: '#6b7280',
    fontSize: 11.5,
    marginTop: 1,
  },
  messageRequestHint: {
    color: '#4b5563',
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 4,
  },
  messageRequestActionRow: {
    flexDirection: 'row',
    marginTop: 9,
  },
  messageRequestActionButton: {
    alignItems: 'center',
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 8,
  },
  messageRequestActionButtonGhost: {
    backgroundColor: '#ffffff',
    borderColor: '#e1e7f0',
    borderWidth: 1,
    marginRight: 8,
  },
  messageRequestActionButtonDanger: {
    backgroundColor: '#fff5f5',
    borderColor: '#fecaca',
    borderWidth: 1,
    marginRight: 8,
  },
  messageRequestActionButtonPrimary: {
    backgroundColor: '#111827',
  },
  messageRequestActionButtonDisabled: {
    opacity: 0.58,
  },
  messageRequestActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  messageRequestActionTextGhost: {
    color: '#334155',
  },
  messageRequestActionTextDanger: {
    color: '#dc2626',
  },
  messageRequestActionTextPrimary: {
    color: '#ffffff',
  },
  peerName: {
    color: '#181c24',
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: '#ff5a1f',
    borderRadius: 12,
    height: 38,
    justifyContent: 'center',
    marginTop: 10,
    minWidth: 120,
    paddingHorizontal: 14,
  },
  retryButtonDisabled: {
    opacity: 0.72,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '400',
  },
  rowBottom: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 3,
  },
  rowTop: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  photoPreviewModalRoot: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPreviewBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 6, 16, 0.86)',
  },
  photoPreviewContent: {
    alignItems: 'center',
    maxWidth: '92%',
    width: '100%',
  },
  photoPreviewCloseButton: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.62)',
    borderColor: 'rgba(203, 213, 225, 0.42)',
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    marginBottom: 10,
    marginRight: 2,
    width: 36,
  },
  photoPreviewCloseButtonPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.96 }],
  },
  photoPreviewFrame: {
    backgroundColor: '#020617',
    borderColor: 'rgba(203, 213, 225, 0.34)',
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 340,
    overflow: 'hidden',
    width: '100%',
  },
  photoPreviewImage: {
    height: '100%',
    width: '100%',
  },
  photoPreviewTitle: {
    color: '#e2e8f0',
    fontSize: 12.5,
    fontWeight: '600',
    marginTop: 10,
    maxWidth: '96%',
    textAlign: 'center',
  },
  screen: {
    backgroundColor: '#f3f4f7',
    flex: 1,
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: '#ff5a1f',
    borderRadius: 17,
    height: 34,
    justifyContent: 'center',
    marginLeft: 8,
    width: 34,
  },
  sendButtonDisabled: {
    backgroundColor: '#c9ced8',
  },
  sendErrorText: {
    color: '#ac3d27',
    fontSize: 12,
  },
  sendErrorContainer: {
    marginBottom: 8,
  },
  connectionBanner: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  connectionBannerAction: {
    marginLeft: 10,
    paddingVertical: 2,
  },
  connectionBannerActionText: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '500',
  },
  connectionBannerBody: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
  },
  connectionBannerInfo: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
    borderWidth: 1,
  },
  connectionBannerText: {
    flex: 1,
    fontSize: 12,
    marginLeft: 8,
  },
  connectionBannerTextInfo: {
    color: '#1d4ed8',
  },
  connectionBannerTextWarning: {
    color: '#92400e',
  },
  connectionBannerWarning: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderWidth: 1,
  },
  unreadBadge: {
    alignItems: 'center',
    backgroundColor: '#ff5a1f',
    borderRadius: 9,
    justifyContent: 'center',
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  unreadBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '400',
  },
});
