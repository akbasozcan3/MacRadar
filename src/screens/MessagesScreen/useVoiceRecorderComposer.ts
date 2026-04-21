import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  type GestureResponderEvent,
} from 'react-native';

import {
  buildVoiceRecordingPreviewBars,
} from '../../features/messages/voiceMessageUi';
import {
  cancelVoiceRecording,
  ensureMicrophonePermission,
  subscribeVoiceRecordingLevel,
  startVoiceRecording,
  stopVoiceRecording,
  startVoicePlayback,
  stopVoicePlayback,
  subscribeVoicePlaybackProgress,
  subscribeVoicePlaybackState,
} from '../../native/voiceRecorder';
import { triggerImpactHaptic } from '../../services/haptics';

const VOICE_HOLD_MIN_DURATION_SEC = 1;
const VOICE_HOLD_MAX_DURATION_SEC = 180;
const VOICE_HOLD_TICK_MS = 100;
const VOICE_HOLD_SWIPE_CANCEL_PX = 64;
const VOICE_HOLD_SWIPE_LOCK_PX = 56;
const VOICE_RECORDING_PREVIEW_BAR_COUNT = 24; // Increased for higher fidelity
const VOICE_RECORDING_LEVEL_STALE_MS = 280;
const VOICE_RECORDING_LEVEL_UPDATE_MS = 40; // Faster updates for smoother viz
const VOICE_SIGNAL_MIN_AVERAGE_LEVEL = 0.0012;
const VOICE_SIGNAL_MIN_PEAK_LEVEL = 0.008;
const VOICE_SIGNAL_MIN_WAVEFORM_PEAK = 0.03;
const VOICE_SIGNAL_MIN_FILE_BYTES = 256;

export type VoiceRecordingMode = 'hold' | 'tap' | 'preview' | null;
export type VoiceHoldGestureHint = 'idle' | 'cancel' | 'lock';

export type VoiceDraft = {
  averageLevel?: number;
  base64: string;
  durationSec: number;
  fileName: string;
  filePath?: string;
  mimeType: string;
  peakLevel?: number;
  sizeBytes: number;
  waveform?: number[];
};

type UseVoiceRecorderComposerOptions = {
  activeConversationId: string | null;
  composerText: string;
  isBusy: boolean;
  onError: (message: string | null) => void;
  onSendVoice: (recording: VoiceDraft) => Promise<void>;
};

type BeginVoiceRecordingGuard = () => boolean;

function clampLevel(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function buildLivePreviewBars(samples: number[], targetCount: number) {
  if (samples.length === 0) {
    return [];
  }

  const safeCount = Math.max(8, Math.min(28, Math.floor(targetCount)));
  if (samples.length <= safeCount) {
    return samples.map(sample => Math.max(0.05, clampLevel(sample)));
  }

  const segmentLength = samples.length / safeCount;
  const bars: number[] = [];
  for (let index = 0; index < safeCount; index += 1) {
    const start = Math.floor(index * segmentLength);
    const end = Math.max(start + 1, Math.floor((index + 1) * segmentLength));
    const chunk = samples.slice(start, end);
    if (chunk.length === 0) {
      bars.push(0.05);
      continue;
    }
    const avg = chunk.reduce((sum, value) => sum + value, 0) / chunk.length;
    bars.push(Math.max(0.05, clampLevel(avg)));
  }

  return bars;
}

function hasUsableVoiceSignal(recording: {
  averageLevel?: number;
  durationSec?: number;
  peakLevel?: number;
  sizeBytes?: number;
  waveform?: number[];
}) {
  const peakLevel = Number(recording.peakLevel);
  const averageLevel = Number(recording.averageLevel);
  if (Number.isFinite(peakLevel) && peakLevel >= VOICE_SIGNAL_MIN_PEAK_LEVEL) {
    return true;
  }
  if (Number.isFinite(averageLevel) && averageLevel >= VOICE_SIGNAL_MIN_AVERAGE_LEVEL) {
    return true;
  }

  if (Array.isArray(recording.waveform) && recording.waveform.length > 0) {
    const samples = recording.waveform
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value >= 0);
    if (samples.length > 0) {
      const maxLevel = Math.max(...samples);
      const minLevel = Math.min(...samples);
      const avgLevel =
        samples.reduce((sum, value) => sum + value, 0) / samples.length;
      if (
        maxLevel >= VOICE_SIGNAL_MIN_WAVEFORM_PEAK ||
        avgLevel >= VOICE_SIGNAL_MIN_AVERAGE_LEVEL * 3 ||
        maxLevel - minLevel >= 0.02
      ) {
        return true;
      }
    }
  }

  const sizeBytes = Number(recording.sizeBytes);
  const durationSec = Number(recording.durationSec);
  return (
    Number.isFinite(sizeBytes) &&
    sizeBytes >= VOICE_SIGNAL_MIN_FILE_BYTES &&
    (!Number.isFinite(durationSec) || durationSec >= 1)
  );
}

