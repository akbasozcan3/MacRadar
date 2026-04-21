import { useCallback, useEffect, useRef, useState } from 'react';

import { resolveVoicePlaybackUrl } from '../../services/messagesService';
import {
  readStoredVoicePlaybackRate,
  storeVoicePlaybackRate,
} from '../../services/sessionStorage';
import {
  setVoicePlaybackRate as setNativeVoicePlaybackRate,
  subscribeVoicePlaybackProgress,
  subscribeVoicePlaybackState,
  startVoicePlayback,
  stopVoicePlayback,
} from '../../native/voiceRecorder';
import type { VoiceMessageAsset } from '../../types/MessagesTypes/MessagesTypes';
import {
  normalizeVoicePlaybackRate,
  resolveVoiceDurationSec,
  VOICE_PLAYBACK_RATES,
  type VoicePlaybackRate,
} from '../../features/messages/voiceMessageUi';

const VOICE_PLAYBACK_PROGRESS_TICK_MS = 80;
const VOICE_PLAYBACK_END_TOLERANCE_SEC = 0.08;

type VoicePlaybackContext = {
  durationSec: number;
  elapsedSec: number;
  messageId: string;
  rate: VoicePlaybackRate;
  startedAtMs: number;
};

type UseVoicePlaybackControllerOptions = {
  onError: (message: string | null) => void;
  viewerId: string;
};

function ignorePromise(promise: Promise<unknown>) {
  promise.catch(() => undefined);
}

function computeVoicePlaybackElapsed(context: VoicePlaybackContext) {
  const elapsedSinceStartSec =
    ((Date.now() - context.startedAtMs) / 1000) * context.rate;
  return Math.min(
    context.durationSec,
    Math.max(0, context.elapsedSec + elapsedSinceStartSec),
  );
}

