import * as Keychain from 'react-native-keychain';

// Local notification preferences.
//
// One switch, "Alerts", covering everything the app announces:
//   * a payment arriving, or a send getting its first confirmation, and
//   * a Tango — someone asking to connect, or a round waiting on your turn.
//
// It covers every surface of both:
//   * the system notification pushed by the server while the app is closed
//     (turned off by removing this device's FCM token, see services/push.ts),
//   * the in-app banner for a foreground FCM message, and
//   * the in-app banners the foreground polls raise — hooks/useCatchUpScan when
//     a scan finds coins, hooks/useTangoWatch when a turn becomes yours.
//
// WHY ONE SWITCH AND NOT TWO. Splitting payments from Tango was the obvious
// shape, and it cannot be honoured. One device token carries every kind of
// message, so the only thing that stops a notification with the app CLOSED is
// not holding a token — an all-or-nothing lever. The notification is built at
// that point by notify/PaymentNotificationReceiver.kt, native code with no way
// to read this pref: the app has no SharedPreferences bridge, and these values
// live in the keystore. A second switch would therefore have gone on silencing
// the in-app banner while the phone kept buzzing, which is worse than not
// offering it. Independent control needs the SERVER to know which kinds each
// token wants, so it sends only those — a backend change, not a client one.
//
// The pref is per-device (like App Lock), not per-account: it decides what THIS
// phone does, so it's stored locally rather than in the server-side user prefs.
// Persistence uses react-native-keychain — the same keystore-backed pattern as
// services/appLock.ts — since the app has no AsyncStorage/MMKV dependency.

// Still `…notify.payments`, from when payments were all it covered. Renaming it
// would read as unset on every phone that has already chosen, silently turning
// alerts back on for anyone who switched them off.
const PREF_SERVICE = 'com.thrilla.notify.payments';

// Default ON: an install that has never touched the switch behaves exactly as
// before (alerts on). Only an explicit '0' turns them off, so a keystore read
// failure can't silently disable notifications.
export async function alertsEnabled(): Promise<boolean> {
  try {
    const c = await Keychain.getGenericPassword({ service: PREF_SERVICE });
    return !c || c.password !== '0';
  } catch {
    return true;
  }
}

export async function setAlertsEnabled(enabled: boolean): Promise<void> {
  try {
    await Keychain.setGenericPassword('pref', enabled ? '1' : '0', {
      service: PREF_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch {
    /* keystore unavailable — the in-memory pref still applies this session */
  }
}
