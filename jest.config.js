module.exports = {
  moduleNameMapper: {
    '^nativewind$': '<rootDir>/__mocks__/nativewind.js',
  },
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
};
