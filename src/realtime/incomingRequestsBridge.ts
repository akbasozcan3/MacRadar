type FollowRequestRealtimePayload = {
  delta?: number;
  requesterId?: string;
  source?: 'notifications_catchup' | 'notifications_socket' | 'request_summary_sync';
};

type StreetRequestRealtimePayload = {
  delta?: number;
  rawCount?: number;
  requesterId?: string;
  source?: 'notifications_catchup' | 'notifications_socket' | 'request_summary_sync';
};

const followListeners = new Set<(payload: FollowRequestRealtimePayload) => void>();
const streetListeners = new Set<(payload: StreetRequestRealtimePayload) => void>();

export function subscribeRealtimeFollowRequest(
  listener: (payload: FollowRequestRealtimePayload) => void,
): () => void {
  followListeners.add(listener);
  return () => {
    followListeners.delete(listener);
  };
}

export function emitRealtimeFollowRequest(payload: FollowRequestRealtimePayload) {
  followListeners.forEach(fn => {
    try {
      fn(payload);
    } catch {
      // ignore listener errors
    }
  });
}

export function subscribeRealtimeStreetRequest(
  listener: (payload: StreetRequestRealtimePayload) => void,
): () => void {
  streetListeners.add(listener);
  return () => {
    streetListeners.delete(listener);
  };
}

export function emitRealtimeStreetRequest(payload: StreetRequestRealtimePayload) {
  streetListeners.forEach(fn => {
    try {
      fn(payload);
    } catch {
      // ignore listener errors
    }
  });
}
