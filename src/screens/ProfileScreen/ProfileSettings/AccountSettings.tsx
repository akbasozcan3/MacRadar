import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import IosSpinner from '../../../components/IosSpinner/IosSpinner';
import IosTitleHeader from '../../../components/Headers/IosTitleHeader';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isPasswordLengthValid,
} from '../../../constants/Auth/AuthValidation';
import { isApiRequestError } from '../../../services/apiClient';
import {
  checkUsernameAvailability,
  changePassword,
  requestPasswordReset,
  updateMyProfile,
} from '../../../services/authService';
import { Text } from '../../../theme/typography';
import type { UserProfile } from '../../../types/AuthTypes/AuthTypes';

type AccountSettingsProps = {
  contentBottomInset?: number;
  onBack?: () => void;
  onForgotPassword?: (email: string) => void;
  onProfileChange?: (profile: UserProfile) => void;
  profile: UserProfile;
  safeBottom?: number;
  safeTop?: number;
};

export default function AccountSettings({
  contentBottomInset = 0,
  onBack,
  onForgotPassword,
  onProfileChange,
  profile,
  safeBottom = 0,
  safeTop = 0,
}: AccountSettingsProps) {
  const isLocal = profile.authProvider === 'local';
  const [username, setUsername] = useState(profile.username.trim().replace(/^@+/, ''));
  const [email, setEmail] = useState(profile.email.trim());
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identitySuccess, setIdentitySuccess] = useState<string | null>(null);
  const [usernameStatus, setUsernameStatus] = useState<
    'idle' | 'loading' | 'available' | 'taken' | 'error'
  >('idle');
  const [usernameStatusMessage, setUsernameStatusMessage] = useState<string | null>(
    null,
  );
  const [isSavingIdentity, setIsSavingIdentity] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordHint, setPasswordHint] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isRequestingReset, setIsRequestingReset] = useState(false);

  useEffect(() => {
    setUsername(profile.username.trim().replace(/^@+/, ''));
    setEmail(profile.email.trim());
    setIdentityError(null);
    setIdentitySuccess(null);
    setUsernameStatus('idle');
    setUsernameStatusMessage(null);
  }, [profile.email, profile.username]);

  const normalizedUsername = username.trim().replace(/^@+/, '').toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();
  const hasIdentityChanges =
    normalizedUsername !== profile.username.trim().replace(/^@+/, '').toLowerCase() ||
    normalizedEmail !== profile.email.trim().toLowerCase();

  useEffect(() => {
    if (!isLocal) {
      setUsernameStatus('idle');
      setUsernameStatusMessage(null);
      return;
    }
    const currentUsername = profile.username.trim().replace(/^@+/, '').toLowerCase();
    if (normalizedUsername === currentUsername) {
      setUsernameStatus('idle');
      setUsernameStatusMessage('Mevcut kullanıcı adın.');
      return;
    }
    if (
      normalizedUsername.length < 3 ||
      normalizedUsername.length > 20 ||
      !/^[a-z0-9]+$/.test(normalizedUsername)
    ) {
      setUsernameStatus('idle');
      setUsernameStatusMessage(
        'Kullanıcı adı 3-20 karakter olmalı ve yalnızca harf/rakam içermeli.',
      );
      return;
    }

    setUsernameStatus('loading');
    setUsernameStatusMessage('Kullanıcı adı kontrol ediliyor...');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      checkUsernameAvailability(normalizedUsername, { signal: controller.signal })
        .then(response => {
          setUsernameStatus(response.available ? 'available' : 'taken');
          setUsernameStatusMessage(
            response.available ? 'Kullanılabilir.' : 'Bu kullanıcı adı alınmış.',
          );
        })
        .catch(error => {
          if (controller.signal.aborted) {
            return;
          }
          setUsernameStatus('error');
          setUsernameStatusMessage(
            isApiRequestError(error)
              ? error.message
              : 'Kullanıcı adı şu an kontrol edilemedi.',
          );
        });
    }, 350);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [isLocal, normalizedUsername, profile.username]);

  async function handleSaveIdentity() {
    if (!isLocal || isSavingIdentity) {
      return;
    }
    if (!hasIdentityChanges) {
      setIdentitySuccess('Kaydedilecek degisiklik yok.');
      setIdentityError(null);
      return;
    }
    if (normalizedUsername.length < 3 || normalizedUsername.length > 20) {
      setIdentityError('Kullanici adi 3-20 karakter arasinda olmali.');
      return;
    }
    if (!/^[a-z0-9]+$/.test(normalizedUsername)) {
      setIdentityError('Kullanici adi yalnizca harf ve rakam icerebilir.');
      return;
    }
    if (
      normalizedUsername !== profile.username.trim().replace(/^@+/, '').toLowerCase()
    ) {
      if (usernameStatus === 'loading') {
        setIdentityError('Kullanici adi kontrolu tamamlanmadan kaydedemezsin.');
        return;
      }
      if (usernameStatus === 'taken') {
        setIdentityError(usernameStatusMessage || 'Bu kullanici adi alinmis.');
        return;
      }
      if (usernameStatus === 'error') {
        setIdentityError(
          usernameStatusMessage || 'Kullanici adi su an kontrol edilemiyor.',
        );
        return;
      }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setIdentityError('Gecerli bir e-posta girin.');
      return;
    }

    setIsSavingIdentity(true);
    setIdentityError(null);
    setIdentitySuccess(null);
    try {
      const updated = await updateMyProfile({
        email: normalizedEmail,
        username: normalizedUsername,
      });
      onProfileChange?.(updated);
      setIdentitySuccess('Kullanici adi ve e-posta guncellendi.');
    } catch (error) {
      setIdentityError(
        isApiRequestError(error)
          ? error.message
          : 'Hesap kimligi guncellenemedi.',
      );
    } finally {
      setIsSavingIdentity(false);
    }
  }

  async function handleChangePassword() {
    if (!isLocal || isChangingPassword) {
      return;
    }
    if (!isPasswordLengthValid(newPassword)) {
      setPasswordError(
        `Yeni sifre ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} karakter olmali.`,
      );
      return;
    }
    setIsChangingPassword(true);
    setPasswordError(null);
    setPasswordSuccess(null);
    try {
      const response = await changePassword({ currentPassword, newPassword });
      setPasswordSuccess(response.message);
      setCurrentPassword('');
      setNewPassword('');
    } catch (error) {
      setPasswordError(
        isApiRequestError(error) ? error.message : 'Sifre guncellenemedi.',
      );
    } finally {
      setIsChangingPassword(false);
    }
  }

  async function handleForgotPassword() {
    if (!isLocal || isRequestingReset) {
      return;
    }
    if (onForgotPassword) {
      onForgotPassword(normalizedEmail);
      return;
    }
    setIsRequestingReset(true);
    setPasswordHint(null);
    setPasswordError(null);
    try {
      const response = await requestPasswordReset({ email: normalizedEmail });
      setPasswordHint(response.message);
    } catch (error) {
      setPasswordError(
        isApiRequestError(error)
          ? error.message
          : 'Sifre sifirlama baslatilamadi.',
      );
    } finally {
      setIsRequestingReset(false);
    }
  }

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <IosTitleHeader onBack={onBack} safeTop={safeTop} title="Hesap Ayarlari" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={{
            paddingBottom: Math.max(contentBottomInset, safeBottom + 90),
            paddingTop: 10,
          }}
          keyboardShouldPersistTaps="handled"
          style={styles.flex}
        >
          <View style={styles.card}>
            <Text style={styles.title}>Hesap Kimligi</Text>
            <Text style={styles.label}>Kullanici adi</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={isLocal}
              onChangeText={value =>
                setUsername(value.replace(/[^A-Za-z0-9]/g, '').toLowerCase())
              }
              style={[styles.input, !isLocal ? styles.readonly : null]}
              value={username}
            />
            {isLocal && usernameStatusMessage ? (
              <Text
                style={[
                  styles.usernameStatus,
                  usernameStatus === 'available' ? styles.usernameStatusSuccess : null,
                  usernameStatus === 'taken' || usernameStatus === 'error'
                    ? styles.usernameStatusError
                    : null,
                ]}
              >
                {usernameStatusMessage}
              </Text>
            ) : null}
            <Text style={styles.label}>E-posta</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={isLocal}
              keyboardType="email-address"
              onChangeText={setEmail}
              style={[styles.input, !isLocal ? styles.readonly : null]}
              value={email}
            />
            {identityError ? <Text style={styles.error}>{identityError}</Text> : null}
            {identitySuccess ? <Text style={styles.success}>{identitySuccess}</Text> : null}
            {isLocal ? (
              <Pressable
                disabled={isSavingIdentity}
                onPress={() => {
                  handleSaveIdentity().catch(() => {
                    return;
                  });
                }}
                style={styles.primaryButton}
              >
                {isSavingIdentity ? (
                  <IosSpinner color="#fff" size="small" />
                ) : (
                  <Text style={styles.primaryText}>Kimlik bilgilerini kaydet</Text>
                )}
              </Pressable>
            ) : (
              <Text style={styles.hint}>
                Sosyal hesaplarda kullanici adi/e-posta degisimi kapalidir.
              </Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Guvenlik</Text>
            {isLocal ? (
              <>
                <Text style={styles.label}>Mevcut sifre</Text>
                <TextInput
                  secureTextEntry
                  onChangeText={setCurrentPassword}
                  style={styles.input}
                  value={currentPassword}
                />
                <Text style={styles.label}>Yeni sifre</Text>
                <TextInput
                  secureTextEntry
                  onChangeText={setNewPassword}
                  style={styles.input}
                  value={newPassword}
                />
                {passwordError ? <Text style={styles.error}>{passwordError}</Text> : null}
                {passwordSuccess ? <Text style={styles.success}>{passwordSuccess}</Text> : null}
                {passwordHint ? <Text style={styles.hint}>{passwordHint}</Text> : null}
                <Pressable
                  disabled={isChangingPassword}
                  onPress={() => {
                    handleChangePassword().catch(() => {
                      return;
                    });
                  }}
                  style={styles.primaryButton}
                >
                  {isChangingPassword ? (
                    <IosSpinner color="#fff" size="small" />
                  ) : (
                    <Text style={styles.primaryText}>Sifreyi guncelle</Text>
                  )}
                </Pressable>
                <Pressable
                  disabled={isRequestingReset}
                  onPress={() => {
                    handleForgotPassword().catch(() => {
                      return;
                    });
                  }}
                  style={styles.linkButton}
                >
                  <Text style={styles.linkText}>Sifremi unuttum</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.hint}>
                Bu hesapta sifre islemleri saglayici tarafta yonetilir.
              </Text>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderColor: '#dfe6ee',
    borderRadius: 16,
    borderWidth: 1,
    marginHorizontal: 14,
    marginTop: 10,
    padding: 14,
  },
  error: { color: '#b42318', fontSize: 12, marginTop: 8 },
  flex: { flex: 1 },
  hint: { color: '#1d4ed8', fontSize: 12, marginTop: 8 },
  input: {
    backgroundColor: '#f6f8fb',
    borderColor: '#e2e8f0',
    borderRadius: 12,
    borderWidth: 1,
    color: '#0f172a',
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
  },
  label: { color: '#64748b', fontSize: 12, marginTop: 10 },
  linkButton: { alignItems: 'center', marginTop: 10, paddingVertical: 8 },
  linkText: { color: '#2563eb', fontSize: 12, fontWeight: '600' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 999,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 42,
  },
  primaryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  readonly: { opacity: 0.6 },
  screen: { backgroundColor: '#f2f4f8', flex: 1 },
  success: { color: '#15803d', fontSize: 12, marginTop: 8 },
  title: { color: '#0f172a', fontSize: 15, fontWeight: '700' },
  usernameStatus: { color: '#64748b', fontSize: 11.5, marginTop: 6 },
  usernameStatusError: { color: '#b42318' },
  usernameStatusSuccess: { color: '#15803d' },
});
