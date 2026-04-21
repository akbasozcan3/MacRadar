jest.mock(
  '@react-native-async-storage/async-storage',
  () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-keyboard-aware-scroll-view', () => {
  const React = require('react');
  const { ScrollView } = require('react-native');
  return {
    KeyboardAwareScrollView: React.forwardRef((props, ref) =>
      React.createElement(ScrollView, { ...props, ref }),
    ),
  };
});

jest.mock('@notifee/react-native', () => {
  const AuthorizationStatus = {
    AUTHORIZED: 1,
    DENIED: 0,
    PROVISIONAL: 2,
  };

  return {
    __esModule: true,
    AndroidImportance: {
      DEFAULT: 3,
      HIGH: 4,
    },
    AuthorizationStatus,
    EventType: {
      DELIVERED: 2,
      PRESS: 1,
    },
    default: {
      cancelNotification: jest.fn(async () => undefined),
      createChannel: jest.fn(async () => 'mock-channel'),
      displayNotification: jest.fn(async () => undefined),
      getNotificationSettings: jest.fn(async () => ({
        authorizationStatus: AuthorizationStatus.AUTHORIZED,
      })),
      onForegroundEvent: jest.fn(() => () => undefined),
      requestPermission: jest.fn(async () => ({
        authorizationStatus: AuthorizationStatus.AUTHORIZED,
      })),
    },
  };
});
