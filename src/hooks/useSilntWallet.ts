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
  // "No wallet on this network" is NOT an error, and conflating the two put a
  // Retry button in front of a request that had succeeded — retrying returned
  // the same answer, so the button did nothing. WalletScreen has always kept
  // this separate (spMissing); extracting the loader lost the distinction.
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!inkey) {
      setLoading(false);
      setError('Not logged in.');
      return;
    }
    setLoading(true);
    setError(null);
    setMissing(false);
    try {
      const chosen = api.pickSilntWallet(await api.getSilntWallets(inkey));
      setWallet(chosen);
      setMissing(!chosen);
    } catch (e: any) {
      setError(e?.message || 'Could not load your wallet.');
    } finally {
      setLoading(false);
    }
  }, [inkey]);

  useEffect(() => {
    load();
  }, [load]);

  return { wallet, loading, error, missing, reload: load };
}
