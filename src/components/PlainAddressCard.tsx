import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import * as api from '@services/api';
import { useAuthStore } from '@stores/authStore';
import { getWalletKeys } from '@services/secureKeys';
import { loadPlainChain, PlainChainState } from '@services/plainChain';
import { useNavStore } from '@stores/navStore';
import { usePlainStatus, plainSpendSettled } from '@stores/plainStatus';
import QRCode from './QRCode';
import PlainSendModal from './PlainSendModal';
import PlainSetupModal from './PlainSetupModal';
import { colors } from '@/theme';

const PRIMARY = colors.primary;

function groupThousands(n: number): string {
  return Math.floor(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function truncateMiddle(s: string, head = 14, tail = 10): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

interface Props {
  wallet: api.SilntWallet;
}

/**
 * A plain bech32 pocket beside the Silent Payments wallet: receive to it, and
 * pay straight out of it, for anyone who can't handle an sp1… address.
 *
 * The coins never enter the SP wallet, and there is deliberately no "move them
 * in" button. Doing so would be a second transaction and a second fee for coins
 * that are only passing through, and it would tie them to an output sitting
 * alongside the wallet's own. Anyone who does want them there can send to their
 * own SP address — it's a destination like any other.
 *
 * A fresh receive address every time. The device walks its own BIP-84 chain from
 * the account key held in the keystore and shows the first address with no
 * history, so two payments never share one. The server is asked about a window
 * of derived addresses but never given the xpub, so it cannot derive the next.
 *
 * Collapsed by default: the Silent Payments address above needs none of this
 * machinery and should be used wherever the sender will accept it.
 */
export default function PlainAddressCard({ wallet }: Props) {
  const inkey = useAuthStore((s) => s.inkey);
  // A payment broadcast from here that the chain index hasn't caught up with.
  // Its inputs are spent, but a mempool spend takes a moment to reach Fulcrum,
  // and without this the card reads that stale answer back as spendable and
  // offers coins that are already on their way — building a conflicting
  // transaction. Cleared once a walk disagrees with the balance at broadcast.
  const pendingSpend = usePlainStatus((s) => s.pendingSpend);

  const [open, setOpen] = useState(false);
  const [accountXprv, setAccountXprv] = useState<string | null>(null);
  const [chain, setChain] = useState<PlainChainState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [spendOpen, setSpendOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  // Bumped by the prompt on the wallet screen, which is how most people will
  // arrive here — the card is otherwise collapsed and easily missed.
  const plainRequest = useNavStore((s) => s.plainRequest);
  useEffect(() => {
    if (plainRequest > 0) setOpen(true);
  }, [plainRequest]);

  const refresh = useCallback(async () => {
    if (!inkey) return;
    // Wallets stored before the plain chain existed have no account key; those
    // need the recovery phrase once, via PlainSetupModal.
    const keys = await getWalletKeys(wallet.id);
    const xprv = keys?.sweepAccount || null;
    setAccountXprv(xprv);
    if (!xprv) {
      setChain(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await loadPlainChain(inkey, wallet.id, xprv, wallet.network);
      setChain(next);
      // Drop the in-flight marker once the index reflects the payment (or once
      // waiting for it stops being worth blocking on).
      if (plainSpendSettled(usePlainStatus.getState().pendingSpend, next.confirmedSats)) {
        usePlainStatus.getState().clearSpent();
      }
      // Share what we just learned, so the wallet screen's prompt reflects a
      // manual refresh instead of waiting for the background watcher's poll.
      usePlainStatus.getState().set({
        walletId: wallet.id,
        spendableSats: next.confirmedSats,
        unconfirmedSats: next.unconfirmedSats,
      });
    } catch (e: any) {
      setError(e?.message || 'Could not check your plain addresses.');
    } finally {
      setLoading(false);
    }
  }, [inkey, wallet.id, wallet.network]);

  useEffect(() => {
    // Only reach for the chain index once the user has actually opened this —
    // it is a round trip for a card most people will never use.
    if (open) refresh();
  }, [open, refresh]);

  const onCopy = useCallback(() => {
    if (!chain) return;
    Clipboard.setString(chain.receiveAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [chain]);

  if (!open) {
    return (
      <TouchableOpacity style={styles.collapsed} onPress={() => setOpen(true)}>
        <View style={styles.collapsedText}>
          <Text style={styles.collapsedTitle}>Need a plain bitcoin address?</Text>
          <Text style={styles.collapsedSub}>
            For senders that can't pay a Silent Payments address.
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    );
  }

  const sats = chain?.confirmedSats ?? 0;
  const inFlight = !!pendingSpend;
  const hasCoins = sats > 0 && !!accountXprv && !!chain?.fundedIndices.length;
  const canSend = !inFlight && hasCoins;

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Plain address</Text>
        <TouchableOpacity onPress={() => setOpen(false)}>
          <Text style={styles.hideBtn}>Hide</Text>
        </TouchableOpacity>
      </View>

      {!accountXprv ? (
        <>
          <Text style={styles.caption}>
            This wallet predates plain addresses. Enter your recovery phrase once
            to set them up — after that it's handled on this device.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setSetupOpen(true)}>
            <Text style={styles.primaryBtnText}>Set up</Text>
          </TouchableOpacity>
        </>
      ) : loading && !chain ? (
        <ActivityIndicator color={PRIMARY} style={styles.spinner} />
      ) : chain ? (
        <>
          <QRCode value={chain.receiveAddress} size={200} />
          <Text style={styles.mono}>{truncateMiddle(chain.receiveAddress, 16, 12)}</Text>
          <Text style={styles.caption}>
            A plain bitcoin address for senders that can't pay a Silent Payments
            address. Unused — a new one appears once this is paid, so two
            payments are never linked by sharing an address.
          </Text>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onCopy}>
              <Text style={styles.secondaryBtnText}>
                {copied ? 'Copied' : 'Copy address'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={refresh}
              disabled={loading}>
              <Text style={styles.secondaryBtnText}>
                {loading ? 'Checking…' : 'Refresh'}
              </Text>
            </TouchableOpacity>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {pendingSpend ? (
            <View style={styles.balanceBox}>
              <Text style={styles.balanceLabel}>Payment on its way</Text>
              <Text style={styles.balanceHint}>
                Waiting for the chain index to catch up
              </Text>
            </View>
          ) : (
            <View style={styles.balanceBox}>
              <Text style={styles.balanceLabel}>Available here</Text>
              <Text style={styles.balanceValue}>{groupThousands(sats)} sats</Text>
              {chain.unconfirmedSats > 0 ? (
                <Text style={styles.balanceHint}>
                  + {groupThousands(chain.unconfirmedSats)} sats unconfirmed —
                  spendable once mined
                </Text>
              ) : null}
              {chain.fundedIndices.length > 1 ? (
                <Text style={styles.balanceHint}>
                  across {chain.fundedIndices.length} addresses
                </Text>
              ) : null}
            </View>
          )}

          <TouchableOpacity
            style={[styles.primaryBtn, !canSend && styles.btnDisabled]}
            onPress={() => setSpendOpen(true)}
            disabled={!canSend}>
            <Text style={styles.primaryBtnText}>Send these coins</Text>
          </TouchableOpacity>
          {hasCoins && !inFlight ? (
            <Text style={styles.hint}>
              Paid straight from here, so these coins are never linked to the rest
              of your balance. To hold them in the wallet instead, send them to
              your own Silent Payments address.
            </Text>
          ) : null}
          {!hasCoins && !inFlight ? (
            <Text style={styles.hint}>
              Nothing here yet. Send coins to the address above, then check back
              once they confirm.
            </Text>
          ) : null}
        </>
      ) : (
        <>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity style={styles.primaryBtn} onPress={refresh}>
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
        </>
      )}

      {spendOpen && accountXprv && chain ? (
        <PlainSendModal
          visible
          wallet={wallet}
          accountXprv={accountXprv}
          chain={chain}
          // Re-check on the way out, not the moment it is broadcast: refreshing
          // under an open modal churns the props it was opened with, and the
          // chain index has not seen the spend that soon anyway. Until then the
          // in-flight marker above is what the card goes on.
          onClose={() => {
            setSpendOpen(false);
            refresh();
          }}
          onSpent={(txid) =>
            usePlainStatus.getState().markSpent({
              txid,
              balanceAtSpend: chain.confirmedSats,
              at: Date.now(),
            })
          }
        />
      ) : null}

      {setupOpen ? (
        <PlainSetupModal
          visible
          wallet={wallet}
          onClose={() => setSetupOpen(false)}
          onReady={refresh}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  collapsed: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginTop: 16,
  },
  collapsedText: { flex: 1 },
  collapsedTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  collapsedSub: { fontSize: 12, color: colors.muted, marginTop: 3 },
  chevron: { fontSize: 24, color: colors.faint, marginLeft: 12 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginTop: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  hideBtn: { fontSize: 13, fontWeight: '600', color: colors.muted },
  mono: { fontFamily: 'monospace', fontSize: 13, color: colors.text, marginTop: 14 },
  caption: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 17,
  },
  actionRow: { flexDirection: 'row', marginTop: 16, alignSelf: 'stretch' },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600', color: colors.text },
  spinner: { marginTop: 16 },
  balanceBox: {
    alignSelf: 'stretch',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
    alignItems: 'center',
  },
  balanceLabel: { fontSize: 12, color: colors.muted },
  balanceValue: { fontSize: 22, fontWeight: '700', color: colors.text, marginTop: 4 },
  balanceHint: { fontSize: 11, color: colors.faint, marginTop: 6, textAlign: 'center' },
  primaryBtn: {
    alignSelf: 'stretch',
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 18,
  },
  primaryBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.4 },
  hint: { fontSize: 12, color: colors.faint, marginTop: 10, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 13, marginTop: 14, textAlign: 'center' },
});
