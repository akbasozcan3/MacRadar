import type { ConversationSummary } from '../../types/MessagesTypes/MessagesTypes';

type ConversationStateSource = Pick<
  ConversationSummary,
  | 'canSendMessage'
  | 'isMessageRequest'
  | 'isPeerBlockedByViewer'
  | 'isViewerBlockedByPeer'
  | 'messagingHint'
  | 'messagingMode'
> | null | undefined;

export type ConversationUIState =
  | 'accepted'
  | 'request_required'
  | 'request_received'
  | 'request_rejected'
  | 'request_sent'
  | 'restricted'
  | 'blocked_by_me'
  | 'blocked_by_them';

type ConversationLockTextOptions = {
  blockedByThemLabel: string;
  messagingHint?: string | null;
};

const REQUEST_BANNER_TEXT: Partial<Record<ConversationUIState, string>> = {
  request_required: 'İlk mesajın mesaj isteği olarak gönderilir.',
  request_sent:
    'Mesaj isteği gönderildi. Karşı taraf kabul ettiğinde sohbet başlayacak.',
};

const REQUEST_FLOW_EMPTY_TEXT = {
  description: 'Göndereceğin ilk mesaj, mesaj isteği olarak iletilir.',
  title: 'Henüz mesaj yok',
} as const;

const DEFAULT_EMPTY_TEXT = {
  description: 'İlk mesajı göndererek konuşmayı başlat.',
  title: 'Henüz mesaj yok',
} as const;

const DEFAULT_LOCK_TEXT: Partial<Record<ConversationUIState, string>> = {
  blocked_by_me: 'Bu kullanıcıyı engelledin. Engeli kaldırmadan mesaj gönderemezsin.',
  request_rejected: 'Mesaj isteği reddedildi. Takip etmeden yeniden mesaj gönderemezsin.',
  restricted: 'Bu kullanıcı sadece takip ettiklerinden mesaj kabul ediyor.',
};

export function getConversationUIState(
  conversation: ConversationStateSource,
): ConversationUIState {
  if (!conversation) {
    return 'accepted';
  }

  if (conversation.isPeerBlockedByViewer) {
    return 'blocked_by_me';
  }
  if (conversation.isViewerBlockedByPeer) {
    return 'blocked_by_them';
  }

  switch (conversation.messagingMode) {
    case 'request_required':
      return 'request_required';
    case 'request_pending_incoming':
      return 'request_received';
    case 'request_pending_outgoing':
      return 'request_sent';
    case 'request_rejected':
      return 'request_rejected';
    case 'restricted':
      return 'restricted';
    case 'blocked':
      return conversation.isPeerBlockedByViewer
        ? 'blocked_by_me'
        : 'blocked_by_them';
    default:
      return conversation.isMessageRequest ? 'request_received' : 'accepted';
  }
}

export function shouldShowConversationRequestBanner(
  state: ConversationUIState,
) {
  return state === 'request_required' || state === 'request_sent';
}

export function getRequestBannerText(state: ConversationUIState) {
  return REQUEST_BANNER_TEXT[state] ?? '';
}

export function getEmptyStateText(state: ConversationUIState) {
  if (
    state === 'request_required' ||
    state === 'request_sent' ||
    state === 'request_received'
  ) {
    return REQUEST_FLOW_EMPTY_TEXT;
  }

  return DEFAULT_EMPTY_TEXT;
}

export function getConversationComposerPlaceholder(
  state: ConversationUIState,
  lockMessage: string,
) {
  if (lockMessage.trim().length > 0) {
    return lockMessage;
  }

  const bannerText = getRequestBannerText(state);
  if (bannerText.length > 0) {
    return bannerText;
  }
  if (state === 'request_received') {
    return 'Mesaj isteğini kabul etmeden cevap veremezsin.';
  }

  return 'Mesaj yaz...';
}

export function getConversationLockText(
  state: ConversationUIState,
  options: ConversationLockTextOptions,
) {
  if (state === 'accepted' || state === 'request_required') {
    return '';
  }
  if (state === 'request_sent' || state === 'request_received') {
    return '';
  }
  if (state === 'blocked_by_them') {
    return options.blockedByThemLabel;
  }

  const messagingHint = String(options.messagingHint || '').trim();
  if (messagingHint.length > 0) {
    return messagingHint;
  }

  return DEFAULT_LOCK_TEXT[state] ?? '';
}
