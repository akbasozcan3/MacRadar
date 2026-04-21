import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import FeatherIcon from '../FeatherIcon/FeatherIcon';
import { Text } from '../../theme/typography';
import type { ExploreSegment } from '../../types/AppTypes/AppTypes';

type ExploreHeaderProps = {
  activeTab: ExploreSegment;
  compactMode?: boolean;
  onBack?: () => void;
  onSearchPress: () => void;
  onTabPress: (segment: ExploreSegment) => void;
  safeTop: number;
  tabs: ExploreSegment[];
};

export default function ExploreHeader({
  activeTab,
  compactMode = false,
  onBack,
  onSearchPress,
  onTabPress,
  safeTop,
  tabs,
}: ExploreHeaderProps) {
  return (
    <View
      style={[
        styles.container,
        { paddingTop: Math.max(safeTop, 8) + 8 },
      ]}
      pointerEvents="box-none"
    >
      <View
        pointerEvents="auto"
        style={[styles.row, compactMode ? styles.rowCompact : null]}
      >
        <Pressable
          onPress={onBack}
          style={styles.edgeButton}
        >
          <FeatherIcon color="#f8fafc" name="arrow-left" size={27} />
        </Pressable>

        {!compactMode ? (
          <View style={styles.tabsShell}>
            <View style={styles.tabsRow}>
              {tabs.map(tab => {
                const isActive = tab === activeTab;
                return (
                  <Pressable
                    key={tab}
                    onPress={() => onTabPress(tab)}
                    style={[styles.tabButton, isActive ? styles.tabButtonActive : null]}
                  >
                    <Text
                      allowFontScaling={false}
                      style={[styles.tabLabel, isActive ? styles.tabLabelActive : null]}
                    >
                      {tab}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : (
          <View style={styles.compactSpacer} />
        )}

        {!compactMode ? (
          <Pressable
            onPress={onSearchPress}
            style={styles.edgeButton}
          >
            <FeatherIcon color="#f8fafc" name="search" size={25} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  compactSpacer: {
    flex: 1,
  },
  container: {
    left: 0,
    paddingHorizontal: 14,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 50,
  },
  edgeButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.58)',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 28,
    borderWidth: 1,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowCompact: {
    justifyContent: 'flex-start',
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 23,
    flex: 1,
    height: 46,
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: '#ffffff',
  },
  tabLabel: {
    color: '#dde3ef',
    fontSize: 12.5,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: '#141923',
    fontWeight: '700',
  },
  tabsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tabsShell: {
    backgroundColor: 'rgba(28, 36, 48, 0.45)',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 30,
    borderWidth: 1,
    flex: 1,
    marginHorizontal: 12,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
});
