import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuthStore } from '@stores/authStore';
import * as api from '@services/api';
import { getWalletKeys, hasWalletKeys } from '@services/secureKeys';
import {
  cooldownRemaining,
  markScanStarted,
  setCooldown,
  SCAN_COOLDOWN_SECONDS,
} from '@services/scanCooldown';
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
function resumeFrom(
  birth: number,
  scanned: number,
  tip: number,
  minHeight: number,
): number {
  let start = scanned > birth ? scanned + 1 : birth;
  if (minHeight && start < minHeight) start = minHeight;
  if (tip && start > tip) start = tip;
  return start;
}

// Rendered inside the Receive screen (the "Scan" segment), so this is a plain
// panel — no SafeAreaView or page header of its own; Receive supplies both.
export default function ScanPanel() {
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
  const [cooldown, setCooldownSec] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Holds the latest `poll` so `load` can attach to a running scan without a
  // circular useCallback dependency (poll depends on load, load must not depend
  // on poll). Assigned right after poll is defined below.
  const pollFn = useRef<(walletId: string) => void>(() => {});
  // Guards against a transient/stale backend read right after a scan: the
  // highest last_scan_height we've seen (monotonic — scanning only moves
  // forward) and the last-known min scan height. Using these for the resume
  // range means a momentarily-low read can never produce a below-minimum
  // `from` (which the server rejects with a spurious min-height error).
  const walletIdRef = useRef<string | null>(null);
  const scannedFloorRef = useRef(0);
  const minHeightRef = useRef(0);
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

      // Reset the monotonic floors when switching wallets.
      if (walletIdRef.current !== w.id) {
        walletIdRef.current = w.id;
        scannedFloorRef.current = 0;
      }
      // last_scan_height only ever advances; keep the highest we've seen so a
      // stale/racy low read right after a scan can't rewind the resume point.
      scannedFloorRef.current = Math.max(
        scannedFloorRef.current,
        Number(w.last_scan_height) || 0,
      );

      const newTip =
        tipRes.status === 'fulfilled' ? Number(tipRes.value?.height) || null : null;
      setTip(newTip);
      // Keep the last-known min height if the config fetch failed/returned 0, so
      // the clamp and the send-time validation never momentarily drop to 0.
      let minH =
        cfgRes.status === 'fulfilled' ? Number(cfgRes.value?.min_scan_height) || 0 : 0;
      if (!minH) minH = minHeightRef.current;
      else minHeightRef.current = minH;
      setMinHeight(minH);

      // Attach to an already-running scan (the login catch-up, or one started
      // elsewhere) so its progress shows here immediately. Without this the
      // panel would render an enabled "Start scan" button over a scan that's
      // already in flight, and tapping it just fires a duplicate the server
      // rejects — which is what made progress appear only after a tab switch.
      let active = false;
      try {
        const p = await api.getScanProgress(inkey, w.id);
        if (p?.active) {
          active = true;
          setProgress(p);
          setScanning(true);
          pollFn.current(w.id);
        }
      } catch {
        /* treat as no active scan */
      }

      // Prefill the range only when idle (not mid-scan and none just detected).
      if (!scanning && !active && newTip) {
        const birth = Number(w.last_height) || 0;
        setFromHeight(
          String(resumeFrom(birth, scannedFloorRef.current, newTip, minH)),
        );
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

  // Tick the scan cooldown once a second so the Start button re-enables on time.
  useEffect(() => {
    if (!wallet) return undefined;
    const tick = () => setCooldownSec(cooldownRemaining(wallet.id));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [wallet?.id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Effective scanned height: floored at the highest we've seen so a transient
  // low read doesn't make the status/labels flicker backwards (and disagree with
  // the resume range, which uses the same floor).
  const effectiveScanned = Math.max(
    Number(wallet?.last_scan_height) || 0,
    Number(wallet?.last_height) || 0,
    scannedFloorRef.current,
  );

  const upToDate = (() => {
    if (!wallet || !tip) return false;
    return effectiveScanned >= tip;
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
  // Keep the ref pointing at the current poll so load() can attach to a
  // running scan (see the active-scan check above).
  pollFn.current = poll;

  const onStart = useCallback(async () => {
    setError(null);
    setResult(null);
    if (!wallet || !inkey) return;

    const wait = cooldownRemaining(wallet.id);
    if (wait > 0) {
      setError(`Please wait ${wait}s before scanning again.`);
      return;
    }

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
      await api.startScan(inkey, wallet.id, keys.scanSecret, from, to);
      markScanStarted(wallet.id); // arm the 1-min cooldown
      setCooldownSec(cooldownRemaining(wallet.id));
      poll(wallet.id);
    } catch (e: any) {
      const raw = e?.message || '';
      const msg = raw.toLowerCase();
      if (/already running|another scan/.test(msg)) {
        // A scan is already running (e.g. the login catch-up) — attach to it.
        poll(wallet.id);
      } else if (/recently|too many|try again in/.test(msg)) {
        // Backend cooldown — sync the client timer to the reported wait.
        const m = raw.match(/(\d+)\s*second/i);
        setCooldown(wallet.id, m ? Number(m[1]) : SCAN_COOLDOWN_SECONDS);
        setCooldownSec(cooldownRemaining(wallet.id));
        setScanning(false);
        setError(raw || 'Wallet was scanned recently. Try again shortly.');
      } else {
        setScanning(false);
        setError(raw || 'Scan failed to start.');
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
      <View style={styles.center}>
        <ActivityIndicator color={PRIMARY} />
      </View>
    );
  }

  if (missing) {
    return (
      <View style={styles.center}>
        <Text style={styles.info}>
          No Silent Payments wallet on this network. Create one on the Wallet tab
          first.
        </Text>
      </View>
    );
  }

  const behind =
    tip && wallet ? Math.max(0, tip - effectiveScanned) : null;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={PRIMARY}
          />
        }>
        <Text style={styles.subhead}>
          Scan the chain to find Silent Payments sent to your address.
        </Text>

        <View style={styles.card}>
          <Row label="Chain tip" value={tip ? groupThousands(tip) : '—'} />
          <Row
            label="Scanned to"
            value={
              // last_scan_height is 0/1 (or ≤ birth) until a scan makes real
              // progress, so only show a height once it's past the wallet's
              // birth — otherwise a never-scanned wallet reads "Scanned to 1".
              wallet && effectiveScanned > Number(wallet.last_height || 0)
                ? groupThousands(effectiveScanned)
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
              <>
                {!upToDate && behind && fromHeight && toHeight ? (
                  <Text style={styles.rangeCaption}>
                    Blocks {groupThousands(Number(fromHeight))} –{' '}
                    {groupThousands(Number(toHeight))}
                  </Text>
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.primaryBtn,
                    (upToDate || cooldown > 0) && styles.btnDisabled,
                  ]}
                  onPress={onStart}
                  disabled={upToDate || cooldown > 0}>
                  <Text style={styles.primaryBtnText}>
                    {cooldown > 0
                      ? `Scan again in ${cooldown}s`
                      : upToDate
                      ? 'Up to date'
                      : behind
                      ? `Scan ${groupThousands(behind)} block${
                          behind === 1 ? '' : 's'
                        }`
                      : 'Start scan'}
                  </Text>
                </TouchableOpacity>
              </>
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
    </View>
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
  container: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    minHeight: 220,
  },
  content: { padding: 16, paddingTop: 4 },
  subhead: { fontSize: 14, color: colors.muted, marginTop: 4, marginBottom: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  rowLabel: { fontSize: 14, color: colors.muted },
  rowValue: { fontSize: 14, fontWeight: '600', color: colors.text },
  ok: { color: colors.green },
  warnText: { color: PRIMARY },

  rangeCaption: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 4,
  },

  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceAlt,
    marginTop: 20,
    overflow: 'hidden',
  },
  progressFill: { height: 8, backgroundColor: PRIMARY, borderRadius: 4 },
  progressText: { fontSize: 13, color: colors.muted, marginTop: 8, textAlign: 'center' },

  primaryBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  primaryBtnText: {
    color: colors.onPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  btnDisabled: { opacity: 0.45 },
  stopBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  stopBtnText: { color: colors.danger, fontSize: 15, fontWeight: '600' },

  error: { color: colors.danger, fontSize: 13, marginTop: 14, textAlign: 'center' },
  warn: { fontSize: 13, color: colors.danger, lineHeight: 19 },
  info: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },

  result: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  resultTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  resultLine: { fontSize: 14, color: colors.muted, marginTop: 4 },
  resultFound: { color: colors.green, fontWeight: '600' },
});
