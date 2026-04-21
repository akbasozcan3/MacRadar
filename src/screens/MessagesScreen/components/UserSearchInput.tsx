import React, { memo, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';

import FeatherIcon from '../../../components/FeatherIcon/FeatherIcon';
import { Text, TextInput } from '../../../theme/typography';
import type { ExploreSearchUser } from '../../../types/ExploreTypes/ExploreTypes';
import { resolveUserIdentity } from '../../../utils/hiddenUser';

type UserSearchInputProps = {
  inputRef?: React.RefObject<React.ElementRef<typeof TextInput> | null>;
  onChangeQuery: (value: string) => void;
  query: string;
  selectedUser: ExploreSearchUser | null;
};

function UserSearchInput({
  inputRef,
  onChangeQuery,
  query,
  selectedUser,
}: UserSearchInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const selectedUserIdentity = selectedUser
    ? resolveUserIdentity({
        avatarUrl: selectedUser.avatarUrl,
        fullName: selectedUser.fullName,
        isHidden: selectedUser.isHiddenByRelationship,
        username: selectedUser.username,
      })
    : null;
  const selectedUserLabel = selectedUserIdentity?.displayName ?? '';

  return (
    <View>
      <Text
        allowFontScaling={false}
        className="text-[11px] font-semibold uppercase tracking-[0.8px] text-[#7b8495]"
      >
        Kime
      </Text>

      <Pressable
        onPress={() => {
          inputRef?.current?.focus();
        }}
        style={[styles.inputShell, isFocused ? styles.inputShellFocused : null]}
      >
        <FeatherIcon color="#98a2b3" name="search" size={17} />
        <TextInput
          allowFontScaling={false}
          autoCapitalize="none"
          autoCorrect={false}
          className="ml-3 flex-1 py-0 text-[14px] text-[#101828]"
          onBlur={() => {
            setIsFocused(false);
          }}
          onChangeText={onChangeQuery}
          onFocus={() => {
            setIsFocused(true);
          }}
          onSubmitEditing={() => {
            Keyboard.dismiss();
          }}
          placeholder="Kullanici ara..."
          placeholderTextColor="#98a2b3"
          ref={inputRef}
          returnKeyType="search"
          value={query}
        />
      </Pressable>

      {selectedUser ? (
        <View style={styles.selectedUserChip}>
          <View style={styles.selectedUserDot} />
          <Text
            allowFontScaling={false}
            className="max-w-[240px] text-[11.5px] font-medium text-[#c2410c]"
            numberOfLines={1}
          >
            {selectedUserLabel}
            {selectedUserIdentity?.handleLabel.length &&
            selectedUserIdentity.handleLabel !== selectedUserLabel
              ? ` ${selectedUserIdentity.handleLabel}`
              : ''}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default memo(UserSearchInput);

const styles = StyleSheet.create({
  inputShell: {
    alignItems: 'center',
    backgroundColor: '#fbfcfe',
    borderColor: '#e6ebf2',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    height: 56,
    marginTop: 10,
    paddingHorizontal: 16,
  },
  inputShellFocused: {
    backgroundColor: '#ffffff',
    borderColor: '#ffb390',
    shadowColor: '#ff5a1f',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
  },
  selectedUserChip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#fff6f1',
    borderRadius: 999,
    flexDirection: 'row',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectedUserDot: {
    backgroundColor: '#ff5a1f',
    borderRadius: 99,
    height: 8,
    marginRight: 8,
    width: 8,
  },
});
