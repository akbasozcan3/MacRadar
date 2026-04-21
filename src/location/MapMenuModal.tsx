import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Dimensions,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  useWindowDimensions,
  View,
} from 'react-native';
import { BlurView } from '@react-native-community/blur';

import { useApiActionFeedback } from '../alerts/useApiActionFeedback';
import FeatherIcon from '../components/FeatherIcon/FeatherIcon';
import IosSpinner from '../components/IosSpinner/IosSpinner';
import { Text } from '../theme/typography';

import {
  fetchStreetFriendRequests,
  removeStreetFriend,
  upsertStreetFriend,
} from '../services/exploreService';
import type { ExploreStreetFriendRequestItem } from '../types/ExploreTypes/ExploreTypes';
import { resolveProfileAvatarUrl } from '../utils/profileAvatar';

export type MapMenuSection =
  | 'root'
  | 'visibility'
  | 'location'
  | 'map_settings'
  | 'street_requests';

export type MapFilterMode = 'street_friends' | 'all';
export type MapThemeMode = 'dark' | 'light' | 'street';
type MenuVisualTheme = 'premium' | 'minimal';

type MapMenuModalProps = {
  activeSection: MapMenuSection;
  activeStreetFriendsCount: number;
  canRecenter: boolean;
  hasLocationPermission: boolean;
  isTrackingEnabled: boolean;
  visibleDriversCount: number;
  streetFriendIncomingRequestCount: number;
  streetFriendsCount: number;
  socketStatus: string;
  isPreferencesSaving: boolean;
  isVisibilityEnabled: boolean;
  isVisibilitySaving: boolean;
  localLayerEnabled: boolean;
  mapFilterMode: MapFilterMode;
  mapThemeMode: MapThemeMode;
  menuError: string | null;
  permissionPermanentlyDenied: boolean;
  remoteLayerEnabled: boolean;
  safeBottom: number;
  visible: boolean;
  onBackToRoot: () => void;
  onClose: () => void;
  onLocalLayerToggle: (next: boolean) => void;
  onOpenSection: (next: Exclude<MapMenuSection, 'root'>) => void;
  onOpenStreetFriends: () => void;
  onPermissionAction: () => void;
  onRecenter: () => void;
  onRemoteLayerToggle: (next: boolean) => void;
  onRetryMenuSync: () => void;
  onFilterModeChange: (next: MapFilterMode) => void;
  onThemeChange: (next: MapThemeMode) => void;
  onTrackingToggle: (next: boolean) => void;
  onVisibilityChange: (next: boolean) => void;
  onStreetRequestsViewed?: (count: number) => void;
};

const ACTIVE_MENU_THEME: MenuVisualTheme = 'minimal';

const THEME_CONFIG = {
  premium: {
    iconColor: '#f8fafc',
    label: 'Premium',
    // Component specific tailwind classes
    sheet: 'bg-[#0f141e]/95 border-white/[0.08]',
    grabber: 'bg-white/20',
    topBarTitle: 'text-white',
    topBarButton: 'bg-white/5 border-white/10',
    hintCard: 'bg-[#ff5a1f]/10 border-[#ff5a1f]/20',
    hintIconWrap: 'bg-[#ff5a1f]/20',
    hintText: 'text-slate-300',
    quickButton: 'bg-white/5 border-white/10',
    quickButtonPressed: 'bg-white/10',
    quickButtonText: 'text-white',
    quickToggleCard: 'bg-white/5 border-white/10',
    quickToggleTitle: 'text-white',
    quickToggleSubtitle: 'text-white/50',
    rowShell: 'bg-white/[0.04] border-white/[0.06]',
    rowShellPressed: 'bg-white/10',
    rowTitle: 'text-white',
    rowSubtitle: 'text-white/45',
    rowIconWrap: 'bg-white/5 border-white/10',
    rowDivider: 'bg-white/10',
    segmentItem: 'bg-white/5 border-white/10',
    segmentTitle: 'text-white',
    segmentSubtitle: 'text-white/45',
    segmentItemActive: 'bg-[#ff5a1f] border-[#ff5a1f]',
    segmentTitleActive: 'text-white',
    segmentSubtitleActive: 'text-white/80',
    statusText: 'text-white/60',
    errorCard: 'bg-red-500/15 border-red-500/25',
    errorText: 'text-red-400',
    backdropTint: 'bg-black/60',
  },
  minimal: {
    iconColor: '#1f2937',
    label: 'Minimal',
    sheet: 'bg-[#f7f9fc] border-[#d8dfeb]',
    grabber: 'bg-[#d2d9e4]',
    topBarTitle: 'text-slate-900',
    topBarButton: 'bg-white border-[#dbe2ec]',
    hintCard: 'bg-[#f6f8fb] border-[#e2e8f0]',
    hintIconWrap: 'bg-[#ffe8dc]',
    hintText: 'text-[#5b6577]',
    quickButton: 'bg-white border-[#dfe6f0]',
    quickButtonPressed: 'bg-[#f3f6fa]',
    quickButtonText: 'text-slate-800',
    quickToggleCard: 'bg-white border-[#dfe6f0]',
    quickToggleTitle: 'text-slate-800',
    quickToggleSubtitle: 'text-[#7b8698]',
    rowShell: 'bg-white border-[#e0e7f1]',
    rowShellPressed: 'bg-[#f4f7fb]',
    rowTitle: 'text-slate-800',
    rowSubtitle: 'text-[#6f7b8f]',
    rowIconWrap: 'bg-[#f3f6fb] border-[#e2e8f2]',
    rowDivider: 'bg-[#e5ebf3]',
    segmentItem: 'bg-white border-[#e1e8f2]',
    segmentTitle: 'text-slate-800',
    segmentSubtitle: 'text-[#7a8598]',
    segmentItemActive: 'bg-slate-800 border-slate-800',
    segmentTitleActive: 'text-white',
    segmentSubtitleActive: 'text-slate-300',
    statusText: 'text-[#5f6b7f]',
    errorCard: 'bg-[#fff7ed] border-[#fed7aa]',
    errorText: 'text-[#9a3412]',
    backdropTint: 'bg-black/20',
  },
}[ACTIVE_MENU_THEME];

