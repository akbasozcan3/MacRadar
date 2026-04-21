import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import FeatherIcon from '../../components/FeatherIcon/FeatherIcon';
import IosTitleHeader from '../../components/Headers/IosTitleHeader';
import IosSpinner from '../../components/IosSpinner/IosSpinner';
import ScreenStateCard, {
  ScreenStateCenter,
} from '../../components/ScreenState/ScreenStateCard';
import {
  fetchProfileNotifications,
  markProfileNotificationsRead,
} from '../../services/authService';
import type { ProfileNotificationItem } from '../../services/authService';
import { resolveProtectedMediaUrl } from '../../services/protectedMedia';
import { appendAvatarVersionParam } from '../../utils/profileAvatar';
import { Text } from '../../theme/typography';

type NotificationScreenProps = {
  onBack: () => void;
  onNotificationPress?: (notification: ProfileNotificationItem) => void;
  safeTop: number;
};

export default function NotificationScreen({
  onBack,
  onNotificationPress,
  safeTop,
}: NotificationScreenProps) {
  const resolveNotificationActorLabel = useCallback((item: ProfileNotificationItem) => {
    const fullName = String(item.actorFullName || '').trim();
    if (fullName.length > 0) {
      return fullName;
    }
    const username = String(item.actorUsername || '').trim().replace(/^@+/, '');
    if (username.length > 0) {
      return `@${username}`;
    }
    return '';
  }, []);

  const resolveNotificationAvatarUri = useCallback(
    (item: ProfileNotificationItem) =>
      appendAvatarVersionParam(
        resolveProtectedMediaUrl(item.actorAvatarUrl || ''),
        `${item.id}:${item.createdAt}`,
      ),
    [],
  );

  const [notifications, setNotifications] = useState<ProfileNotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotifications = useCallback(async (refresh = false) => {
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const response = await fetchProfileNotifications({ limit: 40 });
      setNotifications(response.notifications);

      const unreadIds = response.notifications
        .filter(item => !item.isRead)
        .map(item => item.id);

      if (unreadIds.length > 0) {
        await markProfileNotificationsRead({ ids: unreadIds });
        setNotifications(current =>
          current.map(item =>
            unreadIds.includes(item.id) ? { ...item, isRead: true } : item,
          ),
        );
      }
    } catch {
      setError('Bildirimler yuklenirken bir hata olustu.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const renderNotification = ({ item }: { item: ProfileNotificationItem }) => {
    const time = new Date(item.createdAt).toLocaleDateString('tr-TR', {
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
    });
    const actorLabel = resolveNotificationActorLabel(item);
    const headline = actorLabel || item.title || 'Bildirim';
    const canOpenProfile =
      String(item.actorId || '').trim().length > 0 ||
      String(item.fromUserId || '').trim().length > 0;

    return (
      <Pressable
        disabled={!canOpenProfile}
        onPress={() => onNotificationPress?.(item)}
        style={[styles.notificationItem, !item.isRead && styles.unreadItem]}
      >
        <View style={styles.actorAvatarContainer}>
          {item.actorAvatarUrl ? (
            <Image
              source={{ uri: resolveNotificationAvatarUri(item) }}
              style={styles.actorAvatar}
            />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <FeatherIcon name="bell" size={20} color="#94A3B8" />
            </View>
          )}
          {!item.isRead && <View style={styles.unreadDot} />}
        </View>
        <View style={styles.notificationContent}>
          <Text style={styles.notificationTitle}>{headline}</Text>
          <Text style={styles.notificationBody}>{item.body}</Text>
          <Text style={styles.notificationTime}>{time}</Text>
        </View>
        {canOpenProfile ? (
          <View style={styles.profileOpenHintWrap}>
            <FeatherIcon color="#94A3B8" name="chevron-right" size={18} />
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.container}>
      <IosTitleHeader onBack={onBack} safeTop={safeTop} title="Bildirimler" />
      {isLoading ? (
        <View style={styles.center}>
          <IosSpinner size="large" color="#FF5A1F" />
        </View>
      ) : error ? (
        <ScreenStateCenter paddingHorizontal={20}>
          <ScreenStateCard
            actionLabel="Tekrar dene"
            description={error}
            iconName="alert-circle"
            onActionPress={() => loadNotifications()}
            title="Hata"
            tone="error"
          />
        </ScreenStateCenter>
      ) : notifications.length === 0 ? (
        <View style={styles.center}>
          <FeatherIcon name="bell-off" size={48} color="#CBD5E1" />
          <Text style={styles.emptyText}>Henuz bildirim yok</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={notifications}
          keyExtractor={item => item.id}
          refreshControl={
            <RefreshControl
              onRefresh={() => loadNotifications(true)}
              refreshing={isRefreshing}
              tintColor="#FF5A1F"
            />
          }
          renderItem={renderNotification}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  actorAvatar: {
    borderRadius: 24,
    height: 48,
    width: 48,
  },
  actorAvatarContainer: {
    position: 'relative',
  },
  avatarPlaceholder: {
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  container: {
    backgroundColor: '#FFFFFF',
    flex: 1,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 16,
    marginTop: 12,
  },
  listContent: {
    flexGrow: 1,
  },
  notificationBody: {
    color: '#4B5563',
    fontSize: 14,
    marginTop: 2,
  },
  notificationContent: {
    flex: 1,
    marginLeft: 12,
  },
  notificationItem: {
    alignItems: 'center',
    borderBottomColor: '#F1F5F9',
    borderBottomWidth: 1,
    flexDirection: 'row',
    padding: 16,
  },
  notificationTime: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 4,
  },
  notificationTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '600',
  },
  profileOpenHintWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    paddingLeft: 2,
  },
  unreadDot: {
    backgroundColor: '#FF5A1F',
    borderColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 2,
    height: 12,
    position: 'absolute',
    right: 0,
    top: 0,
    width: 12,
  },
  unreadItem: {
    backgroundColor: '#FFF7F5',
  },
});
