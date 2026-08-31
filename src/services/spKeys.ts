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
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { bech32, bech32m } from '@scure/base';

export interface SilentPaymentKeys {
  spAddress: string; // sp1…/tsp1… receive address
  scanSecret: string; // 32-byte scan private key, hex
  spendKey: string; // 32-byte spend private key, hex
  refundAddress: string; // bc1q…/tb1q… BIP-84 address, see deriveRefundAddress
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

// BIP-39 passphrase policy for NEW wallets. The passphrase is mandatory when
// *generating* a wallet: it's mixed into the seed and — unlike the mnemonic —
// cannot be recovered if forgotten. Import/recovery deliberately does NOT
// enforce this, so wallets created without a passphrase (legacy or external)
// can still be restored. The passphrase is used verbatim in derivation, so
// validate the raw string (no trimming — every character is significant).
export const PASSPHRASE_MIN_LENGTH = 12;

export function validateNewWalletPassphrase(passphrase: string): string | null {
  const pp = passphrase ?? '';
  if (pp.length < PASSPHRASE_MIN_LENGTH) {
    return `Passphrase must be at least ${PASSPHRASE_MIN_LENGTH} characters.`;
  }
  // Restrict to printable ASCII (space through ~). Non-ASCII characters
  // (accented letters, emoji, non-Latin scripts) require Unicode NFKD
  // normalization, which is NOT consistent across the mobile JS engine
  // (Hermes), the browser, and other BIP-39 tools — the same passphrase could
  // derive a different, unrecoverable wallet elsewhere (and Hermes throws on it
  // outright). ASCII is normalization-invariant, so it stays portable. Symbols
  // like ! ? # $ % are fine and encouraged.
  if (!/^[ -~]+$/.test(pp)) {
    return (
      'Passphrase can only use standard keyboard characters — letters, numbers, ' +
      'and symbols like ! ? # $ %. Remove any accented or non-English characters.'
    );
  }
  if (!/[a-zA-Z]/.test(pp) || !/[0-9]/.test(pp)) {
    return 'Passphrase must include both letters and numbers.';
  }
  return null;
}

// ── BIP-84 refund address ────────────────────────────────────────────────────
//
// A refund destination for a failed swap CANNOT be a Silent Payment address.
// BIP-352 only accepts P2TR key-path, P2WPKH, P2SH-P2WPKH and P2PKH inputs for
// shared-secret derivation, because the sender needs the private key behind
// each input to compute a·B_scan. A Boltz refund is a Taproot SCRIPT-path spend
// (siLNt/boltz_refund.py) whose output key is a MuSig2 aggregate — nobody holds
// a private key for it, so no silent payment can be constructed from it. The
// same is true of any script-encumbered output, so this is a property of the
// swap layer, not of Boltz.
//
// The refund therefore has to land on a plain address, and until now the user
// had to paste one in from some other wallet — a footgun on exactly the path
// that is already the risky one. Deriving it from the wallet's own seed makes
// the destination self-custodial with no extra backup: the standard BIP-84
// path means the same 12 words recover it in Electrum, Sparrow or any other
// wallet, not just Thrilla.
//
// Address reuse: index 0 is what gets derived and stored at wallet creation, so
// repeated refunds to the same wallet cluster on one address. That's an
// accepted trade-off — refunds only happen on failed swaps, and a stored
// address is what lets the field prefill without re-entering the seed. Callers
// that can track an index may pass one to spread refunds across addresses.

function hash160(b: Uint8Array): Uint8Array {
  return ripemd160(sha256(b));
}

// Segwit v0 human-readable part. Signet shares testnet's 'tb' (BIP-173).
function bech32Hrp(network: string): string {
  if (network === 'mainnet') return 'bc';
  if (network === 'regtest') return 'bcrt';
  return 'tb';
}

// BIP-84 external-chain path. Coin type matches the BIP-352 derivation above
// (mainnet → 0, every test network → 1).
export function refundDerivationPath(network: string, index = 0): string {
  const coin = network === 'mainnet' ? 0 : 1;
  return `m/84'/${coin}'/0'/0/${index}`;
}

function refundAddressFromRoot(root: HDKey, network: string, index: number): string {
  const priv = root.derive(refundDerivationPath(network, index)).privateKey;
  if (!priv) {
    throw new Error('Refund key derivation failed.');
  }
  const pub = secp256k1.getPublicKey(priv, true);
  // P2WPKH: witness version 0 ++ hash160(compressed pubkey), bech32 (not m).
  const words = [0, ...bech32.toWords(hash160(pub))];
  return bech32.encode(bech32Hrp(network), words);
}

// Standalone BIP-84 address derivation, for callers that hold a mnemonic but
// don't need the Silent Payments keys.
export function deriveRefundAddress(
  mnemonic: string,
  passphrase: string,
  network: string,
  index = 0,
): string {
  const seed = mnemonicToSeedSync(mnemonic.trim().toLowerCase(), passphrase || '');
  return refundAddressFromRoot(HDKey.fromMasterSeed(seed), network, index);
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

  return {
    spAddress,
    scanSecret: toHex(scanPriv),
    spendKey: toHex(spendPriv),
    refundAddress: refundAddressFromRoot(root, network, 0),
  };
}
