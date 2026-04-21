import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import MapboxScreen from '../../location/MapboxScreen';
import HomeHeader from '../../components/Headers/HomeHeader';
import LiveNearby from '../../components/LiveNearby/LiveNearby';
import { resolveProtectedMediaUrl } from '../../services/protectedMedia';
import type { UserProfile } from '../../types/AuthTypes/AuthTypes';
import type { ExploreSearchUser } from '../../types/ExploreTypes/ExploreTypes';
import type { ExploreStreetFriendListItem } from '../../types/ExploreTypes/ExploreTypes';

function resolveLiveNearbyTabClearance(windowHeight: number) {
  if (windowHeight <= 760) {
    return 96;
  }
  if (windowHeight <= 900) {
    return 112;
  }
  return 126;
}

function mapStreetFriendsToNearbyUsers(
  friends: ExploreStreetFriendListItem[],
): ExploreSearchUser[] {
  return friends.map(friend => ({
    id: friend.id,
    username: friend.username,
    fullName: friend.fullName,
    avatarUrl: resolveProtectedMediaUrl(String(friend.avatarUrl || '').trim()),
    isVerified: friend.isVerified,
    isPrivateAccount: false,
    viewerState: {
      streetFriendStatus: 'accepted',
      isStreetFriend: true,
      isFollowing: false,
      followsYou: false,
      followRequestStatus: 'none',
    },
  }));
}

function areNearbyUsersEquivalent(
  previous: ExploreSearchUser[],
  next: ExploreSearchUser[],
): boolean {
  if (previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    const prev = previous[index];
    const current = next[index];
    if (
      prev.id !== current.id ||
      prev.username !== current.username ||
      prev.fullName !== current.fullName ||
      prev.avatarUrl !== current.avatarUrl ||
      prev.isVerified !== current.isVerified
    ) {
      return false;
    }
  }
  return true;
}

type HomeScreenProps = {
  contentBottomInset: number;
  onOpenDirectMessage?: (user: ExploreSearchUser) => void;
  onOpenMessages?: () => void;
  onOpenNotifications?: () => void;
  onOpenProfile?: () => void;
  onOverlayVisibilityChange?: (visible: boolean) => void;
  onProfileChange?: (profile: UserProfile) => void;
  onStreetRequestsViewed?: (count: number) => void;
  profile: UserProfile;
  safeTop: number;
  unreadMessagesCount?: number;
  unreadNotificationsCount?: number;
};

function HomeScreen({
  contentBottomInset,
  onOpenDirectMessage,
  onOpenMessages,
  onOpenNotifications,
  onOpenProfile,
  onOverlayVisibilityChange,
  onProfileChange,
  onStreetRequestsViewed,
  profile,
  safeTop,
  unreadMessagesCount,
  unreadNotificationsCount,
}: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const adaptiveLiveNearbyClearance =
    resolveLiveNearbyTabClearance(windowHeight);
  const [nearbyUsers, setNearbyUsers] = useState<ExploreSearchUser[]>([]);
  const openStreetFriendsModalRef = useRef<(() => void) | null>(null);
  const openMemberProfileModalRef = useRef<((user: ExploreSearchUser) => void) | null>(
    null,
  );

  const handleRegisterOpenStreetFriendsModal = useCallback(
    (open: (() => void) | null) => {
      openStreetFriendsModalRef.current = open;
    },
    [],
  );

  const handleRegisterOpenMemberProfileModal = useCallback(
    (open: ((user: ExploreSearchUser) => void) | null) => {
      openMemberProfileModalRef.current = open;
    },
    [],
  );

  const handleLiveNearbySeeAll = useCallback(() => {
    const open = openStreetFriendsModalRef.current;
    if (open) {
      open();
      return;
    }
    onOpenProfile?.();
  }, [onOpenProfile]);

  const handleStreetFriendsListChange = useCallback(
    (friends: ExploreStreetFriendListItem[]) => {
      const mappedUsers = mapStreetFriendsToNearbyUsers(friends);
      setNearbyUsers(previous =>
        areNearbyUsersEquivalent(previous, mappedUsers) ? previous : mappedUsers,
      );
    },
    [],
  );

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.safeArea}>
      <View style={styles.container}>
        <HomeHeader
          onMessagesPress={onOpenMessages || (() => {})}
          onNotificationsPress={onOpenNotifications || (() => {})}
          safeTop={safeTop}
          unreadMessagesCount={unreadMessagesCount}
          unreadNotificationsCount={unreadNotificationsCount}
        />

        <MapboxScreen
          onOpenDirectMessage={onOpenDirectMessage}
          onOpenProfile={onOpenProfile}
          onOverlayVisibilityChange={onOverlayVisibilityChange}
          onProfileChange={onProfileChange}
          onRegisterOpenMemberProfileModal={handleRegisterOpenMemberProfileModal}
          onRegisterOpenStreetFriendsModal={handleRegisterOpenStreetFriendsModal}
          onStreetFriendsListChange={handleStreetFriendsListChange}
          onStreetRequestsViewed={onStreetRequestsViewed}
          profile={profile}
        />

        <LiveNearby
          onSeeAllPress={handleLiveNearbySeeAll}
          onUserPress={user => {
            const openProfileModal = openMemberProfileModalRef.current;
            if (openProfileModal) {
              openProfileModal(user);
              return;
            }
            onOpenDirectMessage?.(user);
          }}
          safeBottom={
            Math.max(
              insets.bottom,
              contentBottomInset + adaptiveLiveNearbyClearance,
            )
          }
          users={nearbyUsers}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  safeArea: {
    flex: 1,
  },
});

export default React.memo(HomeScreen);
