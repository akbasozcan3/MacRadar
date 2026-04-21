import type {
  PlayerPositionPayload,
  SocketStatus,
} from './types';
import { parsePlayerSocketMessage } from './protocol';
import type { PlayerSocketMessage } from './types';
import { getApiSessionToken } from '../services/apiClient';

type PlayerSocketClientOptions = {
  onClose: () => void;
  onMessage: (message: PlayerSocketMessage) => void;
  onStatus: (status: SocketStatus) => void;
  playerId: string;
  roomId: string;
  url: string;
};

export class PlayerSocketClient {
  private manuallyClosed = false;
  private pendingPosition: PlayerPositionPayload | null = null;
  private socket: WebSocket | null = null;
  private socketGeneration = 0;

  constructor(private readonly options: PlayerSocketClientOptions) {}

  connect() {
    this.manuallyClosed = false;
    const sessionToken = getApiSessionToken();
    const separator = this.options.url.includes('?') ? '&' : '?';
    const tokenParam = sessionToken
      ? `&token=${encodeURIComponent(sessionToken)}`
      : '';
    const target = `${this.options.url}${separator}player=${encodeURIComponent(
      this.options.playerId,
    )}&room=${encodeURIComponent(this.options.roomId)}${tokenParam}`;
    const socketGeneration = this.socketGeneration + 1;
    this.socketGeneration = socketGeneration;

    this.options.onStatus('connecting');

    const socket = sessionToken
      ? new WebSocket(target, undefined, {
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        })
      : new WebSocket(target);
    this.socket = socket;

    socket.onopen = () => {
      if (socketGeneration !== this.socketGeneration) {
        socket.close();
        return;
      }
      this.options.onStatus('live');
      this.flushPendingPosition();
    };

    socket.onerror = () => {
      if (socketGeneration !== this.socketGeneration) {
        return;
      }
      this.options.onStatus('offline');
    };

    socket.onclose = () => {
      if (socketGeneration !== this.socketGeneration) {
        return;
      }
      this.socket = null;
      this.options.onStatus('offline');
      if (!this.manuallyClosed) {
        this.options.onClose();
      }
    };

    socket.onmessage = event => {
      if (socketGeneration !== this.socketGeneration) {
        return;
      }

      try {
        const parsed = parsePlayerSocketMessage(JSON.parse(event.data as string));
        if (!parsed) {
          return;
        }
        this.options.onMessage(parsed);
      } catch {
        // Ignore malformed frames and keep the stream alive.
      }
    };
  }

  sendPosition(payload: PlayerPositionPayload) {
    this.pendingPosition = payload;
    this.flushPendingPosition();
  }

  close() {
    this.manuallyClosed = true;
    this.pendingPosition = null;
    this.socketGeneration += 1;
    this.socket?.close();
    this.socket = null;
  }

  private flushPendingPosition() {
    if (!this.pendingPosition) {
      return;
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const payload = this.pendingPosition;
    this.pendingPosition = null;

    try {
      this.socket.send(JSON.stringify(payload));
    } catch {
      this.pendingPosition = payload;
    }
  }
}
