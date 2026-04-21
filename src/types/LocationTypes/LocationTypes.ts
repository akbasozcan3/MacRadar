export type SelectedLocation = {
  name: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
  mapboxId: string;
};

export type LocationAutocompleteResult = SelectedLocation & {
  placeType: string[];
  relevance: number;
};

export type PostLocationPayload = {
  source: 'manual' | 'mapbox';
  query: string;
  normalizedQuery: string;
  selectedLocation: SelectedLocation | null;
};