export function useVoiceRecorderComposer({
  activeConversationId,
  composerText,
  isBusy,
  onError,
  onSendVoice,
}: UseVoiceRecorderComposerOptions) {
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [voiceRecordingMode, setVoiceRecordingMode] = useState<VoiceRecordingMode>(null);
  const [voiceHoldGestureHint, setVoiceHoldGestureHint] =
    useState<VoiceHoldGestureHint>('idle');
  const [voiceRecordingSeconds, setVoiceRecordingSeconds] = useState(0);
  const [voiceRecordingPreviewBars, setVoiceRecordingPreviewBars] = useState<number[]>([]);
  const [voiceRecordingDraft, setVoiceRecordingDraft] = useState<VoiceDraft | null>(null);
  const [previewPlaybackPlaying, setPreviewPlaybackPlaying] = useState(false);
  const [previewPlaybackElapsedSec, setPreviewPlaybackElapsedSec] = useState(0);
  const ignoreStoppedStateUntilRef = useRef(0);
  const hasMicrophonePermissionRef = useRef(false);
  const isVoiceRecordingRef = useRef(false);
  const voiceRecordingStartInFlightRef = useRef(false);
  const voiceRecordingModeRef = useRef<VoiceRecordingMode>(null);
  const voiceHoldGestureHintRef = useRef<VoiceHoldGestureHint>('idle');
  const voiceRecordingGestureHandledRef = useRef(false);
  const voiceRecordingPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const voiceRecordingStartedAtRef = useRef<number | null>(null);
  const voiceRecordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceRecordingPreviewSourceRef = useRef<number[]>([]);
  const voiceRecordingLastLevelRef = useRef(0);
  const voiceRecordingLastLevelAtRef = useRef(0);
  const voiceRecordingLastPreviewUpdateAtRef = useRef(0);
  const voiceRecordingPulseOpacity = useRef(new Animated.Value(1)).current;
  const voiceRecordingGuideOpacity = useRef(new Animated.Value(1)).current;
  const voiceRecordingGestureOffsetX = useRef(new Animated.Value(0)).current;

  const stopVoiceRecordingTimer = useCallback(() => {
    if (voiceRecordingTimerRef.current) {
      clearInterval(voiceRecordingTimerRef.current);
      voiceRecordingTimerRef.current = null;
    }
  }, []);

  const syncLivePreviewBars = useCallback(() => {
    const nextBars = buildLivePreviewBars(
      voiceRecordingPreviewSourceRef.current,
      VOICE_RECORDING_PREVIEW_BAR_COUNT,
    );
    setVoiceRecordingPreviewBars(current => {
      if (current.length === nextBars.length && current.length > 0) {
        let changed = false;
        for (let index = 0; index < current.length; index += 1) {
          if (Math.abs(current[index] - nextBars[index]) > 0.015) {
            changed = true;
            break;
          }
        }
        if (!changed) {
          return current;
        }
      }
      return nextBars;
    });
  }, []);

  const animateGestureReset = useCallback(() => {
    voiceRecordingGestureOffsetX.stopAnimation();
    Animated.spring(voiceRecordingGestureOffsetX, {
      damping: 22,
      mass: 0.8,
      stiffness: 240,
      toValue: 0,
      useNativeDriver: true,
    }).start();
  }, [voiceRecordingGestureOffsetX]);

  const setGestureHint = useCallback((nextHint: VoiceHoldGestureHint) => {
    if (voiceHoldGestureHintRef.current === nextHint) {
      return;
    }
    voiceHoldGestureHintRef.current = nextHint;
    setVoiceHoldGestureHint(nextHint);
  }, []);

  const resetRecordingState = useCallback(
    (nextSeconds = 0) => {
      voiceRecordingModeRef.current = null;
      voiceRecordingGestureHandledRef.current = false;
      voiceRecordingPressStartRef.current = null;
      isVoiceRecordingRef.current = false;
      setVoiceRecordingMode(null);
      setGestureHint('idle');
      voiceRecordingStartedAtRef.current = null;
      stopVoiceRecordingTimer();
      setIsVoiceRecording(false);
      setVoiceRecordingSeconds(nextSeconds);
      voiceRecordingPreviewSourceRef.current = [];
      voiceRecordingLastLevelRef.current = 0;
      voiceRecordingLastLevelAtRef.current = 0;
      voiceRecordingLastPreviewUpdateAtRef.current = 0;
      setVoiceRecordingPreviewBars([]);
      setVoiceRecordingDraft(null);
      setPreviewPlaybackPlaying(false);
      setPreviewPlaybackElapsedSec(0);
      ignoreStoppedStateUntilRef.current = 0;
      stopVoicePlayback().catch(() => {});
      animateGestureReset();
    },
    [animateGestureReset, setGestureHint, stopVoiceRecordingTimer],
  );

  const cancelActiveVoiceRecording = useCallback(async () => {
    if (!isVoiceRecordingRef.current) {
      return;
    }

    const isPreview = voiceRecordingModeRef.current === 'preview';
    resetRecordingState(0);
    triggerImpactHaptic('rigid'); // Stronger feedback for cancel
    if (isPreview) {
      // Recording already stopped in preview mode — just reset UI state.
      return;
    }
    try {
      await cancelVoiceRecording();
    } catch {
      return;
    }
  }, [resetRecordingState]);

  const stopAndPreviewVoiceRecording = useCallback(async () => {
    if (!isVoiceRecordingRef.current || voiceRecordingModeRef.current === 'preview') {
      return;
    }

    const startedAt = voiceRecordingStartedAtRef.current;
    const elapsed = startedAt
      ? Math.max(
          VOICE_HOLD_MIN_DURATION_SEC,
          Math.min(
            VOICE_HOLD_MAX_DURATION_SEC,
            Math.floor((Date.now() - startedAt) / 1000),
          ),
        )
      : Math.max(voiceRecordingSeconds, VOICE_HOLD_MIN_DURATION_SEC);

    stopVoiceRecordingTimer();
    triggerImpactHaptic('soft');

    try {
      const recording = await stopVoiceRecording();
      if (!hasUsableVoiceSignal(recording)) {
        onError('Mikrofon sesi algılanamadı. Mikrofon iznini ve cihaz girişini kontrol et.');
        resetRecordingState(0);
        return;
      }
      const draft: VoiceDraft = {
        averageLevel: (recording as any).averageLevel as number | undefined,
        base64: recording.base64,
        durationSec: Math.max(
          elapsed,
          Number.isFinite(recording.durationSec)
            ? Math.floor(recording.durationSec)
            : elapsed,
        ),
        fileName: recording.fileName,
        filePath: (recording as any).filePath as string | undefined,
        mimeType: recording.mimeType,
        peakLevel: (recording as any).peakLevel as number | undefined,
        sizeBytes: recording.sizeBytes,
        waveform: recording.waveform,
      };
      setVoiceRecordingDraft(draft);
      voiceRecordingModeRef.current = 'preview';
      setVoiceRecordingMode('preview');
      setPreviewPlaybackElapsedSec(0);
      setPreviewPlaybackPlaying(false);
    } catch (error) {
      onError(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Ses kaydi tamamlanamadi.',
      );
      resetRecordingState(0);
    }
  }, [onError, resetRecordingState, stopVoiceRecordingTimer, voiceRecordingSeconds]);

  const togglePreviewPlayback = useCallback(async () => {
    if (voiceRecordingModeRef.current !== 'preview' || !voiceRecordingDraft) {
      return;
    }

    try {
      if (previewPlaybackPlaying) {
        ignoreStoppedStateUntilRef.current = Date.now() + 400;
        await stopVoicePlayback();
        setPreviewPlaybackPlaying(false);
      } else {
        await stopVoicePlayback();
        setPreviewPlaybackPlaying(true);
        // Prefer the full file:// URI returned by the native module.
        // Fall back to constructing one from the bare fileName.
        const fileUrl = voiceRecordingDraft.filePath
          ? voiceRecordingDraft.filePath
          : voiceRecordingDraft.fileName.startsWith('file://')
            || voiceRecordingDraft.fileName.startsWith('content://')
            || voiceRecordingDraft.fileName.startsWith('http://')
            || voiceRecordingDraft.fileName.startsWith('https://')
            ? voiceRecordingDraft.fileName
            : voiceRecordingDraft.fileName;
        await startVoicePlayback(fileUrl);
        if (previewPlaybackElapsedSec >= voiceRecordingDraft.durationSec - 0.1) {
          setPreviewPlaybackElapsedSec(0);
        }
      }
    } catch {
      setPreviewPlaybackPlaying(false);
      onError('Onizleme baslatilamadi.');
    }
  }, [onError, previewPlaybackElapsedSec, previewPlaybackPlaying, voiceRecordingDraft]);

  const finishVoiceRecording = useCallback(async () => {
    if (!isVoiceRecordingRef.current) {
      return;
    }

    if (voiceRecordingModeRef.current === 'preview' && voiceRecordingDraft) {
      const draft = voiceRecordingDraft;
      resetRecordingState(0);
      await onSendVoice(draft);
      return;
    }

    const startedAt = voiceRecordingStartedAtRef.current;
    const elapsed = startedAt
      ? Math.max(
          VOICE_HOLD_MIN_DURATION_SEC,
          Math.min(
            VOICE_HOLD_MAX_DURATION_SEC,
            Math.floor((Date.now() - startedAt) / 1000),
          ),
        )
      : Math.max(voiceRecordingSeconds, VOICE_HOLD_MIN_DURATION_SEC);

    resetRecordingState(elapsed);
    triggerImpactHaptic('medium');

    try {
      const recording = await stopVoiceRecording();
      if (!hasUsableVoiceSignal(recording)) {
        onError('Mikrofon sesi algılanamadı. Mikrofon iznini ve cihaz girişini kontrol et.');
        return;
      }
      await onSendVoice({
        averageLevel: (recording as any).averageLevel as number | undefined,
        base64: recording.base64,
        durationSec: Math.max(
          elapsed,
          Number.isFinite(recording.durationSec)
            ? Math.floor(recording.durationSec)
            : elapsed,
        ),
        fileName: recording.fileName,
        filePath: (recording as any).filePath as string | undefined,
        mimeType: recording.mimeType,
        peakLevel: (recording as any).peakLevel as number | undefined,
        sizeBytes: recording.sizeBytes,
        waveform: recording.waveform,
      });
    } catch (error) {
      onError(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Ses kaydi tamamlanamadi.',
      );
    }
  }, [onError, onSendVoice, resetRecordingState, voiceRecordingDraft, voiceRecordingSeconds]);

  const beginVoiceRecording = useCallback(
    async (
      mode: Exclude<VoiceRecordingMode, null> = 'hold',
      shouldContinue: BeginVoiceRecordingGuard = () => true,
    ) => {
      if (voiceRecordingStartInFlightRef.current) {
        return;
      }

      voiceRecordingStartInFlightRef.current = true;
      try {
        if (
          isBusy ||
          isVoiceRecordingRef.current ||
          composerText.trim().length > 0 ||
          !activeConversationId
        ) {
          return;
        }

        let hasPermission = hasMicrophonePermissionRef.current;
        if (!hasPermission) {
          hasPermission = await ensureMicrophonePermission();
          if (hasPermission) {
            hasMicrophonePermissionRef.current = true;
          }
        }
        if (!shouldContinue()) {
          return;
        }
        if (!hasPermission) {
          onError('Mikrofon izni olmadan sesli mesaj gonderemezsin.');
          return;
        }

        onError(null);
        await startVoiceRecording();
        if (!shouldContinue()) {
          await cancelVoiceRecording();
          resetRecordingState(0);
          return;
        }
        isVoiceRecordingRef.current = true;
        voiceRecordingModeRef.current = mode;
        voiceRecordingGestureHandledRef.current = false;
        voiceRecordingPressStartRef.current = null;
        setVoiceRecordingMode(mode);
        setGestureHint('idle');
        setIsVoiceRecording(true);
        setVoiceRecordingSeconds(VOICE_HOLD_MIN_DURATION_SEC);
        voiceRecordingPreviewSourceRef.current = [];
        voiceRecordingLastLevelRef.current = 0;
        voiceRecordingLastLevelAtRef.current = Date.now();
        voiceRecordingLastPreviewUpdateAtRef.current = 0;
        setVoiceRecordingPreviewBars(
          buildVoiceRecordingPreviewBars(
            VOICE_HOLD_MIN_DURATION_SEC,
            mode === 'tap',
            VOICE_RECORDING_PREVIEW_BAR_COUNT,
          ),
        );
        animateGestureReset();
        triggerImpactHaptic('light');
        const startedAt = Date.now();
        voiceRecordingStartedAtRef.current = startedAt;
        stopVoiceRecordingTimer();
        voiceRecordingTimerRef.current = setInterval(() => {
          const elapsed = Math.max(
            VOICE_HOLD_MIN_DURATION_SEC,
            Math.min(
              VOICE_HOLD_MAX_DURATION_SEC,
              (Date.now() - startedAt) / 1000,
            ),
          );
          setVoiceRecordingSeconds(elapsed);
        }, VOICE_HOLD_TICK_MS);
      } catch (error) {
        onError(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'Ses kaydi baslatilamadi.',
        );
        resetRecordingState(0);
      } finally {
        voiceRecordingStartInFlightRef.current = false;
      }
    },
    [
      activeConversationId,
      animateGestureReset,
      composerText,
      isBusy,
      onError,
      resetRecordingState,
      setGestureHint,
      stopVoiceRecordingTimer,
    ],
  );

  const handleVoiceActionPressIn = useCallback(
    (event: GestureResponderEvent) => {
      const nativeEvent = event?.nativeEvent;
      if (!nativeEvent) {
        return;
      }
      voiceRecordingPressStartRef.current = {
        x: Number(nativeEvent.pageX) || 0,
        y: Number(nativeEvent.pageY) || 0,
      };
      voiceRecordingGestureHandledRef.current = false;

      if (isVoiceRecording && voiceRecordingModeRef.current === 'hold') {
        setGestureHint('idle');
      }
    },
    [isVoiceRecording, setGestureHint],
  );

  const handleVoiceActionPressMove = useCallback(
    (event: GestureResponderEvent) => {
      if (!isVoiceRecording || voiceRecordingModeRef.current !== 'hold') {
        return;
      }

      const start = voiceRecordingPressStartRef.current;
      const nativeEvent = event?.nativeEvent;
      if (!start || !nativeEvent) {
        return;
      }

      const deltaX = start.x - (Number(nativeEvent.pageX) || 0);
      const deltaY = start.y - (Number(nativeEvent.pageY) || 0);
      const translateX = -Math.min(44, Math.max(0, deltaX) * 0.36);
      voiceRecordingGestureOffsetX.setValue(translateX);

      if (voiceRecordingGestureHandledRef.current) {
        return;
      }

      if (deltaX >= VOICE_HOLD_SWIPE_CANCEL_PX) {
        voiceRecordingGestureHandledRef.current = true;
        setGestureHint('cancel');
        triggerImpactHaptic('rigid');
        cancelActiveVoiceRecording().catch(() => undefined);
        return;
      }

      if (deltaY >= VOICE_HOLD_SWIPE_LOCK_PX) {
        voiceRecordingGestureHandledRef.current = true;
        voiceRecordingModeRef.current = 'tap';
        setVoiceRecordingMode('tap');
        setGestureHint('lock');
        triggerImpactHaptic('soft');
        animateGestureReset();
        return;
      }

      if (deltaX >= VOICE_HOLD_SWIPE_CANCEL_PX * 0.55) {
        setGestureHint('cancel');
        return;
      }
      if (deltaY >= VOICE_HOLD_SWIPE_LOCK_PX * 0.55) {
        setGestureHint('lock');
        return;
      }

      setGestureHint('idle');
    },
    [
      animateGestureReset,
      cancelActiveVoiceRecording,
      isVoiceRecording,
      setGestureHint,
      voiceRecordingGestureOffsetX,
    ],
  );

  useEffect(() => {
    if (!isVoiceRecording) {
      voiceRecordingPulseOpacity.stopAnimation();
      voiceRecordingPulseOpacity.setValue(1);
      voiceRecordingGuideOpacity.stopAnimation();
      voiceRecordingGuideOpacity.setValue(1);
      return;
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(voiceRecordingPulseOpacity, {
            duration: 420,
            easing: Easing.out(Easing.quad),
            toValue: 0.62,
            useNativeDriver: true,
          }),
          Animated.timing(voiceRecordingGuideOpacity, {
            duration: 840,
            easing: Easing.inOut(Easing.quad),
            toValue: 0.4,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(voiceRecordingPulseOpacity, {
            duration: 420,
            easing: Easing.in(Easing.quad),
            toValue: 1,
            useNativeDriver: true,
          }),
          Animated.timing(voiceRecordingGuideOpacity, {
            duration: 840,
            easing: Easing.inOut(Easing.quad),
            toValue: 1,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    pulse.start();

    return () => {
      pulse.stop();
      voiceRecordingPulseOpacity.stopAnimation();
      voiceRecordingPulseOpacity.setValue(1);
      voiceRecordingGuideOpacity.stopAnimation();
      voiceRecordingGuideOpacity.setValue(1);
    };
  }, [isVoiceRecording, voiceRecordingGuideOpacity, voiceRecordingPulseOpacity]);

  useEffect(() => {
    return subscribeVoiceRecordingLevel(event => {
      if (!isVoiceRecordingRef.current) {
        return;
      }

      const rawLevel = Number(event.level);
      const normalizedLevel = clampLevel(rawLevel);
      const previousLevel = voiceRecordingLastLevelRef.current;
      const smoothedLevel = previousLevel * 0.7 + normalizedLevel * 0.3;
      voiceRecordingLastLevelRef.current = smoothedLevel;
      voiceRecordingLastLevelAtRef.current = Date.now();

      const source = voiceRecordingPreviewSourceRef.current;
      source.push(smoothedLevel);
      if (source.length > 96) {
        source.splice(0, source.length - 96);
      }

      const now = Date.now();
      if (now - voiceRecordingLastPreviewUpdateAtRef.current < VOICE_RECORDING_LEVEL_UPDATE_MS) {
        return;
      }

      voiceRecordingLastPreviewUpdateAtRef.current = now;
      syncLivePreviewBars();
    });
  }, [syncLivePreviewBars]);

  useEffect(() => {
    if (!isVoiceRecording) {
      return;
    }

    const fallbackTimer = setInterval(() => {
      if (!isVoiceRecordingRef.current) {
        return;
      }

      const lastLevelAt = voiceRecordingLastLevelAtRef.current;
      if (lastLevelAt > 0 && Date.now() - lastLevelAt < VOICE_RECORDING_LEVEL_STALE_MS) {
        return;
      }

      const source = voiceRecordingPreviewSourceRef.current;
      source.push(0.16 + Math.abs(Math.sin(Date.now() / 180)) * 0.22);
      if (source.length > 96) {
        source.splice(0, source.length - 96);
      }
      voiceRecordingLastPreviewUpdateAtRef.current = Date.now();
      syncLivePreviewBars();
    }, 120);

    return () => {
      clearInterval(fallbackTimer);
    };
  }, [isVoiceRecording, syncLivePreviewBars, voiceRecordingSeconds]);

  useEffect(() => {
    if (voiceRecordingMode !== 'preview' || !voiceRecordingDraft) {
      return;
    }

    const unsubscribeProgress = subscribeVoicePlaybackProgress(event => {
       const pos = Number(event.positionSec);
       if (Number.isFinite(pos) && pos >= 0) {
         setPreviewPlaybackElapsedSec(Math.min(voiceRecordingDraft.durationSec, pos));
       }
    });

    const unsubscribeState = subscribeVoicePlaybackState(event => {
       if (event.state === 'ended') {
         setPreviewPlaybackPlaying(false);
         setPreviewPlaybackElapsedSec(voiceRecordingDraft.durationSec);
       } else if (event.state === 'stopped' || event.state === 'error') {
         if (event.state === 'stopped' && Date.now() < ignoreStoppedStateUntilRef.current) {
           return;
         }
         setPreviewPlaybackPlaying(false);
       }
    });

    return () => {
      unsubscribeProgress();
      unsubscribeState();
    };
  }, [voiceRecordingDraft, voiceRecordingMode]);

  useEffect(() => {
    return () => {
      stopVoiceRecordingTimer();
      ignorePromise(cancelVoiceRecording());
    };
  }, [stopVoiceRecordingTimer]);

  const voiceHoldGuideText = useMemo(() => {
    if (!isVoiceRecording || voiceRecordingMode !== 'hold') {
      return '';
    }
    if (voiceHoldGestureHint === 'cancel') {
      return 'Birakirsan iptal olur';
    }
    if (voiceHoldGestureHint === 'lock') {
      return 'Kayit kilitlendi';
    }
    return 'Sola kaydir: iptal | Yukari kaydir: kilitle';
  }, [isVoiceRecording, voiceHoldGestureHint, voiceRecordingMode]);

  return {
    beginVoiceRecording,
    cancelActiveVoiceRecording,
    finishVoiceRecording,
    stopAndPreviewVoiceRecording,
    togglePreviewPlayback,
    handleVoiceActionPressIn,
    handleVoiceActionPressMove,
    isVoiceRecording,
    previewPlaybackPlaying,
    previewPlaybackElapsedSec,
    voiceRecordingDraft,
    resetRecordingState,
    voiceHoldGestureHint,
    voiceHoldGuideText,
    voiceRecordingGestureOffsetX,
    voiceRecordingGuideOpacity,
    voiceRecordingMode,
    voiceRecordingModeRef,
    voiceRecordingPressStartRef,
    voiceRecordingPreviewBars,
    voiceRecordingPulseOpacity,
    voiceRecordingSeconds,
  };
}

function ignorePromise(promise: Promise<unknown>) {
  promise.catch(() => undefined);
}
