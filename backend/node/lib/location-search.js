const MAPBOX_GEOCODING_BASE_URL =
  'https://api.mapbox.com/geocoding/v5/mapbox.places';
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 8;

const FALLBACK_LOCATIONS = [
  {
    aliases: ['istanbul', 'istanbul turkiye', 'istanbul turkey'],
    fullAddress: 'Istanbul, Turkiye',
    latitude: 41.0082,
    longitude: 28.9784,
    name: 'Istanbul',
    placeType: ['place'],
    slug: 'istanbul',
  },
  {
    aliases: ['besiktas', 'besiktas istanbul'],
    fullAddress: 'Besiktas, Istanbul, Turkiye',
    latitude: 41.0422,
    longitude: 29.0083,
    name: 'Besiktas',
    placeType: ['district'],
    slug: 'besiktas',
  },
  {
    aliases: ['kadikoy', 'kadikoy istanbul'],
    fullAddress: 'Kadikoy, Istanbul, Turkiye',
    latitude: 40.9917,
    longitude: 29.0277,
    name: 'Kadikoy',
    placeType: ['district'],
    slug: 'kadikoy',
  },
  {
    aliases: ['sisli', 'sisli istanbul'],
    fullAddress: 'Sisli, Istanbul, Turkiye',
    latitude: 41.0605,
    longitude: 28.9872,
    name: 'Sisli',
    placeType: ['district'],
    slug: 'sisli',
  },
  {
    aliases: ['bebek', 'bebek istanbul'],
    fullAddress: 'Bebek, Besiktas, Istanbul, Turkiye',
    latitude: 41.0777,
    longitude: 29.0436,
    name: 'Bebek',
    placeType: ['neighborhood'],
    slug: 'bebek',
  },
  {
    aliases: ['ortakoy', 'ortakoy istanbul'],
    fullAddress: 'Ortakoy, Besiktas, Istanbul, Turkiye',
    latitude: 41.0473,
    longitude: 29.026,
    name: 'Ortakoy',
    placeType: ['neighborhood'],
    slug: 'ortakoy',
  },
  {
    aliases: ['nisantasi', 'nisantasi istanbul'],
    fullAddress: 'Nisantasi, Sisli, Istanbul, Turkiye',
    latitude: 41.0534,
    longitude: 28.9927,
    name: 'Nisantasi',
    placeType: ['neighborhood'],
    slug: 'nisantasi',
  },
  {
    aliases: ['levent', 'levent istanbul'],
    fullAddress: 'Levent, Besiktas, Istanbul, Turkiye',
    latitude: 41.0781,
    longitude: 29.0115,
    name: 'Levent',
    placeType: ['neighborhood'],
    slug: 'levent',
  },
  {
    aliases: ['maslak', 'maslak istanbul'],
    fullAddress: 'Maslak, Sariyer, Istanbul, Turkiye',
    latitude: 41.1119,
    longitude: 29.0207,
    name: 'Maslak',
    placeType: ['neighborhood'],
    slug: 'maslak',
  },
  {
    aliases: ['uskudar', 'uskudar istanbul'],
    fullAddress: 'Uskudar, Istanbul, Turkiye',
    latitude: 41.023,
    longitude: 29.0151,
    name: 'Uskudar',
    placeType: ['district'],
    slug: 'uskudar',
  },
  {
    aliases: ['sariyer', 'sariyer istanbul'],
    fullAddress: 'Sariyer, Istanbul, Turkiye',
    latitude: 41.1667,
    longitude: 29.05,
    name: 'Sariyer',
    placeType: ['district'],
    slug: 'sariyer',
  },
  {
    aliases: ['taksim', 'taksim istanbul'],
    fullAddress: 'Taksim, Beyoglu, Istanbul, Turkiye',
    latitude: 41.0369,
    longitude: 28.985,
    name: 'Taksim',
    placeType: ['neighborhood'],
    slug: 'taksim',
  },
  {
    aliases: ['ankara', 'ankara turkiye', 'ankara turkey'],
    fullAddress: 'Ankara, Turkiye',
    latitude: 39.9334,
    longitude: 32.8597,
    name: 'Ankara',
    placeType: ['place'],
    slug: 'ankara',
  },
  {
    aliases: ['izmir', 'izmir turkiye', 'izmir turkey'],
    fullAddress: 'Izmir, Turkiye',
    latitude: 38.4237,
    longitude: 27.1428,
    name: 'Izmir',
    placeType: ['place'],
    slug: 'izmir',
  },
  {
    aliases: ['bursa', 'bursa turkiye', 'bursa turkey'],
    fullAddress: 'Bursa, Turkiye',
    latitude: 40.1826,
    longitude: 29.0665,
    name: 'Bursa',
    placeType: ['place'],
    slug: 'bursa',
  },
  {
    aliases: ['antalya', 'antalya turkiye', 'antalya turkey'],
    fullAddress: 'Antalya, Turkiye',
    latitude: 36.8969,
    longitude: 30.7133,
    name: 'Antalya',
    placeType: ['place'],
    slug: 'antalya',
  },
];

