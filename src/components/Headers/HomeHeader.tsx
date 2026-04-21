import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import FeatherIcon from '../FeatherIcon/FeatherIcon';
import { Text } from '../../theme/typography';

type HomeHeaderProps = {
  onMessagesPress: () => void;
  onNotificationsPress: () => void;
  safeTop: number;
  unreadMessagesCount?: number;
  unreadNotificationsCount?: number;
};

export default function HomeHeader({
  onMessagesPress,
  onNotificationsPress,
  safeTop,
  unreadMessagesCount = 0,
  unreadNotificationsCount = 0,
}: HomeHeaderProps) {
  return (
    <View style={[styles.container, { paddingTop: Math.max(safeTop, 16) }]} pointerEvents="box-none">
      <View style={styles.row}>
        <View style={styles.leadingSpacer} />

        <View style={styles.logoContainer} pointerEvents="none">
          <Text style={styles.logoText}>MacRadar</Text>
        </View>

        <View style={styles.actions}>
          <Pressable onPress={onMessagesPress} style={styles.actionButton}>
            <FeatherIcon name="message-circle" size={22} color="#FFFFFF" />
            {unreadMessagesCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {unreadMessagesCount > 9 ? '9+' : unreadMessagesCount}
                </Text>
              </View>
            )}
          </Pressable>
          <Pressable onPress={onNotificationsPress} style={styles.actionButton}>
            <FeatherIcon name="bell" size={22} color="#FFFFFF" />
            {unreadNotificationsCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    marginLeft: 8,
    width: 40,
  },
  actions: {
    flexDirection: 'row',
  },
  badge: {
    alignItems: 'center',
    backgroundColor: '#EF4444',
    borderRadius: 8,
    height: 16,
    justifyContent: 'center',
    position: 'absolute',
    right: 4,
    top: 4,
    width: 16,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
  container: {
    left: 0,
    paddingHorizontal: 16,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 100,
  },
  leadingSpacer: {
    width: 88,
  },
  logoContainer: {
    alignItems: 'center',
    flexDirection: 'row',
    position: 'absolute',
    left: 0,
    right: 0,
    justifyContent: 'center',
    zIndex: -1,
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
});