const SCROLL_CONTENT_STYLE = { paddingBottom: 6 };

export const MAP_MENU_SHEET_SPRING = {
  damping: 24,
  mass: 0.92,
  stiffness: 240,
} as const;

export const MAP_MENU_SHEET_CLOSE_DURATION = 190;

export const MAP_MENU_SHEET_LAYOUT = {
  tabBarOffset: 1,
  safeBottomPadding: 16,
  minTopGap: 24,
  minHeight: 530,
  heightRatio: 0.8,
  halfVisibleMax: 420,
  halfVisibleMin: 300,
  closedOffset: 24,
} as const;

export const MAP_MENU_SHEET_GESTURE = {
  velocityBoost: 56,
  closeBuffer: 130,
  closeVelocity: 1.25,
  halfSnapRatio: 0.55,
} as const;

type NavRowProps = {
  icon: string;
  iconColor: string;
  onPress: () => void;
  subtitle: string;
  title: string;
};

type ToggleRowProps = {
  description: string;
  disabled?: boolean;
  icon: string;
  iconColor: string;
  onToggle: (next: boolean) => void;
  title: string;
  value: boolean;
};

type SegmentOption = {
  key: string;
  subtitle: string;
  title: string;
};

type SegmentControlProps = {
  activeKey: string;
  options: SegmentOption[];
  onChange: (nextKey: string) => void;
};

type SettingsItemProps = {
  description: string;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
  title: string;
  value: boolean;
};

function sectionTitle(section: MapMenuSection) {
  switch (section) {
    case 'visibility':
      return 'Görünürlük';
    case 'location':
      return 'Konum';
    case 'map_settings':
      return 'Harita Ayarlari';
    case 'street_requests':
      return 'Yakındakiler İstekleri';
    default:
      return 'Harita Menüsü';
  }
}

function NavRow({
  icon,
  iconColor,
  onPress,
  subtitle,
  title,
}: NavRowProps) {
  const newRequestPrefix = 'Yeni istek:';
  const newRequestIndex = subtitle.indexOf(newRequestPrefix);
  const hasNewRequestSegment = newRequestIndex >= 0;
  const subtitleBeforeNewRequest = hasNewRequestSegment
    ? subtitle.slice(0, newRequestIndex)
    : subtitle;
  const subtitleAfterNewRequest = hasNewRequestSegment
    ? subtitle.slice(newRequestIndex + newRequestPrefix.length)
    : '';

  return (
    <Pressable
      onPress={onPress}
      className="mb-3"
      style={({ pressed }) => [
        pressed ? { transform: [{ scale: 0.98 }] } : null,
      ]}
    >
      {({ pressed }) => (
        <View
          className={`min-h-[68px] flex-row items-center rounded-[24px] border-[1.2px] px-4 py-3 ${THEME_CONFIG.rowShell} ${pressed ? THEME_CONFIG.rowShellPressed : ''}`}
        >
          <View
            className={`w-10 h-10 rounded-[14px] border items-center justify-center mr-3.5 ${THEME_CONFIG.rowIconWrap}`}
          >
            <FeatherIcon color={iconColor} name={icon} size={16} />
          </View>
          <View className="mr-3 flex-1 justify-center">
            <Text allowFontScaling={false} className={`text-[15px] font-[700] tracking-[-0.3px] ${THEME_CONFIG.rowTitle}`}>
              {title}
            </Text>
            <Text allowFontScaling={false} className={`text-[12px] mt-[3px] leading-[16px] ${THEME_CONFIG.rowSubtitle}`}>
              {hasNewRequestSegment ? (
                <>
                  {subtitleBeforeNewRequest}
                  <Text
                    allowFontScaling={false}
                    className={
                      ACTIVE_MENU_THEME === 'premium'
                        ? 'font-[700] text-white'
                        : 'font-[700] text-slate-800'
                    }
                  >
                    Yeni istek
                  </Text>
                  :{subtitleAfterNewRequest}
                </>
              ) : (
                subtitle
              )}
            </Text>
          </View>
          <View className="ml-auto opacity-40">
            <FeatherIcon color={iconColor} name="chevron-right" size={18} />
          </View>
        </View>
      )}
    </Pressable>
  );
}

