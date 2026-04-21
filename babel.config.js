module.exports = function babelConfig(api) {
  const isTest = api.env('test');

  return {
    presets: [
      'module:@react-native/babel-preset',
      !isTest && 'nativewind/babel',
    ].filter(Boolean),
    plugins: ['react-native-worklets/plugin'],
  };
};
