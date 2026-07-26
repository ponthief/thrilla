module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        root: ['./src'],
        alias: {
          '@': './src',
          '@stores': './src/stores',
          '@services': './src/services',
        },
      },
    ],
  ],
};
