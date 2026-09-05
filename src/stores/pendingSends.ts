import { create } from 'zustand';

// Outgoing sends that have been broadcast but not yet mined.
//
// Two things populate this, and both matter:
//
//   * SendScreen registers a txid the moment it broadcasts, so the watcher
//     starts immediately — before any list refresh has happened.
//   * WalletScreen syncs whatever the server still reports as unconfirmed on
//     every load. That covers sends made before the app was restarted, or from
//     the web app on another device, which local registration alone would miss.
//
// Deliberately in memory only. The wallet list is the durable record — it reads
// `confirmed` straight from the backend — so this store exists purely to decide
// what to poll and what to announce. Losing it on restart costs a banner, not
// state, and the sync above rebuilds it on the next wallet load.

export interface PendingSend {
  txid: string;
  walletId: string;
  amountSats: number | null;
  addedAt: number; // ms, for the grace period below
}

// How long a locally-registered send is kept even though the server hasn't
// listed it as pending yet. Broadcast marks the inputs unconfirmed_spent
// synchronously, but a wallet list already in flight can still miss it, and
// dropping the entry there would lose the confirmation banner.
const SYNC_GRACE_MS = 2 * 60 * 1000;

interface PendingSendsState {
  sends: PendingSend[];
  // Bumped whenever a send confirms. The wallet screen watches it and reloads:
  // confirming flips the inputs to 'spent' server-side, so the list's "pending"
  // badge is stale until it refetches, and nothing else would tell it.
  confirmedTick: number;
  add: (send: Omit<PendingSend, 'addedAt'>) => void;
  remove: (txid: string) => void;
  markConfirmed: (txid: string) => void;
  sync: (pending: { txid: string; walletId: string; amountSats: number | null }[]) => void;
}

export const usePendingSends = create<PendingSendsState>((set) => ({
  sends: [],
  confirmedTick: 0,

  add: (send) =>
    set((s) =>
      s.sends.some((x) => x.txid === send.txid)
        ? s
        : { sends: [...s.sends, { ...send, addedAt: Date.now() }] },
    ),

  remove: (txid) => set((s) => ({ sends: s.sends.filter((x) => x.txid !== txid) })),

  markConfirmed: (txid) =>
    set((s) => ({
      sends: s.sends.filter((x) => x.txid !== txid),
      confirmedTick: s.confirmedTick + 1,
    })),

  // The server's list is authoritative: anything it no longer calls pending has
  // confirmed (or been replaced) and stops being watched. The one exception is
  // a very recent local entry, per SYNC_GRACE_MS above.
  sync: (pending) =>
    set((s) => {
      const now = Date.now();
      const fromServer = new Set(pending.map((p) => p.txid));

      const kept = s.sends.filter(
        (x) => fromServer.has(x.txid) || now - x.addedAt < SYNC_GRACE_MS,
      );
      const known = new Set(kept.map((x) => x.txid));
      const added = pending
        .filter((p) => !known.has(p.txid))
        .map((p) => ({ ...p, addedAt: now }));

      return { sends: [...kept, ...added] };
    }),
}));

// Readable outside React by the watcher in App.tsx.
export function getPendingSends(): PendingSend[] {
  return usePendingSends.getState().sends;
}
