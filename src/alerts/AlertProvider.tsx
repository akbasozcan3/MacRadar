import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert as NativeAlert,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { translateText } from '../i18n/runtime';
import { Text } from '../theme/typography';

export type AlertTone = 'danger' | 'info' | 'success' | 'warning';
export type AlertActionStyle = 'cancel' | 'default' | 'destructive';

export type AlertDialogAction<TValue extends string = string> = {
  key: TValue;
  label: string;
  style?: AlertActionStyle;
};

export type AlertDialogOptions<TValue extends string = string> = {
  actions: readonly AlertDialogAction<TValue>[];
  message: string;
  title?: string;
};

export type AlertToastOptions = {
  durationMs?: number;
  message: string;
  title?: string;
  tone?: AlertTone;
};

type AlertConfirmOptions = {
  cancelLabel?: string;
  confirmLabel?: string;
  message: string;
  title?: string;
  tone?: Extract<AlertTone, 'danger' | 'warning'>;
};

type AlertContextValue = {
  confirm: (options: AlertConfirmOptions) => Promise<boolean>;
  showDialog: <TValue extends string = string>(
    options: AlertDialogOptions<TValue>,
  ) => Promise<TValue | null>;
  showToast: (options: AlertToastOptions) => void;
};

type QueuedDialog = {
  options: AlertDialogOptions<string>;
  resolve: (value: string | null) => void;
};

const DEFAULT_TOAST_DURATION_MS = 2600;
const ALERT_DIALOG_CANCEL_KEY = '__cancel__';
const ALERT_DIALOG_CONFIRM_KEY = '__confirm__';
let didWarnMissingAlertProvider = false;

const AlertContext = createContext<AlertContextValue | null>(null);

function translate(value?: string) {
  if (!value) {
    return '';
  }
  return translateText(value);
}

function resolveToastAccentColor(tone: AlertTone) {
  switch (tone) {
    case 'danger':
      return '#f43f5e';
    case 'success':
      return '#10b981';
    case 'warning':
      return '#f59e0b';
    default:
      return '#3b82f6';
  }
}

