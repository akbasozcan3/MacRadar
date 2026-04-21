import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConversationMessage } from '../types/MessagesTypes/MessagesTypes';

const PROFILE_CACHE_KEY = 'macradar:profile-cache';
const SESSION_TOKEN_KEY = 'macradar:session-token';
const SESSION_SNAPSHOT_KEY = 'macradar:session-snapshot-v1';
const VOICE_PLAYBACK_RATE_KEY_PREFIX = 'macradar:voice-playback-rate:';
const EXPLORE_SHARE_CLICK_KEY_PREFIX = 'macradar:explore-share-click:v1:';
const PENDING_MESSAGES_QUEUE_KEY_PREFIX = 'macradar:messages-pending:v1:';
const PENDING_MESSAGES_QUEUE_MAX_ITEMS = 30;
const PENDING_MESSAGES_QUEUE_MAX_AGE_MS = 1000 * 60 * 60 * 72;

type SessionSnapshot = {
  profile?: unknown;
  token?: string;
  updatedAt: string;
};

export type StoredPendingVoiceDraft = {
  base64: string;
  durationSec: number;
  fileName: string;
  filePath?: string;
  mimeType: string;
  sizeBytes: number;
  waveform?: number[];
};

export type StoredPendingConversationMessage = {
  conversationId: string;
  kind: 'text' | 'voice';
  localMessage: ConversationMessage;
  messageId: string;
  text?: string;
  updatedAt: string;
  voiceDraft?: StoredPendingVoiceDraft;
};

async function readSnapshot() {
  const raw = await AsyncStorage.getItem(SESSION_SNAPSHOT_KEY);
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw) as Partial<SessionSnapshot> | null;
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const next: SessionSnapshot = {
    updatedAt:
      typeof parsed.updatedAt === 'string'
        ? parsed.updatedAt
        : new Date().toISOString(),
  };

  if (typeof parsed.token === 'string' && parsed.token.trim().length > 0) {
    next.token = parsed.token;
  }
  if ('profile' in parsed) {
    next.profile = parsed.profile;
  }

  return next;
}

async function writeSnapshot(snapshot: SessionSnapshot | null) {
  if (!snapshot) {
    await AsyncStorage.removeItem(SESSION_SNAPSHOT_KEY);
    return;
  }

  await AsyncStorage.setItem(SESSION_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

async function updateSnapshot(
  updater: (current: SessionSnapshot | null) => SessionSnapshot | null,
) {
  const current = await readSnapshot();
  const next = updater(current);
  await writeSnapshot(next);
}

async function withRetry<T>(operation: () => Promise<T>, retries = 3) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        // AsyncStorage can occasionally fail transiently during app bootstrap.
        await new Promise<void>(resolve => {
          setTimeout(() => resolve(), 80 * (attempt + 1));
        });
      }
    }
  }

  throw lastError;
}

export async function readStoredSessionToken() {
  try {
    const token = await withRetry(() => AsyncStorage.getItem(SESSION_TOKEN_KEY));
    if (typeof token === 'string' && token.trim().length > 0) {
      return token;
    }

    const snapshot = await readSnapshot();
    if (snapshot?.token && snapshot.token.trim().length > 0) {
      return snapshot.token;
    }

    return null;
  } catch (error) {
    console.warn('Failed to read session token from storage', error);
    return null;
  }
}

export async function storeSessionToken(token: string) {
  try {
    const normalizedToken = token.trim();
    if (normalizedToken.length === 0) {
      return;
    }

    await withRetry(() => AsyncStorage.setItem(SESSION_TOKEN_KEY, normalizedToken));
    await updateSnapshot(current => ({
      ...(current ?? { updatedAt: new Date().toISOString() }),
      token: normalizedToken,
      updatedAt: new Date().toISOString(),
    }));
  } catch (error) {
    console.warn('Failed to persist session token', error);
  }
}

export async function clearStoredSessionToken() {
  try {
    await withRetry(() => AsyncStorage.removeItem(SESSION_TOKEN_KEY));
    await updateSnapshot(current => {
      if (!current) {
        return null;
      }

      const { profile } = current;
      if (typeof profile === 'undefined') {
        return null;
      }

      return {
        profile,
        updatedAt: new Date().toISOString(),
      };
    });
  } catch (error) {
    console.warn('Failed to clear session token', error);
  }
}

