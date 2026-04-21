import { GOOGLE_WEB_CLIENT_ID } from '../config/googleAuth';
import { getSocialProviderRuntime } from '../config/authRuntime';
import type { SocialProvider } from '../screens/Login/Login.types';
import type { AuthResponse } from '../types/AuthTypes/AuthTypes';
import { socialLogin } from './authService';

type SocialAuthInput = {
  avatarUrl?: string;
  city?: string;
  email?: string;
  fullName?: string;
  provider: SocialProvider;
  username?: string;
};

let googleSigninConfigured = false;

type GoogleSigninModule = typeof import('@react-native-google-signin/google-signin');

function normalizeUsernameSeed(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20);
  if (normalized.length >= 3) {
    return normalized;
  }
  return `mac${Date.now().toString(36).slice(-8)}`;
}

function getGoogleSigninApi() {
  let moduleRef: GoogleSigninModule;
  try {
    moduleRef = require('@react-native-google-signin/google-signin') as GoogleSigninModule;
  } catch {
    throw new Error(
      'Google girisi modulu yuklenemedi. Uygulamayi native rebuild edip tekrar deneyin.',
    );
  }
  if (!moduleRef?.GoogleSignin) {
    throw new Error(
      'Google girisi native modulu bulunamadi. Uygulamayi native rebuild edip tekrar deneyin.',
    );
  }
  return moduleRef.GoogleSignin;
}

function ensureGoogleSigninConfigured() {
  const googleSignin = getGoogleSigninApi();
  if (googleSigninConfigured) {
    return googleSignin;
  }
  googleSignin.configure({
    forceCodeForRefreshToken: false,
    offlineAccess: false,
    webClientId: GOOGLE_WEB_CLIENT_ID,
  });
  googleSigninConfigured = true;
  return googleSignin;
}

async function buildGoogleIdentityPayload() {
  const googleSignin = ensureGoogleSigninConfigured();
  await googleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const signInResult = await googleSignin.signIn();
  const tokens = await googleSignin.getTokens();
  const result = signInResult as {
    data?: {
      user?: {
        email?: string;
        name?: string;
        photo?: string;
      };
    };
    user?: {
      email?: string;
      name?: string;
      photo?: string;
    };
  };
  const user = result.data?.user ?? result.user;
  const email = String(user?.email || '').trim().toLowerCase();
  if (email.length === 0) {
    throw new Error('Google hesabindan email bilgisi alinamadi.');
  }

  const fullName = String(user?.name || '').trim() || 'Google Driver';
  const avatarUrl = String(user?.photo || '').trim();
  const emailSeed = email.split('@')[0] || fullName;
  const googleIdToken = String(tokens?.idToken || '').trim();
  if (googleIdToken.length === 0) {
    throw new Error('Google kimlik dogrulama tokeni alinamadi.');
  }

  return {
    avatarUrl,
    city: 'Istanbul',
    email,
    fullName,
    googleIdToken,
    username: normalizeUsernameSeed(emailSeed),
  };
}

export async function signInWithSocialProvider(
  input: SocialAuthInput,
): Promise<AuthResponse> {
  const runtime = getSocialProviderRuntime(input.provider);

  switch (runtime.flow) {
    case 'firebase-token-exchange':
      if (input.provider === 'facebook') {
        throw new Error('Facebook girisi gecici olarak devre disi.');
      }
      if (input.provider === 'google') {
        try {
          const googleIdentity = await buildGoogleIdentityPayload();
          return socialLogin({
            avatarUrl: googleIdentity.avatarUrl,
            city: googleIdentity.city,
            email: googleIdentity.email,
            fullName: googleIdentity.fullName,
            googleIdToken: googleIdentity.googleIdToken,
            provider: input.provider,
            username: googleIdentity.username,
          });
        } catch (error) {
          const maybeCode =
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            typeof (error as { code?: unknown }).code === 'string'
              ? (error as { code: string }).code
              : '';
          if (maybeCode === 'SIGN_IN_CANCELLED' || maybeCode === '12501') {
            throw new Error('Google girisi iptal edildi.');
          }
          if (maybeCode === 'DEVELOPER_ERROR' || maybeCode === '10') {
            throw new Error(
              'Google girisi icin Firebase Android SHA-1/SHA-256 ayarlari eksik veya web client ID uyumsuz.',
            );
          }
          throw error;
        }
      }

      return socialLogin({
        avatarUrl: input.avatarUrl,
        city: input.city,
        email: input.email,
        fullName: input.fullName,
        provider: input.provider,
        username: input.username,
      });
  }
}
