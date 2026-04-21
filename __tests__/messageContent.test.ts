import {
  encodeRichMessagePayload,
  hydrateConversationMessage,
  hydrateConversationSummary,
  parseMessageContent,
} from '../src/features/messages/messageContent';

describe('messageContent', () => {
  it('parses plain text messages', () => {
    const parsed = parseMessageContent('Merhaba');

    expect(parsed.kind).toBe('text');
    expect(parsed.preview).toBe('Merhaba');
    expect(parsed.voiceMessage).toBeNull();
  });

  it('encodes and parses voice messages', () => {
    const body = encodeRichMessagePayload({
      durationSec: 12,
      kind: 'voice',
      mimeType: 'audio/mp4',
      sizeBytes: 1280,
      voiceId: 'voice_123',
      voiceUrl: '/api/v1/messages/voice/files/voice_123',
      waveform: [0.1, 2, -1, 0.4],
    });

    const parsed = parseMessageContent(body);

    expect(parsed.kind).toBe('voice');
    expect(parsed.preview).toBe('Sesli mesaj (12 sn)');
    expect(parsed.voiceMessage?.id).toBe('voice_123');
    expect(parsed.voiceMessage?.waveform).toEqual([0.1, 1, 0.4]);
  });

  it('hydrates backend message models with previews', () => {
    const body = encodeRichMessagePayload({
      durationSec: 9,
      kind: 'voice',
      voiceId: 'voice_456',
      voiceUrl: '/api/v1/messages/voice/files/voice_456',
    });

    const message = hydrateConversationMessage({
      body,
      conversationId: 'conv_1',
      createdAt: '2026-03-26T10:00:00.000Z',
      id: 'msg_1',
      isMine: true,
      senderId: 'user_1',
    });

    const summary = hydrateConversationSummary({
      conversationId: 'conv_1',
      isMessageRequest: false,
      isPeerBlockedByViewer: false,
      isUnread: false,
      isViewerBlockedByPeer: false,
      lastMessage: body,
      lastMessageAt: '2026-03-26T10:00:00.000Z',
      peer: {
        avatarUrl: '',
        fullName: 'Peer',
        id: 'user_2',
        isVerified: false,
        username: 'peer',
      },
      unreadCount: 0,
    });

    expect(message.kind).toBe('voice');
    expect(message.preview).toBe('Sesli mesaj (9 sn)');
    expect(summary.lastMessageKind).toBe('voice');
    expect(summary.lastMessagePreview).toBe('Sesli mesaj (9 sn)');
    expect(summary.lastVoiceMessage?.id).toBe('voice_456');
  });
});
