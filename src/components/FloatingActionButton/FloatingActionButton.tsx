import React from 'react';
import { Pressable, View } from 'react-native';

import FeatherIcon from '../FeatherIcon/FeatherIcon';

type FloatingActionButtonProps = {
  active: boolean;
  onPress: () => void;
};

export default function FloatingActionButton({
  active,
  onPress,
}: FloatingActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      className="items-center justify-center"
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.82 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View
        className={`h-10 w-10 items-center justify-center rounded-full border ${
          active ? 'border-neonBlue bg-[#16325d]' : 'border-white/10 bg-[#0b1220]'
        }`}
      >
        <FeatherIcon
          color={active ? '#60a5fa' : '#f8fafc'}
          name="plus-circle"
          size={20}
        />
      </View>
    </Pressable>
  );
}
