import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';

import FeatherIcon from '../FeatherIcon/FeatherIcon';
import { Text } from '../../theme/typography';
import type {
  FollowRequestStatus,
  StreetFriendStatus,
} from '../../types/ExploreTypes/ExploreTypes';

type MemberStats = {
  buddies: number;
  followers: number;
  following: number;
  posts: number;
};

type MemberProfileModalProps = {
  bio?: string;
  birthYear?: number | null;
  coordinate?: [number, number] | null;
  displayName?: string;
  followRequestStatus?: FollowRequestStatus;
  followsYou?: boolean;
  handle?: string;
  isFollowPending?: boolean;
  isFollowing?: boolean;
  isOnline?: boolean;
  isLiveFollowing?: boolean;
  isLiveFollowEnabled?: boolean;
  isLocalMember?: boolean;
  isStreetFriend?: boolean;
  isStreetFriendPending?: boolean;
  onClose: () => void;
  onLiveFollowToggle?: () => void;
  onNavigatePress?: () => void;
  onMessagePress?: () => void;
  onPrimaryAction?: () => void;
  onStreetFriendAction?: () => void;
  photoUrl?: string;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
  streetFriendActionLabel?: string;
  streetFriendStatus?: StreetFriendStatus;
  stats?: MemberStats;
  statusLabel?: string;
  vehicleLabel?: string;
  visible: boolean;
};

const CARD_MAX_WIDTH = 344;

function getInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');
}

function formatCompactCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace('.0', '')}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace('.0', '')}K`;
  }
  return String(Math.floor(value));
}

export default function MemberProfileModal(props: MemberProfileModalProps) {
  const {
    visible,
    onClose,
    onLiveFollowToggle,
    onNavigatePress,
    onMessagePress,
    onPrimaryAction,
    onStreetFriendAction,
  } = props;
  const [hasPhotoError, setHasPhotoError] = useState(false);
  const [mounted, setMounted] = useState(visible);
  const animation = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const statsPulse = useRef(new Animated.Value(1)).current;

  const rawHandle = props.handle?.trim() || '';
  const normalizedHandle =
    rawHandle.length === 0 ? '' : rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;
  const displayName =
    props.displayName?.trim() || normalizedHandle.replace(/^@/, '').trim() || 'Profil';
  const isOnline = props.isOnline ?? true;
  const isLocalMember = props.isLocalMember ?? false;
  const isFollowing = props.isFollowing ?? false;
  const isLiveFollowing = props.isLiveFollowing ?? false;
  const isLiveFollowEnabled = props.isLiveFollowEnabled ?? true;
  const streetFriendStatus = props.streetFriendStatus ?? 'none';
  const isStreetFriend =
    props.isStreetFriend ?? streetFriendStatus === 'accepted';
  const isFollowPending = props.isFollowPending ?? false;
  const isStreetFriendPending = props.isStreetFriendPending ?? false;
  const followRequestStatus = props.followRequestStatus ?? 'none';
  const stats = props.stats ?? {
    buddies: 0,
    followers: 0,
    following: 0,
    posts: 0,
  };
  const photoUrl = props.photoUrl?.trim() || '';
  const followsYou = props.followsYou ?? false;

  const isFollowPendingOutgoing = followRequestStatus === 'pending_outgoing';
  const isFollowPendingIncoming = followRequestStatus === 'pending_incoming';
  const initials = useMemo(() => getInitials(displayName), [displayName]);
  const imageSource = hasPhotoError || !photoUrl ? undefined : { uri: photoUrl };

  const primaryLabel = props.primaryActionLabel
    ? props.primaryActionLabel
    : isLocalMember
      ? 'Profili Düzenle'
      : isFollowing
        ? 'Takiptesin'
        : isFollowPendingOutgoing
          ? 'Istek Gonderildi'
          : isFollowPendingIncoming
            ? 'Istek Var'
            : 'Takip Et';

  const streetLabel = props.streetFriendActionLabel
    ? props.streetFriendActionLabel
    : streetFriendStatus === 'accepted'
      ? 'Remove from Street'
    : streetFriendStatus === 'pending_outgoing'
      ? 'Undo'
      : streetFriendStatus === 'pending_incoming'
        ? 'Accept'
        : 'Add to Street';

  const liveFollowLabel = props.secondaryActionLabel
    ? props.secondaryActionLabel
    : isLiveFollowing
      ? 'Canlı Takibi Bırak'
      : 'Canlı Takip';

  const statsItems = useMemo(() => {
    return [
      { label: 'Gonderi', value: formatCompactCount(stats.posts) },
      { label: 'Takipci', value: formatCompactCount(stats.followers) },
      { label: 'Takip', value: formatCompactCount(stats.following) },
      { label: 'Yakındakiler', value: formatCompactCount(stats.buddies) },
    ];
  }, [stats.buddies, stats.followers, stats.following, stats.posts]);

  const relationChipLabel = isLocalMember
    ? null
    : streetFriendStatus === 'accepted'
      ? 'Yakındakiler aktif'
      : streetFriendStatus === 'pending_outgoing'
        ? 'Yakındakiler bekliyor'
        : followsYou
          ? 'Seni takip ediyor'
          : isFollowing
            ? 'Takiptesin'
            : null;

  const showStreetAction =
    !isLocalMember &&
    !isStreetFriend &&
    (streetFriendStatus === 'pending_outgoing' ||
      streetFriendStatus === 'pending_incoming');
  const showLiveAction = !isLocalMember;
  const showMessageAction = !isLocalMember && Boolean(onMessagePress);
  const showNavigateAction = !isLocalMember && Boolean(onNavigatePress);
  const showPresenceStatus = !isLocalMember;
  const primaryDisabled = isFollowPending || (!isLocalMember && isFollowPendingOutgoing);

  useEffect(() => {
    setHasPhotoError(false);
  }, [photoUrl]);

  useEffect(() => {
    statsPulse.stopAnimation();
    statsPulse.setValue(1);
    Animated.sequence([
      Animated.spring(statsPulse, {
        damping: 13,
        mass: 0.8,
        stiffness: 260,
        toValue: 1.03,
        useNativeDriver: true,
      }),
      Animated.spring(statsPulse, {
        damping: 14,
        mass: 0.8,
        stiffness: 240,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, [stats.buddies, stats.followers, stats.following, stats.posts, statsPulse]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.spring(animation, {
        damping: 18,
        mass: 0.92,
        stiffness: 260,
        toValue: 1,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(animation, {
      duration: 180,
      toValue: 0,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setMounted(false);
      }
    });
  }, [animation, visible]);

  if (!mounted && !visible) {
    return null;
  }

  const backdropStyle = {
    opacity: animation.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    }),
  };

  const cardStyle = {
    opacity: animation.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    }),
    transform: [
      {
        translateY: animation.interpolate({
          inputRange: [0, 1],
          outputRange: [24, 0],
        }),
      },
      {
        scale: animation.interpolate({
          inputRange: [0, 1],
          outputRange: [0.96, 1],
        }),
      },
    ],
  };

  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent={true}
      transparent={true}
      visible={mounted}
    >
      <StatusBar
        animated={true}
        backgroundColor="transparent"
        barStyle="dark-content"
        hidden={false}
        translucent={true}
      />
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, backdropStyle]} />
        <Pressable onPress={onClose} style={styles.backdropPressable} />

        <Animated.View style={[styles.cardWrap, cardStyle]}>
          <View style={styles.card}>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <FeatherIcon color="#6b7280" name="x" size={15} />
            </Pressable>

            <View style={styles.avatarWrap}>
              <View style={styles.avatarRing}>
                <View style={styles.avatarShell}>
                  {imageSource ? (
                    <Image
                      onError={() => setHasPhotoError(true)}
                      resizeMode="cover"
                      source={imageSource}
                      style={styles.avatarImage}
                    />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Text allowFontScaling={false} style={styles.avatarFallbackText}>
                        {initials || 'U'}
                      </Text>
                    </View>
                  )}
                </View>
                {showPresenceStatus ? (
                  <View
                    style={[
                      styles.onlineDot,
                      isOnline ? styles.onlineDotLive : styles.onlineDotIdle,
                    ]}
                  />
                ) : null}
              </View>
            </View>

            <View style={styles.identityBlock}>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.nameText}>
                {displayName}
              </Text>
              {normalizedHandle.length > 0 ? (
                <Text allowFontScaling={false} numberOfLines={1} style={styles.handleText}>
                  {normalizedHandle}
                </Text>
              ) : null}
            </View>

            {showPresenceStatus || relationChipLabel ? (
              <View style={styles.chipRow}>
                {showPresenceStatus ? (
                  <View
                    style={[
                      styles.statusChip,
                      isOnline ? styles.statusChipOnline : styles.statusChipOffline,
                    ]}
                  >
                    <View
                      style={[
                        styles.statusDot,
                        isOnline ? styles.statusDotOnline : styles.statusDotOffline,
                      ]}
                    />
                    <Text
                      allowFontScaling={false}
                      style={[
                        styles.statusChipText,
                        isOnline ? styles.statusChipTextOnline : styles.statusChipTextOffline,
                      ]}
                    >
                      {isOnline ? 'Çevrimici' : 'Çevrimdışı'}
                    </Text>
                  </View>
                ) : null}
                {relationChipLabel ? (
                  <View style={styles.relationChip}>
                    <FeatherIcon color="#2563eb" name="shield" size={11} />
                    <Text allowFontScaling={false} numberOfLines={1} style={styles.relationChipText}>
                      {relationChipLabel}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <Animated.View style={[styles.statsCard, { transform: [{ scale: statsPulse }] }]}>
              {statsItems.map((item, index) => (
                <React.Fragment key={item.label}>
                  <View style={styles.statItem}>
                    <Text allowFontScaling={false} style={styles.statValue}>
                      {item.value}
                    </Text>
                    <Text allowFontScaling={false} numberOfLines={1} style={styles.statLabel}>
                      {item.label}
                    </Text>
                  </View>
                  {index < statsItems.length - 1 ? (
                    <View style={styles.statDivider} />
                  ) : null}
                </React.Fragment>
              ))}
            </Animated.View>

            <View style={styles.actionRow}>
              <Pressable
                disabled={primaryDisabled}
                onPress={onPrimaryAction}
                style={[
                  styles.primaryButton,
                  isFollowing || isFollowPendingOutgoing || isLocalMember
                    ? styles.primaryButtonSoft
                    : null,
                  primaryDisabled ? styles.buttonDisabled : null,
                ]}
              >
                <View style={styles.primaryButtonContent}>
                  {isLocalMember ? (
                    <FeatherIcon
                      color={
                        isFollowing || isFollowPendingOutgoing || isLocalMember
                          ? '#475569'
                          : '#ffffff'
                      }
                      name="edit-2"
                      size={14}
                      style={styles.primaryButtonIcon}
                    />
                  ) : null}
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    style={[
                      styles.primaryButtonText,
                      isFollowing || isFollowPendingOutgoing || isLocalMember
                        ? styles.primaryButtonTextSoft
                        : null,
                    ]}
                  >
                    {isFollowPending ? 'Bekleniyor...' : primaryLabel}
                  </Text>
                </View>
              </Pressable>

              {showStreetAction ? (
                <Pressable
                  disabled={isStreetFriendPending}
                  onPress={onStreetFriendAction}
                  style={[
                    styles.secondaryButton,
                    streetFriendStatus === 'pending_outgoing'
                      ? styles.secondaryButtonSoft
                      : null,
                    isStreetFriendPending ? styles.buttonDisabled : null,
                  ]}
                >
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    style={[
                      styles.secondaryButtonText,
                      streetFriendStatus === 'pending_outgoing'
                        ? styles.secondaryButtonTextSoft
                        : null,
                    ]}
                  >
                    {isStreetFriendPending ? 'Isleniyor...' : streetLabel}
                  </Text>
                </Pressable>
              ) : null}

              {showLiveAction ? (
                <Pressable
                  onPress={onLiveFollowToggle}
                  style={[
                    styles.secondaryButton,
                    !isLiveFollowEnabled ? styles.secondaryButtonSoft : null,
                  ]}
                >
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    style={[
                      styles.secondaryButtonText,
                      !isLiveFollowEnabled ? styles.secondaryButtonTextSoft : null,
                    ]}
                  >
                    {liveFollowLabel}
                  </Text>
                </Pressable>
              ) : null}

              {showMessageAction ? (
                <Pressable onPress={onMessagePress} style={styles.messageActionButton}>
                  <FeatherIcon color="#2563eb" name="message-circle" size={16} />
                </Pressable>
              ) : null}

              {showNavigateAction ? (
                <Pressable onPress={onNavigatePress} style={styles.messageActionButton}>
                  <FeatherIcon color="#2563eb" name="navigation" size={16} />
                </Pressable>
              ) : null}
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.26)',
  },
  backdropPressable: {
    ...StyleSheet.absoluteFillObject,
  },
  cardWrap: {
    width: '100%',
    zIndex: 1,
  },
  card: {
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e8edf4',
    borderRadius: 28,
    borderWidth: 1,
    maxWidth: CARD_MAX_WIDTH,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 14,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 22 },
    shadowOpacity: 0.14,
    shadowRadius: 30,
    width: '100%',
  },
  closeButton: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  avatarWrap: {
    alignItems: 'center',
    marginTop: 2,
  },
  avatarRing: {
    alignItems: 'center',
    borderColor: '#dbe7ff',
    borderRadius: 40,
    borderWidth: 1.5,
    justifyContent: 'center',
    padding: 4,
  },
  avatarShell: {
    backgroundColor: '#eef2f7',
    borderRadius: 34,
    height: 68,
    overflow: 'hidden',
    width: 68,
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  avatarFallback: {
    alignItems: 'center',
    backgroundColor: '#dbe4ef',
    flex: 1,
    justifyContent: 'center',
  },
  avatarFallbackText: {
    color: '#1f2937',
    fontSize: 22,
    fontWeight: '800',
  },
  onlineDot: {
    borderColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 2,
    bottom: 2,
    height: 14,
    position: 'absolute',
    right: 2,
    width: 14,
  },
  onlineDotLive: {
    backgroundColor: '#22c55e',
  },
  onlineDotIdle: {
    backgroundColor: '#94a3b8',
  },
  identityBlock: {
    alignItems: 'center',
    marginTop: 10,
  },
  nameText: {
    color: '#111827',
    fontSize: 15.5,
    fontWeight: '800',
  },
  handleText: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  chipRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 10,
  },
  statusChip: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    marginHorizontal: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  statusChipOnline: {
    backgroundColor: '#ecfdf3',
    borderColor: '#bbf7d0',
    borderWidth: 1,
  },
  statusChipOffline: {
    backgroundColor: '#f1f5f9',
    borderColor: '#dbe4ef',
    borderWidth: 1,
  },
  statusDot: {
    borderRadius: 3,
    height: 6,
    marginRight: 6,
    width: 6,
  },
  statusDotOnline: {
    backgroundColor: '#16a34a',
  },
  statusDotOffline: {
    backgroundColor: '#94a3b8',
  },
  statusChipText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  statusChipTextOnline: {
    color: '#15803d',
  },
  statusChipTextOffline: {
    color: '#64748b',
  },
  relationChip: {
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    marginHorizontal: 4,
    marginTop: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  relationChipText: {
    color: '#2563eb',
    fontSize: 10.5,
    fontWeight: '700',
    marginLeft: 5,
    maxWidth: 100,
  },
  statsCard: {
    alignItems: 'center',
    backgroundColor: '#fbfcfe',
    borderColor: '#e8edf4',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 14,
    paddingVertical: 10,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  statDivider: {
    backgroundColor: '#e8edf4',
    height: 24,
    width: 1,
  },
  statValue: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
  },
  statLabel: {
    color: '#8a94a6',
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    lineHeight: 10,
    marginTop: 3,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  infoText: {
    color: '#475569',
    flex: 1,
    fontSize: 11,
    marginLeft: 6,
  },
  infoHint: {
    color: '#64748b',
    fontSize: 10.5,
    lineHeight: 15,
    marginTop: 6,
  },
  bioText: {
    color: '#334155',
    fontSize: 10.5,
    lineHeight: 15,
    marginTop: 6,
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 14,
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 12,
  },
  primaryButtonContent: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  primaryButtonIcon: {
    marginRight: 7,
  },
  primaryButtonSoft: {
    backgroundColor: '#f8fafc',
    borderColor: '#dbe4ef',
    borderWidth: 1,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 11.5,
    fontWeight: '700',
  },
  primaryButtonTextSoft: {
    color: '#334155',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    marginLeft: 8,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  secondaryButtonSoft: {
    backgroundColor: '#f8fafc',
    borderColor: '#dbe4ef',
  },
  secondaryButtonText: {
    color: '#c2410c',
    fontSize: 11.5,
    fontWeight: '700',
  },
  secondaryButtonTextSoft: {
    color: '#475569',
  },
  messageActionButton: {
    alignItems: 'center',
    backgroundColor: '#f8fbff',
    borderColor: '#dbe7ff',
    borderRadius: 14,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    marginLeft: 8,
    width: 40,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
});
