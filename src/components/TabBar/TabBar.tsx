import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { subscribeAppLanguage, translateText } from '../../i18n/runtime';
import type { TabKey } from '../../types/AppTypes/AppTypes';
import FeatherIcon from '../FeatherIcon/FeatherIcon';

export type TabBarProps = {
  actionActive: boolean;
  activeTab: TabKey;
  messagesBadgeCount?: number;
  onActionPress: () => void;
  onTabPress: (tab: TabKey) => void;
  profileBadgeCount?: number;
  safeBottom: number;
};

type TabBarItemProps = {
  active: boolean;
  badgeCount?: number;
  icon: string;
  label: string;
  onPress: () => void;
  testID?: string;
};

const TAB_BUTTON_SIZE = 48;
const TAB_ICON_SIZE = 20;

function BadgeDot({ count }: { count: number }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1.25,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]);

    const loop = Animated.loop(pulse, { iterations: 2 });
    loop.start();

    return () => {
      loop.stop();
    };
  }, [count, scaleAnim]);

  const hasCount = count > 0;
  const label = count > 99 ? '99+' : count > 9 ? '9+' : String(count);

  return (
    <Animated.View
      style={[
        styles.badge,
        hasCount ? styles.badgeWithCount : styles.badgeDot,
        { transform: [{ scale: scaleAnim }] },
      ]}
    >
      {hasCount ? (
        <Text allowFontScaling={false} style={styles.badgeText}>
          {label}
        </Text>
      ) : null}
    </Animated.View>
  );
}

function TabBarItem({
  active,
  badgeCount,
  icon,
  label,
  onPress,
  testID,
}: TabBarItemProps) {
  const hasBadge = typeof badgeCount === 'number' && badgeCount > 0;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.tabButton,
        pressed ? styles.tabButtonPressed : null,
      ]}
    >
      <View
        style={[styles.tabBubble, active ? styles.tabBubbleActive : null]}
      >
        <FeatherIcon
          color="#FFFFFF"
          name={icon}
          size={TAB_ICON_SIZE}
          strokeWidth={2.3}
        />
        {hasBadge ? <BadgeDot count={badgeCount!} /> : null}
      </View>
    </Pressable>
  );
}

export default function TabBar({
  actionActive,
  activeTab,
  messagesBadgeCount,
  onActionPress,
  onTabPress,
  profileBadgeCount,
  safeBottom,
}: TabBarProps) {
  const [i18nBump, setI18nBump] = useState(0);
  useEffect(() => {
    return subscribeAppLanguage(() => {
      setI18nBump(value => value + 1);
    });
  }, []);

  const tabVisuals = useMemo(
    () =>
      [
        { key: 'home' as const, label: translateText('Ana sayfa'), icon: 'home' },
        {
          key: 'explore' as const,
          label: translateText('Keşffet'),
          icon: 'search',
        },
        {
          key: 'action' as const,
          label: translateText('Yeni gönderi'),
          icon: 'camera',
        },
        {
          key: 'messages' as const,
          label: translateText('Mesajlar'),
          icon: 'message-circle',
        },
        { key: 'profile' as const, label: translateText('Profil'), icon: 'user' },
      ] as const,
    [i18nBump],
  );

  return (
    <View pointerEvents="box-none" style={styles.absoluteWrap}>
      <View
        style={[
          styles.bottomInsetWrap,
          { paddingBottom: Math.max(safeBottom, 18) },
        ]}
      >
        <View style={styles.pillShell}>
          <View style={styles.pillRow}>
            {tabVisuals.map(item => {
              const isAction = item.key === 'action';
              const isActive = isAction ? actionActive : activeTab === item.key;
              const badgeCount =
                item.key === 'messages'
                  ? messagesBadgeCount
                  : item.key === 'profile'
                    ? profileBadgeCount
                    : undefined;

              return (
                <TabBarItem
                  key={item.key}
                  active={isActive}
                  badgeCount={badgeCount}
                  icon={item.icon}
                  label={item.label}
                  testID={`tab-${item.key}`}
                  onPress={() => {
                    if (isAction) {
                      onActionPress();
                      return;
                    }

                    onTabPress(item.key as TabKey);
                  }}
                />
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  absoluteWrap: {
    alignItems: 'center',
    bottom: 28,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    right: 6,
    top: 6,
  },
  badgeDot: {
    backgroundColor: '#EF4444',
    borderColor: '#3A3F4A',
    borderRadius: 5,
    borderWidth: 1.5,
    height: 10,
    width: 10,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 8.5,
    fontWeight: '800',
    lineHeight: 11,
    textAlign: 'center',
  },
  badgeWithCount: {
    backgroundColor: '#EF4444',
    borderColor: '#3A3F4A',
    borderRadius: 8,
    borderWidth: 1.5,
    height: 16,
    minWidth: 16,
    paddingHorizontal: 2,
  },
  bottomInsetWrap: {
    alignItems: 'center',
    paddingHorizontal: 15,
  },
  pillRow: {
    alignItems: 'center',
    backgroundColor: '#4B4E54',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 14,
  },
  pillShell: {
    borderColor: '#3F4248',
    borderRadius: 999,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 14,
  },
  tabBubble: {
    alignItems: 'center',
    backgroundColor: '#5C5F66',
    borderRadius: TAB_BUTTON_SIZE / 2,
    height: TAB_BUTTON_SIZE,
    justifyContent: 'center',
    overflow: 'hidden',
    width: TAB_BUTTON_SIZE,
  },
  tabBubbleActive: {
    backgroundColor: '#FF632E',
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 999,
    height: TAB_BUTTON_SIZE,
    justifyContent: 'center',
    width: TAB_BUTTON_SIZE,
  },
  tabButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.97 }],
  },
});
