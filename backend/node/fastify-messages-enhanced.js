// Professional Messaging System for MacRadar Backend
const fastify = require('fastify');
const multipart = require('@fastify/multipart');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const { errorPayload } = require('./lib/utils');

const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'voice', 'messages');
const ATTACHMENTS_DIR = path.join(__dirname, '..', 'storage', 'attachments');

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

class MessageHub {
  constructor() {
    this.conversations = new Map();
    this.messages = new Map();
    this.onlineUsers = new Map();
    this.blockedUsers = new Map();
    this.readReceipts = new Map();
    this.typingIndicators = new Map();
    this.wsServer = null;
  }

  initializeWebSocketServer(port = 8095) {
    this.wsServer = new WebSocket.Server({ port });
    
    this.wsServer.on('connection', (ws, req) => {
      const userId = this.extractUserIdFromRequest(req);
      this.handleUserConnection(ws, userId);
    });

    console.log(`[MessageHub] WebSocket server running on port ${port}`);
  }

  extractUserIdFromRequest(req) {
    const url = new URL(req.url, `http://localhost:8095`);
    return url.searchParams.get('userId') || 'anonymous';
  }

  handleUserConnection(ws, userId) {
    this.onlineUsers.set(userId, ws);
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.handleWebSocketMessage(userId, message);
      } catch (error) {
        console.error('[MessageHub] WebSocket message error:', error);
      }
    });

    ws.on('close', () => {
      this.onlineUsers.delete(userId);
      this.broadcastUserStatus(userId, 'offline');
    });

    this.broadcastUserStatus(userId, 'online');
  }

  handleWebSocketMessage(userId, message) {
    switch (message.type) {
      case 'typing_start':
        this.handleTypingStart(userId, message.conversationId);
        break;
      case 'typing_stop':
        this.handleTypingStop(userId, message.conversationId);
        break;
      case 'mark_read':
        this.handleMarkAsRead(userId, message.messageId);
        break;
      case 'message':
        this.handleRealTimeMessage(userId, message);
        break;
    }
  }

  handleTypingStart(userId, conversationId) {
    if (!this.typingIndicators.has(conversationId)) {
      this.typingIndicators.set(conversationId, new Set());
    }
    this.typingIndicators.get(conversationId).add(userId);
    this.broadcastTypingIndicator(conversationId, userId, true);
  }

  handleTypingStop(userId, conversationId) {
    const indicators = this.typingIndicators.get(conversationId);
    if (indicators) {
      indicators.delete(userId);
      this.broadcastTypingIndicator(conversationId, userId, false);
    }
  }

  handleMarkAsRead(userId, messageId) {
    if (!this.readReceipts.has(messageId)) {
      this.readReceipts.set(messageId, new Set());
    }
    this.readReceipts.get(messageId).add(userId);
    this.broadcastReadReceipt(userId, messageId);
  }

  broadcastTypingIndicator(conversationId, userId, isTyping) {
    const message = {
      type: 'typing_indicator',
      conversationId,
      userId,
      isTyping,
      timestamp: new Date().toISOString()
    };

    this.broadcastToConversation(conversationId, message, userId);
  }

  broadcastReadReceipt(userId, messageId) {
    const message = {
      type: 'read_receipt',
      messageId,
      userId,
      timestamp: new Date().toISOString()
    };

    this.broadcastToAll(message);
  }

  broadcastUserStatus(userId, status) {
    const message = {
      type: 'user_status',
      userId,
      status,
      timestamp: new Date().toISOString()
    };

    this.broadcastToAll(message);
  }

  broadcastToConversation(conversationId, message, excludeUserId = null) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;

    conversation.participants.forEach(participantId => {
      if (participantId !== excludeUserId) {
        const userWs = this.onlineUsers.get(participantId);
        if (userWs && userWs.readyState === WebSocket.OPEN) {
          userWs.send(JSON.stringify(message));
        }
      }
    });
  }

  broadcastToAll(message) {
    this.onlineUsers.forEach((ws, userId) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    });
  }

  blockUser(userId, blockedUserId) {
    if (!this.blockedUsers.has(userId)) {
      this.blockedUsers.set(userId, new Set());
    }
    this.blockedUsers.get(userId).add(blockedUserId);
  }

  unblockUser(userId, blockedUserId) {
    const blocked = this.blockedUsers.get(userId);
    if (blocked) {
      blocked.delete(blockedUserId);
    }
  }

  isUserBlocked(userId, targetUserId) {
    const blocked = this.blockedUsers.get(userId);
    return blocked && blocked.has(targetUserId);
  }

  createConversation(participants, type = 'direct') {
    const conversationId = this.generateConversationId(participants);
    const conversation = {
      id: conversationId,
      participants,
      type,
      createdAt: new Date().toISOString(),
      lastMessage: null,
      unreadCounts: new Map(participants.map(p => [p, 0])),
      metadata: {
        name: type === 'group' ? 'New Group' : null,
        description: null,
        avatar: null,
        admins: type === 'group' ? [participants[0]] : []
      }
    };

    this.conversations.set(conversationId, conversation);
    return conversation;
  }

  generateConversationId(participants) {
    const sorted = [...participants].sort();
    return 'conv_' + crypto.createHash('md5').update(sorted.join(':')).toString('hex');
  }

  addMessage(conversationId, messageData) {
    const message = {
      id: this.generateMessageId(),
      conversationId,
      senderId: messageData.senderId,
      content: messageData.content,
      type: messageData.type || 'text',
      attachments: messageData.attachments || [],
      metadata: messageData.metadata || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isEdited: false,
      isDeleted: false,
      reactions: new Map(),
      replyTo: messageData.replyTo || null,
      forwardFrom: messageData.forwardFrom || null,
      readBy: new Set(),
      deliveredTo: new Set()
    };

    if (!this.messages.has(conversationId)) {
      this.messages.set(conversationId, []);
    }
    this.messages.get(conversationId).push(message);

    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      conversation.lastMessage = message;
      conversation.updatedAt = new Date().toISOString();
    }

    this.broadcastMessage(message);
    return message;
  }

  generateMessageId() {
    return 'msg_' + crypto.randomBytes(16).toString('hex');
  }

  broadcastMessage(message) {
    const messageData = {
      type: 'new_message',
      message,
      timestamp: new Date().toISOString()
    };

    this.broadcastToConversation(message.conversationId, messageData);
  }

  getUserConversations(userId, options = {}) {
    const { limit = 50, offset = 0, search = '' } = options;
    const userConversations = [];

    for (const conversation of this.conversations.values()) {
      if (!conversation.participants.includes(userId)) continue;
      
      if (search && !this.matchesSearch(conversation, search)) continue;

      const isBlocked = conversation.participants.some(p => 
        this.isUserBlocked(p, userId) || this.isUserBlocked(userId, p)
      );
      if (isBlocked) continue;

      userConversations.push(this.formatConversationForUser(conversation, userId));
    }

    userConversations.sort((a, b) => 
      new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0)
    );

    return {
      conversations: userConversations.slice(offset, offset + limit),
      hasMore: userConversations.length > offset + limit,
      total: userConversations.length
    };
  }

  formatConversationForUser(conversation, userId) {
    const messages = this.messages.get(conversation.id) || [];
    const lastMessage = messages[messages.length - 1];
    const unreadCount = messages.filter(m => 
      !m.readBy.has(userId) && m.senderId !== userId
    ).length;

    return {
      id: conversation.id,
      type: conversation.type,
      participants: conversation.participants.filter(p => p !== userId),
      metadata: conversation.metadata,
      unreadCount,
      lastMessage: lastMessage ? this.formatMessageForUser(lastMessage) : null,
      lastMessageAt: lastMessage ? lastMessage.createdAt : conversation.createdAt,
      isMuted: false,
      isPinned: false,
      isArchived: false
    };
  }

  formatMessageForUser(message) {
    return {
      id: message.id,
      senderId: message.senderId,
      content: message.content,
      type: message.type,
      attachments: message.attachments,
      createdAt: message.createdAt,
      isEdited: message.isEdited,
      replyTo: message.replyTo,
      reactions: Array.from(message.reactions.entries()),
      readBy: Array.from(message.readBy),
      deliveredTo: Array.from(message.deliveredTo)
    };
  }

  matchesSearch(conversation, search) {
    const searchTerm = search.toLowerCase();
    
    if (conversation.metadata.name && 
        conversation.metadata.name.toLowerCase().includes(searchTerm)) {
      return true;
    }

    const messages = this.messages.get(conversation.id) || [];
    return messages.some(m => 
      m.content && m.content.toLowerCase().includes(searchTerm)
    );
  }
}

