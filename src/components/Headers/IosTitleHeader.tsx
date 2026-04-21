import React from 'react';
import { Pressable, StatusBar, StyleSheet, View } from 'react-native';

import FeatherIcon from '../FeatherIcon/FeatherIcon';
import { Text } from '../../theme/typography';

type IosTitleHeaderProps = {
  onBack?: () => void;
  onRightPress?: () => void;
  rightIcon?: string;
  safeTop?: number;
  title: string;
};

export default function IosTitleHeader({
  onBack,
  onRightPress,
  rightIcon,
  safeTop = 0,
  title,
}: IosTitleHeaderProps) {
  return (
    <View style={[styles.container, { paddingTop: Math.max(safeTop, 8) + 2 }]}>
      <StatusBar
        animated={true}
        barStyle="dark-content"
        backgroundColor="#ffffff"
        translucent={false}
      />
      <View style={styles.row}>
        <Pressable
          disabled={!onBack}
          onPress={onBack}
          style={styles.iconButton}
        >
          <FeatherIcon color="#2a2a33" name="arrow-left" size={18} />
        </Pressable>

        <Text style={styles.title}>{title}</Text>

        {rightIcon ? (
          <Pressable
            disabled={!onRightPress}
            onPress={onRightPress}
            style={styles.iconButton}
          >
            <FeatherIcon color="#2a2a33" name={rightIcon} size={16} />
          </Pressable>
        ) : (
          <View style={styles.iconButton} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderBottomColor: '#d8dbe3',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 42,
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  title: {
    color: '#1f1f24',
    fontSize: 13,
    fontWeight: '400',
  },
});
