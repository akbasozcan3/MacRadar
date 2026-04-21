import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  type KeyboardEvent,
  useWindowDimensions,
  View,
} from 'react-native';

import FeatherIcon from '../../../components/FeatherIcon/FeatherIcon';
import IosSpinner from '../../../components/IosSpinner/IosSpinner';
import { Text, TextInput } from '../../../theme/typography';
import type { ExploreSearchUser } from '../../../types/ExploreTypes/ExploreTypes';
import RecentChatList from './RecentChatList';
import UserSearchInput from './UserSearchInput';

type NewConversationModalProps = {
  backdropOpacity: Animated.Value;
  cardOpacity: Animated.Value;
  cardTranslateY: Animated.Value;
  contentBottomInset: number;
  errorMessage: string | null;
  initialMessage: string;
  inputRef?: React.RefObject<React.ElementRef<typeof TextInput> | null>;
  isCreating: boolean;
  isLoading: boolean;
  isOpen: boolean;
  onChangeInitialMessage: (value: string) => void;
  onChangeQuery: (value: string) => void;
  onClose: () => void;
  onSelectUser: (user: ExploreSearchUser) => void;
  onSubmit: () => void;
  query: string;
  resultsTitle: string;
  selectedUser: ExploreSearchUser | null;
  sheetHalfOpenOffset: number;
  sheetHiddenOffset: number;
  showEmptyState: boolean;
  showIdleState: boolean;
  users: ExploreSearchUser[];
};

