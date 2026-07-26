import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '@stores/authStore';
import { msSinceActivity, resetActivity } from '@services/sessionActivity';

// Idle session timeout, mirroring the web app (stores/auth.js). Sessions expire
// after this long without genuine user interaction, forcing re-authentication.
// Web uses 30 minutes; keep the two in sync when changing.
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Enforce the idle timeout while authenticated: refreshes the timer on entry,
// checks every 30s, and re-checks immediately whenever the app returns to the
// foreground (covers the app being backgrounded past the timeout). Root-level
// touch capture (App.tsx) feeds activity via touchActivity().
export function useIdleLogout(): void {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Fresh timer when the authenticated session begins.
    resetActivity();

    const enforce = () => {
      if (msSinceActivity() > IDLE_TIMEOUT_MS) {
        logout('You were signed out after a period of inactivity.');
      }
    };

    const interval = setInterval(enforce, 30 * 1000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') enforce();
    });

    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [isAuthenticated, logout]);
}
