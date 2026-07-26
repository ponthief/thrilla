import { create } from 'zustand';
import * as appLock from '@services/appLock';

// UI state for the biometric app lock. `enabled` is the persisted preference;
// `locked` is transient (set when the app is backgrounded, cleared on unlock).
interface AppLockState {
  ready: boolean; // has the persisted pref been loaded yet
  enabled: boolean;
  locked: boolean;
  unlocking: boolean; // a prompt is in flight — suppress re-lock races
  refresh: () => Promise<void>;
  setEnabled: (v: boolean) => void;
  lock: () => void;
  unlock: () => void;
  setUnlocking: (v: boolean) => void;
}

export const useAppLockStore = create<AppLockState>((set) => ({
  ready: false,
  enabled: false,
  locked: false,
  unlocking: false,

  refresh: async () => {
    const enabled = await appLock.isEnabled();
    set({ enabled, ready: true });
  },

  setEnabled: (v) => set({ enabled: v, locked: false }),
  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false, unlocking: false }),
  setUnlocking: (v) => set({ unlocking: v }),
}));
