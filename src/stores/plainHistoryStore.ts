import { create } from 'zustand';
import * as plainHistory from '@services/plainHistory';

// In-memory mirror of the device-only plain-chain send history (see
// services/plainHistory.ts for why the server never gets it).
//
// A store rather than a per-component read because the keystore read is async
// and the card wants the rows on first paint, and because a send and the card
// that lists it are different components.

interface PlainHistoryState {
  byWallet: Record<string, plainHistory.PlainSendRecord[]>;
  ready: boolean;
  load: () => Promise<void>;
  record: (walletId: string, r: plainHistory.PlainSendRecord) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const usePlainHistory = create<PlainHistoryState>((set, get) => ({
  byWallet: {},
  ready: false,

  load: async () => {
    const byWallet = await plainHistory.loadPlainHistory();
    set({ byWallet, ready: true });
  },

  // State first so the row appears the moment the broadcast returns, then
  // persist. A keystore failure costs the row on next launch, never the send.
  record: async (walletId, r) => {
    const next = plainHistory.withRecord(get().byWallet, walletId, r);
    set({ byWallet: next });
    await plainHistory.persistPlainHistory(next);
  },

  clearAll: async () => {
    set({ byWallet: {}, ready: true });
    await plainHistory.wipePlainHistory();
  },
}));

export function plainSendsFor(walletId: string): plainHistory.PlainSendRecord[] {
  return usePlainHistory.getState().byWallet[walletId] || [];
}
