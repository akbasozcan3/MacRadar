import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import FeatherIcon from '../../../components/FeatherIcon/FeatherIcon';
import IosTitleHeader from '../../../components/Headers/IosTitleHeader';
import { isApiRequestError } from '../../../services/apiClient';
import {
  confirmDeleteMyAccount,
  fetchProfileAppSettings,
  requestDeleteAccountCode,
} from '../../../services/authService';
import { Text } from '../../../theme/typography';
import type { UserProfile } from '../../../types/AuthTypes/AuthTypes';
import { resolveProfileAvatarUrl } from '../../../utils/profileAvatar';
import { subscribeAppLanguage, translateText } from '../../../i18n/runtime';
import AboutSettings from './AboutSettings';
import AccountSettings from './AccountSettings';
import AppPreferencesSettings, {
  type AppPreferencesMode,
} from './AppPreferencesSettings';
import BlockedUsersSettings from './BlockedUsersSettings';
import HelpSettings from './HelpSettings';
import PrivacySettings from './PrivacySettings';

type SettingsRowKey =
  | 'about'
  | 'account'
  | 'blocked'
  | 'help'
  | 'language'
  | 'notifications'
  | 'profile'
  | 'privacy';

type ScreenState = 'root' | SettingsRowKey;

type ProfileSettingsProps = {
  contentBottomInset?: number;
  initialEntryScreen?: ScreenState;
  onBack?: () => void;
  onEditProfile?: () => void;
  onForgotPassword?: (email: string) => void;
  onDeleteAccount?: () => Promise<void>;
  onLogout?: () => void;
  onProfileChange?: (profile: UserProfile) => void;
  profile: UserProfile;
  safeBottom?: number;
  safeTop?: number;
};

type SettingsRow = {
  icon: string;
  key: SettingsRowKey;
  subtitle: string;
  title: string;
};
type SettingsSyncStatus = 'error' | 'synced' | 'syncing';

type SettingRowProps = {
  icon: string;
  isLast?: boolean;
  onPress?: () => void;
  subtitle: string;
  title: string;
};

const SETTINGS_ROWS: SettingsRow[] = [
  {
    key: 'account',
    icon: 'user',
    subtitle: 'Kisisel bilgiler ve sifre',
    title: 'Hesap Ayarlari',
  },
  {
    key: 'privacy',
    icon: 'lock',
    subtitle: 'Gizli hesap, harita gorunurlugu',
    title: 'Gizlilik',
  },
  {
    key: 'blocked',
    icon: 'shield',
    subtitle: 'Engellenen hesaplar',
    title: 'Engellenen Kullanicilar',
  },
  {
    key: 'notifications',
    icon: 'bell',
    subtitle: 'Takip, mesaj ve begeni bildirimleri',
    title: 'Bildirimler',
  },
  {
    key: 'profile',
    icon: 'user-check',
    subtitle: 'Cinsiyet ve profil etiketleri',
    title: 'Profil',
  },
  {
    key: 'language',
    icon: 'globe',
    subtitle: 'Uygulama dili secimi',
    title: 'Dil',
  },
  {
    key: 'about',
    icon: 'info',
    subtitle: 'Platform ozeti ve surum bilgisi',
    title: 'Hakkında',
  },
  {
    key: 'help',
    icon: 'help-circle',
    subtitle: 'Sik sorulanlar',
    title: 'Yardım',
  },
];

function getInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');
}

