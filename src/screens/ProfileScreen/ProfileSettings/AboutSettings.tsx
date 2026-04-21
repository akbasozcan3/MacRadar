import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import FeatherIcon from '../../../components/FeatherIcon/FeatherIcon';
import IosSpinner from '../../../components/IosSpinner/IosSpinner';
import IosTitleHeader from '../../../components/Headers/IosTitleHeader';
import { isApiRequestError } from '../../../services/apiClient';
import { fetchAppOverview } from '../../../services/authService';
import { Text } from '../../../theme/typography';
import type { AppOverview } from '../../../types/AuthTypes/AuthTypes';

type AboutSettingsProps = {
  contentBottomInset?: number;
  onBack?: () => void;
  safeBottom?: number;
  safeTop?: number;
};

const EMPTY_OVERVIEW: AppOverview = {
  activePostsCount: 0,
  membersCount: 0,
  routesCount: 0,
};

function formatCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace('.0', '')}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace('.0', '')}K`;
  }
  return String(value);
}

export default function AboutSettings({
  contentBottomInset = 0,
  onBack,
  safeBottom = 0,
  safeTop = 0,
}: AboutSettingsProps) {
  const [overview, setOverview] = useState<AppOverview>(EMPTY_OVERVIEW);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const footerInset = Math.max(contentBottomInset, safeBottom + 90);
  const enterAnimation = useRef(new Animated.Value(0)).current;
  const requestIdRef = useRef(0);
  const scrollContentStyle = useMemo(
    () => ({ paddingBottom: footerInset, paddingTop: 10 }),
    [footerInset],
  );

  useEffect(() => {
    enterAnimation.setValue(0);
    Animated.spring(enterAnimation, {
      damping: 20,
      mass: 0.8,
      stiffness: 220,
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [enterAnimation]);

  const animatedStyle = useMemo(
    () => ({
      opacity: enterAnimation,
      transform: [
        {
          translateY: enterAnimation.interpolate({
            inputRange: [0, 1],
            outputRange: [10, 0],
          }),
        },
      ],
    }),
    [enterAnimation],
  );

  const loadOverview = useCallback(async (mode: 'initial' | 'refresh') => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (mode === 'initial') {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setErrorMessage(null);

    try {
      const response = await fetchAppOverview();
      if (requestId !== requestIdRef.current) {
        return;
      }
      setOverview(response);
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setErrorMessage(
        isApiRequestError(error)
          ? error.message
          : 'Uygulama ozeti yuklenemedi.',
      );
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    loadOverview('initial').catch(() => {
      return;
    });
  }, [loadOverview]);

  return (
    <SafeAreaView edges={['left', 'right']} className="flex-1 bg-[#f2f2f7]">
      <IosTitleHeader onBack={onBack} safeTop={safeTop} title="Hakkında" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={scrollContentStyle}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View className="px-4" style={animatedStyle}>
          <View className="rounded-[16px] border border-[#e6e9f0] bg-white px-3 py-3">
            <Text className="text-[13px] text-[#1f2530]">MacRadar</Text>
            <Text className="mt-1 text-[11px] leading-[16px] text-[#6b7382]">
              Canlı konum, topluluk ve yolculuk deneyimi için optimize edilmiş sosyal sürüş platformu.
            </Text>
          </View>

          <View className="mt-3 rounded-[16px] border border-[#e6e9f0] bg-white px-3 py-3">
            <Text className="mb-2 text-[13px] text-[#1f2530]">Platform Özeti</Text>
            {isLoading ? (
              <View className="flex-row items-center">
                <IosSpinner color="#ff5a16" size="small" />
                <Text className="ml-2 text-[12px] text-[#6b7382]">Backend verisi çekiliyor...</Text>
              </View>
            ) : (
              <>
                {errorMessage ? (
                  <Text className="mb-2 text-[12px] text-rose-600">{errorMessage}</Text>
                ) : null}

                <View className="flex-row items-center justify-between rounded-[12px] bg-[#f8f9fc] px-3 py-2.5">
                  <Text className="text-[12px] text-[#2a3342]">Toplam Üye</Text>
                  <Text className="text-[13px] text-[#161b24]">{formatCount(overview.membersCount)}</Text>
                </View>
                <View className="mt-2 flex-row items-center justify-between rounded-[12px] bg-[#f8f9fc] px-3 py-2.5">
                  <Text className="text-[12px] text-[#2a3342]">Aktif Gönderi</Text>
                  <Text className="text-[13px] text-[#161b24]">
                    {formatCount(overview.activePostsCount)}
                  </Text>
                </View>
                <View className="mt-2 flex-row items-center justify-between rounded-[12px] bg-[#f8f9fc] px-3 py-2.5">
                  <Text className="text-[12px] text-[#2a3342]">Kayıtlı Rota</Text>
                  <Text className="text-[13px] text-[#161b24]">{formatCount(overview.routesCount)}</Text>
                </View>
              </>
            )}
          </View>

          <View className="mt-3 flex-row items-start rounded-[12px] border border-[#e3e8f1] bg-[#ecf2fa] px-3 py-3">
            <View className="mr-2 mt-[1px] h-4 w-4 items-center justify-center rounded-full bg-[#ffefe6]">
              <FeatherIcon color="#ff6a1b" name="shield" size={10} />
            </View>
            <Text className="flex-1 text-[11px] leading-[16px] text-[#5f6b7b]">
            Mac Radar deneyiminiz, hız, güvenlik ve akıcı kullanım odağında sürekli geliştirilmektedir.            </Text>
          </View>

          <Pressable
            className="mt-3 flex-row items-center rounded-[12px] border border-[#e6e9f0] bg-white px-3 py-3"
            disabled={isRefreshing}
            onPress={() => {
              loadOverview('refresh').catch(() => {
                return;
              });
            }}
            style={({ pressed }) =>
              pressed ? { backgroundColor: '#f8fafd' } : null
            }
          >
            <View className="h-7 w-7 items-center justify-center rounded-full bg-[#f3f6fb]">
              <FeatherIcon color="#546074" name="refresh-cw" size={14} />
            </View>
            <Text className="ml-3 text-[13px] text-[#2a3342]">
              {isRefreshing ? 'Platform Özetini Yeniliyor...' : 'Platform Özetini Yenile'}
            </Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}
