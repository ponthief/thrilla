import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as api from '@services/api';
import { useAuthStore } from '@stores/authStore';
import { usePendingSends, getPendingSends } from '@stores/pendingSends';
import { usePushBanner } from '@stores/pushBanner';
import { paymentAlertsOn } from '@stores/notifyStore';

// Watches broadcast-but-unmined sends and announces the first confirmation.
//
// Mounted once at the app shell rather than on the wallet screen, so the notice
// arrives whichever tab the user is on. It polls only while something is
// pending and only while the app is in the foreground: one cheap txid lookup
// per send, not a scan.
//
// A push notification would be needed to reach a user who has closed the app —
// that requires the backend to watch the mempool and send it, and is not part
// of this.

const POLL_MS = 30_000;

// Hermes ships without full Intl, so Number.toLocaleString does not group —
// the same manual formatting the transaction list uses.
function groupThousands(n: number): string {
  return Math.floor(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function useSendConfirmations() {
  const adminkey = useAuthStore((s) => s.adminkey);
  const pending = usePendingSends((s) => s.sends);
  // Read inside the loop rather than closing over it, so a send registered
  // mid-cycle is picked up without restarting the timer.
  const hasPending = pending.length > 0;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!adminkey || !hasPending) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (AppState.currentState !== 'active') {
        timer.current = setTimeout(tick, POLL_MS);
        return;
      }
      for (const send of getPendingSends()) {
        try {
          const res = await api.getTxConfirmation(adminkey, send.txid, send.walletId);
          if (cancelled) return;
          if (res?.confirmed) {
            usePendingSends.getState().remove(send.txid);
            // Same switch that governs incoming-payment alerts: someone who
            // turned those off does not want this either.
            if (paymentAlertsOn()) {
              const amount =
                send.amountSats != null
                  ? `${groupThousands(send.amountSats)} sats`
                  : 'Your payment';
              usePushBanner.getState().show({
                title: 'Payment confirmed',
                body: `${amount} confirmed on-chain.`,
              });
            }
          }
        } catch {
          // Transient — the next tick retries. A send that never confirms is
          // dropped by the wallet-list sync, not here.
        }
      }
      if (!cancelled) timer.current = setTimeout(tick, POLL_MS);
    };

    timer.current = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [adminkey, hasPending]);
}
