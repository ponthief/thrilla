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

// A marker left by one build, and the only way to recognise the sentinel it
// broke.
//
// 2026-10-02 shipped a patch to react-native-keychain that generated this
// key with setUserAuthenticationParameters(0, …) — "authenticate for every
// use" — to close the five-second window described below. The library cannot
// satisfy that: DecryptionResultHandlerInteractiveBiometric calls
// prompt.authenticate(promptInfo) with NO CryptoObject, so the biometric
// success is not bound to the key, the retried decrypt throws
// UserNotAuthenticatedException again, and the prompt loops forever. Every
// device that unlocked once on that build rewrote its sentinel into a key
// nothing can read, and its owner was locked out of the app.
//
// The marker is readable without authenticating, so a build with the patch
// reverted can find those sentinels and replace them. Nothing writes it any
// more; it exists to be found and cleared.
const KEY_VERSION_SERVICE = 'com.thrilla.applock.keyver';
const BROKEN_KEY_VERSION = '2';

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

// ── the five-second window, which is still here ──────────────────────────────
//
// react-native-keychain 8.2.0 generates this key with a five-second
// authentication validity window: after ANY device authentication — including
// unlocking the phone — the key is usable again with no prompt at all. The
// lock rests on "reading the sentinel forces the prompt", so inside that
// window the read succeeds having asked nobody anything.
//
// It is open at the worst possible moment: the lock screen is shown just after
// the phone itself was unlocked, which is why pressing Unlock there can let
// somebody in without a prompt.
//
// IT CANNOT BE CLOSED FROM HERE, and trying cost a day. The window is the
// library's only mechanism for authorising the key: its biometric prompt is
// raised WITHOUT a CryptoObject, so the only thing that can authorise a
// decrypt is a recent authentication by time. Generating the key with
// per-use authentication instead makes every read throw
// UserNotAuthenticatedException forever — see BROKEN_KEY_VERSION above, and
// scripts/check-app-lock.cjs, which refuses that patch coming back.
//
// Closing it properly means a keychain library whose prompt carries a
// CryptoObject. Until then this is a five-second weakness in the biometric
// path, and the in-app PIN — which this file has nothing to do with — is
// unaffected.

/**
 * Was this device's sentinel written by the build that made it unreadable?
 *
 * False on any error: nothing is torn down on the strength of a read that
 * failed, and a device that is not in that state must never be pushed through
 * a rebuild on a guess.
 */
export async function sentinelKeyIsBroken(): Promise<boolean> {
  try {
    const c = await Keychain.getGenericPassword({ service: KEY_VERSION_SERVICE });
    return !!c && c.password === BROKEN_KEY_VERSION;
  } catch {
    return false;
  }
}

async function clearKeyVersion(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: KEY_VERSION_SERVICE });
  } catch {
    /* Left behind means one more rebuild next launch: wasteful, not harmful. */
  }
}

/**
 * Replace the sentinel, and the keystore key behind it.
 *
 * THIS IS NOT A WAY PAST THE LOCK. Writing the sentinel needs no
 * authentication — RSA encrypts with the public half — but the key it writes
 * still requires one to READ, so a rebuild leaves somebody holding the phone
 * exactly where they were: in front of a prompt they have to satisfy.
 *
 * THE ALIAS HAS TO GO FIRST. setGenericPassword reuses an existing keystore
 * key, so overwriting the entry would keep the broken one. That makes this
 * destructive for the moment between the two calls, which is why it refuses to
 * start unless the OS says biometry is available — without it the rewrite
 * lands in a storage that enforces nothing.
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
  await clearKeyVersion();
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
  // A lock turned on now is not the broken one, whatever a stale marker says.
  await clearKeyVersion();
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