function NewConversationModal({
  backdropOpacity,
  cardOpacity,
  cardTranslateY,
  contentBottomInset,
  errorMessage,
  initialMessage,
  inputRef,
  isCreating,
  isLoading,
  isOpen,
  onChangeInitialMessage,
  onChangeQuery,
  onClose,
  onSelectUser,
  onSubmit,
  query,
  resultsTitle,
  selectedUser,
  sheetHalfOpenOffset,
  sheetHiddenOffset,
  showEmptyState,
  showIdleState,
  users,
}: NewConversationModalProps) {
  const { height: viewportHeight } = useWindowDimensions();
  const resolvedBottomInset =
    Platform.OS === 'ios'
      ? Math.min(Math.max(contentBottomInset, 12), 24)
      : Math.min(Math.max(contentBottomInset, 8), 16);
  const sheetHeight = Math.round(
    Math.max(520, Math.min(viewportHeight - 64, viewportHeight * 0.9)),
  );
  const emptyTitle = showEmptyState
    ? 'Kullanıcı bulunamadı'
    : showIdleState
      ? 'Mesaj başlatmak için kişi seç'
      : 'Sonuç bulunamadı';
  const emptySubtitle = showEmptyState
    ? 'Farklı bir isim veya kullanıcı adı dene.'
    : showIdleState
      ? 'Kişi ara veya önerilen kullanıcılardan birini seçerek sohbet başlat.'
      : 'Farklı bir arama kelimesi deneyebilirsin.';
  const dragCloseThreshold = Math.max(96, Math.min(164, sheetHiddenOffset * 0.18));
  const activeSnapOffsetRef = useRef(0);
  const gestureStartOffsetRef = useRef(0);
  const [keyboardPad, setKeyboardPad] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setKeyboardPad(0);
      return;
    }

    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (event: KeyboardEvent) => {
      setKeyboardPad(event.endCoordinates.height);
    };
    const onHide = () => {
      setKeyboardPad(0);
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [isOpen]);

  const animateSheetToOffset = useMemo(
    () => (targetOffset: number) => {
      activeSnapOffsetRef.current = targetOffset;
      Animated.parallel([
        Animated.spring(cardTranslateY, {
          damping: 18,
          mass: 0.92,
          overshootClamping: true,
          stiffness: 210,
          toValue: targetOffset,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          duration: 180,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(cardOpacity, {
          duration: 180,
          toValue: 1,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [backdropOpacity, cardOpacity, cardTranslateY],
  );

  useEffect(() => {
    activeSnapOffsetRef.current = isOpen ? 0 : sheetHiddenOffset;
    gestureStartOffsetRef.current = activeSnapOffsetRef.current;
  }, [isOpen, sheetHiddenOffset]);

  const dragHandlePanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          if (!isOpen) {
            return false;
          }

          return (
            Math.abs(gestureState.dy) > 4 &&
            Math.abs(gestureState.dy) > Math.abs(gestureState.dx)
          );
        },
        onPanResponderGrant: () => {
          Keyboard.dismiss();
          gestureStartOffsetRef.current = activeSnapOffsetRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          const nextTranslateY = Math.max(
            0,
            Math.min(sheetHiddenOffset, gestureStartOffsetRef.current + gestureState.dy),
          );
          const progress = 1 - Math.min(1, nextTranslateY / sheetHiddenOffset);

          cardTranslateY.setValue(nextTranslateY);
          backdropOpacity.setValue(progress);
          cardOpacity.setValue(0.9 + progress * 0.1);
        },
        onPanResponderRelease: (_, gestureState) => {
          const releasedOffset = Math.max(
            0,
            Math.min(sheetHiddenOffset, gestureStartOffsetRef.current + gestureState.dy),
          );
          const shouldClose =
            releasedOffset >= dragCloseThreshold ||
            gestureState.vy >= 1.18;

          if (shouldClose) {
            onClose();
            return;
          }

          animateSheetToOffset(0);
        },
        onPanResponderTerminate: () => {
          animateSheetToOffset(activeSnapOffsetRef.current);
        },
      }),
    [
      animateSheetToOffset,
      backdropOpacity,
      cardOpacity,
      cardTranslateY,
      dragCloseThreshold,
      isOpen,
      onClose,
      sheetHalfOpenOffset,
      sheetHiddenOffset,
    ],
  );

  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent={true}
      transparent={true}
      visible={isOpen}
    >
      <StatusBar
        animated={true}
        backgroundColor="transparent"
        barStyle="light-content"
        translucent={true}
      />

      <View style={styles.root}>
        <Animated.View
          style={[
            styles.backdrop,
            {
              opacity: backdropOpacity,
            },
          ]}
        >
          <Pressable
            onPress={() => {
              Keyboard.dismiss();
              onClose();
            }}
            style={styles.backdropPressTarget}
          />
        </Animated.View>

        <View style={styles.keyboardLayer}>
          <View style={styles.sheetHost}>
            <Animated.View
              style={[
                styles.sheetAnimated,
                {
                  opacity: cardOpacity,
                  transform: [{ translateY: cardTranslateY }],
                },
              ]}
            >
              <View
                style={[
                  styles.sheetSurface,
                  {
                    height: sheetHeight,
                  },
                ]}
              >
                <View style={styles.dragZone} {...dragHandlePanResponder.panHandlers}>
                  <View style={styles.handle} />

                  <View style={styles.headerRow}>
                    <View style={styles.headerCopy}>
                      <Text allowFontScaling={false} style={styles.headerTitle}>
                        Yeni Konuşma
                      </Text>
                      <Text allowFontScaling={false} style={styles.headerSubtitle}>
                        Kişi seç, ilk mesajını yaz ve sohbeti başlat.
                      </Text>
                    </View>

                    <Pressable
                      onPress={onClose}
                      style={({ pressed }) => [
                        styles.closeButton,
                        pressed ? styles.closeButtonPressed : null,
                      ]}
                    >
                      <FeatherIcon color="#667085" name="x" size={17} />
                    </Pressable>
                  </View>
                </View>

                <Pressable
                  onPress={() => {
                    Keyboard.dismiss();
                  }}
                  style={styles.content}
                >
                  <UserSearchInput
                    inputRef={inputRef}
                    onChangeQuery={onChangeQuery}
                    query={query}
                    selectedUser={selectedUser}
                  />

                  {isLoading ? (
                    <View style={styles.loadingRow}>
                      <IosSpinner color="#ff5a1f" size="small" />
                      <Text
                        allowFontScaling={false}
                        className="ml-2 text-[11.5px] text-[#7b8495]"
                      >
                        Kişiler yükleniyor...
                      </Text>
                    </View>
                  ) : null}

                  {errorMessage ? (
                    <View style={styles.errorBox}>
                      <Text
                        allowFontScaling={false}
                        className="text-[12px] leading-[18px] text-rose-600"
                      >
                        {errorMessage}
                      </Text>
                    </View>
                  ) : null}

                  <View style={styles.listSection}>
                    <RecentChatList
                      emptySubtitle={emptySubtitle}
                      emptyTitle={emptyTitle}
                      onSelectUser={onSelectUser}
                      selectedUserId={selectedUser?.id ?? null}
                      title={resultsTitle}
                      users={users}
                    />
                  </View>

                  {selectedUser ? (
                    <View style={styles.composerSection}>
                      <Text allowFontScaling={false} style={styles.composerLabel}>
                        İlk mesaj (opsiyonel)
                      </Text>
                      <TextInput
                        allowFontScaling={false}
                        autoCapitalize="sentences"
                        autoCorrect={true}
                        className="px-4 pt-4 text-[13px] text-[#101828]"
                        multiline={true}
                        onChangeText={onChangeInitialMessage}
                        placeholder="İstersen açılış mesajı yaz..."
                        placeholderTextColor="#98a2b3"
                        style={styles.messageInput}
                        value={initialMessage}
                      />
                    </View>
                  ) : null}
                </Pressable>

                <View
                  style={[
                    styles.bottomBarHost,
                    {
                      minHeight: 64 + Math.max(resolvedBottomInset, 10),
                      paddingBottom:
                        Math.max(resolvedBottomInset, 10) +
                        (Platform.OS === 'ios' ? keyboardPad : 0),
                    },
                  ]}
                >
                  <View style={styles.bottomActionRow}>
                    <TouchableOpacity
                      activeOpacity={0.86}
                      onPress={onClose}
                      style={styles.bottomCancelButton}
                    >
                      <Text allowFontScaling={false} style={styles.bottomCancelText}>
                        Vazgeç
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.86}
                      disabled={!selectedUser || isCreating}
                      onPress={onSubmit}
                      style={[
                        styles.bottomSubmitButton,
                        !selectedUser || isCreating
                          ? styles.bottomSubmitButtonDisabled
                          : styles.bottomSubmitButtonEnabled,
                      ]}
                    >
                      {isCreating ? (
                        <ActivityIndicator color="#ffffff" size="small" />
                      ) : (
                        <Text
                          allowFontScaling={false}
                          style={
                            !selectedUser || isCreating
                              ? styles.bottomSubmitTextDisabled
                              : styles.bottomSubmitTextEnabled
                          }
                        >
                          Mesaj Gönder
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Animated.View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default memo(NewConversationModal);

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.14)',
  },
  backdropPressTarget: {
    ...StyleSheet.absoluteFillObject,
  },
  keyboardLayer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetHost: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  sheetAnimated: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    width: '100%',
  },
  sheetSurface: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.1,
    shadowRadius: 28,
  },
  dragZone: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: '#dbe4ee',
    borderRadius: 999,
    height: 5,
    width: 54,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 12,
  },
  headerCopy: {
    flex: 1,
    marginRight: 14,
  },
  headerTitle: {
    color: '#101828',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.35,
  },
  headerSubtitle: {
    color: '#667085',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderColor: '#dbe3ee',
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  closeButtonPressed: {
    opacity: 0.82,
  },
  content: {
    alignSelf: 'stretch',
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 20,
    paddingBottom: 12,
    width: '100%',
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 12,
  },
  errorBox: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecdd3',
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  listSection: {
    flex: 1,
    marginTop: 14,
    minHeight: 0,
  },
  composerSection: {
    marginTop: 16,
  },
  composerLabel: {
    color: '#667085',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  messageInput: {
    backgroundColor: '#f8fafc',
    borderColor: '#dbe3ee',
    borderRadius: 16,
    borderWidth: 1,
    maxHeight: 112,
    minHeight: 88,
    paddingBottom: 12,
    textAlignVertical: 'top',
  },
  bottomBarHost: {
    backgroundColor: '#ffffff',
    borderTopColor: '#e6edf5',
    borderTopWidth: 1,
    paddingTop: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    width: '100%',
  },
  bottomActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    width: '100%',
  },
  bottomCancelButton: {
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
    borderRadius: 16,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: '48%',
  },
  bottomCancelText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  bottomPressed: {
    opacity: 0.86,
  },
  bottomSubmitButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: '48%',
  },
  bottomSubmitButtonDisabled: {
    backgroundColor: '#edf1f6',
    borderColor: '#dfe6ef',
  },
  bottomSubmitButtonEnabled: {
    backgroundColor: '#f97316',
    borderColor: '#f97316',
  },
  bottomSubmitTextDisabled: {
    color: '#98a2b3',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  bottomSubmitTextEnabled: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.1,
  },
});
