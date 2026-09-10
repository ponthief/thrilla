import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as api from '@services/api';
import { useAuthStore } from '@stores/authStore';
import { useSpendAlerts } from '@stores/spendAlertStore';

// Keeps the "coins left this wallet and it did not send them" warning on screen
// for as long as the server still considers it unacknowledged.
//
// This hook is NOT the detector. The server finds unexpected spends on its own
// background sweep, watching the P2TR scripts it already stores in silnt.utxos,
// and it does that whether or not any client is running (see
// helpers/spend_watch.py). The push is the urgent channel because it reaches a
// closed app. This is the backstop for the push being missed, swiped away, or
// switched off: whichever way the user next opens the app, the warning is
// there. So the interval is set by "how soon after opening should I see it",
// not by how fast a spend can be found.
const POLL_MS = 2 * 60 * 1000;

export function useSpendWatch() {
  const inkey = useAuthStore((s) => s.inkey);
  const refreshTick = useSpendAlerts((s) => s.refreshTick);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!inkey) {
      useSpendAlerts.getState().clear();
      return;
    }
    let cancelled = false;
    let walletId: string | null = null;

    const tick = async () => {
      if (cancelled) return;
      if (AppState.currentState !== 'active') {
        timer.current = setTimeout(tick, POLL_MS);
        return;
      }
      try {
        if (!walletId) {
          const wallet = api.pickSilntWallet(await api.getSilntWallets(inkey));
          walletId = wallet?.id ?? null;
        }
        if (walletId) {
          const { alerts, explorerBase } = await api.getSpendAlerts(inkey, walletId);
          if (!cancelled) {
            useSpendAlerts.getState().set({ walletId, alerts, explorerBase });
          }
        }
      } catch {
        // A failed poll leaves whatever is already on screen alone. Clearing
        // the alerts because the network dropped would take the warning down at
        // exactly the wrong moment.
      }
      if (!cancelled) timer.current = setTimeout(tick, POLL_MS);
    };

    tick();

    // Coming back to the foreground checks immediately rather than waiting out
    // the rest of an interval that was ticking while nobody could see it.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (timer.current) clearTimeout(timer.current);
        tick();
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [inkey, refreshTick]);
}
