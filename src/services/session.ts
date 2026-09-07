import * as Keychain from 'react-native-keychain';

// The signed-in session, kept across app restarts.
//
// Before this, auth state lived only in memory, so every cold start meant
// typing a username and password again. The keys themselves are long-lived —
// LNbits wallet keys do not expire — so re-authenticating to the server was
// never what the prompt achieved; it only proved the person holding the phone
// knew the password. The app lock (PIN or biometric) proves that better and
// faster, so that is what guards the session now.
//
// WHAT IS STORED, and why it is not a new class of secret: this device's
// keystore already holds the wallet's Silent Payments spend key and its BIP-84
// account xprv. Those move funds without the server's help. The admin key
// cannot: it drives a server that never sees a spend key. So the sensitive
// thing here was already present, and this is the smaller secret sitting beside
// it.
//
// WHAT IS NOT STORED: the JWT from login. Nothing outside login() ever used it
// — it fetches the wallet list and the account email and is then discarded — so
// there is no token to keep fresh and no refresh flow to get wrong.
//
// Erased by logout and by the duress PIN, and dropped automatically if the
// server ever rejects the keys (see services/api.ts).

const SESSION_SERVICE = 'com.thrilla.session';

export interface StoredSession {
  inkey: string;
  adminkey: string;
  walletId: string;
  walletName: string | null;
  username: string;
  email: string | null;
}

function looksComplete(v: any): v is StoredSession {
  return (
    !!v &&
    typeof v.inkey === 'string' &&
    v.inkey.length > 0 &&
    typeof v.adminkey === 'string' &&
    v.adminkey.length > 0 &&
    typeof v.walletId === 'string' &&
    v.walletId.length > 0 &&
    typeof v.username === 'string' &&
    v.username.length > 0
  );
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const c = await Keychain.getGenericPassword({ service: SESSION_SERVICE });
    if (!c) return null;
    const parsed = JSON.parse(c.password);
    if (!looksComplete(parsed)) return null;
    return {
      inkey: parsed.inkey,
      adminkey: parsed.adminkey,
      walletId: parsed.walletId,
      walletName: typeof parsed.walletName === 'string' ? parsed.walletName : null,
      username: parsed.username,
      email: typeof parsed.email === 'string' ? parsed.email : null,
    };
  } catch {
    // A malformed or unreadable record is treated as no session: the login
    // screen is always a safe fallback.
    return null;
  }
}

// Returns false when the keystore refused the write. The caller stays signed in
// for this run either way — the cost is one more login next launch, and failing
// the login over it would be worse.
export async function saveSession(s: StoredSession): Promise<boolean> {
  try {
    await Keychain.setGenericPassword('session', JSON.stringify(s), {
      service: SESSION_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
    return true;
  } catch {
    return false;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: SESSION_SERVICE });
  } catch {
    /* best-effort, same as the key wipe */
  }
}
