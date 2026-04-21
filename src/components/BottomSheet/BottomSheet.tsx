import React from 'react';
import { View } from 'react-native';

import { Text } from '../../theme/typography';
import type { NearbyAction } from '../../types/AppTypes/AppTypes';
import FeatherIcon from '../FeatherIcon/FeatherIcon';
import GlassSurface from '../GlassSurface/GlassSurface';

type BottomSheetProps = {
  actions: NearbyAction[];
  bottomOffset: number;
};

export default function BottomSheet({
  actions,
  bottomOffset,
}: BottomSheetProps) {
  return (
    <View className="absolute inset-x-5" style={{ bottom: bottomOffset }}>
      <GlassSurface className="rounded-[32px] px-5 py-5">
        <View className="mb-4 flex-row items-center justify-between">
          <View>
            <Text className="text-lg font-semibold text-frost">
              Şu an yakındaki aksiyonlar
            </Text>
            <Text className="mt-1 text-sm text-slate-400">
              Gece akışı hızlandı, öne çıkan sinyaller burada.
            </Text>
          </View>
          <View className="h-10 w-10 items-center justify-center rounded-full bg-white/5">
            <FeatherIcon color="#3b82f6" name="activity" size={18} />
          </View>
        </View>

        <View className="gap-3">
          {actions.map(action => (
            <View
              className="flex-row items-center rounded-[24px] border border-white/10 bg-white/5 px-4 py-4"
              key={action.id}
            >
              <View className="mr-4 h-12 w-12 items-center justify-center rounded-2xl bg-neonBlue/14">
                <FeatherIcon color="#3b82f6" name={action.icon} size={20} />
              </View>

              <View className="flex-1">
                <Text className="text-[15px] font-semibold text-frost">
                  {action.title}
                </Text>
                <Text className="mt-1 text-sm leading-5 text-slate-400">
                  {action.subtitle}
                </Text>
              </View>

              <Text className="ml-3 text-xs font-semibold uppercase tracking-[1px] text-neonBlue">
                {action.eta}
              </Text>
            </View>
          ))}
        </View>
      </GlassSurface>
    </View>
  );
}
