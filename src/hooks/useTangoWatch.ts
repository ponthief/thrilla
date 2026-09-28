import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as api from '@services/api';
import { useAuthStore } from '@stores/authStore';
import { useNavStore } from '@stores/navStore';
import { usePushBanner } from '@stores/pushBanner';
import { alertsOn } from '@stores/notifyStore';
// One turn table for every Tango surface — see services/tango.ts.
import { isMyTurn } from '@services/tangoTurns';

// Watches the Tango queue so a turn does not go unnoticed.
//
// WHY, GIVEN THE BACKEND ALREADY PUSHES. The push arrives when the app is
// closed, which is the case it was built for. With the app OPEN, Android hands
// the message to us and PushBanner shows it — but only if a message was sent
// at that moment. Nothing covers the ordinary case of opening the app to a
// round that arrived an hour ago, or of the other side accepting while you are
// looking at a different tab. This does, and it also feeds the tab badge,
// which is the part that survives you dismissing everything.
//
// WHY EVERY TURN AND NOT JUST THE INVITATION. A Tango hands the turn back and
// forth three times: B matches and contributes, A signs, B signs. A round that
// stalls at A_SIGNED is worse than one that never started — both sides' coins
// are reserved against it until it expires.

const POLL_MS = 20000;

export function useTangoWatch(): void {
  const inkey = useAuthStore((s) => s.inkey);
  const setPending = useNavStore((s) => s.setTangoPending);
  // Tells the Tango screen to reload; see stores/navStore.
  const bump = useNavStore((s) => s.bumpTango);
  // Keyed on id AND status: the same round becomes your turn twice, and keying
  // on the id alone would announce only the first — the one where nothing is
  // at stake yet.
  const known = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  // EVERY round, not just the ones waiting on you.
  //
  // The reload signal used to come off the my-turn set, which never moves when
  // the other side cancels a round that was waiting on THEM: the cancellation
  // push arrived, and the screen behind it went on showing the round as live
  // with its coins still held. Their status changing is the news, whoever the
  // turn belonged to.
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!inkey) {
      setPending(0);
      known.current = new Set();
      seen.current = new Set();
      primed.current = false;
      return;
    }
    let cancelled = false;

    const poll = async () => {
      let data;
      try {
        data = await api.listTango(inkey);
      } catch {
        return; // transient; the next tick tries again
      }
      if (cancelled) return;

      const rounds = data.rounds || [];
      const mine = rounds.filter((r) => isMyTurn(r.status, r.role));
      setPending(mine.length);

      const current = new Set(mine.map((r) => `${r.id}:${r.status}`));
      // No banner on the first poll: those were already waiting before the app
      // opened, and announcing a backlog as if it just arrived is noise. The
      // badge shows them regardless.
      //
      // Gated on the one Alerts switch, like every other announcement. The
      // badge is not gated: it is a count on a tab, not an interruption.
      if (primed.current && alertsOn()) {
        for (const r of mine) {
          if (known.current.has(`${r.id}:${r.status}`)) continue;
          const who =
            (r.role === 'b' ? r.a_username : r.b_username) || 'Someone';
          // No amount. A Tango's denomination is as private as any other
          // amount, and this banner is drawn over whatever is on screen.
          const body =
            r.status === 'PROPOSED'
              ? `${who} wants to Tango with you.`
              : r.status === 'ACCEPTED'
                ? `${who} matched you — it needs your approval.`
                : `${who} approved it — one more from you sends it.`;
          usePushBanner.getState().show({ title: 'Tango', body });
        }
      }
      // Whatever moved, on any round. The screen showing one needs the same
      // news the banner just got — and for a cancellation by the other side,
      // it is the only news there is.
      const all = new Set(rounds.map((r) => `${r.id}:${r.status}`));
      const changed =
        all.size !== seen.current.size ||
        [...all].some((k) => !seen.current.has(k));
      seen.current = all;
      known.current = current;
      primed.current = true;
      if (changed) bump();
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
  }, [inkey, setPending, bump]);
}
