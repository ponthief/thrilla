import { create } from 'zustand';

// The app has no router — App.tsx's Shell switches tabs with a state value. That
// works fine while only the tab bar navigates, but a prompt on one screen that
// sends you to another needs a way in.
//
// Kept deliberately small: the active tab, plus a counter a screen can bump to
// ask a destination to open something once it gets there. A counter rather than
// a boolean so a second request lands even if the first was never cleared.

export type TabKey = 'wallet' | 'send' | 'receive' | 'settings';

interface NavState {
  tab: TabKey;
  // Bumped to ask the Receive tab to expand its sweep card.
  sweepRequest: number;
  setTab: (tab: TabKey) => void;
  // Go to Receive AND open the sweep card, for the prompt on the wallet screen.
  goToSweep: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  tab: 'wallet',
  sweepRequest: 0,
  setTab: (tab) => set({ tab }),
  goToSweep: () =>
    set((s) => ({ tab: 'receive', sweepRequest: s.sweepRequest + 1 })),
}));