function ToggleRow({
  description,
  disabled = false,
  icon,
  iconColor,
  onToggle,
  title,
  value,
}: ToggleRowProps) {
  return (
    <View
      className={`mb-3 min-h-[68px] flex-row items-center rounded-[24px] border-[1.2px] px-4 py-3 ${THEME_CONFIG.rowShell} ${disabled ? 'opacity-55' : ''}`}
    >
      <View
        className={`w-10 h-10 rounded-[14px] border items-center justify-center mr-3.5 ${THEME_CONFIG.rowIconWrap}`}
      >
        <FeatherIcon color={iconColor} name={icon} size={16} />
      </View>
      <View className="mr-3 flex-1 justify-center">
        <Text allowFontScaling={false} className={`text-[15px] font-[700] tracking-[-0.3px] ${THEME_CONFIG.rowTitle}`}>
          {title}
        </Text>
        <Text allowFontScaling={false} className={`text-[12px] mt-[3px] leading-[16px] ${THEME_CONFIG.rowSubtitle}`}>
          {description}
        </Text>
      </View>
      <Switch
        disabled={disabled}
        ios_backgroundColor="#d1d5db"
        onValueChange={onToggle}
        thumbColor="#ffffff"
        trackColor={{ false: '#d1d5db', true: '#ff5a1f' }}
        value={value}
      />
    </View>
  );
}

