import { create } from 'zustand';
import * as pref from '@services/balancePrivacy';

// Hide balances: stars in place of every figure that says what you hold.
//
// WHAT IS HIDDEN, AND WHAT IS NOT. Holdings are hidden — the wallet balance,
// the coin list, the plain-address balance, the amounts in the transaction
// list. A send in progress is not: the amount, fee and total on the confirm
// screen are what you are about to authorise, and masking those would make the
// screen unusable rather than private. The same goes for an invoice you just
// asked someone to pay.
//
// This is shoulder-surfing cover, not secrecy. Anyone holding the unlocked
// phone can turn it off by tapping the balance, and the figures are on the
// chain regardless. The App Lock is the control that keeps someone out.

interface BalancePrivacyState {
  ready: boolean;
  hidden: boolean;
  refresh: () => Promise<void>;
  toggle: () => Promise<void>;
  setHidden: (v: boolean) => Promise<void>;
}

export const useBalancePrivacy = create<BalancePrivacyState>((set, get) => ({
  ready: false,
  hidden: false,

  refresh: async () => {
    set({ hidden: await pref.balancesHidden(), ready: true });
  },

  toggle: async () => {
    await get().setHidden(!get().hidden);
  },

  // Flip the UI first: a tap on the balance has to feel immediate, and the
  // write is only about surviving a restart.
  setHidden: async (v) => {
    set({ hidden: v, ready: true });
    await pref.setBalancesHidden(v);
  },
}));

/** What a hidden figure shows instead. */
export const MASK = '*****';

/** True when balances should be starred out. */
export function useBalancesHidden(): boolean {
  return useBalancePrivacy((s) => s.hidden);
}
