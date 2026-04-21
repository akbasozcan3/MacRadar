import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Pressable, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Mapbox from '@rnmapbox/maps';

import { Text } from '../../theme/typography';
type LivePlayerMarkerProps = {
  coordinate: [number, number];
  displayName: string;
  id: string;
  isLocal?: boolean;
  markerSizeVariant?: 'local' | 'remote';
  onPress?: () => void;
  pulseEnabled?: boolean;
  showNamePill?: boolean;
  photoUrl: string;
};

function initials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');
}

function LivePlayerMarker({
  coordinate,
  displayName,
  id,
  isLocal = false,
  markerSizeVariant,
  onPress,
  pulseEnabled = false,
  showNamePill = true,
  photoUrl,
}: LivePlayerMarkerProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageRevealScale = useRef(new Animated.Value(1)).current;
  const imageRevealOpacity = useRef(new Animated.Value(0)).current;
  const pulseScale = useRef(new Animated.Value(0.92)).current;
  const pulseOpacity = useRef(new Animated.Value(0)).current;
  const label = useMemo(() => initials(displayName), [displayName]);
  const nameLabel = isLocal ? 'Ben' : displayName;
  const resolvedMarkerSizeVariant = markerSizeVariant ?? (isLocal ? 'local' : 'remote');
  const markerSize = resolvedMarkerSizeVariant === 'local' ? 72 : 52;
  const namePillStyle = useMemo(
    (): ViewStyle => ({
      alignSelf: 'center',
      maxWidth: isLocal ? 160 : 140,
    }),
    [isLocal],
  );
  const normalizedPhotoUrl = photoUrl.trim();
  const imageSource =
    imageFailed || normalizedPhotoUrl.length === 0
      ? undefined
      : { uri: normalizedPhotoUrl };
  const imageRevealStyle = useMemo(
    () => ({
      opacity: imageRevealOpacity,
      transform: [{ scale: imageRevealScale }],
    }),
    [imageRevealOpacity, imageRevealScale],
  );

  useEffect(() => {
    if (!imageSource) {
      imageRevealOpacity.setValue(1);
      imageRevealScale.setValue(1);
      return;
    }
    imageRevealOpacity.setValue(0);
    imageRevealScale.setValue(1);
    Animated.parallel([
      Animated.timing(imageRevealOpacity, {
        duration: 180,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(imageRevealScale, {
        duration: 1,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, [imageRevealOpacity, imageRevealScale, imageSource]);

  useEffect(() => {
    if (!pulseEnabled) {
      pulseOpacity.stopAnimation();
      pulseScale.stopAnimation();
      pulseOpacity.setValue(0);
      pulseScale.setValue(0.92);
      return;
    }
    pulseOpacity.setValue(0.2);
    pulseScale.setValue(0.92);
    const pulseLoop = Animated.loop(
      Animated.parallel([
        Animated.timing(pulseScale, {
          duration: 1350,
          toValue: 1.24,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(pulseOpacity, {
            duration: 340,
            toValue: 0.28,
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            duration: 1010,
            toValue: 0,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    pulseLoop.start();
    return () => {
      pulseLoop.stop();
    };
  }, [pulseEnabled, pulseOpacity, pulseScale]);

  const pulseStyle = useMemo(
    () => ({
      opacity: pulseOpacity,
      transform: [{ scale: pulseScale }],
    }),
    [pulseOpacity, pulseScale],
  );

  return (
    <Mapbox.MarkerView
      allowOverlap
      allowOverlapWithPuck
      anchor={{ x: 0.5, y: 0.5 }}
      coordinate={coordinate}
      id={`player-${id}`}
    >
      <View
        className="items-center justify-center"
        style={{ width: markerSize + 20, height: markerSize + 20 }}
      >
        <View
          className="items-center justify-center"
          style={{
            width: markerSize,
            height: markerSize,
          }}
        >
          {pulseEnabled ? (
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: 'absolute',
                  width: markerSize + 16,
                  height: markerSize + 16,
                  borderRadius: (markerSize + 16) / 2,
                  borderWidth: 2,
                  borderColor: isLocal ? 'rgba(255,255,255,0.75)' : 'rgba(255,138,76,0.68)',
                  backgroundColor: isLocal ? 'rgba(255,255,255,0.06)' : 'rgba(255,138,76,0.08)',
                },
                pulseStyle,
              ]}
            />
          ) : null}
          <Pressable
            className={`items-center justify-center overflow-hidden rounded-full border-2 ${
              isLocal ? 'border-[#f4f4f6]' : 'border-white/80'
            } bg-[#07101d]`}
            onPress={onPress}
            style={{
              width: markerSize,
              height: markerSize,
            }}
          >
            {imageSource ? (
              <Animated.Image
                className="h-full w-full"
                onError={() => setImageFailed(true)}
                resizeMode="cover"
                source={imageSource}
                style={imageRevealStyle}
              />
            ) : (
              <View className="h-full w-full items-center justify-center bg-[#eaedf3]">
                {label.length > 0 ? (
                  <Text className="text-[16px] font-semibold text-[#4f5a6d]">{label}</Text>
                ) : (
                  <Text className="text-[16px] font-semibold text-[#4f5a6d]">U</Text>
                )}
              </View>
            )}
          </Pressable>
        </View>

        {showNamePill ? (
          <View
            className={`mt-1 rounded-full px-3.5 py-1.5 ${
              isLocal ? 'bg-[#111827]/85' : 'bg-orange-500/90'
            }`}
            style={namePillStyle}
          >
            <Text
              className="text-center text-[10px] font-semibold leading-4 tracking-[0.5px] text-white"
              ellipsizeMode="tail"
              numberOfLines={1}
            >
              {nameLabel}
            </Text>
          </View>
        ) : null}
      </View>
    </Mapbox.MarkerView>
  );
}

export default memo(
  LivePlayerMarker,
  (previous, next) =>
    previous.id === next.id &&
    previous.displayName === next.displayName &&
    previous.isLocal === next.isLocal &&
    previous.markerSizeVariant === next.markerSizeVariant &&
    previous.pulseEnabled === next.pulseEnabled &&
    previous.showNamePill === next.showNamePill &&
    previous.photoUrl === next.photoUrl &&
    Math.abs(previous.coordinate[0] - next.coordinate[0]) < 0.00002 &&
    Math.abs(previous.coordinate[1] - next.coordinate[1]) < 0.00002,
);
