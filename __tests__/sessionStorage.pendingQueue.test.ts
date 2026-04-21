const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearStoredPendingConversationMessages,
  readStoredPendingConversationMessages,
  storePendingConversationMessages,
} from '../src/services/sessionStorage';

describe('sessionStorage pending queue', () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
  });

  it('persists and restores pending text and voice messages by user', async () => {
    const textCreatedAt = new Date(Date.now() - 120_000).toISOString();
    const voiceCreatedAt = new Date(Date.now() - 60_000).toISOString();
    await storePendingConversationMessages('viewer-1', [
      {
        conversationId: 'conv-1',
        kind: 'text',
        localMessage: {
          body: 'Merhaba',
          conversationId: 'conv-1',
          createdAt: textCreatedAt,
          id: 'local-text-1',
          isMine: true,
          kind: 'text',
          localStatus: 'pending',
          preview: 'Merhaba',
          senderId: 'viewer-1',
        },
        messageId: 'local-text-1',
        text: 'Merhaba',
        updatedAt: textCreatedAt,
      },
      {
        conversationId: 'conv-2',
        kind: 'voice',
        localMessage: {
          body: 'voice-body',
          conversationId: 'conv-2',
          createdAt: voiceCreatedAt,
          id: 'local-voice-1',
          isMine: true,
          kind: 'voice',
          localStatus: 'pending',
          preview: 'Sesli mesaj (7 sn)',
          senderId: 'viewer-1',
          voiceMessage: {
            conversationId: 'conv-2',
            createdAt: voiceCreatedAt,
            durationSec: 7,
            fileName: 'voice.m4a',
            id: '',
            mimeType: 'audio/mp4',
            sizeBytes: 1280,
            url: '',
            waveform: [0.1, 0.4, 0.2],
          },
        },
        messageId: 'local-voice-1',
        updatedAt: voiceCreatedAt,
        voiceDraft: {
          base64: 'ZmFrZQ==',
          durationSec: 7,
          fileName: 'voice.m4a',
          mimeType: 'audio/mp4',
          sizeBytes: 1280,
          waveform: [0.1, 0.4, 0.2],
        },
      },
    ]);

    const restored = await readStoredPendingConversationMessages('viewer-1');

    expect(restored).toHaveLength(2);
    expect(restored[0]?.messageId).toBe('local-voice-1');
    expect(restored[0]?.voiceDraft?.fileName).toBe('voice.m4a');
    expect(restored[1]?.messageId).toBe('local-text-1');
    expect(AsyncStorage.setItem).toHaveBeenCalled();
    expect(mockStorage.has('macradar:messages-pending:v1:viewer-1')).toBe(true);
  });

  it('filters malformed records and clears persisted queue on demand', async () => {
    const freshCreatedAt = new Date(Date.now() - 60_000).toISOString();
    await AsyncStorage.setItem(
      'macradar:messages-pending:v1:viewer-2',
      JSON.stringify([
        {
          conversationId: 'conv-3',
          kind: 'text',
          localMessage: {
            body: 'Hazir',
            conversationId: 'conv-3',
            createdAt: freshCreatedAt,
            id: 'local-ok-1',
            isMine: true,
            kind: 'text',
            localStatus: 'pending',
            preview: 'Hazir',
            senderId: 'viewer-2',
          },
          messageId: 'local-ok-1',
          text: 'Hazir',
          updatedAt: freshCreatedAt,
        },
        {
          conversationId: '',
          kind: 'text',
          localMessage: {},
          messageId: '',
          updatedAt: '',
        },
      ]),
    );

    const restored = await readStoredPendingConversationMessages('viewer-2');

    expect(restored).toHaveLength(1);
    expect(restored[0]?.messageId).toBe('local-ok-1');

    await clearStoredPendingConversationMessages('viewer-2');

    expect(await readStoredPendingConversationMessages('viewer-2')).toEqual([]);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      'macradar:messages-pending:v1:viewer-2',
    );
  });

  it('prunes stale and overflowing pending records while preserving the newest ones', async () => {
    const now = Date.now();
    const freshItems = Array.from({ length: 34 }, (_, index) => ({
      conversationId: `conv-${index}`,
      kind: 'text' as const,
      localMessage: {
        body: `Mesaj ${index}`,
        conversationId: `conv-${index}`,
        createdAt: new Date(now - index * 60_000).toISOString(),
        id: `local-${index}`,
        isMine: true,
        kind: 'text' as const,
        localStatus: 'pending' as const,
        preview: `Mesaj ${index}`,
        senderId: 'viewer-3',
      },
      messageId: `local-${index}`,
      text: `Mesaj ${index}`,
      updatedAt: new Date(now - index * 60_000).toISOString(),
    }));

    await storePendingConversationMessages('viewer-3', [
      ...freshItems,
      {
        conversationId: 'conv-stale',
        kind: 'text',
        localMessage: {
          body: 'Eski',
          conversationId: 'conv-stale',
          createdAt: new Date(now - 1000 * 60 * 60 * 24 * 5).toISOString(),
          id: 'local-stale',
          isMine: true,
          kind: 'text',
          localStatus: 'pending',
          preview: 'Eski',
          senderId: 'viewer-3',
        },
        messageId: 'local-stale',
        text: 'Eski',
        updatedAt: new Date(now - 1000 * 60 * 60 * 24 * 5).toISOString(),
      },
    ]);

    const restored = await readStoredPendingConversationMessages('viewer-3');

    expect(restored).toHaveLength(30);
    expect(restored.some(item => item.messageId === 'local-stale')).toBe(false);
    expect(restored[0]?.messageId).toBe('local-0');
    expect(restored[29]?.messageId).toBe('local-29');
  });
});
