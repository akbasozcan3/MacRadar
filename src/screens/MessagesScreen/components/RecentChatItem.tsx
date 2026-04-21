import React, { memo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../../theme/typography';
import type { ExploreSearchUser } from '../../../types/ExploreTypes/ExploreTypes';
import { resolveUserIdentity } from '../../../utils/hiddenUser';

type RecentChatItemProps = {
  isSelected: boolean;
  onPress: (user: ExploreSearchUser) => void;
  user: ExploreSearchUser;
};

function RecentChatItem({ isSelected, onPress, user }: RecentChatItemProps) {
  const identity = resolveUserIdentity({
    avatarUrl: user.avatarUrl,
    fullName: user.fullName,
    isHidden: user.isHiddenByRelationship,
    username: user.username,
  });
  const displayName = identity.displayName;
  const fallbackInitial = identity.initials.slice(0, 1).toUpperCase() || 'U';

  return (
    <Pressable
      onPress={() => {
        onPress(user);
      }}
      style={({ pressed }) => [
        styles.rowBase,
        isSelected ? styles.rowSelected : styles.rowDefault,
        pressed ? styles.rowPressed : null,
      ]}
      className="w-full flex-row items-center rounded-[20px] px-3.5 py-3"
    >
      <View className="h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-[#edf2f7]">
        {identity.avatarUrl.length > 0 ? (
          <Image source={{ uri: identity.avatarUrl }} style={styles.avatar} />
        ) : (
          <Text allowFontScaling={false} className="text-[15px] font-semibold text-[#4f5a6d]">
            {fallbackInitial}
          </Text>
        )}
      </View>

      <View className="ml-3.5 mr-3 flex-1">
        <Text
          allowFontScaling={false}
          className="text-[15px] font-bold tracking-[-0.2px] text-[#111827]"
          numberOfLines={1}
        >
          {displayName}
        </Text>
        <Text
          allowFontScaling={false}
          className="mt-0.5 text-[12px] font-medium text-[#667085]"
          numberOfLines={1}
        >
          {identity.handleLabel}
        </Text>
      </View>

      <View
        style={[
          styles.selectionIndicator,
          isSelected ? styles.selectionIndicatorActive : null,
        ]}
      >
        {isSelected ? <View style={styles.selectionIndicatorInner} /> : null}
      </View>
    </Pressable>
  );
}

export default memo(RecentChatItem);

const styles = StyleSheet.create({
  rowBase: {
    borderWidth: 1,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
  },
  rowDefault: {
    backgroundColor: '#ffffff',
    borderColor: '#e5ebf3',
  },
  rowPressed: {
    opacity: 0.9,
  },
  rowSelected: {
    backgroundColor: '#fff7f2',
    borderColor: '#ffd2bd',
    shadowOpacity: 0.1,
  },
  avatar: {
    height: '100%',
    width: '100%',
  },
  selectionIndicator: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#d5dde8',
    borderRadius: 999,
    borderWidth: 1.5,
    height: 28,
    justifyContent: 'center',
    marginLeft: 'auto',
    width: 28,
  },
  selectionIndicatorActive: {
    borderColor: '#ff5a1f',
  },
  selectionIndicatorInner: {
    backgroundColor: '#ff5a1f',
    borderRadius: 999,
    height: 14,
    width: 14,
  },
});
