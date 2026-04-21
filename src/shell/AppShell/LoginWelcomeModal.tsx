import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StatusBar,
  View,
  useWindowDimensions,
} from 'react-native';

import FeatherIcon from '../../components/FeatherIcon/FeatherIcon';
import { Text } from '../../theme/typography';

type LoginWelcomeModalProps = {
  onClose: () => void;
  userName?: string;
  visible: boolean;
};

const CARD_SHADOW = {
  elevation: 7,
  shadowColor: '#0f172a',
  shadowOffset: { width: 0, height: 12 },
  shadowOpacity: 0.08,
  shadowRadius: 24,
} as const;

const PRIMARY_CTA = '#0f172a';

const FEATURE_ROW_SHADOW = {
  elevation: 0,
  shadowColor: '#0f172a',
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0,
  shadowRadius: 0,
} as const;

const CTA_SHADOW = {
  elevation: 0,
  shadowColor: '#0f172a',
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0,
  shadowRadius: 0,
} as const;

function FeaturePill({
  icon,
  label,
}: {
  icon: string;
  label: string;
}) {
  return (
    <View>
      <View
        style={{
          ...FEATURE_ROW_SHADOW,
          alignItems: 'center',
          backgroundColor: '#ffffff',
          borderColor: '#e2e8f0',
          borderRadius: 14,
          borderWidth: 1,
          flexDirection: 'row',
          minHeight: 50,
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        <View
          style={{
            alignItems: 'center',
            backgroundColor: '#f8fafc',
            borderColor: '#e2e8f0',
            borderRadius: 11,
            borderWidth: 1,
            height: 32,
            justifyContent: 'center',
            width: 32,
          }}
        >
          <FeatherIcon color="#64748b" name={icon} size={14} strokeWidth={2} />
        </View>
        <Text
          allowFontScaling={false}
          style={{
            color: '#334155',
            flex: 1,
            fontSize: 13,
            fontWeight: '500',
            letterSpacing: -0.12,
            lineHeight: 18,
            marginLeft: 10,
          }}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

export default function LoginWelcomeModal({
  onClose,
  visible,
  userName,
}: LoginWelcomeModalProps) {
  const { width } = useWindowDimensions();
  const modalWidth = Math.min(width - 48, 340);
  const [isMounted, setIsMounted] = useState(visible);
  const isClosingRef = useRef(false);

  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.94)).current;
  const cardTranslateY = useRef(new Animated.Value(22)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;

  const resetForEnter = useCallback(() => {
    overlayOpacity.stopAnimation();
    cardOpacity.stopAnimation();
    cardScale.stopAnimation();
    cardTranslateY.stopAnimation();
    contentOpacity.stopAnimation();
    overlayOpacity.setValue(0);
    cardOpacity.setValue(0);
    cardScale.setValue(0.94);
    cardTranslateY.setValue(22);
    contentOpacity.setValue(0);
  }, [cardOpacity, cardScale, cardTranslateY, contentOpacity, overlayOpacity]);

  const playEnterAnimation = useCallback(() => {
    resetForEnter();
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: 170,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 185,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(cardScale, {
        toValue: 1,
        damping: 20,
        stiffness: 170,
        mass: 1,
        useNativeDriver: true,
      }),
      Animated.spring(cardTranslateY, {
        toValue: 0,
        damping: 21,
        stiffness: 180,
        mass: 1,
        useNativeDriver: true,
      }),
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 170,
        delay: 0,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [
    cardOpacity,
    cardScale,
    cardTranslateY,
    contentOpacity,
    overlayOpacity,
    resetForEnter,
  ]);

  const playExitAnimation = useCallback(
    (onDone?: () => void) => {
      overlayOpacity.stopAnimation();
      cardOpacity.stopAnimation();
      cardScale.stopAnimation();
      cardTranslateY.stopAnimation();
      contentOpacity.stopAnimation();
      Animated.parallel([
        Animated.timing(contentOpacity, {
          toValue: 0,
          duration: 90,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(cardOpacity, {
          toValue: 0,
          duration: 140,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(cardScale, {
          toValue: 0.97,
          duration: 145,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(cardTranslateY, {
          toValue: 10,
          duration: 145,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 165,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(() => {
        onDone?.();
      });
    },
    [cardOpacity, cardScale, cardTranslateY, contentOpacity, overlayOpacity],
  );

  const requestClose = useCallback(() => {
    if (isClosingRef.current) {
      return;
    }
    isClosingRef.current = true;
    playExitAnimation(() => {
      setIsMounted(false);
      isClosingRef.current = false;
      onClose();
    });
  }, [onClose, playExitAnimation]);

  useEffect(() => {
    if (visible) {
      if (!isMounted) {
        setIsMounted(true);
      } else {
        playEnterAnimation();
      }
      return;
    }
    if (!isMounted || isClosingRef.current) {
      return;
    }
    playExitAnimation(() => {
      setIsMounted(false);
    });
  }, [isMounted, playEnterAnimation, playExitAnimation, visible]);

  useEffect(() => {
    if (!isMounted || !visible) {
      return;
    }
    playEnterAnimation();
  }, [isMounted, playEnterAnimation, visible]);

  return (
    <Modal
      transparent
      visible={isMounted}
      animationType="none"
      onRequestClose={requestClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <StatusBar
        translucent
        backgroundColor="rgba(15, 23, 42, 0.42)"
        barStyle="light-content"
      />

      <Animated.View
        pointerEvents={isMounted ? 'auto' : 'none'}
        style={{
          flex: 1,
          opacity: overlayOpacity,
          backgroundColor: 'rgba(15, 23, 42, 0.34)',
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 20,
        }}
      >
        <Pressable
          onPress={requestClose}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
          }}
        />

        <Animated.View
          style={[
            CARD_SHADOW,
            {
              width: modalWidth,
              borderRadius: 24,
              borderColor: '#d4dee8',
              borderWidth: 1,
              backgroundColor: '#ffffff',
              opacity: cardOpacity,
              overflow: 'hidden',
              transform: [{ scale: cardScale }, { translateY: cardTranslateY }],
            },
          ]}
        >
          <Animated.View style={{ opacity: contentOpacity }}>
            <View
              style={{
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingHorizontal: 16,
                paddingTop: 14,
                paddingBottom: 12,
                width: modalWidth,
              }}
            >
              <View
                style={{
                  backgroundColor: '#f8fafc',
                  borderColor: '#dbe2ea',
                  borderRadius: 999,
                  borderWidth: 1,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                }}
              >
                <Text
                  allowFontScaling={false}
                  style={{
                    color: '#475569',
                    fontSize: 10,
                    fontWeight: '600',
                    letterSpacing: 0.8,
                  }}
                >
                  YENİ DENEYİM
                </Text>
              </View>

              <Pressable
                onPress={requestClose}
                accessibilityLabel="Kapat"
                hitSlop={12}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.65 : 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <View
                  style={{
                    alignItems: 'center',
                    backgroundColor: '#ffffff',
                    borderColor: '#dbe2ea',
                    borderRadius: 16,
                    borderWidth: 1,
                    height: 30,
                    justifyContent: 'center',
                    width: 30,
                  }}
                >
                  <FeatherIcon name="x" size={15} color="#64748b" />
                </View>
              </Pressable>
            </View>

            <View
              style={{
                backgroundColor: '#ffffff',
                borderTopColor: '#e2e8f0',
                borderTopWidth: 1,
                paddingBottom: 16,
                paddingHorizontal: 16,
                paddingTop: 14,
              }}
            >
              <Text
                allowFontScaling={false}
                adjustsFontSizeToFit
                minimumFontScale={0.86}
                numberOfLines={2}
                style={{
                  color: '#0f172a',
                  fontSize: 21,
                  fontWeight: '700',
                  letterSpacing: -0.5,
                  lineHeight: 27,
                  textAlign: 'center',
                }}
              >
                {userName && userName.length > 0
                  ? `Hoş geldin, ${userName}`
                  : 'Hoş geldin'}
              </Text>

              <Text
                allowFontScaling={false}
                style={{
                  color: '#64748b',
                  fontSize: 13,
                  fontWeight: '400',
                  lineHeight: 19,
                  marginTop: 8,
                  textAlign: 'center',
                }}
              >
                Daha sade ve hızlı akışa geçişin hazır.
              </Text>

              <View style={{ gap: 8, marginTop: 14 }}>
                <FeaturePill
                  icon="help-circle"
                  label="Sade ve premium yeni başlangıç"
                />
                <FeaturePill icon="shield" label="Güçlü hesap ve profil akışı" />
                <FeaturePill icon="zap" label="Hızlı geçişler ve akıcı animasyonlar" />
              </View>

              <Pressable
                onPress={requestClose}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.95 : 1,
                  transform: [{ scale: pressed ? 0.985 : 1 }],
                })}
              >
                <View
                  style={{
                    ...CTA_SHADOW,
                    alignItems: 'center',
                    backgroundColor: PRIMARY_CTA,
                    borderColor: '#111827',
                    borderRadius: 14,
                    borderWidth: 1,
                    flexDirection: 'row',
                    height: 46,
                    justifyContent: 'center',
                    marginTop: 14,
                    paddingHorizontal: 8,
                  }}
                >
                  <Text
                    allowFontScaling={false}
                    style={{
                      color: '#ffffff',
                      fontSize: 14,
                      fontWeight: '600',
                      letterSpacing: 0.2,
                    }}
                  >
                    Devam Et
                  </Text>

                  <View
                    style={{
                      alignItems: 'center',
                      backgroundColor: 'rgba(255,255,255,0.2)',
                      borderRadius: 12,
                      height: 24,
                      justifyContent: 'center',
                      marginLeft: 9,
                      width: 24,
                    }}
                  >
                    <FeatherIcon name="arrow-right" size={13} color="#ffffff" />
                  </View>
                </View>
              </Pressable>

              <Text
                allowFontScaling={false}
                style={{
                  color: '#94a3b8',
                  fontSize: 11,
                  fontWeight: '400',
                  lineHeight: 16,
                  marginTop: 10,
                  textAlign: 'center',
                }}
              >
                Hazırsan yeni akışla devam edelim.
              </Text>
            </View>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
