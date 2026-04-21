import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import FeatherIcon from '../../../components/FeatherIcon/FeatherIcon';
import IosSpinner from '../../../components/IosSpinner/IosSpinner';
import IosTitleHeader from '../../../components/Headers/IosTitleHeader';
import { setAppLanguage, subscribeAppLanguage, translateText } from '../../../i18n/runtime';
import { isApiRequestError } from '../../../services/apiClient';
import {
  fetchProfileAppSettings,
  updateProfileAppSettings,
} from '../../../services/authService';
import { syncI18nBundleWithCurrentLanguage } from '../../../services/i18nService';
import { Text } from '../../../theme/typography';
import type {
  ProfileAppSettings,
  ProfileGender,
} from '../../../types/AuthTypes/AuthTypes';

export type AppPreferencesMode = 'language' | 'notifications' | 'profile';

type AppPreferencesSettingsProps = {
  contentBottomInset?: number;
  mode: AppPreferencesMode;
  onBack?: () => void;
  safeBottom?: number;
  safeTop?: number;
};

type NotificationField =
  | 'notifyFollowRequests'
  | 'notifyMessages'
  | 'notifyPostLikes'
  | 'onlyFollowedUsersCanMessage';

const DEFAULT_SETTINGS: ProfileAppSettings = {
  gender: 'prefer_not_to_say',
  language: 'tr',
  notifyFollowRequests: true,
  notifyMessages: true,
  notifyPostLikes: true,
  onlyFollowedUsersCanMessage: false,
  updatedAt: new Date().toISOString(),
};

const APP_SETTINGS_LOAD_COOLDOWN_MS = 20_000;
const APP_SETTINGS_AUTO_RETRY_MAX = 12;
const PROFILE_GENDER_OPTIONS: Array<{
  description: string;
  label: string;
  value: ProfileGender;
}> = [
  {
    description: 'Görünür Etiket: Erkek',
    label: 'Erkek',
    value: 'male',
  },
  {
    description: 'Görünür Etiket: Kadın',
    label: 'Kadın',
    value: 'female',
  },
  {
    description: 'Görünür Etiket: İkili olmayan',
    label: 'İkili Olmayan',
    value: 'non_binary',
  },
  {
    description: 'Herkese Açık Etiket Yok',
    label: 'Belirtmek İstemiyorum',
    value: 'prefer_not_to_say',
  },
];

type NotificationPreferenceRowProps = {
  description: string;
  field: NotificationField;
  isSaving: boolean;
  onToggle: (field: NotificationField, value: boolean) => void;
  title: string;
  value: boolean;
};

const NotificationPreferenceRow = React.memo(function NotificationPreferenceRow({
  description,
  field,
  isSaving,
  onToggle,
  title,
  value,
}: NotificationPreferenceRowProps) {
  return (
    <View style={styles.toggleCard}>
      <View style={styles.toggleTextWrap}>
        <Text allowFontScaling={false} style={styles.toggleTitle}>
          {title}
        </Text>
        <Text allowFontScaling={false} style={styles.toggleDescription}>
          {description}
        </Text>
      </View>
      <Switch
        disabled={isSaving}
        ios_backgroundColor="#dfe3ec"
        onValueChange={nextValue => {
          onToggle(field, nextValue);
        }}
        thumbColor="#fff"
        trackColor={{ false: '#dfe3ec', true: '#ff7a3a' }}
        value={value}
      />
    </View>
  );
});

