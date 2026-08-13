import * as Keychain from 'react-native-keychain';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
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
// PBKDF2 runs in pure JS on Hermes (no native crypto), so a huge iteration count
// blocks the UI for seconds. Keep it modest: the real protection is the hardware
// keystore, and a 6-digit PIN is only ~20 bits regardless — iterations add
// little. We also use the ASYNC pbkdf2 so it yields to the event loop and never
// freezes the screen.
const PBKDF2_ITERS = 2000;
// Records written before the iteration count was stored used this value. When a
// record has no `iters`, verify with this so an existing PIN keeps working.
const LEGACY_PBKDF2_ITERS = 120000;
const SALT_BYTES = 16;

export type PinKind = 'normal' | 'duress';

interface PinRecord {
  salt: string; // hex
  hash: string; // hex
  iters?: number; // iterations this hash was computed with (absent = legacy)
}
interface PinStore {
  normal: PinRecord;
  duress?: PinRecord | null;
}

const recordIters = (r: PinRecord) => r.iters ?? LEGACY_PBKDF2_ITERS;

// Async so it yields to the event loop (keeps the UI responsive on Hermes).
async function hashPin(
  pin: string,
  saltHex: string,
  iters: number,
): Promise<string> {
  const dk = await pbkdf2Async(sha256, utf8ToBytes(pin), hexToBytes(saltHex), {
    c: iters,
    dkLen: 32,
  });
  return bytesToHex(dk);
}

async function makeRecord(pin: string): Promise<PinRecord> {
  const saltHex = bytesToHex(randomBytes(SALT_BYTES));
  return {
    salt: saltHex,
    hash: await hashPin(pin, saltHex, PBKDF2_ITERS),
    iters: PBKDF2_ITERS,
  };
}

// Verify `pin` against a stored record using the iterations it was made with.
async function matches(pin: string, r: PinRecord): Promise<boolean> {
  return (await hashPin(pin, r.salt, recordIters(r))) === r.hash;
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
  s.normal = await makeRecord(pin);
  return write(s);
}

// Set or clear the duress PIN (pass null to remove). Requires a normal PIN, and
// the duress PIN must differ from the normal one.
export async function setDuressPin(pin: string | null): Promise<boolean> {
  const s = await read();
  if (!s?.normal) return false;
  if (pin && (await matches(pin, s.normal))) return false; // must differ
  s.duress = pin ? await makeRecord(pin) : null;
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

// Which PIN was entered, or null if neither. Normal is checked first so the
// common unlock only computes one hash; the two PINs are enforced distinct at
// set time, so order doesn't affect correctness. Verifies each record with the
// iteration count it was created with, so changing PBKDF2_ITERS never
// invalidates an existing PIN.
export async function verifyPin(pin: string): Promise<PinKind | null> {
  const s = await read();
  if (!s?.normal) return null;
  if (await matches(pin, s.normal)) {
    // Transparently re-hash a legacy (slow) record to the current parameters on
    // a successful unlock, so it's fast next time.
    if (recordIters(s.normal) !== PBKDF2_ITERS) {
      try {
        s.normal = await makeRecord(pin);
        await write(s);
      } catch {
        /* upgrade is best-effort */
      }
    }
    return 'normal';
  }
  if (s.duress && (await matches(pin, s.duress))) return 'duress';
  return null;
}
