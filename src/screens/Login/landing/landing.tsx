import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  View,
  useWindowDimensions,
} from 'react-native';

import FeatherIcon from '../../../components/FeatherIcon/FeatherIcon';
import IosSpinner from '../../../components/IosSpinner/IosSpinner';
import { Text } from '../../../theme/typography';
import type { SocialProvider } from '../Login.types';

type LandingProps = {
  errorMessage?: string | null;
  infoMessage?: string | null;
  isBusy: boolean;
  onOpenLogin: () => void;
  onOpenRegister: () => void;
  onSocial: (provider: SocialProvider) => void;
  safeBottom: number;
  safeTop: number;
  socialLoading: SocialProvider | null;
};

const BRAND_IMAGE_SOURCE = require('../../../assets/images/landing_hero.jpg');

const SHEET_CARD_SHADOW = {
  shadowColor: '#0b1220',
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.09,
  shadowRadius: 22,
  elevation: 5,
} as const;
const GOOGLE_ICON_SOURCE = require('./icons8-google-48.png');

function MessageCard({
  message,
  tone,
  width,
}: {
  message: string;
  tone: 'error' | 'info';
  width: number;
}) {
  const isError = tone === 'error';

  return (
    <View
      className={`w-full rounded-[18px] border px-4 py-3 ${
        isError
          ? 'border-[#f2cbc3] bg-[#fff5f2]'
          : 'border-[#d7e4f2] bg-[#f2f8ff]'
      }`}
      style={{ maxWidth: width }}
    >
      <Text
        allowFontScaling={false}
        className={`text-[11.5px] font-[500] leading-[18px] ${
          isError ? 'text-[#8f4339]' : 'text-[#2c5673]'
        }`}
      >
        {message}
      </Text>
    </View>
  );
}

function FeatureChip({ icon, label }: { icon: string; label: string }) {
  return (
    <View className="min-h-[44px] flex-row items-center rounded-full border border-[#eaedf2] bg-[#f7f8fb] px-4">
      <FeatherIcon color="#20232b" name={icon} size={15} />
      <Text allowFontScaling={false} className="ml-2.5 text-[16px] font-[500] leading-[20px] text-[#20232b]">
        {label}
      </Text>
    </View>
  );
}

