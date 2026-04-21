import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import AppShell from '../src/shell/AppShell/AppShell';

type TabKey = 'home' | 'explore' | 'messages' | 'profile';

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
};

const mockRuntime = {
  loginProps: null as LoginProps | null,
  readStoredProfileCache: jest.fn(async () => null),
  readStoredSessionToken: jest.fn(async () => null),
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');

  return {
    __esModule: true,
    Easing: {
      bezier: () => 0,
    },
    default: {
      View,
    },
    interpolate: () => 0,
    useAnimatedStyle: () => ({}),
    useSharedValue: (initial: number) => ({ value: initial }),
    withTiming: (toValue: number) => toValue,
  };
});

jest.mock('../src/components/TabBar/TabBar', () => {
  const ReactFactory = require('react');
  const { Pressable, View, Text } = require('react-native');

  return function MockTabBar(props: {
    onActionPress: () => void;
    onTabPress: (tab: TabKey) => void;
  }) {
    return ReactFactory.createElement(
      View,
      { testID: 'tab-bar' },
      ReactFactory.createElement(
        Pressable,
        { onPress: () => props.onTabPress('home'), testID: 'tab-home' },
        ReactFactory.createElement(Text, null, 'home'),
      ),
      ReactFactory.createElement(
        Pressable,
        { onPress: () => props.onTabPress('explore'), testID: 'tab-explore' },
        ReactFactory.createElement(Text, null, 'explore'),
      ),
      ReactFactory.createElement(
        Pressable,
        { onPress: () => props.onTabPress('messages'), testID: 'tab-messages' },
        ReactFactory.createElement(Text, null, 'messages'),
      ),
      ReactFactory.createElement(
        Pressable,
        { onPress: () => props.onTabPress('profile'), testID: 'tab-profile' },
        ReactFactory.createElement(Text, null, 'profile'),
      ),
      ReactFactory.createElement(
        Pressable,
        { onPress: () => props.onActionPress(), testID: 'tab-action' },
        ReactFactory.createElement(Text, null, 'action'),
      ),
    );
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
  clearStoredProfileCache: jest.fn(async () => undefined),
  clearStoredSessionToken: jest.fn(async () => undefined),
  readStoredProfileCache: () => mockRuntime.readStoredProfileCache(),
  readStoredSessionToken: () => mockRuntime.readStoredSessionToken(),
  storeProfileCache: jest.fn(async () => undefined),
  storeSessionToken: jest.fn(async () => undefined),
}));

jest.mock('../src/services/apiClient', () => ({
  isApiRequestError: (error: unknown) =>
    Boolean(error && typeof error === 'object' && 'status' in error),
  setApiSessionToken: jest.fn(),
  setApiUnauthorizedHandler: jest.fn(),
}));

jest.mock('../src/i18n/runtime', () => ({
  getAppLanguage: () => 'tr',
  setAppLanguage: jest.fn(),
  subscribeAppLanguage: () => () => {},
  translateText: (value: string) => value,
}));

describe('AppShell tab navigation smoke', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRuntime.loginProps = null;
    mockRuntime.readStoredProfileCache.mockResolvedValue(null);
    mockRuntime.readStoredSessionToken.mockResolvedValue(null);
  });

  it('renders tabs and switches between core screens without crash', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<AppShell />);
    });

    const onAuthenticated = mockRuntime.loginProps?.onAuthenticated;
    expect(onAuthenticated).toBeDefined();

    await ReactTestRenderer.act(async () => {
      onAuthenticated?.({
        profile: {
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
        },
        session: { token: 'session_token_qa' },
      });
    });

    expect(
      renderer!.root.findAllByProps({ testID: 'home-screen' }).length,
    ).toBeGreaterThanOrEqual(1);

    const pressTab = async (testID: string, expectedScreen: string) => {
      const tabButton = renderer!.root.findByProps({ testID }) as ReactTestRenderer.ReactTestInstance;
      await ReactTestRenderer.act(async () => {
        tabButton.props.onPress();
      });
      expect(
        renderer!.root.findAllByProps({ testID: expectedScreen }).length,
      ).toBeGreaterThanOrEqual(1);
    };

    await pressTab('tab-messages', 'messages-screen');
    await pressTab('tab-profile', 'profile-screen');
    await pressTab('tab-home', 'home-screen');

    const cameraAction = renderer!.root.findByProps({
      testID: 'tab-action',
    }) as ReactTestRenderer.ReactTestInstance;
    await ReactTestRenderer.act(async () => {
      cameraAction.props.onPress();
    });

    expect(renderer!.root.findAllByProps({ testID: 'tab-bar' }).length).toBeGreaterThanOrEqual(1);

    await pressTab('tab-explore', 'explore-screen');
    expect(renderer!.root.findAllByProps({ testID: 'tab-bar' }).length).toBe(0);

    await ReactTestRenderer.act(async () => {
      renderer!.unmount();
    });
  });
});
