import { API_BASE_URL, API_BASE_URL_CANDIDATES } from '../config/exploreApi';
import { getAppLanguage } from '../i18n/runtime';

let sessionToken: string | null = null;
let unauthorizedHandler: ((error: ApiRequestError) => void) | null = null;
let lastUnauthorizedNotifyAt = 0;
let preferredApiBaseUrl: string | null = null;
const DEFAULT_API_TIMEOUT_MS = 12000;
const UNAUTHORIZED_NOTIFY_COOLDOWN_MS = 800;

type ApiEnvelope<T> = {
  data?: T;
  error?: {
    code?: string;
    details?: Record<string, unknown>;
    message?: string;
  };
  success?: boolean;
};

type FlatApiError = {
  code?: string;
  details?: Record<string, unknown>;
  message?: string;
};

type ApiRequestInit = RequestInit & {
  timeoutMs?: number;
};

function isMultipartFormBody(body: unknown) {
  if (!body || typeof body !== 'object') {
    return false;
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return true;
  }
  const maybeFormData = body as {
    append?: unknown;
    getParts?: unknown;
    _parts?: unknown;
  };
  if (typeof maybeFormData.append !== 'function') {
    return false;
  }
  // React Native FormData polyfill may not always satisfy `instanceof FormData`.
  return (
    typeof maybeFormData.getParts === 'function' ||
    Array.isArray(maybeFormData._parts)
  );
}

export class ApiRequestError extends Error {
  code?: string;
  details?: Record<string, unknown>;
  status: number;