function ActionButton({
  disabled,
  label,
  onPress,
  variant,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
  variant: 'primary' | 'secondary';
}) {
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      className={`h-[56px] items-center justify-center rounded-[28px] border px-4 ${
        isPrimary
          ? 'border-[#ff5a16] bg-[#ff5a16]'
          : 'border-[#0f172a] bg-[#0f172a]'
      } ${disabled ? 'opacity-60' : ''}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) =>
        pressed && !disabled
          ? {
              opacity: 0.84,
              transform: [{ scale: 0.986 }],
            }
          : null
      }
    >
      <Text
        allowFontScaling={false}
        className="text-[16px] font-[500] tracking-[0.2px] text-[#ffffff]"
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SocialButton({
  disabled,
  fullWidth,
  isLoading,
  onPress,
  provider,
}: {
  disabled: boolean;
  fullWidth: boolean;
  isLoading: boolean;
  onPress: () => void;
  provider: SocialProvider;
}) {
  const isGoogle = provider === 'google';

  return (
    <Pressable
      className={`h-[52px] items-center justify-center rounded-[18px] border border-[#e7e7eb] bg-[#ffffff] ${
        fullWidth ? 'w-full' : 'flex-1'
      } ${disabled || isLoading ? 'opacity-60' : ''}`}
      disabled={disabled || isLoading}
      onPress={onPress}
      style={({ pressed }) =>
        pressed && !disabled && !isLoading
          ? {
              opacity: 0.92,
              transform: [{ scale: 0.972 }],
            }
          : null
      }
    >
      <View className="h-[50px] w-full rounded-[17px] border border-[#f3f3f6] bg-[#ffffff] px-3">
        <View className="h-full w-full flex-row items-center justify-center rounded-[15px] bg-[#fbfbfd]">
          {isLoading ? (
            <IosSpinner size="small" />
          ) : (
            <>
              <Image
                source={GOOGLE_ICON_SOURCE}
                style={{ height: 20, width: 20 }}
              />
              <Text
                allowFontScaling={false}
                className={`ml-2.5 text-[13px] top-[2px] font-[400] ${
                  isGoogle ? 'text-[#20232b]' : 'text-[#1f2937]'
                }`}
              >
                Google ile Devam Et
              </Text>
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default function Landing({
  errorMessage,
  infoMessage,
  isBusy,
  onOpenLogin,
  onOpenRegister,
  onSocial,
  safeBottom,
  safeTop,
  socialLoading,
}: LandingProps) {
  const { height, width } = useWindowDimensions();
  const isCompact = height < 760;
  const heroHeight = Math.min(
    Math.max(height * (isCompact ? 0.52 : 0.56), isCompact ? 390 : 440),
    isCompact ? 520 : 610,
  );

  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;
  const scale = useRef(new Animated.Value(0.985)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        duration: 260,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        duration: 320,
        easing: Easing.out(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        duration: 320,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale, translateY]);

  return (
    <View className="flex-1 bg-[#eceff3]">
      <View
        pointerEvents="none"
        style={{
          height: heroHeight + safeTop + 16,
          left: 0,
          position: 'absolute',
          right: 0,
          top: 0,
        }}
      >
        <Image
          resizeMode="cover"
          source={BRAND_IMAGE_SOURCE}
          style={{ height: '100%', width: '100%' }}
        />
        <View className="absolute inset-0 bg-[#000000]/14" />
      </View>

      <Animated.View
        renderToHardwareTextureAndroid={true}
        style={{
          flex: 1,
          opacity,
          paddingBottom: 0,
          paddingTop: Math.max(safeTop, 12) + 8,
          transform: [{ translateY }, { scale }],
        }}
      >
        <View className="flex-1 justify-end">
          <View className="w-full items-center gap-2.5 px-4">
            {infoMessage ? <MessageCard message={infoMessage} tone="info" width={width - 32} /> : null}
            {errorMessage ? <MessageCard message={errorMessage} tone="error" width={width - 32} /> : null}
          </View>

          <View
            className="mt-3 w-full rounded-t-[34px] bg-[#f4f4f6] px-7 pb-6 pt-5"
            style={[SHEET_CARD_SHADOW, { paddingBottom: Math.max(safeBottom, 12) + 8 }]}
          >
            <View className="flex-row items-start">
              <Text allowFontScaling={false} className="text-[58px] font-[500] leading-[56px] text-[#050505]">
                Mac
              </Text>
              <Text allowFontScaling={false} className="ml-1 mt-2 text-[18px] font-[500] text-[#141414]">
                Radar
              </Text>
            </View>
            <Text
              allowFontScaling={false}
              className="mt-1 text-[18px] font-[500] leading-[31px] text-[#20222a]"
            >
              Yolda tanış, hayatta buluş.
            </Text>

            <Text
              allowFontScaling={false}
              className="mt-3 text-[11px] leading-[20px] text-[#585f6b]"
            >
              Mac Radar, çevrenizdeki insanları keşfetmenizi, sosyalleşmenizi ve anlık mesajlaşmanızı sağlayan konum tabanlı bir sosyal platformdur.
            </Text>

            <View className="mt-3.5 flex-row gap-2.5">
              <FeatureChip icon="map-pin" label="Keşif" />
              <FeatureChip icon="message-circle" label="Sohbet" />
              <FeatureChip icon="shield" label="Güven" />
            </View>

            <View className="mt-4 gap-2.5">
              <ActionButton
                disabled={isBusy}
                label="Giriş Yap"
                onPress={onOpenLogin}
                variant="primary"
              />
              <ActionButton
                disabled={isBusy}
                label="Kayıt Ol"
                onPress={onOpenRegister}
                variant="secondary"
              />
            </View>

            <View className="mb-1 mt-4 flex-row items-center">
              <View className="h-px flex-1 bg-[#e7edf4]" />
              <Text
                allowFontScaling={false}
                className="mx-4 text-[10px] font-[600] uppercase tracking-[1.8px] text-[#98a1af]"
              >
                veya
              </Text>
              <View className="h-px flex-1 bg-[#e7edf4]" />
            </View>

            <View className="mt-2 flex-row gap-3">
              <SocialButton
                disabled={isBusy}
                fullWidth={true}
                isLoading={socialLoading === 'google'}
                onPress={() => onSocial('google')}
                provider="google"
              />
            </View>

            <Text
              allowFontScaling={false}
              className="mt-3.5 text-center text-[10px] leading-[14px] text-[#9ca3af]"
            >
              Devam ederek Kullanım Koşullarını ve Gizlilik Politikasını kabul etmiş olursunuz.
            </Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}
