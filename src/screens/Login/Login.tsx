import React, {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  Image,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type TextInputProps,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { BlurView } from '@react-native-community/blur';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import FeatherIcon from '../../components/FeatherIcon/FeatherIcon';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  isPasswordLengthValid,
  sanitizeEmailInput,
  sanitizeGenericInput,
  sanitizePasswordInput,
  sanitizeUsernameInput,
  validateUsername,
} from '../../constants/Auth/AuthValidation';
import {
  confirmVerificationCode,
  confirmPasswordReset,
  loginUser,
  registerUser,
  checkUsernameAvailability,
  requestPasswordReset,
  resendVerificationEmail,
} from '../../services/authService';
import { isApiRequestError } from '../../services/apiClient';
import { signInWithSocialProvider } from '../../services/socialAuthAdapter';
import { Text, TextInput } from '../../theme/typography';
import type { AuthResponse, UserStatus } from '../../types/AuthTypes/AuthTypes';
import type {
  AuthSuccessMeta,
  AuthMode,
  AuthStep,
  LoginFormState,
  PasswordResetFormState,
  PasswordResetSession,
  SocialProvider,
  VerificationSession,
} from './Login.types';
import Landing from './landing';
import LoginPasswordReset from './LoginPasswordReset';
import LoginVerification from './LoginVerification';
import {
  createInitialPasswordResetForm,
  normalizeOptionalResetEmail,
  sanitizePasswordResetValue,
} from './passwordResetFlow';

const BRAND_IMAGE_SOURCE = require('../../assets/images/landing_hero.jpg');

type LoginProps = {
  onAuthenticated: (
    response: AuthResponse,
    meta?: AuthSuccessMeta,
  ) => void;
  safeBottom: number;
  safeTop: number;
};

type FeedbackCardProps = {
  message: string;
  tone: 'error' | 'info';
};

type ExistingAccountPrompt = {
  email: string;
  message: string;
};

type UsernameAvailabilityStatus =
  | 'idle'
  | 'loading'
  | 'available'
  | 'taken'
  | 'error';

type UsernameAvailabilityState = {
  checkedUsername: string;
  message: string | null;
  status: UsernameAvailabilityStatus;
};

type ExistingAccountCardProps = ExistingAccountPrompt & {
  onLogin: () => void;
  onReset: () => void;
};

type InputFieldProps = {
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  errorText?: string | null;
  /** Hata çerçevesi; metin gösterilmez (mesaj başka satırda ise). */
  outlineError?: boolean;
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

type AuthFormProps = {
  errorCode: string | null;
  errorMessage: string | null;
  existingAccountPrompt: ExistingAccountPrompt | null;
  form: LoginFormState;
  infoMessage: string | null;
  isSubmitting: boolean;
  mode: AuthMode;
  onChangeField: <Key extends keyof LoginFormState>(
    field: Key,
    value: LoginFormState[Key],
  ) => void;
  onForgotPassword: () => void;
  onLoginWithExistingAccount: (email: string) => void;
  onResetExistingAccount: (email: string) => void;
  onSubmit: () => void;
  onSwitchMode: (mode: AuthMode) => void;
  safeBottom: number;
  safeTop: number;
};

type SceneState = {
  mode: AuthMode;
  step: AuthStep;
};

type SceneTransitionPreset = {
  duration: number;
  easingOut?: (value: number) => number;
  fromOpacity: number;
  fromScale: number;
  fromX: number;
  fromY: number;
};

const INITIAL_LOGIN_FORM: LoginFormState = {
  email: '',
  fullName: '',
  password: '',
  username: '',
};

const REGISTER_STEP_LABELS = ['Profil', 'Hesap'];
/** Üst kahraman görseli ile beyaz kartın kesişimi — içerik bu ofsetten sonra başlar. */
const AUTH_CARD_TOP_OFFSET_RATIO = 0.34;
const USERNAME_CHECK_DEBOUNCE_MS = 400;
const AUTH_SEGMENT_SPRING = { damping: 18, mass: 0.9, stiffness: 220 };

function authLoadingHint(step: AuthStep) {
  switch (step) {
    case 'verify':
      return 'Doğrulanıyor…';
    case 'reset':
      return 'İşlem yapılıyor…';
    default:
      return 'Yükleniyor…';
  }
}
const INITIAL_USERNAME_AVAILABILITY: UsernameAvailabilityState = {
  checkedUsername: '',
  message: null,
  status: 'idle',
};
const IOS_PAGE_TRANSITION_MS = 140;
const TOAST_IN_DURATION_MS = 220;
const TOAST_OUT_DURATION_MS = 180;
const TOAST_VISIBLE_MS = 2200;

const DEFAULT_SCENE_TRANSITION: SceneTransitionPreset = {
  duration: IOS_PAGE_TRANSITION_MS,
  fromOpacity: 0.995,
  fromScale: 1,
  fromX: 0,
  fromY: 8,
};

const styles = StyleSheet.create({
  authSuccessToastCard: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#f1f5f9',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    maxWidth: 390,
    minHeight: 56,
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 5,
  },
  authSuccessToastIconWrap: {
    alignItems: 'center',
    backgroundColor: '#fff7ed',
    borderRadius: 12,
    height: 32,
    justifyContent: 'center',
    marginRight: 12,
    width: 32,
  },
  authSuccessToastText: {
    color: '#0f172a',
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },
  authSuccessToastWrap: {
    alignItems: 'center',
    left: 0,
    paddingHorizontal: 20,
    position: 'absolute',
    right: 0,
    zIndex: 200,
  },
  authBlockingDim: {
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
  },
  authBlockingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 120,
  },
  authLoadingAndroidCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderRadius: 20,
    elevation: 8,
    maxWidth: 280,
    paddingHorizontal: 32,
    paddingVertical: 26,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    width: '100%',
  },
  authLoadingCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  authLoadingHintAndroid: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 16,
    textAlign: 'center',
  },
  authLoadingHintIos: {
    color: 'rgba(255, 255, 255, 0.92)',
    fontSize: 15,
    fontWeight: '500',
    marginTop: 18,
    textAlign: 'center',
  },
  authFormCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderRadius: 24,
    borderWidth: 1,
    elevation: 5,
    marginTop: 4,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 18,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.07,
    shadowRadius: 28,
  },
  authPrimaryOrange: {
    elevation: 6,
    shadowColor: '#ea580c',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
  },
  authPrimarySlate: {
    elevation: 6,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
  },
  authSegmentLabel: {
    color: '#64748b',
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  authSegmentLabelActive: {
    color: '#0f172a',
    fontWeight: '700',
  },
  authSegmentSlot: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 11,
    zIndex: 1,
  },
  authSegmentTrack: {
    backgroundColor: '#f1f5f9',
    borderRadius: 16,
    flexDirection: 'row',
    marginBottom: 6,
    padding: 4,
  },
});

function resolveSceneTransition(
  previous: SceneState,
  next: SceneState,
  _layoutWidth: number,
): SceneTransitionPreset {
  return {
    duration: 340,
    fromOpacity: 0,
    fromScale: 0.992,
    fromX: 0,
    fromY: 10,
  };
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidLoginIdentifier(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes('@')) {
    return isValidEmail(normalized);
  }

  return validateUsername(normalized) === null;
}

function readStringDetail(
  details: Record<string, unknown> | undefined,
  key: string,
) {
  const value = details?.[key];
  return typeof value === 'string' ? value : null;
}

function readStatusDetail(
  details: Record<string, unknown> | undefined,
): UserStatus | null {
  const value = details?.status;
  if (
    value === 'active' ||
    value === 'pending_verification' ||
    value === 'disabled'
  ) {
    return value;
  }

  return null;
}

