import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Pressable,
  ScrollView,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import FeatherIcon from '../../../components/FeatherIcon/FeatherIcon';
import IosTitleHeader from '../../../components/Headers/IosTitleHeader';
import IosSpinner from '../../../components/IosSpinner/IosSpinner';
import { isApiRequestError } from '../../../services/apiClient';
import {
  acceptFollowRequest,
  fetchFollowRequests,
  fetchProfilePrivacy,
  rejectFollowRequest,
  updateProfilePrivacy,
} from '../../../services/authService';
import { Text } from '../../../theme/typography';
import type {
  FollowRequestItem,
  PrivacySettings as PrivacyState,
  UserProfile,
} from '../../../types/AuthTypes/AuthTypes';

type PrivacySettingsProps = {
  contentBottomInset?: number;
  onBack?: () => void;
  onProfileChange?: (profile: UserProfile) => void;
  profile: UserProfile;
  safeBottom?: number;
  safeTop?: number;
};

type PrivacyRowProps = {
  description: string;
  disabled?: boolean;
  icon: string;
  isEnabled: boolean;
  isLast?: boolean;
  isPending?: boolean;
  onToggle: (nextValue: boolean) => void;
  title: string;
};

const PrivacyRow = React.memo(function PrivacyRow({
  description,
  disabled = false,
  icon,
  isEnabled,
  isLast,
  isPending = false,
  onToggle,
  title,
}: PrivacyRowProps) {
  return (
    <>
      <View className="min-h-[78px] flex-row items-center justify-between bg-white px-4 py-[12px]">
        <View className="mr-3 flex-1 flex-row items-start">
          <View className="h-8 w-8 items-center justify-center rounded-full bg-[#f3f5fa]">
            <FeatherIcon color="#2f3542" name={icon} size={15} />
          </View>
          <View className="ml-3 flex-1 pr-1">
            <Text className="text-[14px] text-[#1f2530]">{title}</Text>
            <Text className="mt-[3px] text-[11px] leading-[15px] text-[#7f8694]">
              {description}
            </Text>
          </View>
        </View>

        <View className="min-w-[52px] items-end">
          {isPending ? (
            <IosSpinner size="small" />
          ) : (
            <Switch
              disabled={disabled}
              ios_backgroundColor="#e4e5ea"
              onValueChange={onToggle}
              thumbColor="#ffffff"
              trackColor={{ false: '#e4e5ea', true: '#ff7a3a' }}
              value={isEnabled}
            />
          )}
        </View>
      </View>
      {!isLast ? <View className="h-px bg-[#eceff5]" /> : null}
    </>
  );
});

