import React, { useCallback, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import FeatherIcon from '../FeatherIcon/FeatherIcon';
import IosSpinner from '../IosSpinner/IosSpinner';
import { Text, TextInput } from '../../theme/typography';
import type {
  LocationAutocompleteResult,
  SelectedLocation,
} from '../../types/LocationTypes/LocationTypes';

type LocationAutocompleteProps = {
  errorMessage?: string | null;
  loadingLocations: boolean;
  locationQuery: string;
  locationResults: LocationAutocompleteResult[];
  maxLength: number;
  minQueryLength?: number;
  onInputBlur: () => void;
  onInputFocus: () => void;
  onLocationQueryChange: (value: string) => void;
  onSelectLocation: (location: LocationAutocompleteResult) => void;
  onSuggestionPressIn?: () => void;
  onSuggestionPressOut?: () => void;
  placeholder?: string;
  selectedLocation: SelectedLocation | null;
  showSuggestions: boolean;
};

function hasSelectedLocationMatch(
  locationQuery: string,
  selectedLocation: SelectedLocation | null,
) {
  if (!selectedLocation) {
    return false;
  }

  const normalizedQuery = locationQuery.trim().toLocaleLowerCase('tr-TR');
  if (normalizedQuery.length === 0) {
    return false;
  }

  return (
    normalizedQuery === selectedLocation.fullAddress.trim().toLocaleLowerCase('tr-TR') ||
    normalizedQuery === selectedLocation.name.trim().toLocaleLowerCase('tr-TR')
  );
}

export default function LocationAutocomplete({
  errorMessage,
  loadingLocations,
  locationQuery,
  locationResults,
  maxLength,
  minQueryLength = 2,
  onInputBlur,
  onInputFocus,
  onLocationQueryChange,
  onSelectLocation,
  onSuggestionPressIn,
  onSuggestionPressOut,
  placeholder = '\u00d6rn. Bebek Sahil, \u0130stanbul',
  selectedLocation,
  showSuggestions,
}: LocationAutocompleteProps) {
  const inputRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const shouldRenderSuggestions =
    showSuggestions && locationQuery.trim().length >= minQueryLength;
  const hasSelectedLocation = hasSelectedLocationMatch(locationQuery, selectedLocation);
  const rootStyle = useMemo(
    () => [styles.root, shouldRenderSuggestions ? styles.rootExpanded : null],
    [shouldRenderSuggestions],
  );
  const handleInputShellPress = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <View style={rootStyle}>
      <Pressable
        onPress={handleInputShellPress}
        style={[
          styles.inputShell,
          shouldRenderSuggestions ? styles.inputShellFocused : null,
        ]}
      >
        <FeatherIcon color="#5f6f86" name="map-pin" size={17} />
        <TextInput
          ref={inputRef}
          maxLength={maxLength}
          onBlur={onInputBlur}
          onChangeText={onLocationQueryChange}
          onFocus={onInputFocus}
          placeholder={placeholder}
          placeholderTextColor="#94a3b8"
          showSoftInputOnFocus={true}
          style={styles.input}
          value={locationQuery}
        />
        <View style={styles.trailingWrap}>
          {loadingLocations ? (
            <IosSpinner color="#f97316" size="small" />
          ) : hasSelectedLocation ? (
            <FeatherIcon color="#16a34a" name="check" size={16} />
          ) : null}
        </View>
      </Pressable>

      {shouldRenderSuggestions ? (
        <View style={styles.suggestionsCard}>
          {loadingLocations && locationResults.length === 0 ? (
            <View style={styles.stateRow}>
              <IosSpinner color="#f97316" size="small" />
              <Text style={styles.stateText}>Konum onerileri yukleniyor...</Text>
            </View>
          ) : errorMessage ? (
            <View style={styles.stateRow}>
              <FeatherIcon color="#dc2626" name="x" size={16} />
              <Text style={[styles.stateText, styles.errorText]}>{errorMessage}</Text>
            </View>
          ) : locationResults.length === 0 ? (
            <View style={styles.stateRow}>
              <Text style={styles.stateText}>Sonuc bulunamadi.</Text>
            </View>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="always"
              nestedScrollEnabled={true}
              style={styles.suggestionsScroll}
            >
              {locationResults.map(item => (
                <Pressable
                  key={item.mapboxId}
                  onPress={() => {
                    onSelectLocation(item);
                  }}
                  onPressIn={onSuggestionPressIn}
                  onPressOut={onSuggestionPressOut}
                  style={styles.suggestionItem}
                >
                  <Text numberOfLines={1} style={styles.suggestionTitle}>
                    {item.name}
                  </Text>
                  <Text numberOfLines={2} style={styles.suggestionSubtitle}>
                    {item.fullAddress}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  errorText: {
    color: '#b91c1c',
  },
  input: {
    color: '#0f172a',
    flex: 1,
    fontSize: 14,
    height: '100%',
    includeFontPadding: false,
    lineHeight: 20,
    marginLeft: 10,
    paddingHorizontal: 0,
    paddingVertical: 0,
    textAlignVertical: 'center',
  },
  inputShell: {
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderColor: '#dbe6f3',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 54,
    paddingHorizontal: 14,
  },
  inputShellFocused: {
    borderColor: '#fb923c',
    shadowColor: '#f97316',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  root: {
    overflow: 'visible',
    position: 'relative',
    zIndex: 10,
  },
  rootExpanded: {
    zIndex: 1200,
  },
  stateRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  stateText: {
    color: '#64748b',
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    marginLeft: 8,
  },
  suggestionItem: {
    borderBottomColor: '#e8edf5',
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  suggestionSubtitle: {
    color: '#5f6f86',
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 3,
  },
  suggestionTitle: {
    color: '#0f172a',
    fontSize: 13.5,
    fontWeight: '700',
    lineHeight: 18,
  },
  suggestionsCard: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe6f3',
    borderRadius: 16,
    borderWidth: 1,
    elevation: 22,
    left: 0,
    maxHeight: 240,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    top: 60,
    zIndex: 1400,
  },
  suggestionsScroll: {
    maxHeight: 240,
  },
  trailingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    minWidth: 18,
  },
});
