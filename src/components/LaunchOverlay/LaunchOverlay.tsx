import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Video from 'react-native-video';

import { warmLaunchBootstrap } from '../../services/authService';

const SPLASH_VIDEO_SOURCE = require('../../../components/assets/splash/launch-video-lite.mp4');
const DEFAULT_VIDEO_DURATION_MS = 11200;
const PLAYBACK_SAFETY_PADDING_MS = 160;
const LOAD_FAILSAFE_MS = 15000;
const BACKEND_WARMUP_DELAY_MS = 360;

type LaunchOverlayProps = {
  onFinish?: () => void;
};

export default function LaunchOverlay({ onFinish }: LaunchOverlayProps) {
  const [visible, setVisible] = useState(true);

  const mountedRef = useRef(true);
  const finishStartedRef = useRef(false);
  const playbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPlaybackTimer = useCallback(() => {
    if (!playbackTimerRef.current) {
      return;
    }
    clearTimeout(playbackTimerRef.current);
    playbackTimerRef.current = null;
  }, []);

  const finishOverlay = useCallback(() => {
    if (finishStartedRef.current || !mountedRef.current) {
      return;
    }

    finishStartedRef.current = true;
    setVisible(false);
    onFinish?.();
  }, [onFinish]);

  const scheduleFinishFallback = useCallback(
    (durationMs: number) => {
      clearPlaybackTimer();
      playbackTimerRef.current = setTimeout(() => {
        finishOverlay();
      }, durationMs);
    },
    [clearPlaybackTimer, finishOverlay],
  );

  useEffect(() => {
    mountedRef.current = true;
    finishStartedRef.current = false;
    scheduleFinishFallback(LOAD_FAILSAFE_MS);
    const bootstrapTimer = setTimeout(() => {
      warmLaunchBootstrap().catch(() => null);
    }, BACKEND_WARMUP_DELAY_MS);

    return () => {
      mountedRef.current = false;
      clearTimeout(bootstrapTimer);
      clearPlaybackTimer();
    };
  }, [clearPlaybackTimer, scheduleFinishFallback]);

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.overlay} testID="launch-overlay">
      <Video
        hideShutterView={true}
        muted={true}
        onEnd={finishOverlay}
        onError={finishOverlay}
        onLoad={event => {
          const durationSeconds =
            typeof event?.duration === 'number' && Number.isFinite(event.duration)
              ? event.duration
              : DEFAULT_VIDEO_DURATION_MS / 1000;
          const durationMs = Math.max(
            1000,
            Math.round(durationSeconds * 1000) + PLAYBACK_SAFETY_PADDING_MS,
          );
          scheduleFinishFallback(durationMs);
        }}
        paused={false}
        playInBackground={false}
        playWhenInactive={false}
        repeat={false}
        resizeMode="cover"
        shutterColor="transparent"
        source={SPLASH_VIDEO_SOURCE}
        style={styles.video}
        useTextureView={Platform.OS === 'android'}
        volume={0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    zIndex: 9999,
  },
  video: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
});
