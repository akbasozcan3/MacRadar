import type {
  PasswordResetChallengeResponse,
  VerificationChallengeResponse,
} from '../../types/AuthTypes/AuthTypes';

export type AuthMode = 'login' | 'register';
export type AuthStep = 'landing' | 'form' | 'verify' | 'reset';

export type SocialProvider = 'google' | 'facebook';

export type AuthSuccessMeta = {
  showMoodPrompt?: boolean;
};

export type LoginFormState = {
  email: string;
  fullName: string;
  password: string;
  username: string;
};

export type PasswordResetFormState = {
  code: string;
  confirmPassword: string;
  email: string;
  newPassword: string;
};

export type VerificationSession = VerificationChallengeResponse & {
  source: AuthMode;
};

export type PasswordResetSession = PasswordResetChallengeResponse;
