import { create } from 'zustand';
import * as txLabels from '@services/txLabels';

// In-memory mirror of the device-only transaction labels (see
// services/txLabels.ts for why they never reach the server).
//
// Kept in a store because the wallet list renders labels on every row and the
// keystore read is async — the list needs them synchronously. Loaded once after
// login; writes update state first so the field responds immediately, then
// persist.

interface TxLabelState {
  labels: txLabels.TxLabelMap;
  ready: boolean;
  load: () => Promise<void>;
  setLabel: (txid: string, label: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useTxLabelStore = create<TxLabelState>((set, get) => ({
  labels: {},
  ready: false,

  load: async () => {
    const labels = await txLabels.loadTxLabels();
    set({ labels, ready: true });
  },

  setLabel: async (txid, label) => {
    if (!txid) return;
    const trimmed = label.trim();
    const next = { ...get().labels };
    // An emptied field means "remove", not "store an empty string".
    if (trimmed) next[txid] = trimmed;
    else delete next[txid];
    set({ labels: next });
    await txLabels.persistTxLabels(next);
  },

  clearAll: async () => {
    set({ labels: {}, ready: true });
    await txLabels.wipeTxLabels();
  },
}));

// For non-React callers (the send flow, list mapping).
export function getTxLabel(txid: string): string | null {
  return useTxLabelStore.getState().labels[txid] || null;
}
