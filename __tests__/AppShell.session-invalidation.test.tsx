import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import AppShell from '../src/shell/AppShell/AppShell';

type LoginProps = {
  onAuthenticated: (response: {
    session: { token: string };
    profile: {
      id: string;
      email: string;
      fullName: string;
      username: string;
      stats: {
        followersCount: number;
        followingCount: number;
        routesCount: number;
        streetFriendsCount: number;
      };
    };
  }) => void;
  safeBottom: number;
  safeTop: number;
};

type UnauthorizedErrorLike = {
  code?: string;
  status?: number;
};

const mockRuntime = {
  clearStoredProfileCache: jest.fn(async () => undefined),
  clearStoredSessionToken: jest.fn(async () => undefined),
  loginProps: null as LoginProps | null,
  readStoredProfileCache: jest.fn(async () => null),
  readStoredSessionToken: jest.fn(async () => null),
  setApiSessionToken: jest.fn((_token: string | null) => undefined),
  storeProfileCache: jest.fn(async (_profile: unknown) => undefined),
  storeSessionToken: jest.fn(async (_token: string) => undefined),
  unauthorizedHandler: null as ((error: UnauthorizedErrorLike) => void) | null,
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');

  return {
    __esModule: true,
    Easing: {
      bezier: () => {
        return 0;
      },
    },
    default: {
      View,
    },
    interpolate: () => {
      return 0;
    },
    useAnimatedStyle: () => ({}),
    useSharedValue: (initial: number) => ({ value: initial }),
    withTiming: (toValue: number) => toValue,
  };
});

jest.mock('../src/components/TabBar/TabBar', () => {
  const ReactFactory = require('react');
  const { View } = require('react-native');

  return function MockTabBar() {
    return ReactFactory.createElement(View, { testID: 'tab-bar' });
  };
});

jest.mock('../src/screens/HomeScreen/HomeScreen', () => {
  const ReactFactory = require('react');
  const { View } = require('react-native');

  return function MockHomeScreen() {
    return ReactFactory.createElement(View, { testID: 'home-screen' });
  };
});

jest.mock('../src/screens/ExploreScreen/ExploreScreen', () => {
  const ReactFactory = require('react');
  const { View } = require('react-native');

  return function MockExploreScreen() {
    return ReactFactory.createElement(View, { testID: 'explore-screen' });
  };
});

jest.mock('../src/screens/MessagesScreen/MessagesScreen', () => {
  const ReactFactory = require('react');
  const { View } = require('react-native');

  return function MockMessagesScreen() {
    return ReactFactory.createElement(View, { testID: 'messages-screen' });
  };
});

jest.mock('../src/screens/ProfileScreen/ProfileScreen', () => {
  const ReactFactory = require('react');
  const { View } = require('react-native');

  return function MockProfileScreen() {
    return ReactFactory.createElement(View, { testID: 'profile-screen' });
  };
});

jest.mock('../src/screens/Login/Login', () => {
  const ReactFactory = require('react');
  const { View } = require('react-native');

  return function MockLogin(props: LoginProps) {
    mockRuntime.loginProps = props;
    return ReactFactory.createElement(View, { testID: 'login-screen' });
  };
});

jest.mock('../src/shell/AppShell/LoginWelcomeModal', () => {
  return function MockLoginWelcomeModal() {
    return null;
  };
});

jest.mock('../src/services/profileMediaService', () => ({
  addCapturedPost: jest.fn(async () => undefined),
}));

jest.mock('../src/services/haptics', () => ({
  triggerSelectionHaptic: jest.fn(),
}));

jest.mock('../src/services/authService', () => ({
  confirmPasswordReset: jest.fn(async () => ({ message: 'ok' })),
  createMyProfilePost: jest.fn(async () => ({ id: 'post_1' })),
  fetchMyProfile: jest.fn(async () => ({
    email: 'test@example.com',
    id: 'user_1',
    stats: {
      followersCount: 0,
      followingCount: 0,
      routesCount: 0,
      streetFriendsCount: 0,
    },
    username: 'tester',
  })),
  fetchProfileAppSettings: jest.fn(async () => ({ language: 'tr' })),
  fetchProfileRequestSummary: jest.fn(async () => ({
    followRequestsCount: 0,
    messagesUnreadCount: 0,
    streetRequestsCount: 0,
  })),
  requestPasswordReset: jest.fn(async () => ({ email: 'test@example.com', message: 'ok' })),
}));

jest.mock('../src/services/sessionStorage', () => ({
  clearStoredProfileCache: () => mockRuntime.clearStoredProfileCache(),
  clearStoredSessionToken: () => mockRuntime.clearStoredSessionToken(),
  readStoredProfileCache: () => mockRuntime.readStoredProfileCache(),
  readStoredSessionToken: () => mockRuntime.readStoredSessionToken(),
  storeProfileCache: (profile: unknown) => mockRuntime.storeProfileCache(profile),
  storeSessionToken: (token: string) => mockRuntime.storeSessionToken(token),
}));

jest.mock('../src/services/apiClient', () => ({
  isApiRequestError: (error: unknown) => {
    return Boolean(
      error &&
        typeof error === 'object' &&
        ('status' in error || 'code' in error),
    );
  },
  setApiSessionToken: (token: string | null) => mockRuntime.setApiSessionToken(token),
  setApiUnauthorizedHandler: (
    handler: ((error: UnauthorizedErrorLike) => void) | null,
  ) => {
    mockRuntime.unauthorizedHandler = handler;
  },
}));

jest.mock('../src/i18n/runtime', () => ({
  getAppLanguage: () => 'tr',
  setAppLanguage: jest.fn(),
  subscribeAppLanguage: () => () => {},
  translateText: (value: string) => value,
}));

describe('AppShell session invalidation handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRuntime.loginProps = null;
    mockRuntime.unauthorizedHandler = null;
    mockRuntime.readStoredProfileCache.mockResolvedValue(null);
    mockRuntime.readStoredSessionToken.mockResolvedValue(null);
  });

  it('returns to login and clears session state on unauthorized callback', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<AppShell />);
    });

    expect(mockRuntime.loginProps).not.toBeNull();
    expect(
      renderer!.root.findAllByProps({ testID: 'login-screen' }).length,
    ).toBeGreaterThanOrEqual(1);

    const profile = {
      email: 'qa@example.com',
      fullName: 'QA User',
      id: 'user_qa',
      stats: {
        followersCount: 3,
        followingCount: 5,
        routesCount: 1,
        streetFriendsCount: 2,
      },
      username: 'qauser',
    };
    const onAuthenticated = mockRuntime.loginProps?.onAuthenticated;
    expect(onAuthenticated).toBeDefined();

    await ReactTestRenderer.act(async () => {
      onAuthenticated?.({
        profile,
        session: { token: 'session_token_qa' },
      });
    });

    expect(
      renderer!.root.findAllByProps({ testID: 'home-screen' }).length,
    ).toBeGreaterThanOrEqual(1);

    expect(mockRuntime.unauthorizedHandler).not.toBeNull();
    ReactTestRenderer.act(() => {
      mockRuntime.unauthorizedHandler?.({
        code: 'unauthorized',
        status: 401,
      });
    });

    expect(
      renderer!.root.findAllByProps({ testID: 'login-screen' }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(mockRuntime.clearStoredSessionToken).toHaveBeenCalled();
    expect(mockRuntime.clearStoredProfileCache).toHaveBeenCalled();
    expect(mockRuntime.setApiSessionToken).toHaveBeenCalledWith(null);
  });
});