function SegmentControl({
  activeKey,
  onChange,
  options,
}: SegmentControlProps) {
  return (
    <View className="mb-[10px] flex-row gap-2">
      {options.map(option => {
        const isActive = option.key === activeKey;
        return (
          <Pressable
            key={option.key}
            onPress={() => {
              onChange(option.key);
            }}
            className="flex-1"
            style={({ pressed }) => [
              pressed ? { opacity: 0.88 } : null,
            ]}
          >
            <View
              className={`min-h-[70px] px-3 py-3 rounded-[18px] border-[1.5px] ${isActive ? THEME_CONFIG.segmentItemActive : THEME_CONFIG.segmentItem}`}
            >
              <Text
                allowFontScaling={false}
                className={`text-[14px] font-[800] tracking-[-0.2px] ${isActive ? THEME_CONFIG.segmentTitleActive : THEME_CONFIG.segmentTitle}`}
              >
                {option.title}
              </Text>
              <Text
                allowFontScaling={false}
                className={`text-[10px] leading-[14px] mt-0.5 ${isActive ? THEME_CONFIG.segmentSubtitleActive : THEME_CONFIG.segmentSubtitle}`}
              >
                {option.subtitle}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function SettingsItem({
  description,
  disabled = false,
  onToggle,
  title,
  value,
}: SettingsItemProps) {
  return (
    <View className="flex-row items-start px-1 py-3">
      <View className="mr-3 flex-1">
        <Text
          allowFontScaling={false}
          className={`text-[14px] font-[700] tracking-[-0.2px] ${THEME_CONFIG.rowTitle}`}
        >
          {title}
        </Text>
        <Text
          allowFontScaling={false}
          className={`mt-[3px] text-[11.5px] leading-[16px] ${THEME_CONFIG.rowSubtitle}`}
        >
          {description}
        </Text>
      </View>
      <Switch
        disabled={disabled}
        ios_backgroundColor="#d1d5db"
        onValueChange={onToggle}
        thumbColor="#ffffff"
        trackColor={{ false: '#d1d5db', true: '#ff5a1f' }}
        value={value}
      />
    </View>
  );
}

function SectionHint({
  iconColor,
  text,
}: {
  iconColor: string;
  text: string;
}) {
  return (
    <View
      className={`mb-3 flex-row items-start rounded-[16px] border-[1.5px] px-3.5 py-3 ${THEME_CONFIG.hintCard}`}
    >
      <View
        className={`w-4 h-4 rounded-[8px] items-center justify-center mr-2 mt-[1px] ${THEME_CONFIG.hintIconWrap}`}
      >
        <FeatherIcon color={iconColor} name="info" size={10} />
      </View>
      <Text allowFontScaling={false} className={`flex-1 text-[11.5px] leading-[16px] ${THEME_CONFIG.hintText}`}>
        {text}
      </Text>
    </View>
  );
}

export default function MapMenuModal({
  activeSection,
  activeStreetFriendsCount,
  canRecenter,
  hasLocationPermission,
  isTrackingEnabled,
  visibleDriversCount,
  streetFriendIncomingRequestCount,
  streetFriendsCount,
  socketStatus,
  isPreferencesSaving,
  isVisibilityEnabled,
  isVisibilitySaving,
  localLayerEnabled,
  mapFilterMode,
  mapThemeMode,
  menuError,
  permissionPermanentlyDenied,
  remoteLayerEnabled,
  safeBottom,
  visible,
  onBackToRoot,
  onClose,
  onLocalLayerToggle,
  onOpenSection,
  onOpenStreetFriends,
  onPermissionAction,
  onRecenter,
  onRemoteLayerToggle,
  onRetryMenuSync,
  onFilterModeChange,
  onThemeChange,
  onTrackingToggle,
  onVisibilityChange,
  onStreetRequestsViewed,
}: MapMenuModalProps) {
  const { notifyApiError } = useApiActionFeedback();
  const { height, width } = useWindowDimensions();
  const stackQuickActions = width < 520;
  const [sheetMode, setSheetMode] = useState<'half' | 'full'>('full');
  const [runInBackground, setRunInBackground] = useState(false);
  const [liveLocationSharing, setLiveLocationSharing] = useState(isTrackingEnabled);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [backgroundConfirmVisible, setBackgroundConfirmVisible] = useState(false);

  const [streetRequests, setStreetRequests] = useState<ExploreStreetFriendRequestItem[]>([]);
  const [isLoadingStreetRequests, setIsLoadingStreetRequests] = useState(false);
  const [pendingStreetRequestId, setPendingStreetRequestId] = useState<string | null>(null);

  const translateY = useRef(new Animated.Value(0)).current;
  const offsetRef = useRef(0);
  const closingRef = useRef(false);
  const tabBarOffset = 1;
  const sheetMaxHeight = Math.min(
    height - Math.max(safeBottom + tabBarOffset + 16, 24),
    Math.max(530, Math.round(height * 0.8)),
  );
  const fullOffset = 0;
  const halfVisibleHeight = Math.min(420, Math.max(300, Math.round(height * 0.5)));
  const halfOffset = Math.max(0, sheetMaxHeight - halfVisibleHeight);
  const closedOffset = sheetMaxHeight + 24;
  const streetFriendsSubtitle = useMemo(() => {
    const requestParts: string[] = [];
    if (streetFriendIncomingRequestCount > 0) {
      requestParts.push(`Yeni istek: ${streetFriendIncomingRequestCount}`);
    }

    if (streetFriendsCount === 0) {
      return requestParts.length > 0
        ? requestParts.join(' | ')
        : 'Istekleri, aktif uyeleri ve canli takip kisayollarini yonet';
    }

    const requestSuffix =
      requestParts.length > 0 ? ` | ${requestParts.join(' | ')}` : '';
    return `${activeStreetFriendsCount} canli / ${streetFriendsCount} arkadas${requestSuffix}`;
  }, [
    activeStreetFriendsCount,
    streetFriendIncomingRequestCount,
    streetFriendsCount,
  ]);
  const loadStreetRequests = useCallback(async () => {
    setIsLoadingStreetRequests(true);
    try {
      const response = await fetchStreetFriendRequests();
      const incoming = response.requests.filter(r => r.streetFriendStatus === 'pending_incoming');
      setStreetRequests(incoming);
      onStreetRequestsViewed?.(incoming.length);
    } catch (err) {
      console.error('[MapMenuModal] Failed to load street requests:', err);
    } finally {
      setIsLoadingStreetRequests(false);
    }
  }, [onStreetRequestsViewed]);

  useEffect(() => {
    if (activeSection === 'street_requests' && visible) {
      loadStreetRequests();
    }
  }, [activeSection, loadStreetRequests, visible]);

  const handleAcceptRequest = async (requestId: string) => {
    setPendingStreetRequestId(requestId);
    try {
      const response = await upsertStreetFriend(requestId);
      if (
        response.isStreetFriend ||
        response.streetFriendStatus === 'accepted'
      ) {
        setStreetRequests(prev => {
          const next = prev.filter(r => r.id !== requestId);
          const incoming = next.filter(
            r => r.streetFriendStatus === 'pending_incoming',
          );
          onStreetRequestsViewed?.(incoming.length);
          return next;
        });
      } else {
        await loadStreetRequests();
      }
    } catch (err) {
      notifyApiError(err, {
        fallbackMessage: 'Yakındakiler isteği onaylanamadı. Lütfen tekrar dene.',
        title: 'Yakındakiler isteği',
        tone: 'danger',
      });
    } finally {
      setPendingStreetRequestId(null);
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    setPendingStreetRequestId(requestId);
    try {
      await removeStreetFriend(requestId);
      setStreetRequests(prev => {
        const next = prev.filter(r => r.id !== requestId);
        const incoming = next.filter(
          r => r.streetFriendStatus === 'pending_incoming',
        );
        onStreetRequestsViewed?.(incoming.length);
        return next;
      });
    } catch (err) {
      notifyApiError(err, {
        fallbackMessage: 'Yakındakiler isteği reddedilemedi. Lütfen tekrar dene.',
        title: 'Yakındakiler isteği',
        tone: 'danger',
      });
    } finally {
      setPendingStreetRequestId(null);
    }
  };

  const startBackgroundService = useCallback(() => {
    if (__DEV__) {
      console.log('[map-menu] mock background service started');
    }
  }, []);
  const stopBackgroundService = useCallback(() => {
    if (__DEV__) {
      console.log('[map-menu] mock background service stopped');
    }
  }, []);

  const animateTo = useCallback(
    (nextOffset: number, nextMode: 'half' | 'full') => {
      Animated.spring(translateY, {
        damping: 24,
        mass: 0.92,
        stiffness: 240,
        toValue: nextOffset,
        useNativeDriver: true,
      }).start(() => {
        offsetRef.current = nextOffset;
        setSheetMode(nextMode);
      });
    },
    [translateY],
  );

  const closeWithAnimation = useCallback(() => {
    if (closingRef.current) {
      return;
    }
    closingRef.current = true;
    Animated.timing(translateY, {
      duration: 190,
      toValue: closedOffset,
      useNativeDriver: true,
    }).start(({ finished }) => {
      closingRef.current = false;
      if (finished) {
        onClose();
      }
    });
  }, [closedOffset, onClose, translateY]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setSheetMode('full');
    translateY.setValue(closedOffset);
    offsetRef.current = closedOffset;
    const frame = requestAnimationFrame(() => {
      animateTo(fullOffset, 'full');
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [animateTo, closedOffset, fullOffset, translateY, visible]);

  useEffect(() => {
    setLiveLocationSharing(isTrackingEnabled);
  }, [isTrackingEnabled]);

  const toggleSnap = useCallback(() => {
    if (closingRef.current) {
      return;
    }
    if (sheetMode === 'half') {
      animateTo(fullOffset, 'full');
      return;
    }
    animateTo(halfOffset, 'half');
  }, [animateTo, fullOffset, halfOffset, sheetMode]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dy) > 6,
        onPanResponderGrant: () => {
          translateY.stopAnimation(value => {
            offsetRef.current = value;
          });
        },
        onPanResponderMove: (_, gestureState) => {
          const nextOffset = Math.max(
            fullOffset,
            Math.min(closedOffset, offsetRef.current + gestureState.dy),
          );
          translateY.setValue(nextOffset);
        },
        onPanResponderRelease: (_, gestureState) => {
          if (closingRef.current) {
            return;
          }
          const projected = offsetRef.current + gestureState.dy + gestureState.vy * 80;
          const fullThreshold = (fullOffset + halfOffset) / 2;
          const closeThreshold = (halfOffset + closedOffset) / 2;

          if (projected <= fullThreshold) {
            animateTo(fullOffset, 'full');
            return;
          }
          if (projected <= closeThreshold) {
            animateTo(halfOffset, 'half');
            return;
          }
          closeWithAnimation();
        },
        onPanResponderTerminate: () => {
          animateTo(fullOffset, 'full');
        },
      }),
    [animateTo, closeWithAnimation, closedOffset, fullOffset, halfOffset, translateY],
  );

  if (!visible) {
    return null;
  }

  const locationPermissionDescription = permissionPermanentlyDenied
    ? 'Izin kapali. Ayarlardan tekrar acabilirsin.'
    : hasLocationPermission
      ? 'Konum izni aktif durumda.'
      : 'Canli takip icin izin vermen gerekli.';

  return (
    <Modal
      animationType="none"
      onRequestClose={closeWithAnimation}
      navigationBarTranslucent={true}
      statusBarTranslucent={true}
      transparent={true}
      visible={visible}
    >
      <StatusBar
        animated={true}
        backgroundColor="transparent"
        barStyle={ACTIVE_MENU_THEME === 'minimal' ? 'dark-content' : 'light-content'}
        hidden={false}
        translucent={true}
      />
      <View 
        style={[StyleSheet.absoluteFill, { height: Dimensions.get('screen').height }]} 
        pointerEvents="box-none" 
        className="justify-end"
      >
      <Animated.View
        style={{
          height: Dimensions.get('screen').height,
          opacity: translateY.interpolate({
            inputRange: [0, closedOffset],
            outputRange: [1, 0],
          })
        }}
        className="absolute inset-0"
      >
        <BlurView
          blurAmount={10}
          blurType={ACTIVE_MENU_THEME === 'minimal' ? 'light' : 'dark'}
          className="absolute inset-0"
        />
        <Pressable
          onPress={closeWithAnimation}
          className={`absolute inset-0 ${THEME_CONFIG.backdropTint}`}
        />
      </Animated.View>

      <Animated.View
        className={`rounded-t-[40px] border-t-[1.5px] border-x-[1.5px] px-[22px] pt-3.5 w-full overflow-hidden ${THEME_CONFIG.sheet}`}
        style={{
          height: sheetMaxHeight,
          marginBottom: tabBarOffset,
          paddingBottom: Math.max(safeBottom + 8, 16),
          transform: [{ translateY }],
        }}
      >
        <BlurView
          blurAmount={20}
          blurType={ACTIVE_MENU_THEME === 'minimal' ? 'light' : 'dark'}
          className="absolute inset-0"
        />
        <View className="absolute top-[-100px] left-[-100px] w-[320px] h-[320px] rounded-[160px] bg-[#ff5a1f]/6" />
        <View className="absolute bottom-[-140px] right-[-140px] w-[360px] h-[360px] rounded-[180px] bg-blue-500/6" />
        <Pressable
          onPress={toggleSnap}
          className="self-center py-1 mb-1"
          {...panResponder.panHandlers}
        >
          <View className="rounded-full h-[5px] w-11 bg-white/20" />
        </Pressable>

        <View className="mb-2.5 flex-row items-center justify-between">
          {activeSection === 'root' ? (
            <View className="w-9 h-9" />
          ) : (
            <Pressable
              onPress={onBackToRoot}
              className={`w-9 h-9 rounded-[18px] border items-center justify-center ${THEME_CONFIG.topBarButton}`}
            >
              <FeatherIcon color={THEME_CONFIG.iconColor} name="chevron-left" size={18} />
            </Pressable>
          )}

          <Text allowFontScaling={false} className={`text-[18px] font-[800] tracking-[-0.5px] ${THEME_CONFIG.topBarTitle}`}>
            {sectionTitle(activeSection)}
          </Text>

          <Pressable
            onPress={closeWithAnimation}
            className={`w-9 h-9 rounded-[18px] border items-center justify-center ${THEME_CONFIG.topBarButton}`}
          >
            <FeatherIcon color="#ff3b30" name="x" size={17} />
          </Pressable>
        </View>

        <ScrollView
          bounces={false}
          contentContainerStyle={SCROLL_CONTENT_STYLE}
          showsVerticalScrollIndicator={false}
        >
          {activeSection === 'root' ? (
            <>
              <SectionHint
                iconColor="#ff5a1f"
                text={`Tema: ${THEME_CONFIG.label}. Harita, yakindakiler ve canli takip akisini buradan yonetebilirsin.`}
              />
              <View
                className={`mb-3 rounded-[18px] border-[1.5px] px-3.5 py-3 ${THEME_CONFIG.quickToggleCard}`}
              >
                <View className="mb-1.5 flex-row items-center justify-between">
                  <Text allowFontScaling={false} className={`text-[12px] font-[700] ${THEME_CONFIG.quickToggleTitle}`}>
                    Realtime Durum
                  </Text>
                  <Text
                    allowFontScaling={false}
                    className={`text-[10px] font-[800] ${socketStatus === 'live' ? 'text-emerald-300' : 'text-amber-300'
                      }`}
                  >
                    {socketStatus === 'live' ? 'CANLI' : 'OFFLINE'}
                  </Text>
                </View>
                <Text allowFontScaling={false} className={`text-[10.5px] leading-[15px] ${THEME_CONFIG.quickToggleSubtitle}`}>
                  Haritadaki uye: {visibleDriversCount} | Yakındakiler: {streetFriendsCount}
                </Text>
              </View>

              <View
                className={`mb-2.5 w-full gap-2 ${stackQuickActions ? 'flex-col' : 'flex-row'}`}
              >
                <Pressable
                  disabled={!canRecenter}
                  onPress={onRecenter}
                  className={`flex-1 ${stackQuickActions ? 'w-full' : ''}`}
                  style={({ pressed }) => [
                    pressed ? { transform: [{ scale: 0.97 }] } : null,
                  ]}
                >
                  {({ pressed }) => (
                    <View
                      className={`h-[52px] flex-row items-center gap-2.5 rounded-[18px] border-[1.5px] px-4 ${THEME_CONFIG.quickButton} ${pressed ? THEME_CONFIG.quickButtonPressed : ''} ${!canRecenter ? 'opacity-40' : ''}`}
                    >
                      <FeatherIcon color={THEME_CONFIG.iconColor} name="navigation" size={16} />
                      <Text allowFontScaling={false} className={`text-[12.5px] font-[600] ${THEME_CONFIG.quickButtonText}`}>
                        Konuma Don
                      </Text>
                    </View>
                  )}
                </Pressable>

                <View
                  className={`flex-1 min-h-[52px] w-full flex-row items-center justify-between rounded-[18px] border-[1.5px] px-3.5 py-2 ${THEME_CONFIG.quickToggleCard} ${stackQuickActions ? 'w-full' : ''}`}
                >
                  <View className="flex-1 mr-2.5">
                    <Text allowFontScaling={false} className={`text-[12.5px] font-[600] ${THEME_CONFIG.quickToggleTitle}`}>
                      Canlı Takip
                    </Text>
                    <Text allowFontScaling={false} className={`text-[10.5px] mt-px ${THEME_CONFIG.quickToggleSubtitle}`}>
                      {isTrackingEnabled ? 'Açık' : 'Kapali'}
                    </Text>
                  </View>
                  <Switch
                    disabled={!hasLocationPermission}
                    ios_backgroundColor="#d1d5db"
                    onValueChange={onTrackingToggle}
                    thumbColor="#ffffff"
                    trackColor={{ false: '#d1d5db', true: '#ff5a1f' }}
                    value={isTrackingEnabled}
                  />
                </View>
              </View>

              <NavRow
                icon="users"
                iconColor="#ff5a1f"
                onPress={() => {
                  closeWithAnimation();
                  setTimeout(() => {
                    onOpenStreetFriends();
                  }, MAP_MENU_SHEET_CLOSE_DURATION + 16);
                }}
                subtitle={streetFriendsSubtitle}
                title="Yakındakiler"
              />
              {streetFriendIncomingRequestCount > 0 ? (
                <NavRow
                  icon="user-plus"
                  iconColor="#f97316"
                  onPress={() => {
                    onOpenSection('street_requests');
                  }}
                  subtitle={`${streetFriendIncomingRequestCount} yeni Yakındakiler istegin var`}
                  title="Yakındakiler İstekleri"
                />
              ) : (
                <NavRow
                  icon="user-plus"
                  iconColor="#94a3b8"
                  onPress={() => {
                    onOpenSection('street_requests');
                  }}
                  subtitle="Yeni Yakındakiler isteğin yok."
                  title="Yakındakiler İstekleri"
                />
              )}
              <NavRow
                icon="eye"
                iconColor={THEME_CONFIG.iconColor}
                onPress={() => {
                  onOpenSection('visibility');
                }}
                subtitle="Kimlerin seni gorecegini belirle"
                title="Görünürlük"
              />
              <NavRow
                icon="map-pin"
                iconColor={THEME_CONFIG.iconColor}
                onPress={() => {
                  onOpenSection('location');
                }}
                subtitle="Konum izni ve takip davranisi"
                title="Konum"
              />
              <NavRow
                icon="sliders"
                iconColor={THEME_CONFIG.iconColor}
                onPress={() => {
                  onOpenSection('map_settings');
                }}
                subtitle="Tema ve katman secenekleri"
                title="Harita Ayarlari"
              />
            </>
          ) : null}

          {activeSection === 'visibility' ? (
            <>
              <SectionHint
                iconColor="#ff5a1f"
                text="Durumumuzu haritada görünür veya gizli yapabiliriz."
              />
              <SegmentControl 
                activeKey={isVisibilityEnabled ? 'visible' : 'hidden'}
                onChange={nextKey => {
                  onVisibilityChange(nextKey === 'visible');
                }}
                options={[
                  {
                    key: 'visible',
                    subtitle: 'Haritada görünür',
                    title: 'Açık',
                  },
                  {
                    key: 'hidden',
                    subtitle: 'Haritada gizlenir',
                    title: 'Gizli',
                  },
                ]}
              />
              {isVisibilitySaving ? (
                <View className="flex-row items-center mt-2">
                  <IosSpinner color="#ff5a1f" size="small" />
                  <Text allowFontScaling={false} className={`text-[12px] ml-2 ${THEME_CONFIG.statusText}`}>
                    Görünürlük kaydediliyor...
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}

          {activeSection === 'location' ? (
            <>
              <SectionHint
                iconColor="#ff5a1f"
                  text="Konum izinleri ve yayin davranisini buradan yonet."
                />
                <View className="flex-row items-center justify-between mb-4">
                  <View className="flex-1 mr-4">
                    <Text allowFontScaling={false} className={`text-[16px] font-[800] ${THEME_CONFIG.rowTitle}`}>
                      Canlı Takip
                    </Text>
                    <Text allowFontScaling={false} className={`text-[12px] mt-0.5 ${THEME_CONFIG.rowSubtitle}`}>
                      {isTrackingEnabled ? 'Aktif' : 'Kapali'}
                    </Text>
                  </View>
                  {isPreferencesSaving ? (
                    <IosSpinner color="#ff5a1f" size="small" />
                  ) : (
                    <Switch
                      onValueChange={onTrackingToggle}
                      value={isTrackingEnabled}
                      trackColor={{ false: '#d1d5db', true: '#ff5a1f' }}
                      thumbColor="#ffffff"
                    />
                  )}
                </View>
                <View className={`h-[1px] w-full mb-6 ${THEME_CONFIG.rowDivider}`} />
                <View className="gap-y-4">
                  <NavRow
                    icon="map-pin"
                    iconColor={THEME_CONFIG.iconColor}
                    onPress={onPermissionAction}
                    subtitle={locationPermissionDescription}
                    title="Konum Izni"
                  />
                </View>
              </>
            ) : null}

          {activeSection === 'map_settings' ? (
            <>
              <SectionHint
                iconColor="#ff5a1f"
                text="Tema, filtre ve katmanlar iOS tarzinda panelde yonetilir."
              />
              <SegmentControl
                activeKey={mapFilterMode}
                onChange={nextKey => {
                  onFilterModeChange(nextKey as MapFilterMode);
                }}
                options={[
                  {
                    key: 'street_friends',
                    subtitle: 'Sadece Yakındakiler',
                    title: 'Yakındakiler',
                  },
                  {
                    key: 'all',
                    subtitle: 'Tum uyeleri göster',
                    title: 'Tüm Uyeler',
                  },
                ]}
              />
              <SegmentControl
                activeKey={mapThemeMode}
                onChange={nextKey => {
                  onThemeChange(nextKey as MapThemeMode);
                }}
                options={[
                  {
                    key: 'dark',
                    subtitle: 'Yüksek kontrast',
                    title: 'Dark',
                  },
                  {
                    key: 'light',
                    subtitle: 'Aydınlik görünümü',
                    title: 'Light',
                  },
                  {
                    key: 'street',
                    subtitle: 'Yakındakiler',
                    title: 'Street',
                  },
                ]}
              />
              <ToggleRow
                description="Kendi marker katmanını aç veya kapat."
                icon="navigation"
                iconColor={THEME_CONFIG.iconColor}
                onToggle={onLocalLayerToggle}
                title="Kendi Konum Katmanı"
                value={localLayerEnabled}
              />
              <ToggleRow
                description="Diğer uye marker katmanını aç veya kapat."
                icon="users"
                iconColor={THEME_CONFIG.iconColor}
                onToggle={onRemoteLayerToggle}
                title="Üye Katmanı"
                value={remoteLayerEnabled}
              />

              <View className={`mt-2 rounded-[20px] border-[1.2px] px-3 py-2 ${THEME_CONFIG.rowShell}`}>
                <Text
                  allowFontScaling={false}
                  className={`mb-1 text-[13.5px] font-[800] tracking-[-0.25px] ${THEME_CONFIG.rowTitle}`}
                >
                  Tracking & Background
                </Text>
                <SettingsItem
                  description="Allows the app to continue working when it is closed. May increase battery usage."
                  onToggle={next => {
                    if (next) {
                      setBackgroundConfirmVisible(true);
                      return;
                    }
                    setRunInBackground(false);
                    stopBackgroundService();
                  }}
                  title="Run in Background"
                  value={runInBackground}
                />
                <View className={`h-px ${THEME_CONFIG.rowDivider}`} />
                <SettingsItem
                  description="Continuously shares your location with others."
                  onToggle={next => {
                    setLiveLocationSharing(next);
                    onTrackingToggle(next);
                  }}
                  title="Live Location Sharing"
                  value={liveLocationSharing}
                />
                <View className={`h-px ${THEME_CONFIG.rowDivider}`} />
                <SettingsItem
                  description="Receive real-time alerts and updates."
                  onToggle={setNotificationsEnabled}
                  title="Notifications"
                  value={notificationsEnabled}
                />
              </View>
            </>
          ) : null}

          {activeSection === 'street_requests' ? (
            <>
              <SectionHint
                iconColor="#f97316"
                text="Seni haritada canli takip etmek isteyenlerin isteklerini buradan yonetebilirsin."
              />
              {isLoadingStreetRequests ? (
                <View className="items-center py-8">
                  <IosSpinner color="#f97316" size="large" />
                </View>
              ) : streetRequests.length === 0 ? (
                <View className="items-center py-10">
                  <View className="w-16 h-16 rounded-full bg-slate-100 items-center justify-center mb-4">
                    <FeatherIcon color="#94a3b8" name="user-check" size={28} />
                  </View>
                  <Text allowFontScaling={false} className="text-slate-500 font-[600] text-[15px]">
                    Henüz bekleyen bir istek yok
                  </Text>
                </View>
              ) : (
                streetRequests.map(request => (
                  <View
                    key={request.id}
                    className={`mb-3 flex-row items-center rounded-[24px] border-[1.2px] px-4 py-3 ${THEME_CONFIG.rowShell}`}
                  >
                    <Image
                      source={{
                        uri: resolveProfileAvatarUrl({
                          authProvider: 'local',
                          avatarUrl: request.avatarUrl,
                        }),
                      }}
                      className="w-11 h-11 rounded-[16px] mr-3.5"
                    />
                    <View className="flex-1 justify-center mr-2">
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        className={`text-[15px] font-[800] tracking-[-0.3px] ${THEME_CONFIG.rowTitle}`}
                      >
                        {request.fullName || request.username}
                      </Text>
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        className={`text-[12px] mt-0.5 ${THEME_CONFIG.rowSubtitle}`}
                      >
                        @{request.username}
                      </Text>
                    </View>
                    <View className="flex-row gap-2">
                      <Pressable
                        disabled={pendingStreetRequestId === request.id}
                        onPress={() => handleRejectRequest(request.id)}
                        className="w-9 h-9 rounded-full bg-slate-100 items-center justify-center border border-slate-200"
                      >
                        <FeatherIcon color="#64748b" name="x" size={18} />
                      </Pressable>
                      <Pressable
                        disabled={pendingStreetRequestId === request.id}
                        onPress={() => handleAcceptRequest(request.id)}
                        className="w-9 h-9 rounded-full bg-orange-500 items-center justify-center shadow-sm"
                      >
                        {pendingStreetRequestId === request.id ? (
                          <IosSpinner color="#ffffff" size="small" />
                        ) : (
                          <FeatherIcon color="#ffffff" name="check" size={18} />
                        )}
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </>
          ) : null}

          {menuError ? (
            <View className={`rounded-[12px] border mt-2 px-2.5 py-[9px] ${THEME_CONFIG.errorCard}`}>
              <Text allowFontScaling={false} className={`text-[12px] leading-[17px] ${THEME_CONFIG.errorText}`}>
                {menuError}
              </Text>
              <Pressable
                onPress={onRetryMenuSync}
                className="mt-2 self-start rounded-[10px] border border-[#dbe4ee] bg-white px-3 py-1.5"
              >
                <Text allowFontScaling={false} className="text-[11px] font-[700] text-slate-700">
                  Tekrar dene
                </Text>
              </Pressable>
            </View>
          ) : null}

          {isPreferencesSaving ? (
            <View className="flex-row items-center mt-2">
              <IosSpinner color="#ff5a1f" size="small" />
              <Text allowFontScaling={false} className={`text-[12px] ml-2 ${THEME_CONFIG.statusText}`}>
                Harita ayarlari kaydediliyor...
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </Animated.View>
      </View>
      <Modal
        animationType="slide"
        onRequestClose={() => {
          setBackgroundConfirmVisible(false);
        }}
        statusBarTranslucent={true}
        transparent={true}
        visible={backgroundConfirmVisible}
      >
        <View className="flex-1 justify-end bg-black/20">
          <View className="rounded-t-[26px] border-t border-[#e2e8f0] bg-white px-5 pb-8 pt-4">
            <View className="mb-2 h-[4px] w-10 self-center rounded-full bg-[#d6deea]" />
            <Text className="text-[16px] font-[800] text-slate-900">
              Enable Background Tracking
            </Text>
            <Text className="mt-2 text-[12.5px] leading-[19px] text-slate-600">
              This feature allows the app to run in the background, track your
              location, and send notifications. It may increase battery usage.
            </Text>
            <View className="mt-5 flex-row">
              <Pressable
                className="mr-2 flex-1 items-center rounded-[14px] border border-[#d7e0eb] bg-[#f8fafc] py-3"
                onPress={() => {
                  setBackgroundConfirmVisible(false);
                }}
              >
                <Text className="text-[13px] font-[700] text-slate-700">Cancel</Text>
              </Pressable>
              <Pressable
                className="ml-2 flex-1 items-center rounded-[14px] bg-[#ff5a1f] py-3"
                onPress={() => {
                  setRunInBackground(true);
                  startBackgroundService();
                  setBackgroundConfirmVisible(false);
                }}
              >
                <Text className="text-[13px] font-[700] text-white">Enable</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}
