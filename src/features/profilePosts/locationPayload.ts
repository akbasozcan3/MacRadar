import { sanitizeProfilePostLocationInput } from './postComposerValidation';
import type {
  PostLocationPayload,
  SelectedLocation,
} from '../../types/LocationTypes/LocationTypes';

type BuildPostLocationPayloadInput = {
  locationQuery: string;
  normalizedLocation: string;
  selectedLocation: SelectedLocation | null;
};

function queryMatchesSelectedLocation(
  query: string,
  selectedLocation: SelectedLocation | null,
) {
  if (!selectedLocation) {
    return false;
  }

  const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR');
  if (normalizedQuery.length === 0) {
    return false;
  }

  const normalizedFullAddress = selectedLocation.fullAddress
    .trim()
    .toLocaleLowerCase('tr-TR');
  const normalizedName = selectedLocation.name.trim().toLocaleLowerCase('tr-TR');

  return (
    normalizedQuery === normalizedFullAddress ||
    normalizedQuery === normalizedName
  );
}

export function buildPostLocationPayload({
  locationQuery,
  normalizedLocation,
  selectedLocation,
}: BuildPostLocationPayloadInput): PostLocationPayload {
  const sanitizedQuery = sanitizeProfilePostLocationInput(locationQuery).trim();
  const keepSelectedLocation = queryMatchesSelectedLocation(
    sanitizedQuery,
    selectedLocation,
  );

  return {
    source: keepSelectedLocation ? 'mapbox' : 'manual',
    query: sanitizedQuery,
    normalizedQuery: normalizedLocation.trim(),
    selectedLocation: keepSelectedLocation ? selectedLocation : null,
  };
}
