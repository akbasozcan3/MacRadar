import { API_BASE_URL, MESSAGES_WS_URL } from '../config/exploreApi';
import {
  encodeRichMessagePayload,
  hydrateConversationMessage,
  hydrateConversationSummary,
  type OutboundRichMessagePayload,
} from '../features/messages/messageContent';
import { apiRequest, getApiSessionToken, isApiRequestError } from './apiClient';
import { resolveProtectedMediaUrl } from './protectedMedia';
import type {
  ConversationClearResponse,
  ConversationCreateRequest,
  ConversationCreateResponse,
  ConversationDeleteResponse,
  ConversationMessageResponse,
  ConversationMessagesResponse,
  ConversationRequestAcceptResponse,
  ConversationRequestRejectResponse,
  ConversationReadResponse,
  ConversationListResponse,
  ConversationMuteResponse,
  MessageRealtimeEvent,
  VoiceUploadRequest,
  VoiceUploadResponse,
} from '../types/MessagesTypes/MessagesTypes';

export type FetchConversationsRequest = {
  cursor?: string;
  limit?: number;
  requestsOnly?: boolean;
  search?: string;
  unreadOnly?: boolean;
};

const VOICE_FILE_PATH_SEGMENT = '/api/v1/messages/voice/files/';

type ConversationVoiceMessageRequest = Omit<VoiceUploadRequest, 'conversationId'>;

function shouldFallbackToLegacyVoiceFlow(error: unknown) {
  if (!isApiRequestError(error)) {
    return false;
  }

  if ([404, 405, 501].includes(error.status)) {
    return true;
  }

  if (error.status !== 400) {
    return false;
  }

  const normalizedCode = String(error.code || '')
    .trim()
    .toLowerCase();
  if (
    normalizedCode === 'invalid_voice_payload' ||
    normalizedCode === 'invalid_request' ||
    normalizedCode === 'missing_sender_id'
  ) {
    return true;
  }

  const normalizedMessage = String(error.message || '')
    .trim()
    .toLowerCase();
  return (
    normalizedMessage.includes('sender id') ||
    normalizedMessage.includes('senderid') ||
    normalizedMessage.includes('voice data')
  );
}

function normalizeConversationSummaryMedia(conversation: ConversationListResponse['conversations'][number]) {
  const hydrated = hydrateConversationSummary(conversation);
  return {
    ...hydrated,
    lastPhotoMessage: hydrated.lastPhotoMessage
      ? {
          ...hydrated.lastPhotoMessage,
          url: hydrated.lastPhotoMessage.url
            ? resolveProtectedMediaUrl(hydrated.lastPhotoMessage.url)
            : hydrated.lastPhotoMessage.url,
        }
      : hydrated.lastPhotoMessage,
    peer: {
      ...hydrated.peer,
      avatarUrl: resolveProtectedMediaUrl(hydrated.peer.avatarUrl),
    },
  };
}

function normalizeConversationMessageMedia(message: ConversationMessagesResponse['messages'][number]) {
  const hydrated = hydrateConversationMessage(message);
  return {
    ...hydrated,
    photoMessage: hydrated.photoMessage
      ? {
          ...hydrated.photoMessage,
          url: hydrated.photoMessage.url
            ? resolveProtectedMediaUrl(hydrated.photoMessage.url)
            : hydrated.photoMessage.url,
        }
      : hydrated.photoMessage,
    voiceMessage: hydrated.voiceMessage
      ? {
          ...hydrated.voiceMessage,
          url: resolveVoicePlaybackUrl(hydrated.voiceMessage.url),
        }
      : hydrated.voiceMessage,
  };
}

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

export function resolveVoicePlaybackUrl(voiceUrl: string) {
  const trimmedVoiceUrl = String(voiceUrl || '').trim();
  if (!trimmedVoiceUrl) {
    return '';
  }

  const resolved = trimmedVoiceUrl.startsWith('/')
    ? `${API_BASE_URL}${trimmedVoiceUrl}`
    : trimmedVoiceUrl;
  if (!resolved.includes(VOICE_FILE_PATH_SEGMENT)) {
    return resolved;
  }

  const token = getApiSessionToken();
  if (!token) {
    return resolved;
  }

  return appendQueryToken(resolved, token);
}

