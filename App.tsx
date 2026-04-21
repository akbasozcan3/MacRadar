import React, { useCallback, useEffect, useReducer, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AlertProvider } from './src/alerts/AlertProvider';
import LaunchOverlay from './src/components/LaunchOverlay/LaunchOverlay';
import { subscribeAppLanguage } from './src/i18n/runtime';
import { bootstrapNotifications } from './src/services/notificationService';
import AppShell from './src/shell/AppShell/AppShell';
import { installGlobalTypography } from './src/theme/typography';

installGlobalTypography();
const SHOULD_DEFER_APP_SHELL_MOUNT =
  (
    globalThis as typeof globalThis & {
      process?: { env?: { NODE_ENV?: string } };
    }
  ).process?.env?.NODE_ENV !== 'test';

function App() {
  const [launchComplete, setLaunchComplete] = useState(false);
  const [mountAppShell, setMountAppShell] = useState(
    !SHOULD_DEFER_APP_SHELL_MOUNT,
  );
  const [, forceI18nRerender] = useReducer((value: number) => value + 1, 0);
  const appBackgroundStyle = styles.appBackgroundDark;

  useEffect(() => {
    return subscribeAppLanguage(() => {
      forceI18nRerender();
    });
  }, []);

  useEffect(() => {
    bootstrapNotifications().catch(() => {
      return;
    });
  }, []);

  const handleLaunchFinish = useCallback(() => {
    if (SHOULD_DEFER_APP_SHELL_MOUNT) {
      setMountAppShell(true);
    }
    setLaunchComplete(true);
  }, []);

  return (
    <SafeAreaProvider>
      <AlertProvider>
        <StatusBar
          barStyle="dark-content"
          backgroundColor="#ffffff"
          translucent={false}
        />
        <View style={[styles.appContainer, appBackgroundStyle]}>
          <View
            pointerEvents={launchComplete ? 'auto' : 'none'}
            style={[
              styles.appShellHost,
              !launchComplete ? styles.appShellHostHidden : null,
            ]}
          >
            {mountAppShell ? <AppShell /> : null}
          </View>
          {!launchComplete ? (
            <LaunchOverlay onFinish={handleLaunchFinish} />
          ) : null}
        </View>
      </AlertProvider>
    </SafeAreaProvider>
  );
}

export default App;

const styles = StyleSheet.create({
  appBackgroundDark: {
    backgroundColor: '#000000',
  },
  appContainer: {
    flex: 1,
  },
  appShellHost: {
    flex: 1,
  },
  appShellHostHidden: {
    opacity: 0,
  },
});
