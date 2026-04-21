import type { SocialProvider } from '../screens/Login/Login.types';

export type SocialAuthFlow = 'firebase-token-exchange';

export type SocialProviderRuntime = {
  accentColor: string;
  badgeLabel: string;
  flow: SocialAuthFlow;
  label: string;
  provider: SocialProvider;
};

export const AUTH_SHEET_COPY = {
  description:
    'Go backend, email dogrulama ve sifre kurtarma akislarini tek merkezde toplar. MacRadar oturumu acildiginda harita, topluluk ve profil deneyimi hazir olur.',
  eyebrow: 'Guvenli oturum merkezi',
  heroDescription:
    'Gmail SMTP ile calisan dogrulama akisi, temiz form hiyerarsisi ve hizli giris deneyimi.',
  title: 'MacRadar hesabini baslat',
} as const;

export const SOCIAL_PROVIDER_RUNTIMES: Record<
  SocialProvider,
  SocialProviderRuntime
> = {
  facebook: {
    accentColor: '#5579bf',
    badgeLabel: 'MacRadar',
    flow: 'firebase-token-exchange',
    label: 'Facebook',
    provider: 'facebook',
  },
  google: {
    accentColor: '#eb5a3c',
    badgeLabel: 'MacRadar',
    flow: 'firebase-token-exchange',
    label: 'Google',
    provider: 'google',
  },
};

export function getSocialProviderRuntime(provider: SocialProvider) {
  return SOCIAL_PROVIDER_RUNTIMES[provider];
}
