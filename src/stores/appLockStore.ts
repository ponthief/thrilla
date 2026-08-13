import { create } from 'zustand';
import * as appLock from '@services/appLock';
import * as appPin from '@services/appPin';

// UI state for the app lock. The lock can be backed by the device biometric/
// passcode (appLock) OR an in-app PIN (appPin). `enabled` is on if either is
// set; `pinSet` selects the PIN unlock UI (and is required for duress).
// `locked` is transient (set when backgrounded, cleared on unlock).
interface AppLockState {
  ready: boolean; // has the persisted pref been loaded yet
  bioEnabled: boolean; // device biometric/passcode lock is on
  pinSet: boolean; // an in-app PIN is configured → unlock via PIN pad
  enabled: boolean; // derived: bioEnabled || pinSet (does the app lock at all)
  locked: boolean;
  unlocking: boolean; // a prompt is in flight — suppress re-lock races
  refresh: () => Promise<void>;
  setBioEnabled: (v: boolean) => void;
  setPinSet: (v: boolean) => void;
  lock: () => void;
  unlock: () => void;
  setUnlocking: (v: boolean) => void;
}

export const useAppLockStore = create<AppLockState>((set) => ({
  ready: false,
  bioEnabled: false,
  pinSet: false,
  enabled: false,
  locked: false,
  unlocking: false,

  refresh: async () => {
    const [bio, pin] = await Promise.all([appLock.isEnabled(), appPin.hasPin()]);
    set({ bioEnabled: bio, pinSet: pin, enabled: bio || pin, ready: true });
  },

  // Each lock method has its own flag; `enabled` (does the app lock at all) is
  // kept as their OR so App.tsx has a single source of truth.
  setBioEnabled: (v) =>
    set((s) => ({ bioEnabled: v, enabled: v || s.pinSet, locked: false })),
  setPinSet: (v) =>
    set((s) => ({ pinSet: v, enabled: v || s.bioEnabled, locked: false })),
  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false, unlocking: false }),
  setUnlocking: (v) => set({ unlocking: v }),
}));
