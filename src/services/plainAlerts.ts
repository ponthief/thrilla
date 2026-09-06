import * as Keychain from 'react-native-keychain';

// Remembers the plain-address balance this device has already announced, per
// wallet.
//
// Without it, "coins arrived" would fire on every app launch for as long as they
// sat there — the alert is about coins ARRIVING, and coins that arrived last
// week are not news. Announce only what's new: an amount above what was last
// announced. Spending them drops the balance, which resets the mark so the next
// payment is news again.
//
// Per-device, like the payment-alerts switch it is gated by, and stored the same
// way (react-native-keychain — the app has no AsyncStorage/MMKV dependency).
// Not secret; it lives here because this is where per-device state goes.

const SEEN_SERVICE = 'com.thrilla.plain.announced';

type SeenMap = Record<string, number>;

async function readAll(): Promise<SeenMap> {
  try {
    const c = await Keychain.getGenericPassword({ service: SEEN_SERVICE });
    if (!c) return {};
    const parsed = JSON.parse(c.password);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as SeenMap;
  } catch {
    return {};
  }
}

export async function lastAnnounced(walletId: string): Promise<number> {
  const all = await readAll();
  const n = all[walletId];
  return typeof n === 'number' && n >= 0 ? n : 0;
}

export async function setLastAnnounced(walletId: string, sats: number): Promise<void> {
  try {
    const all = await readAll();
    all[walletId] = Math.max(0, Math.floor(sats));
    await Keychain.setGenericPassword('plainseen', JSON.stringify(all), {
      service: SEEN_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch {
    /* keystore unavailable — worst case the alert repeats next launch */
  }
}
