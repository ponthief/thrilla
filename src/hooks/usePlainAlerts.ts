import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as api from '@services/api';
import { useAuthStore } from '@stores/authStore';
import { getWalletKeys } from '@services/secureKeys';
import { loadPlainChain } from '@services/plainChain';
import { plainAddressAt } from '@services/spKeys';
import { lastAnnounced, setLastAnnounced } from '@services/plainAlerts';
import { usePendingSends } from '@stores/pendingSends';
import { usePushBanner } from '@stores/pushBanner';
import { usePlainStatus } from '@stores/plainStatus';
import { useNotifyStore } from '@stores/notifyStore';

// Watches the wallet's plain BIP-84 chain and says when coins land on it.
//
// Nothing else would tell the user. A Silent Payments payment is found by the
// scanner and announced; a bech32 payment to this chain is invisible until
// somebody opens the collapsed card on Receive and looks, so it could sit there
// for weeks unnoticed.
//
// Mounted at the app shell, so the notice arrives whichever tab the user is on,
// and only while the app is in the FOREGROUND. Reaching the user with the app
// closed would need the server to watch these addresses, which means storing
// them there permanently — a different trade than the one this feature makes,
// where the server is told an address only when it is asked to look.

const POLL_MS = 5 * 60 * 1000;
// Back off when there is nothing to watch — no wallet on this network, or a
// wallet predating the plain chain and so without an account key. Still checked
// occasionally, since either can change while the app runs.
const IDLE_POLL_MS = 30 * 60 * 1000;
// Cap what a routine poll asks about. The chain walk can legitimately return
// more used indices than this over a wallet's life; the newest are the ones a
// sender is likely to pay again.
const MAX_WATCHED = 10;

// Hermes ships without full Intl, so Number.toLocaleString does not group.
function groupThousands(n: number): string {
  return Math.floor(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

interface Watch {
  walletId: string;
  network: string;
  accountXprv: string;
  indices: number[];
  // Whether each watched index had history last time we looked. A watched
  // address becoming used means the receive address has moved on, so the narrow
  // poll is no longer looking at the right place and the chain needs re-walking.
  used: Set<number>;
}

export function usePlainAlerts() {
  const inkey = useAuthStore((s) => s.inkey);
  const confirmedTick = usePendingSends((s) => s.confirmedTick);
  // Subscribed rather than read once, so turning alerts on starts the watch
  // and turning them off stops it, without waiting for a restart.
  const alertsOn = useNotifyStore((s) => s.paymentAlerts);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // No alerts wanted, no reason to poll for them.
    if (!inkey || !alertsOn) return;

    let cancelled = false;
    let watch: Watch | null = null;

    // The wallet screen prompts from this, so it does not have to walk the
    // chain itself just to know whether there is anything to prompt about.
    const publish = (walletId: string, spendable: number, unconfirmed: number) =>
      usePlainStatus.getState().set({
        walletId,
        spendableSats: spendable,
        unconfirmedSats: unconfirmed,
      });

    // Full gap-limit walk: establishes which addresses to watch and where the
    // receive address currently sits.
    const rewalk = async (): Promise<number | null> => {
      const wallets = await api.getSilntWallets(inkey);
      const wallet = api.pickSilntWallet(wallets);
      if (!wallet) return null;
      const keys = await getWalletKeys(wallet.id);
      // Wallets predating the plain chain have no account key; the card offers
      // to derive one, and until then there is nothing to watch.
      if (!keys?.sweepAccount) return null;

      const chain = await loadPlainChain(
        inkey,
        wallet.id,
        keys.sweepAccount,
        wallet.network,
      );
      const indices = [...new Set([chain.receiveIndex, ...chain.usedIndices])]
        .sort((a, b) => b - a)
        .slice(0, MAX_WATCHED);
      watch = {
        walletId: wallet.id,
        network: wallet.network,
        accountXprv: keys.sweepAccount,
        indices,
        used: new Set(chain.usedIndices),
      };
      publish(wallet.id, chain.confirmedSats, chain.unconfirmedSats);
      return chain.confirmedSats;
    };

    const announce = async (walletId: string, sats: number) => {
      const before = await lastAnnounced(walletId);
      if (sats <= before) {
        // Includes the drop after spending, which re-arms the alert.
        if (sats !== before) await setLastAnnounced(walletId, sats);
        return;
      }
      await setLastAnnounced(walletId, sats);
      usePushBanner.getState().show({
        title: 'Coins arrived',
        body: `${groupThousands(sats)} sats on your plain address, ready to send.`,
      });
    };

    const tick = async () => {
      if (cancelled) return;
      if (AppState.currentState !== 'active') {
        timer.current = setTimeout(tick, POLL_MS);
        return;
      }
      try {
        let sats: number | null;
        if (!watch) {
          sats = await rewalk();
        } else {
          // Narrow poll: just the addresses already known to matter, rather
          // than walking the whole chain every five minutes.
          const asked = watch.indices.map((i) => ({
            index: i,
            address: plainAddressAt(watch!.accountXprv, watch!.network, i),
          }));
          const res = await api.getPlainPreview(
            inkey,
            watch.walletId,
            asked.map((a) => a.address),
          );
          // Pair by address, not by position: attributing an answer to the wrong
          // derivation index would watch the wrong address.
          const byAddress = new Map(res.addresses.map((a) => [a.address, a]));
          const newlyUsed = asked.some(
            (a) => byAddress.get(a.address)?.used && !watch!.used.has(a.index),
          );
          // The receive address was paid, so it is no longer the receive
          // address — re-walk to find the new one and pick up its balance.
          if (newlyUsed) {
            sats = await rewalk();
          } else {
            sats = res.confirmed_sats;
            publish(watch.walletId, res.confirmed_sats, res.unconfirmed_sats);
          }
        }
        if (!cancelled && watch && sats != null) {
          await announce(watch.walletId, sats);
        }
      } catch {
        // Transient — the next tick retries. Never disturb the app for this.
      }
      if (!cancelled) {
        timer.current = setTimeout(tick, watch ? POLL_MS : IDLE_POLL_MS);
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // confirmedTick restarts the watch when wallet activity confirms, so the
    // balance it reads (and the announced mark) reset without waiting a poll.
  }, [inkey, alertsOn, confirmedTick]);
}
