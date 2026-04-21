import type {
  ConversationMessage,
  LocalConversationMessageStatus,
} from '../../types/MessagesTypes/MessagesTypes';

function normalizeClientNonce(value: string | null | undefined) {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : '';
}

export function hasSameMessageIdentity(
  left: ConversationMessage,
  right: ConversationMessage,
) {
  if (left.id === right.id) {
    return true;
  }

  const leftClientNonce = normalizeClientNonce(left.clientNonce);
  const rightClientNonce = normalizeClientNonce(right.clientNonce);
  return leftClientNonce.length > 0 && leftClientNonce === rightClientNonce;
}

export function prependMessage(
  existing: ConversationMessage[],
  message: ConversationMessage,
) {
  const filtered = existing.filter(item => !hasSameMessageIdentity(item, message));
  return [message, ...filtered];
}

export function replaceMessageById(
  existing: ConversationMessage[],
  targetId: string,
  message: ConversationMessage,
) {
  const filtered = existing.filter(
    item => item.id !== targetId && !hasSameMessageIdentity(item, message),
  );
  return [message, ...filtered];
}

export function removeMessageById(
  existing: ConversationMessage[],
  messageId: string,
) {
  return existing.filter(item => item.id !== messageId);
}

export function updateLocalMessageStatus(
  existing: ConversationMessage[],
  messageId: string,
  nextStatus: LocalConversationMessageStatus,
) {
  return existing.map(item =>
    item.id === messageId
      ? {
          ...item,
          localStatus: nextStatus,
        }
      : item,
  );
}

export function mergeServerMessagesWithLocalState(
  existing: ConversationMessage[],
  incoming: ConversationMessage[],
) {
  const localMessages = existing.filter(
    item => item.localStatus === 'pending' || item.localStatus === 'sending',
  );
  if (localMessages.length === 0) {
    return incoming;
  }

  const preservedLocal = localMessages.filter(
    localMessage =>
      !incoming.some(serverMessage =>
        hasSameMessageIdentity(localMessage, serverMessage),
      ),
  );
  return [...preservedLocal, ...incoming];
}

export function findMatchingLocalOutgoingMessageId(
  existing: ConversationMessage[],
  incoming: ConversationMessage,
) {
  const incomingClientNonce = normalizeClientNonce(incoming.clientNonce);
  if (incomingClientNonce.length > 0) {
    const nonceMatch = existing.find(item => {
      if (
        item.localStatus !== 'pending' &&
        item.localStatus !== 'sending'
      ) {
        return false;
      }
      if (!item.isMine || !incoming.isMine) {
        return false;
      }
      return normalizeClientNonce(item.clientNonce) === incomingClientNonce;
    });
    if (nonceMatch) {
      return nonceMatch.id;
    }
  }

  const match = existing.find(item => {
    if (
      item.localStatus !== 'pending' &&
      item.localStatus !== 'sending'
    ) {
      return false;
    }
    if (!item.isMine || !incoming.isMine) {
      return false;
    }
    if ((item.kind ?? 'text') !== (incoming.kind ?? 'text')) {
      return false;
    }
    if ((item.preview ?? '').trim() !== (incoming.preview ?? '').trim()) {
      return false;
    }
    if ((item.body ?? '').trim() !== (incoming.body ?? '').trim()) {
      return false;
    }
    return true;
  });
  return match?.id ?? null;
}

export function appendMessagePage(
  existing: ConversationMessage[],
  incoming: ConversationMessage[],
) {
  if (incoming.length === 0) {
    return existing;
  }

  const merged = [...existing];
  incoming.forEach(item => {
    if (merged.some(existingItem => hasSameMessageIdentity(existingItem, item))) {
      return;
    }
    merged.push(item);
  });
  return merged;
}