export async function fetchConversations(request?: FetchConversationsRequest) {
  const query = new URLSearchParams();

  if (typeof request?.limit === 'number' && Number.isFinite(request.limit)) {
    query.set('limit', String(Math.max(1, Math.floor(request.limit))));
  }
  if (request?.cursor && request.cursor.trim().length > 0) {
    query.set('cursor', request.cursor.trim());
  }
  if (request?.search && request.search.trim().length > 0) {
    query.set('q', request.search.trim());
  }
  if (request?.unreadOnly) {
    query.set('unread', 'true');
  }
  if (request?.requestsOnly) {
    query.set('requests', 'true');
  }

  const suffix = query.toString();
  const path = suffix
    ? `/api/v1/messages/conversations?${suffix}`
    : '/api/v1/messages/conversations';
  const response = await apiRequest<ConversationListResponse>(path);
  return {
    ...response,
    conversations: response.conversations.map(conversation =>
      normalizeConversationSummaryMedia(conversation),
    ),
  };
}

export type FetchConversationMessagesRequest = {
  cursor?: string;
  limit?: number;
};

export async function fetchConversationMessages(
  conversationId: string,
  request?: FetchConversationMessagesRequest,
) {
  const query = new URLSearchParams();
  if (typeof request?.limit === 'number' && Number.isFinite(request.limit)) {
    query.set('limit', String(Math.max(1, Math.floor(request.limit))));
  }
  if (request?.cursor && request.cursor.trim().length > 0) {
    query.set('cursor', request.cursor.trim());
  }

  const suffix = query.toString();
  const path = suffix
    ? `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/messages?${suffix}`
    : `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/messages`;
  const response = await apiRequest<ConversationMessagesResponse>(path);
  return {
    ...response,
    messages: response.messages.map(message =>
      normalizeConversationMessageMedia(message),
    ),
  };
}

