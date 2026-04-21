import notifee, {
  AndroidImportance,
  AuthorizationStatus,
  EventType,
} from '@notifee/react-native';
import { PermissionsAndroid, Platform } from 'react-native';

import { NOTIFICATIONS_WS_URL } from '../config/exploreApi';
import { getApiSessionToken } from './apiClient';
import type { ProfileNotificationItem } from './authService';

const ANDROID_SOCIAL_CHANNEL_ID = 'macradar-social-v5';
const ANDROID_MESSAGES_CHANNEL_ID = 'macradar-messages-v5';
const ANDROID_DEFAULT_CHANNEL_ID = 'macradar-default-v3';
// Android expects raw resource file name without extension.
const ANDROID_NOTIFICATION_SOUND = 'mixkit_swoosh_whistle_611';
const IOS_NOTIFICATION_SOUND = 'mixkit_swoosh_whistle_611.wav';
const MAX_DISPLAYED_NOTIFICATION_KEYS = 180;

let initPromise: Promise<void> | null = null;
let foregroundEventUnsubscribe: (() => void) | null = null;
const displayedNotificationKeys = new Set<string>();

type NotificationChannelKind = 'messages' | 'social';

type AndroidNotificationConfig = {
  channelId: string;
  smallIcon: string;
};

export type NotificationRealtimeEvent =
  | {
      serverTime?: string;
      type: 'heartbeat' | 'welcome';
    }
  | {
      request: {
        delta: number;
        kind: 'follow' | 'street';
        reason?: 'accepted' | 'rejected' | 'removed' | 'unknown';
        requesterId: string;
        targetId: string;
      };
      serverTime?: string;
      type: 'request.cancelled' | 'request.created' | 'request.resolved';
    }
  | {
      notification: ProfileNotificationItem;
      serverTime?: string;
      type: 'notification.created';
    };

