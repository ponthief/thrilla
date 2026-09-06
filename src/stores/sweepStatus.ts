import { create } from 'zustand';

// What is sitting on the sweep chain, so surfaces other than the sweep card can
// react to it.
//
// The card is on the Receive tab, behind a collapsed row — nobody finds it by
// accident. The Wallet tab is where people actually look, so it needs to be able
// to say "there are coins here that aren't in your balance yet". This is how it
// finds out, without every screen running its own chain walk.
//
// Written by whoever last looked: the background watcher (hooks/useSweepAlerts)
// on its poll, and the card itself on a manual refresh.

interface SweepStatusState {
  // Scoped to a wallet: the balance is meaningless attached to the wrong one,
  // and the app can switch networks.
  walletId: string | null;
  sweepableSats: number;
  unconfirmedSats: number;
  set: (s: { walletId: string; sweepableSats: number; unconfirmedSats: number }) => void;
}

export const useSweepStatus = create<SweepStatusState>((set) => ({
  walletId: null,
  sweepableSats: 0,
  unconfirmedSats: 0,
  set: (s) => set(s),
}));