export default function AppPreferencesSettings({
  contentBottomInset = 0,
  mode,
  onBack,
  safeBottom = 0,
  safeTop = 0,
}: AppPreferencesSettingsProps) {
  const [languageVersion, setLanguageVersion] = useState(0);
  const [settings, setSettings] = useState<ProfileAppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [profileSuccessMessage, setProfileSuccessMessage] = useState<string | null>(null);
  const [settingsReloadKey, setSettingsReloadKey] = useState(0);
  const footerInset = Math.max(contentBottomInset, safeBottom + 90);
  const enterAnimation = useRef(new Animated.Value(0)).current;
  const settingsLoadRequestIdRef = useRef(0);
  const settingsAutoRetryCountRef = useRef(0);
  const settingsAutoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedSettingsRef = useRef(false);
  const settingsLoadAtRef = useRef(0);
  const patchRequestIdRef = useRef(0);
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
  }, [enterAnimation, mode]);

  useEffect(() => {
    return subscribeAppLanguage(() => {
      setLanguageVersion(version => version + 1);
    });
  }, []);

  useEffect(() => {
    let active = true;
    let shouldKeepLoading = false;
    settingsLoadRequestIdRef.current += 1;
    const requestId = settingsLoadRequestIdRef.current;
    const shouldShowLoader =
      Date.now() - settingsLoadAtRef.current > APP_SETTINGS_LOAD_COOLDOWN_MS;
    if (shouldShowLoader) {
      setIsLoading(true);
    }
    setErrorMessage(null);

    const shouldRetryLoad = (error: unknown) => {
      if (!isApiRequestError(error)) {
        return false;
      }
      return (
        error.status === 0 ||
        error.status === 401 ||
        error.status === 408 ||
        error.status === 429 ||
        error.status >= 500
      );
    };

    const fetchSettingsWithRetry = async () => {
      try {
        return await fetchProfileAppSettings();
      } catch (error) {
        if (!shouldRetryLoad(error)) {
          throw error;
        }
        await new Promise(resolve => {
          setTimeout(() => {
            resolve(undefined);
          }, 420);
        });
        return fetchProfileAppSettings({ force: true });
      }
    };

    fetchSettingsWithRetry()
      .then(response => {
        if (!active || requestId !== settingsLoadRequestIdRef.current) {
          return;
        }
        setAppLanguage(response.language);
        setSettings(response);
        setErrorMessage(null);
        hasLoadedSettingsRef.current = true;
        settingsAutoRetryCountRef.current = 0;
        settingsLoadAtRef.current = Date.now();
        syncI18nBundleWithCurrentLanguage().catch(() => {
          return;
        });
      })
      .catch(error => {
        if (!active || requestId !== settingsLoadRequestIdRef.current) {
          return;
        }
        const canAutoRetry =
          shouldRetryLoad(error) &&
          settingsAutoRetryCountRef.current < APP_SETTINGS_AUTO_RETRY_MAX;
        if (canAutoRetry) {
          settingsAutoRetryCountRef.current += 1;
          shouldKeepLoading = true;
          if (settingsAutoRetryTimerRef.current) {
            clearTimeout(settingsAutoRetryTimerRef.current);
            settingsAutoRetryTimerRef.current = null;
          }
          const delayMs = Math.min(
            3200,
            550 + settingsAutoRetryCountRef.current * 260,
          );
          settingsAutoRetryTimerRef.current = setTimeout(() => {
            settingsAutoRetryTimerRef.current = null;
            setSettingsReloadKey(previous => previous + 1);
          }, delayMs);
          return;
        }
        if (hasLoadedSettingsRef.current) {
          setErrorMessage(null);
          return;
        }
        setErrorMessage(
          isApiRequestError(error)
            ? error.message
            : translateText('Ayarlar yuklenemedi.'),
        );
      })
      .finally(() => {
        if (
          active &&
          requestId === settingsLoadRequestIdRef.current &&
          !shouldKeepLoading
        ) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [settingsReloadKey]);

  useEffect(() => {
    return () => {
      if (settingsAutoRetryTimerRef.current) {
        clearTimeout(settingsAutoRetryTimerRef.current);
        settingsAutoRetryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setProfileSuccessMessage(null);
  }, [mode]);

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

  const screenTitle = useMemo(() => {
    if (mode === 'notifications') {
      return translateText('Bildirimler');
    }
    if (mode === 'profile') {
      return translateText('Profil');
    }
    return translateText('Dil');
  }, [languageVersion, mode]);

  const modeDescription = useMemo(() => {
    if (mode === 'notifications') {
      return translateText('Bildirim tercihlerin cihaz degissen bile korunur.');
    }
    if (mode === 'profile') {
      return translateText('Profil tercihlerin backend tarafinda guvenli sekilde senkron kalir.');
    }
    return translateText('Dil seciminiz kaydedilir ve diger cihazlarda da aynı olur.');
  }, [languageVersion, mode]);

  async function patchSettings(
    payload: Parameters<typeof updateProfileAppSettings>[0],
  ): Promise<boolean> {
    if (isSaving) {
      return false;
    }
    const patchEntries = Object.entries(payload) as Array<
      [keyof ProfileAppSettings, ProfileAppSettings[keyof ProfileAppSettings]]
    >;
    if (patchEntries.length === 0) {
      return false;
    }

    const hasMeaningfulChange = patchEntries.some(([key, value]) => settings[key] !== value);
    if (!hasMeaningfulChange) {
      return false;
    }

    const previousSettings = settings;
    const optimisticSettings: ProfileAppSettings = {
      ...settings,
      ...payload,
      updatedAt: new Date().toISOString(),
    };
    if (typeof payload.language === 'string') {
      setAppLanguage(payload.language);
      if (payload.language === 'en') {
        syncI18nBundleWithCurrentLanguage().catch(() => {
          return;
        });
      }
    }
    setSettings(optimisticSettings);
    setIsSaving(true);
    setErrorMessage(null);
    patchRequestIdRef.current += 1;
    const requestId = patchRequestIdRef.current;

    try {
      const updated = await updateProfileAppSettings(payload);
      if (requestId !== patchRequestIdRef.current) {
        return false;
      }
      setAppLanguage(updated.language);
      setSettings(updated);
      syncI18nBundleWithCurrentLanguage().catch(() => {
        return;
      });
      return true;
    } catch (error) {
      if (requestId !== patchRequestIdRef.current) {
        return false;
      }
      setAppLanguage(previousSettings.language);
      setSettings(previousSettings);
      setErrorMessage(
        isApiRequestError(error)
          ? error.message
          : translateText('Ayar guncellenemedi.'),
      );
      return false;
    } finally {
      if (requestId === patchRequestIdRef.current) {
        setIsSaving(false);
      }
    }
  }

  function renderNotificationSettings() {
    const handleNotificationToggle = (field: NotificationField, value: boolean) => {
      patchSettings({ [field]: value }).catch(() => {
        return;
      });
    };

    return (
      <View style={styles.sectionCard}>
        <Text allowFontScaling={false} style={styles.sectionTitle}>
          {translateText('Bildirim Tercihleri')}
        </Text>
        <NotificationPreferenceRow
          description={translateText('Hesabin gizliyse gelen takip istekleri.')}
          field="notifyFollowRequests"
          isSaving={isSaving}
          onToggle={handleNotificationToggle}
          title={translateText('Takip Istekleri')}
          value={settings.notifyFollowRequests}
        />
        <NotificationPreferenceRow
          description={translateText('Yeni mesaj geldiginde anlik bildirim.')}
          field="notifyMessages"
          isSaving={isSaving}
          onToggle={handleNotificationToggle}
          title={translateText('Mesajlar')}
          value={settings.notifyMessages}
        />
        <NotificationPreferenceRow
          description={translateText('Yeni gonderi, yorum ve begeni aktiviteleri.')}
          field="notifyPostLikes"
          isSaving={isSaving}
          onToggle={handleNotificationToggle}
          title={translateText('Gonderi Bildirimleri')}
          value={settings.notifyPostLikes}
        />
        <NotificationPreferenceRow
          description={translateText(
            'Aciksa, seni takip etmeyen hesaplar mesaj istegi bile gonderemez.',
          )}
          field="onlyFollowedUsersCanMessage"
          isSaving={isSaving}
          onToggle={handleNotificationToggle}
          title={translateText('Sadece Takip Ettiklerim')}
          value={settings.onlyFollowedUsersCanMessage}
        />
      </View>
    );
  }

  function renderLanguageSettings() {
    const isTurkish = settings.language === 'tr';
    const changeLanguage = (language: ProfileAppSettings['language']) => {
      if (isSaving || settings.language === language) {
        return;
      }

      patchSettings({ language }).catch(() => {
        return;
      });
    };

    return (
      <View style={styles.sectionCard}>
        <Text allowFontScaling={false} style={styles.sectionTitle}>
          {translateText('Uygulama Dili')}
        </Text>
        <View style={styles.segmentWrap}>
          <Pressable
            disabled={isSaving}
            onPress={() => {
              changeLanguage('tr');
            }}
            style={[
              styles.segmentItem,
              isTurkish ? styles.segmentItemActive : null,
            ]}
          >
            <Text
              allowFontScaling={false}
              style={[
                styles.segmentText,
                isTurkish ? styles.segmentTextActive : null,
              ]}
            >
              Türkçe
            </Text>
          </Pressable>
          <Pressable
            disabled={isSaving}
            onPress={() => {
              changeLanguage('en');
            }}
            style={[
              styles.segmentItem,
              !isTurkish ? styles.segmentItemActive : null,
            ]}
          >
            <Text
              allowFontScaling={false}
              style={[
                styles.segmentText,
                !isTurkish ? styles.segmentTextActive : null,
              ]}
            >
              English
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderProfileSettings() {
    const changeGender = (gender: ProfileGender) => {
      if (isSaving || settings.gender === gender) {
        return;
      }
      setProfileSuccessMessage(null);
      setErrorMessage(null);
      patchSettings({ gender })
        .then(updated => {
          if (updated) {
            setProfileSuccessMessage(translateText('Profil Tercihleri Güncellendi.'));
          }
        })
        .catch(() => {
          return;
        });
    };

    return (
      <View style={styles.sectionCard}>
        <Text allowFontScaling={false} style={styles.sectionTitle}>
          {translateText('Cinsiyet')}
        </Text>
        <Text allowFontScaling={false} style={styles.profileDescription}>
          {translateText('Kesfet ve profil etiketlerinde kullanilacak cinsiyet secimini belirle.')}
        </Text>

        <View style={styles.genderGrid}>
          {PROFILE_GENDER_OPTIONS.map(option => {
            const active = settings.gender === option.value;
            return (
              <Pressable
                key={option.value}
                disabled={isSaving}
                onPress={() => {
                  changeGender(option.value);
                }}
                style={[
                  styles.genderCard,
                  active ? styles.genderCardActive : null,
                ]}
              >
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.genderTitle,
                    active ? styles.genderTitleActive : null,
                  ]}
                >
                  {translateText(option.label)}
                </Text>
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.genderSubtitle,
                    active ? styles.genderSubtitleActive : null,
                  ]}
                >
                  {translateText(option.description)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {profileSuccessMessage ? (
          <View className='flex-row items-center bg-green-500 rounded-lg p-2 mt-2'>
            <View className='bg-green-100 rounded-full p-2'>
              <FeatherIcon color="#16a34a" name="check-circle" size={16} />
            </View>
            <Text allowFontScaling={false} style={styles.successText}>
              {profileSuccessMessage}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  function renderModeContent() {
    if (mode === 'notifications') {
      return renderNotificationSettings();
    }
    if (mode === 'profile') {
      return renderProfileSettings();
    }
    return renderLanguageSettings();
  }

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <IosTitleHeader onBack={onBack} safeTop={safeTop} title={screenTitle} />

      <ScrollView
        contentContainerStyle={scrollContentStyle}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
      >
        <Animated.View style={[styles.content, animatedStyle]}>
          <View style={styles.infoCard}>
            <View style={styles.infoIconWrap}>
              <FeatherIcon color="#ff6a1b" name="info" size={10} />
            </View>
            <Text allowFontScaling={false} style={styles.infoText}>
              {modeDescription}
            </Text>
          </View>

          {errorMessage ? (
            <View style={styles.errorCard}>
              <Text allowFontScaling={false} style={styles.errorText}>
                {errorMessage}
              </Text>
              <Pressable
                disabled={isLoading || isSaving}
                onPress={() => {
                  settingsAutoRetryCountRef.current = 0;
                  setSettingsReloadKey(previous => previous + 1);
                }}
                style={({ pressed }) => [
                  styles.errorRetryButton,
                  (isLoading || isSaving) ? styles.errorRetryButtonDisabled : null,
                  pressed ? styles.errorRetryButtonPressed : null,
                ]}
              >
                <Text allowFontScaling={false} style={styles.errorRetryButtonText}>
                  {translateText('Tekrar dene')}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {isLoading ? (
            <View style={styles.loadingWrap}>
              <IosSpinner color="#ff5a16" size="small" />
              <Text allowFontScaling={false} style={styles.loadingText}>
                {translateText('Ayarlar yükleniyor...')}
              </Text>
            </View>
          ) : (
            renderModeContent()
          )}
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 14,
  },
  errorCard: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecdd3',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    color: '#be123c',
    fontSize: 12,
  },
  errorRetryButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#ffe4e6',
    borderColor: '#fda4af',
    borderRadius: 9,
    borderWidth: 1,
    marginTop: 8,
    minHeight: 30,
    paddingHorizontal: 10,
  },
  errorRetryButtonDisabled: {
    opacity: 0.55,
  },
  errorRetryButtonPressed: {
    backgroundColor: '#fecdd3',
  },
  errorRetryButtonText: {
    color: '#9f1239',
    fontSize: 11.5,
    fontWeight: '600',
  },
  fieldLabel: {
    color: '#657184',
    fontSize: 11,
    marginBottom: 4,
  },
  infoCard: {
    alignItems: 'flex-start',
    backgroundColor: '#edf2fa',
    borderColor: '#e2e8f3',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  infoIconWrap: {
    alignItems: 'center',
    backgroundColor: '#ffefe6',
    borderRadius: 8,
    height: 16,
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 1,
    width: 16,
  },
  infoText: {
    color: '#5f6b7b',
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
  },
  input: {
    backgroundColor: '#f6f8fb',
    borderColor: '#e3e8f0',
    borderRadius: 12,
    borderWidth: 1,
    color: '#1a2230',
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  loadingText: {
    color: '#6b7382',
    fontSize: 12,
    marginLeft: 8,
  },
  loadingWrap: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e5e9f1',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  genderCard: {
    backgroundColor: '#f8f9fc',
    borderColor: '#e7ebf3',
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 72,
    paddingHorizontal: 10,
    paddingVertical: 9,
    width: '48.6%',
  },
  genderCardActive: {
    backgroundColor: '#1f2837',
    borderColor: '#1f2837',
  },
  genderGrid: {
    columnGap: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 8,
  },
  genderSubtitle: {
    color: '#7f8797',
    fontSize: 10,
    lineHeight: 13,
    marginTop: 3,
  },
  genderSubtitleActive: {
    color: '#c8d4ec',
  },
  genderTitle: {
    color: '#202734',
    fontSize: 12.5,
    fontWeight: '600',
  },
  genderTitleActive: {
    color: '#ffffff',
  },
  profileDescription: {
    color: '#7b8494',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 8,
  },
  screen: {
    backgroundColor: '#f2f2f7',
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  sectionCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e9f1',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  sectionTitle: {
    color: '#202531',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  profileSectionDivider: {
    backgroundColor: '#e8edf5',
    height: 1,
    marginBottom: 10,
    marginTop: 12,
  },
  successText: {
    right: -5,
    top: 0,
    color: 'white',
    fontSize: 12.5,
  },
  segmentItem: {
    alignItems: 'center',
    borderRadius: 999,
    flex: 1,
    height: 34,
    justifyContent: 'center',
  },
  segmentItemActive: {
    backgroundColor: '#1f2837',
  },
  segmentText: {
    color: '#5d6677',
    fontSize: 12.5,
    fontWeight: '500',
  },
  segmentTextActive: {
    color: '#ffffff',
  },
  segmentWrap: {
    backgroundColor: '#eef1f6',
    borderRadius: 999,
    flexDirection: 'row',
    padding: 4,
  },
  toggleCard: {
    alignItems: 'center',
    backgroundColor: '#f8f9fc',
    borderColor: '#ebeff5',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  toggleDescription: {
    color: '#7f8797',
    fontSize: 10.5,
    marginTop: 1,
  },
  toggleTextWrap: {
    flex: 1,
    marginRight: 8,
  },
  toggleTitle: {
    color: '#212734',
    fontSize: 12.5,
    fontWeight: '500',
  },
});
