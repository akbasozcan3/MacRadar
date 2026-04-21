import React, { type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

type GlassSurfaceProps = {
  children: ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
};

export default function GlassSurface({
  children,
  className,
  style,
}: GlassSurfaceProps) {
  return (
    <View
      className={`border border-white/10 bg-[#020617]/96 ${className ?? ''}`}
      style={style}
    >
      {children}
    </View>
  );
}
