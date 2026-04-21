import React from 'react';
import { StyleSheet, View } from 'react-native';

let MapboxModule: any = null;

try {
  MapboxModule = require('@rnmapbox/maps');
} catch {
  MapboxModule = null;
}

export default function MapStage() {
  if (MapboxModule?.MapView) {
    const MapView = MapboxModule.MapView;
    const Camera = MapboxModule.Camera;
    const styleURL = MapboxModule.StyleURL?.Dark;

    return (
      <View style={StyleSheet.absoluteFillObject}>
        <MapView
          attributionEnabled={false}
          compassEnabled
          rotateEnabled
          scaleBarEnabled={false}
          style={StyleSheet.absoluteFillObject}
          styleURL={styleURL}
        >
          <Camera centerCoordinate={[29.0362, 41.0422]} zoomLevel={11.4} />
        </MapView>
        <View className="absolute inset-0 bg-[#0f172a]/35" />
      </View>
    );
  }

  return (
    <View className="absolute inset-0 bg-[#020617]">
      <View className="absolute left-[-80px] top-[-60px] h-72 w-72 rounded-full bg-neonBlue/18" />
      <View className="absolute bottom-28 right-[-120px] h-80 w-80 rounded-full bg-neonPurple/14" />
      <View className="absolute left-10 top-24 h-32 w-32 rounded-full border border-white/10" />
      <View className="absolute right-16 top-48 h-52 w-52 rounded-full border border-white/10" />
      <View className="absolute bottom-52 left-[-20px] h-44 w-44 rounded-full border border-white/10" />

      <View className="absolute inset-x-8 top-[22%] h-[1px] bg-white/10" />
      <View className="absolute inset-x-8 top-[38%] h-[1px] bg-white/10" />
      <View className="absolute inset-x-8 top-[54%] h-[1px] bg-white/10" />
      <View className="absolute left-[24%] top-20 bottom-28 w-[1px] bg-white/10" />
      <View className="absolute left-[56%] top-24 bottom-32 w-[1px] bg-white/10" />
      <View className="absolute inset-0 bg-[#0f172a]/60" />
    </View>
  );
}
