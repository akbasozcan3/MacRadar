import { NativeModules, Platform, Vibration } from 'react-native';

type MaybeHapticModule = {
  impact?: (style: string) => void;
  selection?: () => void;
  trigger?: (
    event: string,
    options?: {
      enableVibrateFallback?: boolean;
      ignoreAndroidSystemSettings?: boolean;
    },
  ) => void;
};

function resolveNativeHapticModule() {
  const modules = NativeModules as Record<string, MaybeHapticModule | undefined>;
  return (
    modules.RNReactNativeHapticFeedback ||
    modules.ReactNativeHapticFeedback ||
    modules.Haptics ||
    null
  );
}

export function triggerSelectionHaptic() {
  try {
    const nativeModule = resolveNativeHapticModule();

    if (nativeModule) {
      if (typeof nativeModule.selection === 'function') {
        nativeModule.selection();
        return;
      }

      if (typeof nativeModule.trigger === 'function') {
        nativeModule.trigger('selection', {
          enableVibrateFallback: false,
          ignoreAndroidSystemSettings: false,
        });
        return;
      }

      if (typeof nativeModule.impact === 'function') {
        nativeModule.impact('light');
        return;
      }
    }

    // Keep fallback minimal to avoid strong vibration feel.
    if (Platform.OS === 'android') {
      Vibration.vibrate(8);
    }
  } catch {
    return;
  }
}

export function triggerImpactHaptic(style: 'light' | 'medium' | 'heavy' | 'soft' | 'rigid' = 'light') {
  try {
    const nativeModule = resolveNativeHapticModule();

    if (nativeModule) {
      if (typeof nativeModule.impact === 'function') {
        nativeModule.impact(style);
        return;
      }

      if (typeof nativeModule.trigger === 'function') {
        nativeModule.trigger(`impact${style.charAt(0).toUpperCase()}${style.slice(1)}`, {
          enableVibrateFallback: false,
          ignoreAndroidSystemSettings: false,
        });
        return;
      }
    }

    // Fallback for impact
    if (Platform.OS === 'android') {
      const duration = style === 'heavy' ? 24 : style === 'medium' ? 16 : 8;
      Vibration.vibrate(duration);
    }
  } catch {
    return;
  }
}
