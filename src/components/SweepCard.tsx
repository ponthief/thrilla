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
import { usePendingSends } from '@stores/pendingSends';
import QRCode from './QRCode';
import SweepModal from './SweepModal';
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
 * Collapsed by default. It is the lesser address in every way that matters:
 * it is reused, so anyone watching the chain can link everything ever sent to
 * it, and the server has to ask a chain index about it by name. The Silent
 * Payments address above has neither property, and should be used wherever the
 * sender will accept it.
 */
export default function SweepCard({ wallet }: Props) {
  const inkey = useAuthStore((s) => s.inkey);
  const confirmedTick = usePendingSends((s) => s.confirmedTick);

  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [preview, setPreview] = useState<api.SweepPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [modal, setModal] = useState<'reveal' | 'sweep' | null>(null);

  // Wallets created before the sweep address was derived have no cached copy;
  // those need the recovery phrase once to reveal it.
  const loadAddress = useCallback(async () => {
    const keys = await getWalletKeys(wallet.id);
    setAddress(keys?.refundAddress || null);
    return keys?.refundAddress || null;
  }, [wallet.id]);

  const loadPreview = useCallback(
    async (addr: string) => {
      if (!inkey) return;
      setLoading(true);
      setError(null);
      try {
        setPreview(await api.getSweepPreview(inkey, wallet.id, addr));
      } catch (e: any) {
        setError(e?.message || 'Could not check this address.');
      } finally {
        setLoading(false);
      }
    },
    [inkey, wallet.id],
  );

  const refresh = useCallback(async () => {
    const addr = await loadAddress();
    if (addr) await loadPreview(addr);
  }, [loadAddress, loadPreview]);

  useEffect(() => {
    // Only reach for the chain index once the user has actually opened this —
    // it is a network round trip for a card most people will never use. The
    // confirmedTick dependency re-checks after a sweep confirms, so the balance
    // drops to zero without a manual refresh.
    if (open) refresh();
  }, [open, confirmedTick, refresh]);

  const onCopy = useCallback(() => {
    if (!address) return;
    Clipboard.setString(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [address]);

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

  const sats = preview?.confirmed_sats ?? 0;
  const canSweep = sats > 0;

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Sweep address</Text>
        <TouchableOpacity onPress={() => setOpen(false)}>
          <Text style={styles.hideBtn}>Hide</Text>
        </TouchableOpacity>
      </View>

      {address ? (
        <>
          <QRCode value={address} size={200} />
          <Text style={styles.mono}>{truncateMiddle(address, 16, 12)}</Text>
          <Text style={styles.caption}>
            A plain bitcoin address for senders that can't pay a Silent Payments
            address. It's the same address every time, so anything sent here is
            publicly linked together — use the address above wherever you can.
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

          {loading && !preview ? (
            <ActivityIndicator color={PRIMARY} style={styles.spinner} />
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {preview ? (
            <View style={styles.balanceBox}>
              <Text style={styles.balanceLabel}>Waiting here</Text>
              <Text style={styles.balanceValue}>
                {groupThousands(sats)} sats
              </Text>
              {preview.unconfirmed_sats > 0 ? (
                <Text style={styles.balanceHint}>
                  + {groupThousands(preview.unconfirmed_sats)} sats unconfirmed —
                  sweepable once mined
                </Text>
              ) : null}
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.primaryBtn, !canSweep && styles.btnDisabled]}
            onPress={() => setModal('sweep')}
            disabled={!canSweep}>
            <Text style={styles.primaryBtnText}>Sweep into wallet</Text>
          </TouchableOpacity>
          {!canSweep ? (
            <Text style={styles.hint}>
              Nothing to sweep yet. Send coins to the address above, then check
              back once they confirm.
            </Text>
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.caption}>
            This wallet's sweep address comes from your recovery phrase. Enter it
            once and this device will remember the address.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setModal('reveal')}>
            <Text style={styles.primaryBtnText}>Show sweep address</Text>
          </TouchableOpacity>
        </>
      )}

      {modal ? (
        <SweepModal
          visible
          mode={modal}
          wallet={wallet}
          onClose={() => setModal(null)}
          onChanged={refresh}
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