export async function readStoredProfileCache<T>() {
  try {
    const raw = await withRetry(() => AsyncStorage.getItem(PROFILE_CACHE_KEY));
    if (raw) {
      return JSON.parse(raw) as T;
    }

    const snapshot = await readSnapshot();
    if (snapshot && 'profile' in snapshot) {
      return snapshot.profile as T;
    }

    return null;
  } catch (error) {
    console.warn('Failed to read profile cache from storage', error);
    return null;
  }
}

export async function storeProfileCache(value: unknown) {
  try {
    const serialized = JSON.stringify(value);
    await withRetry(() => AsyncStorage.setItem(PROFILE_CACHE_KEY, serialized));
    await updateSnapshot(current => ({
      ...(current ?? { updatedAt: new Date().toISOString() }),
      profile: value,
      updatedAt: new Date().toISOString(),
    }));
  } catch (error) {
    console.warn('Failed to persist profile cache', error);
  }
}

export async function clearStoredProfileCache() {
  try {
    await withRetry(() => AsyncStorage.removeItem(PROFILE_CACHE_KEY));
    await updateSnapshot(current => {
      if (!current) {
        return null;
      }

      const { token } = current;
      if (typeof token !== 'string' || token.trim().length === 0) {
        return null;
      }

      return {
        token,
        updatedAt: new Date().toISOString(),
      };
    });
  } catch (error) {
    console.warn('Failed to clear profile cache', error);
  }
}

export async function readStoredVoicePlaybackRate(userId: string) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return null;
  }

  const storageKey = `${VOICE_PLAYBACK_RATE_KEY_PREFIX}${normalizedUserId}`;
  try {
    const raw = await withRetry(() => AsyncStorage.getItem(storageKey));
    const parsed = Number.parseFloat(String(raw ?? ''));
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('Failed to read voice playback rate from storage', error);
    return null;
  }
}

export async function storeVoicePlaybackRate(userId: string, rate: number) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return;
  }

  const safeRate = Number(rate);
  if (!Number.isFinite(safeRate)) {
    return;
  }

  const storageKey = `${VOICE_PLAYBACK_RATE_KEY_PREFIX}${normalizedUserId}`;
  try {
    await withRetry(() => AsyncStorage.setItem(storageKey, String(safeRate)));
  } catch (error) {
    console.warn('Failed to persist voice playback rate', error);
  }
}

export async function clearStoredVoicePlaybackRate(userId: string) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return;
  }

  const storageKey = `${VOICE_PLAYBACK_RATE_KEY_PREFIX}${normalizedUserId}`;
  try {
    await withRetry(() => AsyncStorage.removeItem(storageKey));
  } catch (error) {
    console.warn('Failed to clear voice playback rate', error);
  }
}

function exploreShareClickStorageKey(userId: string, postId: string) {
  return `${EXPLORE_SHARE_CLICK_KEY_PREFIX}${userId}:${postId}`;
}

export async function hasStoredExploreShareClick(userId: string, postId: string) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedPostId = String(postId || '').trim();
  if (!normalizedUserId || !normalizedPostId) {
    return false;
  }

  try {
    const raw = await withRetry(() =>
      AsyncStorage.getItem(
        exploreShareClickStorageKey(normalizedUserId, normalizedPostId),
      ),
    );
    return raw === '1';
  } catch (error) {
    console.warn('Failed to read explore share click state', error);
    return false;
  }
}

export async function storeExploreShareClick(userId: string, postId: string) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedPostId = String(postId || '').trim();
  if (!normalizedUserId || !normalizedPostId) {
    return;
  }

  try {
    await withRetry(() =>
      AsyncStorage.setItem(
        exploreShareClickStorageKey(normalizedUserId, normalizedPostId),
        '1',
      ),
    );
  } catch (error) {
    console.warn('Failed to persist explore share click state', error);
  }
}

function pendingMessagesQueueKey(userId: string) {
  return `${PENDING_MESSAGES_QUEUE_KEY_PREFIX}${userId.trim()}`;
}

