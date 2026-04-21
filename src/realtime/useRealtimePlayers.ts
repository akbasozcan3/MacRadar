import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { TRACKING_CONFIG } from './config';
import {
  blendPayload,
  clamp,
  distanceMeters,
  headingDelta,
  moveCoordinate,
  normalizeHeading,
  payloadCoordinate,
  velocityFromHeading,
} from './math';
import { startMotionStream } from './motionStream';
import { PlayerInterpolator } from './playerInterpolator';
import { PlayerSocketClient } from './playerSocket';
import { resolveProtectedMediaUrl } from '../services/protectedMedia';
import type {
  GpsFix,
  MotionSnapshot,
  PlayerPositionPayload,
  PlayerSocketMessage,
  RenderPlayer,
  SocketStatus,
  TrackingDiagnostics,
} from './types';

type LocalProfile = {
  displayName: string;
  photoUrl: string;
  statusLine?: string;
};

type UseRealtimePlayersOptions = {
  enabled: boolean;
  publishEnabled: boolean;
  localProfile: LocalProfile;
  playerId: string;
  roomId: string;
  socketUrl: string;
};

const EMPTY_MOTION: MotionSnapshot = {
  acceleration: { x: 0, y: 0, z: 0 },
  energy: 0,
  gyro: { x: 0, y: 0, z: 0 },
  heading: 0,
  headingAccuracy: 0,
  timestamp: 0,
};

function remoteProfile(playerId: string) {
  const palette = [
    'https://images.unsplash.com/photo-1599566150163-29194dcaad36?auto=format&fit=crop&w=200&q=80',
    'https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=200&q=80',
    'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=200&q=80',
    'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=200&q=80',
  ];
  const seed = Array.from(playerId).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );

  return {
    displayName: `Player ${playerId.slice(-4).toUpperCase()}`,
    photoUrl: palette[seed % palette.length],
  };
}

function toPositionPayload(
  playerId: string,
  roomId: string,
  sequence: number,
  source: 'gps' | 'fused',
  fix: GpsFix,
  motion: MotionSnapshot,
  profile: LocalProfile,
) {
  const heading = normalizeHeading(fix.heading);
  const velocity = velocityFromHeading(Math.max(fix.speed, 0), heading);
  const dn = profile.displayName.trim().slice(0, 120);
  const pu = profile.photoUrl.trim().slice(0, 2048);

  return {
    acc: clamp(fix.accuracy, 0, 999),
    ax: clamp(motion.acceleration.x, -20, 20),
    ay: clamp(motion.acceleration.y, -20, 20),
    az: clamp(motion.acceleration.z, -20, 20),
    gx: clamp(motion.gyro.x, -40, 40),
    gy: clamp(motion.gyro.y, -40, 40),
    gz: clamp(motion.gyro.z, -40, 40),
    ha: clamp(motion.headingAccuracy, 0, 360),
    hdg: heading,
    lat: fix.latitude,
    lng: fix.longitude,
    me: clamp(motion.energy, 0, 5),
    mx: velocity.x,
    my: velocity.y,
    pid: playerId,
    rid: roomId,
    spd: Math.max(fix.speed, 0),
    sq: sequence,
    src: source,
    t: 'p',
    ts: fix.timestamp,
    ...(dn.length > 0 ? { dn } : {}),
    ...(pu.length > 0 ? { pu } : {}),
  } satisfies PlayerPositionPayload;
}

function toRenderPlayer(
  payload: PlayerPositionPayload,
  profile: LocalProfile,
  isLocal: boolean,
): RenderPlayer {
  const fallback = remoteProfile(payload.pid);
  const displayName = isLocal
    ? profile.displayName
    : (typeof payload.dn === 'string' && payload.dn.trim().length > 0
        ? payload.dn.trim()
        : fallback.displayName);
  const photoUrl = isLocal
    ? profile.photoUrl
    : (typeof payload.pu === 'string' && payload.pu.trim().length > 0
        ? resolveProtectedMediaUrl(payload.pu.trim())
        : fallback.photoUrl);

  return {
    coordinate: [payload.lng, payload.lat],
    displayName,
    heading: payload.hdg,
    id: payload.pid,
    isLocal,
    photoUrl,
    speed: payload.spd,
    statusLine: isLocal ? profile.statusLine : undefined,
    updatedAt: payload.ts,
  };
}