function normalizeSearchValue(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0131/g, 'i')
    .replace(/\u0130/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampLimit(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

function parseCoordinates(value) {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }
  const longitude = Number(value[0]);
  const latitude = Number(value[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { latitude, longitude };
}

function toLocationResult(feature) {
  const coordinates = parseCoordinates(feature?.center);
  const name =
    typeof feature?.text === 'string' && feature.text.trim().length > 0
      ? feature.text.trim()
      : '';
  const fullAddress =
    typeof feature?.place_name === 'string' && feature.place_name.trim().length > 0
      ? feature.place_name.trim()
      : '';
  const mapboxId =
    typeof feature?.id === 'string' && feature.id.trim().length > 0
      ? feature.id.trim()
      : '';
  if (!coordinates || !name || !fullAddress || !mapboxId) {
    return null;
  }
  const placeType = Array.isArray(feature?.place_type)
    ? feature.place_type
        .filter(item => typeof item === 'string' && item.trim().length > 0)
        .map(item => item.trim().toLowerCase())
    : [];
  const relevance =
    typeof feature?.relevance === 'number' && Number.isFinite(feature.relevance)
      ? Math.max(0, feature.relevance)
      : 0;
  return {
    fullAddress,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    mapboxId,
    name,
    placeType,
    relevance,
  };
}

function dedupeResults(items) {
  const seen = new Set();
  return items.filter(item => {
    if (!item || seen.has(item.mapboxId)) {
      return false;
    }
    seen.add(item.mapboxId);
    return true;
  });
}

function scoreFallbackLocation(item, normalizedQuery) {
  const haystacks = [item.name, item.fullAddress, ...(item.aliases || [])].map(value =>
    normalizeSearchValue(value),
  );
  let bestScore = 0;
  haystacks.forEach(value => {
    if (!value) {
      return;
    }
    if (value === normalizedQuery) {
      bestScore = Math.max(bestScore, 500);
      return;
    }
    if (value.startsWith(normalizedQuery)) {
      bestScore = Math.max(bestScore, 320);
      return;
    }
    if (value.includes(normalizedQuery)) {
      bestScore = Math.max(bestScore, 180);
    }
  });
  return bestScore;
}

function buildFallbackResults(query, limit) {
  const normalizedQuery = normalizeSearchValue(query);
  if (normalizedQuery.length < 2) {
    return [];
  }
  return FALLBACK_LOCATIONS.map(item => ({
    item,
    score: scoreFallbackLocation(item, normalizedQuery),
  }))
    .filter(entry => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.item.name.localeCompare(right.item.name, 'tr');
    })
    .slice(0, limit)
    .map((entry, index) => ({
      fullAddress: entry.item.fullAddress,
      latitude: entry.item.latitude,
      longitude: entry.item.longitude,
      mapboxId: `fallback.${entry.item.slug}.${index}`,
      name: entry.item.name,
      placeType: entry.item.placeType,
      relevance: Math.min(1, Math.max(0.4, entry.score / 500)),
    }));
}

function resolveMapboxToken() {
  const candidates = [
    process.env.MACRADAR_MAPBOX_PUBLIC_TOKEN,
    process.env.MAPBOX_PUBLIC_TOKEN,
    process.env.MAPBOX_ACCESS_TOKEN,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return '';
}

async function searchMapboxLocations(query, options = {}) {
  const token = resolveMapboxToken();
  if (!token) {
    return [];
  }
  const limit = clampLimit(options.limit);
  const params = new URLSearchParams({
    access_token: token,
    autocomplete: 'true',
    country: typeof options.country === 'string' && options.country.trim() ? options.country.trim() : 'tr',
    language: typeof options.language === 'string' && options.language.trim() ? options.language.trim() : 'tr',
    limit: String(limit),
    types: 'poi,address,neighborhood,locality,place,district',
  });
  const requestUrl = `${MAPBOX_GEOCODING_BASE_URL}/${encodeURIComponent(query.trim())}.json?${params.toString()}`;
  const response = await fetch(requestUrl, {
    headers: {
      Accept: 'application/json',
    },
    method: 'GET',
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`mapbox_request_failed_${response.status}`);
  }
  const payload = await response.json();
  const features = Array.isArray(payload?.features) ? payload.features : [];
  return dedupeResults(features.map(feature => toLocationResult(feature)).filter(Boolean)).slice(
    0,
    limit,
  );
}

async function searchLocationSuggestions(query, options = {}) {
  const trimmedQuery = String(query || '').trim();
  const limit = clampLimit(options.limit);
  if (trimmedQuery.length < 2) {
    return [];
  }

  let remoteResults = [];
  try {
    remoteResults = await searchMapboxLocations(trimmedQuery, options);
  } catch {
    remoteResults = [];
  }

  const fallbackResults = buildFallbackResults(trimmedQuery, limit);
  return dedupeResults([...remoteResults, ...fallbackResults]).slice(0, limit);
}

module.exports = {
  searchLocationSuggestions,
};
