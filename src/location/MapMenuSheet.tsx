import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  useWindowDimensions,
  View,
} from 'react-native';
import { BlurView } from '@react-native-community/blur';

import FeatherIcon from '../components/FeatherIcon/FeatherIcon';
import IosSpinner from '../components/IosSpinner/IosSpinner';
import { Text } from '../theme/typography';

export type MapMenuSection =
  | 'root'
  | 'visibility'
  | 'filters'
  | 'location'
  | 'map_settings';

export type MapFilterMode = 'street_friends' | 'all';
export type MapThemeMode = 'dark' | 'light' | 'street';
type MenuVisualTheme = 'minimal' | 'premium';

type MapMenuModalProps = {
  activeSection: MapMenuSection;
  canRecenter: boolean;
  hasLocationPermission: boolean;
  isTrackingEnabled: boolean;
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
  onFilterChange: (next: MapFilterMode) => void;
  onLocalLayerToggle: (next: boolean) => void;
  onOpenSection: (next: Exclude<MapMenuSection, 'root'>) => void;
  onPermissionAction: () => void;
  onRecenter: () => void;
  onRemoteLayerToggle: (next: boolean) => void;
  onThemeChange: (next: MapThemeMode) => void;
  onTrackingToggle: (next: boolean) => void;
  onVisibilityChange: (next: boolean) => void;
};

type ThemePalette = {
  backdropTint: string;
  errorBackground: string;
  errorBorder: string;
  errorText: string;
  grabber: string;
  hintBackground: string;
  hintBorder: string;
  hintIconBackground: string;
  hintText: string;
  quickButtonBackground: string;
  quickButtonBorder: string;
  quickButtonPressed: string;
  quickButtonText: string;
  quickToggleBackground: string;
  quickToggleBorder: string;
  quickToggleSubtitle: string;
  quickToggleTitle: string;
  rowBackground: string;
  rowBorder: string;
  rowIconBackground: string;
  rowIconBorder: string;
  rowPressedBackground: string;
  rowSubtitle: string;
  rowTitle: string;
  segmentActiveBackground: string;
  segmentActiveBorder: string;
  segmentActiveSubtitle: string;
  segmentActiveTitle: string;
  segmentBackground: string;
  segmentBorder: string;
  segmentSubtitle: string;
  segmentTitle: string;
  sheetBackground: string;
  sheetBorder: string;
  statusText: string;
  topBarButtonBackground: string;
  topBarButtonBorder: string;
  topBarTitle: string;
};

function createThemeStyles(palette: ThemePalette) {
  return StyleSheet.create({
    backdropTint: {
      backgroundColor: palette.backdropTint,
    },
    errorCard: {
      backgroundColor: palette.errorBackground,
      borderColor: palette.errorBorder,
    },
    errorText: {
      color: palette.errorText,
    },
    grabber: {
      backgroundColor: palette.grabber,
    },
    hintCard: {
      backgroundColor: palette.hintBackground,
      borderColor: palette.hintBorder,
    },
    hintIconWrap: {
      backgroundColor: palette.hintIconBackground,
    },
    hintText: {
      color: palette.hintText,
    },
    quickButton: {
      backgroundColor: palette.quickButtonBackground,
      borderColor: palette.quickButtonBorder,
    },
    quickButtonPressed: {
      backgroundColor: palette.quickButtonPressed,
    },
    quickButtonText: {
      color: palette.quickButtonText,
    },
    quickToggleCard: {
      backgroundColor: palette.quickToggleBackground,
      borderColor: palette.quickToggleBorder,
    },
    quickToggleSubtitle: {
      color: palette.quickToggleSubtitle,
    },
    quickToggleTitle: {
      color: palette.quickToggleTitle,
    },
    rowIconWrap: {
      backgroundColor: palette.rowIconBackground,
      borderColor: palette.rowIconBorder,
    },
    rowShell: {
      backgroundColor: palette.rowBackground,
      borderColor: palette.rowBorder,
    },
    rowShellPressed: {
      backgroundColor: palette.rowPressedBackground,
    },
    rowSubtitle: {
      color: palette.rowSubtitle,
    },
    rowTitle: {
      color: palette.rowTitle,
    },
    segmentItem: {
      backgroundColor: palette.segmentBackground,
      borderColor: palette.segmentBorder,
    },
    segmentItemActive: {
      backgroundColor: palette.segmentActiveBackground,
      borderColor: palette.segmentActiveBorder,
    },
    segmentSubtitle: {
      color: palette.segmentSubtitle,
    },
    segmentSubtitleActive: {
      color: palette.segmentActiveSubtitle,
    },
    segmentTitle: {
      color: palette.segmentTitle,
    },
    segmentTitleActive: {
      color: palette.segmentActiveTitle,
    },
    sheetContainer: {
      backgroundColor: palette.sheetBackground,
      borderColor: palette.sheetBorder,
    },
    statusText: {
      color: palette.statusText,
    },
    topBarButton: {
      backgroundColor: palette.topBarButtonBackground,
      borderColor: palette.topBarButtonBorder,
    },
    topBarTitle: {
      color: palette.topBarTitle,
    },
  });
}

