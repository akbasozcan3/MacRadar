const http = require('node:http');
const { Buffer } = require('node:buffer');

function requestHttp({
  host = '127.0.0.1',
  port,
  path: requestPath = '/',
  method = 'GET',
  headers = {},
  body = null,
  timeoutMs = 3000,
}) {
  return new Promise((resolve, reject) => {
    const hasBody = body != null && method !== 'GET' && method !== 'HEAD';
    const payload = hasBody
      ? typeof body === 'string'
        ? body
        : JSON.stringify(body)
      : '';

    const requestHeaders = {
      ...headers,
    };
    if (hasBody) {
      if (!requestHeaders['Content-Type']) {
        requestHeaders['Content-Type'] = 'application/json';
      }
      requestHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      {
        host,
        method,
        path: requestPath,
        port,
        headers: requestHeaders,
      },
      res => {
        const chunks = [];
        res.on('data', chunk => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on('end', () => {
          const bodyBuffer = Buffer.concat(chunks);
          resolve({
            body: bodyBuffer.toString('utf8'),
            bodyBuffer,
            headers: res.headers,
            statusCode: res.statusCode || 0,
          });
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout ${method} ${requestPath}`));
    });

    if (hasBody) {
      req.write(payload);
    }
    req.end();
  });
}

function parseJson(rawBody, label) {
  try {
    return rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new Error(`${label} response parse edilemedi`);
  }
}

function unwrapData(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'data')) {
    return payload.data;
  }

  return payload;
}

function extractErrorCode(response, label) {
  const payload = parseJson(response.body, label);
  const errorEnvelope = payload?.error;
  if (errorEnvelope && typeof errorEnvelope === 'object') {
    const code = errorEnvelope.code;
    if (typeof code === 'string' && code.trim().length > 0) {
      return code.trim();
    }
  }
  return '';
}

function expectStatus(response, expectedStatus, label) {
  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!expected.includes(response.statusCode)) {
    throw new Error(`${label} beklenen ${expected.join('/')}, alinan ${response.statusCode}`);
  }
}

function extractVoiceAsset(payload, label) {
  const voiceMessage =
    payload?.voiceMessage ||
    payload?.message?.voiceMessage ||
    null;
  const voiceId =
    typeof voiceMessage?.id === 'string' ? voiceMessage.id : '';
  const voiceUrl =
    typeof voiceMessage?.url === 'string' ? voiceMessage.url : '';
  if (!voiceId || !voiceUrl) {
    throw new Error(`${label} voice id/url donmedi`);
  }
  return {
    voiceId,
    voiceUrl,
  };
}

async function verifyVoiceFileAccess({
  authHeaders,
  checks,
  host,
  label,
  port,
  recipientAuthHeaders,
  timeoutMs,
  voiceUrl,
}) {
  const voiceFileSender = await requestHttp({
    headers: authHeaders,
    host,
    path: voiceUrl,
    port,
    timeoutMs,
  });
  expectStatus(voiceFileSender, 200, `${label} sender`);
  const senderVoiceContentType = String(
    voiceFileSender.headers?.['content-type'] || '',
  ).toLowerCase();
  if (!senderVoiceContentType.includes('audio/')) {
    throw new Error(`${label} sender invalid content-type: ${senderVoiceContentType}`);
  }
  if (!voiceFileSender.bodyBuffer || voiceFileSender.bodyBuffer.length < 1) {
    throw new Error(`${label} sender bos dondu`);
  }
  checks.push(`${label}.sender=200(${voiceFileSender.bodyBuffer.length})`);

  const voiceFileRecipient = await requestHttp({
    headers: recipientAuthHeaders,
    host,
    path: voiceUrl,
    port,
    timeoutMs,
  });
  expectStatus(voiceFileRecipient, 200, `${label} recipient`);
  if (!voiceFileRecipient.bodyBuffer || voiceFileRecipient.bodyBuffer.length < 1) {
    throw new Error(`${label} recipient bos dondu`);
  }
  checks.push(`${label}.recipient=200(${voiceFileRecipient.bodyBuffer.length})`);
}

function normalizeUsername(raw) {
  const compact = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const trimmed = compact.slice(0, 20);
  if (trimmed.length >= 3) {
    return trimmed;
  }
  return `mx${Date.now().toString(36).slice(-8)}`;
}

async function authenticateSocialUser({ host, port, role, timeoutMs, uniqueSeed }) {
  const username = normalizeUsername(`mx${role}${uniqueSeed}`);
  const response = await requestHttp({
    body: {
      city: 'Istanbul',
      email: `matrix.${role}.${uniqueSeed}@macradar.app`,
      fullName: `Matrix ${role}`,
      provider: 'google',
      username,
    },
    host,
    method: 'POST',
    path: '/api/v1/auth/social',
    port,
    timeoutMs,
  });

  expectStatus(response, 200, `auth/social (${role})`);
  const payload = unwrapData(parseJson(response.body, `auth/social (${role})`));
  const token = typeof payload?.session?.token === 'string' ? payload.session.token : '';
  const userId = typeof payload?.profile?.id === 'string' ? payload.profile.id : '';
  if (!token) {
    throw new Error(`auth/social (${role}) token donmedi`);
  }
  if (!userId) {
    throw new Error(`auth/social (${role}) user id donmedi`);
  }

  return {
    token,
    userId,
    username,
  };
}

async function verifyMessagesCameraMatrix(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = String(options.port || process.env.GO_PORT || process.env.PORT || '8090');
  const timeoutMs = Number(options.timeoutMs || 3200);

  const checks = [];
  const health = await requestHttp({
    host,
    path: '/healthz',
    port,
    timeoutMs,
  });
  expectStatus(health, 200, '/healthz');
  const healthPayload = unwrapData(parseJson(health.body, '/healthz'));
  const implementation =
    typeof healthPayload?.implementation === 'string' && healthPayload.implementation.trim().length > 0
      ? healthPayload.implementation.trim()
      : typeof healthPayload?.service === 'string' && healthPayload.service.trim().length > 0
        ? healthPayload.service.trim()
      : 'unknown';

  const messagesUnauth = await requestHttp({
    host,
    path: '/api/v1/messages/conversations',
    port,
    timeoutMs,
  });
  expectStatus(messagesUnauth, 401, 'messages unauth');
  checks.push('messages/conversations=401');

  const cameraUnauth = await requestHttp({
    body: {
      caption: 'matrix unauth check',
      mediaType: 'photo',
      mediaUrl: 'https://cdn.macradar.app/matrix/unauth.jpg',
    },
    host,
    method: 'POST',
    path: '/api/v1/profile/me/posts',
    port,
    timeoutMs,
  });
  expectStatus(cameraUnauth, 401, 'camera unauth');
  checks.push('profile/me/posts=401');

  const uniqueSeed = `${Date.now().toString(36)}${Math.floor(Math.random() * 10_000).toString(36)}`;
  const sender = await authenticateSocialUser({
    host,
    port,
    role: 'sender',
    timeoutMs,
    uniqueSeed,
  });
  const recipient = await authenticateSocialUser({
    host,
    port,
    role: 'recipient',
    timeoutMs,
    uniqueSeed,
  });

  const authHeaders = {
    Authorization: `Bearer ${sender.token}`,
  };
  const recipientAuthHeaders = {
    Authorization: `Bearer ${recipient.token}`,
  };
  const initialMessage = `matrix hello ${uniqueSeed}`;
  const conversationCreate = await requestHttp({
    body: {
      initialMessage,
      recipientId: recipient.userId,
    },
    headers: authHeaders,
    host,
    method: 'POST',
    path: '/api/v1/messages/conversations',
    port,
    timeoutMs,
  });
  expectStatus(conversationCreate, 201, 'create conversation');
  const conversationPayload = unwrapData(
    parseJson(conversationCreate.body, 'create conversation'),
  );
  const conversationId =
    typeof conversationPayload?.conversationId === 'string'
      ? conversationPayload.conversationId
      : '';
  if (!conversationId) {
    throw new Error('create conversation conversationId donmedi');
  }
  checks.push('messages/create=201');

  const uploadWaveform = [0.12, 0.42, 0.74, 0.36, 0.58];
  const finalizedVoiceWaveform = [0.18, 0.32, 0.66, 0.41, 0.8, 0.52];
  const uploadVoice = await requestHttp({
    body: {
      base64: Buffer.from(`matrix-voice-${uniqueSeed}`).toString('base64'),
      conversationId,
      durationSec: 4,
      mimeType: 'audio/mp4',
      waveform: uploadWaveform,
    },
    headers: authHeaders,
    host,
    method: 'POST',
    path: '/api/v1/messages/voice/upload',
    port,
    timeoutMs,
  });
  expectStatus(uploadVoice, [200, 201], 'upload voice');
  const uploadVoicePayload = unwrapData(parseJson(uploadVoice.body, 'upload voice'));
  const { voiceUrl: uploadedVoiceUrl } = extractVoiceAsset(
    uploadVoicePayload,
    'upload voice',
  );
  checks.push('messages/voice.upload=200');

  await verifyVoiceFileAccess({
    authHeaders,
    checks,
    host,
    label: 'messages/voice.file',
    port,
    recipientAuthHeaders,
    timeoutMs,
    voiceUrl: uploadedVoiceUrl,
  });

  let finalizedVoiceMessageId = '';
  let finalizedVoiceId = '';
  const finalizedVoiceSend = await requestHttp({
    body: {
      base64: Buffer.from(`matrix-voice-finalize-${uniqueSeed}`).toString('base64'),
      durationSec: 5,
      mimeType: 'audio/mp4',
      waveform: finalizedVoiceWaveform,
    },
    headers: authHeaders,
    host,
    method: 'POST',
    path: `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/voice`,
    port,
    timeoutMs,
  });
  if ([200, 201].includes(finalizedVoiceSend.statusCode)) {
    const finalizedVoicePayload = unwrapData(
      parseJson(finalizedVoiceSend.body, 'send finalize voice'),
    );
    finalizedVoiceMessageId =
      typeof finalizedVoicePayload?.message?.id === 'string'
        ? finalizedVoicePayload.message.id
        : '';
    if (!finalizedVoiceMessageId) {
      throw new Error('send finalize voice message.id donmedi');
    }
    const finalizedVoiceAsset = extractVoiceAsset(
      finalizedVoicePayload,
      'send finalize voice',
    );
    finalizedVoiceId = finalizedVoiceAsset.voiceId;
    const finalizedVoiceKind = String(finalizedVoicePayload?.message?.kind || '');
    if (finalizedVoiceKind !== 'voice') {
      throw new Error(`send finalize voice kind beklenen voice, alinan ${finalizedVoiceKind || 'bos'}`);
    }
    checks.push('messages/voice.finalize=201');

    await verifyVoiceFileAccess({
      authHeaders,
      checks,
      host,
      label: 'messages/voice.finalize.file',
      port,
      recipientAuthHeaders,
      timeoutMs,
      voiceUrl: finalizedVoiceAsset.voiceUrl,
    });
  } else if (
    implementation !== 'go' &&
    [404, 405, 501].includes(finalizedVoiceSend.statusCode)
  ) {
    checks.push(`messages/voice.finalize=skipped(${implementation})`);
  } else if (finalizedVoiceSend.statusCode === 409) {
    const finalizeConflictCode = extractErrorCode(
      finalizedVoiceSend,
      'send finalize voice conflict',
    );
    if (
      finalizeConflictCode === 'message_request_pending' ||
      finalizeConflictCode === 'message_request_rejected'
    ) {
      checks.push(`messages/voice.finalize=skipped(conflict:${finalizeConflictCode})`);
    } else {
      throw new Error(
        `send finalize voice conflict code tanimsiz: ${finalizeConflictCode || 'bos'}`,
      );
    }
  } else {
    throw new Error(
      `send finalize voice beklenen 200/201, alinan ${finalizedVoiceSend.statusCode}`,
    );
  }

  const conversationsList = await requestHttp({
    headers: authHeaders,
    host,
    path: '/api/v1/messages/conversations?limit=6',
    port,
    timeoutMs,
  });
  expectStatus(conversationsList, 200, 'list conversations');
  const conversationListPayload = unwrapData(
    parseJson(conversationsList.body, 'list conversations'),
  );
  const conversations = Array.isArray(conversationListPayload?.conversations)
    ? conversationListPayload.conversations
    : [];
  if (!conversations.some(item => String(item?.conversationId || '') === conversationId)) {
    throw new Error('list conversations yeni konusmayi donmedi');
  }
  checks.push(`messages/list=200(${conversations.length})`);

  const messageSendRequest = {
    body: {
      text: `matrix ping ${uniqueSeed}`,
    },
    headers: authHeaders,
    host,
    method: 'POST',
    path: `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/messages`,
    port,
    timeoutMs,
  };

  let messageSend = await requestHttp(messageSendRequest);
  if (messageSend.statusCode === 409) {
    const messageSendConflictCode = extractErrorCode(
      messageSend,
      'send message conflict',
    );
    if (messageSendConflictCode === 'message_request_pending') {
      const acceptConversationRequest = await requestHttp({
        headers: recipientAuthHeaders,
        host,
        method: 'POST',
        path: `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/request/accept`,
        port,
        timeoutMs,
      });
      expectStatus(acceptConversationRequest, 200, 'accept conversation request');
      checks.push('messages/request.accept=200');
      messageSend = await requestHttp(messageSendRequest);
    }
  }
  expectStatus(messageSend, 201, 'send message');
  const messageSendPayload = unwrapData(parseJson(messageSend.body, 'send message'));
  const sentMessageId =
    typeof messageSendPayload?.message?.id === 'string' ? messageSendPayload.message.id : '';
  if (!sentMessageId) {
    throw new Error('send message message.id donmedi');
  }
  checks.push('messages/send=201');

  const messageHistory = await requestHttp({
    headers: authHeaders,
    host,
    path: `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/messages?limit=12`,
    port,
    timeoutMs,
  });
  expectStatus(messageHistory, 200, 'list messages');
  const messageHistoryPayload = unwrapData(parseJson(messageHistory.body, 'list messages'));
  const messages = Array.isArray(messageHistoryPayload?.messages)
    ? messageHistoryPayload.messages
    : [];
  if (!messages.some(item => String(item?.id || '') === sentMessageId)) {
    throw new Error('list messages gonderilen mesaji donmedi');
  }
  if (finalizedVoiceMessageId) {
    const finalizedVoiceHistoryItem = messages.find(
      item => String(item?.id || '') === finalizedVoiceMessageId,
    );
    if (!finalizedVoiceHistoryItem) {
      throw new Error('list messages finalize voice mesajini donmedi');
    }
    const finalizedHistoryVoiceId =
      typeof finalizedVoiceHistoryItem?.voiceMessage?.id === 'string'
        ? finalizedVoiceHistoryItem.voiceMessage.id
        : '';
    if (finalizedHistoryVoiceId !== finalizedVoiceId) {
      throw new Error('list messages finalize voice kaydini dogru baglamadi');
    }
    checks.push('messages/history.voice=1');
  } else {
    checks.push(`messages/history.voice=skipped(${implementation})`);
  }
  checks.push(`messages/history=200(${messages.length})`);

  const recipientSummaryBeforeRead = await requestHttp({
    headers: recipientAuthHeaders,
    host,
    path: '/api/v1/profile/request-summary',
    port,
    timeoutMs,
  });
  expectStatus(recipientSummaryBeforeRead, 200, 'recipient request summary before read');
  const recipientSummaryBeforeReadPayload = unwrapData(
    parseJson(recipientSummaryBeforeRead.body, 'recipient request summary before read'),
  );
  const recipientUnreadBeforeRead = Number.isFinite(recipientSummaryBeforeReadPayload?.messagesUnreadCount)
    ? Math.max(0, Math.floor(recipientSummaryBeforeReadPayload.messagesUnreadCount))
    : NaN;
  if (!Number.isFinite(recipientUnreadBeforeRead)) {
    throw new Error('profile/request-summary messagesUnreadCount alani donmedi');
  }
  if (recipientUnreadBeforeRead < 1) {
    throw new Error(`recipient request summary unread beklenen >=1, alinan ${recipientUnreadBeforeRead}`);
  }
  checks.push(`profile/request-summary=200(unread:${recipientUnreadBeforeRead})`);

  const markRead = await requestHttp({
    body: {
      messageId: sentMessageId,
    },
    headers: recipientAuthHeaders,
    host,
    method: 'POST',
    path: `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/read`,
    port,
    timeoutMs,
  });
  expectStatus(markRead, 200, 'mark read');
  checks.push('messages/read=200');

  const recipientSummaryAfterRead = await requestHttp({
    headers: recipientAuthHeaders,
    host,
    path: '/api/v1/profile/request-summary',
    port,
    timeoutMs,
  });
  expectStatus(recipientSummaryAfterRead, 200, 'recipient request summary after read');
  const recipientSummaryAfterReadPayload = unwrapData(
    parseJson(recipientSummaryAfterRead.body, 'recipient request summary after read'),
  );
  const recipientUnreadAfterRead = Number.isFinite(recipientSummaryAfterReadPayload?.messagesUnreadCount)
    ? Math.max(0, Math.floor(recipientSummaryAfterReadPayload.messagesUnreadCount))
    : NaN;
  if (!Number.isFinite(recipientUnreadAfterRead)) {
    throw new Error('profile/request-summary messagesUnreadCount alani after-read response icin yok');
  }
  if (recipientUnreadAfterRead !== 0) {
    throw new Error(`recipient request summary unread beklenen 0, alinan ${recipientUnreadAfterRead}`);
  }
  checks.push('profile/request-summary.unread=0');

  const muteConversation = await requestHttp({
    body: {
      muted: true,
    },
    headers: authHeaders,
    host,
    method: 'PATCH',
    path: `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/mute`,
    port,
    timeoutMs,
  });
  expectStatus(muteConversation, 200, 'mute conversation');
  const muteConversationPayload = unwrapData(
    parseJson(muteConversation.body, 'mute conversation'),
  );
  if (muteConversationPayload?.muted !== true) {
    throw new Error('mute conversation muted=true donmedi');
  }
  checks.push('messages/mute=200');

  const mutedConversationList = await requestHttp({
    headers: authHeaders,
    host,
    path: '/api/v1/messages/conversations?limit=6',
    port,
    timeoutMs,
  });
  expectStatus(mutedConversationList, 200, 'list conversations after mute');
  const mutedConversationListPayload = unwrapData(
    parseJson(mutedConversationList.body, 'list conversations after mute'),
  );
  const mutedConversation = Array.isArray(mutedConversationListPayload?.conversations)
    ? mutedConversationListPayload.conversations.find(
        item => String(item?.conversationId || '') === conversationId,
      )
    : null;
  if (!mutedConversation || mutedConversation.isMuted !== true) {
    throw new Error('list conversations muted state donmedi');
  }
  checks.push('messages/list.muted=1');

  const clearConversation = await requestHttp({
    body: {},
    headers: authHeaders,
    host,
    method: 'POST',
    path: `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/clear`,
    port,
    timeoutMs,
  });
  expectStatus(clearConversation, 200, 'clear conversation');
  const clearConversationPayload = unwrapData(
    parseJson(clearConversation.body, 'clear conversation'),
  );
  if (Number(clearConversationPayload?.unreadCount || 0) !== 0) {
    throw new Error(`clear conversation unreadCount beklenen 0, alinan ${clearConversationPayload?.unreadCount}`);
  }
  checks.push('messages/clear=200');

  const messagesAfterClear = await requestHttp({
    headers: authHeaders,
    host,
    path: `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}/messages?limit=12`,
    port,
    timeoutMs,
  });
  expectStatus(messagesAfterClear, 200, 'list messages after clear');
  const messagesAfterClearPayload = unwrapData(
    parseJson(messagesAfterClear.body, 'list messages after clear'),
  );
  const clearedMessages = Array.isArray(messagesAfterClearPayload?.messages)
    ? messagesAfterClearPayload.messages
    : [];
  if (clearedMessages.length !== 0) {
    throw new Error(`clear conversation sonrasi mesajlar temizlenmedi (${clearedMessages.length})`);
  }
  checks.push('messages/history.cleared=0');

  const deleteConversationSelf = await requestHttp({
    headers: authHeaders,
    host,
    method: 'DELETE',
    path: `/api/v1/messages/conversations/${encodeURIComponent(conversationId)}`,
    port,
    timeoutMs,
  });
  expectStatus(deleteConversationSelf, 200, 'delete conversation self');
  const deleteConversationSelfPayload = unwrapData(
    parseJson(deleteConversationSelf.body, 'delete conversation self'),
  );
  if (deleteConversationSelfPayload?.deleted !== true || deleteConversationSelfPayload?.mode !== 'self') {
    throw new Error('delete conversation self response gecersiz');
  }
  checks.push('messages/delete.self=200');

  const senderConversationsAfterDelete = await requestHttp({
    headers: authHeaders,
    host,
    path: '/api/v1/messages/conversations?limit=6',
    port,
    timeoutMs,
  });
  expectStatus(senderConversationsAfterDelete, 200, 'list conversations after self delete');
  const senderConversationsAfterDeletePayload = unwrapData(
    parseJson(senderConversationsAfterDelete.body, 'list conversations after self delete'),
  );
  const senderConversationsAfterDeleteItems = Array.isArray(senderConversationsAfterDeletePayload?.conversations)
    ? senderConversationsAfterDeletePayload.conversations
    : [];
  if (senderConversationsAfterDeleteItems.some(item => String(item?.conversationId || '') === conversationId)) {
    throw new Error('self delete sonrasi sohbet hala gonderende gorunuyor');
  }
  checks.push('messages/list.self-delete.hidden=1');

  const restoredConversationCreate = await requestHttp({
    body: {
      initialMessage: `matrix restore ${uniqueSeed}`,
      recipientId: recipient.userId,
    },
    headers: authHeaders,
    host,
    method: 'POST',
    path: '/api/v1/messages/conversations',
    port,
    timeoutMs,
  });
  expectStatus(restoredConversationCreate, 201, 'restore deleted conversation');
  const restoredConversationPayload = unwrapData(
    parseJson(restoredConversationCreate.body, 'restore deleted conversation'),
  );
  const restoredConversationId =
    typeof restoredConversationPayload?.conversationId === 'string'
      ? restoredConversationPayload.conversationId
      : '';
  if (!restoredConversationId) {
    throw new Error('restore deleted conversation conversationId donmedi');
  }
  checks.push('messages/restore=201');

  const senderConversationsAfterRestore = await requestHttp({
    headers: authHeaders,
    host,
    path: '/api/v1/messages/conversations?limit=6',
    port,
    timeoutMs,
  });
  expectStatus(senderConversationsAfterRestore, 200, 'list conversations after restore');
  const senderConversationsAfterRestorePayload = unwrapData(
    parseJson(senderConversationsAfterRestore.body, 'list conversations after restore'),
  );
  const senderConversationsAfterRestoreItems = Array.isArray(senderConversationsAfterRestorePayload?.conversations)
    ? senderConversationsAfterRestorePayload.conversations
    : [];
  if (!senderConversationsAfterRestoreItems.some(item => String(item?.conversationId || '') === restoredConversationId)) {
    throw new Error('restore sonrasi sohbet tekrar gorunmedi');
  }
  checks.push('messages/list.restore.visible=1');

  const hardDeleteConversation = await requestHttp({
    headers: authHeaders,
    host,
    method: 'DELETE',
    path: `/api/v1/messages/conversations/${encodeURIComponent(restoredConversationId)}/hard`,
    port,
    timeoutMs,
  });
  expectStatus(hardDeleteConversation, 200, 'hard delete conversation');
  const hardDeleteConversationPayload = unwrapData(
    parseJson(hardDeleteConversation.body, 'hard delete conversation'),
  );
  if (hardDeleteConversationPayload?.deleted !== true || hardDeleteConversationPayload?.mode !== 'hard') {
    throw new Error('hard delete conversation response gecersiz');
  }
  checks.push('messages/delete.hard=200');

  const senderConversationsAfterHardDelete = await requestHttp({
    headers: authHeaders,
    host,
    path: '/api/v1/messages/conversations?limit=6',
    port,
    timeoutMs,
  });
  expectStatus(senderConversationsAfterHardDelete, 200, 'sender conversations after hard delete');
  const senderConversationsAfterHardDeletePayload = unwrapData(
    parseJson(senderConversationsAfterHardDelete.body, 'sender conversations after hard delete'),
  );
  const senderConversationsAfterHardDeleteItems = Array.isArray(senderConversationsAfterHardDeletePayload?.conversations)
    ? senderConversationsAfterHardDeletePayload.conversations
    : [];
  if (senderConversationsAfterHardDeleteItems.some(item => String(item?.conversationId || '') === restoredConversationId)) {
    throw new Error('hard delete sonrasi sohbet gonderende hala gorunuyor');
  }

  const recipientConversationsAfterHardDelete = await requestHttp({
    headers: recipientAuthHeaders,
    host,
    path: '/api/v1/messages/conversations?limit=6',
    port,
    timeoutMs,
  });
  expectStatus(recipientConversationsAfterHardDelete, 200, 'recipient conversations after hard delete');
  const recipientConversationsAfterHardDeletePayload = unwrapData(
    parseJson(recipientConversationsAfterHardDelete.body, 'recipient conversations after hard delete'),
  );
  const recipientConversationsAfterHardDeleteItems = Array.isArray(recipientConversationsAfterHardDeletePayload?.conversations)
    ? recipientConversationsAfterHardDeletePayload.conversations
    : [];
  if (recipientConversationsAfterHardDeleteItems.some(item => String(item?.conversationId || '') === restoredConversationId)) {
    throw new Error('hard delete sonrasi sohbet alicida hala gorunuyor');
  }
  checks.push('messages/list.hard-delete.hidden=2');

  const postMarker = `${uniqueSeed}-${Date.now().toString(36)}`;
  const createdPost = await requestHttp({
    body: {
      caption: `matrix camera ${postMarker}`,
      location: 'Istanbul',
      mediaType: 'photo',
      mediaUrl: `https://cdn.macradar.app/matrix/${postMarker}.jpg`,
    },
    headers: authHeaders,
    host,
    method: 'POST',
    path: '/api/v1/profile/me/posts',
    port,
    timeoutMs,
  });
  expectStatus(createdPost, 201, 'create profile post');
  const createdPostPayload = unwrapData(parseJson(createdPost.body, 'create profile post'));
  const createdPostID = typeof createdPostPayload?.id === 'string' ? createdPostPayload.id : '';
  if (!createdPostID) {
    throw new Error('create profile post id donmedi');
  }
  checks.push('camera-upload/create=201');

  const myPosts = await requestHttp({
    headers: authHeaders,
    host,
    path: '/api/v1/profile/me/posts?limit=12',
    port,
    timeoutMs,
  });
  expectStatus(myPosts, 200, 'list my profile posts');
  const myPostsPayload = unwrapData(parseJson(myPosts.body, 'list my profile posts'));
  const posts = Array.isArray(myPostsPayload?.posts) ? myPostsPayload.posts : [];
  if (!posts.some(item => String(item?.id || '') === createdPostID)) {
    throw new Error('list my profile posts olusturulan postu donmedi');
  }
  checks.push(`camera-upload/list=200(${posts.length})`);

  const details = `${checks.join(', ')}, impl=${implementation}, users=${sender.username}/${recipient.username}`;
  console.log(`[backend] Messaging + camera matrix tamam: ${details}`);
  return {
    details,
    status: 'CHECKED',
  };
}

module.exports = {
  verifyMessagesCameraMatrix,
};

if (require.main === module) {
  verifyMessagesCameraMatrix()
    .then(result => {
      const details = result?.details ? ` - ${result.details}` : '';
      console.log(`[backend] Messaging + camera matrix OK${details}`);
      process.exit(0);
    })
    .catch(error => {
      console.error(
        `[backend] Messaging + camera matrix FAILED: ${
          error?.message || String(error)
        }`,
      );
      process.exit(1);
    });
}