function getErrorMessage(error: unknown) {
  if (isApiRequestError(error)) {
    if (error.code === 'invalid_username') {
      const reason = readStringDetail(error.details, 'reason');
      if (reason === 'required') {
        return 'Kullanici adi zorunlu.';
      }
      if (reason === 'too_short') {
        return 'Kullanici adi en az 3 karakter olmali.';
      }
      if (reason === 'too_long') {
        return 'Kullanici adi en fazla 20 karakter olabilir.';
      }
      return 'Kullanici adi gecerli degil. Kucuk harf, rakam, nokta ve underscore kullanin.';
    }

    if (error.code === 'email_in_use') {
      return 'Bu email ile yeni hesap açılamıyor. Hesap size aitse giriş yapın veya şifrenizi yenileyin.';
    }

    if (error.code === 'username_taken') {
      return 'Bu kullanici adi alinmis.';
    }

    if (error.code === 'invalid_email_domain') {
      const suggestedEmail = readStringDetail(error.details, 'suggestedEmail');
      if (suggestedEmail) {
        return `Email alan adi hatali gorunuyor. ${suggestedEmail} ile tekrar deneyin.`;
      }
    }

    if (error.code === 'invalid_password_reset_code') {
      const remainingAttempts = error.details?.remainingAttempts;
      if (
        typeof remainingAttempts === 'number' &&
        Number.isFinite(remainingAttempts) &&
        remainingAttempts >= 0
      ) {
        return `${error.message} Kalan deneme: ${remainingAttempts}.`;
      }
    }

    if (error.code === 'invalid_verification_code') {
      const remainingAttempts = error.details?.remainingAttempts;
      if (
        typeof remainingAttempts === 'number' &&
        Number.isFinite(remainingAttempts) &&
        remainingAttempts >= 0
      ) {
        return `${error.message} Kalan deneme: ${remainingAttempts}.`;
      }
    }

    if (error.code === 'account_disabled') {
      return 'Hesap gecici olarak pasif. Destek ile iletisime gecin.';
    }

    if (error.code === 'password_reset_not_allowed') {
      const reason = readStringDetail(error.details, 'reason');
      if (reason === 'not_found') {
        return 'Bu email ile kayıtlı hesap bulunamadı.';
      }
      if (reason === 'disabled') {
        return 'Bu hesap gecici olarak pasif oldugu icin şifre yenileme kapalı.';
      }
      if (reason === 'inactive_or_unverified') {
        return 'Bu hesap su an şifre yenileme icin uygun degil.';
      }
      if (reason === 'not_local') {
        return 'Bu hesap sosyal giris ile bagli. Sifre sifirlama yerine sosyal giris kullanin.';
      }
      if (reason === 'no_password') {
        return 'Bu hesapta aktif sifre yok. Recovery akisindan yeni sifre olusturun.';
      }
      return 'Şifre sıfırlama yalnızca kayıtlı ve erişilebilir hesaplar için açıktır.';
    }

    if (error.code === 'password_reset_email_failed') {
      const reason = readStringDetail(error.details, 'reason');
      return reason
        ? `Kod email ile gonderilemedi. (${reason})`
        : 'Kod email ile gonderilemedi. Biraz sonra tekrar dene.';
    }

    if (error.code === 'verification_email_failed') {
      const reason = readStringDetail(error.details, 'reason');
      return reason
        ? `Dogrulama kodu email ile  Gönderilmedi.(${reason})`
        : 'Dogrulama kodu email ile Gönderilmedi. SMTP ayarlarini kontrol et veya tekrar dene.';
    }

    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return 'İşlem Tamamlanmadı.';
}

function getErrorCode(error: unknown) {
  if (!isApiRequestError(error)) {
    return null;
  }

  return typeof error.code === 'string' && error.code.length > 0
    ? error.code
    : null;
}

function sanitizeLoginFormValue<Key extends keyof LoginFormState>(
  field: Key,
  value: LoginFormState[Key],
): LoginFormState[Key] {
  if (typeof value !== 'string') {
    return value;
  }

  switch (field) {
    case 'email':
      return sanitizeEmailInput(value) as LoginFormState[Key];
    case 'fullName':
      return sanitizeGenericInput(value, 120) as LoginFormState[Key];
    case 'password':
      return sanitizePasswordInput(value) as LoginFormState[Key];
    case 'username':
      return sanitizeUsernameInput(value) as LoginFormState[Key];
    default:
      return value;
  }
}

function buildVerificationSessionFromError(
  error: unknown,
): VerificationSession | null {
  if (!isApiRequestError(error) || error.code !== 'email_not_verified') {
    return null;
  }

  const email = readStringDetail(error.details, 'email');
  const expiresAt = readStringDetail(error.details, 'expiresAt');
  const resendAvailableAt = readStringDetail(error.details, 'resendAvailableAt');

  if (!email || !expiresAt || !resendAvailableAt) {
    return null;
  }

  return {
    email,
    expiresAt,
    message: error.message,
    resendAvailableAt,
    source: 'login',
    status: readStatusDetail(error.details) ?? 'pending_verification',
  };
}

function applyVerificationRateLimit(
  current: VerificationSession | null,
  error: unknown,
) {
  if (
    !current ||
    !isApiRequestError(error) ||
    error.code !== 'verification_resend_rate_limited'
  ) {
    return current;
  }

  const resendAvailableAt = readStringDetail(error.details, 'resendAvailableAt');
  if (!resendAvailableAt) {
    return current;
  }

  return {
    ...current,
    resendAvailableAt,
  };
}

function applyPasswordResetRateLimit(
  current: PasswordResetSession | null,
  error: unknown,
) {
  if (
    !current ||
    !isApiRequestError(error) ||
    error.code !== 'password_reset_rate_limited'
  ) {
    return current;
  }

  const resendAvailableAt = readStringDetail(error.details, 'resendAvailableAt');
  if (!resendAvailableAt) {
    return current;
  }

  return {
    ...current,
    resendAvailableAt,
  };
}

function FeedbackCard({ message, tone }: FeedbackCardProps) {
  const isError = tone === 'error';

  return (
    <View className={`mb-4 flex-row items-start rounded-2xl border px-4 py-3.5 ${isError ? 'border-red-100 bg-red-50/50' : 'border-[#ffd7bf]/60 bg-[#fff8f2]/60'}`}>
      <FeatherIcon color={isError ? '#ef4444' : '#ff5a16'} name={isError ? 'alert-circle' : 'info'} size={16} className="mt-0.5" />
      <Text className={`ml-3 flex-1 text-[13px] font-[300] leading-[20px] ${isError ? 'text-red-900' : 'text-[#8d3f1c]'}`}>
        {message}
      </Text>
    </View>
  );
}

function ExistingAccountCard({
  email,
  message,
  onLogin,
  onReset,
}: ExistingAccountCardProps) {
  return (
    <View className="mb-4 rounded-2xl border border-[#ffd8c2]/70 bg-[#fff8f2]/80 p-4">
      <View className="flex-row items-start">
        <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-[#fff7ed]">
          <FeatherIcon color="#ff5a16" name="shield" size={18} />
        </View>
        <View className="flex-1">
          <Text className="text-[11px] font-[500] uppercase tracking-[1.2px] text-[#94a3b8]">
            Hesap erişimi gerekiyor
          </Text>
          <Text className="mt-1.5 text-[14px] font-[300] leading-[22px] text-[#0f172a]">
            {message}
          </Text>
          <Text className="mt-1 text-[13px] font-[300] text-[#64748b]">{email}</Text>
        </View>
      </View>

      <View className="mt-4 flex-row gap-2">
        <Pressable
          className="h-[52px] flex-1 items-center justify-center rounded-full border border-[#f1f5f9] bg-white active:opacity-75"
          onPress={onReset}
        >
          <Text className="text-[15px] font-[400] text-[#64748b]">Şifre yenile</Text>
        </Pressable>
        <Pressable
          className="h-[52px] flex-1 flex-row items-center justify-center rounded-full bg-[#ff5a16] active:opacity-90"
          onPress={onLogin}
        >
          <Text className="text-[15px] font-[400] text-white">Giriş yap</Text>
          <FeatherIcon color="#ffffff" name="arrow-right" size={16} className="ml-2" />
        </Pressable>
      </View>
    </View>
  );
}

function InputField({
  autoCapitalize = 'none',
  autoComplete,
  errorText,
  outlineError = false,
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
  const hasError = Boolean(errorText) || outlineError;

  return (
    <View className="mb-4">
      <Text className="mb-2 ml-1 text-[12px] font-[400] tracking-[0.5px] text-[#64748b]">
        {label}
      </Text>
      <View
        className={`min-h-[56px] flex-row items-center rounded-2xl border px-4 ${
          hasError
            ? 'border-rose-200 bg-rose-50/40'
            : 'border-[#f1f5f9] bg-[#f8fafc]'
        }`}
      >
        <View className="h-8 w-8 items-center justify-center">
          <FeatherIcon
            color={hasError ? '#ef4444' : '#ff5a16'}
            name={icon}
            size={18}
          />
        </View>
        <TextInput
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          keyboardType={keyboardType}
          maxLength={maxLength}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#94a3b8"
          secureTextEntry={secureTextEntry}
          className="ml-2 flex-1 py-3 text-[15px] font-[400] text-[#0f172a]"
          textContentType={textContentType}
          value={value}
        />
        {rightAccessory}
      </View>
      {errorText ? (
        <Text className="ml-1 mt-1.5 text-[11px] font-[300] text-rose-600">
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}

function AuthModeSegmentTabs({
  mode,
  onSelect,
}: {
  mode: AuthMode;
  onSelect: (next: AuthMode) => void;
}) {
  const trackWidth = useSharedValue(0);
  const selection = useSharedValue(mode === 'login' ? 0 : 1);
  const isRegister = mode === 'register';

  useEffect(() => {
    selection.value = withSpring(mode === 'login' ? 0 : 1, AUTH_SEGMENT_SPRING);
  }, [mode, selection]);

  const pillStyle = useAnimatedStyle(() => {
    const pad = 4;
    const inner = Math.max(trackWidth.value - pad * 2, 0);
    const slot = inner / 2;
    return {
      bottom: pad,
      left: 0,
      position: 'absolute' as const,
      top: pad,
      transform: [{ translateX: pad + selection.value * slot }],
      width: slot,
    };
  });

  return (
    <View
      accessibilityRole="tablist"
      onLayout={e => {
        trackWidth.value = e.nativeEvent.layout.width;
      }}
      style={styles.authSegmentTrack}
    >
      <Reanimated.View
        style={[
          {
            backgroundColor: '#ffffff',
            borderRadius: 12,
            elevation: 2,
            shadowColor: '#0f172a',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.06,
            shadowRadius: 6,
          },
          pillStyle,
        ]}
      />
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: !isRegister }}
        onPress={() => onSelect('login')}
        style={styles.authSegmentSlot}
      >
        <Text
          allowFontScaling={false}
          style={[
            styles.authSegmentLabel,
            !isRegister ? styles.authSegmentLabelActive : null,
          ]}
        >
          Giriş
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: isRegister }}
        onPress={() => onSelect('register')}
        style={styles.authSegmentSlot}
      >
        <Text
          allowFontScaling={false}
          style={[
            styles.authSegmentLabel,
            isRegister ? styles.authSegmentLabelActive : null,
          ]}
        >
          Kayıt ol
        </Text>
      </Pressable>
    </View>
  );
}

function AuthForm({
  errorCode,
  errorMessage,
  existingAccountPrompt,
  form,
  infoMessage,
  isSubmitting,
  mode,
  onChangeField,
  onForgotPassword,
  onLoginWithExistingAccount,
  onResetExistingAccount,
  onSubmit,
  onSwitchMode,
  safeBottom,
  safeTop,
}: AuthFormProps) {
  const { height } = useWindowDimensions();
  const [showPassword, setShowPassword] = useState(false);
  const [registerStep, setRegisterStep] = useState(0);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [touchedFields, setTouchedFields] = useState<
    Record<keyof LoginFormState, boolean>
  >({
    email: false,
    fullName: false,
    password: false,
    username: false,
  });
  const [usernameAvailability, setUsernameAvailability] =
    useState<UsernameAvailabilityState>(INITIAL_USERNAME_AVAILABILITY);
  const stageOpacity = useRef(new Animated.Value(0)).current;
  const stageTranslate = useRef(new Animated.Value(12)).current;
  const isRegister = mode === 'register';
  const isCompact = height < 780;
  const fullNameError =
    form.fullName.trim().length >= 2
      ? null
      : 'Ad soyad zorunlu (en az 2 karakter).';
  const usernameError = validateUsername(form.username);
  const isUsernameAvailabilityCurrent =
    usernameAvailability.checkedUsername === form.username;
  const isUsernameCheckStale =
    usernameError === null && !isUsernameAvailabilityCurrent;
  const isUsernameChecking =
    usernameError === null &&
    isUsernameAvailabilityCurrent &&
    usernameAvailability.status === 'loading';
  const isUsernameTaken =
    usernameError === null &&
    isUsernameAvailabilityCurrent &&
    usernameAvailability.status === 'taken';
  const registerEmailError = isValidEmail(form.email)
    ? null
    : 'Geçerli bir e-posta adresi girin.';
  const registerPasswordError = isPasswordLengthValid(form.password)
    ? null
    : `Şifre ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} karakter olmalı.`;
  const loginEmailError = isValidLoginIdentifier(form.email)
    ? null
    : 'Geçerli bir e-posta veya kullanıcı adı girin.';
  const loginPasswordError =
    form.password.trim().length > 0 ? null : 'Şifre zorunlu.';
  const isRegisterProfileValid =
    fullNameError === null &&
    usernameError === null &&
    !isUsernameCheckStale &&
    !isUsernameChecking &&
    !isUsernameTaken;
  const isRegisterAccountValid =
    registerEmailError === null && registerPasswordError === null;
  const isLoginValid = loginEmailError === null && loginPasswordError === null;
  const showFullNameError =
    isRegister &&
    registerStep === 0 &&
    (attemptedSubmit || touchedFields.fullName)
      ? fullNameError
      : null;
  const showUsernameFormatError =
    isRegister &&
    registerStep === 0 &&
    (attemptedSubmit || touchedFields.username)
      ? usernameError
      : null;
  const showUsernameOutlineError =
    isRegister &&
    registerStep === 0 &&
    (attemptedSubmit || touchedFields.username) &&
    usernameError === null &&
    isUsernameTaken;
  const showRegisterEmailError =
    isRegister &&
    registerStep === 1 &&
    (attemptedSubmit || touchedFields.email)
      ? registerEmailError
      : null;
  const showRegisterPasswordError =
    isRegister &&
    registerStep === 1 &&
    (attemptedSubmit || touchedFields.password)
      ? registerPasswordError
      : null;
  const showLoginEmailError =
    !isRegister && (attemptedSubmit || touchedFields.email)
      ? loginEmailError
      : null;
  const showLoginPasswordError =
    !isRegister && (attemptedSubmit || touchedFields.password)
      ? loginPasswordError
      : null;
  const canSubmit = isRegister
    ? registerStep === 0
      ? isRegisterProfileValid
      : isRegisterAccountValid
    : isLoginValid;
  const subtitle = isRegister
    ? registerStep === 0
      ? 'Profil bilgilerinizi tamamlayın.'
      : 'Hesap bilgilerinizi tamamlayın.'
    : 'Hesabınıza güvenli şekilde giriş yapın.';
  const primaryActionLabel = isRegister
    ? registerStep === 0
      ? 'Devam et'
      : 'Kaydı tamamla'
    : 'Giriş yap';
  const usernameHelperText = 'Küçük harf, rakam ve alt çizgi kullanın.';
  const usernameStatusText =
    usernameError !== null
      ? usernameHelperText
      : isUsernameAvailabilityCurrent &&
          usernameAvailability.status === 'available'
        ? 'Kullanılabilir'
        : isUsernameTaken
          ? usernameAvailability.message || 'Bu kullanıcı adı alınmış.'
          : usernameAvailability.status === 'error' && isUsernameAvailabilityCurrent
            ? usernameAvailability.message
            : usernameHelperText;
  const usernameStatusTone =
    usernameError !== null || isUsernameTaken
      ? 'error'
      : isUsernameAvailabilityCurrent &&
          usernameAvailability.status === 'available'
        ? 'success'
        : 'muted';
  const showExistingAccountPrompt =
    isRegister &&
    registerStep === 1 &&
    existingAccountPrompt !== null &&
    existingAccountPrompt.email.trim().length > 0;

  useEffect(() => {
    setAttemptedSubmit(false);
    setTouchedFields({
      email: false,
      fullName: false,
      password: false,
      username: false,
    });
    if (!isRegister) {
      setRegisterStep(0);
    }
  }, [isRegister]);

  useEffect(() => {
    if (!isRegister || registerStep !== 0 || usernameError !== null) {
      setUsernameAvailability(INITIAL_USERNAME_AVAILABILITY);
      return;
    }

    const username = form.username;
    setUsernameAvailability({
      checkedUsername: username,
      message: null,
      status: 'loading',
    });

    const controller = new AbortController();
    const timer = setTimeout(() => {
      checkUsernameAvailability(username, { signal: controller.signal })
        .then(response => {
          setUsernameAvailability(current => {
            if (current.checkedUsername !== username) {
              return current;
            }
            return {
              checkedUsername: username,
              message: response.available
                ? 'Kullanılabilir'
                : 'Bu kullanıcı adı alınmış.',
              status: response.available ? 'available' : 'taken',
            };
          });
        })
        .catch(error => {
          if (controller.signal.aborted) {
            return;
          }
          setUsernameAvailability(current => {
            if (current.checkedUsername !== username) {
              return current;
            }
            return {
              checkedUsername: username,
              message: isApiRequestError(error)
                ? error.message
                : 'Kullanıcı adı şu an kontrol edilemedi.',
              status: 'error',
            };
          });
        });
    }, USERNAME_CHECK_DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [form.username, isRegister, registerStep, usernameError]);

  useEffect(() => {
    if (!isRegister || errorCode !== 'username_taken') {
      return;
    }

    setRegisterStep(0);
    setTouchedFields(current => ({
      ...current,
      username: true,
    }));
    setUsernameAvailability({
      checkedUsername: form.username,
      message: 'Bu kullanıcı adı alınmış.',
      status: 'taken',
    });
  }, [errorCode, form.username, isRegister]);

  useEffect(() => {
    stageOpacity.setValue(0);
    stageTranslate.setValue(8);

    Animated.parallel([
      Animated.timing(stageOpacity, {
        duration: 120,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(stageTranslate, {
        duration: 120,
        easing: Easing.out(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start();
  }, [isRegister, registerStep, stageOpacity, stageTranslate]);

  function markTouched(field: keyof LoginFormState) {
    setTouchedFields(current => {
      if (current[field]) {
        return current;
      }
      return {
        ...current,
        [field]: true,
      };
    });
  }

  function markManyTouched(fields: Array<keyof LoginFormState>) {
    setTouchedFields(current => {
      let changed = false;
      const next = { ...current };
      for (const field of fields) {
        if (!next[field]) {
          next[field] = true;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }

  function handleFieldChange<Key extends keyof LoginFormState>(
    field: Key,
    value: LoginFormState[Key],
  ) {
    if (attemptedSubmit) {
      setAttemptedSubmit(false);
    }
    markTouched(field);
    onChangeField(field, value);
  }

  function handlePrimaryAction() {
    if (!isRegister) {
      if (!isLoginValid) {
        setAttemptedSubmit(true);
        markManyTouched(['email', 'password']);
        return;
      }
      onSubmit();
      return;
    }

    if (registerStep === 0) {
      if (!isRegisterProfileValid) {
        setAttemptedSubmit(true);
        markManyTouched(['fullName', 'username']);
        return;
      }
      setAttemptedSubmit(false);
      setRegisterStep(1);
      return;
    }

    if (!isRegisterAccountValid) {
      setAttemptedSubmit(true);
      markManyTouched(['email', 'password']);
      return;
    }

    onSubmit();
  }

  function handleStepPress(position: number) {
    if (position <= registerStep) {
      setAttemptedSubmit(false);
      setRegisterStep(position);
      return;
    }

    if (position === 1 && isRegisterProfileValid) {
      setAttemptedSubmit(false);
      setRegisterStep(1);
    }
  }

  function handleModeTabPress(target: AuthMode) {
    if (target === mode) {
      return;
    }
    setRegisterStep(0);
    onSwitchMode(target);
  }

  return (
    <View className="relative w-full pb-1">
      <View className={`mb-6 items-center ${isCompact ? 'mb-5' : ''}`}>
        <View className="flex-row items-end justify-center">
          <Text
            allowFontScaling={false}
            className="text-[40px] font-[300] tracking-[-0.5px] text-[#0f172a]"
          >
            Mac
          </Text>
          <Text
            allowFontScaling={false}
            className="ml-1.5 mb-1 text-[22px] font-[300] text-[#64748b]"
          >
            Radar
          </Text>
        </View>
        <Text className="mt-3 max-w-[320px] text-center text-[16px] font-[300] leading-[24px] text-[#64748b]">
          {subtitle}
        </Text>
      </View>

      <View
        style={{
          paddingBottom: Math.max(safeBottom, 12),
        }}
      >
        <View className="mx-auto w-full max-w-[400px]">
          <AuthModeSegmentTabs mode={mode} onSelect={handleModeTabPress} />

          <View style={styles.authFormCard}>
              {isRegister ? (
                <View className="mb-6 flex-row gap-2">
                  {REGISTER_STEP_LABELS.map((label, index) => {
                    const isActive = registerStep === index;
                    const isCompleted = registerStep > index;
                    const isEnabled =
                      index <= registerStep || (index === 1 && isRegisterProfileValid);
                    const stepCardClass = isActive
                      ? 'border-[#ff5a16]/40 bg-[#fff7ed]/80'
                      : isCompleted
                        ? 'border-[#f1f5f9] bg-[#f8fafc]'
                        : 'border-[#f1f5f9] bg-[#f8fafc]/60';
                    const stepDotClass = isActive
                      ? 'bg-[#ff5a16]'
                      : isCompleted
                        ? 'bg-[#0f172a]'
                        : 'bg-[#cbd5e1]';

                    return (
                      <Pressable
                        key={label}
                        className={`flex-1 rounded-2xl border px-3 py-2.5 ${stepCardClass} ${!isEnabled ? 'opacity-55' : ''}`}
                        disabled={!isEnabled}
                        onPress={() => handleStepPress(index)}
                      >
                        <View className="flex-row items-center">
                          <View
                            className={`mr-2.5 h-6 w-6 items-center justify-center rounded-full ${stepDotClass}`}
                          >
                            <Text className="text-[11px] font-[400] text-white">
                              {index + 1}
                            </Text>
                          </View>
                          <Text
                            className={`text-[12px] font-[400] ${isActive ? 'text-[#c2410c]' : 'text-[#64748b]'}`}
                          >
                            {label}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {infoMessage ? (
                <FeedbackCard message={infoMessage} tone="info" />
              ) : null}
              {showExistingAccountPrompt && existingAccountPrompt ? (
                <ExistingAccountCard
                  email={existingAccountPrompt.email}
                  message={existingAccountPrompt.message}
                  onLogin={() =>
                    onLoginWithExistingAccount(existingAccountPrompt.email)
                  }
                  onReset={() =>
                    onResetExistingAccount(existingAccountPrompt.email)
                  }
                />
              ) : errorMessage ? (
                <FeedbackCard message={errorMessage} tone="error" />
              ) : null}

              <Animated.View
                className="w-full"
                style={{
                  opacity: stageOpacity,
                  transform: [{ translateX: stageTranslate }],
                }}
              >
                {isRegister ? (
                  registerStep === 0 ? (
                    <>
                      <InputField
                        autoCapitalize="words"
                        autoComplete="name"
                        errorText={showFullNameError}
                        icon="user"
                        label="Ad soyad"
                        maxLength={120}
                        onChangeText={value =>
                          handleFieldChange('fullName', value)
                        }
                        placeholder="Adın ve soyadın"
                        textContentType="name"
                        value={form.fullName}
                      />
                      <InputField
                        autoCapitalize="none"
                        autoComplete="username"
                        errorText={showUsernameFormatError}
                        maxLength={20}
                        outlineError={showUsernameOutlineError}
                        icon="user-check"
                        label="Kullanıcı adı"
                        onChangeText={value =>
                          handleFieldChange('username', value)
                        }
                        placeholder="ornek: ozcanakbas"
                        rightAccessory={
                          isUsernameAvailabilityCurrent &&
                          usernameAvailability.status === 'loading' ? (
                            <View className="mr-2 h-8 w-8 items-center justify-center">
                              <ActivityIndicator color="#64748b" size="small" />
                            </View>
                          ) : isUsernameAvailabilityCurrent &&
                            usernameAvailability.status === 'available' ? (
                            <View className="mr-2 h-8 w-8 items-center justify-center rounded-full bg-emerald-50/80">
                              <FeatherIcon
                                color="#16a34a"
                                name="check"
                                size={18}
                              />
                            </View>
                          ) : null
                        }
                        textContentType="username"
                        value={form.username}
                      />
                      <View className="-mt-2 mb-1 flex-row items-center justify-between px-1">
                        <View className="mr-2 flex-1 flex-row items-center">
                          {usernameStatusTone === 'success' ? (
                            <FeatherIcon
                              color="#16a34a"
                              name="check-circle"
                              size={12}
                            />
                          ) : null}
                          <Text
                            className={`${
                              usernameStatusTone === 'success'
                                ? 'ml-1 text-emerald-600'
                                : usernameStatusTone === 'error'
                                  ? 'text-red-600'
                                  : 'text-[#64748b]'
                            } flex-1 text-[12px] font-[300]`}
                          >
                            {usernameStatusText || usernameHelperText}
                          </Text>
                        </View>
                        <Text className="text-[12px] font-[300] text-[#94a3b8]">
                          {form.username.length} / 20
                        </Text>
                      </View>
                    </>
                  ) : (
                    <>
                      <InputField
                        autoCapitalize="none"
                        autoComplete="email"
                        errorText={showRegisterEmailError}
                        icon="mail"
                        keyboardType="email-address"
                        label="E-posta adresi"
                        onChangeText={value => handleFieldChange('email', value)}
                        placeholder="ornek@macradar.app"
                        textContentType="emailAddress"
                        value={form.email}
                      />
                      <InputField
                        autoCapitalize="none"
                        autoComplete="new-password"
                        errorText={showRegisterPasswordError}
                        icon="lock"
                        label="Şifre"
                        maxLength={PASSWORD_MAX_LENGTH}
                        onChangeText={value =>
                          handleFieldChange('password', value)
                        }
                        placeholder={`${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} karakter`}
                        rightAccessory={
                          <Pressable
                            className="mr-2"
                            hitSlop={8}
                            onPress={() => setShowPassword(current => !current)}
                          >
                            <FeatherIcon
                              color="#94a3b8"
                              name={showPassword ? 'eye-off' : 'eye'}
                              size={18}
                            />
                          </Pressable>
                        }
                        secureTextEntry={!showPassword}
                        textContentType="newPassword"
                        value={form.password}
                      />
                    </>
                  )
                ) : (
                  <>
                    <InputField
                      autoCapitalize="none"
                      autoComplete="username"
                      errorText={showLoginEmailError}
                      icon="at-sign"
                      label="E-posta veya kullanıcı adı"
                      onChangeText={value => handleFieldChange('email', value)}
                      placeholder="mail@ornek.com veya kullanici_adi"
                      textContentType="username"
                      value={form.email}
                    />
                    <InputField
                      autoCapitalize="none"
                      autoComplete="password"
                      errorText={showLoginPasswordError}
                      icon="lock"
                      label="Şifre"
                      onChangeText={value => handleFieldChange('password', value)}
                      placeholder="Şifreniz"
                      rightAccessory={
                        <Pressable
                          className="mr-2"
                          hitSlop={8}
                          onPress={() => setShowPassword(current => !current)}
                        >
                          <FeatherIcon
                            color="#94a3b8"
                            name={showPassword ? 'eye-off' : 'eye'}
                            size={18}
                          />
                        </Pressable>
                      }
                      secureTextEntry={!showPassword}
                      textContentType="password"
                      value={form.password}
                    />
                  </>
                )}
                </Animated.View>

              <View className={`mt-6 gap-3 ${isRegister && registerStep === 1 ? 'flex-row items-center' : ''}`}>
                {isRegister && registerStep === 1 ? (
                  <Pressable
                    onPress={() => {
                      setRegisterStep(0);
                    }}
                    className="h-[56px] w-[100px] items-center justify-center rounded-full border border-[#f1f5f9] bg-white active:opacity-75"
                  >
                    <Text className="text-[15px] font-[400] text-[#64748b]">
                      Önceki
                    </Text>
                  </Pressable>
                ) : null}

                <Pressable
                  disabled={isSubmitting || !canSubmit}
                  onPress={handlePrimaryAction}
                  className={`h-[56px] flex-row items-center justify-center rounded-full ${
                    isRegister ? 'bg-[#ff5a16]' : 'bg-[#0f172a]'
                  } ${isSubmitting || !canSubmit ? 'opacity-40' : ''} ${
                    isRegister && registerStep === 1 ? 'flex-1' : ''
                  } active:opacity-90`}
                  style={
                    isRegister ? styles.authPrimaryOrange : styles.authPrimarySlate
                  }
                >
                  <>
                    <Text className="text-[16px] font-[600] text-white">
                      {primaryActionLabel}
                    </Text>
                    <FeatherIcon
                      color="#ffffff"
                      name="arrow-right"
                      size={16}
                      className="ml-2"
                    />
                  </>
                </Pressable>
              </View>

              {isRegister ? (
                <Text className="mt-4 text-center text-[12px] font-[300] leading-[18px] text-[#94a3b8]">
                  Kayıt sonunda doğrulama kodu e-posta adresinize gönderilir.
                </Text>
              ) : (
                <View className="mt-4 w-full flex-row justify-end">
                  <Pressable
                    onPress={onForgotPassword}
                    className="active:opacity-70"
                  >
                    <Text className="text-[14px] font-[500] text-[#ff5a16]">
                      Şifremi unuttum?
                    </Text>
                  </Pressable>
                </View>
              )}
          </View>
            </View>
          </View>
    </View>
  );
}

type AuthFormModeCrossfadeProps = AuthFormProps & { layoutWidth: number };

function AuthFormModeCrossfade({
  layoutWidth,
  mode,
  ...rest
}: AuthFormModeCrossfadeProps) {
  const lastModeRef = useRef(mode);
  const [outgoingMode, setOutgoingMode] = useState<AuthMode | null>(null);
  const outOpacity = useRef(new Animated.Value(1)).current;
  const outTranslateX = useRef(new Animated.Value(0)).current;
  const inOpacity = useRef(new Animated.Value(1)).current;
  const inTranslateX = useRef(new Animated.Value(0)).current;

  useLayoutEffect(() => {
    if (lastModeRef.current === mode) {
      return;
    }
    const fromMode = lastModeRef.current;
    lastModeRef.current = mode;

    const slide = Math.round(
      Math.min(64, Math.max(32, layoutWidth * 0.085)),
    );
    const toRegister = mode === 'register';

    outOpacity.setValue(1);
    outTranslateX.setValue(0);
    inOpacity.setValue(0);
    inTranslateX.setValue(toRegister ? slide : -slide);

    setOutgoingMode(fromMode);

    const easingIn = Easing.bezier(0.22, 1, 0.36, 1);
    const parallel = Animated.parallel([
      Animated.timing(outOpacity, {
        duration: 240,
        easing: Easing.out(Easing.quad),
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(outTranslateX, {
        duration: 270,
        easing: Easing.out(Easing.cubic),
        toValue: toRegister ? -slide * 0.5 : slide * 0.5,
        useNativeDriver: true,
      }),
      Animated.timing(inOpacity, {
        delay: 45,
        duration: 300,
        easing: easingIn,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(inTranslateX, {
        delay: 45,
        duration: 300,
        easing: easingIn,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]);

    parallel.start(({ finished }) => {
      if (finished) {
        setOutgoingMode(null);
        inOpacity.setValue(1);
        inTranslateX.setValue(0);
      }
    });

    return () => {
      parallel.stop();
    };
  }, [mode, layoutWidth, inOpacity, inTranslateX, outOpacity, outTranslateX]);

  const showOutgoing = outgoingMode !== null;

  return (
    <View style={{ position: 'relative' }}>
      {showOutgoing ? (
        <Animated.View
          pointerEvents="none"
          style={{
            left: 0,
            opacity: outOpacity,
            position: 'absolute',
            right: 0,
            top: 0,
            transform: [{ translateX: outTranslateX }],
            zIndex: 2,
          }}
        >
          <AuthForm {...rest} mode={outgoingMode} />
        </Animated.View>
      ) : null}
      <Animated.View
        style={{
          opacity: showOutgoing ? inOpacity : 1,
          transform: showOutgoing ? [{ translateX: inTranslateX }] : [],
          zIndex: 1,
        }}
      >
        <AuthForm {...rest} mode={mode} />
      </Animated.View>
    </View>
  );
}

export default function Login({
  onAuthenticated,
  safeBottom,
  safeTop,
}: LoginProps) {
  const { width: windowWidth, height } = useWindowDimensions();
  const [mode, setMode] = useState<AuthMode>('login');
  const [step, setStep] = useState<AuthStep>('landing');
  const [form, setForm] = useState<LoginFormState>(INITIAL_LOGIN_FORM);
  const [verificationSession, setVerificationSession] =
    useState<VerificationSession | null>(null);
  const [resetForm, setResetForm] = useState<PasswordResetFormState>(() =>
    createInitialPasswordResetForm(),
  );
  const [resetSession, setResetSession] = useState<PasswordResetSession | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [socialLoading, setSocialLoading] = useState<SocialProvider | null>(
    null,
  );
  const [existingAccountPrompt, setExistingAccountPrompt] =
    useState<ExistingAccountPrompt | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [successToastMessage, setSuccessToastMessage] = useState<string | null>(
    null,
  );
  const [successToastTick, setSuccessToastTick] = useState(0);
  const [authKeyboardOpen, setAuthKeyboardOpen] = useState(false);
  const submitLockRef = useRef(false);
  const successToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(-10)).current;
  const verifiedEmailForNextLoginRef = useRef<string | null>(null);
  const screenOpacity = useRef(new Animated.Value(1)).current;
  const screenScale = useRef(new Animated.Value(1)).current;
  const screenTranslateX = useRef(new Animated.Value(0)).current;
  const screenTranslateY = useRef(new Animated.Value(0)).current;
  const previousSceneRef = useRef<SceneState | null>(null);
  const latestAuthNavRef = useRef({
    openLanding: () => {},
    returnFromReset: () => {},
    returnFromVerification: () => {},
    step: 'landing' as AuthStep,
  });

  function clearFeedback() {
    setErrorCode(null);
    setErrorMessage(null);
    setInfoMessage(null);
  }

  function openLanding() {
    setStep('landing');
    clearFeedback();
    setIsSubmitting(false);
    setSocialLoading(null);
  }

  function openForm(nextMode: AuthMode) {
    clearFeedback();
    setExistingAccountPrompt(null);
    setMode(nextMode);
    setStep('form');
  }

  function openLoginFormWithEmail(email: string) {
    const normalizedEmail = sanitizeEmailInput(email);
    clearFeedback();
    setExistingAccountPrompt(null);
    setMode('login');
    setStep('form');
    setForm(current => ({
      ...current,
      email: normalizedEmail,
      password: '',
    }));
  }

  function openReset(email?: string) {
    const nextEmail = normalizeOptionalResetEmail(email ?? form.email);
    clearFeedback();
    setResetSession(null);
    setStep('reset');
    setResetForm(createInitialPasswordResetForm(nextEmail));
  }

  function returnFromVerification() {
    clearFeedback();
    setStep('form');
    setMode('login');
    if (verificationSession?.email) {
      setForm(current => ({
        ...current,
        email: sanitizeEmailInput(verificationSession.email),
      }));
    }
  }

  function returnFromReset() {
    clearFeedback();
    setStep('form');
    setMode('login');
    if (resetForm.email.trim().length > 0) {
      setForm(current => ({
        ...current,
        email: sanitizeEmailInput(resetForm.email),
      }));
    }
  }

  function updateFormField<Key extends keyof LoginFormState>(
    field: Key,
    value: LoginFormState[Key],
  ) {
    setForm(current => ({
      ...current,
      [field]: sanitizeLoginFormValue(field, value),
    }));
  }

  function updateResetField<Key extends keyof PasswordResetFormState>(
    field: Key,
    value: PasswordResetFormState[Key],
  ) {
    setResetForm(current => ({
      ...current,
      [field]: sanitizePasswordResetValue(field, value),
    }));
  }

  async function handleSocial(provider: SocialProvider) {
    if (socialLoading !== null || isSubmitting) {
      return;
    }

    clearFeedback();
    setExistingAccountPrompt(null);
    setSocialLoading(provider);
    try {
      const response = await signInWithSocialProvider({ provider });
      onAuthenticated(response, { showMoodPrompt: true });
    } catch (error) {
      setFeedbackError(error);
    } finally {
      setSocialLoading(null);
    }
  }

  async function handleSubmit() {
    if (submitLockRef.current || isSubmitting || socialLoading !== null) {
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    clearFeedback();
    setExistingAccountPrompt(null);

    try {
      if (mode === 'register') {
        const challenge = await registerUser({
          city: 'Istanbul',
          email: sanitizeEmailInput(form.email),
          favoriteCar: 'Belirtilmedi',
          fullName: sanitizeGenericInput(form.fullName, 120),
          password: sanitizePasswordInput(form.password),
          username: sanitizeUsernameInput(form.username),
        });
        setVerificationSession({ ...challenge, source: 'register' });
        setStep('verify');
        setInfoMessage(challenge.message || 'Dogrulama kodu email adresine gonderildi.');
        return;
      }

      const response = await loginUser({
        email: sanitizeEmailInput(form.email),
        identifier: sanitizeEmailInput(form.email),
        password: sanitizePasswordInput(form.password),
      });
      onAuthenticated(response, { showMoodPrompt: true });
    } catch (error) {
      const verificationFromError = buildVerificationSessionFromError(error);
      if (verificationFromError) {
        setVerificationSession(verificationFromError);
        setStep('verify');
        return;
      }

      if (mode === 'register' && errorCode !== 'email_in_use') {
        if (
          isApiRequestError(error) &&
          error.code === 'email_in_use' &&
          form.email.trim().length > 0
        ) {
          setExistingAccountPrompt({
            email: sanitizeEmailInput(form.email),
            message: getErrorMessage(error),
          });
        }
      }

      setFeedbackError(error);
    } finally {
      setIsSubmitting(false);
      submitLockRef.current = false;
    }
  }

  async function handleResendVerification() {
    if (!verificationSession || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    try {
      const response = await resendVerificationEmail({
        email: verificationSession.email,
      });
      setVerificationSession(current => {
        if (!current) {
          return null;
        }
        return {
          ...current,
          ...response,
        };
      });
      setInfoMessage(response.message);
    } catch (error) {
      setVerificationSession(current => applyVerificationRateLimit(current, error));
      setFeedbackError(error);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmVerification(code: string) {
    if (!verificationSession || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    try {
      const response = await confirmVerificationCode({
        code,
        email: verificationSession.email,
      });
      if (response.auth) {
        onAuthenticated(response.auth, { showMoodPrompt: true });
        return;
      }

      verifiedEmailForNextLoginRef.current = verificationSession.email;
      setMode('login');
      setStep('form');
      setForm(current => ({
        ...current,
        email: sanitizeEmailInput(verificationSession.email),
      }));
      setVerificationSession(null);
      setInfoMessage(response.message || 'Email dogrulandi. Simdi giris yapabilirsin.');
      showSuccessToast('Email dogrulandi');
    } catch (error) {
      setFeedbackError(error);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRequestPasswordReset() {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    try {
      const response = await requestPasswordReset({
        email: sanitizeEmailInput(resetForm.email),
      });
      setResetSession(response);
      setResetForm(current => ({
        ...current,
        code: '',
        confirmPassword: '',
        email: sanitizeEmailInput(response.email || current.email),
        newPassword: '',
      }));
      setInfoMessage(response.message);
    } catch (error) {
      setResetSession(current => applyPasswordResetRateLimit(current, error));
      setFeedbackError(error);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendPasswordReset() {
    if (isSubmitting) {
      return;
    }

    const email = sanitizeEmailInput(resetSession?.email ?? resetForm.email);
    if (!email) {
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    try {
      const response = await requestPasswordReset({ email });
      setResetSession(response);
      setInfoMessage(response.message);
    } catch (error) {
      setResetSession(current => applyPasswordResetRateLimit(current, error));
      setFeedbackError(error);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmPasswordReset() {
    if (isSubmitting) {
      return;
    }

    const email = sanitizeEmailInput(resetSession?.email ?? resetForm.email);
    const code = resetForm.code.trim();
    const newPassword = sanitizePasswordInput(resetForm.newPassword);
    if (!email || !code || !newPassword) {
      setFeedbackError(new Error('Tum sifre yenileme alanlari zorunlu.'));
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    try {
      const response = await confirmPasswordReset({
        code,
        email,
        newPassword,
      });
      setResetSession(null);
      setResetForm(createInitialPasswordResetForm(email));
      setMode('login');
      setStep('form');
      setForm(current => ({
        ...current,
        email,
        password: '',
      }));
      showSuccessToast('Şifre Güncellendi');
      setInfoMessage(response.message || 'Şifre Güncellendi, giriş yapabilirsin.');
    } catch (error) {
      setFeedbackError(error);
    } finally {
      setIsSubmitting(false);
    }
  }

  function showSuccessToast(message: string) {
    setSuccessToastMessage(message);
    setSuccessToastTick(current => current + 1);
  }

  function setFeedbackError(error: unknown) {
    setErrorCode(getErrorCode(error));
    setErrorMessage(getErrorMessage(error));
  }

  useEffect(() => {
    const nextScene = { mode, step };
    const previousScene = previousSceneRef.current;

    if (!previousScene) {
      previousSceneRef.current = nextScene;
      return;
    }

    if (
      previousScene.step === 'form' &&
      nextScene.step === 'form' &&
      previousScene.mode !== nextScene.mode
    ) {
      previousSceneRef.current = nextScene;
      screenOpacity.setValue(1);
      screenScale.setValue(1);
      screenTranslateX.setValue(0);
      screenTranslateY.setValue(0);
      return;
    }

    const transition = resolveSceneTransition(
      previousScene,
      nextScene,
      windowWidth,
    );
    const easingOut = transition.easingOut ?? Easing.out(Easing.cubic);
    screenOpacity.stopAnimation();
    screenScale.stopAnimation();
    screenTranslateX.stopAnimation();
    screenTranslateY.stopAnimation();

    screenOpacity.setValue(transition.fromOpacity);
    screenScale.setValue(transition.fromScale);
    screenTranslateX.setValue(transition.fromX);
    screenTranslateY.setValue(transition.fromY);

    Animated.parallel([
      Animated.timing(screenOpacity, {
        duration: transition.duration,
        easing: easingOut,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(screenScale, {
        duration: transition.duration,
        easing: easingOut,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(screenTranslateX, {
        duration: transition.duration,
        easing: easingOut,
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(screenTranslateY, {
        duration: transition.duration,
        easing: easingOut,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start();

    previousSceneRef.current = nextScene;
  }, [
    mode,
    step,
    windowWidth,
    screenOpacity,
    screenScale,
    screenTranslateX,
    screenTranslateY,
  ]);

  useEffect(() => {
    // Avoid blank UI if verification session state is lost mid-flow.
    if (step !== 'verify' || verificationSession) {
      return;
    }

    setMode('login');
    setStep('form');
    setInfoMessage(current =>
      current && current.trim().length > 0
        ? current
        : 'Dogrulama oturumu bulunamadi. Lutfen tekrar giris yapin.',
    );
  }, [step, verificationSession]);

  useEffect(() => {
    if (!successToastMessage) {
      return;
    }

    if (successToastTimerRef.current) {
      clearTimeout(successToastTimerRef.current);
      successToastTimerRef.current = null;
    }

    toastOpacity.stopAnimation();
    toastTranslateY.stopAnimation();
    toastOpacity.setValue(0);
    toastTranslateY.setValue(-10);

    Animated.parallel([
      Animated.timing(toastOpacity, {
        duration: TOAST_IN_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(toastTranslateY, {
        duration: TOAST_IN_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start();

    successToastTimerRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(toastOpacity, {
          duration: TOAST_OUT_DURATION_MS,
          easing: Easing.in(Easing.cubic),
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.timing(toastTranslateY, {
          duration: TOAST_OUT_DURATION_MS,
          easing: Easing.in(Easing.cubic),
          toValue: -8,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          setSuccessToastMessage(null);
        }
      });
      successToastTimerRef.current = null;
    }, TOAST_VISIBLE_MS);
  }, [successToastMessage, successToastTick, toastOpacity, toastTranslateY]);

  useEffect(() => {
    return () => {
      if (successToastTimerRef.current) {
        clearTimeout(successToastTimerRef.current);
        successToastTimerRef.current = null;
      }
      toastOpacity.stopAnimation();
      toastTranslateY.stopAnimation();
    };
  }, [toastOpacity, toastTranslateY]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const nav = latestAuthNavRef.current;
      if (nav.step === 'landing') {
        return false;
      }
      if (nav.step === 'form') {
        nav.openLanding();
      } else if (nav.step === 'verify') {
        nav.returnFromVerification();
      } else if (nav.step === 'reset') {
        nav.returnFromReset();
      }
      return true;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (step === 'landing') {
      setAuthKeyboardOpen(false);
      return;
    }

    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => {
      setAuthKeyboardOpen(true);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setAuthKeyboardOpen(false);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [step]);

  const animatedScreenStyle = {
    backgroundColor: 'transparent' as const,
    flex: 1,
    opacity: screenOpacity,
    transform: [
      { translateX: screenTranslateX },
      { translateY: screenTranslateY },
      { scale: screenScale },
    ],
    zIndex: 1,
  };

  function handleHeroBack() {
    if (step === 'form') {
      openLanding();
      return;
    }
    if (step === 'verify') {
      returnFromVerification();
      return;
    }
    if (step === 'reset') {
      returnFromReset();
    }
  }

  const authKeyboardExtra =
    Platform.OS === 'android' ? 160 : Platform.OS === 'ios' ? 80 : 72;

  latestAuthNavRef.current = {
    step,
    openLanding,
    returnFromVerification,
    returnFromReset,
  };

  const showAuthHero = step === 'form' || step === 'verify';
  const authScrollTopPad = showAuthHero
    ? height * AUTH_CARD_TOP_OFFSET_RATIO
    : Math.max(safeTop, 12) + 8;

  return (
    <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
      {showAuthHero ? (
        <View
          pointerEvents="none"
          style={{
            height: height * 0.45,
            left: 0,
            position: 'absolute',
            right: 0,
            top: 0,
            zIndex: 0,
          }}
        >
          <Image
            resizeMode="cover"
            source={BRAND_IMAGE_SOURCE}
            style={{ height: '100%', width: '100%' }}
          />
          <View className="absolute inset-0 bg-black/20" />
        </View>
      ) : null}

      <Animated.View style={animatedScreenStyle}>
        {step === 'landing' ? (
          <Landing
            errorMessage={errorMessage}
            infoMessage={infoMessage}
            isBusy={socialLoading !== null}
            onOpenLogin={() => openForm('login')}
            onOpenRegister={() => openForm('register')}
            onSocial={handleSocial}
            safeBottom={safeBottom}
            safeTop={safeTop}
            socialLoading={socialLoading}
          />
        ) : (
          <KeyboardAwareScrollView
            bounces={authKeyboardOpen}
            contentContainerStyle={{
              flexGrow: 1,
              paddingBottom: 0,
              paddingTop: authScrollTopPad,
            }}
            enableAutomaticScroll={authKeyboardOpen}
            enableOnAndroid
            extraHeight={authKeyboardExtra}
            extraScrollHeight={authKeyboardExtra}
            keyboardDismissMode={authKeyboardOpen ? 'on-drag' : 'none'}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled={authKeyboardOpen}
            scrollEnabled={authKeyboardOpen}
            showsVerticalScrollIndicator={authKeyboardOpen}
            style={{ flex: 1, backgroundColor: 'transparent' }}
          >
            <View
              className={
                showAuthHero
                  ? 'w-full flex-grow rounded-t-[40px] bg-white px-8 pt-10'
                  : 'w-full flex-grow bg-white px-6 pt-2'
              }
              style={{
                flexGrow: 1,
                minHeight: showAuthHero
                  ? height * (1 - AUTH_CARD_TOP_OFFSET_RATIO)
                  : undefined,
                paddingBottom: Math.max(safeBottom, 20),
                shadowColor: '#000',
                shadowOffset: { width: 0, height: -10 },
                shadowOpacity: showAuthHero ? 0.05 : 0,
                shadowRadius: 20,
                elevation: showAuthHero ? 10 : 0,
              }}
            >
              {step === 'verify' && verificationSession ? (
                <LoginVerification
                  email={verificationSession.email}
                  errorMessage={errorMessage}
                  expiresAt={verificationSession.expiresAt}
                  infoMessage={infoMessage}
                  isSubmitting={isSubmitting}
                  loginFlowEmbedded
                  onBack={returnFromVerification}
                  onConfirm={handleConfirmVerification}
                  onResend={handleResendVerification}
                  resendAvailableAt={verificationSession.resendAvailableAt}
                  safeBottom={0}
                  safeTop={0}
                  source={verificationSession.source}
                />
              ) : step === 'reset' ? (
                <LoginPasswordReset
                  code={resetForm.code}
                  confirmPassword={resetForm.confirmPassword}
                  email={resetForm.email}
                  errorMessage={errorMessage}
                  infoMessage={infoMessage}
                  isSubmitting={isSubmitting}
                  loginFlowEmbedded
                  newPassword={resetForm.newPassword}
                  onBack={returnFromReset}
                  onChangeField={updateResetField}
                  onConfirm={handleConfirmPasswordReset}
                  onRequestCode={handleRequestPasswordReset}
                  onResend={handleResendPasswordReset}
                  resetSession={resetSession}
                  safeBottom={0}
                  safeTop={0}
                />
              ) : step === 'form' ? (
                <AuthFormModeCrossfade
                  layoutWidth={windowWidth}
                  errorCode={errorCode}
                  errorMessage={errorMessage}
                  existingAccountPrompt={existingAccountPrompt}
                  form={form}
                  infoMessage={infoMessage}
                  isSubmitting={isSubmitting}
                  mode={mode}
                  onChangeField={updateFormField}
                  onForgotPassword={() => openReset()}
                  onLoginWithExistingAccount={openLoginFormWithEmail}
                  onResetExistingAccount={email => openReset(email)}
                  onSubmit={handleSubmit}
                  onSwitchMode={nextMode => {
                    clearFeedback();
                    setMode(nextMode);
                  }}
                  safeBottom={0}
                  safeTop={0}
                />
              ) : null}
            </View>
          </KeyboardAwareScrollView>
        )}
      </Animated.View>

      {isSubmitting &&
      (step === 'form' || step === 'verify' || step === 'reset') ? (
        <View style={styles.authBlockingOverlay} pointerEvents="auto">
          <BlurView
            blurAmount={Platform.OS === 'ios' ? 28 : 22}
            blurType="dark"
            reducedTransparencyFallbackColor="rgba(15, 23, 42, 0.82)"
            style={StyleSheet.absoluteFill}
          />
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.authBlockingDim]}
          />
          <View style={styles.authLoadingCenter} pointerEvents="box-none">
            {Platform.OS === 'ios' ? (
              <>
                <ActivityIndicator color="#ffffff" size="large" />
                <Text
                  allowFontScaling={false}
                  style={styles.authLoadingHintIos}
                >
                  {authLoadingHint(step)}
                </Text>
              </>
            ) : (
              <View style={styles.authLoadingAndroidCard}>
                <ActivityIndicator color="#ff5a16" size="large" />
                <Text
                  allowFontScaling={false}
                  style={styles.authLoadingHintAndroid}
                >
                  {authLoadingHint(step)}
                </Text>
              </View>
            )}
          </View>
        </View>
      ) : null}

      {step !== 'landing' ? (
        <Pressable
          accessibilityLabel="Geri"
          accessibilityRole="button"
          className="h-12 w-12 items-center justify-center rounded-full active:opacity-85"
          hitSlop={12}
          onPress={handleHeroBack}
          style={{
            backgroundColor:
              step === 'reset' ? '#ffffff' : 'rgba(0,0,0,0.28)',
            borderColor:
              step === 'reset' ? '#e2e8f0' : 'rgba(255,255,255,0.45)',
            borderWidth: 1,
            elevation: step === 'reset' ? 4 : 24,
            left: 22,
            position: 'absolute',
            top: Math.max(safeTop, 10) + 6,
            zIndex: 40,
          }}
        >
          <FeatherIcon
            color={step === 'reset' ? '#0f172a' : '#ffffff'}
            name="arrow-left"
            size={22}
          />
        </Pressable>
      ) : null}

      {successToastMessage ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.authSuccessToastWrap,
            { top: Math.max(safeTop, 12) + 10 },
            {
              opacity: toastOpacity,
              transform: [{ translateY: toastTranslateY }],
            },
          ]}
        >
          <View style={styles.authSuccessToastCard}>
            <View style={styles.authSuccessToastIconWrap}>
              <FeatherIcon color="#ff5a16" name="check-circle" size={16} />
            </View>
            <Text allowFontScaling={false} style={styles.authSuccessToastText}>
              {successToastMessage}
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}
