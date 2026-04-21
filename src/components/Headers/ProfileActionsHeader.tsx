import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import FeatherIcon from '../FeatherIcon/FeatherIcon';

type ProfileActionsHeaderProps = {
  onAccountPress?: () => void;
  onSettingsPress: () => void;
};

export default function ProfileActionsHeader({
  onAccountPress,
  onSettingsPress,
}: ProfileActionsHeaderProps) {
  return (
    <View style={styles.container}>
      <Pressable onPress={onAccountPress} style={styles.actionButton}>
        <FeatherIcon color="#2c313b" name="user" size={16} />
      </Pressable>

      <Pressable onPress={onSettingsPress} style={styles.actionButton}>
        <FeatherIcon color="#2c313b" name="settings" size={16} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    backgroundColor: '#efe8fb',
    borderColor: '#dbd3ee',
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
});
