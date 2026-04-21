const TURKISH_CHAR_MAP: Record<string, string> = {
  '\u00c7': 'c',
  '\u00d6': 'o',
  '\u00dc': 'u',
  '\u00e7': 'c',
  '\u00f6': 'o',
  '\u00fc': 'u',
  '\u011e': 'g',
  '\u011f': 'g',
  '\u0130': 'i',
  '\u0131': 'i',
  '\u015e': 's',
  '\u015f': 's',
  I: 'i',
};

const TURKISH_CHARACTER_PATTERN =
  /[\u00c7\u00d6\u00dc\u00e7\u00f6\u00fc\u011e\u011f\u0130\u0131\u015e\u015fI]/g;
const EMOJI_PATTERN =
  /[\u200D\u20E3\uFE0F\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 12;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
const OTP_CODE_LENGTH = 6;

function replaceTurkishCharacters(value: string) {
  return value.replace(TURKISH_CHARACTER_PATTERN, character => {
    return TURKISH_CHAR_MAP[character] ?? character.toLowerCase();
  });
}

export function containsEmoji(value: string) {
  EMOJI_PATTERN.lastIndex = 0;
  return EMOJI_PATTERN.test(value);
}

export function stripEmoji(value: string) {
  return value.replace(EMOJI_PATTERN, '');
}

export function sanitizeGenericInput(value: string, maxLength?: number) {
  const sanitized = stripEmoji(value);
  if (typeof maxLength !== 'number') {
    return sanitized;
  }

  return sanitized.slice(0, maxLength);
}

export function sanitizeEmailInput(value: string) {
  return stripEmoji(value).replace(/\s+/g, '').toLowerCase();
}

export function sanitizePasswordInput(value: string, maxLength?: number) {
  return sanitizeGenericInput(value, maxLength);
}

export function sanitizeVerificationCodeInput(value: string) {
  const raw = stripEmoji(value);
  const contiguousCodeMatch = raw.match(new RegExp(`\\d{${OTP_CODE_LENGTH}}`));
  if (contiguousCodeMatch) {
    return contiguousCodeMatch[0];
  }

  return raw.replace(/\D+/g, '').slice(0, OTP_CODE_LENGTH);
}

export function sanitizeUsernameInput(value: string) {
  const sanitized = replaceTurkishCharacters(stripEmoji(value).toLowerCase())
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9_]/g, '');

  return sanitized.slice(0, USERNAME_MAX_LENGTH);
}

export function validateUsername(value: string) {
  if (value.trim().length === 0) {
    return 'Kullanıcı adı zorunlu.';
  }
  if (value.length < USERNAME_MIN_LENGTH) {
    return 'Kullanıcı adı en az 3 karakter olmali.';
  }
  if (value.length > USERNAME_MAX_LENGTH) {
    return 'Kullanıcı adı en fazla 20 karakter olabilir.';
  }
  if (!/^[a-z0-9_]+$/.test(value)) {
    return 'Sadece küçük harf, rakam ve underscore kullanın.';
  }

  return null;
}

export function isPasswordLengthValid(password: string) {
  const length = password.trim().length;
  return length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH;
}
