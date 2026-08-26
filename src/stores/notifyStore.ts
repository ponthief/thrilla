import { create } from 'zustand';
import * as notifyPrefs from '@services/notifyPrefs';

// Notification preferences for this device (see services/notifyPrefs.ts).
//
// `ready` guards the App.tsx registration effect: until the persisted pref is
// loaded we don't know whether to register this device for push, and acting on
// the optimistic default would register a token we're about to remove.
//
// Readable outside React via useNotifyStore.getState() — the push message
// handler and the catch-up scan both need it synchronously.
interface NotifyState {
  ready: boolean;
  paymentAlerts: boolean;
  refresh: () => Promise<void>;
  setPaymentAlerts: (v: boolean) => Promise<void>;
}

export const useNotifyStore = create<NotifyState>((set) => ({
  ready: false,
  paymentAlerts: true,

  refresh: async () => {
    const on = await notifyPrefs.paymentAlertsEnabled();
    set({ paymentAlerts: on, ready: true });
  },

  // Flip the UI immediately, then persist. Registering/unregistering the FCM
  // token is App.tsx's job (it owns the session key), so this only stores the
  // preference and lets that effect react to it.
  setPaymentAlerts: async (v) => {
    set({ paymentAlerts: v, ready: true });
    await notifyPrefs.setPaymentAlertsEnabled(v);
  },
}));

// Convenience for non-React callers deciding whether to raise a payment alert.
export function paymentAlertsOn(): boolean {
  return useNotifyStore.getState().paymentAlerts;
}