type MenuThemeStyles = ReturnType<typeof createThemeStyles>;

type MenuThemeMeta = {
  iconColor: string;
  label: string;
  styles: MenuThemeStyles;
};

const MINIMAL_THEME_STYLES = createThemeStyles({
  backdropTint: 'rgba(15, 23, 42, 0.22)',
  errorBackground: '#fff7ed',
  errorBorder: '#fed7aa',
  errorText: '#9a3412',
  grabber: '#d2d9e4',
  hintBackground: '#f6f8fb',
  hintBorder: '#e2e8f0',
  hintIconBackground: '#ffe8dc',
  hintText: '#5b6577',
  quickButtonBackground: '#ffffff',
  quickButtonBorder: '#dfe6f0',
  quickButtonPressed: '#f3f6fa',
  quickButtonText: '#1f2937',
  quickToggleBackground: '#ffffff',
  quickToggleBorder: '#dfe6f0',
  quickToggleSubtitle: '#7b8698',
  quickToggleTitle: '#1f2937',
  rowBackground: '#ffffff',
  rowBorder: '#e0e7f1',
  rowIconBackground: '#f3f6fb',
  rowIconBorder: '#e2e8f2',
  rowPressedBackground: '#f4f7fb',
  rowSubtitle: '#6f7b8f',
  rowTitle: '#1f2937',
  segmentActiveBackground: '#1f2937',
  segmentActiveBorder: '#1f2937',
  segmentActiveSubtitle: '#d3dbe8',
  segmentActiveTitle: '#ffffff',
  segmentBackground: '#ffffff',
  segmentBorder: '#e1e8f2',
  segmentSubtitle: '#7a8598',
  segmentTitle: '#1f2937',
  sheetBackground: '#f7f9fc',
  sheetBorder: '#d8dfeb',
  statusText: '#5f6b7f',
  topBarButtonBackground: '#ffffff',
  topBarButtonBorder: '#dbe2ec',
  topBarTitle: '#111827',
});

const PREMIUM_THEME_STYLES = createThemeStyles({
  backdropTint: 'rgba(2, 6, 23, 0.4)',
  errorBackground: '#3f2b2f',
  errorBorder: '#7f1d1d',
  errorText: '#fecaca',
  grabber: '#8da1c0',
  hintBackground: '#1e2838',
  hintBorder: '#2f3a4f',
  hintIconBackground: '#4f2d24',
  hintText: '#d2ddee',
  quickButtonBackground: '#1f2b3d',
  quickButtonBorder: '#33435f',
  quickButtonPressed: '#24344a',
  quickButtonText: '#f8fafc',
  quickToggleBackground: '#1f2b3d',
  quickToggleBorder: '#33435f',
  quickToggleSubtitle: '#94a3b8',
  quickToggleTitle: '#f8fafc',
  rowBackground: '#1a2536',
  rowBorder: '#32455f',
  rowIconBackground: '#223149',
  rowIconBorder: '#394f6c',
  rowPressedBackground: '#223149',
  rowSubtitle: '#9fb2cb',
  rowTitle: '#f8fafc',
  segmentActiveBackground: '#ff5a1f',
  segmentActiveBorder: '#ff5a1f',
  segmentActiveSubtitle: '#ffe1d5',
  segmentActiveTitle: '#ffffff',
  segmentBackground: '#1a2536',
  segmentBorder: '#32455f',
  segmentSubtitle: '#94a3b8',
  segmentTitle: '#f8fafc',
  sheetBackground: '#111a29',
  sheetBorder: '#2f3f59',
  statusText: '#b8c7da',
  topBarButtonBackground: '#1f2b3d',
  topBarButtonBorder: '#344761',
  topBarTitle: '#f8fafc',
});

