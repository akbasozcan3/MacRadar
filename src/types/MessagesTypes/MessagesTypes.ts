export type ConversationPeer = {
  avatarUrl: string;
  fullName: string;
  id: string;
  isVerified: boolean;
  username: string;
};

export type MessageContentKind = 'text' | 'voice' | 'photo' | 'location';
export type ChatRequestStatus =
  | 'none'
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'blocked';
export type ChatRequestDirection = 'none' | 'incoming' | 'outgoing';
export type ConversationMessagingMode =
  | 'direct'
  | 'request_required'
  | 'request_pending_incoming'
  | 'request_pending_outgoing'
  | 'request_rejected'
  | 'restricted'
  | 'blocked';

export type PhotoMessageAsset = {
  mimeType?: string;
  sizeBytes?: number;
  title?: string;
  url?: string;
};

export type LocationMessageAsset = {
  latitude?: number;
  locationLabel?: string;
  longitude?: number;
  title?: string;
};

export type ConversationSummary = {
  canSendMessage?: boolean;
  chatRequestDirection?: ChatRequestDirection;
  chatRequestStatus?: ChatRequestStatus;
  conversationId: string;
  isMessageRequest: boolean;
  isMuted?: boolean;
  isPeerBlockedByViewer: boolean;
  isUnread: boolean;
  isViewerBlockedByPeer: boolean;
  lastLocationMessage?: LocationMessageAsset | null;
  lastMessage: string;
  lastMessageAt: string;
  lastMessageKind?: MessageContentKind;
  lastMessagePreview?: string;
  lastPhotoMessage?: PhotoMessageAsset | null;
  lastVoiceMessage?: VoiceMessageAsset | null;
  messagingHint?: string;
  messagingMode?: ConversationMessagingMode;
  peerLastReadAt?: string;
  peerLastReadMessageId?: string;
  peer: ConversationPeer;
  unreadCount: number;
};

export type ConversationListResponse = {
  conversations: ConversationSummary[];
  hasMore: boolean;
  nextCursor?: string;
};

export type LocalConversationMessageStatus = 'pending' | 'sending';

export type ConversationMessage = {
  body: string;
  clientNonce?: string;
  conversationId: string;
  createdAt: string;
  id: string;
  isMine: boolean;
  kind?: MessageContentKind;
  locationMessage?: LocationMessageAsset | null;
  localStatus?: LocalConversationMessageStatus;
  photoMessage?: PhotoMessageAsset | null;
  preview?: string;
  senderId: string;
  voiceMessage?: VoiceMessageAsset | null;
};

export type ConversationMessagesResponse = {
  conversationId: string;
  hasMore: boolean;
  messages: ConversationMessage[];
  nextCursor?: string;
};

export type ConversationMessageResponse = {
  conversationId: string;
  conversation?: ConversationSummary;
  message: ConversationMessage;
};

export type ConversationCreateRequest = {
  initialMessage?: string;
  recipientId: string;
};

export type ConversationCreateResponse = {
  conversation?: ConversationSummary;
  conversationId: string;
  message?: ConversationMessage;
};

export type ConversationReadResponse = {
  conversationId: string;
  lastReadAt: string;
  lastReadMessageId?: string;
  unreadCount: number;
};

export type ConversationRequestAcceptResponse = {
  acceptedAt: string;
  conversation?: ConversationSummary;
  conversationId: string;
};

export type ConversationRequestRejectResponse = {
  conversation?: ConversationSummary;
  conversationId: string;
  rejectedAt: string;
};

export type ConversationMuteResponse = {
  conversationId: string;
  muted: boolean;
};

export type ConversationClearResponse = {
  clearedAt: string;
  conversationId: string;
  unreadCount: number;
};

export type ConversationDeleteResponse = {
  conversationId: string;
  deleted: boolean;
  mode?: 'hard' | 'self';
};

export type VoiceUploadRequest = {
  base64: string;
  clientNonce?: string;
  conversationId: string;
  durationSec: number;
  fileName?: string;
  mimeType: string;
  waveform?: number[];
};

export type VoiceMessageAsset = {
  conversationId: string;
  createdAt: string;
  durationSec: number;
  fileName: string;
  id: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  waveform?: number[];
};

export type VoiceUploadResponse = {
  voiceMessage: VoiceMessageAsset;
};

export type MessageRealtimeEventType =
  | 'heartbeat'
  | 'welcome'
  | 'message.created'
  | 'message.read'
  | 'message.request.updated'
  | 'message_request.created'
  | 'message_request.resolved'
  | 'message_request.cancelled'
  | 'relationship.blocked'
  | 'relationship.unblocked'
  | 'typing'
  | 'error';

export type MessageRealtimeEvent = {
  code?: string;
  conversationId?: string;
  eventId?: string;
  fromUserId?: string;
  isTyping?: boolean;
  message?: ConversationMessage;
  lastReadAt?: string;
  messageId?: string;
  peerUserId?: string;
  requestDelta?: number;
  requestReason?: string;
  serverTime: string;
  status?: string;
  type: MessageRealtimeEventType | string;
  unreadCount?: number;
};
