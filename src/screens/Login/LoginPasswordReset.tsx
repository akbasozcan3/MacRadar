import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type TextInputProps,
} from 'react-native';

import FeatherIcon from '../../components/FeatherIcon/FeatherIcon';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isPasswordLengthValid,
} from '../../constants/Auth/AuthValidation';
import { Text, TextInput } from '../../theme/typography';
import type {
  PasswordResetFormState,
  PasswordResetSession,
} from './Login.types';

type LoginPasswordResetProps = {
  code: string;
  confirmPassword: string;
  email: string;
  emailLocked?: boolean;
  entryPoint?: 'login' | 'profile';
  errorMessage: string | null;
  infoMessage: string | null;
  isSubmitting: boolean;
  /** Login ana akışında üst `KeyboardAwareScrollView` ile birlikte kullanılır. */
  loginFlowEmbedded?: boolean;
  newPassword: string;
  onBack: () => void;
  onChangeField: (field: keyof PasswordResetFormState, value: string) => void;
  onConfirm: () => void;
  onRequestCode: () => void;
  onResend: () => void;
  resetSession: PasswordResetSession | null;
  safeBottom: number;
  safeTop: number;
};

type InputFieldProps = {
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  editable?: boolean;
  hint?: string;
  icon: string;
  keyboardType?: TextInputProps['keyboardType'];
  label: string;
  maxLength?: number;
  onChangeText: (value: string) => void;
  placeholder: string;
  rightAccessory?: React.ReactNode;
  secureTextEntry?: boolean;
  textContentType?: TextInputProps['textContentType'];
  value: string;
};

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function getRemainingSeconds(target?: string) {
  if (!target) {
    return 0;
  }

  const targetDate = new Date(target);
  const diff = targetDate.getTime() - Date.now();

  if (Number.isNaN(targetDate.getTime()) || diff <= 0) {
    return 0;
  }

  return Math.ceil(diff / 1000);
}

