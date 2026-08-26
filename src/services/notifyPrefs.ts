import * as Keychain from 'react-native-keychain';

// Local notification preferences.
//
// Currently one switch: "payment alerts" — the notification that a payment has
// arrived. It covers every surface of that alert:
//   * the system notification pushed by the server while the app is closed
//     (turned off by removing this device's FCM token, see services/push.ts),
//   * the in-app banner for a foreground FCM message, and
//   * the in-app banner the foreground catch-up scan raises when it finds coins.
//
// The pref is per-device (like App Lock), not per-account: it decides what THIS
// phone does with payment activity, so it's stored locally rather than in the
// server-side user prefs. Persistence uses react-native-keychain — the same
// keystore-backed pattern as services/appLock.ts — since the app has no
// AsyncStorage/MMKV dependency.

const PREF_SERVICE = 'com.thrilla.notify.payments';

// Default ON: an install that has never touched the switch behaves exactly as
// before (alerts on). Only an explicit '0' turns them off, so a keystore read
// failure can't silently disable notifications.
export async function paymentAlertsEnabled(): Promise<boolean> {
  try {
    const c = await Keychain.getGenericPassword({ service: PREF_SERVICE });
    return !c || c.password !== '0';
  } catch {
    return true;
  }
}

export async function setPaymentAlertsEnabled(enabled: boolean): Promise<void> {
  try {
    await Keychain.setGenericPassword('pref', enabled ? '1' : '0', {
      service: PREF_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch {
    /* keystore unavailable — the in-memory pref still applies this session */
  }
}
