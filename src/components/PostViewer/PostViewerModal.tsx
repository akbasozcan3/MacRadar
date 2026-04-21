import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import FeatherIcon from '../FeatherIcon/FeatherIcon';
import IosSpinner from '../IosSpinner/IosSpinner';
import AppMedia from '../Media/AppMedia';
import { Text } from '../../theme/typography';
import {
  fetchExploreComments,
  sendExploreComment,
  sendExploreCommentLike,
} from '../../services/exploreService';
import {
  resolveMediaThumbnailUrl,
  resolveProtectedMediaUrl,
} from '../../services/protectedMedia';
import type { ExploreComment } from '../../types/ExploreTypes/ExploreTypes';

const { width: WINDOW_WIDTH, height: WINDOW_HEIGHT } = Dimensions.get('window');
/** Keep media full-bleed; bottom card overlays on top. */
const POST_VIEWER_MEDIA_HEIGHT_FRACTION = 1;
const MEDIA_VIEW_HEIGHT = WINDOW_HEIGHT * POST_VIEWER_MEDIA_HEIGHT_FRACTION;
const DOUBLE_TAP_MAX_DELAY_MS = 260;
const DOUBLE_TAP_HEART_MAX_SIZE = 70;
const REPORT_MODAL_SCROLL_CONTENT_STYLE = {
  paddingBottom: 12,
} as const;
const REPORT_MODAL_SCROLL_INSET_STYLE = {
  paddingHorizontal: 20,
  paddingTop: 12,
} as const;
const REPORT_MODAL_SHEET_BASE_STYLE = {
  height: '96%',
} as const;
const COMMENTS_BACKDROP_STYLE = {
  backgroundColor: 'rgba(2, 6, 23, 0.2)',
} as const;
const COMMENTS_KEYBOARD_AVOIDING_STYLE = {
  flex: 1,
  justifyContent: 'flex-end',
} as const;
const COMMENTS_LIST_CONTENT_STYLE = {
  paddingBottom: 18,
} as const;
const FALLBACK_AVATAR = 'https://placehold.co/96x96/e2e8f0/64748b?text=%40';

export type PostViewerItem = {
  authorAvatarUrl?: string;
  authorId?: string;
  authorUsername?: string;
  caption: string;
  createdAt: string;
  id: string;
  location: string;
  mediaType: string;
  mediaUrl: string;
  thumbnailUrl?: string;
  stats?: {
    bookmarksCount?: number;
    commentsCount?: number;
    likesCount?: number;
    sharesCount?: number;
  };
  viewerState?: {
    isBookmarked?: boolean;
    isLiked?: boolean;
  };
};

type PostViewerDirection = 'horizontal' | 'vertical';
export type PostViewerReactionKind = 'bookmark' | 'like' | 'share';
export type PostViewerReportReason =
  | 'spam'
  | 'harassment_or_bullying'
  | 'inappropriate_content'
  | 'violence'
  | 'hate_speech'
  | 'other';

const POST_REPORT_REASON_OPTIONS: {
  icon: string;
  key: PostViewerReportReason;
  label: string;
}[] = [
  { icon: 'alert-octagon', key: 'spam', label: 'Spam' },
  {
    icon: 'alert-triangle',
    key: 'harassment_or_bullying',
    label: 'Taciz veya Zorbalik',
  },
  { icon: 'eye-off', key: 'inappropriate_content', label: 'Uygunsuz İçerik' },
  { icon: 'slash', key: 'violence', label: 'Şiddet' },
  { icon: 'x-circle', key: 'hate_speech', label: 'Nefret Söylemi' },
  { icon: 'more-horizontal', key: 'other', label: 'Diğer' },
];

type PostViewerModalProps = {
  direction?: PostViewerDirection;
  initialIndex: number;
  immersiveBottomVariant?: 'classic' | 'engagement-bar';
  onClose: () => void;
  onOpenAuthor?: (post: PostViewerItem) => void;
  onReport?: (post: PostViewerItem, reason: PostViewerReportReason) => void;
  onReact?: (post: PostViewerItem, kind: PostViewerReactionKind) => void;
  pendingReportPostId?: string | null;
  pendingReactionKeys?: Record<string, boolean | undefined>;
  posts: PostViewerItem[];
  safeBottom?: number;
  safeTop?: number;
  showImmersiveHeaderMeta?: boolean;
  title?: string;
  viewerAvatarUrl?: string;
  visible: boolean;
};

function formatCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace('.0', '')}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace('.0', '')}K`;
  }
  return String(value);
}

function formatCaption(value: string) {
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return 'Bu gonderi icin aciklama eklenmemis.';
}

function formatLocation(value: string) {
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return 'Konum belirtilmedi';
}

function formatRelativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return '';
  }
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minuteMs = 60_000;
  const hourMs = 3_600_000;
  const dayMs = 86_400_000;
  if (diffMs < hourMs) {
    return `${Math.max(1, Math.floor(diffMs / minuteMs))} dk`;
  }
  if (diffMs < dayMs) {
    return `${Math.max(1, Math.floor(diffMs / hourMs))} sa`;
  }
  return `${Math.max(1, Math.floor(diffMs / dayMs))} g`;
}

function safeAuthorUsernameValue(value: string | undefined) {
  const normalized = String(value ?? '').trim().replace(/^@+/, '');
  return normalized.length > 0 ? `@${normalized}` : '@kullanici';
}

export default function PostViewerModal({
  direction = 'horizontal',
  initialIndex,
  immersiveBottomVariant = 'classic',
  onClose,
  onOpenAuthor,
  onReport,
  onReact,
  pendingReportPostId = null,
  pendingReactionKeys,
  posts,
  safeBottom = 0,
  safeTop = 0,
  showImmersiveHeaderMeta = true,
  viewerAvatarUrl = '',
  visible,
}: PostViewerModalProps) {
  const listRef = useRef<FlatList<PostViewerItem>>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const isVertical = direction === 'vertical';
  const pageSize = isVertical
    ? WINDOW_HEIGHT
    : WINDOW_WIDTH;
  const normalizedIndex = useMemo(() => {
    if (posts.length === 0) {
      return 0;
    }
    if (initialIndex < 0) {
      return 0;
    }
    if (initialIndex >= posts.length) {
      return posts.length - 1;
    }
    return initialIndex;
  }, [initialIndex, posts.length]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setCurrentIndex(normalizedIndex);
    const timeout = setTimeout(() => {
      listRef.current?.scrollToOffset({
        animated: false,
        offset: normalizedIndex * pageSize,
      });
    }, 0);
    return () => clearTimeout(timeout);
  }, [normalizedIndex, pageSize, visible]);

  function handleMomentumScrollEnd(
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) {
    const offset = isVertical
      ? event.nativeEvent.contentOffset.y
      : event.nativeEvent.contentOffset.x;
    const nextIndex = Math.round(offset / pageSize);
    if (!Number.isFinite(nextIndex) || nextIndex < 0) {
      return;
    }
    setCurrentIndex(Math.min(nextIndex, Math.max(posts.length - 1, 0)));
  }

  const topInset = Math.max(safeTop, 12);
  const bottomInset = Math.max(safeBottom, 18) + 14;
  const currentPost = posts[currentIndex];
  const currentPostLiked = Boolean(currentPost?.viewerState?.isLiked);
  const currentPostBookmarked = Boolean(
    currentPost?.viewerState?.isBookmarked,
  );
  const resolvedAuthorAvatarUri = (() => {
    const raw = currentPost?.authorAvatarUrl?.trim() ?? '';
    if (!raw.length) {
      return '';
    }
    return resolveProtectedMediaUrl(raw);
  })();
  const likeReactionKey = currentPost ? `${currentPost.id}:like` : '';
  const bookmarkReactionKey = currentPost ? `${currentPost.id}:bookmark` : '';
  const shareReactionKey = currentPost ? `${currentPost.id}:share` : '';
  const isLikePending = Boolean(pendingReactionKeys?.[likeReactionKey]);
  const isBookmarkPending = Boolean(pendingReactionKeys?.[bookmarkReactionKey]);
  const isSharePending = Boolean(pendingReactionKeys?.[shareReactionKey]);
  const counterText =
    posts.length > 0 ? `${currentIndex + 1} / ${posts.length}` : '0 / 0';
  const canOpenCurrentAuthor =
    Boolean(onOpenAuthor) &&
    Boolean(currentPost?.authorId && currentPost.authorId.trim().length > 0);
  const useEngagementBar = immersiveBottomVariant === 'engagement-bar';
  const useDarkSystemUi = useEngagementBar;
  const reportModalSheetStyle = useMemo(
    () => [
      REPORT_MODAL_SHEET_BASE_STYLE,
      {
        paddingBottom: Math.max(safeBottom, 14) + 8,
      },
    ],
    [safeBottom],
  );
  const isPendingReportForCurrentPost = Boolean(
    currentPost && pendingReportPostId === currentPost.id,
  );
  const [isCommentsModalVisible, setIsCommentsModalVisible] = useState(false);
  const [comments, setComments] = useState<ExploreComment[]>([]);
  const [isCommentsLoading, setIsCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [newCommentText, setNewCommentText] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [commentLikePendingIds, setCommentLikePendingIds] = useState<
    Record<string, true>
  >({});
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [localCommentDeltaByPostId, setLocalCommentDeltaByPostId] = useState<
    Record<string, number>
  >({});
  const commentInputRef = useRef<TextInput>(null);
  const sendScale = useRef(new Animated.Value(0)).current;
  const commentsListContentStyle = useMemo(
    () => ({
      paddingBottom: Math.max(14, Math.max(safeBottom, 12) + 48),
      paddingTop: 0,
    }),
    [safeBottom],
  );
  const commentsComposerContainerStyle = useMemo(
    () => ({
      paddingBottom: Math.max(safeBottom, 14),
      paddingTop: 8,
    }),
    [safeBottom],
  );
  const commentsSheetStyle = useMemo(() => {
    const maxSheetHeight = WINDOW_HEIGHT * 0.7;
    const minSheetHeight = WINDOW_HEIGHT * 0.24;
    const availableHeight = WINDOW_HEIGHT - Math.max(safeTop, 26) - 18;
    return {
      height: Math.max(minSheetHeight, Math.min(maxSheetHeight, availableHeight)),
    };
  }, [safeTop]);
  const currentPostCommentCount = Math.max(
    0,
    Number(currentPost?.stats?.commentsCount ?? 0) +
      (currentPost ? localCommentDeltaByPostId[currentPost.id] ?? 0 : 0),
  );
  const viewerComposerAvatarUri = useMemo(() => {
    const normalized = viewerAvatarUrl.trim();
    if (normalized.length === 0) {
      return FALLBACK_AVATAR;
    }
    return resolveProtectedMediaUrl(normalized);
  }, [viewerAvatarUrl]);
  const [isReportSheetVisible, setIsReportSheetVisible] = useState(false);
  const heartOpacity = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(0.34)).current;
  const lastTapAtRef = useRef(0);
  const lastTapPostIdRef = useRef('');
  const tapResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (tapResetTimerRef.current) {
        clearTimeout(tapResetTimerRef.current);
        tapResetTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      setIsReportSheetVisible(false);
      setIsCommentsModalVisible(false);
      setComments([]);
      setCommentsError(null);
      setCommentLikePendingIds({});
      setCommentsPostId(null);
      setNewCommentText('');
      setIsSubmittingComment(false);
    }
  }, [visible]);

  useEffect(() => {
    Animated.spring(sendScale, {
      toValue: newCommentText.trim().length > 0 ? 1 : 0,
      damping: 15,
      mass: 0.8,
      stiffness: 180,
      useNativeDriver: true,
    }).start();
  }, [newCommentText, sendScale]);

  const openCommentsModal = useCallback(async (post: PostViewerItem) => {
    const postId = post.id.trim();
    if (!postId) {
      return;
    }
    setCommentsPostId(postId);
    setIsCommentsModalVisible(true);
    setIsCommentsLoading(true);
    setCommentsError(null);
    try {
      const response = await fetchExploreComments(postId);
      setComments(response.comments);
    } catch (error) {
      setCommentsError('Yorumlar su an yuklenemedi.');
    } finally {
      setIsCommentsLoading(false);
    }
  }, []);

  const submitComment = useCallback(async () => {
    if (!commentsPostId || isSubmittingComment) {
      return;
    }
    const text = newCommentText.trim();
    if (!text.length) {
      return;
    }
    setIsSubmittingComment(true);
    setCommentsError(null);
    try {
      const response = await sendExploreComment(commentsPostId, text);
      setComments(previous => [response.comment, ...previous]);
      setNewCommentText('');
      setLocalCommentDeltaByPostId(previous => ({
        ...previous,
        [commentsPostId]: (previous[commentsPostId] ?? 0) + 1,
      }));
    } catch (error) {
      setCommentsError('Yorum gonderilemedi. Lutfen tekrar dene.');
    } finally {
      setIsSubmittingComment(false);
    }
  }, [commentsPostId, isSubmittingComment, newCommentText]);

  const handleToggleCommentLike = useCallback((comment: ExploreComment) => {
    const commentId = comment.id.trim();
    if (!commentId || commentLikePendingIds[commentId]) {
      return;
    }
    const previousIsLiked = Boolean(comment.isLiked);
    const previousLikeCount = Math.max(0, Number(comment.likeCount || 0));
    const nextIsLiked = !previousIsLiked;
    const nextLikeCount = Math.max(
      0,
      previousLikeCount + (nextIsLiked ? 1 : -1),
    );

    setCommentLikePendingIds(previous => ({
      ...previous,
      [commentId]: true,
    }));
    setComments(previous =>
      previous.map(item =>
        item.id === commentId
          ? {
              ...item,
              isLiked: nextIsLiked,
              likeCount: nextLikeCount,
            }
          : item,
      ),
    );

    sendExploreCommentLike(commentId)
      .then(response => {
        setComments(previous =>
          previous.map(item =>
            item.id === commentId
              ? {
                  ...item,
                  ...response.comment,
                }
              : item,
          ),
        );
      })
      .catch(() => {
        setComments(previous =>
          previous.map(item =>
            item.id === commentId
              ? {
                  ...item,
                  isLiked: previousIsLiked,
                  likeCount: previousLikeCount,
                }
              : item,
          ),
        );
      })
      .finally(() => {
        setCommentLikePendingIds(previous => {
          if (!previous[commentId]) {
            return previous;
          }
          const next = { ...previous };
          delete next[commentId];
          return next;
        });
      });
  }, [commentLikePendingIds]);

  const playDoubleTapHeart = useCallback(() => {
    heartOpacity.stopAnimation();
    heartScale.stopAnimation();
    heartOpacity.setValue(0);
    heartScale.setValue(0.34);
    Animated.parallel([
      Animated.sequence([
        Animated.timing(heartOpacity, {
          duration: 90,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(heartOpacity, {
          duration: 190,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(heartOpacity, {
          duration: 210,
          easing: Easing.in(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(heartScale, {
          duration: 180,
          easing: Easing.out(Easing.back(1.6)),
          toValue: 1.14,
          useNativeDriver: true,
        }),
        Animated.timing(heartScale, {
          duration: 110,
          easing: Easing.out(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(heartScale, {
          duration: 210,
          easing: Easing.in(Easing.quad),
          toValue: 0.76,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [heartOpacity, heartScale]);

  const handleMediaSurfacePress = useCallback(
    (item: PostViewerItem, index: number) => {
      if (index !== currentIndex || !onReact) {
        return;
      }
      const now = Date.now();
      const elapsed = now - lastTapAtRef.current;
      const isSamePost = lastTapPostIdRef.current === item.id;
      const likePendingKey = `${item.id}:like`;
      const isLikePendingForItem = Boolean(pendingReactionKeys?.[likePendingKey]);
      const isAlreadyLiked = Boolean(item.viewerState?.isLiked);

      if (isSamePost && elapsed > 0 && elapsed <= DOUBLE_TAP_MAX_DELAY_MS) {
        lastTapAtRef.current = 0;
        lastTapPostIdRef.current = '';
        if (tapResetTimerRef.current) {
          clearTimeout(tapResetTimerRef.current);
          tapResetTimerRef.current = null;
        }
        playDoubleTapHeart();
        if (!isAlreadyLiked && !isLikePendingForItem) {
          onReact(item, 'like');
        }
        return;
      }

      lastTapAtRef.current = now;
      lastTapPostIdRef.current = item.id;
      if (tapResetTimerRef.current) {
        clearTimeout(tapResetTimerRef.current);
      }
      tapResetTimerRef.current = setTimeout(() => {
        lastTapAtRef.current = 0;
        lastTapPostIdRef.current = '';
        tapResetTimerRef.current = null;
      }, DOUBLE_TAP_MAX_DELAY_MS + 16);
    },
    [currentIndex, onReact, pendingReactionKeys, playDoubleTapHeart],
  );

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent={useDarkSystemUi}
      transparent={false}
      visible={visible}
    >
      <StatusBar
        animated={true}
        backgroundColor={useDarkSystemUi ? 'transparent' : '#ffffff'}
        barStyle={useDarkSystemUi ? 'light-content' : 'dark-content'}
        translucent={useDarkSystemUi}
      />
      <View style={styles.screen}>
        <FlatList
          data={posts}
          getItemLayout={(_, index) => ({
            index,
            length: pageSize,
            offset: pageSize * index,
          })}
          horizontal={!isVertical}
          initialNumToRender={2}
          keyExtractor={item => item.id}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          pagingEnabled={true}
          ref={listRef}
          removeClippedSubviews={false}
          renderItem={({ item, index }) => (
            <View style={styles.slide}>
              <AppMedia
                mediaType={item.mediaType}
                mediaUrl={item.mediaUrl}
                mode="viewer"
                muted={false}
                paused={index !== currentIndex}
                showViewerControls={false}
                showVideoBadge={item.mediaType === 'video'}
                style={styles.media}
                thumbnailUrl={
                  item.thumbnailUrl ??
                  resolveMediaThumbnailUrl({
                    mediaType: item.mediaType,
                    mediaUrl: item.mediaUrl,
                  })
                }
                videoRepeat={false}
              />
              <Pressable
                android_disableSound={true}
                onPress={() => {
                  handleMediaSurfacePress(item, index);
                }}
                style={styles.mediaTapSurface}
              >
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.doubleTapHeartOverlay,
                    { opacity: heartOpacity, transform: [{ scale: heartScale }] },
                  ]}
                >
                  <View style={styles.doubleTapHeartBubble}>
                    <FeatherIcon
                      color="#ffffff"
                      name="heart"
                      size={DOUBLE_TAP_HEART_MAX_SIZE}
                      strokeWidth={2.7}
                    />
                  </View>
                </Animated.View>
              </Pressable>
            </View>
          )}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          windowSize={3}
        />

        <View
          style={[
            styles.topBar,
            !showImmersiveHeaderMeta ? styles.topBarBackOnly : null,
            { paddingTop: topInset },
          ]}
        >
          <Pressable
            onPress={onClose}
            style={styles.iconButton}
          >
            <FeatherIcon
              color="#ffffff"
              name="arrow-left"
              size={27}
            />
          </Pressable>

          {showImmersiveHeaderMeta ? (
            <View style={styles.counterWrap}>
              <Text allowFontScaling={false} style={styles.counterText}>
                {counterText}
              </Text>
              <Text allowFontScaling={false} style={styles.swipeHintText}>
                {isVertical ? 'Yukari/asagi kaydir' : 'Saga/sola kaydir'}
              </Text>
            </View>
          ) : null}
        </View>

        {currentPost ? (
          <View style={[styles.bottomCard, { paddingBottom: bottomInset }]}>
            <View style={styles.bottomMeta}>
              <View style={styles.bottomHeader}>
                <Pressable
                  disabled={!canOpenCurrentAuthor}
                  onPress={() => {
                    onOpenAuthor?.(currentPost);
                  }}
                  style={({ pressed }) => [
                    styles.usernamePressTarget,
                    styles.bottomAuthorRow,
                    pressed ? styles.usernamePressTargetPressed : null,
                  ]}
                >
                  <View style={styles.bottomAuthorAvatarWrap}>
                    {resolvedAuthorAvatarUri.length > 0 ? (
                      <Image
                        key={resolvedAuthorAvatarUri}
                        source={{ uri: resolvedAuthorAvatarUri }}
                        style={styles.bottomAuthorAvatar}
                      />
                    ) : (
                      <View style={styles.bottomAuthorAvatarFallback}>
                        <FeatherIcon color="#94a3b8" name="user" size={12} />
                      </View>
                    )}
                  </View>
                  <View style={styles.bottomAuthorIdentity}>
                    <Text allowFontScaling={false} style={styles.usernameText}>
                      @{(currentPost.authorUsername || '').trim() || 'kullanici'}
                    </Text>
                  </View>
                </Pressable>
              </View>
              <Text
                allowFontScaling={false}
                numberOfLines={2}
                style={styles.captionText}
              >
                {formatCaption(currentPost.caption)}
              </Text>
            </View>

            {useEngagementBar ? (
              <>
                <View style={styles.engagementBar}>
                  <Pressable
                    disabled={!onReact || isLikePending}
                    onPress={() => {
                      onReact?.(currentPost, 'like');
                    }}
                    style={[
                      styles.engagementActionSlot,
                      currentPostLiked ? styles.engagementActionActive : null,
                      isLikePending ? styles.engagementActionPending : null,
                    ]}
                  >
                    <View style={styles.engagementActionContent}>
                      <FeatherIcon
                        color={currentPostLiked ? '#fb7185' : '#e5e7eb'}
                        name="heart"
                        size={22}
                        strokeWidth={1.75}
                      />
                      <Text allowFontScaling={false} style={styles.engagementCountText}>
                        {formatCount(Number(currentPost.stats?.likesCount ?? 0))}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    disabled={!currentPost}
                    onPress={() => {
                      if (!currentPost) {
                        return;
                      }
                      openCommentsModal(currentPost);
                    }}
                    style={[
                      styles.engagementActionSlot,
                    ]}
                  >
                    <View style={styles.engagementActionContent}>
                      <FeatherIcon
                        color="#e5e7eb"
                        name="message-circle"
                        size={22}
                        strokeWidth={1.75}
                      />
                      <Text allowFontScaling={false} style={styles.engagementCountText}>
                        {formatCount(currentPostCommentCount)}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    disabled={!onReact || isBookmarkPending}
                    onPress={() => {
                      onReact?.(currentPost, 'bookmark');
                    }}
                    style={[
                      styles.engagementActionSlot,
                      currentPostBookmarked ? styles.engagementActionActive : null,
                      isBookmarkPending ? styles.engagementActionPending : null,
                    ]}
                  >
                    <View style={styles.engagementActionContent}>
                      <FeatherIcon
                        color={currentPostBookmarked ? '#60a5fa' : '#e5e7eb'}
                        name="bookmark"
                        size={22}
                        strokeWidth={1.75}
                      />
                      <Text allowFontScaling={false} style={styles.engagementCountText}>
                        {formatCount(Number(currentPost.stats?.bookmarksCount ?? 0))}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    disabled={!onReact || isSharePending}
                    onPress={() => {
                      onReact?.(currentPost, 'share');
                    }}
                    style={[
                      styles.engagementActionSlot,
                      isSharePending ? styles.engagementActionPending : null,
                    ]}
                  >
                    <View style={styles.engagementActionContent}>
                      <FeatherIcon
                        color="#e5e7eb"
                        name="share-2"
                        size={22}
                        strokeWidth={1.75}
                      />
                      <Text allowFontScaling={false} style={styles.engagementCountText}>
                        {formatCount(Number(currentPost.stats?.sharesCount ?? 0))}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    disabled={!onReport || isPendingReportForCurrentPost}
                    onPress={() => {
                      setIsReportSheetVisible(true);
                    }}
                    style={[
                      styles.engagementFlagSlot,
                      isPendingReportForCurrentPost ? styles.engagementActionPending : null,
                    ]}
                  >
                    <FeatherIcon
                      color="#e5e7eb"
                      name="flag"
                      size={22}
                      strokeWidth={1.75}
                    />
                  </Pressable>
                </View>
                <Text allowFontScaling={false} style={styles.engagementFooterText}>
                  {formatLocation(currentPost.location)}
                  {` - ${formatRelativeTime(currentPost.createdAt)}`}
                </Text>
              </>
            ) : (
              <View style={styles.statsRow}>
                <Text allowFontScaling={false} style={styles.statsText}>
                  Begeni {formatCount(Number(currentPost.stats?.likesCount ?? 0))}
                </Text>
                <Text allowFontScaling={false} style={styles.statsText}>
                  Yorum {formatCount(Number(currentPost.stats?.commentsCount ?? 0))}
                </Text>
                <Text allowFontScaling={false} style={styles.statsText}>
                  Kaydet {formatCount(Number(currentPost.stats?.bookmarksCount ?? 0))}
                </Text>
              </View>
            )}
          </View>
        ) : null}
        <Modal
          animationType="slide"
          onRequestClose={() => {
            if (isSubmittingComment) {
              return;
            }
            setIsCommentsModalVisible(false);
          }}
          statusBarTranslucent={true}
          transparent={true}
          visible={isCommentsModalVisible}
        >
          <StatusBar
            animated={true}
            backgroundColor="transparent"
            barStyle="light-content"
            hidden={true}
            translucent={true}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? safeTop + 6 : 0}
            style={COMMENTS_KEYBOARD_AVOIDING_STYLE}
          >
            <Pressable
              disabled={isSubmittingComment}
              onPress={() => {
                if (isSubmittingComment) {
                  return;
                }
                setIsCommentsModalVisible(false);
              }}
              style={COMMENTS_BACKDROP_STYLE}
              className="absolute bottom-0 left-0 right-0 top-0 bg-black/20"
            />
            <View
              className="w-full overflow-hidden rounded-t-[24px] border border-[#e8ebf2] bg-white"
              style={commentsSheetStyle}
            >
              <View className="z-10 border-b border-[#edf1f5] bg-white px-4 pb-3 pt-2">
                <View className="mb-3 h-[5px] w-11 self-center rounded-full bg-[#d6dde8]" />
                <View className="flex-row items-center">
                  <Text className="ml-8 flex-1 text-center text-[15px] font-semibold tracking-tight text-[#111827]">
                    Yorumlar ({formatCount(currentPostCommentCount)})
                  </Text>
                  <Pressable
                    className="h-8 w-8 items-center justify-center rounded-full bg-[#f3f4f6]"
                    disabled={isSubmittingComment}
                    onPress={() => {
                      setIsCommentsModalVisible(false);
                    }}
                  >
                    <FeatherIcon name="x" size={18} color="#6b7280" />
                  </Pressable>
                </View>
              </View>

              <ScrollView
                className="flex-1 bg-white px-4 pt-3"
                contentContainerStyle={[
                  COMMENTS_LIST_CONTENT_STYLE,
                  commentsListContentStyle,
                ]}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="always"
                showsVerticalScrollIndicator={false}
              >
                {!isCommentsLoading && commentsError ? (
                  <View className="rounded-[16px] border border-rose-200 bg-rose-50 px-4 py-4">
                    <Text className="text-[13px] leading-5 text-rose-500">
                      {commentsError}
                    </Text>
                    {commentsPostId ? (
                      <Pressable
                        className="mt-3 self-start rounded-full bg-[#ffe8dd] px-4 py-2"
                        onPress={() => {
                          const targetPost = posts.find(item => item.id === commentsPostId);
                          if (targetPost) {
                            openCommentsModal(targetPost).catch(() => {
                              return;
                            });
                          }
                        }}
                      >
                        <Text className="text-[12px] font-semibold text-[#c2410c]">
                          Tekrar dene
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                {isCommentsLoading ? (
                  <View className="items-center justify-center py-16">
                    <IosSpinner color="#64748b" size="small" />
                  </View>
                ) : comments.length > 0 ? (
                  comments.map(comment => (
                    <View key={comment.id} className="mb-4 flex-row">
                      <Image
                        className="mr-3 h-9 w-9 rounded-full border border-[#eef0f4]"
                        source={{
                          uri:
                            resolveProtectedMediaUrl(
                              comment.author.avatarUrl?.trim() || '',
                            ) || FALLBACK_AVATAR,
                        }}
                      />
                      <View className="flex-1 border-b border-[#f1f5f9] pb-4">
                        <Text className="mb-1 text-[12.5px] font-semibold tracking-tight text-[#111827]">
                          {safeAuthorUsernameValue(comment.author.username)}{' '}
                          <Text className="text-[11.5px] font-normal text-[#94a3b8]">
                            {formatRelativeTime(comment.createdAt)}
                          </Text>
                        </Text>
                        <Text className="text-[13.5px] leading-5 text-[#374151]">
                          {comment.body}
                        </Text>
                      </View>
                      <Pressable
                        className="ml-2 items-center justify-start px-1 pt-1"
                        disabled={Boolean(commentLikePendingIds[comment.id])}
                        hitSlop={8}
                        onPress={() => {
                          handleToggleCommentLike(comment);
                        }}
                        style={
                          commentLikePendingIds[comment.id]
                            ? styles.commentLikePending
                            : undefined
                        }
                      >
                        <FeatherIcon
                          color={comment.isLiked ? '#f97316' : '#9ca3af'}
                          name="heart"
                          size={17}
                          strokeWidth={1.5}
                        />
                        <Text
                          className={`mt-1 text-[11px] font-medium ${comment.isLiked ? 'text-[#ea580c]' : 'text-slate-500'}`}
                        >
                          {formatCount(Math.max(0, Number(comment.likeCount || 0)))}
                        </Text>
                      </Pressable>
                    </View>
                  ))
                ) : (
                  <View className="items-center justify-center py-16">
                    <Text className="text-[15px] font-semibold text-[#111827]">
                      Henuz yorum yok
                    </Text>
                    <Text className="mt-2 text-center text-[13px] leading-5 text-[#6b7280]">
                      Ilk yorumu birak ve bu postun realtime akisina dahil ol.
                    </Text>
                  </View>
                )}
              </ScrollView>

              <View
                className="border-t border-[#edf0f4] bg-white px-4"
                style={commentsComposerContainerStyle}
              >
                <View className="flex-row items-center gap-3">
                  <Image
                    className="h-9 w-9 rounded-full border border-[#eef0f4]"
                    source={{ uri: viewerComposerAvatarUri }}
                  />
                  <Pressable
                    className="min-h-[42px] flex-1 flex-row items-center rounded-full border border-[#e5e7eb] bg-[#f8fafc] px-4"
                    onPress={() => {
                      commentInputRef.current?.focus?.();
                    }}
                  >
                    <TextInput
                      ref={commentInputRef}
                      className="flex-1 py-2 text-[14px] text-[#111827]"
                      multiline={true}
                      onChangeText={setNewCommentText}
                      placeholder="Yorum ekle..."
                      placeholderTextColor="#94a3b8"
                      value={newCommentText}
                    />
                    {newCommentText.trim().length > 0 ? (
                      <Animated.View style={{ transform: [{ scale: sendScale }] }}>
                        <Pressable
                          className="pl-1"
                          disabled={isSubmittingComment}
                          onPress={() => {
                            submitComment().catch(() => {
                              return;
                            });
                          }}
                        >
                          <View className="h-7 w-7 items-center justify-center rounded-full bg-[#ff6a37]">
                            {isSubmittingComment ? (
                              <IosSpinner size="small" />
                            ) : (
                              <FeatherIcon
                                color="#ffffff"
                                name="arrow-up"
                                size={16}
                                strokeWidth={2.5}
                              />
                            )}
                          </View>
                        </Pressable>
                      </Animated.View>
                    ) : null}
                  </Pressable>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
        <Modal
          animationType="slide"
          onRequestClose={() => {
            if (isPendingReportForCurrentPost) {
              return;
            }
            setIsReportSheetVisible(false);
          }}
          statusBarTranslucent={true}
          transparent={true}
          visible={isReportSheetVisible}
        >
          <StatusBar
            animated={true}
            backgroundColor="transparent"
            barStyle="dark-content"
            translucent={true}
          />
          <View className="flex-1 justify-end">
            <Pressable
              className="absolute inset-0 bg-black/34"
              disabled={isPendingReportForCurrentPost}
              onPress={() => {
                if (isPendingReportForCurrentPost) {
                  return;
                }
                setIsReportSheetVisible(false);
              }}
            />
            <View
              className="w-full rounded-t-[36px] bg-[#f6f7f9]"
              style={reportModalSheetStyle}
            >
              <View
                className="border-b border-[#e7ebf0] px-5 pb-4"
                style={{ paddingTop: Math.max(safeTop, 18) + 2 }}
              >
                <View className="flex-row items-center">
                  <Pressable
                    className="h-10 w-10 items-center justify-center rounded-full"
                    disabled={isPendingReportForCurrentPost}
                    onPress={() => {
                      setIsReportSheetVisible(false);
                    }}
                  >
                    <FeatherIcon color="#111827" name="x" size={24} />
                  </Pressable>
                  <Text className="flex-1 text-center text-[16px] font-medium text-[#111827]">
                    Gönderiyi Şikayet Et
                  </Text>
                  <View className="h-10 w-10" />
                </View>
              </View>

              <View className="px-5 pt-4">
                <Text className="text-[14px] font-normal text-[#7f8796]">
                  Neden şikayet etmek istiyorsunuz?
                </Text>
              </View>

              <ScrollView
                className="flex-1"
                contentContainerStyle={[
                  REPORT_MODAL_SCROLL_CONTENT_STYLE,
                  REPORT_MODAL_SCROLL_INSET_STYLE,
                ]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View className="gap-3">
                  {POST_REPORT_REASON_OPTIONS.map(option => (
                    <Pressable
                      className={`h-[72px] flex-row items-center rounded-[16px] border border-[#eceff3] bg-[#f2f4f7] px-4 ${isPendingReportForCurrentPost ? 'opacity-60' : ''}`}
                      disabled={isPendingReportForCurrentPost}
                      key={option.key}
                      onPress={() => {
                        if (!currentPost || !onReport) {
                          return;
                        }
                        onReport(currentPost, option.key);
                        setIsReportSheetVisible(false);
                      }}
                    >
                      <View className="h-[38px] w-[38px] items-center justify-center rounded-full bg-[#fff1f2]">
                        <FeatherIcon color="#ef4444" name={option.icon} size={18} />
                      </View>
                      <Text className="ml-3 flex-1 text-[14px] font-normal text-[#1f2937]">
                        {option.label}
                      </Text>
                      {isPendingReportForCurrentPost ? (
                        <IosSpinner color="#9ca3af" size="small" />
                      ) : (
                        <FeatherIcon color="#a5acb7" name="chevron-right" size={21} />
                      )}
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bottomCard: {
    bottom: 0,
    left: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    position: 'absolute',
    right: 0,
  },
  bottomMeta: {
    marginBottom: 12,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  bottomHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 6,
  },
  bottomAuthorAvatar: {
    borderRadius: 22,
    height: 44,
    width: 44,
  },
  bottomAuthorAvatarWrap: {
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 23,
    borderWidth: 1,
    height: 46,
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
    padding: 1,
    width: 46,
  },
  bottomAuthorAvatarFallback: {
    alignItems: 'center',
    backgroundColor: 'rgba(148,163,184,0.2)',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  bottomAuthorIdentity: {
    justifyContent: 'center',
    minHeight: 46,
  },
  bottomAuthorRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  captionText: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    marginBottom: 20,
    textShadowColor: 'rgba(0,0,0,0.48)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2.5,
  },
  counterText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '500',
  },
  counterWrap: {
    alignItems: 'flex-end',
  },
  doubleTapHeartBubble: {
    alignItems: 'center',
    backgroundColor: 'rgba(8,10,16,0.28)',
    borderColor: 'rgba(255,255,255,0.26)',
    borderRadius: 56,
    borderWidth: 1,
    height: 112,
    justifyContent: 'center',
    width: 112,
  },
  doubleTapHeartOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    ...StyleSheet.absoluteFillObject,
  },
  createdAtText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
  },
  engagementBar: {
    alignItems: 'center',
    backgroundColor: 'rgba(19, 24, 34, 0.74)',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 26,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginTop: 2,
    minHeight: 76,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  engagementFooterText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  engagementActionSlot: {
    alignItems: 'center',
    borderRadius: 999,
    flex: 1,
    flexDirection: 'column',
    minHeight: 48,
    minWidth: 0,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  engagementActionContent: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 22,
  },
  engagementFlagSlot: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'column',
    justifyContent: 'center',
    minWidth: 44,
    marginLeft: 2,
    paddingHorizontal: 2,
  },
  commentsModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  commentsModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  commentsSheet: {
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: WINDOW_HEIGHT * 0.72,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  commentsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  commentsTitle: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '700',
  },
  commentsCloseButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  commentsErrorText: {
    color: '#b91c1c',
    fontSize: 12,
    marginBottom: 10,
  },
  commentsScrollContent: {
    gap: 8,
    paddingBottom: 12,
  },
  commentsLoadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
  },
  commentsEmptyText: {
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
  },
  commentRow: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  commentAuthor: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '700',
  },
  commentBody: {
    color: '#334155',
    fontSize: 13,
    marginTop: 2,
  },
  commentMeta: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 6,
  },
  commentInputRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  commentInput: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe2ea',
    borderRadius: 12,
    borderWidth: 1,
    color: '#0f172a',
    flex: 1,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  commentSendButton: {
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  commentSendButtonDisabled: {
    opacity: 0.5,
  },
  commentSendButtonPressed: {
    opacity: 0.82,
  },
  commentLikePending: {
    opacity: 0.55,
  },
  engagementActionActive: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  engagementActionPending: {
    opacity: 0.55,
  },
  engagementActionPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
  engagementCountText: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.58)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 28,
    borderWidth: 1,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  locationText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginTop: 0,
    opacity: 0,
    position: 'absolute',
    textShadowColor: 'rgba(0,0,0,0.44)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2.2,
  },
  media: {
    height: MEDIA_VIEW_HEIGHT,
    width: WINDOW_WIDTH,
  },
  mediaTapSurface: {
    ...StyleSheet.absoluteFillObject,
  },
  screen: {
    backgroundColor: '#000000',
    flex: 1,
  },
  slide: {
    alignItems: 'center',
    backgroundColor: '#000000',
    height: WINDOW_HEIGHT,
    justifyContent: 'flex-start',
    width: WINDOW_WIDTH,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
  statsText: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: 14,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  topBarBackOnly: {
    justifyContent: 'flex-start',
  },
  swipeHintText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 10.5,
    marginTop: 2,
  },
  usernameText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    includeFontPadding: false,
    marginLeft: 0,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2.2,
  },
  usernamePressTarget: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    marginRight: 12,
    maxWidth: '100%',
  },
  usernamePressTargetPressed: {
    opacity: 0.72,
  },
});
