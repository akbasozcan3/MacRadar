import { apiRequest } from './apiClient';
import type { LocationAutocompleteResult } from '../types/LocationTypes/LocationTypes';

const MAPBOX_LOCATION_MIN_QUERY_LENGTH = 2;
const MAPBOX_LOCATION_DEFAULT_LIMIT = 6;
const MAPBOX_LOCATION_MAX_LIMIT = 8;

const FALLBACK_LOCATIONS: LocationAutocompleteResult[] = [
  {
    fullAddress: 'Istanbul, Turkiye',
    latitude: 41.0082,
    longitude: 28.9784,
    mapboxId: 'fallback.istanbul',
    name: 'Istanbul',
    placeType: ['place'],
    relevance: 0.98,
  },
  {
    fullAddress: 'Besiktas, Istanbul, Turkiye',
    latitude: 41.0422,
    longitude: 29.0083,
    mapboxId: 'fallback.besiktas',
    name: 'Besiktas',
    placeType: ['district'],
    relevance: 0.94,
  },
  {
    fullAddress: 'Kadikoy, Istanbul, Turkiye',
    latitude: 40.9917,
    longitude: 29.0277,
    mapboxId: 'fallback.kadikoy',
    name: 'Kadikoy',
    placeType: ['district'],
    relevance: 0.94,
  },
  {
    fullAddress: 'Sisli, Istanbul, Turkiye',
    latitude: 41.0605,
    longitude: 28.9872,
    mapboxId: 'fallback.sisli',
    name: 'Sisli',
    placeType: ['district'],
    relevance: 0.92,
  },
  {
    fullAddress: 'Bebek, Besiktas, Istanbul, Turkiye',
    latitude: 41.0777,
    longitude: 29.0436,
    mapboxId: 'fallback.bebek',
    name: 'Bebek',
    placeType: ['neighborhood'],
    relevance: 0.9,
  },
  {
    fullAddress: 'Ankara, Turkiye',
    latitude: 39.9334,
    longitude: 32.8597,
    mapboxId: 'fallback.ankara',
    name: 'Ankara',
    placeType: ['place'],
    relevance: 0.88,
  },
  {
    fullAddress: 'Izmir, Turkiye',
    latitude: 38.4237,
    longitude: 27.1428,
    mapboxId: 'fallback.izmir',
    name: 'Izmir',
    placeType: ['place'],
    relevance: 0.87,
  },
];

type SearchMapboxLocationsOptions = {
  country?: string;
  language?: string;
  limit?: number;
  signal?: AbortSignal;
};

type BackendLocationAutocompleteResponse = {
  results?: unknown;
};

const PLACE_TYPE_PRIORITY: Record<string, number> = {
  poi: 0,
  address: 1,
  neighborhood: 2,
  locality: 3,
  place: 4,
  district: 5,
  region: 6,
  country: 7,
};

function clampLimit(value?: number) {
  if (!Number.isFinite(value)) {
    return MAPBOX_LOCATION_DEFAULT_LIMIT;
  }

  return Math.max(
    1,
    Math.min(MAPBOX_LOCATION_MAX_LIMIT, Math.floor(value as number)),
  );
}

function computeResultScore(item: LocationAutocompleteResult) {
  const primaryPlaceType = item.placeType[0] ?? '';
  const typePriority =
    typeof PLACE_TYPE_PRIORITY[primaryPlaceType] === 'number'
      ? PLACE_TYPE_PRIORITY[primaryPlaceType]
      : 9;
  return item.relevance * 100 - typePriority;
}

function dedupeAndSortResults(items: LocationAutocompleteResult[]) {
  const uniqueById = new Map<string, LocationAutocompleteResult>();
  items.forEach(item => {
    if (!uniqueById.has(item.mapboxId)) {
      uniqueById.set(item.mapboxId, item);
    }
  });

  return Array.from(uniqueById.values()).sort((left, right) => {
    const scoreDiff = computeResultScore(right) - computeResultScore(left);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    if (left.name.length !== right.name.length) {
      return left.name.length - right.name.length;
    }

    return left.fullAddress.localeCompare(right.fullAddress, 'tr-TR');
  });
}

function normalizeSearchValue(value: string) {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0131/g, 'i')
    .replace(/\u0130/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchFallbackLocations(query: string, limit: number) {
  const normalizedQuery = normalizeSearchValue(query);
  if (normalizedQuery.length < MAPBOX_LOCATION_MIN_QUERY_LENGTH) {
    return [] as LocationAutocompleteResult[];
  }

  return FALLBACK_LOCATIONS.map(item => {
    const haystacks = [item.name, item.fullAddress].map(value => normalizeSearchValue(value));
    let score = 0;
    haystacks.forEach(value => {
      if (value === normalizedQuery) {
        score = Math.max(score, 500);
        return;
      }
      if (value.startsWith(normalizedQuery)) {
        score = Math.max(score, 320);
        return;
      }
      if (value.includes(normalizedQuery)) {
        score = Math.max(score, 180);
      }
    });
    return { item, score };
  })
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(entry => entry.item);
}

export function mapLocationAutocompleteResultToSelectedLocation(
  result: LocationAutocompleteResult,
) {
  return {
    fullAddress: result.fullAddress,
    latitude: result.latitude,
    longitude: result.longitude,
    mapboxId: result.mapboxId,
    name: result.name,
  };
}

async function searchBackendLocations(
  query: string,
  options: SearchMapboxLocationsOptions | undefined,
) {
  const params = new URLSearchParams({
    language: options?.language?.trim() || 'tr',
    limit: String(clampLimit(options?.limit)),
    q: query.trim(),
  });
  const country = options?.country?.trim();
  if (country) {
    params.set('country', country);
  }
  const response = await apiRequest<BackendLocationAutocompleteResponse>(
    `/api/v1/explore/search/places?${params.toString()}`,
    {
      signal: options?.signal,
      timeoutMs: 7000,
    },
  );

  const results = Array.isArray(response.results)
    ? response.results.filter((item): item is LocationAutocompleteResult => {
        if (!item || typeof item !== 'object') {
          return false;
        }
        const candidate = item as Partial<LocationAutocompleteResult>;
        return (
          typeof candidate.fullAddress === 'string' &&
          typeof candidate.mapboxId === 'string' &&
          typeof candidate.name === 'string' &&
          typeof candidate.latitude === 'number' &&
          typeof candidate.longitude === 'number' &&
          Array.isArray(candidate.placeType) &&
          typeof candidate.relevance === 'number'
        );
      })
    : [];
  return dedupeAndSortResults(results).slice(0, clampLimit(options?.limit));
}

export async function searchMapboxLocations(
  query: string,
  options?: SearchMapboxLocationsOptions,
) {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < MAPBOX_LOCATION_MIN_QUERY_LENGTH) {
    return [] as LocationAutocompleteResult[];
  }

  const limit = clampLimit(options?.limit);
  try {
    const backendResults = await searchBackendLocations(trimmedQuery, options);
    if (backendResults.length > 0) {
      return backendResults;
    }
  } catch {
    // Use offline-style fallback when the API is unreachable.
  }

  return searchFallbackLocations(trimmedQuery, limit);
}