const ACTIVE_MENU_THEME: MenuVisualTheme = 'premium';

const MENU_THEME_META: Record<MenuVisualTheme, MenuThemeMeta> = {
  minimal: {
    iconColor: '#1f2937',
    label: 'Minimal',
    styles: MINIMAL_THEME_STYLES,
  },
  premium: {
    iconColor: '#f8fafc',
    label: 'Premium',
    styles: PREMIUM_THEME_STYLES,
  },
};

type NavRowProps = {
  icon: string;
  iconColor: string;
  onPress: () => void;
  subtitle: string;
  theme: MenuThemeStyles;
  title: string;
};

type ToggleRowProps = {
  description: string;
  disabled?: boolean;
  icon: string;
  iconColor: string;
  onToggle: (next: boolean) => void;
  theme: MenuThemeStyles;
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
  iconColor: string;
  options: SegmentOption[];
  onChange: (nextKey: string) => void;
  theme: MenuThemeStyles;
};

function sectionTitle(section: MapMenuSection) {
  switch (section) {
    case 'visibility':
      return 'Gorunurluk';
    case 'filters':
      return 'Filtreler';
    case 'location':
      return 'Konum';
    case 'map_settings':
      return 'Harita Ayarlari';
    default:
      return 'Map Menu';
  }
}

function NavRow({
  icon,
  iconColor,
  onPress,
  subtitle,
  theme,
  title,
}: NavRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.rowShell,
        theme.rowShell,
        pressed ? theme.rowShellPressed : null,
      ]}
    >
      <View style={[styles.rowIconWrap, theme.rowIconWrap]}>
        <FeatherIcon color={iconColor} name={icon} size={16} />
      </View>
      <View style={styles.rowTextWrap}>
        <Text allowFontScaling={false} style={[styles.rowTitle, theme.rowTitle]}>
          {title}
        </Text>
        <Text allowFontScaling={false} style={[styles.rowSubtitle, theme.rowSubtitle]}>
          {subtitle}
        </Text>
      </View>
      <FeatherIcon color={iconColor} name="chevron-right" size={18} />
    </Pressable>
  );
}

