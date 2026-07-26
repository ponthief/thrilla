import * as Keychain from 'react-native-keychain';

// Device-trust identity for the native app.
//
// The backend (helpers/device_auth.py) trusts a device by an opaque `device_id`
// it generates during email confirmation. The web app stores that id in an
// HttpOnly per-user cookie; the native app has no reliable cookie jar, so we
// persist it ourselves in the platform keystore and echo it back in the
// `X-Silnt-Device` header on every request (see services/api.ts).
//
// Trust is per (user, device): two accounts on the same phone each confirm and
// store their own id. We therefore key storage by username. The in-memory
// `current` id is the logged-in user's, loaded at login and read synchronously
// by the request layer.

let current: string | null = null;

function serviceFor(username: string): string {
  // Keychain service names are arbitrary strings; sanitise to keep them tidy.
  const safe = (username || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64);
  return `com.thrilla.device.${safe}`;
}

// The current user's device id, for synchronous header injection. Null until a
// device has been confirmed (or before activate() has run).
export function currentDeviceId(): string | null {
  return current;
}

// Load the stored device id for a user into the in-memory cache. Called right
// after login so subsequent requests carry it. Returns the id (or null).
export async function activate(username: string): Promise<string | null> {
  try {
    const creds = await Keychain.getGenericPassword({ service: serviceFor(username) });
    current = creds ? creds.password : null;
  } catch {
    current = null;
  }
  return current;
}

// Persist the server-assigned device id for a user and make it current. Called
// after a successful device-verify-code.
export async function setDeviceId(username: string, deviceId: string): Promise<void> {
  current = deviceId;
  try {
    await Keychain.setGenericPassword(username, deviceId, {
      service: serviceFor(username),
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch {
    // If persistence fails the in-memory id still works for this session; the
    // user would just have to re-confirm next launch.
  }
}

// Forget a user's stored device id (used when the current device is revoked).
export async function forget(username: string): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: serviceFor(username) });
  } catch {
    /* ignore */
  }
  current = null;
}

// Clear only the in-memory id (on logout). The keystore entry survives so the
// same device stays trusted on the next login.
export function clearCurrent(): void {
  current = null;
}
