// Must be first: polyfills global.crypto.getRandomValues so crypto-js (used for
// mnemonic import/recover) has a secure RNG. crypto-js resolves its RNG at module
// load, so this has to run before any module that imports crypto-js.
import 'react-native-get-random-values';
// @noble/hashes (used by @scure/bip39's pbkdf2) converts the mnemonic/passphrase
// to bytes with `new TextEncoder().encode(...)`, and Hermes has no global
// TextEncoder/TextDecoder. This installs spec-compliant ones. Must run before any
// key derivation. (UTF-8 encoding is deterministic, so this matches the browser
// and backend byte-for-byte.)
import 'text-encoding-polyfill';
// @scure/bip39 derives the BIP-39 seed via ('mnemonic'+passphrase).normalize('NFKD').
// Hermes' String.prototype.normalize is unreliable — it throws on many inputs —
// which surfaced as "Could not derive wallet keys" once wallets require a
// passphrase. Replace normalize with unorm's spec-compliant implementation so
// on-device derivation always works and matches the browser and Python backend
// byte-for-byte. Must run before any key derivation (which only happens on user
// action, well after startup), so placing it here is early enough.
import unorm from 'unorm';
import { AppRegistry } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import App from './src/App';

{
  const forms = {
    NFC: unorm.nfc,
    NFD: unorm.nfd,
    NFKC: unorm.nfkc,
    NFKD: unorm.nfkd,
  };
  // eslint-disable-next-line no-extend-native
  String.prototype.normalize = function normalize(form) {
    const fn = forms[form === undefined ? 'NFC' : form];
    if (!fn) {
      throw new RangeError('String.prototype.normalize: invalid form ' + form);
    }
    return fn(String(this));
  };
}

// Required by react-native-firebase when a message arrives while the app is in
// the background/quit, and deliberately empty. The server sends payment pushes
// as data-only messages, and android/.../notify/PaymentNotificationReceiver.kt
// displays them natively — no JavaScript involved, so a notification costs no
// React Native startup with the app closed. Doing it here instead would mean
// booting the JS runtime for every push, and would need a second library to
// post the notification at all. The handler is still registered because the
// library logs an error without one. Guarded so a missing/misconfigured
// Firebase setup can't crash startup.
try {
  messaging().setBackgroundMessageHandler(async () => {});
} catch {}

AppRegistry.registerComponent('Thrilla', () => App);