  constructor(
    message: string,
    options: {
      code?: string;
      details?: Record<string, unknown>;
      status: number;
    },
  ) {
    super(message);
    this.code = options.code;
    this.details = options.details;
    this.name = 'ApiRequestError';
    this.status = options.status;
  }
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

export function setApiSessionToken(token: string | null) {
  sessionToken = token;
}

export function setApiUnauthorizedHandler(
  handler: ((error: ApiRequestError) => void) | null,
) {
  unauthorizedHandler = handler;
}

export function getApiSessionToken() {
  return sessionToken;
}

function createApiRequestId() {
  return `mobile_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function getApiBaseUrlCandidates() {
  const seen = new Set<string>();
  const result: string[] = [];

  [preferredApiBaseUrl, ...API_BASE_URL_CANDIDATES, API_BASE_URL].forEach(
    value => {
      if (!value || seen.has(value)) {
        return;
      }
      seen.add(value);
      result.push(value);
    },
  );

  return result.length > 0 ? result : [API_BASE_URL];
}

function createTransportError(
  error: unknown,
  requestId: string,
  initSignal?: AbortSignal | null,
) {
  if (
    error instanceof Error &&
    error.name === 'AbortError' &&
    !(initSignal?.aborted ?? false)
  ) {
    return new ApiRequestError(
      'Sunucuya baglanti zaman asimina ugradi. Lutfen tekrar dene.',
      {
        code: 'request_timeout',
        details: {
          requestId,
        },
        status: 408,
      },
    );
  }

  return new ApiRequestError(
    'Sunucuya baglanilamadi. Ag baglantini kontrol edip tekrar dene.',
    {
      code: 'network_error',
      details: {
        cause:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : undefined,
        requestId,
      },
      status: 0,
    },
  );
}

export async function apiRequest<T>(
  path: string,
  init?: ApiRequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  const requestId = createApiRequestId();
  const appLanguage = getAppLanguage();
  const timeoutMs =
    typeof init?.timeoutMs === 'number' && Number.isFinite(init.timeoutMs)
      ? Math.max(1, Math.round(init.timeoutMs))
      : DEFAULT_API_TIMEOUT_MS;
  const isMultipartBody = isMultipartFormBody(init?.body);

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  if (isMultipartBody) {
    // Let fetch/xhr set multipart boundary automatically.
    headers.delete('Content-Type');
  } else if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json');
  }

  if (!headers.has('Accept-Language')) {
    headers.set('Accept-Language', appLanguage);
  }
  if (!headers.has('X-App-Language')) {
    headers.set('X-App-Language', appLanguage);
  }
  if (!headers.has('X-Request-Id')) {
    headers.set('X-Request-Id', requestId);
  }

  if (sessionToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${sessionToken}`);
  }

  const fetchInit: RequestInit = init ? { ...init } : {};
  delete (fetchInit as ApiRequestInit).timeoutMs;

  let response: Response | null = null;
  const candidates = getApiBaseUrlCandidates();
  const perAttemptTimeoutMs =
    candidates.length > 1
      ? Math.max(4000, Math.round(timeoutMs / candidates.length))
      : timeoutMs;
  let lastTransportError: ApiRequestError | null = null;

  for (const baseUrl of candidates) {
    const timeoutController = new AbortController();
    const signal = mergeAbortSignals(init?.signal, timeoutController.signal);
    const timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, perAttemptTimeoutMs);

    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...fetchInit,
        headers,
        signal,
      });
      preferredApiBaseUrl = baseUrl;
      lastTransportError = null;
      break;
    } catch (error) {
      const transportError = createTransportError(
        error,
        requestId,
        init?.signal,
      );
      lastTransportError = transportError;

      if (init?.signal?.aborted) {
        throw transportError;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (!response) {
    throw (
      lastTransportError ??
      new ApiRequestError(
        'Sunucuya baglanilamadi. Ag baglantini kontrol edip tekrar dene.',
        {
          code: 'network_error',
          details: {
            requestId,
          },
          status: 0,
        },
      )
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('Content-Type') ?? '';
  let payload: ApiEnvelope<T> | T | null = null;
  let responseText = '';

  if (contentType.includes('application/json')) {
    payload = (await response.json()) as ApiEnvelope<T> | T;
  } else {
    responseText = await response.text();
  }

  if (!response.ok) {
    const envelope = asEnvelope(payload);
    const legacyError = extractLegacyErrorEnvelope(payload);
    const flatError = extractFlatError(payload);
    const message =
      envelope?.error?.message ||
      legacyError?.message ||
      flatError?.message ||
      responseText ||
      `Request failed with status ${response.status}`;

    const requestError = new ApiRequestError(message, {
      code: envelope?.error?.code || legacyError?.code || flatError?.code,
      details: {
        ...(envelope?.error?.details ||
          legacyError?.details ||
          flatError?.details ||
          {}),
        requestId: response.headers.get('X-Request-Id') || requestId,
      },
      status: response.status,
    });
    if (
      response.status === 401 ||
      requestError.code === 'unauthorized' ||
      requestError.code === 'session_expired' ||
      requestError.code === 'invalid_session'
    ) {
      notifyUnauthorized(requestError);
    }

    throw requestError;
  }

  const envelope = asEnvelope(payload);
  if (envelope && 'data' in envelope) {
    return envelope.data as T;
  }

  return payload as T;
}

function mergeAbortSignals(
  first?: AbortSignal | null,
  second?: AbortSignal | null,
) {
  if (!first) {
    return second ?? undefined;
  }
  if (!second) {
    return first;
  }

  if (first.aborted || second.aborted) {
    const aborted = new AbortController();
    aborted.abort();
    return aborted.signal;
  }

  const bridge = new AbortController();
  const abortBridge = () => {
    bridge.abort();
  };
  first.addEventListener('abort', abortBridge, { once: true });
  second.addEventListener('abort', abortBridge, { once: true });
  return bridge.signal;
}

function asEnvelope<T>(value: ApiEnvelope<T> | T | null) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (!('success' in value) && !('error' in value) && !('data' in value)) {
    return null;
  }

  return value as ApiEnvelope<T>;
}

function extractLegacyErrorEnvelope<T>(value: ApiEnvelope<T> | T | null) {
  if (!value || typeof value !== 'object' || !('data' in value)) {
    return null;
  }

  const data = (value as ApiEnvelope<T>).data;
  if (!data || typeof data !== 'object') {
    return null;
  }

  if (!('error' in data)) {
    return null;
  }

  const nestedError = (data as ApiEnvelope<unknown>).error;
  if (!nestedError || typeof nestedError !== 'object') {
    return null;
  }

  return nestedError;
}

function extractFlatError<T>(value: ApiEnvelope<T> | T | null) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if ('error' in value || 'data' in value || 'success' in value) {
    return null;
  }

  const code =
    'code' in value && typeof value.code === 'string' ? value.code : undefined;
  const message =
    'message' in value && typeof value.message === 'string'
      ? value.message
      : undefined;
  const details =
    'details' in value && isPlainObject(value.details)
      ? value.details
      : undefined;

  if (!code && !message && !details) {
    return null;
  }

  return { code, details, message } satisfies FlatApiError;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function notifyUnauthorized(error: ApiRequestError) {
  if (!unauthorizedHandler) {
    return;
  }

  const now = Date.now();
  if (now - lastUnauthorizedNotifyAt < UNAUTHORIZED_NOTIFY_COOLDOWN_MS) {
    return;
  }
  lastUnauthorizedNotifyAt = now;

  try {
    unauthorizedHandler(error);
  } catch {
    return;
  }
}
