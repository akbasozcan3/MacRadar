import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';

import IosLoadingBadge from '../IosSpinner/IosLoadingBadge';
import { AppTheme } from '../../constants/Theme/Theme';

export default function LoadingScreen() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 900,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 900,
          easing: Easing.inOut(Easing.cubic),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [pulse]);

  const haloOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.14, 0.28],
  });
  const haloScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.18],
  });
  const shellScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.98, 1.02],
  });

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={[styles.orb, styles.primaryOrb]} />
      <View pointerEvents="none" style={[styles.orb, styles.secondaryOrb]} />

      <Animated.View
        pointerEvents="none"
        style={[
          styles.halo,
          {
            opacity: haloOpacity,
            transform: [{ scale: haloScale }],
          },
        ]}
      />

      <Animated.View
        style={[styles.badgeWrap, { transform: [{ scale: shellScale }] }]}
      >
        <IosLoadingBadge size="large" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  halo: {
    backgroundColor: AppTheme.colors.brandOrange,
    borderRadius: 72,
    height: 144,
    position: 'absolute',
    width: 144,
  },
  orb: {
    borderRadius: 140,
    position: 'absolute',
  },
  primaryOrb: {
    backgroundColor: 'rgba(255, 138, 0, 0.2)',
    height: 220,
    right: -36,
    top: -18,
    width: 220,
  },
  root: {
    alignItems: 'center',
    backgroundColor: AppTheme.colors.midnightDeep,
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  secondaryOrb: {
    backgroundColor: 'rgba(255, 180, 87, 0.16)',
    bottom: -56,
    height: 180,
    left: -44,
    width: 180,
  },
  badgeWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
