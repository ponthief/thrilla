import { create } from 'zustand';
import * as api from '@services/api';

// Spends of this wallet's coins that the wallet itself did not broadcast.
//
// This is the loudest thing the app can say, so it is deliberately not a
// PushBanner: those slide away after six seconds, and "your key may be
// compromised" is not a message to show for six seconds. It stays on screen
// until the user acknowledges it, survives tab switches, and comes back on the
// next poll if the server still has it unacknowledged.
//
// Acknowledging is server-side (admin-keyed) rather than local, so dismissing
// on one device dismisses everywhere — a warning that reappears on the tablet
// after being dealt with on the phone reads as a second compromise.

interface SpendAlertState {
  walletId: string | null;
  alerts: api.SpendAlert[];
  explorerBase: string;
  // Set while an ack is in flight, so the button can't be double-tapped into
  // two requests.
  acking: string | null;
  // Bumped to make the watcher look now instead of at its next poll. A push
  // arriving in the foreground does this: the notification says something is
  // wrong, so the banner should already be up by the time the user looks.
  refreshTick: number;
  set: (s: { walletId: string; alerts: api.SpendAlert[]; explorerBase: string }) => void;
  acknowledge: (adminkey: string, txid: string) => Promise<void>;
  requestRefresh: () => void;
  clear: () => void;
}

export const useSpendAlerts = create<SpendAlertState>((set, get) => ({
  walletId: null,
  alerts: [],
  explorerBase: 'https://mempool.space',
  acking: null,
  refreshTick: 0,
  set: (s) => set(s),
  requestRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
  acknowledge: async (adminkey, txid) => {
    const { walletId, acking } = get();
    if (!walletId || acking) return;
    set({ acking: txid });
    try {
      await api.acknowledgeSpendAlert(adminkey, walletId, txid);
      // Dropped locally as well as on the server: the next poll is up to a
      // minute away and the banner must go the moment it is dismissed.
      set((s) => ({ alerts: s.alerts.filter((a) => a.txid !== txid) }));
    } finally {
      set({ acking: null });
    }
  },
  // refreshTick deliberately survives a clear: it is a request counter, and
  // resetting it on sign-out would make the next bump a no-op for any effect
  // still holding the old value.
  clear: () => set({ walletId: null, alerts: [], acking: null }),
}));
