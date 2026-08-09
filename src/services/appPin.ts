import * as Keychain from 'react-native-keychain';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import {
  bytesToHex,
  hexToBytes,
  randomBytes,
  utf8ToBytes,
} from '@noble/hashes/utils';

// In-app numeric PIN with an optional DURESS PIN.
//
// The device biometric/passcode lock (appLock.ts) can't power duress: the OS
// never tells the app which credential unlocked, so there's no way to react to a
// "duress fingerprint". This module stores app-checked PINs instead. Two PINs:
//  - normal  → unlock as usual
//  - duress  → looks identical, but the caller wipes local wallet keys first
// PINs are never stored in plaintext — only a PBKDF2-SHA256 salted hash, in the
// platform keystore.

const PIN_SERVICE = 'com.thrilla.pin';
const PBKDF2_ITERS = 120000;
const SALT_BYTES = 16;

export type PinKind = 'normal' | 'duress';

interface PinRecord {
  salt: string; // hex
  hash: string; // hex
}
interface PinStore {
  normal: PinRecord;
  duress?: PinRecord | null;
}

function hashPin(pin: string, saltHex: string): string {
  const dk = pbkdf2(sha256, utf8ToBytes(pin), hexToBytes(saltHex), {
    c: PBKDF2_ITERS,
    dkLen: 32,
  });
  return bytesToHex(dk);
}

function makeRecord(pin: string): PinRecord {
  const saltHex = bytesToHex(randomBytes(SALT_BYTES));
  return { salt: saltHex, hash: hashPin(pin, saltHex) };
}

async function read(): Promise<PinStore | null> {
  try {
    const c = await Keychain.getGenericPassword({ service: PIN_SERVICE });
    if (!c) return null;
    const parsed = JSON.parse(c.password);
    if (parsed?.normal?.salt && parsed?.normal?.hash) return parsed as PinStore;
    return null;
  } catch {
    return null;
  }
}

async function write(store: PinStore): Promise<boolean> {
  try {
    await Keychain.setGenericPassword('pin', JSON.stringify(store), {
      service: PIN_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
    return true;
  } catch {
    return false;
  }
}

export async function hasPin(): Promise<boolean> {
  return (await read()) != null;
}

export async function hasDuressPin(): Promise<boolean> {
  const s = await read();
  return !!s?.duress;
}

// Set (or change) the normal unlock PIN. Preserves any existing duress PIN.
export async function setPin(pin: string): Promise<boolean> {
  const s = (await read()) || ({} as PinStore);
  s.normal = makeRecord(pin);
  return write(s);
}

// Set or clear the duress PIN (pass null to remove). Requires a normal PIN, and
// the duress PIN must differ from the normal one.
export async function setDuressPin(pin: string | null): Promise<boolean> {
  const s = await read();
  if (!s?.normal) return false;
  if (pin && hashPin(pin, s.normal.salt) === s.normal.hash) return false; // must differ
  s.duress = pin ? makeRecord(pin) : null;
  return write(s);
}

// Remove all PINs (turns the PIN lock off).
export async function clearPins(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: PIN_SERVICE });
  } catch {
    /* ignore */
  }
}

// Which PIN was entered, or null if neither. Duress is checked first so it can
// never be shadowed by the normal PIN.
export async function verifyPin(pin: string): Promise<PinKind | null> {
  const s = await read();
  if (!s?.normal) return null;
  if (s.duress && hashPin(pin, s.duress.salt) === s.duress.hash) return 'duress';
  if (hashPin(pin, s.normal.salt) === s.normal.hash) return 'normal';
  return null;
}
