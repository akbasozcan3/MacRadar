import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
  type ImageResizeMode,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Video from 'react-native-video';

import FeatherIcon from '../FeatherIcon/FeatherIcon';
import {
  resolveMediaThumbnailUrl,
  resolveProtectedMediaUrl,
} from '../../services/protectedMedia';

export type AppMediaMode = 'autoplay' | 'thumbnail' | 'viewer';

type AppMediaProps = {
  durationLabelMode?: 'remaining' | 'total';
  enableVideoPreviewInThumbnail?: boolean;
  mediaType?: string | null;
  mediaTypePillText?: string;
  mediaUrl: string;
  mode?: AppMediaMode;
  muted?: boolean;
  onError?: () => void;
  paused?: boolean;
  previewLoopFromOffset?: boolean;
  previewStartOffsetSec?: number;
  resizeMode?: ImageResizeMode;
  showVideoBadge?: boolean;
  showVideoDurationLabel?: boolean;
  showVideoTypePill?: boolean;
  showViewerControls?: boolean;
  style?: StyleProp<ImageStyle | ViewStyle>;
  thumbnailUrl?: string | null;
  videoRepeat?: boolean;
  wrapperStyle?: StyleProp<ViewStyle>;
};

function isVideoMedia(mediaType?: string | null) {
  return (
    String(mediaType || '')
      .trim()
      .toLowerCase() === 'video'
  );
}

function resolveVideoResizeMode(resizeMode: ImageResizeMode) {
  switch (resizeMode) {
    case 'contain':
    case 'cover':
    case 'stretch':
    case 'none':
      return resizeMode;
    default:
      return 'cover' as const;
  }
}