function formatClock(value?: string) {
  if (!value) {
    return '--:--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }

  return date.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function maskEmail(email: string) {
  const [localPart = '', domain = ''] = email.split('@');
  if (!localPart || !domain) {
    return email;
  }

  const start = localPart.slice(0, 2);
  const end = localPart.slice(-1);
  return `${start}${'*'.repeat(
    Math.max(localPart.length - 3, 1),
  )}${end}@${domain}`;
}

function InputField({
  autoCapitalize = 'none',
  autoComplete,
  editable = true,
  hint,
  icon,
  keyboardType,
  label,
  maxLength,
  onChangeText,
  placeholder,
  rightAccessory,
  secureTextEntry = false,
  textContentType,
  value,
}: InputFieldProps) {
  return (
    <View className="mb-4">
      <Text className="mb-2 ml-1 text-[12px] font-[400] tracking-[0.5px] text-[#64748b]">
        {label}
      </Text>
      <View
        className={`min-h-[56px] flex-row items-center rounded-2xl border px-4 ${
          !editable ? 'border-[#f1f5f9] bg-[#f1f5f9]/50' : 'border-[#f1f5f9] bg-[#f8fafc]'
        }`}
      >
        <View className="h-8 w-8 items-center justify-center">
          <FeatherIcon
            color={!editable ? '#94a3b8' : '#ff5a16'}
            name={icon}
            size={18}
          />
        </View>

        <TextInput
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          editable={editable}
          keyboardType={keyboardType}
          maxLength={maxLength}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#94a3b8"
          secureTextEntry={secureTextEntry}
          selectTextOnFocus={editable}
          className="ml-2 flex-1 py-3 text-[15px] font-[400] text-[#0f172a]"
          textContentType={textContentType}
          value={value}
        />

        {rightAccessory}
      </View>
      {hint ? (
        <Text className="ml-1 mt-1.5 text-[11px] font-[300] text-[#94a3b8]">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

function RequirementPill({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  return (
    <View
      className={`flex-row items-center rounded-full border px-3.5 py-2 ${
        active ? 'border-emerald-200/80 bg-emerald-50' : 'border-[#e2e8f0] bg-[#f8fafc]'
      }`}
    >
      <FeatherIcon
        color={active ? '#059669' : '#94a3b8'}
        name={active ? 'check-circle' : 'circle'}
        size={14}
      />
      <Text
        className={`ml-2 text-[12px] font-[500] ${
          active ? 'text-emerald-800' : 'text-[#64748b]'
        }`}
      >
        {label}
      </Text>
    </View>
  );
}

/** Fotoğraf hero yerine: marka uyumlu soyut güvenlik görseli */
function PasswordResetBrandMark({ variant }: { variant: 'challenge' | 'email' }) {
  return (
    <View style={brandStyles.plate} accessibilityRole="image" accessible accessibilityLabel="Güvenli şifre sıfırlama">
      <View style={brandStyles.glowA} />
      <View style={brandStyles.glowB} />
      <View style={brandStyles.gridDot} />
      <View style={[brandStyles.gridDot, brandStyles.gridDot2]} />
      <View style={[brandStyles.gridDot, brandStyles.gridDot3]} />
      <View style={brandStyles.centerStack}>
        <View style={brandStyles.outerRing} />
        <View style={brandStyles.iconCluster}>
          <View style={brandStyles.iconBubble}>
            <FeatherIcon
              color="#ea580c"
              name={variant === 'challenge' ? 'shield' : 'mail'}
              size={variant === 'challenge' ? 36 : 32}
            />
          </View>
          {variant === 'challenge' ? (
            <View style={brandStyles.miniBadge}>
              <FeatherIcon color="#ffffff" name="key" size={14} />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export default function LoginPasswordReset({
  code,
  confirmPassword,
  email,
  emailLocked = false,
  errorMessage,
  infoMessage,
  isSubmitting,
  loginFlowEmbedded = false,
  newPassword,
  onBack,
  onChangeField,
  onConfirm,
  onRequestCode,
  onResend,
  resetSession,
  safeBottom,
  safeTop,
}: LoginPasswordResetProps) {
  const { height: windowHeight } = useWindowDimensions();
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    getRemainingSeconds(resetSession?.resendAvailableAt),
  );

  useEffect(() => {
    setRemainingSeconds(getRemainingSeconds(resetSession?.resendAvailableAt));

    const timer = setInterval(() => {
      setRemainingSeconds(getRemainingSeconds(resetSession?.resendAvailableAt));
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [resetSession?.resendAvailableAt]);

  const hasChallenge = Boolean(resetSession);
  const canRequestCode = isValidEmail(email) && !isSubmitting;
  const confirmDisabled =
    code.trim().length !== 6 ||
    !isPasswordLengthValid(newPassword) ||
    !isPasswordLengthValid(confirmPassword) ||
    newPassword !== confirmPassword ||
    isSubmitting;

  const maskedEmail = useMemo(
    () => maskEmail(resetSession?.email ?? email),
    [email, resetSession?.email],
  );

  const headline = hasChallenge
    ? 'Şifreyi Yenile'
    : 'Şifremi Unuttum';
  const description = hasChallenge
    ? 'E-posta adresinize gelen 6 haneli kodu ve yeni şifrenizi girerek işlemi tamamlayın.'
    : 'E-posta adresinizi girin. Kayıtlı hesabınız için şifre sıfırlama kodu gönderilecektir.';
  const resendLabel =
    remainingSeconds > 0 ? `Yeniden Gönder ${remainingSeconds}s` : 'Kodu Yeniden Gönder';
  const isEmailRequestStage = !hasChallenge;

  const passwordRequirements = [
    {
      active: isPasswordLengthValid(newPassword),
      label: `${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} karakter`,
    },
    {
      active: confirmPassword.length > 0 && newPassword === confirmPassword,
      label: 'Şifreler eşleşiyor',
    },
  ];

  const shellBody = (
    <>
            {!loginFlowEmbedded ? (
              <View className="mb-5">
                <Pressable
                  onPress={onBack}
                  className="h-12 w-12 items-center justify-center rounded-full border border-[#e2e8f0] bg-white active:opacity-75"
                >
                  <FeatherIcon color="#0f172a" name="arrow-left" size={20} />
                </Pressable>
              </View>
            ) : null}

            <PasswordResetBrandMark variant={hasChallenge ? 'challenge' : 'email'} />

            <View className={`mb-6 ${isEmailRequestStage ? 'items-center' : ''}`}>
              <Text
                className={`text-[28px] font-[600] tracking-[-0.4px] text-[#0f172a] ${
                  isEmailRequestStage ? 'text-center' : ''
                }`}
              >
                {headline}
              </Text>
              <Text
                className={`mt-2 text-[15px] font-[400] leading-[22px] text-[#64748b] ${
                  isEmailRequestStage ? 'max-w-[320px] text-center' : ''
                }`}
              >
                {description}
              </Text>
            </View>

            {hasChallenge ? (
              <View className="mb-6 rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3.5">
                <View className="flex-row items-center justify-between">
                  <View className="max-w-[78%]">
                    <Text className="text-[10px] font-[600] uppercase tracking-[1.2px] text-[#94a3b8]">
                      Hedef e-posta
                    </Text>
                    <Text
                      className="mt-0.5 text-[15px] font-[500] text-[#0f172a]"
                      numberOfLines={1}
                      ellipsizeMode="middle"
                    >
                      {maskedEmail}
                    </Text>
                  </View>
                  <View className="h-11 w-11 items-center justify-center rounded-full border border-[#fed7aa] bg-[#fff7ed]">
                    <FeatherIcon color="#ea580c" name="shield" size={20} />
                  </View>
                </View>
                <View className="mt-3 flex-row items-center border-t border-[#e2e8f0] pt-3">
                  <FeatherIcon color="#64748b" name="clock" size={15} />
                  <Text className="ml-2 text-[13px] font-[500] text-[#475569]">
                    Kod geçerliliği: {formatClock(resetSession?.expiresAt)}
                  </Text>
                </View>
              </View>
            ) : null}

            <View
              className={isEmailRequestStage ? 'px-4 py-5' : ''}
              style={isEmailRequestStage ? styles.emailFormCard : undefined}
            >
              {!hasChallenge ? (
                <>
                  <InputField
                    autoCapitalize="none"
                    autoComplete="email"
                    editable={!emailLocked}
                    hint={emailLocked ? 'Profil ayarlarından kilitli' : undefined}
                    icon="mail"
                    keyboardType="email-address"
                    label="E-posta Adresi"
                    onChangeText={value => onChangeField('email', value)}
                    placeholder="ornek@macradar.app"
                    rightAccessory={
                      emailLocked ? (
                        <View className="mr-2">
                          <FeatherIcon color="#94a3b8" name="lock" size={14} />
                        </View>
                      ) : null
                    }
                    textContentType="emailAddress"
                    value={email}
                  />

                  {emailLocked ? (
                    <View className="mb-6 rounded-2xl bg-[#f8fafc] p-4 flex-row items-start">
                      <FeatherIcon color="#ff5a16" name="info" size={16} className="mt-0.5" />
                      <Text className="ml-3 flex-1 text-[13px] font-[300] text-[#64748b]">
                        Bu işlem profil ayarlarınız üzerinden açıldığı için e-posta adresi değiştirilemez.
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : (
                <>
                  <InputField
                    autoCapitalize="none"
                    autoComplete="one-time-code"
                    icon="hash"
                    keyboardType="number-pad"
                    label="Doğrulama Kodu"
                    maxLength={6}
                    onChangeText={value => onChangeField('code', value)}
                    placeholder="6 haneli kod"
                    textContentType="oneTimeCode"
                    value={code}
                  />

                  <InputField
                    autoCapitalize="none"
                    autoComplete="new-password"
                    icon="lock"
                    label="Yeni Şifre"
                    maxLength={PASSWORD_MAX_LENGTH}
                    onChangeText={value => onChangeField('newPassword', value)}
                    placeholder={`${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} karakter`}
                    rightAccessory={
                      <Pressable
                        hitSlop={8}
                        onPress={() => setShowNewPassword(current => !current)}
                        className="mr-2"
                      >
                        <FeatherIcon
                          color="#94a3b8"
                          name={showNewPassword ? 'eye-off' : 'eye'}
                          size={18}
                        />
                      </Pressable>
                    }
                    secureTextEntry={!showNewPassword}
                    textContentType="newPassword"
                    value={newPassword}
                  />

                  <InputField
                    autoCapitalize="none"
                    autoComplete="new-password"
                    icon="check-circle"
                    label="Şifre Tekrar"
                    maxLength={PASSWORD_MAX_LENGTH}
                    onChangeText={value => onChangeField('confirmPassword', value)}
                    placeholder="Yeni şifreyi tekrar girin"
                    rightAccessory={
                      <Pressable
                        hitSlop={8}
                        onPress={() =>
                          setShowConfirmPassword(current => !current)
                        }
                        className="mr-2"
                      >
                        <FeatherIcon
                          color="#94a3b8"
                          name={showConfirmPassword ? 'eye-off' : 'eye'}
                          size={18}
                        />
                      </Pressable>
                    }
                    secureTextEntry={!showConfirmPassword}
                    textContentType="newPassword"
                    value={confirmPassword}
                  />

                  <View className="mb-6 flex-row flex-wrap gap-2.5">
                    {passwordRequirements.map(item => (
                      <RequirementPill
                        key={item.label}
                        active={item.active}
                        label={item.label}
                      />
                    ))}
                  </View>
                </>
              )}

              {infoMessage ? (
                <View className="mb-6 rounded-2xl border border-[#ffd7bf]/60 bg-[#fff8f2]/60 p-4 flex-row items-start">
                  <FeatherIcon color="#ff5a16" name="info" size={16} className="mt-0.5" />
                  <Text className="ml-3 flex-1 text-[13px] font-[300] text-[#8d3f1c]">
                    {infoMessage}
                  </Text>
                </View>
              ) : null}

              {errorMessage ? (
                <View className="mb-6 rounded-2xl border border-red-100 bg-red-50/50 p-4 flex-row items-start">
                  <FeatherIcon color="#ef4444" name="alert-circle" size={16} className="mt-0.5" />
                  <Text className="ml-3 flex-1 text-[13px] font-[300] text-red-900">
                    {errorMessage}
                  </Text>
                </View>
              ) : null}

              {!hasChallenge ? (
                <Pressable
                  disabled={!canRequestCode || isSubmitting}
                  onPress={onRequestCode}
                  className={`h-[56px] flex-row items-center justify-center rounded-full bg-[#ff5a16] ${
                    !canRequestCode || isSubmitting ? 'opacity-40' : ''
                  } active:opacity-90`}
                  style={styles.primaryCta}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <>
                      <Text className="text-[16px] font-[600] text-white">Kod Gönder</Text>
                      <FeatherIcon color="#ffffff" name="arrow-right" size={16} className="ml-2" />
                    </>
                  )}
                </Pressable>
              ) : (
                <View className="gap-3">
                  <Pressable
                    disabled={confirmDisabled || isSubmitting}
                    onPress={onConfirm}
                    className={`h-[56px] flex-row items-center justify-center rounded-full bg-[#ff5a16] ${
                      confirmDisabled || isSubmitting ? 'opacity-40' : ''
                    } active:opacity-90`}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <>
                        <Text className="text-[16px] font-[400] text-white">Şifreyi Güncelle</Text>
                        <FeatherIcon color="#ffffff" name="check" size={16} className="ml-2" />
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
              )}
            </View>
    </>
  );

  if (loginFlowEmbedded) {
    return (
      <View
        style={[
          styles.embeddedRoot,
          isEmailRequestStage && styles.embeddedRootCentered,
        ]}
      >
        <View style={styles.shell}>{shellBody}</View>
      </View>
    );
  }

  const padTop = Math.max(safeTop, 20) + 8;
  const padBottom = Math.max(safeBottom, 24) + 16;
  const scrollMinHeight = Math.max(0, windowHeight - padTop - padBottom);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.screen}
    >
      <View style={styles.screen}>
        <ScrollView
          bounces={false}
          contentContainerStyle={[
            styles.scrollContent,
            {
              minHeight: scrollMinHeight,
              paddingBottom: padBottom,
              paddingTop: padTop,
              justifyContent: isEmailRequestStage ? 'center' : 'flex-start',
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.shell}>{shellBody}</View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  emailFormCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderRadius: 24,
    borderWidth: 1,
    elevation: 5,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 24,
  },
  embeddedRoot: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingVertical: 4,
    width: '100%',
  },
  embeddedRootCentered: {
    justifyContent: 'center',
  },
  primaryCta: {
    elevation: 6,
    shadowColor: '#ea580c',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 10,
  },
  screen: {
    backgroundColor: '#ffffff',
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  shell: {
    maxWidth: 400,
    width: '100%',
  },
});

const brandStyles = StyleSheet.create({
  plate: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRadius: 24,
    justifyContent: 'center',
    marginBottom: 24,
    minHeight: 132,
    overflow: 'visible',
    paddingVertical: 12,
  },
  glowA: {
    backgroundColor: '#ffedd5',
    borderRadius: 80,
    height: 124,
    opacity: 0.75,
    position: 'absolute',
    right: -26,
    top: -34,
    width: 124,
  },
  glowB: {
    backgroundColor: '#bae6fd',
    borderRadius: 72,
    bottom: -34,
    height: 124,
    left: -26,
    opacity: 0.48,
    position: 'absolute',
    width: 124,
  },
  gridDot: {
    backgroundColor: '#cbd5e1',
    borderRadius: 3,
    height: 5,
    opacity: 0.35,
    position: 'absolute',
    right: 28,
    top: 22,
    width: 5,
  },
  gridDot2: {
    right: 38,
    top: 32,
  },
  gridDot3: {
    right: 18,
    top: 30,
  },
  centerStack: {
    alignItems: 'center',
    height: 92,
    justifyContent: 'center',
    width: 92,
    zIndex: 2,
  },
  iconCluster: {
    alignItems: 'center',
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  outerRing: {
    borderColor: 'rgba(234, 88, 12, 0.25)',
    borderRadius: 41,
    borderWidth: 2,
    height: 82,
    position: 'absolute',
    width: 82,
  },
  iconBubble: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderRadius: 36,
    borderWidth: 1,
    elevation: 3,
    height: 72,
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    width: 72,
  },
  miniBadge: {
    alignItems: 'center',
    backgroundColor: '#ea580c',
    borderColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 2,
    bottom: -2,
    elevation: 2,
    height: 28,
    justifyContent: 'center',
    position: 'absolute',
    right: -4,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    width: 28,
  },
});
