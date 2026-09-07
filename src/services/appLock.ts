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

// Prompt the device for biometric/credential unlock. Returns true on success.
export async function authenticate(
  title = 'Unlock Thrilla',
): Promise<boolean> {
  try {
    const res = await Keychain.getGenericPassword({
      service: LOCK_SERVICE,
      authenticationPrompt: { title },
    });
    return !!res;
  } catch {
    // User cancelled, failed, or no prompt available.
    return false;
  }
}

// Turn the lock on: store the guarded sentinel, then verify by prompting once.
// Returns false (and stays off) if the device has no biometrics/credential or
// the user cancels the confirmation.
export async function enable(): Promise<boolean> {
  try {
    await Keychain.setGenericPassword('thrilla', SENTINEL, {
      service: LOCK_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
    });
  } catch {
    return false;
  }
  const ok = await authenticate('Confirm to turn on App Lock');
  if (!ok) {
    await disable();
    return false;
  }
  try {
    await Keychain.setGenericPassword('pref', '1', {
      service: PREF_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch {
    /* pref write failed — treat as not enabled */
    return false;
  }
  return true;
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
}
