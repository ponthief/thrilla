import * as api from '@services/api';
import { wipeAllWalletKeys } from '@services/secureKeys';
import { clearSession } from '@services/session';
import { useSeedBackup } from '@stores/seedBackup';
import { useTxLabelStore } from '@stores/txLabelStore';
import { usePlainHistory } from '@stores/plainHistoryStore';
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
  // The stored session goes too, and before logout() so it is gone even if the
  // process dies mid-wipe. Leaving it would hand a coerced unlock a working
  // admin key to the account — the one thing the wipe is for.
  try {
    await clearSession();
  } catch {
    /* best-effort */
  }
  // Device-only transaction labels say who you paid — exactly what a coerced
  // unlock must not reveal, so they go with the keys. The plain chain's send
  // history is the same kind of thing, and the only copy of it anywhere.
  try {
    await useTxLabelStore.getState().clearAll();
  } catch {
    /* best-effort */
  }
  try {
    await usePlainHistory.getState().clearAll();
  } catch {
    /* best-effort */
  }
  // A recovery phrase still on screen is the most valuable thing in the app —
  // it reconstructs every key the wipe just removed — so it goes with them.
  try {
    useSeedBackup.getState().done();
  } catch {
    /* best-effort */
  }
  resetCatchUp();
  logout();
}