function SettingRow({
  icon,
  isLast,
  onPress,
  subtitle,
  title,
}: SettingRowProps) {
  const canPress = typeof onPress === 'function';

  return (
    <>
      <Pressable
        className="flex-row items-center bg-white px-3 py-3"
        disabled={!canPress}
        onPress={onPress}
        style={({ pressed }) =>
          pressed && canPress ? { backgroundColor: '#f6f8fc' } : null
        }
      >
        <View className="h-8 w-8 items-center justify-center rounded-xl border border-[#e6ebf5] bg-[#f3f6fb]">
          <FeatherIcon color="#16202f" name={icon} size={15} />
        </View>

        <View className="ml-3 mr-2 flex-1">
          <Text
            allowFontScaling={false}
            className="text-[13px] font-semibold tracking-[-0.15px] text-[#1f2530]"
          >
            {title}
          </Text>
          <Text
            allowFontScaling={false}
            className="mt-[1px] text-[10.5px] leading-[14px] text-[#7e8797]"
          >
            {subtitle}
          </Text>
        </View>

        <View className="h-7 w-7 items-center justify-center rounded-full bg-[#f3f6fb]">
          <FeatherIcon color="#9aa3b0" name="chevron-right" size={16} />
        </View>
      </Pressable>

      {!isLast ? <View className="ml-[52px] h-px bg-[#eef2f7]" /> : null}
    </>
  );
}

function toAppPreferencesMode(screen: ScreenState): AppPreferencesMode | null {
  if (screen === 'notifications') {
    return 'notifications';
  }
  if (screen === 'profile') {
    return 'profile';
  }
  if (screen === 'language') {
    return 'language';
  }
  return null;
}

