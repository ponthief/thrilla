import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@stores/authStore';
import * as api from '@services/api';
import { getWalletKeys, hasWalletKeys } from '@services/secureKeys';
import { resetCatchUp } from '../hooks/useCatchUpScan';
import RecoverKeysModal from '../components/RecoverKeysModal';
import { colors } from '@/theme';

const PRIMARY = colors.primary;
const POLL_MS = 1500;

function groupThousands(n: number): string {
  return Math.floor(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

interface ScanResult {
  found: number;
  scanned: number;
  total: number;
  stopped: boolean;
}

// Where a resume scan should start: the block after the last scanned one (or the
// birth height for a never-scanned wallet), clamped to [minHeight, tip].
function resumeFrom(w: api.SilntWallet, tip: number, minHeight: number): number {
  const birth = Number(w.last_height) || 0;
  const scanned = Number(w.last_scan_height) || 0;
  let start = scanned > birth ? scanned + 1 : birth;
  if (minHeight && start < minHeight) start = minHeight;
  if (tip && start > tip) start = tip;
  return start;
}

export default function ScanScreen() {
  const inkey = useAuthStore((s) => s.inkey);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [missing, setMissing] = useState(false);
  const [wallet, setWallet] = useState<api.SilntWallet | null>(null);
  const [keysPresent, setKeysPresent] = useState(false);
  const [showRecover, setShowRecover] = useState(false);

  const [tip, setTip] = useState<number | null>(null);
  const [minHeight, setMinHeight] = useState(0);
  const [fromHeight, setFromHeight] = useState('');
  const [toHeight, setToHeight] = useState('');

  const [scanning, setScanning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [progress, setProgress] = useState<api.ScanProgress>({
    active: false,
    current: 0,
    total: 0,
    found: 0,
  });
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);
  useEffect(() => stopPoll, [stopPoll]);

  const load = useCallback(async () => {
    if (!inkey) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const [walletsRes, tipRes, cfgRes] = await Promise.allSettled([
        api.getSilntWallets(inkey),
        api.getChainTip(inkey),
        api.getAppConfig(inkey),
      ]);

      const w =
        walletsRes.status === 'fulfilled'
          ? api.pickSilntWallet(walletsRes.value)
          : null;
      if (!w) {
        setWallet(null);
        setMissing(true);
        return;
      }
      setMissing(false);
      setWallet(w);
      setKeysPresent(await hasWalletKeys(w.id));

      const newTip =
        tipRes.status === 'fulfilled' ? Number(tipRes.value?.height) || null : null;
      setTip(newTip);
      const minH =
        cfgRes.status === 'fulfilled' ? Number(cfgRes.value?.min_scan_height) || 0 : 0;
      setMinHeight(minH);

      // Prefill the range only when not mid-scan.
      if (!scanning && newTip) {
        setFromHeight(String(resumeFrom(w, newTip, minH)));
        setToHeight(String(newTip));
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load scan status.');
    } finally {
      setLoading(false);
    }
  }, [inkey, scanning]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inkey]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const upToDate = (() => {
    if (!wallet || !tip) return false;
    const scanned = Math.max(
      Number(wallet.last_scan_height) || 0,
      Number(wallet.last_height) || 0,
    );
    return scanned >= tip;
  })();

  const pct = progress.total
    ? Math.min(100, Math.floor((progress.current / progress.total) * 100))
    : 0;

  const poll = useCallback(
    (walletId: string) => {
      stopPoll();
      pollRef.current = setInterval(async () => {
        if (!inkey) return;
        try {
          const p = await api.getScanProgress(inkey, walletId);
          setProgress(p);
          if (!p.active) {
            stopPoll();
            setScanning(false);
            if (p.total > 0) {
              setResult({
                found: p.found,
                scanned: p.current,
                total: p.total,
                stopped: p.current < p.total,
              });
            }
            // Refresh wallet + tip so heights/up-to-date reflect the new state.
            await load();
          }
        } catch {
          /* transient — keep polling */
        }
      }, POLL_MS);
    },
    [inkey, stopPoll, load],
  );

  const onStart = useCallback(async () => {
    setError(null);
    setResult(null);
    if (!wallet || !inkey) return;

    const from = Number(fromHeight);
    const to = Number(toHeight);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      setError('Enter both From and To heights.');
      return;
    }
    if (minHeight && from < minHeight) {
      setError(`From height can't be below ${groupThousands(minHeight)}.`);
      return;
    }
    if (from > to) {
      setError("From height can't be greater than To height.");
      return;
    }
    if (tip && to > tip) {
      setError(`To height can't be above the chain tip (${groupThousands(tip)}).`);
      return;
    }

    const keys = await getWalletKeys(wallet.id);
    if (!keys) {
      setError('Wallet keys are not on this device. Recover them to scan.');
      return;
    }

    setScanning(true);
    setProgress({ active: true, current: 0, total: 0, found: 0 });
    try {
      await api.startScan(inkey, wallet.id, keys.scanSecret, keys.spendKey, from, to);
      poll(wallet.id);
    } catch (e: any) {
      const msg = (e?.message || '').toLowerCase();
      if (/recently|already|too many|budget/.test(msg)) {
        // A scan is already running (e.g. the login catch-up) — attach to it.
        poll(wallet.id);
      } else {
        setScanning(false);
        setError(e?.message || 'Scan failed to start.');
      }
    }
  }, [wallet, inkey, fromHeight, toHeight, minHeight, tip, poll]);

  const onStop = useCallback(async () => {
    if (!wallet || !inkey) return;
    setStopping(true);
    try {
      await api.stopScan(inkey, wallet.id);
    } catch {
      /* ignore */
    } finally {
      setStopping(false);
    }
  }, [wallet, inkey]);

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={PRIMARY} />
        </View>
      </SafeAreaView>
    );
  }

  if (missing) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.info}>
            No Silent Payments wallet on this network. Create one on the Wallet
            tab first.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const behind =
    tip && wallet
      ? Math.max(
          0,
          tip -
            Math.max(
              Number(wallet.last_scan_height) || 0,
              Number(wallet.last_height) || 0,
            ),
        )
      : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
        <Text style={styles.header}>Scan</Text>
        <Text style={styles.subhead}>
          Scan the chain to find Silent Payments sent to your address.
        </Text>

        <View style={styles.card}>
          <Row label="Chain tip" value={tip ? groupThousands(tip) : '—'} />
          <Row
            label="Scanned to"
            value={
              wallet?.last_scan_height
                ? groupThousands(wallet.last_scan_height)
                : '—'
            }
          />
          <Row
            label="Status"
            value={
              upToDate
                ? 'Up to date'
                : behind != null
                ? `${groupThousands(behind)} block${behind === 1 ? '' : 's'} behind`
                : '—'
            }
            valueStyle={upToDate ? styles.ok : styles.warnText}
          />
        </View>

        {!keysPresent ? (
          <View style={styles.card}>
            <Text style={styles.warn}>
              This wallet's keys aren't on this device, so it can't scan. Restore
              them from your recovery phrase.
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => setShowRecover(true)}>
              <Text style={styles.primaryBtnText}>Recover Keys</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.rangeRow}>
              <View style={styles.rangeField}>
                <Text style={styles.label}>From height</Text>
                <TextInput
                  style={styles.input}
                  value={fromHeight}
                  onChangeText={(t) => setFromHeight(t.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  editable={!scanning}
                  placeholderTextColor="#aaa"
                />
              </View>
              <View style={styles.rangeField}>
                <Text style={styles.label}>To height</Text>
                <TextInput
                  style={styles.input}
                  value={toHeight}
                  onChangeText={(t) => setToHeight(t.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  editable={!scanning}
                  placeholderTextColor="#aaa"
                />
              </View>
            </View>

            {scanning ? (
              <>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${pct}%` }]} />
                </View>
                <Text style={styles.progressText}>
                  {groupThousands(progress.current)} /{' '}
                  {groupThousands(progress.total)} blocks · {pct}%
                  {progress.found > 0
                    ? ` · ${progress.found} found`
                    : ''}
                </Text>
                <TouchableOpacity
                  style={[styles.stopBtn, stopping && styles.btnDisabled]}
                  onPress={onStop}
                  disabled={stopping}>
                  <Text style={styles.stopBtnText}>
                    {stopping ? 'Stopping…' : 'Stop'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[styles.primaryBtn, upToDate && styles.btnDisabled]}
                onPress={onStart}>
                <Text style={styles.primaryBtnText}>
                  {upToDate ? 'Up to date' : 'Start scan'}
                </Text>
              </TouchableOpacity>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {result && !scanning ? (
              <View style={styles.result}>
                <Text style={styles.resultTitle}>
                  {result.stopped ? 'Scan stopped' : 'Scan complete'}
                </Text>
                <Text style={styles.resultLine}>
                  {groupThousands(result.scanned)} of{' '}
                  {groupThousands(result.total)} blocks scanned
                </Text>
                <Text
                  style={[
                    styles.resultLine,
                    result.found > 0 && styles.resultFound,
                  ]}>
                  {result.found > 0
                    ? `${result.found} new output${result.found === 1 ? '' : 's'} found`
                    : 'No new outputs found'}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      <RecoverKeysModal
        visible={showRecover}
        wallet={wallet}
        onClose={() => setShowRecover(false)}
        onRecovered={() => {
          setShowRecover(false);
          setKeysPresent(true);
          if (wallet) resetCatchUp(wallet.id);
          load();
        }}
      />
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: string;
  valueStyle?: object;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueStyle]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  content: { padding: 16 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#000' },
  subhead: { fontSize: 14, color: '#666', marginTop: 4, marginBottom: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  rowLabel: { fontSize: 14, color: '#666' },
  rowValue: { fontSize: 14, fontWeight: '600', color: '#000' },
  ok: { color: colors.green },
  warnText: { color: PRIMARY },

  rangeRow: { flexDirection: 'row', gap: 12 },
  rangeField: { flex: 1 },
  label: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#000',
    backgroundColor: '#fafafa',
  },

  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#eee',
    marginTop: 20,
    overflow: 'hidden',
  },
  progressFill: { height: 8, backgroundColor: PRIMARY, borderRadius: 4 },
  progressText: { fontSize: 13, color: '#666', marginTop: 8, textAlign: 'center' },

  primaryBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  primaryBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  stopBtn: {
    borderWidth: 1,
    borderColor: '#c0392b',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  stopBtnText: { color: '#c0392b', fontSize: 15, fontWeight: '600' },

  error: { color: '#c0392b', fontSize: 13, marginTop: 14, textAlign: 'center' },
  warn: { fontSize: 13, color: '#c0392b', lineHeight: 19 },
  info: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 },

  result: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
    alignItems: 'center',
  },
  resultTitle: { fontSize: 16, fontWeight: '700', color: '#000' },
  resultLine: { fontSize: 14, color: '#666', marginTop: 4 },
  resultFound: { color: colors.green, fontWeight: '600' },
});