function normalizeStoredPendingConversationMessage(
  value: unknown,
): StoredPendingConversationMessage | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<StoredPendingConversationMessage>;
  const conversationId = String(record.conversationId ?? '').trim();
  const messageId = String(record.messageId ?? '').trim();
  const updatedAt = String(record.updatedAt ?? '').trim();
  const kind = record.kind === 'voice' ? 'voice' : record.kind === 'text' ? 'text' : null;
  if (
    !conversationId ||
    !messageId ||
    !updatedAt ||
    !kind ||
    !record.localMessage ||
    typeof record.localMessage !== 'object'
  ) {
    return null;
  }

  const next: StoredPendingConversationMessage = {
    conversationId,
    kind,
    localMessage: record.localMessage as ConversationMessage,
    messageId,
    updatedAt,
  };
  next.localMessage = {
    ...next.localMessage,
    localStatus:
      next.localMessage.localStatus === 'sending' ? 'sending' : 'pending',
  };
  if (typeof record.text === 'string') {
    next.text = record.text;
  }
  if (record.voiceDraft && typeof record.voiceDraft === 'object') {
    next.voiceDraft = record.voiceDraft as StoredPendingVoiceDraft;
  }
  return next;
}

function resolvePendingQueueTimestampMs(item: StoredPendingConversationMessage) {
  const updatedAtMs = new Date(item.updatedAt).getTime();
  if (Number.isFinite(updatedAtMs)) {
    return updatedAtMs;
  }

  const createdAtMs = new Date(item.localMessage.createdAt).getTime();
  if (Number.isFinite(createdAtMs)) {
    return createdAtMs;
  }

  return 0;
}

function pruneStoredPendingConversationMessages(
  items: StoredPendingConversationMessage[],
  nowMs = Date.now(),
) {
  const seenMessageIds = new Set<string>();

  return items
    .flatMap(item => {
      if (item.kind === 'voice' && !item.voiceDraft) {
        return [];
      }

      const timestampMs = resolvePendingQueueTimestampMs(item);
      if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
        return [];
      }

      if (nowMs - timestampMs > PENDING_MESSAGES_QUEUE_MAX_AGE_MS) {
        return [];
      }

      if (seenMessageIds.has(item.messageId)) {
        return [];
      }
      seenMessageIds.add(item.messageId);
      return [
        {
          ...item,
          updatedAt: new Date(timestampMs).toISOString(),
        },
      ];
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, PENDING_MESSAGES_QUEUE_MAX_ITEMS);
}

async function writePendingConversationMessages(
  storageKey: string,
  items: StoredPendingConversationMessage[],
) {
  if (!Array.isArray(items) || items.length === 0) {
    await withRetry(() => AsyncStorage.removeItem(storageKey));
    return;
  }

  await withRetry(() => AsyncStorage.setItem(storageKey, JSON.stringify(items)));
}

export async function readStoredPendingConversationMessages(userId: string) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return [] as StoredPendingConversationMessage[];
  }

  try {
    const raw = await withRetry(() =>
      AsyncStorage.getItem(pendingMessagesQueueKey(normalizedUserId)),
    );
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const normalizedItems = pruneStoredPendingConversationMessages(
      parsed
      .map(item => normalizeStoredPendingConversationMessage(item))
      .filter((item): item is StoredPendingConversationMessage => Boolean(item)),
    );

    const normalizedSerialized = JSON.stringify(normalizedItems);
    if (normalizedSerialized !== raw) {
      await writePendingConversationMessages(
        pendingMessagesQueueKey(normalizedUserId),
        normalizedItems,
      );
    }

    return normalizedItems;
  } catch (error) {
    console.warn('Failed to read pending message queue from storage', error);
    return [];
  }
}

export async function storePendingConversationMessages(
  userId: string,
  items: StoredPendingConversationMessage[],
) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return;
  }

  const storageKey = pendingMessagesQueueKey(normalizedUserId);
  try {
    await writePendingConversationMessages(
      storageKey,
      pruneStoredPendingConversationMessages(items),
    );
  } catch (error) {
    console.warn('Failed to persist pending message queue', error);
  }
}

export async function clearStoredPendingConversationMessages(userId: string) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return;
  }

  try {
    await withRetry(() =>
      AsyncStorage.removeItem(pendingMessagesQueueKey(normalizedUserId)),
    );
  } catch (error) {
    console.warn('Failed to clear pending message queue', error);
  }
}
