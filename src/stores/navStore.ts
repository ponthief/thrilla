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
  // Bumped to ask the Receive tab to select its "Plain" segment.
  plainRequest: number;
  setTab: (tab: TabKey) => void;
  // Go to Receive AND switch to the plain address, for the wallet screen's
  // prompt about coins sitting there.
  goToPlain: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  tab: 'wallet',
  plainRequest: 0,
  setTab: (tab) => set({ tab }),
  goToPlain: () =>
    set((s) => ({ tab: 'receive', plainRequest: s.plainRequest + 1 })),
}));
