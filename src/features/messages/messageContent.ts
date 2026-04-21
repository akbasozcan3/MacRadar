import type {
  ConversationMessage,
  ConversationSummary,
  LocationMessageAsset,
  MessageContentKind,
  PhotoMessageAsset,
  VoiceMessageAsset,
} from '../../types/MessagesTypes/MessagesTypes';

export const RICH_MESSAGE_PREFIX = '[[MRMSG]]';

export type OutboundVoiceMessagePayload = {
  durationSec?: number;
  kind: 'voice';
  mimeType?: string;
  sizeBytes?: number;
  title?: string;
  voiceId?: string;
  voiceUrl?: string;
  waveform?: number[];
};

export type OutboundPhotoMessagePayload = {
  kind: 'photo';
  mimeType?: string;
  sizeBytes?: number;
  title?: string;
  url?: string;
};

export type OutboundLocationMessagePayload = {
  kind: 'location';
  latitude?: number;
  locationLabel?: string;
  longitude?: number;
  title?: string;
};

export type OutboundRichMessagePayload =
  | OutboundLocationMessagePayload
  | OutboundPhotoMessagePayload
  | OutboundVoiceMessagePayload;

export type ParsedMessageContent = {
  kind: MessageContentKind;
  locationMessage: LocationMessageAsset | null;
  photoMessage: PhotoMessageAsset | null;
  preview: string;
  text: string;
  voiceMessage: VoiceMessageAsset | null;
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function normalizeWaveform(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map(value => Number(value))
    .filter(value => Number.isFinite(value))
    .map(value => clamp01(value))
    .filter(value => value > 0)
    .slice(0, 256);
}

function normalizeVoiceDuration(durationSec: unknown, fallback = 6) {
  if (!Number.isFinite(durationSec)) {
    return fallback;
  }
  return Math.max(1, Math.floor(Number(durationSec)));
}

function normalizePreview(preview: unknown, fallback: string) {
  if (typeof preview !== 'string') {
    return fallback;
  }
  const trimmed = preview.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function buildTextContent(body: string, preview?: unknown): ParsedMessageContent {
  const trimmed = body.trim();
  const resolvedPreview = normalizePreview(preview, trimmed || 'Yeni mesaj');
  return {
    kind: 'text',
    locationMessage: null,
    photoMessage: null,
    preview: resolvedPreview,
    text: body,
    voiceMessage: null,
  };
}

function buildVoiceContent(
  payload: Partial<OutboundVoiceMessagePayload>,
  preview?: unknown,
): ParsedMessageContent {
  const durationSec = normalizeVoiceDuration(payload.durationSec, 6);
  const resolvedPreview = normalizePreview(preview, `Sesli mesaj (${durationSec} sn)`);
  return {
    kind: 'voice',
    locationMessage: null,
    photoMessage: null,
    preview: resolvedPreview,
    text: `${durationSec} sn`,
    voiceMessage: {
      conversationId: '',
      createdAt: '',
      durationSec,
      fileName: '',
      id: typeof payload.voiceId === 'string' ? payload.voiceId.trim() : '',
      mimeType: typeof payload.mimeType === 'string' ? payload.mimeType.trim() : '',
      sizeBytes: Number.isFinite(payload.sizeBytes) ? Math.max(0, Number(payload.sizeBytes)) : 0,
      url: typeof payload.voiceUrl === 'string' ? payload.voiceUrl.trim() : '',
      waveform: normalizeWaveform(payload.waveform),
    },
  };
}

function buildPhotoContent(
  payload: Partial<OutboundPhotoMessagePayload>,
  preview?: unknown,
): ParsedMessageContent {
  const title =
    typeof payload.title === 'string' && payload.title.trim().length > 0
      ? payload.title.trim()
      : 'Fotograf';
  const resolvedPreview = normalizePreview(preview, `Fotograf: ${title}`);
  return {
    kind: 'photo',
    locationMessage: null,
    photoMessage: {
      mimeType: typeof payload.mimeType === 'string' ? payload.mimeType.trim() : '',
      sizeBytes: Number.isFinite(payload.sizeBytes) ? Math.max(0, Number(payload.sizeBytes)) : 0,
      title,
      url: typeof payload.url === 'string' ? payload.url.trim() : '',
    },
    preview: resolvedPreview,
    text: resolvedPreview,
    voiceMessage: null,
  };
}

function buildLocationContent(
  payload: Partial<OutboundLocationMessagePayload>,
  preview?: unknown,
): ParsedMessageContent {
  const locationLabel =
    typeof payload.locationLabel === 'string' && payload.locationLabel.trim().length > 0
      ? payload.locationLabel.trim()
      : 'Konum';
  const resolvedPreview = normalizePreview(preview, `Konum: ${locationLabel}`);
  return {
    kind: 'location',
    locationMessage: {
      latitude: Number.isFinite(payload.latitude) ? Number(payload.latitude) : undefined,
      locationLabel,
      longitude: Number.isFinite(payload.longitude) ? Number(payload.longitude) : undefined,
      title:
        typeof payload.title === 'string' && payload.title.trim().length > 0
          ? payload.title.trim()
          : 'Konum',
    },
    photoMessage: null,
    preview: resolvedPreview,
    text: resolvedPreview,
    voiceMessage: null,
  };
}

export function encodeRichMessagePayload(payload: OutboundRichMessagePayload) {
  return `${RICH_MESSAGE_PREFIX}${JSON.stringify(payload)}`;
}

export function parseMessageContent(
  body: string,
  fallback?: Partial<
    Pick<
      ConversationMessage,
      'kind' | 'locationMessage' | 'photoMessage' | 'preview' | 'voiceMessage'
    >
  >,
): ParsedMessageContent {
  const raw = typeof body === 'string' ? body : '';
  const fallbackKind = fallback?.kind;
  if (fallbackKind === 'voice' && fallback?.voiceMessage) {
    const durationSec = normalizeVoiceDuration(fallback.voiceMessage.durationSec, 6);
    return {
      kind: 'voice',
      locationMessage: null,
      photoMessage: null,
      preview: normalizePreview(fallback.preview, `Sesli mesaj (${durationSec} sn)`),
      text: `${durationSec} sn`,
      voiceMessage: {
        ...fallback.voiceMessage,
        waveform: normalizeWaveform(fallback.voiceMessage.waveform),
      },
    };
  }
  if (fallbackKind === 'photo' && fallback?.photoMessage) {
    return {
      kind: 'photo',
      locationMessage: null,
      photoMessage: fallback.photoMessage,
      preview: normalizePreview(fallback.preview, 'Fotograf'),
      text: normalizePreview(fallback.preview, 'Fotograf'),
      voiceMessage: null,
    };
  }
  if (fallbackKind === 'location' && fallback?.locationMessage) {
    const locationLabel =
      typeof fallback.locationMessage.locationLabel === 'string' &&
      fallback.locationMessage.locationLabel.trim().length > 0
        ? fallback.locationMessage.locationLabel.trim()
        : 'Konum';
    return {
      kind: 'location',
      locationMessage: fallback.locationMessage,
      photoMessage: null,
      preview: normalizePreview(fallback.preview, `Konum: ${locationLabel}`),
      text: normalizePreview(fallback.preview, `Konum: ${locationLabel}`),
      voiceMessage: null,
    };
  }

  if (!raw.startsWith(RICH_MESSAGE_PREFIX)) {
    return buildTextContent(raw, fallback?.preview);
  }

  try {
    const parsed = JSON.parse(raw.slice(RICH_MESSAGE_PREFIX.length)) as
      | OutboundRichMessagePayload
      | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string') {
      return buildTextContent(raw, fallback?.preview);
    }

    if (parsed.kind === 'voice') {
      return buildVoiceContent(parsed, fallback?.preview);
    }
    if (parsed.kind === 'photo') {
      return buildPhotoContent(parsed, fallback?.preview);
    }
    if (parsed.kind === 'location') {
      return buildLocationContent(parsed, fallback?.preview);
    }
  } catch {
    return buildTextContent(raw, fallback?.preview);
  }

  return buildTextContent(raw, fallback?.preview);
}

export function hydrateConversationMessage(
  message: ConversationMessage,
): ConversationMessage {
  const content = parseMessageContent(message.body, {
    kind: message.kind,
    locationMessage: message.locationMessage,
    photoMessage: message.photoMessage,
    preview: message.preview,
    voiceMessage: message.voiceMessage,
  });

  if (
    message.kind === content.kind &&
    message.preview === content.preview &&
    message.voiceMessage === content.voiceMessage &&
    message.photoMessage === content.photoMessage &&
    message.locationMessage === content.locationMessage
  ) {
    return message;
  }

  return {
    ...message,
    kind: content.kind,
    locationMessage: content.locationMessage,
    photoMessage: content.photoMessage,
    preview: content.preview,
    voiceMessage: content.voiceMessage,
  };
}

export function hydrateConversationSummary(
  conversation: ConversationSummary,
): ConversationSummary {
  const content = parseMessageContent(conversation.lastMessage, {
    kind: conversation.lastMessageKind,
    locationMessage: conversation.lastLocationMessage,
    photoMessage: conversation.lastPhotoMessage,
    preview: conversation.lastMessagePreview,
    voiceMessage: conversation.lastVoiceMessage,
  });

  return {
    ...conversation,
    lastLocationMessage: content.locationMessage,
    lastMessageKind: content.kind,
    lastMessagePreview: content.preview,
    lastPhotoMessage: content.photoMessage,
    lastVoiceMessage: content.voiceMessage,
  };
}
