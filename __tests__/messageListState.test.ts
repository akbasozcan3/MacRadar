import {
  appendMessagePage,
  findMatchingLocalOutgoingMessageId,
  hasSameMessageIdentity,
  mergeServerMessagesWithLocalState,
  prependMessage,
  replaceMessageById,
} from '../src/features/messages/messageListState';
import type { ConversationMessage } from '../src/types/MessagesTypes/MessagesTypes';

function buildMessage(
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    body: 'Merhaba',
    conversationId: 'conv_1',
    createdAt: '2026-04-06T10:00:00.000Z',
    id: 'msg_1',
    isMine: true,
    kind: 'text',
    preview: 'Merhaba',
    senderId: 'user_1',
    ...overrides,
  };
}

describe('messageListState', () => {
  it('treats matching clientNonce values as the same message identity', () => {
    const pending = buildMessage({
      clientNonce: 'nonce_1',
      id: 'local_1',
      localStatus: 'pending',
    });
    const server = buildMessage({
      clientNonce: 'nonce_1',
      id: 'dm_1',
      localStatus: undefined,
    });

    expect(hasSameMessageIdentity(pending, server)).toBe(true);
  });

  it('replaces local pending voice messages with server copies by clientNonce', () => {
    const pending = buildMessage({
      body: '[[MRMSG]]{"kind":"voice"}',
      clientNonce: 'nonce_voice_1',
      id: 'local_voice_1',
      kind: 'voice',
      localStatus: 'pending',
      preview: 'Sesli mesaj (4 sn)',
    });
    const server = buildMessage({
      body: '[[MRMSG]]{"kind":"voice"}',
      clientNonce: 'nonce_voice_1',
      id: 'dm_voice_1',
      kind: 'voice',
      preview: 'Sesli mesaj (4 sn)',
    });

    expect(mergeServerMessagesWithLocalState([pending], [server])).toEqual([server]);
  });

  it('finds outgoing local messages by clientNonce before text fallback matching', () => {
    const first = buildMessage({
      body: 'Ayni metin',
      clientNonce: 'nonce_a',
      id: 'local_a',
      localStatus: 'sending',
      preview: 'Ayni metin',
    });
    const second = buildMessage({
      body: 'Ayni metin',
      clientNonce: 'nonce_b',
      id: 'local_b',
      localStatus: 'sending',
      preview: 'Ayni metin',
    });
    const server = buildMessage({
      body: 'Ayni metin',
      clientNonce: 'nonce_b',
      id: 'dm_b',
      localStatus: undefined,
      preview: 'Ayni metin',
    });

    expect(findMatchingLocalOutgoingMessageId([first, second], server)).toBe('local_b');
  });

  it('dedupes prepend, replace, and append operations with clientNonce awareness', () => {
    const pending = buildMessage({
      clientNonce: 'nonce_1',
      id: 'local_1',
      localStatus: 'pending',
    });
    const server = buildMessage({
      clientNonce: 'nonce_1',
      id: 'dm_1',
    });

    expect(prependMessage([pending], server)).toEqual([server]);
    expect(replaceMessageById([pending], pending.id, server)).toEqual([server]);
    expect(appendMessagePage([pending], [server])).toEqual([pending]);
  });
});