export async function sendConversationMessage(
  conversationId: string,
  text: string,
  options?: { clientNonce?: string },
) {
  const clientNonce = String(options?.clientNonce ?? '').trim();
  const response = await apiRequest<ConversationMessageResponse>(
    `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      body: JSON.stringify(
        clientNonce.length > 0
          ? { clientNonce, text }
          : { text },
      ),
      method: 'POST',
    },
  );
  return {
    ...response,
    conversation: response.conversation
      ? normalizeConversationSummaryMedia(response.conversation)
      : undefined,
    message: normalizeConversationMessageMedia(response.message),
  };
}

export async function createConversation(payload: ConversationCreateRequest) {
  const trimmedRecipientId = payload.recipientId.trim();
  const trimmedInitialMessage = payload.initialMessage?.trim() ?? '';

  const response = await apiRequest<ConversationCreateResponse>(
    '/api/v1/messages/conversations',
    {
      body: JSON.stringify({
        initialMessage: trimmedInitialMessage,
        recipientId: trimmedRecipientId,
      }),
      method: 'POST',
    },
  );
  return {
    ...response,
    conversation: response.conversation
      ? normalizeConversationSummaryMedia(response.conversation)
      : undefined,
    message: response.message
      ? normalizeConversationMessageMedia(response.message)
      : undefined,
  };
}

export async function markConversationRead(
  conversationId: string,
  messageId?: string,
) {
  const payload = messageId ? { messageId } : {};
  return apiRequest<ConversationReadResponse>(
    `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/read`,
    {
      body: JSON.stringify(payload),
      method: 'POST',
    },
  );
}

export async function acceptConversationRequest(conversationId: string) {
  const response = await apiRequest<ConversationRequestAcceptResponse>(
    `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/request/accept`,
    {
      body: JSON.stringify({}),
      method: 'POST',
    },
  );
  return {
    ...response,
    conversation: response.conversation
      ? normalizeConversationSummaryMedia(response.conversation)
      : undefined,
  };
}

export async function rejectConversationRequest(conversationId: string) {
  const response = await apiRequest<ConversationRequestRejectResponse>(
    `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/request/reject`,
    {
      body: JSON.stringify({}),
      method: 'POST',
    },
  );
  return {
    ...response,
    conversation: response.conversation
      ? normalizeConversationSummaryMedia(response.conversation)
      : undefined,
  };
}

export async function setConversationMuted(
  conversationId: string,
  muted: boolean,
) {
  return apiRequest<ConversationMuteResponse>(
    `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/mute`,
    {
      body: JSON.stringify({ muted }),
      method: 'PATCH',
    },
  );
}

export async function clearConversationMessages(conversationId: string) {
  return apiRequest<ConversationClearResponse>(
    `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/clear`,
    {
      body: JSON.stringify({}),
      method: 'POST',
    },
  );
}

export async function deleteConversation(conversationId: string) {
  return apiRequest<ConversationDeleteResponse>(
    `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}`,
    {
      method: 'DELETE',
    },
  );
}

export async function deleteConversationForAll(conversationId: string) {
  return apiRequest<ConversationDeleteResponse>(
    `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/hard`,
    {
      method: 'DELETE',
    },
  );
}

export async function uploadVoiceMessage(
  payload: VoiceUploadRequest,
) {
  const normalizedWaveform = normalizeVoiceWaveform(payload.waveform);

  return apiRequest<VoiceUploadResponse>(
    '/api/v1/messages/voice/upload',
    {
      body: JSON.stringify({
        ...payload,
        clientNonce: String(payload.clientNonce ?? '').trim() || undefined,
        waveform: normalizedWaveform,
      }),
      method: 'POST',
      timeoutMs: 45000,
    },
  );
}

function normalizeVoiceWaveform(waveform: VoiceUploadRequest['waveform']) {
  return Array.isArray(waveform)
    ? waveform
        .map(value => Number(value))
        .filter(value => Number.isFinite(value))
        .map(value => Math.min(1, Math.max(0, value)))
        .slice(0, 256)
    : undefined;
}

function buildVoiceRichMessagePayload(
  uploaded: VoiceUploadResponse['voiceMessage'],
  fallbackWaveform?: number[],
): OutboundRichMessagePayload {
  return {
    durationSec: uploaded.durationSec,
    kind: 'voice',
    mimeType: uploaded.mimeType,
    sizeBytes: uploaded.sizeBytes,
    title: 'Sesli mesaj',
    voiceId: uploaded.id,
    voiceUrl: uploaded.url,
    waveform:
      Array.isArray(uploaded.waveform) && uploaded.waveform.length > 0
        ? uploaded.waveform
        : fallbackWaveform,
  };
}

export async function sendConversationVoiceMessage(
  conversationId: string,
  payload: ConversationVoiceMessageRequest,
) {
  const normalizedWaveform = normalizeVoiceWaveform(payload.waveform);

  try {
    const response = await apiRequest<ConversationMessageResponse>(
      `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/voice`,
      {
        body: JSON.stringify({
          ...payload,
          clientNonce: String(payload.clientNonce ?? '').trim() || undefined,
          waveform: normalizedWaveform,
        }),
        method: 'POST',
        timeoutMs: 45000,
      },
    );
    return {
      ...response,
      conversation: response.conversation
        ? normalizeConversationSummaryMedia(response.conversation)
        : undefined,
      message: normalizeConversationMessageMedia(response.message),
    };
  } catch (error) {
    if (!shouldFallbackToLegacyVoiceFlow(error)) {
      throw error;
    }

    const uploaded = await uploadVoiceMessage({
      ...payload,
      conversationId,
      waveform: normalizedWaveform,
    });
    return sendConversationMessage(
      conversationId,
      encodeRichMessagePayload(
        buildVoiceRichMessagePayload(
          uploaded.voiceMessage,
          normalizedWaveform,
        ),
      ),
      {
        clientNonce: payload.clientNonce,
      },
    );
  }
}

export function createMessagesSocket({
  onMessage,
}: {
  onMessage: (event: MessageRealtimeEvent) => void;
}) {
  const token = getApiSessionToken();
  let targetUrl = MESSAGES_WS_URL;
  if (token) {
    targetUrl = appendQueryToken(targetUrl, token);
  }
  const socket = token
    ? (new (WebSocket as any)(targetUrl, undefined, {
        headers: { Authorization: `Bearer ${token}` },
      }) as WebSocket)
    : new WebSocket(targetUrl);

  socket.onmessage = event => {
    try {
      const parsed = JSON.parse(event.data) as MessageRealtimeEvent;
      onMessage(
        parsed.message
          ? {
              ...parsed,
              message: normalizeConversationMessageMedia(parsed.message),
            }
          : parsed,
      );
    } catch {
      // Ignore malformed events and keep stream alive.
    }
  };

  return socket;
}
