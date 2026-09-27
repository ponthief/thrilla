import { create } from 'zustand';

// The app has no router — App.tsx's Shell switches tabs with a state value. That
// works fine while only the tab bar navigates, but a prompt on one screen that
// sends you to another needs a way in.
//
// Kept deliberately small: the active tab, plus a counter a screen can bump to
// ask a destination to open something once it gets there. A counter rather than
// a boolean so a second request lands even if the first was never cleared.

export type TabKey = 'wallet' | 'send' | 'receive' | 'tango' | 'settings';

interface NavState {
  tab: TabKey;
  // Bumped to ask the Receive tab to select its "Plain" segment.
  plainRequest: number;
  // How many Tango rounds are waiting on this user, for the tab badge. Set by
  // hooks/useTangoWatch; a round the OTHER side started is invisible
  // otherwise, and it expires in a day.
  tangoPending: number;
  // Bumped whenever the watcher's poll sees the set of rounds waiting on this
  // user CHANGE. The Tango screen loads on its own schedule, so without this
  // the banner saying "it is your turn" arrived while the round on screen
  // still said it was theirs and offered no button to press.
  //
  // A counter, not the pending count: a turn can pass from you to them and
  // back with the count landing on the same number, and the screen still needs
  // to reload.
  tangoTick: number;
  setTangoPending: (n: number) => void;
  bumpTango: () => void;
  goToTango: () => void;
  setTab: (tab: TabKey) => void;
  // Go to Receive AND switch to the plain address, for the wallet screen's
  // prompt about coins sitting there.
  goToPlain: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  tab: 'wallet',
  plainRequest: 0,
  tangoPending: 0,
  tangoTick: 0,
  setTab: (tab) => set({ tab }),
  goToPlain: () =>
    set((s) => ({ tab: 'receive', plainRequest: s.plainRequest + 1 })),
  setTangoPending: (tangoPending) => set({ tangoPending }),
  bumpTango: () => set((s) => ({ tangoTick: s.tangoTick + 1 })),
  goToTango: () => set({ tab: 'tango' }),
}));
