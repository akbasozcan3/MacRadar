import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  UIManager,
  View,
} from 'react-native';

import FeatherIcon from '../FeatherIcon/FeatherIcon';
import { Text } from '../../theme/typography';
import type { ExploreSearchUser } from '../../types/ExploreTypes/ExploreTypes';

type LiveNearbyProps = {
  onSeeAllPress?: () => void;
  onUserPress: (user: ExploreSearchUser) => void;
  safeBottom: number;
  users: ExploreSearchUser[];
};

type DisplayNearbyUser = {
  exiting: boolean;
  user: ExploreSearchUser;
};

function initialsFromUser(user: ExploreSearchUser): string {
  const fromUsername = user.username?.trim()?.charAt(0);
  if (fromUsername) {
    return fromUsername.toLocaleUpperCase('tr-TR');
  }
  const fromName = user.fullName?.trim()?.charAt(0);
  if (fromName) {
    return fromName.toLocaleUpperCase('tr-TR');
  }
  return '?';
}

export default function LiveNearby({
  onSeeAllPress,
  onUserPress,
  safeBottom,
  users,
}: LiveNearbyProps) {
  const [displayUsers, setDisplayUsers] = useState<DisplayNearbyUser[]>(() =>
    users.map(user => ({ exiting: false, user })),
  );
  const isMountedRef = useRef(true);
  const displayUsersRef = useRef<DisplayNearbyUser[]>(displayUsers);
  const previousUserIdsRef = useRef<string>('');
  const itemAnimationsRef = useRef<
    Map<string, { opacity: Animated.Value; scale: Animated.Value }>
  >(new Map());

  const getItemAnimation = useCallback((userId: string) => {
    const existing = itemAnimationsRef.current.get(userId);
    if (existing) {
      return existing;
    }
    const created = {
      opacity: new Animated.Value(1),
      scale: new Animated.Value(1),
    };
    itemAnimationsRef.current.set(userId, created);
    return created;
  }, []);

  const animateEnterItem = useCallback(
    (userId: string) => {
      const animation = getItemAnimation(userId);
      animation.opacity.stopAnimation();
      animation.scale.stopAnimation();
      animation.opacity.setValue(0);
      animation.scale.setValue(0.92);
      Animated.parallel([
        Animated.timing(animation.opacity, {
          duration: 170,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.spring(animation.scale, {
          damping: 13,
          mass: 0.9,
          stiffness: 230,
          toValue: 1,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [getItemAnimation],
  );

  const animateExitItem = useCallback(
    (userId: string) => {
      const animation = getItemAnimation(userId);
      animation.opacity.stopAnimation();
      animation.scale.stopAnimation();
      Animated.parallel([
        Animated.timing(animation.opacity, {
          duration: 180,
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.timing(animation.scale, {
          duration: 180,
          toValue: 0.9,
          useNativeDriver: true,
        }),
      ]).start(() => {
        if (!isMountedRef.current) {
          return;
        }
        setDisplayUsers(previous =>
          previous.filter(item => item.user.id !== userId),
        );
        itemAnimationsRef.current.delete(userId);
      });
    },
    [getItemAnimation],
  );

  useEffect(() => {
    displayUsersRef.current = displayUsers;
  }, [displayUsers]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      itemAnimationsRef.current.forEach(animation => {
        animation.opacity.stopAnimation();
        animation.scale.stopAnimation();
      });
      itemAnimationsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (
      Platform.OS === 'android' &&
      typeof UIManager.setLayoutAnimationEnabledExperimental === 'function'
    ) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    const incomingById = new Map(users.map(user => [user.id, user]));
    const enteringIds: string[] = [];
    const exitingIds: string[] = [];
    const previousDisplayUsers = displayUsersRef.current;
    const previousById = new Map(previousDisplayUsers.map(item => [item.user.id, item]));
    const next: DisplayNearbyUser[] = [];

    users.forEach(user => {
      const existing = previousById.get(user.id);
      if (!existing || existing.exiting) {
        enteringIds.push(user.id);
      }
      next.push({ exiting: false, user });
    });

    previousDisplayUsers.forEach(item => {
      if (incomingById.has(item.user.id)) {
        return;
      }
      if (!item.exiting) {
        exitingIds.push(item.user.id);
        next.push({ ...item, exiting: true });
        return;
      }
      next.push(item);
    });

    const changed =
      next.length !== previousDisplayUsers.length ||
      next.some((item, index) => {
        const current = previousDisplayUsers[index];
        return (
          !current ||
          current.user.id !== item.user.id ||
          current.exiting !== item.exiting
        );
      });

    if (changed) {
      displayUsersRef.current = next;
      setDisplayUsers(next);
    }

    enteringIds.forEach(animateEnterItem);
    exitingIds.forEach(animateExitItem);
  }, [animateEnterItem, animateExitItem, users]);

  useEffect(() => {
    const nextIds = users.map(user => user.id).join('|');
    if (previousUserIdsRef.current === nextIds) {
      return;
    }
    previousUserIdsRef.current = nextIds;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [users]);

  if (displayUsers.length === 0) {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={[styles.container, { bottom: safeBottom + 8 }]}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerDot} />
          <Text style={styles.headerTitle}>Sokaktaki Ekip</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={!onSeeAllPress}
          hitSlop={8}
          onPress={() => onSeeAllPress?.()}
          style={styles.allButton}
        >
          <Text style={styles.allButtonText}>Tümü</Text>
          <FeatherIcon color="#94A3B8" name="chevron-right" size={14} />
        </Pressable>
      </View>
      <View style={styles.railCard}>
        <FlatList
          contentContainerStyle={styles.listContent}
          data={displayUsers}
          horizontal
          keyExtractor={item => item.user.id}
          renderItem={({ item }) => {
            const user = item.user;
            const animation = getItemAnimation(user.id);
            return (
              <Animated.View
                style={{
                  opacity: animation.opacity,
                  transform: [{ scale: animation.scale }],
                }}
              >
                <Pressable
                  disabled={item.exiting}
                  onPress={() => onUserPress(user)}
                  style={styles.userCard}
                >
                  <View style={styles.avatarContainer}>
                    {user.avatarUrl.trim().length > 0 ? (
                      <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
                    ) : (
                      <View style={[styles.avatar, styles.avatarFallback]}>
                        <Text style={styles.avatarFallbackText}>
                          {initialsFromUser(user)}
                        </Text>
                      </View>
                    )}
                    <View style={styles.liveIndicator} />
                  </View>
                  <Text numberOfLines={1} style={styles.username}>
                    {user.username}
                  </Text>
                  <Text numberOfLines={1} style={styles.location}>
                    {user.viewerState?.streetFriendStatus === 'accepted'
                      ? 'Yakında'
                      : 'Aktif'}
                  </Text>
                </Pressable>
              </Animated.View>
            );
          }}
          showsHorizontalScrollIndicator={false}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  allButton: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  allButtonText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
    marginRight: 4,
  },
  avatar: {
    borderRadius: 24,
    height: 48,
    width: 48,
  },
  avatarFallback: {
    alignItems: 'center',
    backgroundColor: 'rgba(51, 65, 85, 0.95)',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    color: '#E2E8F0',
    fontSize: 18,
    fontWeight: '700',
  },
  avatarContainer: {
    marginBottom: 6,
    padding: 2,
  },
  container: {
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 50,
  },
  headerDot: {
    backgroundColor: '#22C55E',
    borderColor: '#0f172a',
    borderRadius: 5,
    borderWidth: 1.5,
    height: 10,
    marginRight: 8,
    width: 10,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  headerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  listContent: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  railCard: {
    marginHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
    backgroundColor: 'rgba(8, 14, 28, 0.64)',
    shadowColor: '#020617',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.26,
    shadowRadius: 14,
  },
  liveIndicator: {
    backgroundColor: '#22C55E',
    borderColor: '#0F172A',
    borderRadius: 6,
    borderWidth: 2,
    bottom: 2,
    height: 12,
    position: 'absolute',
    right: 2,
    width: 12,
  },
  location: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '500',
  },
  userCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.74)',
    borderColor: 'rgba(148, 163, 184, 0.22)',
    borderWidth: 1,
    borderRadius: 16,
    marginRight: 10,
    padding: 10,
    shadowColor: '#020617',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.24,
    shadowRadius: 10,
    width: 86,
  },
  username: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
});
