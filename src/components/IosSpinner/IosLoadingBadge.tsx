import React from 'react';
import {
  Image,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import IosSpinner from './IosSpinner';

type BadgeSize = 'small' | 'large' | number;

type IosLoadingBadgeProps = {
  size?: BadgeSize;
  style?: StyleProp<ViewStyle>;
};

function resolveBadgeSize(size: BadgeSize) {
  if (typeof size === 'number' && Number.isFinite(size) && size > 0) {
    return size;
  }

  return size === 'small' ? 54 : 76;
}

export default function IosLoadingBadge({
  size = 'large',
  style,
}: IosLoadingBadgeProps) {
  const badgeSize = resolveBadgeSize(size);
  const iconSize = Math.max(20, Math.round(badgeSize * 0.36));
  const spinnerSize = Math.max(16, Math.round(badgeSize * 0.48));

  return (
    <View
      style={[
        styles.shell,
        {
          borderRadius: badgeSize / 2,
          height: badgeSize,
          width: badgeSize,
        },
        style,
      ]}
    >
      <View style={[styles.gradientBase, { borderRadius: badgeSize / 2 }]} />
      <View
        style={[
          styles.gradientHighlight,
          {
            borderRadius: badgeSize / 2,
            height: Math.round(badgeSize * 0.64),
            width: Math.round(badgeSize * 0.64),
          },
        ]}
      />
      <View
        style={[
          styles.gradientShadow,
          {
            borderRadius: badgeSize / 2,
            height: Math.round(badgeSize * 0.74),
            width: Math.round(badgeSize * 0.74),
          },
        ]}
      />

      <Image
        source={require('../../assets/idea.jpg')}
        style={[
          styles.icon,
          {
            borderRadius: Math.round(iconSize * 0.26),
            height: iconSize,
            width: iconSize,
          },
        ]}
      />

      <View style={styles.spinnerWrap}>
        <IosSpinner color="#fff7ed" size={spinnerSize} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gradientBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ff5a1f',
  },
  gradientHighlight: {
    backgroundColor: '#ff8a2f',
    left: 6,
    opacity: 0.68,
    position: 'absolute',
    top: 5,
  },
  gradientShadow: {
    backgroundColor: '#f54912',
    bottom: 4,
    opacity: 0.82,
    position: 'absolute',
    right: 5,
  },
  icon: {
    borderColor: 'rgba(255, 255, 255, 0.55)',
    borderWidth: 1,
    elevation: 3,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  shell: {
    alignItems: 'center',
    elevation: 8,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
  },
  spinnerWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
