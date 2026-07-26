// Must be first: polyfills global.crypto.getRandomValues so crypto-js (used for
// mnemonic import/recover) has a secure RNG. crypto-js resolves its RNG at module
// load, so this has to run before any module that imports crypto-js.
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './src/App';

AppRegistry.registerComponent('Thrilla', () => App);
