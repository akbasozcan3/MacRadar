import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import FeatherIcon from '../../components/FeatherIcon/FeatherIcon';
import { sanitizeVerificationCodeInput } from '../../constants/Auth/AuthValidation';
import { Text, TextInput } from '../../theme/typography';
import type { AuthMode } from './Login.types';

type LoginVerificationProps = {
  email: string;
  errorMessage: string | null;
  expiresAt: string;
  infoMessage: string | null;
  isSubmitting: boolean;
  /** Login ana ekranında: üst kaydırma ve kahraman geri tuşu kullanılır; iç KAV/geri gizlenir. */
  loginFlowEmbedded?: boolean;
  onBack: () => void;
  onConfirm: (code: string) => void;
  onResend: () => void;
  resendAvailableAt: string;
  safeBottom: number;
  safeTop: number;
  source: AuthMode;
};

function maskEmail(email: string) {
  const [localPart = '', domain = ''] = email.split('@');
  if (!localPart || !domain) {
    return email;
  }

  const visibleStart = localPart.slice(0, 2);
  const visibleEnd = localPart.slice(-1);
  return `${visibleStart}${'*'.repeat(Math.max(localPart.length - 3, 1))}${visibleEnd}@${domain}`;
}

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }

  return date.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getRemainingSeconds(target: string) {
  const targetDate = new Date(target);
  const diff = targetDate.getTime() - Date.now();

  if (Number.isNaN(targetDate.getTime()) || diff <= 0) {
    return 0;
  }

  return Math.ceil(diff / 1000);
}

function InlineAlert({
  tone,
  icon,
  message,
}: {
  tone: 'info' | 'error';
  icon: string;
  message: string;
}) {
  const isInfo = tone === 'info';

  return (
    <View
      style={[
        styles.inlineAlert,
        isInfo ? styles.inlineAlertInfo : styles.inlineAlertError,
      ]}
    >
      <View
        style={[
          styles.inlineAlertIcon,
          isInfo ? styles.inlineAlertIconInfo : styles.inlineAlertIconError,
        ]}
      >
        <FeatherIcon
          color={isInfo ? '#1d4ed8' : '#b42318'}
          name={icon}
          size={15}
        />
      </View>
      <Text
        style={[
          styles.inlineAlertText,
          isInfo ? styles.inlineAlertTextInfo : styles.inlineAlertTextError,
        ]}
      >
        {message}
      </Text>
    </View>
  );
}

