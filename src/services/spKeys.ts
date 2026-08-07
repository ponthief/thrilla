// Client-side Silent Payments key derivation.
//
// This lets the app generate a seed phrase and derive its keys ON DEVICE, so the
// plaintext mnemonic never leaves the phone and the server never sees it. It is
// a byte-for-byte reimplementation of the backend's derivation
// (siLNt/helpers/wallet.py: BIP-39 seed → BIP-32 at the BIP-352 paths →
// secp256k1 pubkeys → bech32m address), verified against server-generated test
// vectors on mainnet, signet, and with a passphrase. If you change anything
// here, re-run that cross-check before shipping — a mismatch means unrecoverable
// wallets.
//
// Built on the audited @scure / @noble primitives. `react-native-get-random-values`
// (imported in index.js) provides the CSPRNG that @scure/bip39 uses for entropy.
import { generateMnemonic as scureGenerate, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bech32m } from '@scure/base';

export interface SilentPaymentKeys {
  spAddress: string; // sp1…/tsp1… receive address
  scanSecret: string; // 32-byte scan private key, hex
  spendKey: string; // 32-byte spend private key, hex
}

// Silent Payments addresses are long (two compressed pubkeys), so bech32m's
// default 90-char limit must be raised.
const BECH32M_LIMIT = 1023;

function toHex(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
  return s;
}

// `react-native-get-random-values` substitutes Math.random() for
// crypto.getRandomValues in exactly one case: a __DEV__ build under remote JS
// debugging (Chrome), where synchronous native calls aren't available and no
// Expo secure module is present (see its isRemoteDebuggingInChrome). A wallet
// seed must NEVER come from Math.random(), so detect that exact case and refuse.
// Returns false on release builds, on-device dev, and in the browser — all of
// which have a real CSPRNG — so it never false-positives.
function secureRandomUnavailable(): boolean {
  const g = globalThis as any;
  if (g.expo?.modules?.ExpoCrypto?.getRandomValues) return false; // Expo secure path
  if ('RN$Bridgeless' in g && g.RN$Bridgeless === true) return false; // new arch: no remote-debug fallback
  const dev = typeof __DEV__ !== 'undefined' && (__DEV__ as unknown as boolean);
  return dev && typeof g.nativeCallSyncHook === 'undefined';
}

// A fresh 12-word (128-bit) BIP-39 mnemonic from the platform CSPRNG
// (@scure/bip39 → @noble randomBytes → crypto.getRandomValues → native
// SecureRandom). Hard-fails rather than ever producing a Math.random() seed.
export function generateMnemonic(): string {
  if (secureRandomUnavailable()) {
    throw new Error(
      'Secure random number generator unavailable — refusing to generate a ' +
        'wallet seed. (Remote JS debugging uses an insecure RNG; disable Chrome ' +
        'debugging or run a real build.)',
    );
  }
  return scureGenerate(wordlist, 128);
}

// True if `m` is a valid BIP-39 mnemonic (wordlist + checksum).
export function isValidMnemonic(m: string): boolean {
  return validateMnemonic(m.trim().toLowerCase(), wordlist);
}

// Derive the Silent Payments address + scan/spend private keys from a mnemonic.
// `network` picks the BIP-352 coin type + address HRP (mainnet → 0/'sp',
// otherwise → 1/'tsp'), matching the backend exactly.
export function deriveSilentPayment(
  mnemonic: string,
  passphrase: string,
  network: string,
): SilentPaymentKeys {
  const mn = mnemonic.trim().toLowerCase();
  const coin = network === 'mainnet' ? 0 : 1;
  const hrp = network === 'mainnet' ? 'sp' : 'tsp';

  const seed = mnemonicToSeedSync(mn, passphrase || '');
  // Version bytes only affect xprv string serialization, not derived child
  // private keys, so the default (mainnet) versions are fine for every network.
  const root = HDKey.fromMasterSeed(seed);

  const scanPriv = root.derive(`m/352'/${coin}'/0'/1'/0`).privateKey;
  const spendPriv = root.derive(`m/352'/${coin}'/0'/0'/0`).privateKey;
  if (!scanPriv || !spendPriv) {
    throw new Error('Key derivation failed.');
  }

  // Compressed pubkeys (33 bytes, 0x02/0x03 prefix) == the backend's serP(B).
  const scanPub = secp256k1.getPublicKey(scanPriv, true);
  const spendPub = secp256k1.getPublicKey(spendPriv, true);

  const payload = new Uint8Array(scanPub.length + spendPub.length);
  payload.set(scanPub, 0);
  payload.set(spendPub, scanPub.length);
  const words = [0, ...bech32m.toWords(payload)]; // version 0 ++ 8→5 bit payload
  const spAddress = bech32m.encode(hrp, words, BECH32M_LIMIT);

  return { spAddress, scanSecret: toHex(scanPriv), spendKey: toHex(spendPriv) };
}
