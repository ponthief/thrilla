import { create } from 'zustand';
import * as notifyPrefs from '@services/notifyPrefs';

// Notification preferences for this device (see services/notifyPrefs.ts).
//
// `ready` guards the App.tsx registration effect: until the persisted pref is
// loaded we don't know whether to register this device for push, and acting on
// the optimistic default would register a token we're about to remove.
//
// Readable outside React via useNotifyStore.getState() — the push message
// handler, the catch-up scan and the Tango poll all need it synchronously.
interface NotifyState {
  ready: boolean;
  alerts: boolean;
  refresh: () => Promise<void>;
  setAlerts: (v: boolean) => Promise<void>;
}

export const useNotifyStore = create<NotifyState>((set) => ({
  ready: false,
  alerts: true,

  refresh: async () => {
    const on = await notifyPrefs.alertsEnabled();
    set({ alerts: on, ready: true });
  },

  // Flip the UI immediately, then persist. Registering/unregistering the FCM
  // token is App.tsx's job (it owns the session key), so this only stores the
  // preference and lets that effect react to it.
  setAlerts: async (v) => {
    set({ alerts: v, ready: true });
    await notifyPrefs.setAlertsEnabled(v);
  },
}));

// Convenience for non-React callers deciding whether to raise an alert — a
// payment arriving, a send confirming, or a Tango waiting on you.
export function alertsOn(): boolean {
  return useNotifyStore.getState().alerts;
}