export function useVoicePlaybackController({
  onError,
  viewerId,
}: UseVoicePlaybackControllerOptions) {
  const [playingVoiceMessageId, setPlayingVoiceMessageId] = useState<string | null>(null);
  const [playingVoiceElapsedSec, setPlayingVoiceElapsedSec] = useState(0);
  const [voicePlaybackRate, setVoicePlaybackRate] = useState<VoicePlaybackRate>(1);
  const playbackTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackContextRef = useRef<VoicePlaybackContext | null>(null);
  const playingVoiceMessageIdRef = useRef<string | null>(null);
  const hasNativePlaybackProgressRef = useRef(false);
  const lastRenderedElapsedRef = useRef(0);
  const lastRenderedAtRef = useRef(0);
  const ignoreStoppedStateUntilRef = useRef(0);

  useEffect(() => {
    playingVoiceMessageIdRef.current = playingVoiceMessageId;
  }, [playingVoiceMessageId]);

  const clearPlaybackTicker = useCallback(() => {
    if (playbackTickerRef.current) {
      clearInterval(playbackTickerRef.current);
      playbackTickerRef.current = null;
    }
    playbackContextRef.current = null;
    hasNativePlaybackProgressRef.current = false;
    lastRenderedElapsedRef.current = 0;
    lastRenderedAtRef.current = 0;
    ignoreStoppedStateUntilRef.current = 0;
  }, []);

  const finalizePlayback = useCallback(
    (resetElapsed = true) => {
      clearPlaybackTicker();
      setPlayingVoiceMessageId(null);
      if (resetElapsed) {
        setPlayingVoiceElapsedSec(0);
      }
    },
    [clearPlaybackTicker],
  );

  const pushElapsed = useCallback((elapsedSec: number, force = false) => {
    const safeElapsed = Number.isFinite(elapsedSec) ? Math.max(0, elapsedSec) : 0;
    const now = Date.now();
    if (!force) {
      const elapsedDelta = Math.abs(safeElapsed - lastRenderedElapsedRef.current);
      if (elapsedDelta < 0.01 && now - lastRenderedAtRef.current < 50) {
        return;
      }
    }
    lastRenderedElapsedRef.current = safeElapsed;
    lastRenderedAtRef.current = now;
    setPlayingVoiceElapsedSec(safeElapsed);
  }, []);

  const stopPlayback = useCallback(async () => {
    finalizePlayback(true);
    await stopVoicePlayback();
  }, [finalizePlayback]);

  const syncPlaybackProgress = useCallback(() => {
    const context = playbackContextRef.current;
    if (!context) {
      return;
    }

    if (
      hasNativePlaybackProgressRef.current &&
      Date.now() - context.startedAtMs < VOICE_PLAYBACK_PROGRESS_TICK_MS + 20
    ) {
      return;
    }

    const elapsedSec = computeVoicePlaybackElapsed(context);
    if (elapsedSec >= context.durationSec - VOICE_PLAYBACK_END_TOLERANCE_SEC) {
      pushElapsed(context.durationSec, true);
      finalizePlayback(false);
      ignorePromise(stopVoicePlayback());
      return;
    }

    pushElapsed(elapsedSec);
  }, [finalizePlayback, pushElapsed]);

  const startPlaybackTicker = useCallback(() => {
    syncPlaybackProgress();
    if (playbackTickerRef.current) {
      clearInterval(playbackTickerRef.current);
    }
    playbackTickerRef.current = setInterval(() => {
      syncPlaybackProgress();
    }, VOICE_PLAYBACK_PROGRESS_TICK_MS);
  }, [syncPlaybackProgress]);

  useEffect(() => {
    const unsubscribeProgress = subscribeVoicePlaybackProgress(event => {
      const context = playbackContextRef.current;
      if (!context) {
        return;
      }

      hasNativePlaybackProgressRef.current = true;
      const nativeDuration = Number(event.durationSec);
      const nativePosition = Number(event.positionSec);
      const durationSec =
        Number.isFinite(nativeDuration) && nativeDuration > 0
          ? nativeDuration
          : context.durationSec;
      const elapsedSec =
        Number.isFinite(nativePosition) && nativePosition >= 0
          ? Math.min(durationSec, nativePosition)
          : context.elapsedSec;

      context.durationSec = durationSec;
      context.elapsedSec = elapsedSec;
      context.startedAtMs = Date.now();
      pushElapsed(elapsedSec);

      if (elapsedSec >= durationSec - VOICE_PLAYBACK_END_TOLERANCE_SEC) {
        finalizePlayback(false);
      }
    });

    const unsubscribeState = subscribeVoicePlaybackState(event => {
      const state = event.state;
      if (!state) {
        return;
      }

      if (state === 'ended') {
        const context = playbackContextRef.current;
        if (context) {
          pushElapsed(context.durationSec, true);
        }
        finalizePlayback(false);
        return;
      }

      if (state === 'stopped' || state === 'error') {
        if (state === 'stopped' && Date.now() < ignoreStoppedStateUntilRef.current) {
          return;
        }
        finalizePlayback(state !== 'error');
      }
    });

    return () => {
      unsubscribeProgress();
      unsubscribeState();
    };
  }, [finalizePlayback, pushElapsed]);

  const togglePlayback = useCallback(
    async (messageId: string, voiceMessage: VoiceMessageAsset | null | undefined) => {
      const voiceUrl =
        voiceMessage && typeof voiceMessage.url === 'string'
          ? voiceMessage.url.trim()
          : '';
      if (!voiceUrl) {
        onError('Ses dosyasi bulunamadi.');
        return;
      }

      const resolvedVoiceUrl = resolveVoicePlaybackUrl(voiceUrl);
      try {
        if (playingVoiceMessageIdRef.current === messageId) {
          await stopPlayback();
          return;
        }

        onError(null);
        clearPlaybackTicker();
        ignoreStoppedStateUntilRef.current = Date.now() + 400;
        await stopVoicePlayback();
        hasNativePlaybackProgressRef.current = false;
        await startVoicePlayback(resolvedVoiceUrl);
        ignorePromise(setNativeVoicePlaybackRate(voicePlaybackRate));
        setPlayingVoiceMessageId(messageId);
        pushElapsed(0, true);
        playbackContextRef.current = {
          durationSec: resolveVoiceDurationSec(voiceMessage?.durationSec, 8),
          elapsedSec: 0,
          messageId,
          rate: voicePlaybackRate,
          startedAtMs: Date.now(),
        };
        startPlaybackTicker();
      } catch (error) {
        finalizePlayback(true);
        ignorePromise(stopVoicePlayback());
        onError(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'Sesli mesaj oynatilamadi.',
        );
      }
    },
    [
      clearPlaybackTicker,
      finalizePlayback,
      onError,
      pushElapsed,
      startPlaybackTicker,
      stopPlayback,
      voicePlaybackRate,
    ],
  );

  const cyclePlaybackRate = useCallback(() => {
    const currentIndex = VOICE_PLAYBACK_RATES.indexOf(voicePlaybackRate);
    const nextRate =
      VOICE_PLAYBACK_RATES[
        currentIndex >= 0
          ? (currentIndex + 1) % VOICE_PLAYBACK_RATES.length
          : 0
      ];
    setVoicePlaybackRate(nextRate);
    ignorePromise(storeVoicePlaybackRate(viewerId, nextRate));

    const context = playbackContextRef.current;
    if (context) {
      const elapsedSec = computeVoicePlaybackElapsed(context);
      context.elapsedSec = elapsedSec;
      context.rate = nextRate;
      context.startedAtMs = Date.now();
      pushElapsed(elapsedSec, true);
    }

    ignorePromise(setNativeVoicePlaybackRate(nextRate));
  }, [pushElapsed, viewerId, voicePlaybackRate]);

  useEffect(() => {
    let cancelled = false;
    readStoredVoicePlaybackRate(viewerId)
      .then(storedRate => {
        if (cancelled) {
          return;
        }
        const normalized = normalizeVoicePlaybackRate(storedRate);
        setVoicePlaybackRate(normalized);
        ignorePromise(setNativeVoicePlaybackRate(normalized));
      })
      .catch(() => {
        if (!cancelled) {
          ignorePromise(setNativeVoicePlaybackRate(1));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [viewerId]);

  useEffect(() => {
    return () => {
      clearPlaybackTicker();
      ignorePromise(stopVoicePlayback());
    };
  }, [clearPlaybackTicker]);

  return {
    clearPlaybackTicker,
    cyclePlaybackRate,
    playingVoiceElapsedSec,
    playingVoiceMessageId,
    stopPlayback,
    togglePlayback,
    voicePlaybackRate,
  };
}
