import { create } from 'zustand';

// The app has no router — App.tsx's Shell switches tabs with a state value. That
// works fine while only the tab bar navigates, but a prompt on one screen that
// sends you to another needs a way in.
//
// Kept deliberately small: the active tab, plus a counter a screen can bump to
// ask a destination to open something once it gets there. A counter rather than
// a boolean so a second request lands even if the first was never cleared.

export type TabKey = 'wallet' | 'send' | 'receive' | 'payjoin' | 'settings';

interface NavState {
  tab: TabKey;
  // Bumped to ask the Receive tab to select its "Plain" segment.
  plainRequest: number;
  // How many PayJoins are waiting on this user, for the tab badge. Set by
  // hooks/usePayjoinWatch; a PayJoin the OTHER side started is invisible
  // otherwise, and it expires in a day.
  payjoinPending: number;
  setPayjoinPending: (n: number) => void;
  goToPayjoin: () => void;
  setTab: (tab: TabKey) => void;
  // Go to Receive AND switch to the plain address, for the wallet screen's
  // prompt about coins sitting there.
  goToPlain: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  tab: 'wallet',
  plainRequest: 0,
  payjoinPending: 0,
  setTab: (tab) => set({ tab }),
  goToPlain: () =>
    set((s) => ({ tab: 'receive', plainRequest: s.plainRequest + 1 })),
  setPayjoinPending: (payjoinPending) => set({ payjoinPending }),
  goToPayjoin: () => set({ tab: 'payjoin' }),
}));
