import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@stores/authStore';
import { useWalletStore } from '@stores/walletStore';
import { useBitmailAlert } from '@stores/bitmailAlert';
import * as api from '@services/api';
import { hasWalletKeys } from '@services/secureKeys';
import { colors, LIGHTNING_ENABLED } from '@/theme';
import CoinsScreen from './CoinsScreen';
import CreateWalletModal from '../components/CreateWalletModal';
import RecoverKeysModal from '../components/RecoverKeysModal';
import TransactionList, { TxItem } from '../components/TransactionList';
import TxDetailModal from '../components/TxDetailModal';
import BitcoinSign from '../components/BitcoinSign';
import { useCatchUpScan } from '../hooks/useCatchUpScan';

function normalizeTime(t?: number | string | null): number | null {
  if (t == null) return null;
  if (typeof t === 'number') return t; // unix seconds
  const parsed = Date.parse(t); // ISO string
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

function spTxToItem(t: api.SpTransaction): TxItem {
  return {
    id: t.txid,
    direction: t.amount_sats < 0 ? 'out' : 'in',
    amountSats: Math.abs(t.amount_sats),
    label: t.labels?.[0] || (t.kind === 'send' ? 'Sent' : 'Received'),
    timestamp: t.timestamp || null,
    pending: false,
  };
}

function lnPayToItem(p: api.LnPayment): TxItem {
  const msat = p.amount ?? 0;
  return {
    id: p.payment_hash || p.checking_id || '',
    direction: msat < 0 ? 'out' : 'in',
    amountSats: Math.floor(Math.abs(msat) / 1000),
    label: p.memo || (msat < 0 ? 'Sent' : 'Received'),
    timestamp: normalizeTime(p.time),
    pending: p.pending === true || p.status === 'pending',
  };
}

// Group thousands without relying on Intl (Hermes ships without full Intl).
function groupThousands(n: number): string {
  return Math.floor(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

type WalletKind = 'sp' | 'ln';

export default function WalletScreen() {
  const inkey = useAuthStore((s) => s.inkey);
  const setBalance = useWalletStore((s) => s.setBalance);
  const tamper = useBitmailAlert((s) => s.tamper);

  // Silent Payments is the primary wallet — land here, offer Lightning as a tab.
  const [kind, setKind] = useState<WalletKind>('sp');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rate, setRate] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showRecover, setShowRecover] = useState(false);
  const [showCoins, setShowCoins] = useState(false);
  const [detailTxid, setDetailTxid] = useState<string | null>(null);
  const [keysMissing, setKeysMissing] = useState(false);

  const [spWallet, setSpWallet] = useState<api.SilntWallet | null>(null);
  const [spError, setSpError] = useState<string | null>(null);
  // No wallet exists on this network (distinct from a request failure).
  const [spMissing, setSpMissing] = useState(false);

  const [lnSats, setLnSats] = useState<number | null>(null);
  const [lnName, setLnName] = useState('');
  const [lnError, setLnError] = useState<string | null>(null);

  const [spTxs, setSpTxs] = useState<TxItem[]>([]);
  const [lnTxs, setLnTxs] = useState<TxItem[]>([]);

  const load = useCallback(async () => {
    if (!inkey) {
      setLoading(false);
      return;
    }
    const [spRes, rateRes] = await Promise.allSettled([
      api.getSilntWallets(inkey),
      api.getUsdRate(inkey),
    ]);

    let newSpSats: number | null = null;
    if (spRes.status === 'fulfilled') {
      const w = api.pickSilntWallet(spRes.value);
      if (w) {
        newSpSats = w.balance;
        setSpWallet(w);
        setSpError(null);
        setSpMissing(false);
        setKeysMissing(!(await hasWalletKeys(w.id)));

        // BitMail tamper check (best-effort, non-blocking): if the wallet's
        // BitMail resolves over DNS to a different SP address, flag it. The admin
        // is notified server-side (send-time block + backend tamper sweep + ntfy).
        if (w.hr_address) {
          api
            .resolveBip353(inkey, w.hr_address)
            .then((res) => {
              const resolved = api.spFromResolve(res);
              if (resolved && resolved.toLowerCase() !== w.sp_address.toLowerCase()) {
                useBitmailAlert.getState().setTamper({
                  bitmail: w.hr_address,
                  expected: w.sp_address,
                  resolved,
                });
              } else {
                useBitmailAlert.getState().clear();
              }
            })
            .catch(() => {
              /* unresolvable ≠ tampered — leave as-is */
            });
        } else {
          useBitmailAlert.getState().clear();
        }
        // On-chain history needs the wallet id, so fetch it once we have it.
        try {
          const txs = await api.listWalletTransactions(inkey, w.id, 25);
          setSpTxs(txs.map(spTxToItem));
        } catch {
          setSpTxs([]);
        }
      } else {
        setSpWallet(null);
        setSpError(null);
        setSpMissing(true);
        setSpTxs([]);
      }
    } else {
      setSpMissing(false);
      setSpError(spRes.reason?.message || 'Failed to load balance');
    }

    let newLnSats: number | null = null;
    if (LIGHTNING_ENABLED) {
      const [lnRes, lnPayRes] = await Promise.allSettled([
        api.lnGetWallet(inkey),
        api.lnListPayments(inkey, 25),
      ]);
      setLnTxs(
        lnPayRes.status === 'fulfilled' ? lnPayRes.value.map(lnPayToItem) : [],
      );
      if (lnRes.status === 'fulfilled') {
        newLnSats = Math.floor((lnRes.value.balance ?? 0) / 1000); // msat → sats
        setLnSats(newLnSats);
        setLnName(lnRes.value.name || 'Lightning');
        setLnError(null);
      } else {
        setLnError(lnRes.reason?.message || 'Failed to load balance');
      }
    }

    // Fiat is best-effort; a failure must not blank a balance.
    setRate(
      rateRes.status === 'fulfilled' && rateRes.value.rate > 0
        ? rateRes.value.rate
        : null,
    );

    // Mirror the combined balance into the shared store (BTC).
    setBalance(((newSpSats ?? 0) + (newLnSats ?? 0)) / 1e8);

    setLoading(false);
  }, [inkey, setBalance]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Catch-up scan for the SP wallet (auto for small gaps, prompt for large).
  // Reload balances when a scan finishes so newly found funds show up.
  const scan = useCatchUpScan(inkey, spWallet, load);

  const isSp = LIGHTNING_ENABLED ? kind === 'sp' : true;
  const sats = isSp ? spWallet?.balance ?? null : lnSats;
  const error = isSp ? spError : lnError;
  const name = isSp
    ? spWallet?.title || 'Silent Payments'
    : lnName || 'Lightning';

  const btc = sats != null ? (sats / 1e8).toFixed(8) : null;
  const usd = sats != null && rate != null ? (sats / 1e8) * rate : null;

  // Prefill the tx-detail label editor with the real label only (not the
  // "Sent"/"Received" fallback used for display).
  const detailTx = spTxs.find((t) => t.id === detailTxid) || null;
  const detailLabel =
    detailTx && !['Sent', 'Received'].includes(detailTx.label)
      ? detailTx.label
      : '';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
        {LIGHTNING_ENABLED ? (
          <View style={styles.segment}>
            <SegmentButton
              label="Silent Payments"
              active={isSp}
              onPress={() => setKind('sp')}
            />
            <SegmentButton
              label="Lightning"
              active={!isSp}
              onPress={() => setKind('ln')}
            />
          </View>
        ) : null}

        {isSp && tamper ? (
          <View style={styles.tamperCard}>
            <Text style={styles.tamperTitle}>⚠ BitMail tampering detected</Text>
            <Text style={styles.tamperBody}>
              {tamper.bitmail} currently resolves to a different address than your
              wallet. Do not rely on it to receive — the DNS record may have been
              altered to redirect funds. Your administrator has been alerted.
            </Text>
          </View>
        ) : null}

        {isSp && spMissing && !loading ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>🔒</Text>
            <Text style={styles.emptyTitle}>No wallet yet</Text>
            <Text style={styles.emptyBody}>
              Create your Thrilla Silent Payments wallet to start receiving.
            </Text>
            <TouchableOpacity
              style={styles.createBtn}
              onPress={() => setShowCreate(true)}>
              <Text style={styles.createBtnText}>＋ New Wallet</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>{name}</Text>
              {loading ? (
                <ActivityIndicator style={styles.spinner} color={colors.primary} />
              ) : error ? (
                <Text style={styles.error}>{error}</Text>
              ) : sats == null ? (
                <Text style={styles.error}>No balance available.</Text>
              ) : (
                <>
                  <View style={styles.balanceRow}>
                    <BitcoinSign size={34} color={colors.primary} weight={2.6} />
                    <Text style={styles.balance}>{btc}</Text>
                  </View>
                  <Text style={styles.sub}>{groupThousands(sats)} sats</Text>
                  {usd != null ? (
                    <Text style={styles.sub}>≈ ${usd.toFixed(2)} USD</Text>
                  ) : null}
                </>
              )}
            </View>

            {isSp && keysMissing && !loading ? (
              <View style={styles.scanBanner}>
                <View style={styles.scanTextWrap}>
                  <Text style={styles.scanTitle}>Wallet keys missing</Text>
                  <Text style={styles.scanSub}>
                    This device can't scan or send until you restore the keys.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.scanBtn}
                  onPress={() => setShowRecover(true)}>
                  <Text style={styles.scanBtnText}>Recover</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {isSp && scan.status === 'scanning' ? (
              <View style={styles.scanBanner}>
                <ActivityIndicator size="small" color={colors.primary} />
                <View style={styles.scanTextWrap}>
                  <Text style={styles.scanTitle}>
                    Catching up to the chain…
                    {scan.progress && scan.progress.total > 0
                      ? ` ${Math.min(
                          100,
                          Math.floor(
                            (scan.progress.current / scan.progress.total) * 100,
                          ),
                        )}%`
                      : ''}
                  </Text>
                  {scan.progress && scan.progress.found > 0 ? (
                    <Text style={styles.scanSub}>
                      {scan.progress.found} output
                      {scan.progress.found === 1 ? '' : 's'} found
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            {isSp && scan.status === 'prompt' ? (
              <View style={styles.scanBanner}>
                <View style={styles.scanTextWrap}>
                  <Text style={styles.scanTitle}>
                    {groupThousands(scan.gap)} blocks behind
                  </Text>
                  <Text style={styles.scanSub}>
                    Scan to detect funds received while you were away.
                  </Text>
                </View>
                <TouchableOpacity style={styles.scanBtn} onPress={scan.accept}>
                  <Text style={styles.scanBtnText}>Catch up</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.scanDismiss}
                  onPress={scan.dismiss}>
                  <Text style={styles.scanDismissText}>Later</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {isSp && !keysMissing ? (
              <TouchableOpacity
                style={styles.coinsBtn}
                onPress={() => setShowCoins(true)}>
                <Text style={styles.coinsBtnText}>Manage coins</Text>
              </TouchableOpacity>
            ) : null}

            <TransactionList
              title="Recent Transactions"
              items={isSp ? spTxs : lnTxs}
              loading={loading}
              emptyText={
                isSp
                  ? 'No transactions yet'
                  : 'No Lightning payments yet'
              }
              onPressItem={isSp ? (id) => setDetailTxid(id) : undefined}
            />

            <Text style={styles.hint}>Pull down to refresh</Text>
          </>
        )}
      </ScrollView>

      <CreateWalletModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          setLoading(true);
          load();
        }}
      />

      <RecoverKeysModal
        visible={showRecover}
        wallet={spWallet}
        onClose={() => setShowRecover(false)}
        onRecovered={() => {
          setShowRecover(false);
          setKeysMissing(false);
          setLoading(true);
          load();
        }}
      />

      <CoinsScreen
        visible={showCoins}
        onClose={() => {
          setShowCoins(false);
          load();
        }}
      />

      <TxDetailModal
        visible={!!detailTxid}
        walletId={spWallet?.id ?? null}
        txid={detailTxid}
        initialLabel={detailLabel}
        onClose={() => setDetailTxid(null)}
        onLabelSaved={load}
      />
    </SafeAreaView>
  );
}

function SegmentButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.segmentBtn, active && styles.segmentBtnActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, padding: 16 },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1,
  },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.muted },
  segmentTextActive: { color: colors.primary },
  card: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  label: { fontSize: 14, color: colors.muted, marginBottom: 8 },
  spinner: { marginVertical: 12, alignSelf: 'flex-start' },
  // The sign is set larger than the 30px text on purpose: its B occupies only
  // 15 of the 24 viewBox units (the strokes above and below take the rest), so
  // at a matching size its body would read noticeably shorter than the digits.
  // 34 puts the B's height level with them, with the strokes overshooting, as
  // they do in the real glyph.
  //
  // gap 2, not the 6 used when the sign trailed the amount: leading it reads as
  // a currency prefix like $, and a prefix sits tight against its number —
  // wider spacing makes it look like a separate word.
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  balance: { fontSize: 30, fontWeight: 'bold', color: colors.primary },
  sub: { fontSize: 15, color: colors.muted, marginTop: 4 },
  error: { fontSize: 14, color: colors.danger, marginTop: 4 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 8 },
  emptyState: { fontSize: 14, color: colors.faint },
  hint: { fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 4 },
  coinsBtn: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  coinsBtnText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  tamperCard: {
    backgroundColor: colors.surface,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  tamperTitle: { fontSize: 15, fontWeight: '700', color: colors.danger },
  tamperBody: { fontSize: 13, color: colors.danger, marginTop: 6, lineHeight: 19 },
  emptyCard: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 28,
    alignItems: 'center',
  },
  scanBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(249,115,22,0.10)',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  scanTextWrap: { flex: 1 },
  scanTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  scanSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  scanBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  scanBtnText: { color: colors.onPrimary, fontSize: 13, fontWeight: '700' },
  scanDismiss: { paddingVertical: 8, paddingHorizontal: 6 },
  scanDismissText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 8 },
  emptyBody: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  createBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  createBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
});
