import * as api from '@services/api';
import { wipeAllWalletKeys } from '@services/secureKeys';
import { useTxLabelStore } from '@stores/txLabelStore';
import { resetCatchUp } from '@/hooks/useCatchUpScan';

// The duress response, shared by every place that accepts a PIN (the lock
// screen and the send-confirmation gate). It makes the device safe, then drops
// the session — ordered so it stays fast and looks like a normal action:
//   1. fire-and-forget server revocation of background scanning (needs the
//      session key, which logout clears) — removes the uploaded scan key,
//   2. wipe this device's wallet keys (local, guaranteed),
//   3. forget catch-up state and log out to a neutral screen (also unregisters
//      push).
// Funds stay safe on-chain and recover from the seed.
export async function runDuress(
  inkey: string | null,
  logout: () => void,
): Promise<void> {
  if (inkey) api.disableAllBackgroundScans(inkey).catch(() => {});
  try {
    await wipeAllWalletKeys();
  } catch {
    /* best-effort */
  }
  // Device-only transaction labels say who you paid — exactly what a coerced
  // unlock must not reveal, so they go with the keys.
  try {
    await useTxLabelStore.getState().clearAll();
  } catch {
    /* best-effort */
  }
  resetCatchUp();
  logout();
}
