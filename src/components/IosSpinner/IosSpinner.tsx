import React, { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  View,
} from 'react-native';
import { AppTheme } from '../../constants/Theme/Theme';

type SpinnerSize = 'small' | 'large' | number;

type IosSpinnerProps = {
  color?: string;
  size?: SpinnerSize;
  style?: StyleProp<ViewStyle>;
};

const SEGMENT_COUNT = 12;
const SMALL_SIZE = 20;
const LARGE_SIZE = 36;
const ORANGE_GRADIENT_START = '#ff942f';
const ORANGE_GRADIENT_END = '#ff4c16';

type RgbColor = {
  b: number;
  g: number;
  r: number;
};

function resolveSize(size: SpinnerSize) {
  if (typeof size === 'number' && Number.isFinite(size) && size > 0) {
    return size;
  }

  return size === 'large' ? LARGE_SIZE : SMALL_SIZE;
}

function clampColor(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(255, Math.max(0, Math.round(value)));
}

function parseHexColor(value: string): RgbColor | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }

  return {
    b: Number.parseInt(normalized.slice(4, 6), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    r: Number.parseInt(normalized.slice(0, 2), 16),
  };
}

function toHexColor({ b, g, r }: RgbColor) {
  const toHex = (value: number) => clampColor(value).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mixHexColor(startHex: string, endHex: string, ratio: number) {
  const start = parseHexColor(startHex);
  const end = parseHexColor(endHex);
  if (!start || !end) {
    return endHex;
  }

  const safeRatio = Math.min(1, Math.max(0, ratio));
  return toHexColor({
    b: start.b + (end.b - start.b) * safeRatio,
    g: start.g + (end.g - start.g) * safeRatio,
    r: start.r + (end.r - start.r) * safeRatio,
  });
}

export default function IosSpinner({
  color = AppTheme.colors.brandOrange,
  size = 'small',
  style,
}: IosSpinnerProps) {
  const isIos = Platform.OS === 'ios';
  const spin = useRef(new Animated.Value(0)).current;
  const normalizedSize = resolveSize(size);
  const spokeWidth = Math.max(2, Math.round(normalizedSize * 0.1));
  const spokeHeight = Math.max(6, Math.round(normalizedSize * 0.28));
  const spokeTopOffset = Math.max(1, Math.round(normalizedSize * 0.04));
  const normalizedColor = color.trim().toLowerCase();
  const isBrandOrange =
    normalizedColor === AppTheme.colors.brandOrange.toLowerCase() ||
    normalizedColor === '#ff5a1f';
  const shadowDistance = Math.max(1, Math.round(normalizedSize * 0.08));
  const shadowRadius = Math.max(2, Math.round(normalizedSize * 0.18));
  const elevation = Math.max(1, Math.round(normalizedSize * 0.1));

  useEffect(() => {
    if (!isIos) {
      return undefined;
    }

    const animation = Animated.loop(
      Animated.timing(spin, {
        duration: 820,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      }),
    );
    animation.start();

    return () => {
      animation.stop();
    };
  }, [isIos, spin]);

  const rotate = useMemo(
    () =>
      spin.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
      }),
    [spin],
  );

  if (!isIos) {
    return (
      <View style={[styles.androidRoot, style]}>
        <ActivityIndicator color={color} size={size === 'large' ? 'large' : 'small'} />
      </View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.root,
        styles.spinnerShadow,
        {
          height: normalizedSize,
          shadowOffset: { width: 0, height: shadowDistance },
          shadowRadius,
          transform: [{ rotate }],
          width: normalizedSize,
          elevation,
        },
        style,
      ]}
    >
      {Array.from({ length: SEGMENT_COUNT }, (_, index) => {
        const ratio = index / (SEGMENT_COUNT - 1);
        const opacity = isBrandOrange ? 0.38 + ratio * 0.62 : 0.22 + ratio * 0.78;
        const segmentColor = isBrandOrange
          ? mixHexColor(ORANGE_GRADIENT_START, ORANGE_GRADIENT_END, ratio)
          : color;
        return (
          <View
            key={`segment-${index}`}
            style={[
              styles.segmentWrap,
              { transform: [{ rotate: `${index * (360 / SEGMENT_COUNT)}deg` }] },
            ]}
          >
            <View
              style={{
                backgroundColor: segmentColor,
                borderRadius: spokeWidth / 2,
                height: spokeHeight,
                marginTop: spokeTopOffset,
                opacity,
                width: spokeWidth,
              }}
            />
          </View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  androidRoot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerShadow: {
    shadowColor: '#000000',
    shadowOpacity: 0.16,
  },
  segmentWrap: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-start',
    position: 'absolute',
    width: '100%',
  },
});
