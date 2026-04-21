import { API_BASE_URL } from '../config/exploreApi';
import { getApiSessionToken } from './apiClient';

const PROFILE_POST_MEDIA_PATH_SEGMENT = '/api/v1/profile/post-media/files/';

function appendQueryToken(url: string, token: string) {
  const trimmedToken = token.trim();
  if (!trimmedToken || /[?&](token|access_token)=/i.test(url)) {
    return url;
  }

  try {
    const parsed = new URL(url);
    if (
      !parsed.searchParams.get('token') &&
      !parsed.searchParams.get('access_token')
    ) {
      parsed.searchParams.set('token', trimmedToken);
    }
    return parsed.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${encodeURIComponent(trimmedToken)}`;
  }
}

export function resolveProtectedMediaUrl(mediaUrl: string) {
  const trimmedMediaUrl = String(mediaUrl || '').trim();
  if (!trimmedMediaUrl) {
    return '';
  }

  const resolved = trimmedMediaUrl.startsWith('/')
    ? `${API_BASE_URL}${trimmedMediaUrl}`
    : trimmedMediaUrl;
  if (!resolved.includes(PROFILE_POST_MEDIA_PATH_SEGMENT)) {
    return resolved;
  }

  const token = getApiSessionToken();
  if (!token) {
    return resolved;
  }

  return appendQueryToken(resolved, token);
}

function withProtectedMediaBase(pathOrUrl: string) {
  const trimmedValue = String(pathOrUrl || '').trim();
  if (!trimmedValue) {
    return '';
  }

  return trimmedValue.startsWith('/')
    ? `${API_BASE_URL}${trimmedValue}`
    : trimmedValue;
}

function appendProtectedMediaToken(pathOrUrl: string) {
  const resolved = withProtectedMediaBase(pathOrUrl);
  if (!resolved.includes(PROFILE_POST_MEDIA_PATH_SEGMENT)) {
    return resolved;
  }

  const token = getApiSessionToken();
  if (!token) {
    return resolved;
  }

  return appendQueryToken(resolved, token);
}

export function resolveMediaThumbnailUrl(payload: {
  mediaType?: string | null;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
}) {
  const normalizedThumbnailUrl = String(payload.thumbnailUrl || '').trim();
  if (normalizedThumbnailUrl.length > 0) {
    return isLocalMediaUri(normalizedThumbnailUrl)
      ? normalizedThumbnailUrl
      : appendProtectedMediaToken(normalizedThumbnailUrl);
  }

  const normalizedMediaType = String(payload.mediaType || '')
    .trim()
    .toLowerCase();
  const normalizedMediaUrl = String(payload.mediaUrl || '').trim();
  if (!normalizedMediaUrl) {
    return '';
  }

  if (normalizedMediaType !== 'video') {
    return resolveProtectedMediaUrl(normalizedMediaUrl);
  }

  const mediaPath = normalizedMediaUrl.startsWith('/')
    ? normalizedMediaUrl
    : (() => {
        try {
          const parsed = new URL(normalizedMediaUrl);
          return `${parsed.pathname}${parsed.search}`;
        } catch {
          return normalizedMediaUrl;
        }
      })();

  if (mediaPath.includes(PROFILE_POST_MEDIA_PATH_SEGMENT)) {
    const [pathWithoutQuery] = mediaPath.split('?');
    if (pathWithoutQuery.endsWith('/thumbnail')) {
      return appendProtectedMediaToken(pathWithoutQuery);
    }
    return appendProtectedMediaToken(`${pathWithoutQuery}/thumbnail`);
  }

  return '';
}

export function isLocalMediaUri(mediaUrl: string) {
  const trimmedMediaUrl = String(mediaUrl || '')
    .trim()
    .toLowerCase();
  return (
    trimmedMediaUrl.startsWith('file://') ||
    trimmedMediaUrl.startsWith('content://') ||
    trimmedMediaUrl.startsWith('ph://')
  );
}