function resolveActionTextStyle(style: AlertActionStyle | undefined) {
  if (style === 'destructive') {
    return styles.dialogActionTextDestructive;
  }
  if (style === 'cancel') {
    return styles.dialogActionTextCancel;
  }
  return styles.dialogActionTextDefault;
}

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [activeToast, setActiveToast] = useState<AlertToastOptions | null>(null);
  const [activeDialog, setActiveDialog] = useState<QueuedDialog | null>(null);
  const toastQueueRef = useRef<AlertToastOptions[]>([]);
  const dialogQueueRef = useRef<QueuedDialog[]>([]);
  const toastDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTranslateY = useRef(new Animated.Value(-14)).current;

  const showNextDialog = useCallback(() => {
    setActiveDialog(previous => {
      if (previous) {
        return previous;
      }
      return dialogQueueRef.current.shift() ?? null;
    });
  }, []);

  const showDialog = useCallback(
    <TValue extends string = string,>(
      options: AlertDialogOptions<TValue>,
    ): Promise<TValue | null> => {
      return new Promise(resolve => {
        dialogQueueRef.current.push({
          options: {
            ...options,
            actions: options.actions as readonly AlertDialogAction<string>[],
          },
          resolve: value => {
            resolve((value as TValue | null) ?? null);
          },
        });
        showNextDialog();
      });
    },
    [showNextDialog],
  );

  const confirm = useCallback(
    async (options: AlertConfirmOptions) => {
      const result = await showDialog({
        actions: [
          {
            key: ALERT_DIALOG_CANCEL_KEY,
            label: options.cancelLabel ?? 'Vazgeç',
            style: 'cancel',
          },
          {
            key: ALERT_DIALOG_CONFIRM_KEY,
            label: options.confirmLabel ?? 'Onayla',
            style: options.tone === 'danger' ? 'destructive' : 'default',
          },
        ],
        message: options.message,
        title: options.title,
      });
      return result === ALERT_DIALOG_CONFIRM_KEY;
    },
    [showDialog],
  );

  const showNextToast = useCallback(() => {
    setActiveToast(previous => {
      if (previous) {
        return previous;
      }
      return toastQueueRef.current.shift() ?? null;
    });
  }, []);

  const showToast = useCallback(
    (options: AlertToastOptions) => {
      toastQueueRef.current.push(options);
      showNextToast();
    },
    [showNextToast],
  );

  useEffect(() => {
    if (!activeToast) {
      if (toastQueueRef.current.length > 0) {
        showNextToast();
      }
      return;
    }

    const durationMs = Math.max(
      1200,
      Number(activeToast.durationMs ?? DEFAULT_TOAST_DURATION_MS),
    );
    toastOpacity.setValue(0);
    toastTranslateY.setValue(-14);
    Animated.parallel([
      Animated.timing(toastOpacity, {
        duration: 160,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(toastTranslateY, {
        duration: 190,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start();

    toastDismissTimerRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(toastOpacity, {
          duration: 140,
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.timing(toastTranslateY, {
          duration: 160,
          toValue: -10,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setActiveToast(null);
      });
      toastDismissTimerRef.current = null;
    }, durationMs);

    return () => {
      if (toastDismissTimerRef.current) {
        clearTimeout(toastDismissTimerRef.current);
        toastDismissTimerRef.current = null;
      }
    };
  }, [activeToast, showNextToast, toastOpacity, toastTranslateY]);

  useEffect(() => {
    return () => {
      if (toastDismissTimerRef.current) {
        clearTimeout(toastDismissTimerRef.current);
        toastDismissTimerRef.current = null;
      }
    };
  }, []);

  const dismissDialog = useCallback(
    (value: string | null) => {
      setActiveDialog(previous => {
        if (!previous) {
          return previous;
        }
        previous.resolve(value);
        return null;
      });
      setTimeout(() => {
        showNextDialog();
      }, 0);
    },
    [showNextDialog],
  );

  const contextValue = useMemo<AlertContextValue>(
    () => ({
      confirm,
      showDialog,
      showToast,
    }),
    [confirm, showDialog, showToast],
  );

  const translatedToastTitle = translate(activeToast?.title);
  const translatedToastMessage = translate(activeToast?.message);
  const toastTone = activeToast?.tone ?? 'info';
  const activeDialogOptions = activeDialog?.options ?? null;

  return (
    <AlertContext.Provider value={contextValue}>
      {children}
      {activeToast ? (
        <View pointerEvents="none" style={[styles.toastWrap, { top: insets.top + 12 }]}>
          <Animated.View
            style={[
              styles.toastCard,
              {
                opacity: toastOpacity,
                transform: [{ translateY: toastTranslateY }],
              },
            ]}
          >
            <View
              style={[
                styles.toastAccent,
                { backgroundColor: resolveToastAccentColor(toastTone) },
              ]}
            />
            <View style={styles.toastContent}>
              {translatedToastTitle.length > 0 ? (
                <Text allowFontScaling={false} style={styles.toastTitle}>
                  {translatedToastTitle}
                </Text>
              ) : null}
              <Text allowFontScaling={false} style={styles.toastMessage}>
                {translatedToastMessage}
              </Text>
            </View>
          </Animated.View>
        </View>
      ) : null}
      <Modal
        animationType="fade"
        onRequestClose={() => {
          dismissDialog(null);
        }}
        statusBarTranslucent={true}
        transparent={true}
        visible={Boolean(activeDialogOptions)}
      >
        <View style={styles.dialogRoot}>
          <Pressable
            onPress={() => {
              dismissDialog(null);
            }}
            style={styles.dialogBackdrop}
          />
          <View style={[styles.dialogCard, { marginBottom: Math.max(insets.bottom, 12) }]}>
            {activeDialogOptions?.title ? (
              <Text allowFontScaling={false} style={styles.dialogTitle}>
                {translate(activeDialogOptions.title)}
              </Text>
            ) : null}
            <Text allowFontScaling={false} style={styles.dialogMessage}>
              {translate(activeDialogOptions?.message)}
            </Text>
            <View style={styles.dialogActions}>
              {activeDialogOptions?.actions.map(action => (
                <Pressable
                  key={action.key}
                  onPress={() => {
                    dismissDialog(action.key);
                  }}
                  style={({ pressed }) => [
                    styles.dialogActionButton,
                    pressed ? styles.dialogActionButtonPressed : null,
                  ]}
                >
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.dialogActionTextBase,
                      resolveActionTextStyle(action.style),
                    ]}
                  >
                    {translate(action.label)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </AlertContext.Provider>
  );
}

export function useAlert() {
  const context = useContext(AlertContext);
  if (context) {
    return context;
  }

  if (__DEV__ && !didWarnMissingAlertProvider) {
    didWarnMissingAlertProvider = true;
    console.warn('useAlert fallback activated: AlertProvider is missing.');
  }

  const fallback: AlertContextValue = {
    confirm: async (options: AlertConfirmOptions) =>
      await new Promise<boolean>(resolve => {
        NativeAlert.alert(
          translate(options.title || 'Onay'),
          translate(options.message),
          [
            {
              style: 'cancel',
              text: translate(options.cancelLabel || 'Vazgeç'),
              onPress: () => resolve(false),
            },
            {
              style: options.tone === 'danger' ? 'destructive' : 'default',
              text: translate(options.confirmLabel || 'Onayla'),
              onPress: () => resolve(true),
            },
          ],
          {
            cancelable: true,
            onDismiss: () => resolve(false),
          },
        );
      }),
    showDialog: async <TValue extends string = string,>(
      options: AlertDialogOptions<TValue>,
    ) =>
      await new Promise<TValue | null>(resolve => {
        const actions = options.actions || [];
        const mapped = actions.slice(0, 3).map(action => {
          const style: 'default' | 'cancel' | 'destructive' =
            action.style === 'cancel'
              ? 'cancel'
              : action.style === 'destructive'
                ? 'destructive'
                : 'default';
          return {
            text: translate(action.label),
            style,
            onPress: () => resolve(action.key as TValue),
          };
        });
        NativeAlert.alert(
          translate(options.title || 'Bilgi'),
          translate(options.message),
          mapped.length > 0 ? mapped : [{ text: 'Tamam', onPress: () => resolve(null) }],
          { cancelable: true, onDismiss: () => resolve(null) },
        );
      }),
    showToast: (options: AlertToastOptions) => {
      NativeAlert.alert(
        translate(options.title || 'Bilgi'),
        translate(options.message),
      );
    },
  };
  return fallback;
}

const styles = StyleSheet.create({
  dialogActionButton: {
    borderColor: '#e2e8f0',
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 42,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  dialogActionButtonPressed: {
    backgroundColor: '#f8fafc',
  },
  dialogActionTextBase: {
    fontSize: 14,
    fontWeight: '600',
  },
  dialogActionTextCancel: {
    color: '#475569',
  },
  dialogActionTextDefault: {
    color: '#0f172a',
  },
  dialogActionTextDestructive: {
    color: '#be123c',
  },
  dialogActions: {
    marginTop: 12,
    rowGap: 8,
  },
  dialogBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.36)',
  },
  dialogCard: {
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dbe3ef',
    borderRadius: 14,
    borderWidth: 1,
    maxWidth: 360,
    paddingHorizontal: 14,
    paddingVertical: 14,
    width: '92%',
  },
  dialogMessage: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 20,
  },
  dialogRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 10,
  },
  dialogTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  toastAccent: {
    alignSelf: 'stretch',
    borderRadius: 2,
    width: 3,
  },
  toastCard: {
    alignItems: 'stretch',
    backgroundColor: '#0f172a',
    borderColor: 'rgba(148, 163, 184, 0.3)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    marginHorizontal: 12,
    maxWidth: 460,
    minHeight: 52,
    overflow: 'hidden',
    shadowColor: '#020617',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 12,
  },
  toastContent: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  toastMessage: {
    color: '#e2e8f0',
    fontSize: 13,
    lineHeight: 18,
  },
  toastTitle: {
    color: '#f8fafc',
    fontSize: 13.5,
    fontWeight: '700',
    marginBottom: 2,
  },
  toastWrap: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 9999,
  },
});
