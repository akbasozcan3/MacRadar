const { normalizeText } = require('./utils');

const RICH_MESSAGE_PREFIX = '[[MRMSG]]';

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function normalizeWaveform(values) {
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

function normalizeVoiceDuration(value, fallback = 6) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(Number(value)));
}

function buildTextContent(body, preview) {
  const fallbackPreview = normalizeText(body) || 'Yeni mesaj';
  return {
    kind: 'text',
    locationMessage: null,
    photoMessage: null,
    preview: normalizeText(preview, fallbackPreview),
    voiceMessage: null,
  };
}

function buildVoiceContent(payload, preview) {
  const durationSec = normalizeVoiceDuration(payload?.durationSec, 6);
  return {
    kind: 'voice',
    locationMessage: null,
    photoMessage: null,
    preview: normalizeText(preview, `Sesli mesaj (${durationSec} sn)`),
    voiceMessage: {
      conversationId: '',
      createdAt: '',
      durationSec,
      fileName: '',
      id: normalizeText(payload?.voiceId),
      mimeType: normalizeText(payload?.mimeType),
      sizeBytes: Number.isFinite(payload?.sizeBytes)
        ? Math.max(0, Number(payload.sizeBytes))
        : 0,
      url: normalizeText(payload?.voiceUrl),
      waveform: normalizeWaveform(payload?.waveform),
    },
  };
}

function buildPhotoContent(payload, preview) {
  const title = normalizeText(payload?.title, 'Fotograf');
  const resolvedPreview = normalizeText(preview, `Fotograf: ${title}`);
  return {
    kind: 'photo',
    locationMessage: null,
    photoMessage: {
      mimeType: normalizeText(payload?.mimeType),
      sizeBytes: Number.isFinite(payload?.sizeBytes)
        ? Math.max(0, Number(payload.sizeBytes))
        : 0,
      title,
      url: normalizeText(payload?.url),
    },
    preview: resolvedPreview,
    voiceMessage: null,
  };
}

function buildLocationContent(payload, preview) {
  const locationLabel = normalizeText(payload?.locationLabel, 'Konum');
  return {
    kind: 'location',
    locationMessage: {
      latitude: Number.isFinite(payload?.latitude) ? Number(payload.latitude) : undefined,
      locationLabel,
      longitude: Number.isFinite(payload?.longitude) ? Number(payload.longitude) : undefined,
      title: normalizeText(payload?.title, 'Konum'),
    },
    photoMessage: null,
    preview: normalizeText(preview, `Konum: ${locationLabel}`),
    voiceMessage: null,
  };
}

function parseMessageContent(body, fallback = {}) {
  const raw = typeof body === 'string' ? body : '';

  if (fallback.kind === 'voice' && fallback.voiceMessage) {
    const durationSec = normalizeVoiceDuration(fallback.voiceMessage.durationSec, 6);
    return {
      kind: 'voice',
      locationMessage: null,
      photoMessage: null,
      preview: normalizeText(fallback.preview, `Sesli mesaj (${durationSec} sn)`),
      voiceMessage: {
        ...fallback.voiceMessage,
        waveform: normalizeWaveform(fallback.voiceMessage.waveform),
      },
    };
  }

  if (fallback.kind === 'photo' && fallback.photoMessage) {
    return {
      kind: 'photo',
      locationMessage: null,
      photoMessage: fallback.photoMessage,
      preview: normalizeText(fallback.preview, 'Fotograf'),
      voiceMessage: null,
    };
  }

  if (fallback.kind === 'location' && fallback.locationMessage) {
    const locationLabel = normalizeText(
      fallback.locationMessage.locationLabel,
      'Konum',
    );
    return {
      kind: 'location',
      locationMessage: fallback.locationMessage,
      photoMessage: null,
      preview: normalizeText(fallback.preview, `Konum: ${locationLabel}`),
      voiceMessage: null,
    };
  }

  if (!raw.startsWith(RICH_MESSAGE_PREFIX)) {
    return buildTextContent(raw, fallback.preview);
  }

  try {
    const parsed = JSON.parse(raw.slice(RICH_MESSAGE_PREFIX.length));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string') {
      return buildTextContent(raw, fallback.preview);
    }

    if (parsed.kind === 'voice') {
      return buildVoiceContent(parsed, fallback.preview);
    }
    if (parsed.kind === 'photo') {
      return buildPhotoContent(parsed, fallback.preview);
    }
    if (parsed.kind === 'location') {
      return buildLocationContent(parsed, fallback.preview);
    }
  } catch {
    return buildTextContent(raw, fallback.preview);
  }

  return buildTextContent(raw, fallback.preview);
}

function enrichConversationMessage(message) {
  const content = parseMessageContent(message.body, {
    kind: message.kind,
    locationMessage: message.locationMessage,
    photoMessage: message.photoMessage,
    preview: message.preview,
    voiceMessage: message.voiceMessage,
  });

  return {
    ...message,
    kind: content.kind,
    locationMessage: content.locationMessage,
    photoMessage: content.photoMessage,
    preview: content.preview,
    voiceMessage: content.voiceMessage,
  };
}

function enrichConversationSummary(summary) {
  const content = parseMessageContent(summary.lastMessage, {
    kind: summary.lastMessageKind,
    locationMessage: summary.lastLocationMessage,
    photoMessage: summary.lastPhotoMessage,
    preview: summary.lastMessagePreview,
    voiceMessage: summary.lastVoiceMessage,
  });

  return {
    ...summary,
    lastLocationMessage: content.locationMessage,
    lastMessageKind: content.kind,
    lastMessagePreview: content.preview,
    lastPhotoMessage: content.photoMessage,
    lastVoiceMessage: content.voiceMessage,
  };
}

module.exports = {
  RICH_MESSAGE_PREFIX,
  enrichConversationMessage,
  enrichConversationSummary,
  parseMessageContent,
};