function ToggleRow({
  description,
  disabled = false,
  icon,
  iconColor,
  onToggle,
  theme,
  title,
  value,
}: ToggleRowProps) {
  return (
    <View style={[styles.rowShell, theme.rowShell, disabled ? styles.rowDisabled : null]}>
      <View style={[styles.rowIconWrap, theme.rowIconWrap]}>
        <FeatherIcon color={iconColor} name={icon} size={16} />
      </View>
      <View style={styles.rowTextWrap}>
        <Text allowFontScaling={false} style={[styles.rowTitle, theme.rowTitle]}>
          {title}
        </Text>
        <Text allowFontScaling={false} style={[styles.rowSubtitle, theme.rowSubtitle]}>
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
  iconColor: _iconColor,
  onChange,
  options,
  theme,
}: SegmentControlProps) {
  return (
    <View style={styles.segmentWrap}>
      {options.map(option => {
        const isActive = option.key === activeKey;
        return (
          <Pressable
            key={option.key}
            onPress={() => {
              onChange(option.key);
            }}
            style={({ pressed }) => [
              styles.segmentItem,
              theme.segmentItem,
              isActive ? theme.segmentItemActive : null,
              pressed ? styles.segmentItemPressed : null,
            ]}
          >
            <Text
              allowFontScaling={false}
              style={[
                styles.segmentTitle,
                theme.segmentTitle,
                isActive ? theme.segmentTitleActive : null,
              ]}
            >
              {option.title}
            </Text>
            <Text
              allowFontScaling={false}
              style={[
                styles.segmentSubtitle,
                theme.segmentSubtitle,
                isActive ? theme.segmentSubtitleActive : null,
              ]}
            >
              {option.subtitle}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SectionHint({
  iconColor,
  text,
  theme,
}: {
  iconColor: string;
  text: string;
  theme: MenuThemeStyles;
}) {
  return (
    <View style={[styles.hintCard, theme.hintCard]}>
      <View style={[styles.hintIconWrap, theme.hintIconWrap]}>
        <FeatherIcon color={iconColor} name="info" size={10} />
      </View>
      <Text allowFontScaling={false} style={[styles.hintText, theme.hintText]}>
        {text}
      </Text>
    </View>
  );
}

export default function MapMenuModal({
  activeSection,
  canRecenter,
  hasLocationPermission,
  isTrackingEnabled,
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
  onFilterChange,
  onLocalLayerToggle,
  onOpenSection,
  onPermissionAction,
  onRecenter,
  onRemoteLayerToggle,
  onThemeChange,
  onTrackingToggle,
  onVisibilityChange,
}: MapMenuModalProps) {
  const [mounted, setMounted] = useState(visible);
  const animation = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const { height, width } = useWindowDimensions();
  const themeMeta = MENU_THEME_META[ACTIVE_MENU_THEME];
  const theme = themeMeta.styles;
  const stackQuickActions = width < 520;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.spring(animation, {
        damping: 24,
        mass: 0.9,
        stiffness: 230,
        toValue: 1,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(animation, {
      duration: 170,
      toValue: 0,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setMounted(false);
      }
    });
  }, [animation, visible]);

  const translateY = useMemo(
    () =>
      animation.interpolate({
        inputRange: [0, 1],
        outputRange: [320, 0],
      }),
    [animation],
  );

  const backdropOpacity = useMemo(
    () =>
      animation.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
      }),
    [animation],
  );

  const sheetMaxHeight = useMemo(() => {
    const usableHeight = height - Math.max(safeBottom + 16, 24);
    const preferredHeight = Math.max(530, Math.round(height * 0.8));
    return Math.min(usableHeight, preferredHeight);
  }, [height, safeBottom]);

  const backdropAnimatedStyle = useMemo(
    () => ({
      opacity: backdropOpacity,
    }),
    [backdropOpacity],
  );

  const sheetAnimatedStyle = useMemo(
    () => ({
      maxHeight: sheetMaxHeight,
      paddingBottom: Math.max(safeBottom + 8, 16),
      transform: [{ translateY }],
    }),
    [safeBottom, sheetMaxHeight, translateY],
  );

  if (!mounted) {
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
      onRequestClose={onClose}
      statusBarTranslucent={false}
      transparent={true}
      visible={true}
    >
      <StatusBar
        animated={true}
        backgroundColor="#ffffff"
        barStyle="dark-content"
        hidden={false}
        translucent={false}
      />
      <View style={styles.modalRoot}>
        <Animated.View
          pointerEvents="none"
          style={[styles.absoluteFill, backdropAnimatedStyle]}
        >
          <BlurView
            blurAmount={16}
            blurType="light"
            reducedTransparencyFallbackColor="rgba(255,255,255,0.9)"
            style={styles.absoluteFill}
          />
          <View style={[styles.absoluteFill, theme.backdropTint]} />
        </Animated.View>

        <Pressable onPress={onClose} style={styles.absoluteFill} />

        <Animated.View style={[styles.sheetContainer, theme.sheetContainer, sheetAnimatedStyle]}>
          <View style={[styles.grabber, theme.grabber]} />

          <View style={styles.topBar}>
            {activeSection === 'root' ? (
              <View style={styles.topBarGhost} />
            ) : (
              <Pressable onPress={onBackToRoot} style={[styles.topBarButton, theme.topBarButton]}>
                <FeatherIcon color={themeMeta.iconColor} name="chevron-left" size={18} />
              </Pressable>
            )}

            <Text allowFontScaling={false} style={[styles.topBarTitle, theme.topBarTitle]}>
              {sectionTitle(activeSection)}
            </Text>

            <Pressable onPress={onClose} style={[styles.topBarButton, theme.topBarButton]}>
              <FeatherIcon color={themeMeta.iconColor} name="x" size={17} />
            </Pressable>
          </View>

          <ScrollView
            bounces={false}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {activeSection === 'root' ? (
              <>
                <SectionHint
                  iconColor="#ff5a1f"
                  text={`Tema: ${themeMeta.label}. Harita panelini buradan hizli sekilde yonetebilirsin.`}
                  theme={theme}
                />

                <View
                  style={[
                    styles.quickWrap,
                    stackQuickActions ? styles.quickWrapStacked : null,
                  ]}
                >
                  <Pressable
                    disabled={!canRecenter}
                    onPress={onRecenter}
                    style={({ pressed }) => [
                      styles.quickButton,
                      styles.quickItem,
                      theme.quickButton,
                      stackQuickActions ? styles.quickItemStacked : null,
                      !canRecenter ? styles.quickButtonDisabled : null,
                      pressed ? theme.quickButtonPressed : null,
                    ]}
                  >
                    <FeatherIcon color={themeMeta.iconColor} name="navigation" size={16} />
                    <Text allowFontScaling={false} style={[styles.quickButtonText, theme.quickButtonText]}>
                      Konuma Don
                    </Text>
                  </Pressable>

                  <View
                    style={[
                      styles.quickToggleCard,
                      styles.quickItem,
                      theme.quickToggleCard,
                      stackQuickActions ? styles.quickItemStacked : null,
                    ]}
                  >
                    <View style={styles.quickToggleTextWrap}>
                      <Text allowFontScaling={false} style={[styles.quickToggleTitle, theme.quickToggleTitle]}>
                        Canlı Takip
                      </Text>
                      <Text
                        allowFontScaling={false}
                        style={[styles.quickToggleSubtitle, theme.quickToggleSubtitle]}
                      >
                        {isTrackingEnabled ? 'Acik' : 'Kapali'}
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
                  icon="eye"
                  iconColor={themeMeta.iconColor}
                  onPress={() => {
                    onOpenSection('visibility');
                  }}
                  subtitle="Kimlerin seni gorecegini belirle"
                  theme={theme}
                  title="Gorunurluk"
                />
                <NavRow
                  icon="filter"
                  iconColor={themeMeta.iconColor}
                  onPress={() => {
                    onOpenSection('filters');
                  }}
                  subtitle="Uye listesini daralt veya genislet"
                  theme={theme}
                  title="Filtreler"
                />
                <NavRow
                  icon="map-pin"
                  iconColor={themeMeta.iconColor}
                  onPress={() => {
                    onOpenSection('location');
                  }}
                  subtitle="Konum izni ve takip davranisi"
                  theme={theme}
                  title="Konum"
                />
                <NavRow
                  icon="sliders"
                  iconColor={themeMeta.iconColor}
                  onPress={() => {
                    onOpenSection('map_settings');
                  }}
                  subtitle="Tema ve katman secenekleri"
                  theme={theme}
                  title="Harita Ayarlari"
                />
              </>
            ) : null}

            {activeSection === 'visibility' ? (
              <>
                <SectionHint
                  iconColor="#ff5a1f"
                  text="Durumumuzu haritada görünür veya gizli yapabiliriz."
                  theme={theme}
                />
                <SegmentControl
                  activeKey={isVisibilityEnabled ? 'visible' : 'hidden'}
                  iconColor={themeMeta.iconColor}
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
                  theme={theme}
                />
                {isVisibilitySaving ? (
                  <View style={styles.statusRow}>
                    <IosSpinner color="#ff5a1f" size="small" />
                    <Text allowFontScaling={false} style={[styles.statusText, theme.statusText]}>
                      Gorunurluk kaydediliyor...
                    </Text>
                  </View>
                ) : null}
              </>
            ) : null}

            {activeSection === 'filters' ? (
              <>
                <SectionHint
                  iconColor="#ff5a1f"
                  text="Map performansi ve takip odagini bu ayar belirler."
                  theme={theme}
                />
                <SegmentControl
                  activeKey={mapFilterMode}
                  iconColor={themeMeta.iconColor}
                  onChange={nextKey => {
                    onFilterChange(nextKey as MapFilterMode);
                  }}
                  options={[
                    {
                      key: 'street_friends',
                      subtitle: 'Sadece bagli oldugun uyeler',
                      title: 'Cadde',
                    },
                    {
                      key: 'all',
                      subtitle: 'Odadaki tum aktif uyeler',
                      title: 'Tum Uyeler',
                    },
                  ]}
                  theme={theme}
                />
              </>
            ) : null}

            {activeSection === 'location' ? (
              <>
                <SectionHint
                  iconColor="#ff5a1f"
                  text="Konum izinleri ve yayin davranisini buradan yonet."
                  theme={theme}
                />
                <NavRow
                  icon="map-pin"
                  iconColor={themeMeta.iconColor}
                  onPress={onPermissionAction}
                  subtitle={locationPermissionDescription}
                  theme={theme}
                  title="Konum Izni"
                />
                <ToggleRow
                  description="Açık oldugunda konum uygulamada canli guncellenir."
                  disabled={!hasLocationPermission}
                  icon={isTrackingEnabled ? 'activity' : 'slash'}
                  iconColor={themeMeta.iconColor}
                  onToggle={onTrackingToggle}
                  theme={theme}
                  title="Canlı Takip"
                  value={isTrackingEnabled}
                />
              </>
            ) : null}

            {activeSection === 'map_settings' ? (
              <>
                <SectionHint
                  iconColor="#ff5a1f"
                  text="Tema secimi ve katmanlar iOS tarzinda panelde yonetilir."
                  theme={theme}
                />
                <SegmentControl
                  activeKey={mapThemeMode}
                  iconColor={themeMeta.iconColor}
                  onChange={nextKey => {
                    onThemeChange(nextKey as MapThemeMode);
                  }}
                  options={[
                    {
                      key: 'dark',
                      subtitle: 'Yuksek kontrast',
                      title: 'Dark',
                    },
                    {
                      key: 'light',
                      subtitle: 'Aydinlik gorunum',
                      title: 'Light',
                    },
                    {
                      key: 'street',
                      subtitle: 'Cadde detaylari',
                      title: 'Street',
                    },
                  ]}
                  theme={theme}
                />
                <ToggleRow
                  description="Kendi marker katmanini ac veya kapat."
                  icon="navigation"
                  iconColor={themeMeta.iconColor}
                  onToggle={onLocalLayerToggle}
                  theme={theme}
                  title="Kendi Konum Katmani"
                  value={localLayerEnabled}
                />
                <ToggleRow
                  description="Diger uye marker katmanini ac veya kapat."
                  icon="users"
                  iconColor={themeMeta.iconColor}
                  onToggle={onRemoteLayerToggle}
                  theme={theme}
                  title="Uye Katmani"
                  value={remoteLayerEnabled}
                />
              </>
            ) : null}

            {menuError ? (
              <View style={[styles.errorCard, theme.errorCard]}>
                <Text allowFontScaling={false} style={[styles.errorText, theme.errorText]}>
                  {menuError}
                </Text>
              </View>
            ) : null}

            {isPreferencesSaving ? (
              <View style={styles.statusRow}>
                <IosSpinner color="#ff5a1f" size="small" />
                <Text allowFontScaling={false} style={[styles.statusText, theme.statusText]}>
                  Harita ayarlari kaydediliyor...
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  absoluteFill: {
    ...StyleSheet.absoluteFillObject,
  },
  errorCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 17,
  },
  grabber: {
    alignSelf: 'center',
    borderRadius: 999,
    height: 5,
    marginBottom: 10,
    width: 44,
  },
  hintCard: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  hintIconWrap: {
    alignItems: 'center',
    borderRadius: 8,
    height: 16,
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 1,
    width: 16,
  },
  hintText: {
    flex: 1,
    fontSize: 11.5,
    lineHeight: 16,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  quickButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    height: 46,
    justifyContent: 'flex-start',
    paddingHorizontal: 12,
  },
  quickButtonDisabled: {
    backgroundColor: '#182336',
    borderColor: '#2b3a52',
  },
  quickButtonText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  quickToggleCard: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  quickToggleSubtitle: {
    fontSize: 10.5,
    marginTop: 1,
  },
  quickToggleTextWrap: {
    flex: 1,
    marginRight: 10,
  },
  quickToggleTitle: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  quickItem: {
    flexBasis: 0,
    minWidth: 0,
  },
  quickItemStacked: {
    alignSelf: 'stretch',
    flex: 0,
    width: '100%',
  },
  quickWrap: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
    width: '100%',
  },
  quickWrapStacked: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  rowDisabled: {
    opacity: 0.55,
  },
  rowIconWrap: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    marginRight: 10,
    width: 34,
  },
  rowShell: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 8,
    minHeight: 58,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rowSubtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  rowTextWrap: {
    flex: 1,
    marginRight: 8,
  },
  rowTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  scrollContent: {
    paddingBottom: 6,
  },
  segmentItem: {
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    minHeight: 66,
    paddingHorizontal: 8,
    paddingVertical: 9,
  },
  segmentItemPressed: {
    opacity: 0.88,
  },
  segmentSubtitle: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  segmentTitle: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  segmentWrap: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  sheetContainer: {
    alignSelf: 'center',
    borderRadius: 30,
    borderWidth: 1,
    marginHorizontal: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    width: '95%',
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 8,
  },
  statusText: {
    fontSize: 12,
    marginLeft: 8,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  topBarButton: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  topBarGhost: {
    height: 36,
    width: 36,
  },
  topBarTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
});
