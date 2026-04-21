// backend/node/fastify-messages.js
const fastify = require('fastify');
const multipart = require('@fastify/multipart');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { errorPayload } = require('./lib/utils');
const { RICH_MESSAGE_PREFIX } = require('./lib/message-content');

const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'voice', 'messages');

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function asNodeRequest(req) {
  return req?.raw ?? req;
}

function mapErrorStatus(error, fallback = 400) {
  const code = String(error?.code || '').trim().toLowerCase();
  if (!code) {
    return fallback;
  }

  if (
    code === 'conversation_not_found' ||
    code === 'not_found' ||
    code === 'user_not_found' ||
    code === 'voice_not_found'
  ) {
    return 404;
  }
  if (code === 'voice_access_forbidden' || code === 'access_denied') {
    return 403;
  }
  if (
    code === 'blocked_relationship' ||
    code === 'messages_limited_to_following'
  ) {
    return 403;
  }
  if (
    code === 'conversation_request_pending' ||
    code === 'conversation_request_rejected' ||
    code === 'message_request_pending' ||
    code === 'message_request_rejected' ||
    code === 'conversation_request_not_actionable'
  ) {
    return 409;
  }
  if (code === 'conversation_restricted') {
    return 403;
  }
  if (code === 'voice_payload_too_large' || code === 'payload_too_large') {
    return 413;
  }
  if (code === 'unauthorized') {
    return 401;
  }

  return fallback;
}

function sendResult(reply, successStatus, result, fallbackErrorStatus = 400) {
  if (result && typeof result === 'object' && result.error) {
    return reply
      .code(mapErrorStatus(result.error, fallbackErrorStatus))
      .send(result.error);
  }
  return reply.code(successStatus).send(result);
}

function sendUnauthorized(reply) {
  return reply
    .code(401)
    .send(errorPayload('unauthorized', 'authorization required'));
}

