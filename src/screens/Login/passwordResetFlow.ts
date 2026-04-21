import {
  PASSWORD_MAX_LENGTH,
  sanitizeEmailInput,
  sanitizePasswordInput,
  sanitizeVerificationCodeInput,
} from '../../constants/Auth/AuthValidation';
import type { PasswordResetFormState } from './Login.types';

export function createInitialPasswordResetForm(
  email = '',
): PasswordResetFormState {
  return {
    code: '',
    confirmPassword: '',
    email: sanitizeEmailInput(email),
    newPassword: '',
  };
}

export function normalizeOptionalResetEmail(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  return sanitizeEmailInput(value);
}

export function sanitizePasswordResetValue<
  Key extends keyof PasswordResetFormState,
>(
  field: Key,
  value: PasswordResetFormState[Key],
): PasswordResetFormState[Key] {
  if (typeof value !== 'string') {
    return value;
  }

  switch (field) {
    case 'email':
      return sanitizeEmailInput(value) as PasswordResetFormState[Key];
    case 'code':
      return sanitizeVerificationCodeInput(value) as PasswordResetFormState[Key];
    case 'newPassword':
    case 'confirmPassword':
      return sanitizePasswordInput(value, PASSWORD_MAX_LENGTH) as PasswordResetFormState[Key];
    default:
      return value;
  }
}
