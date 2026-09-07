import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import * as api from '@services/api';
import { useVerifyStore } from '@stores/verifyStore';

// Redeems an email-verification link that opened the app.
//
// The registration email points at the web app's /verify page. That URL is now
// also declared as an Android App Link (AndroidManifest.xml), so on a device
// with the app installed — and with the domain serving a matching
// assetlinks.json — the link opens here instead of a browser. Where it doesn't,
// nothing changes: the browser page redeems the token exactly as before, so
// this is an improvement that degrades to the old behaviour rather than a
// replacement that can strand anyone.
//
// Mounted at the app shell so it catches both cases: a cold start FROM the link
// (getInitialURL) and a link arriving while the app is already running (the
// 'url' event).

function tokenFrom(url: string): string | null {
  // Deliberately not a full URL parse. All that matters is the token query
  // parameter, and the manifest has already constrained the host and path —
  // anything reaching here matched them.
  const m = /[?&]token=([^&#]+)/.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export function useVerifyLink(): void {
  // Tokens already handled, so a re-delivered URL is not redeemed twice. The
  // second attempt would fail anyway — the server refuses a username that now
  // exists — and would report that failure over a registration that in fact
  // succeeded.
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const redeem = async (url: string | null) => {
      if (!url) return;
      const token = tokenFrom(url);
      if (!token || seen.current.has(token)) return;
      seen.current.add(token);

      const store = useVerifyStore.getState();
      store.begin();
      try {
        const res = await api.verifyRegistration(token);
        if (cancelled) return;
        if (res?.success && res.username) {
          store.succeed(res.username);
        } else {
          store.fail('Verification could not be completed.');
        }
      } catch (e: any) {
        if (cancelled) return;
        store.fail(
          e?.message || 'That verification link is invalid or has expired.',
        );
      }
    };

    // Cold start: the app was launched BY the link.
    Linking.getInitialURL()
      .then(redeem)
      .catch(() => {
        /* nothing to redeem */
      });

    // Warm: the app was already running, most likely on the "check your email"
    // screen with the password still in memory.
    const sub = Linking.addEventListener('url', ({ url }) => redeem(url));
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);
}