function appendQueryToken(url: string, token: string) {
  const trimmedToken = token.trim();
  if (!trimmedToken || /[?&](token|access_token)=/i.test(url)) {
    return url;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.get('token') && !parsed.searchParams.get('access_token')) {
      parsed.searchParams.set('token', trimmedToken);
    }
    return parsed.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${encodeURIComponent(trimmedToken)}`;
  }
}

function trimDisplayedNotificationKeys() {
  while (displayedNotificationKeys.size > MAX_DISPLAYED_NOTIFICATION_KEYS) {
    const firstKey = displayedNotificationKeys.values().next().value;
    if (typeof firstKey !== 'string') {
      break;
    }
    displayedNotificationKeys.delete(firstKey);
  }
}

function readNotificationField(
  notification: ProfileNotificationItem,
  key: string,
) {
  const directValue = (notification as Record<string, unknown>)[key];
  if (typeof directValue === 'string' && directValue.trim().length > 0) {
    return directValue.trim();
  }

  const metadata = notification.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return '';
  }

  const metadataValue = (metadata as Record<string, unknown>)[key];
  return typeof metadataValue === 'string' ? metadataValue.trim() : '';
}

function resolveChannelKind(
  notification: Pick<ProfileNotificationItem, 'channel'>,
): NotificationChannelKind {
  return notification.channel === 'messages' ? 'messages' : 'social';
}

function resolveAndroidChannelId(kind: NotificationChannelKind) {
  return kind === 'messages'
    ? ANDROID_MESSAGES_CHANNEL_ID
    : ANDROID_SOCIAL_CHANNEL_ID;
}

function resolveAndroidNotificationConfig(
  notification: Pick<ProfileNotificationItem, 'channel' | 'type'>,
): AndroidNotificationConfig {
  if (notification.channel === 'live_follow' || notification.type === 'live_follow') {
    return {
      channelId: ANDROID_DEFAULT_CHANNEL_ID,
      smallIcon: 'ic_launcher',
    };
  }

  return {
    channelId: resolveAndroidChannelId(resolveChannelKind(notification)),
    smallIcon: 'ic_stat_notification',
  };
}

function buildNotificationDedupeKey(notification: ProfileNotificationItem) {
  const notificationId = String(notification.id || '').trim();
  if (notificationId) {
    return `notification:${notificationId}`;
  }

  const type = String(notification.type || 'generic').trim();
  const actorId = readNotificationField(notification, 'fromUserId')
    || readNotificationField(notification, 'actorId');
  const postId = readNotificationField(notification, 'postId');
  const messageId = readNotificationField(notification, 'messageId');
  const commentId = readNotificationField(notification, 'commentId');

  if (messageId) {
    return `message:${messageId}`;
  }
  if (commentId) {
    return `comment:${commentId}`;
  }
  if (postId) {
    return `${type}:${actorId}:${postId}`;
  }

  return `${type}:${actorId}:${notification.title}:${notification.body}`;
}

async function createNotificationChannels() {
  await Promise.all([
    notifee.createChannel({
      id: ANDROID_DEFAULT_CHANNEL_ID,
      importance: AndroidImportance.HIGH,
      name: 'MacRadar Duyurular',
      sound: ANDROID_NOTIFICATION_SOUND,
    }),
    notifee.createChannel({
      id: ANDROID_MESSAGES_CHANNEL_ID,
      importance: AndroidImportance.HIGH,
      name: 'MacRadar Mesajlar',
      sound: ANDROID_NOTIFICATION_SOUND,
    }),
    notifee.createChannel({
      id: ANDROID_SOCIAL_CHANNEL_ID,
      importance: AndroidImportance.HIGH,
      name: 'MacRadar Sosyal',
      sound: ANDROID_NOTIFICATION_SOUND,
    }),
  ]);
}

async function ensureAndroidPostNotificationsPermission() {
  if (Platform.OS !== 'android') {
    return true;
  }

  const apiLevel = Platform.Version;
  if (typeof apiLevel !== 'number' || apiLevel < 33) {
    return true;
  }

  try {
    const alreadyGranted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    if (alreadyGranted) {
      return true;
    }

    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

async function ensureNotificationPermission() {
  const androidRuntimeOk = await ensureAndroidPostNotificationsPermission();
  if (!androidRuntimeOk) {
    return false;
  }

  const currentSettings = await notifee.getNotificationSettings();
  if (
    currentSettings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
    currentSettings.authorizationStatus === AuthorizationStatus.PROVISIONAL
  ) {
    return true;
  }

  const nextSettings = await notifee.requestPermission();
  return (
    nextSettings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
    nextSettings.authorizationStatus === AuthorizationStatus.PROVISIONAL
  );
}

export async function bootstrapNotifications() {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    await createNotificationChannels();
    await ensureAndroidPostNotificationsPermission();

    if (!foregroundEventUnsubscribe) {
      foregroundEventUnsubscribe = notifee.onForegroundEvent(async ({ type, detail }) => {
        if (type === EventType.PRESS) {
          const notificationId = detail.notification?.id;
          if (notificationId) {
            await notifee.cancelNotification(notificationId).catch(() => {
              return;
            });
          }
        }
      });
    }
  })();

  try {
    await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

async function sendNotification(
  title: string,
  body: string,
  options: {
    androidChannelId: string;
    androidSmallIcon: string;
    channelKind: NotificationChannelKind;
    data?: Record<string, string>;
    dedupeKey: string;
    pressActionId: string;
  },
) {
  if (displayedNotificationKeys.has(options.dedupeKey)) {
    return false;
  }
  displayedNotificationKeys.add(options.dedupeKey);
  trimDisplayedNotificationKeys();

  await bootstrapNotifications();
  const isAuthorized = await ensureNotificationPermission();
  if (!isAuthorized) {
    displayedNotificationKeys.delete(options.dedupeKey);
    throw new Error('Cihaz bildirim izni verilmedi.');
  }

  await notifee.displayNotification({
    android: {
      channelId: options.androidChannelId,
      importance: AndroidImportance.HIGH,
      pressAction: {
        id: options.pressActionId,
      },
      smallIcon: options.androidSmallIcon,
      sound: ANDROID_NOTIFICATION_SOUND,
    },
    body,
    data: options.data,
    ios: {
      sound: IOS_NOTIFICATION_SOUND,
    },
    title,
  });

  return true;
}

export async function displayRealtimeNotification(
  notification: ProfileNotificationItem,
) {
  const title = String(notification.title || '').trim()
    || String(notification.actorFullName || '').trim()
    || 'MacRadar';
  const body = String(notification.body || '').trim() || 'Yeni bildirim';
  const channelKind = resolveChannelKind(notification);
  const androidConfig = resolveAndroidNotificationConfig(notification);

  return sendNotification(title, body, {
    androidChannelId: androidConfig.channelId,
    androidSmallIcon: androidConfig.smallIcon,
    channelKind,
    data: {
      channel: String(notification.channel || ''),
      notificationId: String(notification.id || ''),
      ...(readNotificationField(notification, 'conversationId')
        ? { conversationId: readNotificationField(notification, 'conversationId') }
        : {}),
      ...(readNotificationField(notification, 'messageId')
        ? { messageId: readNotificationField(notification, 'messageId') }
        : {}),
      ...(readNotificationField(notification, 'postId')
        ? { postId: readNotificationField(notification, 'postId') }
        : {}),
      ...(String(notification.type || '').trim()
        ? { type: String(notification.type || '').trim() }
        : {}),
    },
    dedupeKey: buildNotificationDedupeKey(notification),
    pressActionId:
      channelKind === 'messages' ? 'open-conversation' : 'default',
  });
}

export function createNotificationsSocket({
  onEvent,
}: {
  onEvent: (event: NotificationRealtimeEvent) => void;
}) {
  const token = getApiSessionToken();
  const targetUrl = appendQueryToken(NOTIFICATIONS_WS_URL, token || '');
  const socket = new WebSocket(targetUrl);

  socket.onmessage = event => {
    try {
      const parsed = JSON.parse(event.data) as NotificationRealtimeEvent;
      if (
        parsed &&
        (parsed.type === 'welcome' ||
          parsed.type === 'heartbeat' ||
          ((parsed.type === 'request.created' ||
            parsed.type === 'request.resolved' ||
            parsed.type === 'request.cancelled') &&
            parsed.request &&
            (parsed.request.kind === 'follow' || parsed.request.kind === 'street')) ||
          (parsed.type === 'notification.created' && parsed.notification))
      ) {
        onEvent(parsed);
      }
    } catch {
      // Ignore malformed events to keep the stream healthy.
    }
  };

  return socket;
}
