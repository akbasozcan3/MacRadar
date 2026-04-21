import React from 'react';
import {
  Pressable,
  StyleSheet,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';

import FeatherIcon from '../FeatherIcon/FeatherIcon';
import AppMedia from '../Media/AppMedia';
import { Text } from '../../theme/typography';

type PostCardMenuMode = 'none' | 'action' | 'indicator';
type PostCardVariant = 'compact' | 'full';

type PostCardProps = {
  commentsText: string;
  likesText: string;
  mediaType: string;
  mediaUrl: string;
  onPress: () => void;
  thumbnailUrl?: string;
  unavailable?: boolean;
  unavailableSubtitle?: string;
  unavailableTitle?: string;
  cardStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
  menuDisabled?: boolean;
  menuMode?: PostCardMenuMode;
  variant?: PostCardVariant;
  enableVideoPreview?: boolean;
  menuPending?: boolean;
  onLongPress?: () => void;
  onMediaError?: () => void;
  onMenuPress?: () => void;
  paused?: boolean;
};

export default function PostCard({
  commentsText,
  likesText,
  mediaType,
  mediaUrl,
  onPress,
  thumbnailUrl,
  unavailable = false,
  unavailableSubtitle = 'ulasilamiyor',
  unavailableTitle = 'Bu gonderiye',
  cardStyle,
  disabled = false,
  menuDisabled = false,
  menuMode = 'none',
  variant = 'full',
  enableVideoPreview = false,
  menuPending = false,
  onLongPress,
  onMediaError,
  onMenuPress,
  paused,
}: PostCardProps) {
  const showActionMenu = menuMode === 'action';
  const showIndicatorMenu = menuMode === 'indicator';
  const normalizedMediaType = mediaType === 'video' ? 'video' : 'photo';
  const isVideo = normalizedMediaType === 'video';

  return (
    <Pressable
      disabled={disabled}
      onLongPress={onLongPress}
      onPress={onPress}
      style={[
        styles.card,
        variant === 'compact' ? styles.cardCompact : null,
        cardStyle,
        unavailable ? styles.unavailableCard : null,
      ]}
    >
      {showActionMenu && !unavailable ? (
        <Pressable
          disabled={menuDisabled}
          hitSlop={8}
          onPress={event => {
            event.stopPropagation?.();
            onMenuPress?.();
          }}
          style={[styles.menuButton, menuDisabled ? styles.menuButtonDisabled : null]}
        >
          {menuPending ? (
            <Text allowFontScaling={false} style={styles.menuPendingText}>
              ...
            </Text>
          ) : (
            <FeatherIcon color="#ffffff" name="more-horizontal" size={15} />
          )}
        </Pressable>
      ) : null}

      {unavailable ? (
        <View style={styles.unavailableBody}>
          <View style={styles.unavailableIconWrap}>
            <FeatherIcon color="#64748b" name="alert-circle" size={18} />
          </View>
          <Text allowFontScaling={false} style={styles.unavailableTitle}>
            {unavailableTitle}
          </Text>
          <Text allowFontScaling={false} style={styles.unavailableSubtitle}>
            {unavailableSubtitle}
          </Text>
        </View>
      ) : (
        <View style={styles.mediaShell}>
          <AppMedia
            enableVideoPreviewInThumbnail={isVideo && enableVideoPreview}
            mediaType={normalizedMediaType}
            mediaUrl={mediaUrl}
            mode="thumbnail"
            paused={isVideo ? paused : undefined}
            previewLoopFromOffset={isVideo}
            previewStartOffsetSec={0.3}
            resizeMode="cover"
            showVideoBadge={isVideo}
            showVideoDurationLabel={isVideo}
            showVideoTypePill={isVideo}
            style={styles.image}
            thumbnailUrl={thumbnailUrl}
            onError={onMediaError}
          />
          <View pointerEvents="none" style={styles.overlay}>
            <View style={styles.stat}>
              <FeatherIcon color="#ffffff" name="heart" size={17} />
              <Text allowFontScaling={false} style={styles.statText}>
                {likesText}
              </Text>
            </View>
            <View style={styles.stat}>
              <FeatherIcon color="#ffffff" name="message-circle" size={17} />
              <Text allowFontScaling={false} style={styles.statText}>
                {commentsText}
              </Text>
            </View>
          </View>
          {showIndicatorMenu ? (
            <View pointerEvents="none" style={styles.menuButton}>
              <FeatherIcon color="#ffffff" name="more-horizontal" size={15} />
            </View>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'center',
    backgroundColor: '#e7ebf2',
    borderColor: '#e5e9f0',
    borderRadius: 26,
    borderWidth: 1,
    elevation: 4,
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    width: '94%',
  },
  cardCompact: {
    alignSelf: 'auto',
    borderRadius: 12,
    marginBottom: 8,
    shadowOpacity: 0.03,
    shadowRadius: 6,
    width: '31.3%',
  },
  image: {
    height: '100%',
    width: '100%',
  },
  mediaShell: {
    aspectRatio: 1,
    backgroundColor: '#0f172a',
    position: 'relative',
    width: '100%',
  },
  menuButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.76)',
    borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: 16,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    position: 'absolute',
    right: 12,
    top: 12,
    width: 34,
    zIndex: 6,
  },
  menuButtonDisabled: {
    opacity: 0.72,
  },
  menuPendingText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginTop: -1,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    bottom: 0,
    flexDirection: 'row',
    left: 0,
    paddingBottom: 12,
    paddingHorizontal: 14,
    paddingTop: 28,
    position: 'absolute',
    right: 0,
  },
  stat: {
    alignItems: 'center',
    flexDirection: 'row',
    marginRight: 18,
  },
  statText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 7,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  unavailableBody: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 168,
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  unavailableCard: {
    backgroundColor: '#f4f6fb',
    borderColor: '#d9e0ec',
    borderStyle: 'dashed',
  },
  unavailableIconWrap: {
    alignItems: 'center',
    backgroundColor: '#e9eef7',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    marginBottom: 10,
    width: 40,
  },
  unavailableSubtitle: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  unavailableTitle: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 1,
  },
});