function effectivePublishDistanceMeters(accuracy: number) {
  if (!Number.isFinite(accuracy) || accuracy <= 0) {
    return TRACKING_CONFIG.minPublishDistanceMeters;
  }

  return Math.max(
    TRACKING_CONFIG.minPublishDistanceMeters,
    Math.min(0.4, accuracy * 0.1),
  );
}

function shouldPublishPayload(
  previous: PlayerPositionPayload,
  next: PlayerPositionPayload,
) {
  const elapsedMs = Math.max(next.ts - previous.ts, 0);
  if (elapsedMs >= TRACKING_CONFIG.heartbeatIntervalMs) {
    return true;
  }

  if (elapsedMs < TRACKING_CONFIG.minPublishIntervalMs) {
    return false;
  }

  const movedMeters = distanceMeters(
    payloadCoordinate(previous),
    payloadCoordinate(next),
  );
  if (movedMeters >= effectivePublishDistanceMeters(next.acc)) {
    return true;
  }

  const headingMoved = Math.abs(headingDelta(previous.hdg, next.hdg));
  if (headingMoved >= TRACKING_CONFIG.minHeadingDeltaDeg) {
    return true;
  }

  if (Math.abs(next.me - previous.me) >= TRACKING_CONFIG.minMotionEnergyDelta) {
    return true;
  }

  return Math.abs(next.spd - previous.spd) >= TRACKING_CONFIG.minSpeedDeltaMps;
}

function shouldCommitPlayer(
  previous: RenderPlayer | null,
  next: RenderPlayer,
) {
  if (!previous) {
    return true;
  }

  if (
    previous.displayName !== next.displayName ||
    previous.photoUrl !== next.photoUrl ||
    previous.statusLine !== next.statusLine
  ) {
    return true;
  }

  if (
    distanceMeters(previous.coordinate, next.coordinate) >=
    TRACKING_CONFIG.minRenderDistanceMeters
  ) {
    return true;
  }

  if (
    Math.abs(headingDelta(previous.heading, next.heading)) >=
    TRACKING_CONFIG.minRenderHeadingDeltaDeg
  ) {
    return true;
  }

  return Math.abs(next.speed - previous.speed) >= TRACKING_CONFIG.minSpeedDeltaMps;
}

function diagnosticsEqual(
  previous: TrackingDiagnostics,
  next: TrackingDiagnostics,
) {
  return (
    previous.gpsAgeMs === next.gpsAgeMs &&
    previous.motionEnergy === next.motionEnergy &&
    previous.publishedAt === next.publishedAt &&
    previous.remoteCount === next.remoteCount &&
    previous.socketStatus === next.socketStatus
  );
}

function shouldCommitRemotePlayers(
  previous: RenderPlayer[],
  next: RenderPlayer[],
) {
  if (previous.length !== next.length) {
    return true;
  }

  for (let index = 0; index < next.length; index += 1) {
    const previousPlayer = previous[index];
    const nextPlayer = next[index];

    if (!previousPlayer || previousPlayer.id !== nextPlayer.id) {
      return true;
    }

    if (shouldCommitPlayer(previousPlayer, nextPlayer)) {
      return true;
    }
  }

  return false;
}

function reconnectDelayMs(attempt: number) {
  const exponent = Math.max(attempt - 1, 0);
  return Math.min(
    TRACKING_CONFIG.reconnectMaxDelayMs,
    TRACKING_CONFIG.reconnectBaseDelayMs * 2 ** exponent,
  );
}

