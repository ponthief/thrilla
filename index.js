// Must be first: polyfills global.crypto.getRandomValues so crypto-js (used for
// mnemonic import/recover) has a secure RNG. crypto-js resolves its RNG at module
// load, so this has to run before any module that imports crypto-js.
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import App from './src/App';

// Required by react-native-firebase when a message arrives while the app is in
// the background/quit. Notification-type messages (what the server sends) are
// displayed by Android automatically, so there's nothing to do here — but the
// handler must be registered. Guarded so a missing/misconfigured Firebase setup
// can't crash startup.
try {
  messaging().setBackgroundMessageHandler(async () => {});
} catch {}

AppRegistry.registerComponent('Thrilla', () => App);