module.exports = function buildFastifyMessagesApp(backendInstance) {
  const app = fastify({ logger: false });
  app.register(multipart, {
    limits: {
      fileSize: 8 * 1024 * 1024 // 8 MB
    }
  });

  app.get('/health', async () => {
    return {
      service: 'fastify-messages',
      status: 'healthy',
      storageDir: STORAGE_DIR,
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/healthz', async () => {
    return {
      service: 'fastify-messages',
      status: 'healthy',
      storageDir: STORAGE_DIR,
      timestamp: new Date().toISOString(),
    };
  });

  // Conversations
  app.get('/api/v1/messages/conversations', async (req, reply) => {
    try {
      const query = req.query || {};
      const result = backendInstance.fetchConversations(asNodeRequest(req), {
        cursor: String(query.cursor || ''),
        limit: String(query.limit || ''),
        requestsOnly:
          String(query.requests || '')
            .trim()
            .toLowerCase() === 'true',
        search: String(query.q || ''),
        unreadOnly:
          String(query.unread || '')
            .trim()
            .toLowerCase() === 'true',
      });
      return sendResult(reply, 200, result);
    } catch {
      return sendUnauthorized(reply);
    }
  });

  app.post('/api/v1/messages/conversations', async (req, reply) => {
    try {
      const payload =
        req.body && typeof req.body === 'object' ? req.body : {};
      const result = backendInstance.createConversation(
        asNodeRequest(req),
        payload,
      );
      return sendResult(reply, 201, result);
    } catch {
      return sendUnauthorized(reply);
    }
  });

  // Messages in a conversation
  app.get('/api/v1/messages/conversations/:conversationId/messages', async (req, reply) => {
    try {
      const query = req.query || {};
      const conversationId = String(req.params?.conversationId || '');
      const result = backendInstance.fetchConversationMessages(
        asNodeRequest(req),
        conversationId,
        {
          cursor: String(query.cursor || ''),
          limit: String(query.limit || ''),
        },
      );
      return sendResult(reply, 200, result);
    } catch {
      return sendUnauthorized(reply);
    }
  });

  // Read state
  app.post('/api/v1/messages/conversations/:conversationId/read', async (req, reply) => {
    try {
      const conversationId = String(req.params?.conversationId || '');
      const payload =
        req.body && typeof req.body === 'object' ? req.body : {};
      const result = backendInstance.markConversationRead(
        asNodeRequest(req),
        conversationId,
        payload,
      );
      return sendResult(reply, 200, result);
    } catch {
      return sendUnauthorized(reply);
    }
  });

  app.post('/api/v1/messages/conversations/:conversationId/request/accept', async (req, reply) => {
    try {
      const conversationId = String(req.params?.conversationId || '');
      const result = backendInstance.acceptConversationRequest(
        asNodeRequest(req),
        conversationId,
      );
      return sendResult(reply, 200, result);
    } catch {
      return sendUnauthorized(reply);
    }
  });

  app.post('/api/v1/messages/conversations/:conversationId/request/reject', async (req, reply) => {
    try {
      const conversationId = String(req.params?.conversationId || '');
      const result = backendInstance.rejectConversationRequest(
        asNodeRequest(req),
        conversationId,
      );
      return sendResult(reply, 200, result);
    } catch {
      return sendUnauthorized(reply);
    }
  });

  app.patch('/api/v1/messages/conversations/:conversationId/mute', async (req, reply) => {
    try {
      const conversationId = String(req.params?.conversationId || '');
      const payload =
        req.body && typeof req.body === 'object' ? req.body : {};
      const result = backendInstance.setConversationMuted(
        asNodeRequest(req),
        conversationId,
        payload,
      );
      return sendResult(reply, 200, result);
    } catch {
      return sendUnauthorized(reply);
    }
  });

  app.post('/api/v1/messages/conversations/:conversationId/clear', async (req, reply) => {
    try {
      const conversationId = String(req.params?.conversationId || '');
      const result = backendInstance.clearConversationMessages(
        asNodeRequest(req),
        conversationId,
      );
      return sendResult(reply, 200, result);
    } catch {
      return sendUnauthorized(reply);
    }
  });

  app.delete('/api/v1/messages/conversations/:conversationId/hard', async (req, reply) => {
    try {
      const conversationId = String(req.params?.conversationId || '');
      const result = backendInstance.hardDeleteConversationForAll(
        asNodeRequest(req),
        conversationId,
      );
      return sendResult(reply, 200, result);
    } catch {
      return sendUnauthorized(reply);
    }
  });

  app.delete('/api/v1/messages/conversations/:conversationId', async (req, reply) => {
    try {
      const conversationId = String(req.params?.conversationId || '');
      const result = backendInstance.deleteConversationForUser(
        asNodeRequest(req),
        conversationId,
      );
      return sendResult(reply, 200, result);
    } catch {
      return sendUnauthorized(reply);
    }
  });

  // Upload Voice Message
  app.post('/api/v1/messages/voice/upload', async (req, reply) => {
    try {
      const payload =
        req.body && typeof req.body === 'object' ? req.body : {};
      const result = backendInstance.uploadVoiceMessage(
        asNodeRequest(req),
        payload,
      );
      return sendResult(reply, 201, result);
    } catch {
      return sendUnauthorized(reply);
    }
  });

  // Send conversation message
  app.post('/api/v1/messages/conversations/:conversationId/messages', async (req, reply) => {
    try {
      const conversationId = String(req.params?.conversationId || '');
      const payload =
        req.body && typeof req.body === 'object' ? req.body : {};
      const result = backendInstance.sendConversationMessage(
        asNodeRequest(req),
        conversationId,
        payload,
      );
      return sendResult(reply, 201, result);
    } catch {
      return sendUnauthorized(reply);
    }
  });

  // Send voice message
  app.post('/api/v1/messages/conversations/:conversationId/voice', async (req, reply) => {
    try {
      const conversationId = String(req.params?.conversationId || '');
      const input = req.body && typeof req.body === 'object' ? req.body : {};
      const uploadPayload = {
        ...input,
        conversationId,
      };

      const uploaded = backendInstance.uploadVoiceMessage(
        asNodeRequest(req),
        uploadPayload,
      );
      if (uploaded && uploaded.error) {
        return reply.code(mapErrorStatus(uploaded.error, 400)).send(uploaded.error);
      }

      const voiceMessage = uploaded?.voiceMessage;
      if (!voiceMessage || typeof voiceMessage !== 'object') {
        return reply
          .code(500)
          .send(errorPayload('server_error', 'Ses mesaji olusturulamadi.'));
      }

      const richPayload = {
        durationSec: Number.isFinite(voiceMessage.durationSec)
          ? Math.max(1, Math.floor(Number(voiceMessage.durationSec)))
          : 1,
        kind: 'voice',
        mimeType:
          typeof voiceMessage.mimeType === 'string'
            ? voiceMessage.mimeType
            : 'audio/mp4',
        sizeBytes: Number.isFinite(voiceMessage.sizeBytes)
          ? Math.max(0, Math.floor(Number(voiceMessage.sizeBytes)))
          : 0,
        title: 'Sesli mesaj',
        voiceId:
          typeof voiceMessage.id === 'string' ? voiceMessage.id : '',
        voiceUrl:
          typeof voiceMessage.url === 'string' ? voiceMessage.url : '',
        waveform: Array.isArray(voiceMessage.waveform)
          ? voiceMessage.waveform
          : [],
      };

      const clientNonce =
        typeof input.clientNonce === 'string' ? input.clientNonce.trim() : '';

      const sendResultValue = backendInstance.sendConversationMessage(
        asNodeRequest(req),
        conversationId,
        {
          clientNonce: clientNonce || undefined,
          text: `${RICH_MESSAGE_PREFIX}${JSON.stringify(richPayload)}`,
        },
      );
      if (sendResultValue && sendResultValue.error) {
        return reply
          .code(mapErrorStatus(sendResultValue.error, 400))
          .send(sendResultValue.error);
      }

      return reply.code(201).send({
        ...sendResultValue,
        conversationId,
      });
    } catch {
      return sendUnauthorized(reply);
    }
  });

  // Get voice file
  app.get('/api/v1/messages/voice/files/:voiceMessageId', async (req, reply) => {
    try {
      const voiceMessageId = String(req.params?.voiceMessageId || '');
      const result = backendInstance.getVoiceMessageFileForUser(
        asNodeRequest(req),
        voiceMessageId,
      );
      if (result && result.error) {
        return reply.code(mapErrorStatus(result.error, 400)).send(result.error);
      }
      if (!result?.file?.absolutePath || !fs.existsSync(result.file.absolutePath)) {
        return reply
          .code(404)
          .send(errorPayload('voice_not_found', 'Ses dosyasi bulunamadi.'));
      }
      reply.type(result.file.mimeType || 'audio/mp4');
      return fs.createReadStream(result.file.absolutePath);
    } catch {
      return sendUnauthorized(reply);
    }
  });

  return app;
};