const messageHub = new MessageHub();

module.exports = function buildFastifyMessagesApp(backendInstance) {
  const app = fastify({ logger: false });
  app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024
    }
  });

  messageHub.initializeWebSocketServer();

  ensureDirSync(STORAGE_DIR);
  ensureDirSync(ATTACHMENTS_DIR);

  app.get('/api/v1/messages/conversations', async (req, reply) => {
    const { userId } = req.query;
    const { limit = 50, offset = 0, search = '' } = req.query;
    
    if (!userId) {
      return reply.code(400).send(errorPayload('missing_user_id', 'User ID is required'));
    }

    try {
      const result = messageHub.getUserConversations(userId, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        search
      });
      
      return {
        success: true,
        ...result
      };
    } catch (error) {
      console.error('[Messages] Get conversations error:', error);
      return reply.code(500).send(errorPayload('server_error', 'Failed to get conversations'));
    }
  });

  app.post('/api/v1/messages/conversations', async (req, reply) => {
    const { participants, type = 'direct', metadata = {} } = req.body;
    
    if (!participants || participants.length < 2) {
      return reply.code(400).send(errorPayload('invalid_participants', 'At least 2 participants required'));
    }

    try {
      const conversation = messageHub.createConversation(participants, type);
      if (metadata.name) {
        conversation.metadata.name = metadata.name;
      }
      if (metadata.description) {
        conversation.metadata.description = metadata.description;
      }
      
      return reply.code(201).send({
        success: true,
        conversation
      });
    } catch (error) {
      console.error('[Messages] Create conversation error:', error);
      return reply.code(500).send(errorPayload('server_error', 'Failed to create conversation'));
    }
  });

  app.get('/api/v1/messages/conversations/:conversationId/messages', async (req, reply) => {
    const { conversationId } = req.params;
    const { userId, limit = 50, offset = 0 } = req.query;
    
    if (!userId) {
      return reply.code(400).send(errorPayload('missing_user_id', 'User ID is required'));
    }

    try {
      const conversation = messageHub.conversations.get(conversationId);
      if (!conversation) {
        return reply.code(404).send(errorPayload('conversation_not_found', 'Conversation not found'));
      }

      if (!conversation.participants.includes(userId)) {
        return reply.code(403).send(errorPayload('access_denied', 'Access denied'));
      }

      const messages = messageHub.messages.get(conversationId) || [];
      const filteredMessages = messages.filter(m => 
        !messageHub.isUserBlocked(userId, m.senderId)
      );

      return {
        success: true,
        messages: filteredMessages
          .slice(offset, offset + parseInt(limit))
          .map(m => messageHub.formatMessageForUser(m)),
        hasMore: filteredMessages.length > offset + parseInt(limit)
      };
    } catch (error) {
      console.error('[Messages] Get messages error:', error);
      return reply.code(500).send(errorPayload('server_error', 'Failed to get messages'));
    }
  });

  app.post('/api/v1/messages/conversations/:conversationId/messages', async (req, reply) => {
    const { conversationId } = req.params;
    const { senderId, content, replyTo = null } = req.body;
    
    if (!senderId || !content) {
      return reply.code(400).send(errorPayload('invalid_message', 'Sender ID and content are required'));
    }

    try {
      const conversation = messageHub.conversations.get(conversationId);
      if (!conversation) {
        return reply.code(404).send(errorPayload('conversation_not_found', 'Conversation not found'));
      }

      if (!conversation.participants.includes(senderId)) {
        return reply.code(403).send(errorPayload('access_denied', 'Access denied'));
      }

      const message = messageHub.addMessage(conversationId, {
        senderId,
        content,
        type: 'text',
        replyTo
      });

      return reply.code(201).send({
        success: true,
        message
      });
    } catch (error) {
      console.error('[Messages] Send message error:', error);
      return reply.code(500).send(errorPayload('server_error', 'Failed to send message'));
    }
  });

  app.post('/api/v1/messages/conversations/:conversationId/attachments', async (req, reply) => {
    const { conversationId } = req.params;
    const { senderId } = req.query;
    
    if (!senderId) {
      return reply.code(400).send(errorPayload('missing_sender_id', 'Sender ID is required'));
    }

    try {
      const data = await req.file();
      if (!data) {
        return reply.code(400).send(errorPayload('no_file', 'No file provided'));
      }

      const conversation = messageHub.conversations.get(conversationId);
      if (!conversation) {
        return reply.code(404).send(errorPayload('conversation_not_found', 'Conversation not found'));
      }

      if (!conversation.participants.includes(senderId)) {
        return reply.code(403).send(errorPayload('access_denied', 'Access denied'));
      }

      const attachmentId = 'att_' + crypto.randomBytes(8).toString('hex');
      const fileExtension = path.extname(data.filename);
      const fileName = `${attachmentId}${fileExtension}`;
      const filePath = path.join(ATTACHMENTS_DIR, fileName);

      const buffer = await data.toBuffer();
      fs.writeFileSync(filePath, buffer);

      const attachment = {
        id: attachmentId,
        type: getAttachmentType(data.mimetype),
        mimeType: data.mimetype,
        fileName: data.filename,
        size: buffer.length,
        url: `/api/v1/messages/attachments/${attachmentId}`,
        thumbnailUrl: shouldGenerateThumbnail(data.mimetype) ? 
          `/api/v1/messages/attachments/${attachmentId}/thumbnail` : null
      };

      const message = messageHub.addMessage(conversationId, {
        senderId,
        content: data.filename,
        type: attachment.type,
        attachments: [attachment]
      });

      return reply.code(201).send({
        success: true,
        message,
        attachment
      });
    } catch (error) {
      console.error('[Messages] Upload attachment error:', error);
      return reply.code(500).send(errorPayload('server_error', 'Failed to upload attachment'));
    }
  });

  app.post('/api/v1/messages/conversations/:conversationId/voice', async (req, reply) => {
    const { conversationId } = req.params;
    const input = req.body;
    
    if (!input || !input.base64 || !input.senderId) {
      return reply.code(400).send(errorPayload('invalid_voice_payload', 'Voice data and sender ID are required'));
    }

    try {
      const conversation = messageHub.conversations.get(conversationId);
      if (!conversation) {
        return reply.code(404).send(errorPayload('conversation_not_found', 'Conversation not found'));
      }

      if (!conversation.participants.includes(input.senderId)) {
        return reply.code(403).send(errorPayload('access_denied', 'Access denied'));
      }

      const fileBytes = Buffer.from(input.base64, 'base64');
      const voiceMessageId = 'voice_' + crypto.randomBytes(8).toString('hex');
      const extension = input.mimeType === 'audio/aac' ? 'aac' : 
                       input.mimeType === 'audio/mpeg' ? 'mp3' : 
                       input.mimeType === 'audio/webm' ? 'webm' : 'm4a';
      const fileName = `${voiceMessageId}.${extension}`;
      const filePath = path.join(STORAGE_DIR, fileName);
      
      fs.writeFileSync(filePath, fileBytes);

      const durationSec = Math.max(1, input.durationSec || 1);
      
      const voiceAttachment = {
        id: voiceMessageId,
        type: 'audio',
        mimeType: input.mimeType,
        fileName: fileName,
        size: fileBytes.length,
        url: `/api/v1/messages/voice/files/${voiceMessageId}`,
        durationSec,
        waveform: input.waveform || []
      };

      const message = messageHub.addMessage(conversationId, {
        senderId: input.senderId,
        content: `Voice message (${durationSec}s)`,
        type: 'voice',
        attachments: [voiceAttachment],
        metadata: {
          durationSec,
          waveform: input.waveform || []
        }
      });

      return reply.code(201).send({
        success: true,
        message,
        voiceMessage: voiceAttachment
      });
    } catch (error) {
      console.error('[Messages] Voice message error:', error);
      return reply.code(500).send(errorPayload('server_error', 'Failed to process voice message'));
    }
  });

  app.get('/api/v1/messages/voice/files/:voiceMessageId', async (req, reply) => {
    const { voiceMessageId } = req.params;
    
    try {
      const files = fs.readdirSync(STORAGE_DIR);
      const voiceFile = files.find(f => f.startsWith(voiceMessageId));
      
      if (!voiceFile) {
        return reply.code(404).send(errorPayload('voice_not_found', 'Voice file not found'));
      }

      const filePath = path.join(STORAGE_DIR, voiceFile);
      const fileBuffer = fs.readFileSync(filePath);
      
      const ext = path.extname(voiceFile);
      const mimeType = ext === '.mp3' ? 'audio/mpeg' : 
                      ext === '.aac' ? 'audio/aac' : 
                      ext === '.webm' ? 'audio/webm' : 'audio/mp4';
      
      reply.type(mimeType);
      return reply.send(fileBuffer);
    } catch (error) {
      console.error('[Messages] Voice file error:', error);
      return reply.code(500).send(errorPayload('server_error', 'Failed to get voice file'));
    }
  });

  app.post('/api/v1/messages/users/:userId/block', async (req, reply) => {
    const { userId } = req.params;
    const { blockerId } = req.body;
    
    if (!blockerId) {
      return reply.code(400).send(errorPayload('missing_blocker_id', 'Blocker ID is required'));
    }

    try {
      messageHub.blockUser(blockerId, userId);
      
      return {
        success: true,
        message: 'User blocked successfully'
      };
    } catch (error) {
      console.error('[Messages] Block user error:', error);
      return reply.code(500).send(errorPayload('server_error', 'Failed to block user'));
    }
  });

  app.post('/api/v1/messages/users/:userId/unblock', async (req, reply) => {
    const { userId } = req.params;
    const { unblockerId } = req.body;
    
    if (!unblockerId) {
      return reply.code(400).send(errorPayload('missing_unblocker_id', 'Unblocker ID is required'));
    }

    try {
      messageHub.unblockUser(unblockerId, userId);
      
      return {
        success: true,
        message: 'User unblocked successfully'
      };
    } catch (error) {
      console.error('[Messages] Unblock user error:', error);
      return reply.code(500).send(errorPayload('server_error', 'Failed to unblock user'));
    }
  });

  app.post('/api/v1/messages/conversations/:conversationId/read', async (req, reply) => {
    const { conversationId } = req.params;
    const { userId, messageId } = req.body;
    
    if (!userId) {
      return reply.code(400).send(errorPayload('missing_user_id', 'User ID is required'));
    }

    try {
      if (messageId) {
        messageHub.handleMarkAsRead(userId, messageId);
      } else {
        const messages = messageHub.messages.get(conversationId) || [];
        messages.forEach(message => {
          if (message.senderId !== userId) {
            messageHub.handleMarkAsRead(userId, message.id);
          }
        });
      }
      
      return {
        success: true,
        unreadCount: 0
      };
    } catch (error) {
      console.error('[Messages] Mark read error:', error);
      return reply.code(500).send(errorPayload('server_error', 'Failed to mark messages as read'));
    }
  });

  app.post('/api/v1/messages/conversations/:conversationId/typing', async (req, reply) => {
    const { conversationId } = req.params;
    const { userId, isTyping } = req.body;
    
    if (!userId) {
      return reply.code(400).send(errorPayload('missing_user_id', 'User ID is required'));
    }

    try {
      if (isTyping) {
        messageHub.handleTypingStart(userId, conversationId);
      } else {
        messageHub.handleTypingStop(userId, conversationId);
      }
      
      return {
        success: true
      };
    } catch (error) {
      console.error('[Messages] Typing indicator error:', error);
      return reply.code(500).send(errorPayload('server_error', 'Failed to update typing status'));
    }
  });

  // Health check endpoint
  app.get('/health', async (req, reply) => {
    return {
      service: 'fastify-messages',
      status: 'healthy',
      port: 8094,
      websocketPort: 8095,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      conversations: messageHub.conversations.size,
      messages: messageHub.messages.size,
      onlineUsers: messageHub.onlineUsers.size
    };
  });

  return app;
};
