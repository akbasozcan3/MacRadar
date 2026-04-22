import { Platform } from 'react-native';
import { APP_ENV } from './appEnv.generated';

const DEFAULT_API_PORT = 8090;
const PRODUCTION_API_BASE_URL = 'https://macradar.onrender.com';

// Android emulators cannot reach localhost directly, so use 10.0.2.2 there.
const LOCAL_API_HOST = Platform.select({
  android: '10.0.2.2',
  ios: '127.0.0.1',
  default: 'localhost',
});

function sanitizeEnvValue(value?: string | null) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function dedupeUrls(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach(value => {
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    result.push(value);
  });

  return result;
}

function normalizeBaseUrl(rawValue: string | null, expected: 'http' | 'ws') {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = new URL(rawValue);
    const protocol = parsed.protocol.toLowerCase();
    if (
      expected === 'http' &&
      protocol !== 'http:' &&
      protocol !== 'https:'
    ) {
      return null;
    }
    if (expected === 'ws' && protocol !== 'ws:' && protocol !== 'wss:') {
      return null;
    }

    return parsed.origin;
  } catch {
    return null;
  }
}

function parsePort(rawValue: string | null) {
  if (!rawValue) {
    return DEFAULT_API_PORT;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return DEFAULT_API_PORT;
  }

  return parsed;
}

function deriveWsBaseUrl(apiBaseUrl: string) {
  const parsed = new URL(apiBaseUrl);
  const protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${parsed.host}`;
}

const configuredApiBaseUrl = normalizeBaseUrl(
  sanitizeEnvValue(APP_ENV.apiBaseUrl),
  'http',
);
const configuredWsBaseUrl = normalizeBaseUrl(
  sanitizeEnvValue(APP_ENV.wsBaseUrl),
  'ws',
);
const configuredMapboxPublicToken = sanitizeEnvValue(APP_ENV.mapboxPublicToken);
const configuredPort = parsePort(sanitizeEnvValue(APP_ENV.apiPort));

const fallbackApiBaseUrl = `http://${LOCAL_API_HOST}:${configuredPort}`;
const runtimeDefaultApiBaseUrl = __DEV__
  ? fallbackApiBaseUrl
  : PRODUCTION_API_BASE_URL;
export const API_BASE_URL_CANDIDATES = dedupeUrls([
  configuredApiBaseUrl,
  runtimeDefaultApiBaseUrl,
  fallbackApiBaseUrl,
]);

export const API_BASE_URL = API_BASE_URL_CANDIDATES[0] ?? fallbackApiBaseUrl;
export const EXPLORE_API_BASE_URL = API_BASE_URL;
export const MAPBOX_PUBLIC_TOKEN = configuredMapboxPublicToken;
const WS_BASE_URL = configuredWsBaseUrl ?? deriveWsBaseUrl(API_BASE_URL);

export const EXPLORE_WS_URL = `${WS_BASE_URL}/ws/explore`;
export const MESSAGES_WS_URL = `${WS_BASE_URL}/ws/messages`;
export const NOTIFICATIONS_WS_URL = `${WS_BASE_URL}/ws/notifications`;
export const PLAYER_WS_URL = `${WS_BASE_URL}/ws/players`;
