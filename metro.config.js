const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ignoredFolders = [
  '.codex-bundle-check',
  '.git',
  '.gocache',
  '.gomodcache',
  '.gradle-local',
  'backend',
  'build',
  'docs',
];

const blockList = ignoredFolders.map(folder => {
  const absolute = path.resolve(__dirname, folder);
  return new RegExp(`${escapeRegExp(absolute)}[/\\\\].*`);
});

const config = {
  resolver: {
    blockList,
    // Metro defaults to Watchman, but Windows dev environments here do not
    // have it installed, which causes watch mode startup to hang and bundle
    // requests to fail with a 500.
    useWatchman: process.platform !== 'win32',
  },
};
const metroConfig = mergeConfig(getDefaultConfig(__dirname), config);

module.exports = withNativeWind(metroConfig, { input: './global.css' });
