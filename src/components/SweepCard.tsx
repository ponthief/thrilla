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
import { loadSweepChain, SweepChainState } from '@services/sweepChain';
import { usePendingSends } from '@stores/pendingSends';
import QRCode from './QRCode';
import SweepModal, { SweepSetupModal } from './SweepModal';
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
 * The wallet's plain bech32 address, for paying in from anything that can't
 * send to a Silent Payments address — an exchange withdrawal, most often.
 *
 * A fresh address every time. The device walks its own BIP-84 chain from the
 * account key held in the keystore and shows the first address with no history,
 * so two payments never share one. The server is asked about a window of derived
 * addresses but never given the xpub, so it cannot derive the next.
 *
 * Collapsed by default: the Silent Payments address above needs none of this
 * machinery and should be used wherever the sender will accept it.
 */
export default function SweepCard({ wallet }: Props) {
  const inkey = useAuthStore((s) => s.inkey);
  const confirmedTick = usePendingSends((s) => s.confirmedTick);
  // A sweep this wallet has broadcast but that hasn't confirmed yet. Its inputs
  // are spent, but the chain index can still be listing them as unspent for a
  // little while — a mempool spend takes a moment to reach Fulcrum. Without
  // this, the card reads that stale answer back as "there are funds to sweep"
  // and offers to sweep coins that are already on their way, which would build
  // a conflicting transaction. The watcher clears the entry on the first
  // confirmation.
  const pendingSweep = usePendingSends((s) =>
    s.sends.find((x) => x.kind === 'sweep' && x.walletId === wallet.id),
  );

  const [open, setOpen] = useState(false);
  const [accountXprv, setAccountXprv] = useState<string | null>(null);
  const [chain, setChain] = useState<SweepChainState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sweepOpen, setSweepOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!inkey) return;
    // Wallets stored before the sweep chain existed have no account key; those
    // need the recovery phrase once, via SweepSetupModal.
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
      setChain(await loadSweepChain(inkey, wallet.id, xprv, wallet.network));
    } catch (e: any) {
      setError(e?.message || 'Could not check your sweep addresses.');
    } finally {
      setLoading(false);
    }
  }, [inkey, wallet.id, wallet.network]);

  useEffect(() => {
    // Only reach for the chain index once the user has actually opened this —
    // it is a round trip for a card most people will never use. confirmedTick
    // re-checks after a sweep confirms, so the balance clears and a new receive
    // address appears without a manual refresh.
    if (open) refresh();
  }, [open, confirmedTick, refresh]);

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
          <Text style={styles.collapsedTitle}>Paying in from an exchange?</Text>
          <Text style={styles.collapsedSub}>
            Use a plain bitcoin address, then sweep it in.
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    );
  }

  const sats = chain?.confirmedSats ?? 0;
  const canSweep =
    !pendingSweep && sats > 0 && !!accountXprv && !!chain?.fundedIndices.length;

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Sweep address</Text>
        <TouchableOpacity onPress={() => setOpen(false)}>
          <Text style={styles.hideBtn}>Hide</Text>
        </TouchableOpacity>
      </View>

      {!accountXprv ? (
        <>
          <Text style={styles.caption}>
            This wallet predates sweep addresses. Enter your recovery phrase once
            to set them up — after that it's handled on this device.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setSetupOpen(true)}>
            <Text style={styles.primaryBtnText}>Set up sweeping</Text>
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

          {pendingSweep ? (
            <View style={styles.balanceBox}>
              <Text style={styles.balanceLabel}>Sweep on its way</Text>
              <Text style={styles.balanceValue}>
                {groupThousands(pendingSweep.amountSats ?? 0)} sats
              </Text>
              <Text style={styles.balanceHint}>
                Lands in your balance once it confirms
              </Text>
            </View>
          ) : (
            <View style={styles.balanceBox}>
              <Text style={styles.balanceLabel}>Waiting to be swept</Text>
              <Text style={styles.balanceValue}>{groupThousands(sats)} sats</Text>
              {chain.unconfirmedSats > 0 ? (
                <Text style={styles.balanceHint}>
                  + {groupThousands(chain.unconfirmedSats)} sats unconfirmed —
                  sweepable once mined
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
            style={[styles.primaryBtn, !canSweep && styles.btnDisabled]}
            onPress={() => setSweepOpen(true)}
            disabled={!canSweep}>
            <Text style={styles.primaryBtnText}>Sweep into wallet</Text>
          </TouchableOpacity>
          {!canSweep && !pendingSweep ? (
            <Text style={styles.hint}>
              Nothing to sweep yet. Send coins to the address above, then check
              back once they confirm.
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

      {sweepOpen && accountXprv && chain ? (
        <SweepModal
          visible
          wallet={wallet}
          accountXprv={accountXprv}
          fundedIndices={chain.fundedIndices}
          // Re-check on the way out, not the moment the sweep is broadcast:
          // refreshing under an open modal churns the props it was opened with,
          // and the chain index has not seen the spend that soon anyway. Until
          // then the pending-sweep entry above is what the card goes on.
          onClose={() => {
            setSweepOpen(false);
            refresh();
          }}
        />
      ) : null}

      {setupOpen ? (
        <SweepSetupModal
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