function formatDurationLabel(valueSec: number) {
  if (!Number.isFinite(valueSec) || valueSec <= 0) {
    return '';
  }

  const roundedSeconds = Math.max(1, Math.round(valueSec));
  if (roundedSeconds < 60) {
    return `${roundedSeconds} sn`;
  }

  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = String(roundedSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export default function AppMedia({
  durationLabelMode = 'remaining',
  enableVideoPreviewInThumbnail = false,
  mediaType,
  mediaTypePillText = 'Video',
  mediaUrl,
  mode = 'thumbnail',
  muted,
  paused,
  onError,
  previewLoopFromOffset = false,
  previewStartOffsetSec = 0,
  resizeMode = 'cover',
  showVideoBadge = false,
  showVideoDurationLabel = false,
  showVideoTypePill = false,
  showViewerControls,
  style,
  thumbnailUrl,
  videoRepeat,
  wrapperStyle,
}: AppMediaProps) {
  const videoRef = useRef<any>(null);
  const previewSeekAppliedRef = useRef(false);
  const [durationSec, setDurationSec] = useState(0);
  const [effectivePreviewStartSec, setEffectivePreviewStartSec] = useState(0);
  const [videoLoadFailed, setVideoLoadFailed] = useState(false);
  const [viewerVideoStalled, setViewerVideoStalled] = useState(false);
  const sourceUrl = resolveProtectedMediaUrl(String(mediaUrl || '').trim());
  const resolvedThumbnailUrl = resolveMediaThumbnailUrl({
    mediaType,
    mediaUrl: sourceUrl,
    thumbnailUrl,
  });
  const isVideo = isVideoMedia(mediaType);
  const normalizedPreviewStartOffsetSec = Math.max(
    0,
    Number(previewStartOffsetSec) || 0,
  );
  const shouldUseVideoInThumbnail =
    isVideo && mode === 'thumbnail' && enableVideoPreviewInThumbnail;
  const resolvedVideoPaused = useMemo(() => {
    if (typeof paused === 'boolean') {
      return paused;
    }
    if (mode === 'autoplay') {
      return false;
    }
    if (shouldUseVideoInThumbnail) {
      return false;
    }
    return true;
  }, [mode, paused, shouldUseVideoInThumbnail]);
  const resolvedMuted = typeof muted === 'boolean' ? muted : mode !== 'viewer';
  const resolvedShowViewerControls =
    typeof showViewerControls === 'boolean' ? showViewerControls : mode === 'viewer';
  const shouldApplyPreviewOffset =
    isVideo &&
    mode !== 'viewer' &&
    normalizedPreviewStartOffsetSec > 0 &&
    (mode === 'autoplay' || shouldUseVideoInThumbnail);
  const shouldLoopPreviewFromOffset =
    shouldApplyPreviewOffset && previewLoopFromOffset && !resolvedVideoPaused;
  const resolvedPointerEvents = mode === 'viewer' ? 'auto' : 'none';
  const shouldRenderThumbnailImage =
    isVideo &&
    resolvedThumbnailUrl.length > 0 &&
    ((mode === 'thumbnail' && !shouldUseVideoInThumbnail) ||
      sourceUrl.length === 0 ||
      videoLoadFailed ||
      viewerVideoStalled);
  const resolvedVideoResizeMode = resolveVideoResizeMode(resizeMode);
  const platformVideoTuningProps = useMemo<Record<string, unknown>>(() => {
    if (!isVideo) {
      return {};
    }

    const preferFastStart = mode !== 'viewer' || shouldUseVideoInThumbnail;
    if (Platform.OS === 'android') {
      return {
        bufferConfig: preferFastStart
          ? {
              minBufferMs: 3_000,
              maxBufferMs: 15_000,
              bufferForPlaybackMs: 700,
              bufferForPlaybackAfterRebufferMs: 1_200,
            }
          : {
              minBufferMs: 8_000,
              maxBufferMs: 42_000,
              bufferForPlaybackMs: 1_500,
              bufferForPlaybackAfterRebufferMs: 2_500,
            },
        maxBitRate: preferFastStart ? 2_000_000 : undefined,
      };
    }

    return {
      automaticallyWaitsToMinimizeStalling: !preferFastStart,
      preferredForwardBufferDuration: preferFastStart ? 1.4 : 5,
    };
  }, [isVideo, mode, shouldUseVideoInThumbnail]);
  const videoDurationLabel = useMemo(() => {
    if (!showVideoDurationLabel || !isVideo || durationSec <= 0) {
      return '';
    }

    const labelTargetSec =
      durationLabelMode === 'remaining'
        ? Math.max(0, durationSec - effectivePreviewStartSec)
        : durationSec;
    return formatDurationLabel(labelTargetSec);
  }, [
    durationLabelMode,
    durationSec,
    effectivePreviewStartSec,
    isVideo,
    showVideoDurationLabel,
  ]);

  useEffect(() => {
    previewSeekAppliedRef.current = false;
    setDurationSec(0);
    setEffectivePreviewStartSec(0);
    setVideoLoadFailed(false);
    setViewerVideoStalled(false);
  }, [mode, normalizedPreviewStartOffsetSec, shouldUseVideoInThumbnail, sourceUrl]);

  useEffect(() => {
    if (
      !isVideo ||
      mode !== 'viewer' ||
      sourceUrl.length === 0 ||
      resolvedVideoPaused
    ) {
      return;
    }
    const stallTimeout = setTimeout(() => {
      setViewerVideoStalled(true);
    }, 2500);
    return () => {
      clearTimeout(stallTimeout);
    };
  }, [isVideo, mode, resolvedVideoPaused, sourceUrl]);

  const resolvePreviewStart = useCallback(
    (duration: number) => {
      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        normalizedPreviewStartOffsetSec <= 0
      ) {
        return 0;
      }

      const safeTail = Math.max(duration - 0.24, 0);
      if (duration <= normalizedPreviewStartOffsetSec) {
        const adaptive = Math.max(duration * 0.4, 0);
        return Math.min(adaptive, safeTail);
      }

      return Math.min(normalizedPreviewStartOffsetSec, safeTail);
    },
    [normalizedPreviewStartOffsetSec],
  );

  const applyPreviewSeek = useCallback(
    (duration: number) => {
      if (!shouldApplyPreviewOffset || previewSeekAppliedRef.current) {
        return;
      }

      const target = resolvePreviewStart(duration);
      setEffectivePreviewStartSec(target);
      previewSeekAppliedRef.current = true;

      if (target <= 0) {
        return;
      }

      requestAnimationFrame(() => {
        try {
          videoRef.current?.seek(target);
        } catch {
          return;
        }
      });
    },
    [resolvePreviewStart, shouldApplyPreviewOffset],
  );

  const handleVideoLoad = useCallback(
    (payload: { duration?: number }) => {
      setVideoLoadFailed(false);
      setViewerVideoStalled(false);
      const rawDuration = Number(payload?.duration ?? 0);
      const safeDuration =
        Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
      setDurationSec(safeDuration);
      previewSeekAppliedRef.current = false;
      applyPreviewSeek(safeDuration);
    },
    [applyPreviewSeek],
  );

  const handleVideoProgress = useCallback(
    (payload: { currentTime?: number }) => {
      if (mode === 'viewer') {
        setViewerVideoStalled(false);
      }
      if (!shouldLoopPreviewFromOffset || durationSec <= 0) {
        return;
      }
      const currentTime = Number(payload?.currentTime ?? 0);
      if (!Number.isFinite(currentTime)) {
        return;
      }
      if (currentTime < durationSec - 0.08) {
        return;
      }

      const restartPoint =
        effectivePreviewStartSec > 0
          ? Math.min(effectivePreviewStartSec, Math.max(durationSec - 0.24, 0))
          : 0;
      try {
        videoRef.current?.seek(restartPoint);
      } catch {
        return;
      }
    },
    [durationSec, effectivePreviewStartSec, mode, shouldLoopPreviewFromOffset],
  );

  return (
    <View
      pointerEvents={resolvedPointerEvents}
      style={[styles.wrapper, style as StyleProp<ViewStyle>, wrapperStyle]}
    >
      {shouldRenderThumbnailImage ? (
        <Image
          resizeMode={resizeMode}
          source={{ uri: resolvedThumbnailUrl }}
          style={StyleSheet.absoluteFillObject}
          onError={_event => {
            onError?.();
          }}
        />
      ) : isVideo ? (
        <Video
          {...(platformVideoTuningProps as any)}
          ref={instance => {
            videoRef.current = instance;
          }}
          controls={resolvedShowViewerControls}
          muted={resolvedMuted}
          onLoad={handleVideoLoad}
          onProgress={handleVideoProgress}
          paused={resolvedVideoPaused}
          playInBackground={false}
          playWhenInactive={false}
          poster={resolvedThumbnailUrl || undefined}
          posterResizeMode={resolvedVideoResizeMode}
          repeat={videoRepeat ?? true}
          resizeMode={resolvedVideoResizeMode}
          source={{ uri: sourceUrl }}
          style={StyleSheet.absoluteFillObject}
          onError={_event => {
            setVideoLoadFailed(true);
            if (mode === 'viewer') {
              setViewerVideoStalled(true);
            }
            onError?.();
          }}
        />
      ) : (
        <Image
          resizeMode={resizeMode}
          source={{ uri: sourceUrl }}
          style={StyleSheet.absoluteFillObject}
          onError={_event => {
            onError?.();
          }}
        />
      )}

      {isVideo && showVideoTypePill ? (
        <View pointerEvents="none" style={styles.videoTypePill}>
          <Text style={styles.videoTypePillText}>{mediaTypePillText}</Text>
        </View>
      ) : null}

      {isVideo && videoDurationLabel.length > 0 ? (
        <View pointerEvents="none" style={styles.videoDurationPill}>
          <Text style={styles.videoDurationPillText}>{videoDurationLabel}</Text>
        </View>
      ) : null}

      {isVideo && showVideoBadge ? (
        <View pointerEvents="none" style={styles.videoBadge}>
          <FeatherIcon color="#ffffff" name="play" size={11} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    overflow: 'hidden',
  },
  videoDurationPill: {
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    borderColor: 'rgba(255, 255, 255, 0.28)',
    borderRadius: 999,
    borderWidth: 1,
    bottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    position: 'absolute',
    right: 8,
  },
  videoDurationPillText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  videoBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    height: 22,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    top: 8,
    width: 22,
  },
  videoTypePill: {
    backgroundColor: 'rgba(15, 23, 42, 0.76)',
    borderColor: 'rgba(255, 255, 255, 0.24)',
    borderRadius: 999,
    borderWidth: 1,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    position: 'absolute',
    top: 8,
  },
  videoTypePillText: {
    color: '#ffffff',
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
});
