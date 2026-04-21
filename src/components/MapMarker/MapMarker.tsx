import React from 'react';
import { View, type DimensionValue } from 'react-native';

import { Text } from '../../theme/typography';
import type { MapHotspot } from '../../types/AppTypes/AppTypes';
import GlassSurface from '../GlassSurface/GlassSurface';

type MapMarkerProps = {
  hotspot: MapHotspot;
};

export default function MapMarker({ hotspot }: MapMarkerProps) {
  const markerPosition = {
    left: hotspot.left as DimensionValue,
    marginLeft: -88,
    top: hotspot.top as DimensionValue,
  };

  return (
    <View className="absolute w-44" style={markerPosition}>
      <GlassSurface className="rounded-[24px] px-3 py-3">
        <Text className="text-[12px] font-semibold leading-5 text-frost">
          {`${hotspot.name} şu an burada gazlıyor.`}
        </Text>
        <Text className="mt-1 text-[11px] text-slate-400">
          {`${hotspot.district} · ${hotspot.eta}`}
        </Text>
      </GlassSurface>

      <View className="mt-2 items-center">
        <View
          className="h-4 w-4 rounded-full border-2 border-frost"
          style={{ backgroundColor: hotspot.accentColor }}
        />
        <View className="h-6 w-[2px] bg-white/40" />
      </View>
    </View>
  );
}