export default function PrivacySettings({
  contentBottomInset = 0,
  onBack,
  onProfileChange,
  profile,
  safeBottom = 0,
  safeTop = 0,
}: PrivacySettingsProps) {
  const fallbackSettings = useMemo<PrivacyState>(
    () => ({
      isMapVisible: profile.privacy?.isMapVisible ?? true,
      isPrivateAccount: profile.privacy?.isPrivateAccount ?? false,
    }),
    [profile.privacy?.isMapVisible, profile.privacy?.isPrivateAccount],
  );
  const [settings, setSettings] = useState<PrivacyState>(fallbackSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingFollowRequests, setIsLoadingFollowRequests] = useState(true);
  const [followRequests, setFollowRequests] = useState<FollowRequestItem[]>([]);
  const [pendingFollowRequestId, setPendingFollowRequestId] = useState<string | null>(
    null,
  );
  const [pendingField, setPendingField] = useState<
    'isMapVisible' | 'isPrivateAccount' | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const footerInset = Math.max(contentBottomInset, safeBottom + 90);
  const enterAnimation = useRef(new Animated.Value(0)).current;
  const privacyRequestIdRef = useRef(0);
  const followRequestsRequestIdRef = useRef(0);
  const isBusy =
    isLoading || isLoadingFollowRequests || pendingField !== null || pendingFollowRequestId !== null;
  const scrollContentStyle = useMemo(
    () => ({ paddingBottom: footerInset }),
    [footerInset],
  );

  const syncProfilePrivacy = useCallback(
    (nextSettings: PrivacyState) => {
      onProfileChange?.({
        ...profile,
        privacy: nextSettings,
      });
    },
    [onProfileChange, profile],
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

  useEffect(() => {
    setSettings(fallbackSettings);
  }, [fallbackSettings]);

  const loadPrivacySettings = useCallback(async () => {
    privacyRequestIdRef.current += 1;
    const requestId = privacyRequestIdRef.current;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetchProfilePrivacy();
      if (privacyRequestIdRef.current !== requestId) {
        return null;
      }

      const nextSettings: PrivacyState = {
        isMapVisible: response.isMapVisible,
        isPrivateAccount: response.isPrivateAccount,
      };
      setSettings(nextSettings);
      if (
        fallbackSettings.isMapVisible !== nextSettings.isMapVisible ||
        fallbackSettings.isPrivateAccount !== nextSettings.isPrivateAccount
      ) {
        syncProfilePrivacy(nextSettings);
      }
      return nextSettings;
    } catch (error) {
      if (privacyRequestIdRef.current !== requestId) {
        return null;
      }
      setErrorMessage(
        isApiRequestError(error)
          ? error.message
          : 'Gizlilik ayarlari su an yuklenemedi.',
      );
      return null;
    } finally {
      if (privacyRequestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [fallbackSettings, syncProfilePrivacy]);

  const loadFollowRequestList = useCallback(
    async (isPrivateAccount: boolean, force = false) => {
      followRequestsRequestIdRef.current += 1;
      const requestId = followRequestsRequestIdRef.current;

      if (!isPrivateAccount) {
        setFollowRequests([]);
        setPendingFollowRequestId(null);
        setIsLoadingFollowRequests(false);
        return;
      }

      setIsLoadingFollowRequests(true);

      try {
        const response = await fetchFollowRequests({ force });
        if (followRequestsRequestIdRef.current !== requestId) {
          return;
        }
        setFollowRequests(response.requests);
      } catch (error) {
        if (followRequestsRequestIdRef.current !== requestId) {
          return;
        }
        setErrorMessage(
          isApiRequestError(error)
            ? error.message
            : 'Takip istekleri yuklenemedi.',
        );
      } finally {
        if (followRequestsRequestIdRef.current === requestId) {
          setIsLoadingFollowRequests(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    loadPrivacySettings().catch(() => {
      return;
    });
  }, [loadPrivacySettings, profile.id]);

  useEffect(() => {
    loadFollowRequestList(settings.isPrivateAccount).catch(() => {
      return;
    });
  }, [loadFollowRequestList, profile.id, settings.isPrivateAccount]);

  const handleRefresh = useCallback(() => {
    setErrorMessage(null);
    loadPrivacySettings()
      .then(nextSettings => {
        const resolvedSettings = nextSettings ?? settings;
        return loadFollowRequestList(resolvedSettings.isPrivateAccount, true);
      })
      .catch(() => {
        return;
      });
  }, [loadFollowRequestList, loadPrivacySettings, settings]);

  async function handleToggle(
    field: 'isMapVisible' | 'isPrivateAccount',
    nextValue: boolean,
  ) {
    if (isBusy) {
      return;
    }

    const previous = settings;
    const optimistic = { ...settings, [field]: nextValue };
    setSettings(optimistic);
    if (field === 'isPrivateAccount' && nextValue === false) {
      setFollowRequests([]);
      setPendingFollowRequestId(null);
    }
    syncProfilePrivacy(optimistic);
    setPendingField(field);
    setErrorMessage(null);

    try {
      const payload =
        field === 'isMapVisible'
          ? { isMapVisible: nextValue }
          : { isPrivateAccount: nextValue };
      const response = await updateProfilePrivacy(payload);
      const confirmed: PrivacyState = {
        isMapVisible: response.isMapVisible,
        isPrivateAccount: response.isPrivateAccount,
      };
      setSettings(confirmed);
      syncProfilePrivacy(confirmed);
    } catch (error) {
      setSettings(previous);
      syncProfilePrivacy(previous);
      setErrorMessage(
        isApiRequestError(error)
          ? error.message
          : 'Gizlilik ayari kaydedilemedi.',
      );
    } finally {
      setPendingField(null);
    }
  }

  async function handleFollowRequestDecision(
    requesterId: string,
    accept: boolean,
  ) {
    if (pendingFollowRequestId || requesterId.trim().length === 0) {
      return;
    }

    setPendingFollowRequestId(requesterId);
    setErrorMessage(null);
    try {
      if (accept) {
        await acceptFollowRequest(requesterId);
      } else {
        await rejectFollowRequest(requesterId);
      }
      setFollowRequests(previous =>
        previous.filter(request => request.id !== requesterId),
      );

      if (accept) {
        onProfileChange?.({
          ...profile,
          stats: {
            ...profile.stats,
            followersCount: profile.stats.followersCount + 1,
          },
        });
      }
    } catch (error) {
      setErrorMessage(
        isApiRequestError(error)
          ? error.message
          : 'Takip istegi islemi tamamlanamadi.',
      );
    } finally {
      setPendingFollowRequestId(null);
    }
  }

  return (
    <SafeAreaView edges={['left', 'right']} className="flex-1 bg-[#f2f2f7]">
      <IosTitleHeader onBack={onBack} safeTop={safeTop} title="Gizlilik Ayarlari" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={scrollContentStyle}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View className="px-4 pt-[10px]" style={animatedStyle}>
          <View className="overflow-hidden rounded-[16px] border border-[#e6e9f0] bg-white">
            <PrivacyRow
              description="Hesabin gizli oldugunda, sadece onayladigin takipciler gonderilerini gorebilir."
              disabled={isBusy}
              icon="lock"
              isEnabled={settings.isPrivateAccount}
              isPending={pendingField === 'isPrivateAccount'}
              onToggle={nextValue => {
                handleToggle('isPrivateAccount', nextValue).catch(() => {
                  return;
                });
              }}
              title="Gizli Hesap"
            />
            <PrivacyRow
              description="Kapatildiginda kullanicilar seni haritada goremez. Degisiklik backend'e aninda yazilir."
              disabled={isBusy}
              icon="map-pin"
              isEnabled={settings.isMapVisible}
              isLast={true}
              isPending={pendingField === 'isMapVisible'}
              onToggle={nextValue => {
                handleToggle('isMapVisible', nextValue).catch(() => {
                  return;
                });
              }}
              title="Haritada Gorunurluk"
            />
          </View>

          {errorMessage ? (
            <View className="mt-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2.5">
              <Text className="text-[12px] text-rose-600">{errorMessage}</Text>
            </View>
          ) : null}

          <View className="mt-3 flex-row items-start rounded-[12px] border border-[#e3e8f1] bg-[#ecf2fa] px-3 py-3">
            <View className="mr-2 mt-[1px] h-4 w-4 items-center justify-center rounded-full bg-[#ffefe6]">
              <FeatherIcon color="#ff6a1b" name="info" size={10} />
            </View>
            <View className="flex-1">
              <Text className="text-[11px] leading-[16px] text-[#5f6b7b]">
                {settings.isPrivateAccount
                  ? 'Hesabin gizli oldugu icin gonderilerin yalnizca takipcilerin tarafindan goruntulenebilir.'
                  : 'Gizlilik degisiklikleri backend tarafinda hemen uygulanir.'}
              </Text>
            </View>
          </View>

          {settings.isPrivateAccount ? (
            <View className="mt-3 overflow-hidden rounded-[16px] border border-[#e6e9f0] bg-white">
              <View className="flex-row items-center justify-between border-b border-[#edf0f5] px-4 py-3">
                <Text className="text-[13px] text-[#1f2530]">
                  Takip Istekleri
                </Text>
                <Text className="text-[11px] text-[#7f8694]">
                  {followRequests.length}
                </Text>
              </View>

              {isLoadingFollowRequests ? (
                <View className="flex-row items-center justify-center py-4">
                  <IosSpinner size="small" />
                  <Text className="ml-2 text-[12px] text-[#6f7685]">
                    Istekler yukleniyor...
                  </Text>
                </View>
              ) : followRequests.length === 0 ? (
                <View className="px-4 py-4">
                  <Text className="text-[12px] text-[#6f7685]">
                    Bekleyen takip istegi yok.
                  </Text>
                </View>
              ) : (
                followRequests.map((request, index) => {
                  const isActionPending = pendingFollowRequestId === request.id;
                  return (
                    <View key={request.id}>
                      <View className="flex-row items-center px-4 py-3">
                        <View className="h-9 w-9 items-center justify-center rounded-full bg-[#d9dee7]">
                          {request.avatarUrl ? (
                            <Image
                              className="h-full w-full rounded-full"
                              resizeMode="cover"
                              source={{ uri: request.avatarUrl }}
                            />
                          ) : (
                            <Text className="text-[11px] text-[#4e5768]">
                              {(request.fullName || request.username)
                                .trim()
                                .slice(0, 2)
                                .toUpperCase()}
                            </Text>
                          )}
                        </View>
                        <View className="ml-3 flex-1">
                          <Text className="text-[13px] text-[#1f2530]">
                            {request.fullName || request.username}
                          </Text>
                          <Text className="text-[11px] text-[#7f8694]">
                            @{request.username}
                          </Text>
                        </View>

                        <View className="flex-row items-center gap-2">
                          <Pressable
                            className={`rounded-full px-3 py-1.5 ${
                              isActionPending ? 'bg-[#16a34a]/70' : 'bg-[#16a34a]'
                            }`}
                            disabled={isActionPending}
                            onPress={() => {
                              handleFollowRequestDecision(request.id, true).catch(() => {
                                return;
                              });
                            }}
                          >
                            <Text className="text-[10px] text-white">
                              {isActionPending ? '...' : 'Onayla'}
                            </Text>
                          </Pressable>
                          <Pressable
                            className={`rounded-full border px-3 py-1.5 ${
                              isActionPending
                                ? 'border-[#d2d7e1] bg-[#eef1f6]'
                                : 'border-[#d2d7e1] bg-[#f6f7fa]'
                            }`}
                            disabled={isActionPending}
                            onPress={() => {
                              handleFollowRequestDecision(request.id, false).catch(() => {
                                return;
                              });
                            }}
                          >
                            <Text className="text-[10px] text-[#5e6778]">
                              Reddet
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                      {index < followRequests.length - 1 ? (
                        <View className="h-px bg-[#edf0f5]" />
                      ) : null}
                    </View>
                  );
                })
              )}
            </View>
          ) : null}

          {isLoading ? (
            <View className="mt-3 flex-row items-center justify-center rounded-[12px] border border-[#e6e9f0] bg-white py-3">
              <IosSpinner size="small" />
              <Text className="ml-2 text-[12px] text-[#6f7685]">
                Ayarlar yukleniyor...
              </Text>
            </View>
          ) : null}

          <Pressable
            className="mt-3 flex-row items-center rounded-[12px] border border-[#e6e9f0] bg-white px-3 py-3"
            disabled={isLoading || isLoadingFollowRequests}
            onPress={() => {
              handleRefresh();
            }}
            style={({ pressed }) =>
              pressed ? { backgroundColor: '#f8fafd' } : null
            }
          >
            <View className="h-7 w-7 items-center justify-center rounded-full bg-[#f3f6fb]">
              <FeatherIcon color="#546074" name="refresh-cw" size={14} />
            </View>
            <Text className="ml-3 text-[13px] text-[#2a3342]">
              Gizlilik Ayarlarini Yenile
            </Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}
