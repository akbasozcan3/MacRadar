import type { UserProfile } from '../types/AuthTypes/AuthTypes';
import { resolveProtectedMediaUrl } from '../services/protectedMedia';

type AvatarCarrier = Pick<UserProfile, 'authProvider' | 'avatarUrl'>;

export function resolveProfileAvatarUrl(profile: AvatarCarrier) {
  const rawAvatarUrl = String(profile.avatarUrl || '').trim();
  if (rawAvatarUrl.length === 0) {
    return '';
  }

  return resolveProtectedMediaUrl(rawAvatarUrl);
}

export function appendAvatarVersionParam(
  avatarUrl: string,
  version: number | string | null | undefined,
) {
  const normalizedUrl = String(avatarUrl || '').trim();
  const normalizedVersion = String(version ?? '').trim();
  if (!normalizedUrl || !normalizedVersion) {
    return normalizedUrl;
  }

  try {
    if (normalizedUrl.startsWith('/')) {
      const [path, search = ''] = normalizedUrl.split('?');
      const params = new URLSearchParams(search);
      params.set('v', normalizedVersion);
      const nextSearch = params.toString();
      return nextSearch.length > 0 ? `${path}?${nextSearch}` : path;
    }

    const parsed = new URL(normalizedUrl);
    parsed.searchParams.set('v', normalizedVersion);
    return parsed.toString();
  } catch {
    const separator = normalizedUrl.includes('?') ? '&' : '?';
    return `${normalizedUrl}${separator}v=${encodeURIComponent(normalizedVersion)}`;
  }
}

export function withProfileAvatarVersion(
  profile: UserProfile,
  version: number | string | null | undefined,
) {
  const nextAvatarUrl = appendAvatarVersionParam(profile.avatarUrl, version);
  if (nextAvatarUrl === profile.avatarUrl) {
    return profile;
  }

  return {
    ...profile,
    avatarUrl: nextAvatarUrl,
  };
}
