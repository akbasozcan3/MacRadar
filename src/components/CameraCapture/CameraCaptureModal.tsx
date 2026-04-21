import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Linking,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';

import FeatherIcon from '../FeatherIcon/FeatherIcon';
import IosSpinner from '../IosSpinner/IosSpinner';
import {
  createVideoThumbnail,
  pickGalleryMedia,
} from '../../native/galleryPicker';
import { Text } from '../../theme/typography';

type CameraCaptureModalProps = {
  onCaptureComplete: (payload: {
    capturedAt: string;
    mediaType: 'photo' | 'video';
    mediaUrl: string;
    source?: 'camera' | 'gallery';
    thumbnailUrl?: string;
  }) => Promise<void> | void;
  onClose: () => void;
  safeBottom: number;
  safeTop: number;
  visible: boolean;
};

type CameraPosition = 'back' | 'front';
type FlashMode = 'off' | 'on';

const MAX_VIDEO_SECONDS = 60;
const DOUBLE_TAP_WINDOW_MS = 280;
const SHUTTER_LONG_PRESS_MS = 180;

function formatClock(value: Date) {
  return value.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatRecording(seconds: number) {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}

function resolveErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

export default function CameraCaptureModal({
  onCaptureComplete,
  onClose,
  safeBottom,
  safeTop,
  visible,
}: CameraCaptureModalProps) {
  const cameraRef = useRef<Camera>(null);
  const autoStopRequestedRef = useRef(false);
  const doubleTapAtRef = useRef(0);
  const shutterLongPressHandledRef = useRef(false);
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>('back');
  const device = useCameraDevice(cameraPosition);
  const { hasPermission, requestPermission } = useCameraPermission();
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [permissionRequestKey, setPermissionRequestKey] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPickingGallery, setIsPickingGallery] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [flashMode, setFlashMode] = useState<FlashMode>('off');
  const [cameraErrorMessage, setCameraErrorMessage] = useState<string | null>(
    null,
  );
  const shutterScale = useRef(new Animated.Value(1)).current;
  const shutterPulseOpacity = useRef(new Animated.Value(0)).current;
  const shutterPulseScale = useRef(new Animated.Value(1)).current;
  const instructionOpacity = useRef(new Animated.Value(1)).current;
  const instructionTranslateY = useRef(new Animated.Value(0)).current;
  const recordingPillOpacity = useRef(new Animated.Value(0)).current;
  const recordingPillTranslateY = useRef(new Animated.Value(-12)).current;
  const recordingPulseLoopRef = useRef<Animated.CompositeAnimation | null>(
    null,
  );

  useEffect(() => {
    if (visible) {
      setPermissionRequestKey(previous => previous + 1);
      return;
    }

    if (isRecording && cameraRef.current) {
      cameraRef.current.stopRecording().catch(() => {
        return;
      });
    }

    autoStopRequestedRef.current = false;
    doubleTapAtRef.current = 0;
    shutterLongPressHandledRef.current = false;
    setCameraPosition('back');
    setFlashMode('off');
    setRecordingSeconds(0);
    setCameraErrorMessage(null);
    setIsCapturing(false);
    setIsPickingGallery(false);
    setIsRecording(false);
    setIsRequestingPermission(false);
    recordingPulseLoopRef.current?.stop();
    recordingPulseLoopRef.current = null;
    shutterScale.setValue(1);
    shutterPulseOpacity.setValue(0);
    shutterPulseScale.setValue(1);
    instructionOpacity.setValue(1);
    instructionTranslateY.setValue(0);
    recordingPillOpacity.setValue(0);
    recordingPillTranslateY.setValue(-12);
  }, [
    instructionOpacity,
    instructionTranslateY,
    isRecording,
    recordingPillOpacity,
    recordingPillTranslateY,
    shutterPulseOpacity,
    shutterPulseScale,
    shutterScale,
    visible,
  ]);

  useEffect(() => {
    if (isRecording) {
      Animated.parallel([
        Animated.timing(instructionOpacity, {
          duration: 180,
          easing: Easing.out(Easing.cubic),
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.timing(instructionTranslateY, {
          duration: 180,
          easing: Easing.out(Easing.cubic),
          toValue: -10,
          useNativeDriver: true,
        }),
        Animated.parallel([
          Animated.timing(recordingPillOpacity, {
            duration: 220,
            easing: Easing.out(Easing.cubic),
            toValue: 1,
            useNativeDriver: true,
          }),
          Animated.timing(recordingPillTranslateY, {
            duration: 220,
            easing: Easing.out(Easing.cubic),
            toValue: 0,
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      shutterPulseOpacity.setValue(0.22);
      shutterPulseScale.setValue(1);
      recordingPulseLoopRef.current?.stop();
      recordingPulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(shutterPulseOpacity, {
              duration: 700,
              easing: Easing.out(Easing.quad),
              toValue: 0.34,
              useNativeDriver: true,
            }),
            Animated.timing(shutterPulseScale, {
              duration: 700,
              easing: Easing.out(Easing.quad),
              toValue: 1.16,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(shutterPulseOpacity, {
              duration: 700,
              easing: Easing.inOut(Easing.quad),
              toValue: 0.18,
              useNativeDriver: true,
            }),
            Animated.timing(shutterPulseScale, {
              duration: 700,
              easing: Easing.inOut(Easing.quad),
              toValue: 1,
              useNativeDriver: true,
            }),
          ]),
        ]),
      );
      recordingPulseLoopRef.current.start();
      return;
    }

    recordingPulseLoopRef.current?.stop();
    recordingPulseLoopRef.current = null;
    Animated.parallel([
      Animated.spring(shutterScale, {
        bounciness: 6,
        speed: 18,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(shutterPulseOpacity, {
        duration: 140,
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(shutterPulseScale, {
        duration: 140,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.timing(instructionOpacity, {
          duration: 180,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(instructionTranslateY, {
          duration: 180,
          easing: Easing.out(Easing.cubic),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(recordingPillOpacity, {
          duration: 140,
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.timing(recordingPillTranslateY, {
          duration: 140,
          toValue: -12,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [
    instructionOpacity,
    instructionTranslateY,
    isRecording,
    recordingPillOpacity,
    recordingPillTranslateY,
    shutterPulseOpacity,
    shutterPulseScale,
    shutterScale,
  ]);

  useEffect(() => {
    if (!visible || hasPermission || permissionRequestKey === 0) {
      return;
    }

    let active = true;
    setIsRequestingPermission(true);
    setCameraErrorMessage(null);

    requestPermission()
      .then(granted => {
        if (active && !granted) {
          setCameraErrorMessage('Kamera izni gerekli.');
        }
      })
      .catch(() => {
        if (active) {
          setCameraErrorMessage('Kamera izni alinamadi.');
        }
      })
      .finally(() => {
        if (active) {
          setIsRequestingPermission(false);
        }
      });

    return () => {
      active = false;
    };
  }, [hasPermission, permissionRequestKey, requestPermission, visible]);

  useEffect(() => {
    if (!isRecording) {
      return;
    }

    const timer = setInterval(() => {
      setRecordingSeconds(previous => previous + 1);
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [isRecording]);

  useEffect(() => {
    if (
      !isRecording ||
      recordingSeconds < MAX_VIDEO_SECONDS ||
      autoStopRequestedRef.current
    ) {
      return;
    }

    autoStopRequestedRef.current = true;
    cameraRef.current?.stopRecording().catch(error => {
      autoStopRequestedRef.current = false;
      setIsRecording(false);
      setIsCapturing(false);
      setRecordingSeconds(0);
      setCameraErrorMessage(
        resolveErrorMessage(error, 'Video kaydi otomatik durdurulamadi.'),
      );
    });
  }, [isRecording, recordingSeconds]);

  async function handleCapturePhoto() {
    if (
      !hasPermission ||
      isCapturing ||
      isRecording ||
      !cameraRef.current ||
      !device
    ) {
      return;
    }

    setIsCapturing(true);
    setCameraErrorMessage(null);
    try {
      const photo = await cameraRef.current.takePhoto({
        enableAutoRedEyeReduction: true,
        enableShutterSound: false,
        flash: device.hasFlash ? flashMode : 'off',
      });
      const normalizedUri = photo.path.startsWith('file://')
        ? photo.path
        : `file://${photo.path}`;
      await Promise.resolve(
        onCaptureComplete({
          capturedAt: formatClock(new Date()),
          mediaType: 'photo',
          mediaUrl: normalizedUri,
          source: 'camera',
          thumbnailUrl: normalizedUri,
        }),
      );
    } catch (error) {
      setCameraErrorMessage(resolveErrorMessage(error, 'Foto cekilemedi.'));
    } finally {
      setIsCapturing(false);
    }
  }

  function startVideoCapture() {
    if (
      !hasPermission ||
      !cameraRef.current ||
      !device ||
      isCapturing ||
      isRecording
    ) {
      return;
    }

    autoStopRequestedRef.current = false;
    setCameraErrorMessage(null);
    setIsCapturing(true);
    setRecordingSeconds(0);

    try {
      cameraRef.current.startRecording({
        flash: device.hasFlash ? flashMode : 'off',
        onRecordingError: error => {
          autoStopRequestedRef.current = false;
          setIsRecording(false);
          setIsCapturing(false);
          setRecordingSeconds(0);
          setCameraErrorMessage(
            resolveErrorMessage(error, 'Video kaydi baslatilamadi.'),
          );
        },
        onRecordingFinished: video => {
          autoStopRequestedRef.current = false;
          const normalizedUri = video.path.startsWith('file://')
            ? video.path
            : `file://${video.path}`;
          setIsRecording(false);
          setIsCapturing(false);
          setRecordingSeconds(0);
          createVideoThumbnail(normalizedUri)
            .catch(() => null)
            .then(thumbnailUrl =>
              Promise.resolve(
                onCaptureComplete({
                  capturedAt: formatClock(new Date()),
                  mediaType: 'video',
                  mediaUrl: normalizedUri,
                  source: 'camera',
                  thumbnailUrl: thumbnailUrl ?? undefined,
                }),
              ),
            )
            .catch(error => {
              setCameraErrorMessage(
                resolveErrorMessage(
                  error,
                  'Video cekimi tamamlandi ama aktarim basarisiz.',
                ),
              );
            });
        },
      });
      setIsRecording(true);
      setIsCapturing(false);
    } catch (error) {
      autoStopRequestedRef.current = false;
      setIsRecording(false);
      setIsCapturing(false);
      setRecordingSeconds(0);
      setCameraErrorMessage(
        resolveErrorMessage(error, 'Video kaydi baslatilamadi.'),
      );
    }
  }

  async function stopVideoCapture() {
    if (!cameraRef.current || !isRecording) {
      return;
    }

    autoStopRequestedRef.current = true;
    setCameraErrorMessage(null);
    try {
      await cameraRef.current.stopRecording();
    } catch (error) {
      autoStopRequestedRef.current = false;
      setIsRecording(false);
      setRecordingSeconds(0);
      setCameraErrorMessage(
        resolveErrorMessage(error, 'Video kaydi durdurulamadi.'),
      );
    }
  }

  function handleFlipCamera() {
    if (isRecording || isCapturing) {
      return;
    }

    setCameraPosition(current => (current === 'back' ? 'front' : 'back'));
    setCameraErrorMessage(null);
  }

  function handleFlashToggle() {
    if (!device?.hasFlash || isRecording || isCapturing) {
      return;
    }
    setFlashMode(current => (current === 'off' ? 'on' : 'off'));
  }

  function handleRetryPermission() {
    if (isRequestingPermission) {
      return;
    }
    setCameraErrorMessage(null);
    setPermissionRequestKey(previous => previous + 1);
  }

  function handleOpenSettings() {
    Linking.openSettings().catch(() => {
      return;
    });
  }

  async function handleOpenGallery() {
    if (isCapturing || isRecording || isPickingGallery) {
      return;
    }
    setIsPickingGallery(true);
    setCameraErrorMessage(null);
    try {
      const selection = await pickGalleryMedia('photo');
      if (!selection) {
        return;
      }
      await Promise.resolve(
        onCaptureComplete({
          capturedAt: formatClock(new Date()),
          mediaType: selection.mediaType,
          mediaUrl: selection.mediaUrl,
          source: 'gallery',
          thumbnailUrl:
            selection.thumbnailUrl ??
            (selection.mediaType === 'photo' ? selection.mediaUrl : undefined),
        }),
      );
    } catch (error) {
      setCameraErrorMessage(
        resolveErrorMessage(error, 'Galeri medyasi secilemedi.'),
      );
    } finally {
      setIsPickingGallery(false);
    }
  }

  function animateShutterScale(nextValue: number) {
    Animated.spring(shutterScale, {
      bounciness: 6,
      speed: 20,
      toValue: nextValue,
      useNativeDriver: true,
    }).start();
  }

  async function handleShutterPress() {
    if (shutterLongPressHandledRef.current) {
      shutterLongPressHandledRef.current = false;
      return;
    }
    await handleCapturePhoto();
  }

  function handleShutterLongPress() {
    if (isCapturing || isRecording) {
      return;
    }
    shutterLongPressHandledRef.current = true;
    animateShutterScale(0.92);
    startVideoCapture();
  }

  function handleShutterPressIn() {
    if (primaryDisabled) {
      return;
    }
    animateShutterScale(0.96);
  }

  function handleShutterPressOut() {
    animateShutterScale(isRecording ? 0.92 : 1);
    if (isRecording) {
      stopVideoCapture().catch(() => {
        return;
      });
    }
  }

  function handleCameraSurfaceTap() {
    if (!canUseCamera || isRequestingPermission || isCapturing || isRecording) {
      return;
    }

    const now = Date.now();
    if (now - doubleTapAtRef.current <= DOUBLE_TAP_WINDOW_MS) {
      doubleTapAtRef.current = 0;
      handleFlipCamera();
      return;
    }
    doubleTapAtRef.current = now;
  }

  const bottomInset = Math.max(safeBottom, 18);
  const topInset = Math.max(safeTop, 0);
  const canUseCamera = hasPermission && Boolean(device);
  const primaryDisabled =
    !canUseCamera || isCapturing || isPickingGallery || isRequestingPermission;
  const recordingLabel = formatRecording(recordingSeconds);

  return (
    <Modal
      animationType="slide"
      navigationBarTranslucent={true}
      onRequestClose={onClose}
      statusBarTranslucent={true}
      transparent={false}
      visible={visible}
    >
      <StatusBar
        animated={true}
        backgroundColor="transparent"
        barStyle="light-content"
        hidden={true}
        translucent={true}
      />
      <View style={styles.screen}>
        {canUseCamera ? (
          <Camera
            audio={true}
            device={device!}
            isActive={visible}
            photo={true}
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            video={true}
          />
        ) : null}

        {canUseCamera ? (
          <Pressable
            onPress={handleCameraSurfaceTap}
            style={styles.cameraTouchLayer}
          />
        ) : null}

        <View pointerEvents="none" style={styles.bottomScrim} />

        {!canUseCamera ? (
          <View style={styles.permissionCard}>
            {isRequestingPermission ? <IosSpinner size="small" /> : null}
            <Text style={styles.permissionTitle}>Kamera Erisimi</Text>
            <Text style={styles.permissionText}>
              {hasPermission
                ? 'Kamera cihazi hazirlaniyor...'
                : 'Kamera kullanimi icin izin vermen gerekiyor.'}
            </Text>
            <View style={styles.permissionActions}>
              <Pressable
                onPress={handleRetryPermission}
                style={({ pressed }) => [
                  styles.permissionPrimary,
                  pressed ? styles.controlPressed : null,
                ]}
              >
                <Text style={styles.permissionPrimaryText}>Yeniden Dene</Text>
              </Pressable>
              <Pressable
                onPress={handleOpenSettings}
                style={({ pressed }) => [
                  styles.permissionSecondary,
                  pressed ? styles.controlPressed : null,
                ]}
              >
                <Text style={styles.permissionSecondaryText}>Ayarlar</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View
          style={[
            styles.topControls,
            {
              paddingTop: topInset + 4,
            },
          ]}
        >
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.controlCircle,
              pressed ? styles.controlPressed : null,
            ]}
          >
            <FeatherIcon color="#ffffff" name="x" size={20} />
          </Pressable>

          <View style={styles.indicatorDot} />

          <Pressable
            onPress={handleFlashToggle}
            style={({ pressed }) => [
              styles.controlCircle,
              !device?.hasFlash ? styles.controlDisabled : null,
              pressed ? styles.controlPressed : null,
            ]}
          >
            <FeatherIcon
              color={flashMode === 'on' ? '#ffd84f' : '#ffffff'}
              name={flashMode === 'on' ? 'zap' : 'zap-off'}
              size={17}
            />
          </Pressable>
        </View>

        <Animated.View
          pointerEvents="none"
          style={[
            styles.instructionCard,
            {
              opacity: instructionOpacity,
              top: topInset + 64,
              transform: [{ translateY: instructionTranslateY }],
            },
          ]}
        >
          <Text style={styles.instructionTitle}>
            Tek dokun fotograf cekmek icin
          </Text>
          <Text style={styles.instructionTitle}>
            Basili tut video kaydetmek icin
          </Text>
          <Text style={styles.instructionSubtitle}>
            Gonderi icin maksimum 60 saniye
          </Text>
        </Animated.View>

        <Animated.View
          pointerEvents="none"
          style={[
            styles.recordingPill,
            {
              opacity: recordingPillOpacity,
              top: topInset + 132,
              transform: [{ translateY: recordingPillTranslateY }],
            },
          ]}
        >
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>{`REC ${recordingLabel}`}</Text>
        </Animated.View>

        <View
          style={[
            styles.capturePanel,
            {
              paddingBottom: bottomInset + 8,
            },
          ]}
        >
          <View style={styles.captureRow}>
            <Pressable
              onPress={handleOpenGallery}
              style={({ pressed }) => [
                styles.galleryButton,
                isPickingGallery ? styles.controlDisabled : null,
                pressed ? styles.controlPressed : null,
              ]}
            >
              {isPickingGallery ? (
                <IosSpinner color="#ffffff" size="small" />
              ) : (
                <FeatherIcon color="#ffffff" name="image" size={18} />
              )}
            </Pressable>

            <View style={styles.shutterStack}>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.shutterPulse,
                  {
                    opacity: shutterPulseOpacity,
                    transform: [{ scale: shutterPulseScale }],
                  },
                ]}
              />
              <Animated.View style={{ transform: [{ scale: shutterScale }] }}>
                <Pressable
                  accessibilityRole="button"
                  delayLongPress={SHUTTER_LONG_PRESS_MS}
                  disabled={primaryDisabled}
                  onLongPress={handleShutterLongPress}
                  onPress={() => {
                    handleShutterPress().catch(() => {
                      return;
                    });
                  }}
                  onPressIn={handleShutterPressIn}
                  onPressOut={handleShutterPressOut}
                  style={({ pressed }) => [
                    styles.shutterOuter,
                    isRecording ? styles.shutterOuterRecording : null,
                    pressed ? styles.shutterPressed : null,
                  ]}
                >
                  {isCapturing ? (
                    <IosSpinner size="small" />
                  ) : (
                    <View
                      style={[
                        styles.shutterInner,
                        isRecording ? styles.shutterInnerRecording : null,
                      ]}
                    />
                  )}
                </Pressable>
              </Animated.View>
            </View>

            <Pressable
              onPress={handleFlipCamera}
              style={({ pressed }) => [
                styles.controlCircle,
                pressed ? styles.controlPressed : null,
              ]}
            >
              <FeatherIcon color="#ffffff" name="refresh-cw" size={17} />
            </Pressable>
          </View>

          <Text
            style={[
              styles.captureHint,
              isRecording ? styles.captureHintActive : null,
            ]}
          >
            {isRecording
              ? 'Kayit suruyor. Birakinca video hazirlansin.'
              : 'Dokun: fotograf cek. Basili tut: video kaydi.'}
          </Text>
        </View>

        {cameraErrorMessage ? (
          <View
            style={[
              styles.errorBanner,
              {
                bottom: bottomInset + 156,
              },
            ]}
          >
            <Text style={styles.errorText}>{cameraErrorMessage}</Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  cameraTouchLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  screen: {
    backgroundColor: '#000000',
    flex: 1,
  },
  bottomScrim: {
    backgroundColor: 'rgba(0, 0, 0, 0.12)',
    bottom: 0,
    height: 154,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  topControls: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: 18,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  controlCircle: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
    borderColor: 'rgba(255,255,255,0.34)',
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  galleryButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
    borderColor: 'rgba(255,255,255,0.34)',
    borderRadius: 10,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  controlDisabled: {
    opacity: 0.45,
  },
  controlPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.97 }],
  },
  indicatorDot: {
    backgroundColor: '#22c55e',
    borderRadius: 4,
    height: 8,
    opacity: 0.95,
    width: 8,
  },
  instructionCard: {
    alignSelf: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.72)',
    borderRadius: 18,
    maxWidth: 248,
    paddingHorizontal: 16,
    paddingVertical: 12,
    position: 'absolute',
  },
  instructionTitle: {
    color: '#f8fafc',
    fontSize: 11.5,
    fontWeight: '700',
    lineHeight: 17,
    textAlign: 'center',
  },
  instructionSubtitle: {
    color: 'rgba(226, 232, 240, 0.86)',
    fontSize: 10.5,
    marginTop: 4,
    textAlign: 'center',
  },
  recordingPill: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderColor: 'rgba(248, 113, 113, 0.18)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 8,
    position: 'absolute',
  },
  recordingDot: {
    backgroundColor: '#ef4444',
    borderRadius: 4,
    height: 8,
    marginRight: 7,
    width: 8,
  },
  recordingText: {
    color: '#111827',
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.25,
  },
  permissionCard: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(3, 7, 18, 0.82)',
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    borderWidth: 1,
    marginHorizontal: 20,
    marginTop: 160,
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  permissionTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  permissionText: {
    color: 'rgba(226, 232, 240, 0.95)',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
    textAlign: 'center',
  },
  permissionActions: {
    flexDirection: 'row',
    marginTop: 14,
  },
  permissionPrimary: {
    alignItems: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 999,
    height: 38,
    justifyContent: 'center',
    minWidth: 114,
    paddingHorizontal: 14,
  },
  permissionPrimaryText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  permissionSecondary: {
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.38)',
    borderRadius: 999,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    marginLeft: 10,
    minWidth: 92,
    paddingHorizontal: 12,
  },
  permissionSecondaryText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '600',
  },
  capturePanel: {
    alignItems: 'center',
    bottom: 0,
    left: 0,
    paddingHorizontal: 24,
    position: 'absolute',
    right: 0,
  },
  captureRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  shutterStack: {
    alignItems: 'center',
    height: 90,
    justifyContent: 'center',
    width: 90,
  },
  shutterPulse: {
    backgroundColor: 'rgba(255,255,255,0.20)',
    borderRadius: 44,
    height: 88,
    position: 'absolute',
    width: 88,
  },
  shutterOuter: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderColor: 'rgba(255,255,255,0.95)',
    borderRadius: 41,
    borderWidth: 3,
    height: 82,
    justifyContent: 'center',
    width: 82,
  },
  shutterOuterRecording: {
    borderColor: 'rgba(248, 113, 113, 0.95)',
  },
  shutterPressed: {
    opacity: 0.96,
  },
  shutterInner: {
    backgroundColor: '#ffffff',
    borderRadius: 28,
    height: 56,
    width: 56,
  },
  shutterInnerRecording: {
    backgroundColor: '#ef4444',
    borderRadius: 8,
    height: 24,
    width: 24,
  },
  captureHint: {
    color: 'rgba(226, 232, 240, 0.86)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 10,
    textAlign: 'center',
  },
  captureHintActive: {
    color: '#ffffff',
  },
  errorBanner: {
    backgroundColor: 'rgba(127, 29, 29, 0.9)',
    borderColor: 'rgba(254, 202, 202, 0.32)',
    borderRadius: 999,
    borderWidth: 1,
    left: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    position: 'absolute',
    right: 16,
  },
  errorText: {
    color: '#ffe4e6',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
});
