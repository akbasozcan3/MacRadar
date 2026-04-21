import React, { memo, useCallback, useMemo } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import FeatherIcon from '../../../components/FeatherIcon/FeatherIcon';
import { Text } from '../../../theme/typography';
import type { ExploreSearchUser } from '../../../types/ExploreTypes/ExploreTypes';
import RecentChatItem from './RecentChatItem';

type RecentChatListProps = {
  emptySubtitle: string;
  emptyTitle: string;
  selectedUserId?: string | null;
  title: string;
  users: ExploreSearchUser[];
  onSelectUser: (user: ExploreSearchUser) => void;
};

function RecentChatList({
  emptySubtitle,
  emptyTitle,
  onSelectUser,
  selectedUserId,
  title,
  users,
}: RecentChatListProps) {
  const countLabel = useMemo(() => {
    if (users.length === 0) {
      return null;
    }

    return `${users.length} kisi`;
  }, [users.length]);

  const keyExtractor = useCallback((item: ExploreSearchUser) => item.id, []);
  const renderItem = useCallback(
    ({ item }: { item: ExploreSearchUser }) => (
      <RecentChatItem
        isSelected={selectedUserId === item.id}
        onPress={onSelectUser}
        user={item}
      />
    ),
    [onSelectUser, selectedUserId],
  );

  return (
    <View style={styles.root}>
      <View className="flex-row items-center justify-between">
        <Text
          allowFontScaling={false}
          className="text-[14px] font-semibold tracking-[-0.2px] text-[#111827]"
        >
          {title}
        </Text>

        {countLabel ? (
          <View style={styles.countPill}>
            <Text
              allowFontScaling={false}
              className="text-[10px] font-semibold uppercase tracking-[0.55px] text-[#7b8495]"
            >
              {countLabel}
            </Text>
          </View>
        ) : null}
      </View>

      <FlatList
        alwaysBounceVertical={users.length > 0}
        contentContainerStyle={[
          styles.listContent,
          users.length === 0 ? styles.listContentEmpty : null,
        ]}
        data={users}
        extraData={selectedUserId}
        initialNumToRender={8}
        ItemSeparatorComponent={ListSeparator}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={keyExtractor}
        maxToRenderPerBatch={8}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <FeatherIcon
                color="#98a2b3"
                name={title === 'Son sohbetler' ? 'message-circle' : 'user-x'}
                size={20}
              />
            </View>
            <Text
              allowFontScaling={false}
              className="mt-4 text-center text-[14px] font-medium text-[#111827]"
            >
              {emptyTitle}
            </Text>
            <Text
              allowFontScaling={false}
              className="mt-2 text-center text-[12px] leading-[18px] text-[#7b8495]"
            >
              {emptySubtitle}
            </Text>
          </View>
        }
        renderItem={renderItem}
        removeClippedSubviews={false}
        showsVerticalScrollIndicator={false}
        style={styles.list}
        updateCellsBatchingPeriod={32}
        windowSize={6}
      />
    </View>
  );
}

function ListSeparator() {
  return <View style={styles.separator} />;
}

export default memo(RecentChatList);

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  countPill: {
    backgroundColor: '#f5f7fb',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  list: {
    flex: 1,
    marginTop: 14,
  },
  listContent: {
    paddingBottom: 10,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  separator: {
    backgroundColor: '#d7deea',
    height: 1,
    marginVertical: 8,
    width: '100%',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 240,
    paddingHorizontal: 28,
  },
  emptyIconWrap: {
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 999,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
});
