import * as Keychain from 'react-native-keychain';

// Per-wallet secure storage for Silent Payments keys (scan_secret + spend_key).
// Backed by the platform keystore (Android Keystore / iOS Keychain) via
// react-native-keychain. The spend key can move funds, so these must never be
// written to plain storage. One keychain "service" entry per wallet id.

export interface WalletKeys {
  scanSecret: string;
  spendKey: string;
}

function serviceFor(walletId: string): string {
  return `com.thrilla.wallet.${walletId}`;
}

export async function storeWalletKeys(
  walletId: string,
  scanSecret: string,
  spendKey: string,
): Promise<boolean> {
  try {
    await Keychain.setGenericPassword(
      walletId,
      JSON.stringify({ scanSecret, spendKey }),
      {
        service: serviceFor(walletId),
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
      },
    );
    return true;
  } catch {
    return false;
  }
}

export async function getWalletKeys(walletId: string): Promise<WalletKeys | null> {
  try {
    const creds = await Keychain.getGenericPassword({ service: serviceFor(walletId) });
    if (!creds) return null;
    const parsed = JSON.parse(creds.password);
    if (parsed?.scanSecret && parsed?.spendKey) return parsed as WalletKeys;
    return null;
  } catch {
    return null;
  }
}

export async function hasWalletKeys(walletId: string): Promise<boolean> {
  return (await getWalletKeys(walletId)) != null;
}

export async function removeWalletKeys(walletId: string): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: serviceFor(walletId) });
  } catch {
    /* ignore */
  }
}
