import * as Keychain from 'react-native-keychain';

// Whether this device shows balances or stars.
//
// Per-device and not per-account: the reason to hide a balance is who is
// standing next to this particular phone.

const PREF_SERVICE = 'com.thrilla.balanceprivacy';

export async function balancesHidden(): Promise<boolean> {
  try {
    const c = await Keychain.getGenericPassword({ service: PREF_SERVICE });
    return c ? c.password === '1' : false;
  } catch {
    // Unreadable store: show balances, which is the state the user can see and
    // correct. Failing closed would look like the balance had gone.
    return false;
  }
}

export async function setBalancesHidden(hidden: boolean): Promise<void> {
  try {
    await Keychain.setGenericPassword('hidden', hidden ? '1' : '0', {
      service: PREF_SERVICE,
    });
  } catch {
    // The toggle still applies for this session; it just will not survive a
    // restart. Not worth an error in front of the user.
  }
}
