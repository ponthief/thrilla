import { Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';

// Biometric / device-PIN app lock. Complements device-trust: it re-checks the
// person holding the phone (fingerprint / Face / device passcode) when the app
// comes back to the foreground, so an unlocked-but-unattended phone doesn't
// expose an active session.
//
// Implemented entirely on react-native-keychain (already a dependency): we store
// a sentinel item guarded by the device's biometric/credential access control.
// Reading it forces the OS unlock prompt — success means the user authenticated.
// A separate, non-guarded pref item records whether the lock is enabled.

const LOCK_SERVICE = 'com.thrilla.applock'; // biometric-gated sentinel
const PREF_SERVICE = 'com.thrilla.applock.pref'; // plain on/off flag
const SENTINEL = 'thrilla-app-lock';

// Which key spec this device's sentinel was created under.
//
// '2' means the keystore key requires an authentication for EVERY use.
// Absent, or anything else, means it was created while react-native-keychain
// still asked for a FIVE-SECOND window — see patches/, and rebuildSentinel
// below for how one of those is replaced.
const KEY_VERSION_SERVICE = 'com.thrilla.applock.keyver';
const KEY_VERSION = '2';

// What kind of biometry the device offers (null = none enrolled). Device PIN is
// still usable as a fallback even when this is null, but we surface the type for
// nicer copy in Settings.
export async function biometryType(): Promise<string | null> {
  try {
    return await Keychain.getSupportedBiometryType();
  } catch {
    return null;
  }
}

// Is the app lock currently turned on?
export async function isEnabled(): Promise<boolean> {
  try {
    const c = await Keychain.getGenericPassword({ service: PREF_SERVICE });
    return !!c && c.password === '1';
  } catch {
    return false;
  }
}

// ── "did a human just authenticate?" is not "did the read return something" ──
//
// react-native-keychain picks the Android cipher storage at WRITE time, and
// KeystoreRSAECB is the only one of the three that calls
// setUserAuthenticationRequired(true) — KeystoreAESCBC and FacebookConceal
// hand the value straight back with no prompt at all.
//
// The choice downgrades SILENTLY. getCipherStorageForCurrentAPILevel skips the
// RSA variant whenever biometry is unavailable at that instant:
//
//   if (variant.isBiometrySupported() && !isBiometry) continue;
//   …where isBiometry = useBiometry && (fingerprint || face || iris available)
//
// "Unavailable" includes the sensor being in temporary lockout after failed
// attempts, hardware busy, and nothing yet enrolled. Turn the lock on inside
// that window and the sentinel lands in AES, where every later read succeeds
// instantly. The old check here was `return !!res`, so that read reported
// success and the app unlocked without asking anyone anything.
//
// Reads use the storage the entry was written with (getCipherStorageByName), so
// a downgraded sentinel stays downgraded for good — the lock was decorative
// from the moment it was switched on, and nothing said so.
//
// So: require positive proof. The read must have come back from the
// auth-binding storage, and it must decrypt to OUR sentinel.
const AUTH_BOUND_ANDROID_STORAGE = 'KeystoreRSAECB';
const IOS_KEYCHAIN_STORAGE = 'keychain';

function storageEnforcesAuth(storage?: string): boolean {
  // iOS has one storage and the Secure Enclave enforces the accessControl that
  // was asked for, so its name is all there is to check.
  return Platform.OS === 'ios'
    ? storage === IOS_KEYCHAIN_STORAGE
    : storage === AUTH_BOUND_ANDROID_STORAGE;
}

// ── and "the OS prompted" is not "the OS asked anyone anything" ──────────────
//
// react-native-keychain 8.2.0 generates the RSA key with a five-second
// authentication validity window: after ANY device authentication — including
// unlocking the phone — the key is usable again with no prompt at all. The
// whole lock rests on "reading the sentinel forces the prompt", so inside that
// window the read succeeded, this file reported an authentication, and the app
// unlocked on a tap.
//
// It is open at the worst possible moment. The lock screen is shown just after
// the phone itself was unlocked, and again for five seconds after an attempt
// that authenticated the user but failed for some other reason — which is what
// made pressing "Try again" let the user straight in, reported 2026-10-02.
//
// patches/react-native-keychain+8.2.0.patch closes it for keys created from
// now on. A key created BEFORE it keeps the window for as long as it exists,
// and nothing about it is visible from JS, so it is replaced rather than
// detected: see rebuildSentinel.

/** Has this device's sentinel been created under the current key spec? */
export async function sentinelKeyIsCurrent(): Promise<boolean> {
  try {
    const c = await Keychain.getGenericPassword({ service: KEY_VERSION_SERVICE });
    return !!c && c.password === KEY_VERSION;
  } catch {
    // The keystore is not answering right now. Say "current" so nothing is
    // torn down on the strength of a read that failed — the next unlock asks
    // again, and the cost of a late rebuild is a window that was already open.
    return true;
  }
}

async function markKeyVersion(): Promise<void> {
  try {
    await Keychain.setGenericPassword('keyver', KEY_VERSION, {
      service: KEY_VERSION_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch {
    /* Unmarked means "rebuild again next time", which is wasteful and safe. */
  }
}

/**
 * Replace a sentinel created under the old key spec with one that requires an
 * authentication for every use.
 *
 * CALLED STRAIGHT AFTER A SUCCESSFUL UNLOCK, which is what makes it safe:
 * writing the sentinel needs no authentication (RSA encrypts with the public
 * half) but the OS picks the storage by whether biometry is available at that
 * instant, and a moment when the user has just authenticated with it is the
 * best evidence available that it is.
 *
 * THE ALIAS HAS TO GO FIRST. setGenericPassword reuses an existing keystore
 * key, so overwriting the entry would leave the old spec — and its window — in
 * place. That makes the operation destructive for the moment between the two
 * calls, which is why it is guarded on biometry being available at all and why
 * a downgraded result turns the lock off rather than leaving a decorative one.
 */
export async function rebuildSentinel(): Promise<EnableResult> {
  // Nothing to rebuild from. Writing one now would turn a lock that is not set
  // up into one that is.
  let exists = false;
  try {
    exists = !!(await Keychain.getGenericPassword({ service: PREF_SERVICE }));
  } catch {
    return { ok: false, reason: 'write-failed' };
  }
  if (!exists) return { ok: false, reason: 'write-failed' };

  // If the OS says there is no biometry right now, the rewrite would land in a
  // storage that needs no authentication. Leave the old key alone and try
  // again next time.
  if (!(await biometryType())) {
    return { ok: false, reason: 'not-enforceable' };
  }

  try {
    await Keychain.resetGenericPassword({ service: LOCK_SERVICE });
  } catch {
    return { ok: false, reason: 'write-failed' };
  }

  let written: false | Keychain.Result;
  try {
    written = await Keychain.setGenericPassword('thrilla', SENTINEL, {
      service: LOCK_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
    });
  } catch {
    await disable();
    return { ok: false, reason: 'write-failed' };
  }
  const storage = written ? written.storage : undefined;
  if (!storageEnforcesAuth(storage)) {
    // The sentinel landed somewhere that needs no authentication to read, so
    // the lock would open on the first tap. Off is the honest state: Settings
    // shows it off and it can be turned back on, which is better than a lock
    // screen that is decoration.
    await disable();
    return { ok: false, reason: 'not-enforceable', storage };
  }
  await markKeyVersion();
  return { ok: true };
}

export type UnlockFailure =
  // Cancelled, wrong finger, or the prompt could not be shown.
  | 'failed'
  // No sentinel — the lock is not set up on this device.
  | 'not-set-up'
  // The sentinel exists but is not bound to an authentication, so reading it
  // proves nothing. The lock cannot be enforced until it is set up again.
  | 'not-enforceable';

export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: UnlockFailure; storage?: string };

/**
 * Prompt for biometric/credential unlock, and say what happened.
 *
 * `not-enforceable` is the one a caller must not treat as an ordinary failure:
 * retrying will never succeed, and the lock needs turning off and on again to
 * be rebuilt against a working sensor.
 */
export async function tryAuthenticate(
  title = 'Unlock WhiSPa',
): Promise<UnlockResult> {
  let res: Keychain.UserCredentials | false;
  try {
    res = await Keychain.getGenericPassword({
      service: LOCK_SERVICE,
      authenticationPrompt: { title },
    });
  } catch {
    // User cancelled, failed, or no prompt available.
    return { ok: false, reason: 'failed' };
  }
  if (!res) return { ok: false, reason: 'not-set-up' };
  if (!storageEnforcesAuth(res.storage)) {
    return { ok: false, reason: 'not-enforceable', storage: res.storage };
  }
  if (res.password !== SENTINEL) {
    // Decrypted something that is not ours. Not a pass.
    return { ok: false, reason: 'failed' };
  }
  return { ok: true };
}

/** Prompt the device for biometric/credential unlock. Returns true on success. */
export async function authenticate(
  title = 'Unlock WhiSPa',
): Promise<boolean> {
  return (await tryAuthenticate(title)).ok;
}

export type EnableFailure =
  // The keystore write itself failed.
  | 'write-failed'
  // The OS put the sentinel somewhere that needs no authentication to read, so
  // the lock would unlock on the first tap. Usually: no biometric enrolled, or
  // the sensor is in lockout right now.
  | 'not-enforceable'
  // The confirmation prompt was cancelled or not satisfied.
  | 'cancelled'
  | 'pref-write-failed';

export type EnableResult =
  | { ok: true }
  | { ok: false; reason: EnableFailure; storage?: string };

/**
 * Turn the lock on: store the guarded sentinel, check the OS actually bound it
 * to an authentication, then verify by prompting once.
 *
 * The storage check is the one that matters. Without it this happily enabled a
 * lock the OS had silently written to a store that needs no authentication —
 * see storageEnforcesAuth above. Refusing is the honest answer: better to say
 * "not now" than to show a lock screen that opens on the first tap.
 */
export async function enable(): Promise<EnableResult> {
  let written: false | Keychain.Result;
  try {
    written = await Keychain.setGenericPassword('thrilla', SENTINEL, {
      service: LOCK_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
    });
  } catch {
    return { ok: false, reason: 'write-failed' };
  }
  const storage = written ? written.storage : undefined;
  if (!storageEnforcesAuth(storage)) {
    await disable();
    return { ok: false, reason: 'not-enforceable', storage };
  }
  const ok = await authenticate('Confirm to turn on App Lock');
  if (!ok) {
    await disable();
    return { ok: false, reason: 'cancelled' };
  }
  try {
    await Keychain.setGenericPassword('pref', '1', {
      service: PREF_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch {
    /* pref write failed — treat as not enabled */
    return { ok: false, reason: 'pref-write-failed' };
  }
  // Created under the current spec, so nothing will try to rebuild it.
  await markKeyVersion();
  return { ok: true };
}

// ── Auto-lock delay ──────────────────────────────────────────────────────────
//
// How long the app may sit unused before it locks. Time spent in the background
// counts, because "unused" is measured from the last touch (sessionActivity)
// and a backgrounded app receives none.
//
// This exists because the app used to lock on EVERY trip to the background,
// which made glancing at another app — checking the address someone sent you,
// copying an amount — cost a fingerprint every time. That is the behaviour
// people turn locks off over.
//
// ZERO means lock immediately on leaving the foreground, which is the old
// behaviour kept as a choice for anyone who wants it.

const TIMEOUT_SERVICE = 'com.thrilla.applock.timeout';

// A minute is short enough that a lost phone is not sitting open for long, and
// long enough that switching apps to look something up does not re-prompt.
export const DEFAULT_AUTO_LOCK_MS = 60 * 1000;

// The offered choices. Kept here rather than in the settings screen so the
// stored value can be validated against them — a number that came back from the
// keystore malformed should fall back, not become a 3ms auto-lock.
export const AUTO_LOCK_CHOICES: { label: string; ms: number }[] = [
  { label: 'Immediately', ms: 0 },
  { label: 'After 1 minute', ms: 60 * 1000 },
  { label: 'After 5 minutes', ms: 5 * 60 * 1000 },
  { label: 'After 15 minutes', ms: 15 * 60 * 1000 },
  { label: 'After 1 hour', ms: 60 * 60 * 1000 },
];

export async function getAutoLockMs(): Promise<number> {
  try {
    const c = await Keychain.getGenericPassword({ service: TIMEOUT_SERVICE });
    if (!c) return DEFAULT_AUTO_LOCK_MS;
    const n = Number(c.password);
    // Only a value we actually offer. Anything else — a corrupted record, or a
    // choice removed in a later version — falls back rather than being honoured.
    return AUTO_LOCK_CHOICES.some((o) => o.ms === n) ? n : DEFAULT_AUTO_LOCK_MS;
  } catch {
    return DEFAULT_AUTO_LOCK_MS;
  }
}

export async function setAutoLockMs(ms: number): Promise<void> {
  try {
    await Keychain.setGenericPassword('timeout', String(ms), {
      service: TIMEOUT_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch {
    /* keystore unavailable — the choice applies this session and is re-asked
       for next launch, which fails towards the default rather than towards
       never locking */
  }
}

// Turn the lock off and remove the guarded sentinel.
export async function disable(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: LOCK_SERVICE });
  } catch {
    /* ignore */
  }
  try {
    await Keychain.setGenericPassword('pref', '0', {
      service: PREF_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch {
    /* ignore */
  }
  // The marker describes a sentinel that no longer exists.
  try {
    await Keychain.resetGenericPassword({ service: KEY_VERSION_SERVICE });
  } catch {
    /* ignore */
  }
}
