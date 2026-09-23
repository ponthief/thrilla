import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as api from '@services/api';
import { useAuthStore } from '@stores/authStore';
import { useNavStore } from '@stores/navStore';
import { usePushBanner } from '@stores/pushBanner';
import { paymentAlertsOn } from '@stores/notifyStore';

// Watches the SP PayJoin queues so a turn does not go unnoticed.
//
// WHY, GIVEN THE BACKEND ALREADY PUSHES. The push arrives when the app is
// closed, which is the case it was built for. With the app OPEN, Android hands
// the message to us and PushBanner shows it — but only if a message was sent
// at that moment. Nothing covers the ordinary case of opening the app to a
// PayJoin that arrived an hour ago, or of the other side accepting while you
// are looking at a different tab. This does, and it also feeds the tab badge,
// which is the part that survives you dismissing everything.
//
// WHY BOTH QUEUES. An SP PayJoin hands the turn back and forth three times:
// the payee accepts, the payer signs, the payee signs. The payer needs telling
// as much as the payee does — "they accepted, sign now" is as easy to miss as
// the original request, and the whole thing expires in a day.
//
// Mirrors stores/payjoinspwatch.js on the web, deliberately: same interval,
// same turn table, same keyed-on-status rule. The two clients should not
// disagree about whose turn it is.

const POLL_MS = 20000;

// Mirrors payjoin_sp.py::whose_turn, which remains the authority. This only
// decides what to badge and announce; the endpoints refuse an out-of-turn call
// whatever this says.
const TURN: Record<string, 'payer' | 'payee'> = {
  PROPOSED: 'payee',
  // The advertised flow's extra step. The payee could not derive its payment
  // script when it posted the offer — half the input set did not exist yet —
  // so it has to come back once a contact claims. Missing this from the table
  // would leave an advertised PayJoin stalled with nobody told, which is the
  // one state this whole hook exists to prevent.
  CLAIMED: 'payee',
  CONTRIBUTED: 'payer',
  PAYER_SIGNED: 'payee',
};

export function usePayjoinWatch(): void {
  const inkey = useAuthStore((s) => s.inkey);
  const setPending = useNavStore((s) => s.setPayjoinPending);
  // Keyed on id AND status: the same PayJoin becomes your turn twice, and
  // keying on the id alone would announce only the first — the one where
  // nothing is at stake yet.
  const known = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    if (!inkey) {
      setPending(0);
      known.current = new Set();
      primed.current = false;
      return;
    }
    let cancelled = false;

    const poll = async () => {
      let data;
      try {
        data = await api.listPayjoinSp(inkey);
      } catch {
        return; // transient; the next tick tries again
      }
      if (cancelled) return;

      const mine = [
        ...(data.incoming || [])
          .filter((r) => TURN[r.status] === 'payee')
          .map((r) => ({ r, role: 'payee' as const })),
        ...(data.outgoing || [])
          .filter((r) => TURN[r.status] === 'payer')
          .map((r) => ({ r, role: 'payer' as const })),
      ];
      setPending(mine.length);

      const current = new Set(mine.map(({ r }) => `${r.id}:${r.status}`));
      // No banner on the first poll: those were already waiting before the app
      // opened, and announcing a backlog as if it just arrived is noise. The
      // badge shows them regardless.
      if (primed.current && paymentAlertsOn()) {
        for (const { r, role } of mine) {
          if (known.current.has(`${r.id}:${r.status}`)) continue;
          const who = role === 'payee' ? r.payer_username : r.payee_username;
          // No amount. A PayJoin's amount is as private as any other, and this
          // banner is drawn over whatever is on screen.
          const body =
            r.status === 'PROPOSED'
              ? `${who || 'Someone'} wants to PayJoin with you.`
              : r.status === 'CLAIMED'
                ? `${who || 'Someone'} took your offer — open it to carry on.`
                : r.status === 'CONTRIBUTED'
                  ? `${who || 'They'} accepted — it needs your signature.`
                  : `${who || 'They'} signed — one more from you finishes it.`;
          usePushBanner.getState().show({ title: 'PayJoin', body });
        }
      }
      known.current = current;
      primed.current = true;
    };

    poll();
    const timer = setInterval(poll, POLL_MS);
    // Coming back to the foreground is the moment most likely to have missed
    // something: JS timers do not run reliably in the background.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') poll();
    });

    return () => {
      cancelled = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [inkey, setPending]);
}
