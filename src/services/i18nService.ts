import { apiRequest } from './apiClient';
import { getAppLanguage, setRemoteEnglishStrings } from '../i18n/runtime';

export type AppI18nBundle = {
  locale: string;
  strings: Record<string, string>;
  version: string;
};

/**
 * Loads English UI strings from the backend (`en.json` served by Go/Node).
 * Falls back to the app-embedded map when the request fails.
 */
export async function fetchAppI18nBundle(
  locale: string,
): Promise<AppI18nBundle | null> {
  const normalized = locale.trim().toLowerCase();
  if (normalized !== 'en') {
    setRemoteEnglishStrings(null);
    return null;
  }

  try {
    const data = await apiRequest<AppI18nBundle>(
      `/api/v1/app/i18n?locale=${encodeURIComponent(normalized)}`,
      { method: 'GET' },
    );
    if (data?.strings && typeof data.strings === 'object') {
      setRemoteEnglishStrings(data.strings);
    }
    return data;
  } catch {
    setRemoteEnglishStrings(null);
    return null;
  }
}

export function syncI18nBundleWithCurrentLanguage() {
  const lang = getAppLanguage();
  if (lang !== 'en') {
    setRemoteEnglishStrings(null);
    return Promise.resolve(null);
  }
  return fetchAppI18nBundle('en');
}