export default function LoginVerification({
  email,
  errorMessage,
  expiresAt,
  infoMessage,
  isSubmitting,
  loginFlowEmbedded = false,
  onBack,
  onConfirm,
  onResend,
  resendAvailableAt,
  safeBottom,
  safeTop,
  source,
}: LoginVerificationProps) {
  const inputRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const [code, setCode] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    getRemainingSeconds(resendAvailableAt),
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setRemainingSeconds(getRemainingSeconds(resendAvailableAt));

    const timer = setInterval(() => {
      setRemainingSeconds(getRemainingSeconds(resendAvailableAt));
    }, 1000);

    return () => clearInterval(timer);
  }, [resendAvailableAt]);

  const digits = useMemo(() => {
    return Array.from({ length: 6 }, (_, index) => code[index] ?? '');
  }, [code]);

  const maskedEmail = useMemo(() => maskEmail(email), [email]);
  const canConfirm = code.length === 6 && !isSubmitting;
  const title =
    source === 'register'
      ? 'E-posta Doğrula'
      : 'Giriş Onayı';
  const subtitle =
    source === 'register'
      ? 'Hesabınızı aktif etmek için e-posta adresinize gönderilen 6 haneli kodu girin.'
      : 'Güvenliğiniz için e-posta adresinize bir doğrulama kodu gönderdik.';
  const resendLabel =
    remainingSeconds > 0 ? `Yeni kod ${remainingSeconds}s` : 'Yeni kod gönder';

  const shellBody = (
    <>
            {!loginFlowEmbedded ? (
              <View className="mb-8">
                <Pressable
                  onPress={onBack}
                  className="h-12 w-12 items-center justify-center rounded-full border border-[#f1f5f9] bg-white active:opacity-75"
                >
                  <FeatherIcon color="#0f172a" name="arrow-left" size={20} />
                </Pressable>
              </View>
            ) : null}

            <View className="mb-8">
              <Text className="text-[32px] font-[300] tracking-[-0.5px] text-[#0f172a]">
                {title}
              </Text>
              <Text className="mt-2 text-[16px] font-[300] leading-[24px] text-[#64748b]">
                {subtitle}
              </Text>
            </View>

            <View className="mb-8 rounded-3xl border border-[#f1f5f9] bg-[#f8fafc]/50 p-6">
              <View className="flex-row items-center justify-between">
                <View>
                  <Text className="text-[11px] font-[500] uppercase tracking-[1.5px] text-[#94a3b8]">
                    Alıcı Adresi
                  </Text>
                  <Text className="mt-1 text-[16px] font-[400] text-[#0f172a]">
                    {maskedEmail}
                  </Text>
                </View>
                <View className="h-10 w-10 items-center justify-center rounded-full bg-[#fff7ed]">
                  <FeatherIcon color="#ff5a16" name="mail" size={20} />
                </View>
              </View>
              
              <View className="mt-6 h-px w-full bg-[#f1f5f9]" />
              
              <View className="mt-6 flex-row items-center gap-4">
                <View className="flex-row items-center gap-2">
                  <FeatherIcon color="#94a3b8" name="clock" size={14} />
                  <Text className="text-[12px] font-[300] text-[#64748b]">
                    Son: {formatClock(expiresAt)}
                  </Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <FeatherIcon color="#94a3b8" name="refresh-cw" size={14} />
                  <Text className="text-[12px] font-[300] text-[#64748b]">
                    {remainingSeconds > 0 ? `Kalan: ${remainingSeconds}s` : 'Tekrar gönderilebilir'}
                  </Text>
                </View>
              </View>
            </View>

            <View>
              <View className="relative">
                <TextInput
                  ref={inputRef}
                  autoCapitalize="none"
                  autoComplete="one-time-code"
                  keyboardType="number-pad"
                  maxLength={6}
                  onChangeText={value => {
                    setCode(sanitizeVerificationCodeInput(value));
                  }}
                  className="absolute inset-0 z-10 opacity-0"
                  textContentType="oneTimeCode"
                  value={code}
                />

                <View className="flex-row justify-between">
                  {digits.map((digit, index) => {
                    const isFilled = digit.length > 0;
                    const isActive = index === Math.min(code.length, 5);

                    return (
                      <View
                        key={`otp-${index}`}
                        className={`h-[60px] w-[50px] items-center justify-center rounded-2xl border ${
                          isFilled || isActive ? 'border-[#ff5a16] bg-[#fffaf7]' : 'border-[#f1f5f9] bg-[#f8fafc]'
                        }`}
                      >
                        <Text
                          className={`text-[24px] font-[300] ${
                            isFilled ? 'text-[#0f172a]' : 'text-[#cbd5e1]'
                          }`}
                        >
                          {digit || '-'}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              <Text className="mt-4 text-center text-[12px] font-[300] text-[#94a3b8]">
                Lütfen mail kutunuzu ve spam klasörünüzü kontrol edin.
              </Text>

              <View className="mt-8 gap-3">
                {infoMessage ? (
                  <InlineAlert icon="info" message={infoMessage} tone="info" />
                ) : null}

                {errorMessage ? (
                  <InlineAlert icon="alert-circle" message={errorMessage} tone="error" />
                ) : null}

                <Pressable
                  disabled={!canConfirm || isSubmitting}
                  onPress={() => onConfirm(code)}
                  className={`h-[56px] flex-row items-center justify-center rounded-full bg-[#0f172a] ${
                    !canConfirm || isSubmitting ? 'opacity-40' : ''
                  } active:opacity-90`}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <>
                      <Text className="text-[16px] font-[400] text-white">Doğrula ve Devam Et</Text>
                      <FeatherIcon color="#ffffff" name="arrow-right" size={16} className="ml-2" />
                    </>
                  )}
                </Pressable>

                <Pressable
                  disabled={isSubmitting || remainingSeconds > 0}
                  onPress={onResend}
                  className={`h-[56px] flex-row items-center justify-center rounded-full border border-[#f1f5f9] bg-white ${
                    isSubmitting || remainingSeconds > 0 ? 'opacity-40' : ''
                  } active:opacity-75`}
                >
                  <FeatherIcon color="#64748b" name="refresh-cw" size={16} />
                  <Text className="ml-2 text-[16px] font-[400] text-[#64748b]">{resendLabel}</Text>
                </Pressable>
              </View>
            </View>
    </>
  );

  if (loginFlowEmbedded) {
    return (
      <View className="w-full">
        <View style={styles.shell}>{shellBody}</View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.screen}
    >
      <View style={styles.screen}>
        <View
          style={[
            styles.content,
            {
              paddingBottom: Math.max(safeBottom, 20) + 14,
              paddingTop: Math.max(safeTop, 20) + 10,
            },
          ]}
        >
          <View style={styles.shell}>{shellBody}</View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  content: {
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: 24,
  },
  shell: {
    width: '100%',
    maxWidth: 400,
  },
  inlineAlert: {
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inlineAlertInfo: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  inlineAlertError: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecdd3',
  },
  inlineAlertIcon: {
    alignItems: 'center',
    borderRadius: 999,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  inlineAlertIconInfo: {
    backgroundColor: '#dbeafe',
  },
  inlineAlertIconError: {
    backgroundColor: '#ffe4e6',
  },
  inlineAlertText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '300',
    lineHeight: 18,
  },
  inlineAlertTextInfo: {
    color: '#1e3a8a',
  },
  inlineAlertTextError: {
    color: '#9f1239',
  },
});
