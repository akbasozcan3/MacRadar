import React, { useEffect, useState } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

import { Text } from '../../theme/typography';
type FeatherIconProps = {
  className?: string;
  color?: string;
  name: string;
  size?: number;
  style?: StyleProp<TextStyle>;
  strokeWidth?: number;
};

const FallbackGlyphs: Record<string, string> = {
  activity: '\u2248',
  'alert-octagon': '!',
  'alert-triangle': '\u26a0',
  'arrow-left': '\u2190',
  'arrow-right': '\u2192',
  award: '\u2605',
  bell: '\u25cc',
  camera: '\u25c9',
  'chevron-right': '\u203a',
  check: '\u2713',
  'chevron-left': '\u2039',
  clock: '\u25f7',
  compass: '\u25ce',
  'credit-card': '\u25ad',
  'edit-2': '\u270e',
  eye: '\u25c9',
  'eye-off': '\u25cc',
  facebook: 'f',
  'file-text': '\u2630',
  flag: '\u2691',
  globe: '\u25ce',
  'help-circle': '?',
  home: '\u2302',
  key: '\u25c6',
  lock: '\ud83d\udd12',
  'log-out': '\u21b1',
  mail: '\u2709',
  'map-pin': '\u2316',
  'message-circle': '\u2709',
  'message-square': '\u2709',
  'more-horizontal': '\u22ef',
  'more-vertical': '\u22ee',
  navigation: '\u27a4',
  plus: '+',
  'refresh-cw': '\u21bb',
  search: '\u2315',
  send: '\u279c',
  settings: '\u2699',
  sparkles: '\u2728',
  shield: '\u25c7',
  slash: '\u2298',
  star: '\u2605',
  truck: '\u25ad',
  user: '\u25c9',
  'user-plus': '\u2295',
  users: '\u25cc\u25cc',
  x: '\u2715',
  'x-circle': '\u2297',
  image: '\u25a7',
  zap: '\u26a1',
  'zap-off': '\u26a1',
  'plus-circle': '\u2295',
};

type VectorSupport = 'checking' | 'ready' | 'fallback';

type FeatherModuleShape = React.ComponentType<any> & {
  getImageSource?: (
    name: string,
    size?: number,
    color?: string,
  ) => Promise<unknown>;
};

let FeatherModule: FeatherModuleShape | null = null;
let vectorSupport: VectorSupport = 'checking';
let vectorSupportPromise: Promise<void> | null = null;

try {
  const loadedModule = require('react-native-vector-icons/Feather');
  FeatherModule = (loadedModule.default ?? loadedModule) as FeatherModuleShape;
} catch {
  FeatherModule = null;
}

function ensureVectorSupport() {
  if (vectorSupport !== 'checking') {
    return Promise.resolve();
  }

  if (!vectorSupportPromise) {
    if (!FeatherModule) {
      vectorSupport = 'fallback';
      return Promise.resolve();
    }

    if (typeof FeatherModule.getImageSource !== 'function') {
      vectorSupport = 'ready';
      return Promise.resolve();
    }

    vectorSupportPromise = Promise.resolve()
      .then(() => FeatherModule?.getImageSource?.('home', 16, '#f8fafc'))
      .then(() => {
        vectorSupport = 'ready';
      })
      .catch(() => {
        vectorSupport = 'fallback';
      });
  }

  return vectorSupportPromise;
}

export default function FeatherIcon({
  className,
  color = '#f8fafc',
  name,
  size = 20,
  style,
  strokeWidth = 2,
}: FeatherIconProps) {
  const [supportState, setSupportState] = useState<VectorSupport>(vectorSupport);

  const fallbackStyle = {
    color,
    fontSize: size,
    fontWeight: '700' as const,
    lineHeight: size + 4,
  };

  useEffect(() => {
    let mounted = true;

    ensureVectorSupport().finally(() => {
      if (mounted) {
        setSupportState(vectorSupport);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  if (FeatherModule && supportState === 'ready') {
    return (
      <FeatherModule
        color={color}
        name={name}
        size={size}
        style={style}
        strokeWidth={strokeWidth}
      />
    );
  }

  return (
    <Text className={className} style={[fallbackStyle, style]}>
      {FallbackGlyphs[name] ?? '*'}
    </Text>
  );
}