export function useRealtimePlayers({
  enabled,
  publishEnabled,
  localProfile,
  playerId,
  roomId,
  socketUrl,
}: UseRealtimePlayersOptions) {
  const [localPlayer, setLocalPlayer] = useState<RenderPlayer | null>(null);
  const [remotePlayers, setRemotePlayers] = useState<RenderPlayer[]>([]);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('offline');
  const [diagnostics, setDiagnostics] = useState<TrackingDiagnostics>({
    gpsAgeMs: 0,
    motionEnergy: 0,
    publishedAt: 0,
    remoteCount: 0,
    socketStatus: 'offline',
  });

  const localTruthRef = useRef<PlayerPositionPayload | null>(null);
  const localDisplayRef = useRef<PlayerPositionPayload | null>(null);
  const lastPublishedRef = useRef<PlayerPositionPayload | null>(null);
  const localSequenceRef = useRef(0);
  const motionRef = useRef<MotionSnapshot>(EMPTY_MOTION);
  const remoteInterpolatorsRef = useRef<Map<string, PlayerInterpolator>>(
    new Map(),
  );
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const socketRef = useRef<PlayerSocketClient | null>(null);
  const localProfileRef = useRef(localProfile);
  const publishEnabledRef = useRef(publishEnabled);
  const socketStatusRef = useRef<SocketStatus>('offline');
  const diagnosticsRef = useRef<TrackingDiagnostics>({
    gpsAgeMs: 0,
    motionEnergy: 0,
    publishedAt: 0,
    remoteCount: 0,
    socketStatus: 'offline',
  });
  const diagnosticsFrameRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const lastAnimationTickRef = useRef(0);
  const renderedLocalRef = useRef<RenderPlayer | null>(null);
  const renderedRemoteRef = useRef<RenderPlayer[]>([]);

  useEffect(() => {
    localProfileRef.current = localProfile;
  }, [localProfile]);

  const commitDiagnostics = useCallback((next: TrackingDiagnostics) => {
    if (diagnosticsEqual(diagnosticsRef.current, next)) {
      return;
    }

    diagnosticsRef.current = next;
    setDiagnostics(next);
  }, []);

  useEffect(() => {
    publishEnabledRef.current = publishEnabled;
    if (!publishEnabled) {
      lastPublishedRef.current = null;
      commitDiagnostics({
        ...diagnosticsRef.current,
        publishedAt: 0,
      });
    }
  }, [commitDiagnostics, publishEnabled]);

  const updateSocketStatus = useCallback(
    (nextStatus: SocketStatus) => {
      socketStatusRef.current = nextStatus;
      if (nextStatus === 'live') {
        reconnectAttemptRef.current = 0;
      }

      setSocketStatus(current =>
        current === nextStatus ? current : nextStatus,
      );
      commitDiagnostics({
        ...diagnosticsRef.current,
        socketStatus: nextStatus,
      });

      if (
        nextStatus === 'live' &&
        publishEnabledRef.current &&
        localTruthRef.current
      ) {
        socketRef.current?.sendPosition(localTruthRef.current);
      }
    },
    [commitDiagnostics],
  );

  const upsertRemote = useCallback(
    (payload: PlayerPositionPayload) => {
      if (payload.pid === playerId) {
        return;
      }

      const currentInterpolator =
        remoteInterpolatorsRef.current.get(payload.pid) ??
        new PlayerInterpolator();
      currentInterpolator.push(payload);
      remoteInterpolatorsRef.current.set(payload.pid, currentInterpolator);
    },
    [playerId],
  );

  const handleSocketMessage = useCallback(
    (message: PlayerSocketMessage) => {
      if (message.t === 's') {
        message.ps.forEach(upsertRemote);
        return;
      }

      if (message.t === 'p') {
        upsertRemote(message);
        return;
      }

      if (message.t === 'l') {
        remoteInterpolatorsRef.current.delete(message.pid);
      }
    },
    [upsertRemote],
  );

  const sendIfNeeded = useCallback((payload: PlayerPositionPayload) => {
    const previous = lastPublishedRef.current;

    if (!socketRef.current) {
      return;
    }

    if (!publishEnabledRef.current) {
      return;
    }

    if (!previous) {
      socketRef.current.sendPosition(payload);
      lastPublishedRef.current = payload;
      return;
    }

    if (!shouldPublishPayload(previous, payload)) {
      return;
    }

    socketRef.current.sendPosition(payload);
    lastPublishedRef.current = payload;
  }, []);

  const ingestGpsFix = useCallback(
    (fix: GpsFix) => {
      if (!enabled) {
        return;
      }

      localSequenceRef.current += 1;
      const payload = toPositionPayload(
        playerId,
        roomId,
        localSequenceRef.current,
        'gps',
        fix,
        motionRef.current,
        localProfileRef.current,
      );

      const currentDisplay = localDisplayRef.current;
      localTruthRef.current = payload;
      localDisplayRef.current = currentDisplay
        ? blendPayload(currentDisplay, payload, 0.55)
        : payload;

      if (!renderedLocalRef.current) {
        const renderPlayer = toRenderPlayer(
          localDisplayRef.current,
          localProfileRef.current,
          true,
        );
        renderedLocalRef.current = renderPlayer;
        setLocalPlayer(renderPlayer);
      }

      sendIfNeeded(payload);
    },
    [enabled, playerId, roomId, sendIfNeeded],
  );

  useEffect(() => {
    if (!enabled) {
      socketRef.current?.close();
      socketRef.current = null;
      localTruthRef.current = null;
      localDisplayRef.current = null;
      lastPublishedRef.current = null;
      localSequenceRef.current = 0;
      renderedLocalRef.current = null;
      renderedRemoteRef.current = [];
      reconnectAttemptRef.current = 0;
      remoteInterpolatorsRef.current.clear();
      localProfileRef.current = localProfile;
      socketStatusRef.current = 'offline';
      diagnosticsRef.current = {
        gpsAgeMs: 0,
        motionEnergy: 0,
        publishedAt: 0,
        remoteCount: 0,
        socketStatus: 'offline',
      };
      diagnosticsFrameRef.current = 0;
      lastAnimationTickRef.current = 0;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setRemotePlayers([]);
      setLocalPlayer(null);
      setSocketStatus('offline');
      setDiagnostics(diagnosticsRef.current);
      return;
    }

    let active = true;

    const connect = () => {
      if (!active) {
        return;
      }

      const client = new PlayerSocketClient({
        onClose: () => {
          if (!active) {
            return;
          }

          reconnectAttemptRef.current += 1;
          const delayMs = reconnectDelayMs(reconnectAttemptRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            connect();
          }, delayMs);
        },
        onMessage: handleSocketMessage,
        onStatus: updateSocketStatus,
        playerId,
        roomId,
        url: socketUrl,
      });

      socketRef.current = client;
      client.connect();
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [
    enabled,
    handleSocketMessage,
    localProfile,
    playerId,
    roomId,
    socketUrl,
    updateSocketStatus,
  ]);

  useEffect(() => {
    if (!enabled) {
      motionRef.current = EMPTY_MOTION;
      return;
    }

    return startMotionStream(sample => {
      motionRef.current = sample;
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let active = true;
    lastAnimationTickRef.current = 0;

    const advanceFrame = (now: number) => {
      const truth = localTruthRef.current;
      const currentDisplay = localDisplayRef.current;

      if (truth) {
        let next = truth;
        const motion = motionRef.current;
        const gpsAgeMs = now - truth.ts;

        if (
          gpsAgeMs < TRACKING_CONFIG.motionPredictionWindowMs &&
          motion.energy > 0.03
        ) {
          const fallbackSpeed = clamp(
            motion.energy * TRACKING_CONFIG.staleGpsFallbackSpeedMps,
            0.05,
            2.2,
          );
          const predictedSpeed = truth.spd > 0.2 ? truth.spd : fallbackSpeed;
          const predictedHeading =
            motion.headingAccuracy > 0 && motion.headingAccuracy <= 45
              ? motion.heading
              : truth.hdg;
          const baseCoordinate = currentDisplay
            ? payloadCoordinate(currentDisplay)
            : payloadCoordinate(truth);
          const stepDistance =
            predictedSpeed * (TRACKING_CONFIG.remoteAnimationFrameMs / 1000);
          const [nextLng, nextLat] = moveCoordinate(
            baseCoordinate,
            predictedHeading,
            stepDistance,
          );
          const driftFromTruth = distanceMeters(payloadCoordinate(truth), [
            nextLng,
            nextLat,
          ]);

          if (driftFromTruth <= TRACKING_CONFIG.maxPredictionDriftMeters) {
            const vector = velocityFromHeading(
              predictedSpeed,
              predictedHeading,
            );
            next = {
              ...truth,
              ax: motion.acceleration.x,
              ay: motion.acceleration.y,
              az: motion.acceleration.z,
              gx: motion.gyro.x,
              gy: motion.gyro.y,
              gz: motion.gyro.z,
              ha: motion.headingAccuracy,
              hdg: predictedHeading,
              lat: nextLat,
              lng: nextLng,
              me: motion.energy,
              mx: vector.x,
              my: vector.y,
              spd: predictedSpeed,
              src: 'fused',
              ts: now,
            };
          }
        }

        const displayPayload = currentDisplay
          ? blendPayload(currentDisplay, next, TRACKING_CONFIG.localBlendFactor)
          : next;

        localDisplayRef.current = displayPayload;
        sendIfNeeded(displayPayload);
        const nextLocalPlayer = toRenderPlayer(
          displayPayload,
          localProfileRef.current,
          true,
        );
        if (shouldCommitPlayer(renderedLocalRef.current, nextLocalPlayer)) {
          renderedLocalRef.current = nextLocalPlayer;
          setLocalPlayer(nextLocalPlayer);
        }
      }

      const nextRemotePlayers: RenderPlayer[] = [];
      for (const [
        remoteId,
        interpolator,
      ] of remoteInterpolatorsRef.current.entries()) {
        if (interpolator.isStale(now)) {
          remoteInterpolatorsRef.current.delete(remoteId);
          continue;
        }

        const sampled = interpolator.sample(now);
        if (!sampled) {
          continue;
        }

        nextRemotePlayers.push(
          toRenderPlayer(sampled, remoteProfile(remoteId), false),
        );
      }

      nextRemotePlayers.sort((left, right) => left.id.localeCompare(right.id));

      if (shouldCommitRemotePlayers(renderedRemoteRef.current, nextRemotePlayers)) {
        renderedRemoteRef.current = nextRemotePlayers;
        startTransition(() => {
          setRemotePlayers(nextRemotePlayers);
        });
      }

      if (now - diagnosticsFrameRef.current >= 250) {
        diagnosticsFrameRef.current = now;
        commitDiagnostics({
          gpsAgeMs: truth ? now - truth.ts : 0,
          motionEnergy: motionRef.current.energy,
          publishedAt: lastPublishedRef.current?.ts ?? 0,
          remoteCount: nextRemotePlayers.length,
          socketStatus: socketStatusRef.current,
        });
      }
    };

    const runAnimationFrame = (frameTime: number) => {
      if (!active) {
        return;
      }

      if (
        frameTime - lastAnimationTickRef.current >=
        TRACKING_CONFIG.remoteAnimationFrameMs
      ) {
        lastAnimationTickRef.current = frameTime;
        advanceFrame(frameTime);
      }

      animationFrameRef.current = requestAnimationFrame(runAnimationFrame);
    };

    animationFrameRef.current = requestAnimationFrame(runAnimationFrame);

    return () => {
      active = false;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [commitDiagnostics, enabled, sendIfNeeded]);

  return {
    diagnostics,
    ingestGpsFix,
    localPlayer,
    remotePlayers,
    socketStatus,
  };
}
