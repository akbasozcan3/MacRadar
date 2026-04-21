/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('../src/shell/AppShell/AppShell', () => {
  const ReactFactory = require('react');
  const { View } = require('react-native');

  function MockAppShell() {
    return ReactFactory.createElement(View);
  }

  return MockAppShell;
});

jest.mock('../src/components/LaunchOverlay/LaunchOverlay', () => {
  return function MockLaunchOverlay() {
    return null;
  };
});

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
