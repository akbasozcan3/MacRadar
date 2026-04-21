import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

type MacRadarMarkProps = {
  coreColor?: string;
  glowColor?: string;
  headColor?: string;
  innerColor?: string;
  shadowColor?: string;
  showGlow?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
  tailColor?: string;
};

export default function MacRadarMark({
  coreColor = '#15213a',
  glowColor = 'rgba(59, 130, 246, 0.18)',
  headColor = '#f08f40',
  innerColor = '#ffffff',
  shadowColor = 'rgba(0, 0, 0, 0.18)',
  showGlow = false,
  size = 60,
  style,
  tailColor = '#2f94ff',
}: MacRadarMarkProps) {
  const shellHeight = size * 1.1;
  const glowSize = size * 0.92;
  const headSize = size * 0.67;
  const innerSize = size * 0.37;
  const coreSize = size * 0.18;
  const tailSize = size * 0.47;
  const tailRadius = size * 0.15;
  const shadowWidth = size * 0.4;
  const shadowHeight = size * 0.12;

  return (
    <View
      style={[
        styles.container,
        {
          height: shellHeight,
          width: size,
        },
        style,
      ]}>
      {showGlow ? (
        <View
          style={[
            styles.glow,
            {
              backgroundColor: glowColor,
              borderRadius: glowSize / 2,
              height: glowSize,
              top: size * 0.08,
              width: glowSize,
            },
          ]}
        />
      ) : null}

      <View
        style={[
          styles.shadow,
          {
            backgroundColor: shadowColor,
            borderRadius: shadowHeight / 2,
            bottom: size * 0.08,
            height: shadowHeight,
            width: shadowWidth,
          },
        ]}
      />

      <View
        style={[
          styles.tail,
          {
            backgroundColor: tailColor,
            borderRadius: tailRadius,
            height: tailSize,
            top: size * 0.34,
            width: tailSize,
          },
        ]}
      />

      <View
        style={[
          styles.head,
          {
            backgroundColor: headColor,
            borderRadius: headSize / 2,
            height: headSize,
            marginBottom: size * 0.12,
            width: headSize,
          },
        ]}>
        <View
          style={[
            styles.inner,
            {
              backgroundColor: innerColor,
              borderRadius: innerSize / 2,
              height: innerSize,
              width: innerSize,
            },
          ]}>
          <View
            style={[
              styles.core,
              {
                backgroundColor: coreColor,
                borderRadius: coreSize / 2,
                height: coreSize,
                width: coreSize,
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
  },
  head: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  shadow: {
    position: 'absolute',
  },
  tail: {
    position: 'absolute',
    transform: [{ rotate: '45deg' }],
  },
});
