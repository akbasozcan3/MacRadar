import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import FeatherIcon from '../../../components/FeatherIcon/FeatherIcon';
import IosSpinner from '../../../components/IosSpinner/IosSpinner';
import IosTitleHeader from '../../../components/Headers/IosTitleHeader';
import { isApiRequestError } from '../../../services/apiClient';
import { fetchProfileHelp } from '../../../services/authService';
import { Text } from '../../../theme/typography';
import type { ProfileHelpItem } from '../../../types/AuthTypes/AuthTypes';

type HelpSettingsProps = {
  contentBottomInset?: number;
  onBack?: () => void;
  safeBottom?: number;
  safeTop?: number;
};

const HelpRow = React.memo(function HelpRow({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <View className="mb-2 rounded-[12px] border border-[#e7ebf3] bg-[#f8f9fc] px-3 py-2.5">
      <Text className="text-[12px] text-[#1f2530]">{title}</Text>
      <Text className="mt-1 text-[11px] leading-[16px] text-[#677186]">{description}</Text>
    </View>
  );
});

const FALLBACK_HELP_ITEMS: ProfileHelpItem[] = [
  {
    title: 'Gizli hesapta takip istekleri nerede?',
    description:
      'Profil ana sayfasindaki Takip Istekleri kartindan tum bekleyen istekleri yonetebilirsin.',
  },
  {
    title: 'Dil degisikligi kaydolmadi',
    description: 'Dil secimi backend tarafina yazilir. Baglanti sorunu varsa tekrar dene.',
  },
  {
    title: 'Sifre degistiremiyorum',
    description: 'Yeni sifren 10-12 karakter arasinda olmali ve mevcut sifre dogru girilmelidir.',
  },
  {
    title: 'Bildirimler gelmiyor',
    description: 'Bildirim ayarlarini acik tut ve cihaz izinlerini kontrol et.',
  },
];

function formatUpdatedAt(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Bilinmiyor';
  }

  return parsed.toLocaleString('tr-TR', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  });
}

export default function HelpSettings({
  contentBottomInset = 0,
  onBack,
  safeBottom = 0,
  safeTop = 0,
}: HelpSettingsProps) {
  const [helpItems, setHelpItems] = useState<ProfileHelpItem[]>(FALLBACK_HELP_ITEMS);
  const [supportEmail, setSupportEmail] = useState('support@macradar.app');
  const [supportHours, setSupportHours] = useState('Hafta ici 09:00-18:00');
  const [updatedAt, setUpdatedAt] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const footerInset = Math.max(contentBottomInset, safeBottom + 90);
  const enterAnimation = useRef(new Animated.Value(0)).current;
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

  const loadHelp = useCallback(async (mode: 'initial' | 'refresh') => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (mode === 'initial') {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setErrorMessage(null);

    try {
      const response = await fetchProfileHelp();
      if (requestId !== requestIdRef.current) {
        return;
      }

      setHelpItems(
        response.items.length > 0 ? response.items : FALLBACK_HELP_ITEMS,
      );
      setSupportEmail(response.supportEmail.trim() || 'support@macradar.app');
      setSupportHours(response.supportHours.trim() || 'Hafta ici 09:00-18:00');
      setUpdatedAt(response.updatedAt);
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      setErrorMessage(
        isApiRequestError(error)
          ? error.message
          : 'Yardım İçerigi backendden Alınamadı.',
      );
      setHelpItems(FALLBACK_HELP_ITEMS);
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    loadHelp('initial').catch(() => {
      return;
    });
  }, [loadHelp]);

  return (
    <SafeAreaView edges={['left', 'right']} className="flex-1 bg-[#f2f2f7]">
      <IosTitleHeader onBack={onBack} safeTop={safeTop} title="Yardım" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={scrollContentStyle}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View className="px-4" style={animatedStyle}>
          <View className="mb-3 flex-row items-start rounded-[12px] border border-[#e3e8f1] bg-[#ecf2fa] px-3 py-3">
            <View className="mr-2 mt-[1px] h-4 w-4 items-center justify-center rounded-full bg-[#ffefe6]">
              <FeatherIcon color="#ff6a1b" name="life-buoy" size={10} />
            </View>
            <Text className="flex-1 text-[11px] leading-[16px] text-[#5f6b7b]">
              Ayar degisikliklerinde sorun yasarsan once internet baglantini ve oturumunu kontrol et.
            </Text>
          </View>

          {errorMessage ? (
            <View className="mb-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2.5">
              <Text className="text-[12px] text-rose-600">{errorMessage}</Text>
            </View>
          ) : null}

          <View className="rounded-[16px] border border-[#e6e9f0] bg-white px-3 py-3">
            <Text className="mb-2 text-[13px] text-[#1f2530]">Şık Sorulanlar</Text>
            {isLoading ? (
              <View className="flex-row items-center pb-2">
                <IosSpinner color="#ff5a16" size="small" />
                <Text className="ml-2 text-[12px] text-[#6b7382]">
Yardım içerikleri yükleniyor...
                </Text>
              </View>
            ) : (
              helpItems.map(item => (
                <HelpRow
                  description={item.description}
                  key={`${item.title}-${item.description}`}
                  title={item.title}
                />
              ))
            )}
          </View>

          <View className="mt-3 rounded-[16px] border border-[#e6e9f0] bg-white px-3 py-3">
            <Text className="text-[13px] text-[#1f2530]">Destek</Text>
            <Text className="mt-2 text-[11px] text-[#667186]">
              E-posta: {supportEmail}
            </Text>
            <Text className="mt-1 text-[11px] text-[#667186]">
              Saatler: {supportHours}
            </Text>
            <Text className="mt-1 text-[10px] text-[#9aa2b1]">
              Son guncelleme: {formatUpdatedAt(updatedAt)}
            </Text>
          </View>

          <Pressable
            className="mt-3 flex-row items-center rounded-[12px] border border-[#e6e9f0] bg-white px-3 py-3"
            disabled={isRefreshing}
            onPress={() => {
              loadHelp('refresh').catch(() => {
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
              {isRefreshing ? 'Yardım İçerigi Yenileniyor...' : 'Yardım İçerigini Yenile'}
            </Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}
