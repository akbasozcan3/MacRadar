import React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '../../theme/typography';
import type { ExploreSegment } from '../../types/AppTypes/AppTypes';

type SegmentedControlProps = {
  onChange: (segment: ExploreSegment) => void;
  segments: ExploreSegment[];
  value: ExploreSegment;
};

export default function SegmentedControl({
  onChange,
  segments,
  value,
}: SegmentedControlProps) {
  return (
    <View className="flex-row rounded-[24px] border border-white/5 bg-white/[0.03] p-1.5">
      {segments.map(segment => {
        const focused = segment === value;

        return (
          <Pressable
            accessibilityRole="button"
            className={`flex-1 rounded-[18px] px-3 py-3 ${focused ? 'bg-white/10' : 'bg-transparent'
              }`}
            key={segment}
            onPress={() => onChange(segment)}
            style={({ pressed }) => ({
              opacity: pressed ? 0.8 : 1,
              shadowColor: focused ? '#000' : 'transparent',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1,
              shadowRadius: 4,
            })}
          >
            <Text
              className={`text-center text-[13px] font-bold tracking-tight ${focused ? 'text-frost' : 'text-slate-400/80'
                }`}
            >
              {segment}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