export default function ProfileSettings({
  contentBottomInset = 0,
  initialEntryScreen = 'root',
  onBack,
  onEditProfile,
  onForgotPassword,
  onDeleteAccount,
  onLogout,
  onProfileChange,
  profile,
  safeBottom = 0,
  safeTop = 0,
}: ProfileSettingsProps) {
  const [, setI18nBump] = useState(0);
  useEffect(() => {
    return subscribeAppLanguage(() => {
      setI18nBump(value => value + 1);
    });
  }, []);
  const [activeScreen, setActiveScreen] = useState<ScreenState>(() =>
    initialEntryScreen === 'account' ? 'account' : 'root',
  );
  useEffect(() => {
    setActiveScreen(initialEntryScreen === 'account' ? 'account' : 'root');
  }, [initialEntryScreen]);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isDeleteSheetVisible, setIsDeleteSheetVisible] = useState(false);
  const [isSendingDeleteCode, setIsSendingDeleteCode] = useState(false);
  const [deleteCode, setDeleteCode] = useState('');
  const [deleteCodeError, setDeleteCodeError] = useState<string | null>(null);
  const [deleteCodeInfo, setDeleteCodeInfo] = useState<string | null>(null);
  const [deleteCodeExpiresAtMs, setDeleteCodeExpiresAtMs] = useState<number | null>(null);
  const [deleteCodeResendAtMs, setDeleteCodeResendAtMs] = useState<number | null>(null);
  const [deleteCodeNowMs, setDeleteCodeNowMs] = useState(() => Date.now());
  const [settingsSyncStatus, setSettingsSyncStatus] =
    useState<SettingsSyncStatus>('syncing');
  const [settingsSyncLastAtMs, setSettingsSyncLastAtMs] = useState<number | null>(null);
  const rootAnimation = useRef(new Animated.Value(0)).current;
  const settingsSyncRequestIdRef = useRef(0);
  const footerInset = Math.max(contentBottomInset, safeBottom + 150);
  const appPreferencesMode = toAppPreferencesMode(activeScreen);
  const avatarUrl = resolveProfileAvatarUrl(profile);
  const avatarInitials =
    getInitials(profile.fullName.trim()) ||
    getInitials(profile.username.trim()) ||
    'U';
  const privacyLabel =
    profile.privacy?.isPrivateAccount === true
      ? translateText('Gizli Hesap')
      : translateText('Açık Hesap');
  const visibilityLabel =
    profile.privacy?.isMapVisible === false
      ? translateText('Haritada Gizli')
      : translateText('Haritada Görünür');

  const scrollContentStyle = useMemo(
    () => ({ paddingBottom: footerInset, paddingTop: 5 }),
    [footerInset],
  );

  useEffect(() => {
    if (activeScreen !== 'root') {
      return;
    }

    rootAnimation.setValue(0);
    Animated.spring(rootAnimation, {
      damping: 20,
      mass: 0.8,
      stiffness: 220,
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [activeScreen, rootAnimation]);

  const rootAnimatedStyle = useMemo(
    () => ({
      opacity: rootAnimation,
      transform: [
        {
          translateY: rootAnimation.interpolate({
            inputRange: [0, 1],
            outputRange: [10, 0],
          }),
        },
      ],
    }),
    [rootAnimation],
  );
  const deleteCodeRemainingSec =
    deleteCodeExpiresAtMs != null
      ? Math.max(0, Math.ceil((deleteCodeExpiresAtMs - deleteCodeNowMs) / 1000))
      : 0;
  const deleteResendRemainingSec =
    deleteCodeResendAtMs != null
      ? Math.max(0, Math.ceil((deleteCodeResendAtMs - deleteCodeNowMs) / 1000))
      : 0;
  const isDeleteCodeExpired =
    deleteCodeExpiresAtMs != null && deleteCodeRemainingSec === 0;
  const canResendDeleteCode = !isSendingDeleteCode && deleteResendRemainingSec === 0;
  const normalizedDeleteCode = deleteCode.trim();
  const canSubmitDeleteCode =
    normalizedDeleteCode.length === 6 &&
    !isDeleteCodeExpired &&
    !isDeletingAccount &&
    !isSendingDeleteCode;
  const settingsSyncLabel = useMemo(() => {
    if (settingsSyncStatus === 'synced') {
      return translateText('Senkron');
    }
    if (settingsSyncStatus === 'error') {
      return translateText('Hata');
    }
    return translateText('Yenileniyor');
  }, [settingsSyncStatus]);
  const settingsSyncMetaLabel = useMemo(() => {
    if (settingsSyncStatus !== 'synced' || !settingsSyncLastAtMs) {
      return '';
    }
    const diffSec = Math.max(
      0,
      Math.floor((Date.now() - settingsSyncLastAtMs) / 1000),
    );
    if (diffSec < 60) {
      return `${diffSec}s`;
    }
    const diffMin = Math.floor(diffSec / 60);
    return `${diffMin}dk`;
  }, [settingsSyncLastAtMs, settingsSyncStatus]);

  useEffect(() => {
    if (!isDeleteSheetVisible) {
      return;
    }
    const timer = setInterval(() => {
      setDeleteCodeNowMs(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [isDeleteSheetVisible]);

  useEffect(() => {
    if (isDeleteSheetVisible && isDeleteCodeExpired) {
      setDeleteCodeError(previous =>
        previous && previous.trim().length > 0
          ? previous
          : 'Dogrulama kodunun suresi doldu. Lutfen yeni kod isteyin.',
      );
    }
  }, [isDeleteCodeExpired, isDeleteSheetVisible]);

  useEffect(() => {
    if (activeScreen !== 'root') {
      return;
    }
    let active = true;
    let intervalHandle: ReturnType<typeof setInterval> | null = null;
    const runSyncProbe = (force = false) => {
      settingsSyncRequestIdRef.current += 1;
      const requestId = settingsSyncRequestIdRef.current;
      setSettingsSyncStatus(previous =>
        previous === 'synced' ? previous : 'syncing',
      );
      fetchProfileAppSettings({ force })
        .then(() => {
          if (!active || requestId !== settingsSyncRequestIdRef.current) {
            return;
          }
          setSettingsSyncStatus('synced');
          setSettingsSyncLastAtMs(Date.now());
        })
        .catch(error => {
          if (!active || requestId !== settingsSyncRequestIdRef.current) {
            return;
          }
          if (isApiRequestError(error) && error.status === 401) {
            setSettingsSyncStatus('syncing');
            return;
          }
          setSettingsSyncStatus('error');
        });
    };
    runSyncProbe(true);
    intervalHandle = setInterval(() => {
      runSyncProbe(false);
    }, 30_000);
    return () => {
      active = false;
      if (intervalHandle) {
        clearInterval(intervalHandle);
      }
    };
  }, [activeScreen]);

  const runDeleteAccount = async () => {
    if (isDeletingAccount || isSendingDeleteCode) {
      return;
    }
    const normalizedCode = normalizedDeleteCode;
    if (isDeleteCodeExpired) {
      setDeleteCodeError('Dogrulama kodunun suresi doldu. Yeni kod isteyin.');
      return;
    }
    if (normalizedCode.length !== 6) {
      setDeleteCodeError('Silme onayi icin 6 haneli dogrulama kodu girin.');
      return;
    }
    setIsDeletingAccount(true);
    setDeleteCodeError(null);
    try {
      await confirmDeleteMyAccount({ code: normalizedCode });
      setIsDeleteSheetVisible(false);
      if (onDeleteAccount) {
        await onDeleteAccount();
      } else {
        onLogout?.();
      }
    } catch (error) {
      const message =
        isApiRequestError(error) && error.message.trim().length > 0
          ? error.message
          : 'Hesap silinemedi. Lutfen dogrulama kodunu kontrol edip tekrar deneyin.';
      setDeleteCodeError(message);
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const requestDeleteCode = async () => {
    if (isSendingDeleteCode || isDeletingAccount) {
      return;
    }
    setIsSendingDeleteCode(true);
    setDeleteCodeError(null);
    try {
      const response = await requestDeleteAccountCode();
      const targetEmail = response.email?.trim() || profile.email.trim();
      const expiresAt = new Date(response.expiresAt).getTime();
      const resendAt = new Date(response.resendAvailableAt).getTime();
      setDeleteCodeInfo(
        `Kod ${targetEmail} adresine gonderildi. Son gecerlilik: ${new Date(
          Number.isFinite(expiresAt) ? expiresAt : Date.now(),
        ).toLocaleTimeString('tr-TR', {
          hour: '2-digit',
          minute: '2-digit',
        })}`,
      );
      setDeleteCodeExpiresAtMs(Number.isFinite(expiresAt) ? expiresAt : null);
      setDeleteCodeResendAtMs(Number.isFinite(resendAt) ? resendAt : null);
      setDeleteCodeNowMs(Date.now());
    } catch (error) {
      const message =
        isApiRequestError(error) && error.message.trim().length > 0
          ? error.message
          : 'Kod gonderilemedi. Lutfen tekrar deneyin.';
      setDeleteCodeError(message);
    } finally {
      setIsSendingDeleteCode(false);
    }
  };

  const openDeleteSheet = () => {
    if (isDeletingAccount) {
      return;
    }
    setDeleteCode('');
    setDeleteCodeError(null);
    setDeleteCodeInfo(null);
    setDeleteCodeExpiresAtMs(null);
    setDeleteCodeResendAtMs(null);
    setDeleteCodeNowMs(Date.now());
    setIsDeleteSheetVisible(true);
    requestDeleteCode().catch(() => {
      return;
    });
  };

  if (activeScreen === 'account') {
    return (
      <AccountSettings
        contentBottomInset={contentBottomInset}
        onBack={() => {
          setActiveScreen('root');
        }}
        onForgotPassword={onForgotPassword}
        onProfileChange={onProfileChange}
        profile={profile}
        safeBottom={safeBottom}
        safeTop={safeTop}
      />
    );
  }

  if (activeScreen === 'privacy') {
    return (
      <PrivacySettings
        contentBottomInset={contentBottomInset}
        onBack={() => {
          setActiveScreen('root');
        }}
        onProfileChange={onProfileChange}
        profile={profile}
        safeBottom={safeBottom}
        safeTop={safeTop}
      />
    );
  }

  if (activeScreen === 'blocked') {
    return (
      <BlockedUsersSettings
        contentBottomInset={contentBottomInset}
        onBack={() => {
          setActiveScreen('root');
        }}
        safeBottom={safeBottom}
        safeTop={safeTop}
      />
    );
  }

  if (appPreferencesMode) {
    return (
      <AppPreferencesSettings
        contentBottomInset={contentBottomInset}
        mode={appPreferencesMode}
        onBack={() => {
          setActiveScreen('root');
        }}
        safeBottom={safeBottom}
        safeTop={safeTop}
      />
    );
  }

  if (activeScreen === 'about') {
    return (
      <AboutSettings
        contentBottomInset={contentBottomInset}
        onBack={() => {
          setActiveScreen('root');
        }}
        safeBottom={safeBottom}
        safeTop={safeTop}
      />
    );
  }

  if (activeScreen === 'help') {
    return (
      <HelpSettings
        contentBottomInset={contentBottomInset}
        onBack={() => {
          setActiveScreen('root');
        }}
        safeBottom={safeBottom}
        safeTop={safeTop}
      />
    );
  }

  return (
    <SafeAreaView edges={['left', 'right']} className="flex-1 bg-[#f4f6fb]">
      <IosTitleHeader
        onBack={onBack}
        onRightPress={onEditProfile}
        rightIcon="edit-2"
        safeTop={safeTop}
        title={translateText('Ayarlar')}
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={scrollContentStyle}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View className="px-4 pt-2" style={rootAnimatedStyle}>
          <View className="mb-4 rounded-[22px] border border-[#e3e8f2] bg-white px-5 py-5">
            <View className="flex-row items-center">
              <View className="rounded-full border-2 border-[#e8ecf4] p-[2px]">
                {avatarUrl.length > 0 ? (
                  <Image
                    source={{ uri: avatarUrl }}
                    className="h-[72px] w-[72px] rounded-full"
                  />
                ) : (
                  <View className="h-[72px] w-[72px] items-center justify-center rounded-full bg-[#eef1f6]">
                    <Text
                      allowFontScaling={false}
                      className="text-[22px] font-semibold tracking-[0.4px] text-[#6b7280]"
                    >
                      {avatarInitials}
                    </Text>
                  </View>
                )}
              </View>

              <View className="ml-4 flex-1 min-w-0">
                <Text
                  allowFontScaling={false}
                  className="text-[18px] font-bold tracking-[-0.3px] text-[#1f2530]"
                  numberOfLines={2}
                >
                  {profile.fullName.trim() || profile.username}
                </Text>
                <Text
                  allowFontScaling={false}
                  className="mt-1 text-[13px] font-medium text-[#5c6575]"
                  numberOfLines={1}
                >
                  @{profile.username}
                </Text>
              </View>
            </View>

            <View className="mt-4 flex-row flex-wrap gap-2">
              <View className="rounded-full border border-[#e0e6f0] bg-[#f1f4f9] px-3 py-1.5">
                <Text allowFontScaling={false} className="text-[11px] font-semibold text-[#4a5568]">
                  {privacyLabel}
                </Text>
              </View>
              <View className="rounded-full border border-[#e0e6f0] bg-[#f1f4f9] px-3 py-1.5">
                <Text allowFontScaling={false} className="text-[11px] font-semibold text-[#4a5568]">
                  {visibilityLabel}
                </Text>
              </View>
              <View
                className="flex-row items-center rounded-full border px-3 py-1.5"
                style={
                  settingsSyncStatus === 'synced'
                    ? { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0' }
                    : settingsSyncStatus === 'error'
                      ? { backgroundColor: '#fff1f2', borderColor: '#fecdd3' }
                      : { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' }
                }
              >
                <FeatherIcon
                  color={
                    settingsSyncStatus === 'synced'
                      ? '#047857'
                      : settingsSyncStatus === 'error'
                        ? '#be123c'
                        : '#1d4ed8'
                  }
                  name={
                    settingsSyncStatus === 'synced'
                      ? 'check-circle'
                      : settingsSyncStatus === 'error'
                        ? 'alert-circle'
                        : 'refresh-cw'
                  }
                  size={11}
                />
                <Text
                  allowFontScaling={false}
                  className="ml-1 text-[11px] font-semibold"
                  style={
                    settingsSyncStatus === 'synced'
                      ? { color: '#047857' }
                      : settingsSyncStatus === 'error'
                        ? { color: '#be123c' }
                        : { color: '#1d4ed8' }
                  }
                >
                  {settingsSyncMetaLabel.length > 0
                    ? `${settingsSyncLabel} · ${settingsSyncMetaLabel}`
                    : settingsSyncLabel}
                </Text>
              </View>
            </View>
          </View>

          <View className="overflow-hidden rounded-[20px] border border-[#e3e8f2] bg-white">
            {SETTINGS_ROWS.map((item, index) => (
              <SettingRow
                key={item.key}
                icon={item.icon}
                isLast={index === SETTINGS_ROWS.length - 1}
                onPress={() => {
                  setActiveScreen(item.key);
                }}
                subtitle={translateText(item.subtitle)}
                title={translateText(item.title)}
              />
            ))}
          </View>

          <Pressable
            className="mt-3 flex-row items-center justify-between rounded-[16px] border border-[#f4d9dc] bg-white px-3 py-3"
            disabled={!onLogout}
            onPress={onLogout}
            style={({ pressed }) => [
              onLogout ? null : { opacity: 0.5 },
              pressed ? { backgroundColor: '#fff6f7' } : null,
            ]}
          >
            <View className="flex-row items-center">
              <View className="h-7 w-7 items-center justify-center rounded-[14px] bg-[#fff2f4]">
                <FeatherIcon color="#ef4444" name="log-out" size={15} />
              </View>
              <Text allowFontScaling={false} className="ml-2 text-[13px] font-medium text-[#ef4444]">
                {translateText('Çıkış Yap')}
              </Text>
            </View>
            <FeatherIcon color="#ef4444" name="chevron-right" size={15} />
          </Pressable>
          <Pressable
            className="mt-2 flex-row items-center justify-between rounded-[16px] border border-[#f3c7cd] bg-[#fff5f6] px-3 py-3"
            disabled={isDeletingAccount}
            onPress={openDeleteSheet}
            style={({ pressed }) => [
              isDeletingAccount ? { opacity: 0.55 } : null,
              pressed ? { backgroundColor: '#ffeef1' } : null,
            ]}
          >
            <View className="flex-row items-center">
              <View className="h-7 w-7 items-center justify-center rounded-[14px] bg-[#ffe9ed]">
                <FeatherIcon color="#dc2626" name="trash-2" size={15} />
              </View>
              <View className="ml-2">
                <Text allowFontScaling={false} className="text-[13px] font-semibold text-[#dc2626]">
                  {isDeletingAccount
                    ? translateText('Hesabiniz siliniyor...')
                    : translateText('Hesabı Kalıcı Olarak Sil')}
                </Text>
                <Text allowFontScaling={false} className="text-[10.5px] leading-4 text-[#b14f5a]">
                  {translateText(
                    'Bu işlem geri alınamaz. Tüm verileriniz kalıcı olarak silinecek.',
                  )}
                </Text>
              </View>
            </View>
            <FeatherIcon color="#dc2626" name="chevron-right" size={15} />
          </Pressable>
        </Animated.View>
      </ScrollView>

      <Modal
        animationType="fade"
        
        onRequestClose={() => {
          if (!isDeletingAccount && !isSendingDeleteCode) {
            setIsDeleteSheetVisible(false);
          }
        }}
        transparent={true}
        visible={isDeleteSheetVisible}
        statusBarTranslucent={true} 
      >
        <View className="flex-1 items-center justify-center bg-black/45 px-5">
          <View className="w-full max-w-[390px] rounded-[22px] border border-[#e6d8dc] bg-white px-4 py-4">
            <View className="mb-2 flex-row items-center">
              <View className="h-10 w-10 items-center justify-center rounded-[14px] bg-[#fff1f2]">
                <FeatherIcon color="#dc2626" name="shield" size={18} />
              </View>
              <View className="ml-3 flex-1">
                <Text allowFontScaling={false} className="text-[17px] font-semibold text-[#1f2937]">
                  {translateText('Hesabi Kalici Sil')}
                </Text>
                <Text allowFontScaling={false} className="text-[12px] text-[#64748b]">
                  {translateText(
                    'E-posta kodu dogrulandiysa hesap kalici silinir.',
                  )}
                </Text>
              </View>
            </View>

            <View className="mt-2 rounded-[14px] border border-[#f1d5d9] bg-[#fff8f8] px-3 py-2">
              <Text allowFontScaling={false} className="text-[11.5px] leading-5 text-[#9f4954]">
                {translateText(
                  'Bu islem geri alinamaz. Tum profil, mesaj ve paylasim verilerin kalici silinir.',
                )}
              </Text>
            </View>

            <View className="mt-3 flex-row items-center justify-between">
              <Text allowFontScaling={false} className="text-[12px] font-medium text-[#334155]">
                {translateText('Dogrulama kodu')}
              </Text>
              <Pressable
                disabled={isSendingDeleteCode || isDeletingAccount || !canResendDeleteCode}
                onPress={() => {
                  requestDeleteCode().catch(() => {
                    return;
                  });
                }}
              >
                <Text allowFontScaling={false} className="text-[12px] font-semibold text-[#2563eb]">
                  {isSendingDeleteCode
                    ? translateText('Gönderiliyor...')
                    : canResendDeleteCode
                      ? translateText('Kodu Tekrar Gönder')
                      : translateText(
                          `Tekrar gönder (${deleteResendRemainingSec}s)`,
                        )}
                </Text>
              </Pressable>
            </View>

            <TextInput
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={value => {
                setDeleteCode(value.replace(/\D+/g, ''));
                if (deleteCodeError) {
                  setDeleteCodeError(null);
                }
              }}
              placeholder={translateText('6 haneli kod')}
              placeholderTextColor="#94a3b8"
              style={{
                borderColor: '#d8dee8',
                borderRadius: 14,
                borderWidth: 1,
                color: '#0f172a',
                fontSize: 15,
                fontWeight: '600',
                height: 48,
                marginTop: 8,
                paddingHorizontal: 14,
                textAlign: 'center',
              }}
              value={deleteCode}
            />

            {deleteCodeInfo ? (
              <Text allowFontScaling={false} className="mt-2 text-[11.5px] leading-5 text-[#475569]">
                {translateText(deleteCodeInfo)}
              </Text>
            ) : null}
            {deleteCodeExpiresAtMs != null ? (
              <Text allowFontScaling={false} className="mt-1 text-[11px] leading-5 text-[#64748b]">
                {isDeleteCodeExpired
                  ? translateText('Kod suresi doldu.')
                  : translateText(
                      `Kod kalan sure: ${deleteCodeRemainingSec}s`,
                    )}
              </Text>
            ) : null}
            {deleteCodeError ? (
              <Text allowFontScaling={false} className="mt-2 text-[11.5px] leading-5 text-[#b91c1c]">
                {translateText(deleteCodeError)}
              </Text>
            ) : null}

            <View className="mt-4 flex-row gap-2">
              <Pressable
                className="h-[44px] flex-1 items-center justify-center rounded-[14px] border border-[#d8dee8] bg-white"
                disabled={isDeletingAccount || isSendingDeleteCode}
                onPress={() => {
                  setIsDeleteSheetVisible(false);
                }}
              >
                <Text allowFontScaling={false} className="text-[13px] font-semibold text-[#475569]">
                  {translateText('Vazgec')}
                </Text>
              </Pressable>
              <Pressable
                className="h-[44px] flex-1 flex-row items-center justify-center rounded-[14px] bg-[#dc2626]"
                disabled={!canSubmitDeleteCode}
                onPress={() => {
                  runDeleteAccount().catch(() => {
                    return;
                  });
                }}
                style={({ pressed }) => [
                  pressed ? { opacity: 0.9 } : null,
                  !canSubmitDeleteCode
                    ? { opacity: 0.65 }
                    : null,
                ]}
              >
                {isDeletingAccount ? <ActivityIndicator color="#ffffff" size="small" /> : null}
                <Text allowFontScaling={false} className="ml-2 text-[13px] font-semibold text-white">
                  {translateText('Hesabi Kalici Sil')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
