import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '@stores/authStore';
import { useAppLockStore } from '@stores/appLockStore';
import { msSinceActivity, resetActivity } from '@services/sessionActivity';

// Idle timeout: lock the app after this long without genuine user interaction.
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// This used to sign the user out, which made sense when signing back in was the
// only way in: the session lived in memory and the password was the gate. Now
// the session is kept on the device and the gate is the app lock, so the timer
// LOCKS. Signing out would additionally erase the stored session, meaning an
// idle phone in a pocket cost the user their password on the next launch —
// punishing them for the timeout rather than protecting them.
//
// The protection is unchanged in substance: after ten idle minutes the wallet
// is behind a PIN or biometric prompt either way, and the duress PIN still
// answers coercion. Signing out is now only a deliberate act (Settings), a
// duress unlock, or the server rejecting the stored keys.
//
// Checks every 30s and again whenever the app returns to the foreground, which
// covers being backgrounded past the timeout. Root-level touch capture in
// App.tsx feeds activity via touchActivity().
export function useIdleLock(): void {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const lockEnabled = useAppLockStore((s) => s.enabled);
  const lock = useAppLockStore((s) => s.lock);

  useEffect(() => {
    // Nothing to lock, or no lock configured to lock it with. The latter cannot
    // normally happen — a stored session requires one (see App.tsx) — but a
    // wallet mid-setup has no lock yet and must not be trapped behind one.
    if (!isAuthenticated || !lockEnabled) return;

    // Fresh timer when the session begins.
    resetActivity();

    const enforce = () => {
      if (msSinceActivity() > IDLE_TIMEOUT_MS) lock();
    };

    const interval = setInterval(enforce, 30 * 1000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') enforce();
    });

    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [isAuthenticated, lockEnabled, lock]);
}
