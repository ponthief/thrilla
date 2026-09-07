import { useCallback, useEffect, useState } from 'react';
import * as api from '@services/api';
import { useAuthStore } from '@stores/authStore';

// The Silent Payments wallet for the current network.
//
// Extracted because the Receive screen now has two views that both need it —
// the address side and the plain-address side — and duplicating the load left
// two copies of the same "no wallet on this network yet" wording to drift apart.
export function useSilntWallet() {
  const inkey = useAuthStore((s) => s.inkey);

  const [wallet, setWallet] = useState<api.SilntWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!inkey) {
      setLoading(false);
      setError('Not logged in.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const chosen = api.pickSilntWallet(await api.getSilntWallets(inkey));
      setWallet(chosen);
      setError(
        chosen
          ? null
          : 'No Silent Payments wallet on this network yet. Open the Wallet tab to create one.',
      );
    } catch (e: any) {
      setError(e?.message || 'Could not load your wallet.');
    } finally {
      setLoading(false);
    }
  }, [inkey]);

  useEffect(() => {
    load();
  }, [load]);

  return { wallet, loading, error, reload: load };
}
