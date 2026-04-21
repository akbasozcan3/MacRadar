import React from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppTheme } from '../../constants/Theme/Theme';
import { Text } from '../../theme/typography';
import FeatherIcon from '../FeatherIcon/FeatherIcon';
import IosLoadingBadge from '../IosSpinner/IosLoadingBadge';
import IosSpinner from '../IosSpinner/IosSpinner';

export type ScreenStateMode = 'dark' | 'light';
export type ScreenStateTone = 'error' | 'neutral';

type ScreenStateCenterProps = {
  children: React.ReactNode;
  minHeight?: number;
  paddingHorizontal?: number;
  style?: StyleProp<ViewStyle>;
};

export type ScreenStateCardProps = {
  actionLabel?: string;
  actionLoading?: boolean;
  compact?: boolean;
  description?: string;
  iconColor?: string;
  iconName?: string;
  loading?: boolean;
  mode?: ScreenStateMode;
  onActionPress?: () => void;
  style?: StyleProp<ViewStyle>;
  title: string;
  tone?: ScreenStateTone;
};

type CardPalette = {
  bodyTextColor: string;
  borderColor: string;
  cardColor: string;
  iconBackgroundColor: string;
  iconColor: string;
  titleColor: string;
};

function resolvePalette(mode: ScreenStateMode, tone: ScreenStateTone): CardPalette {
  if (mode === 'dark' && tone === 'error') {
    return {
      bodyTextColor: AppTheme.colors.stateDarkErrorText,
      borderColor: AppTheme.colors.stateDarkErrorBorder,
      cardColor: AppTheme.colors.stateDarkErrorBg,
      iconBackgroundColor: 'rgba(190, 24, 93, 0.2)',
      iconColor: '#fda4af',
      titleColor: AppTheme.colors.stateDarkErrorTitle,
    };
  }

  if (mode === 'dark') {
    return {
      bodyTextColor: '#cbd5e1',
      borderColor: 'rgba(248, 250, 252, 0.16)',
      cardColor: AppTheme.colors.surfaceDarkGlass,
      iconBackgroundColor: 'rgba(148, 163, 184, 0.2)',
      iconColor: '#e2e8f0',
      titleColor: AppTheme.colors.textInverse,
    };
  }

  if (tone === 'error') {
    return {
      bodyTextColor: AppTheme.colors.stateErrorText,
      borderColor: AppTheme.colors.stateErrorBorder,
      cardColor: AppTheme.colors.stateErrorBg,
      iconBackgroundColor: '#ffe6df',
      iconColor: '#f97316',
      titleColor: AppTheme.colors.stateErrorTitle,
    };
  }

  return {
    bodyTextColor: AppTheme.colors.textSecondary,
    borderColor: '#dbe2ed',
    cardColor: AppTheme.colors.surfaceCard,
    iconBackgroundColor: AppTheme.colors.surfaceMuted,
    iconColor: '#1f2937',
    titleColor: AppTheme.colors.textPrimary,
  };
}

export function ScreenStateCenter({
  children,
  minHeight = 240,
  paddingHorizontal = 0,
  style,
}: ScreenStateCenterProps) {
  return (
    <View style={[styles.centerWrap, { minHeight, paddingHorizontal }, style]}>
      {children}
    </View>
  );
}

export default function ScreenStateCard({
  actionLabel,
  actionLoading = false,
  compact = false,
  description,
  iconColor,
  iconName,
  loading = false,
  mode = 'light',
  onActionPress,
  style,
  title,
  tone = 'neutral',
}: ScreenStateCardProps) {
  const palette = resolvePalette(mode, tone);
  const shouldRenderIcon = loading || typeof iconName === 'string';

  return (
    <View
      style={[
        styles.card,
        compact ? styles.cardCompact : null,
        {
          backgroundColor: palette.cardColor,
          borderColor: palette.borderColor,
        },
        style,
      ]}
    >
      {shouldRenderIcon ? (
        <View
          style={[
            styles.iconWrap,
            loading
              ? styles.iconWrapLoading
              : {
                  backgroundColor: palette.iconBackgroundColor,
                },
          ]}
        >
          {loading ? (
            <IosLoadingBadge size={compact ? 'small' : 56} />
          ) : (
            <FeatherIcon
              color={iconColor || palette.iconColor}
              name={iconName || 'info'}
              size={22}
            />
          )}
        </View>
      ) : null}

      <Text
        allowFontScaling={false}
        style={[
          styles.title,
          compact ? styles.titleCompact : null,
          { color: palette.titleColor },
        ]}
      >
        {title}
      </Text>

      {description ? (
        <Text
          allowFontScaling={false}
          style={[styles.description, { color: palette.bodyTextColor }]}
        >
          {description}
        </Text>
      ) : null}

      {actionLabel && onActionPress ? (
        <Pressable
          disabled={actionLoading}
          onPress={onActionPress}
          style={({ pressed }) => [
            styles.actionButton,
            pressed ? styles.actionButtonPressed : null,
            actionLoading ? styles.actionButtonDisabled : null,
          ]}
        >
          {actionLoading ? (
            <IosSpinner color="#ffffff" size="small" />
          ) : (
            <Text allowFontScaling={false} style={styles.actionText}>
              {actionLabel}
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    backgroundColor: '#ff5a1f',
    borderRadius: AppTheme.radius.md,
    height: 38,
    justifyContent: 'center',
    marginTop: 12,
    minWidth: 124,
    paddingHorizontal: 16,
  },
  actionButtonDisabled: {
    opacity: 0.72,
  },
  actionButtonPressed: {
    opacity: 0.9,
  },
  actionText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  card: {
    borderRadius: AppTheme.radius.lg,
    borderWidth: 1,
    maxWidth: 360,
    minWidth: 220,
    paddingHorizontal: AppTheme.spacing.lg,
    paddingVertical: AppTheme.spacing.lg,
    width: '100%',
  },
  cardCompact: {
    borderRadius: AppTheme.radius.md,
    minWidth: 0,
    paddingHorizontal: AppTheme.spacing.md,
    paddingVertical: AppTheme.spacing.md,
  },
  centerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  description: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
    textAlign: 'center',
  },
  iconWrap: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 999,
    height: 58,
    justifyContent: 'center',
    marginBottom: 12,
    width: 58,
  },
  iconWrapLoading: {
    backgroundColor: 'transparent',
    height: 66,
    width: 66,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  titleCompact: {
    fontSize: 13.5,
    lineHeight: 18,
    textAlign: 'left',
  },
});
