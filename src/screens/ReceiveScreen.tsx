import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';
import { useAuthStore } from '@stores/authStore';
import * as api from '@services/api';
import QRCode from '../components/QRCode';
import BitMailCard from '../components/BitMailCard';
import PlainAddressCard from '../components/PlainAddressCard';
import ScanPanel from './ScanScreen';
import { useNavStore } from '@stores/navStore';
import { useSilntWallet } from '../hooks/useSilntWallet';
import { colors, LIGHTNING_ENABLED } from '@/theme';

const PRIMARY = colors.primary;
const GREEN = colors.green;
const POLL_INTERVAL_MS = 3000;

type Mode = 'lightning' | 'onchain';

// Middle-truncate long strings (invoices, addresses) for display.
function truncateMiddle(s: string, head = 14, tail = 10): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

// Group thousands without Intl (Hermes ships without full Intl support).
function groupThousands(n: number): string {
  return Math.floor(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

type ReceiveView = 'address' | 'plain' | 'scan';

export default function ReceiveScreen() {
  // The segment offers the two things this screen hands out: the Silent
  // Payments address, and the plain bech32 one for senders that can't pay it.
  //
  // Scan is deliberately NOT one of them. It finds payments already sent to
  // you, which is a rescue action rather than an address — and with background
  // scanning on it is redundant. It lives behind a row under the BIP-353
  // details instead (see ScanEntryRow), which is also what freed the second
  // segment slot for the plain address: previously that was a collapsed card
  // three cards down, and nobody found it.
  const [view, setView] = useState<ReceiveView>('address');

  // The wallet screen's prompt about coins on the plain chain comes straight
  // here. It used to expand a collapsed card; now it selects the segment.
  const plainRequest = useNavStore((s) => s.plainRequest);
  useEffect(() => {
    if (plainRequest > 0) setView('plain');
  }, [plainRequest]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Receive</Text>
        {view === 'scan' ? (
          <TouchableOpacity onPress={() => setView('address')}>
            <Text style={styles.backLink}>‹ Back to address</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.segment}>
            <SegmentButton
              label="Address"
              active={view === 'address'}
              onPress={() => setView('address')}
            />
            <SegmentButton
              label="Plain"
              active={view === 'plain'}
              onPress={() => setView('plain')}
            />
          </View>
        )}
      </View>
      {view === 'address' ? (
        <AddressReceive onScan={() => setView('scan')} />
      ) : view === 'plain' ? (
        <PlainReceive />
      ) : (
        <ScanPanel />
      )}
    </SafeAreaView>
  );
}

// The plain bech32 pocket, on its own now rather than collapsed at the bottom
// of the address view.
function PlainReceive() {
  const { wallet, loading, error, reload } = useSilntWallet();

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      {loading ? (
        <View style={styles.card}>
          <ActivityIndicator color={PRIMARY} />
          <Text style={styles.pendingText}>Loading…</Text>
        </View>
      ) : error || !wallet ? (
        <View style={styles.card}>
          <Text style={styles.error}>{error || 'No wallet available.'}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={reload}>
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <PlainAddressCard wallet={wallet} />
      )}
    </ScrollView>
  );
}

// The "get paid" side: your reusable Silent Payments address (plus an invoice
// generator if Lightning is ever enabled).
function AddressReceive({ onScan }: { onScan: () => void }) {
  const [mode, setMode] = useState<Mode>(
    LIGHTNING_ENABLED ? 'lightning' : 'onchain',
  );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {LIGHTNING_ENABLED ? (
        <View style={styles.subSegmentWrap}>
          <View style={styles.segment}>
            <SegmentButton
              label="Lightning"
              active={mode === 'lightning'}
              onPress={() => setMode('lightning')}
            />
            <SegmentButton
              label="On-chain"
              active={mode === 'onchain'}
              onPress={() => setMode('onchain')}
            />
          </View>
        </View>
      ) : null}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        {LIGHTNING_ENABLED && mode === 'lightning' ? (
          <LightningReceive />
        ) : (
          <OnchainReceive onScan={onScan} />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
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

// A copy button that briefly confirms the copy.
function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onCopy = () => {
    Clipboard.setString(value);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <TouchableOpacity style={styles.actionBtn} onPress={onCopy}>
      <Text style={styles.actionBtnText}>{copied ? '✓ Copied' : label}</Text>
    </TouchableOpacity>
  );
}

function ShareButton({ value }: { value: string }) {
  const onShare = () => {
    Share.share({ message: value }).catch(() => {
      /* user cancelled or share unavailable — ignore */
    });
  };
  return (
    <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={onShare}>
      <Text style={[styles.actionBtnText, styles.actionBtnGhostText]}>Share</Text>
    </TouchableOpacity>
  );
}

// ── Lightning ────────────────────────────────────────────────────────────────
function LightningReceive() {
  const inkey = useAuthStore((s) => s.inkey);

  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [invoice, setInvoice] = useState('');
  const [hash, setHash] = useState('');
  const [paid, setPaid] = useState(false);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  // Clean up the poller if the component unmounts while an invoice is pending.
  useEffect(() => stopPolling, [stopPolling]);

  const startPolling = useCallback(
    (paymentHash: string) => {
      stopPolling();
      pollTimer.current = setInterval(async () => {
        if (!inkey) return;
        try {
          const st = await api.lnPaymentStatus(inkey, paymentHash);
          if (st.paid) {
            setPaid(true);
            stopPolling();
          }
        } catch {
          /* transient — keep polling */
        }
      }, POLL_INTERVAL_MS);
    },
    [inkey, stopPolling],
  );

  const onCreate = useCallback(async () => {
    Keyboard.dismiss();
    setError(null);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter an amount in sats.');
      return;
    }
    if (!inkey) {
      setError('Not logged in.');
      return;
    }
    setCreating(true);
    setPaid(false);
    setInvoice('');
    try {
      const res = await api.lnCreateInvoice(inkey, { amount: Math.floor(amt), memo });
      const bolt11 = res.bolt11 || res.payment_request || '';
      if (!bolt11 || !res.payment_hash) {
        throw new Error('Invoice created but no bolt11 was returned.');
      }
      setInvoice(bolt11);
      setHash(res.payment_hash);
      startPolling(res.payment_hash);
    } catch (e: any) {
      setError(e?.message || 'Could not create invoice.');
    } finally {
      setCreating(false);
    }
  }, [amount, memo, inkey, startPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setInvoice('');
    setHash('');
    setPaid(false);
    setAmount('');
    setMemo('');
    setError(null);
  }, [stopPolling]);

  // Paid confirmation.
  if (paid) {
    return (
      <View style={styles.card}>
        <Text style={styles.paidIcon}>✓</Text>
        <Text style={styles.paidTitle}>Payment received</Text>
        {amount ? (
          <Text style={styles.paidSub}>{groupThousands(Number(amount))} sats</Text>
        ) : null}
        <TouchableOpacity style={styles.primaryBtn} onPress={reset}>
          <Text style={styles.primaryBtnText}>New invoice</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Generated invoice — show QR + actions, wait for payment.
  if (invoice) {
    return (
      <View style={styles.card}>
        <QRCode value={invoice} size={240} />
        <View style={styles.pendingRow}>
          <ActivityIndicator size="small" color={PRIMARY} />
          <Text style={styles.pendingText}>Waiting for payment…</Text>
        </View>
        <Text style={styles.mono}>{truncateMiddle(invoice, 18, 12)}</Text>
        <View style={styles.actionRow}>
          <CopyButton value={invoice} label="Copy invoice" />
          <ShareButton value={invoice} />
        </View>
        <TouchableOpacity style={styles.linkBtn} onPress={reset}>
          <Text style={styles.linkBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Invoice form.
  return (
    <View style={styles.card}>
      <Text style={styles.label}>Amount (sats)</Text>
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={colors.faint}
        returnKeyType="done"
      />
      <Text style={styles.label}>Memo (optional)</Text>
      <TextInput
        style={styles.input}
        value={memo}
        onChangeText={setMemo}
        placeholder="What's it for?"
        placeholderTextColor={colors.faint}
        maxLength={120}
        returnKeyType="done"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.primaryBtn, creating && styles.btnDisabled]}
        onPress={onCreate}
        disabled={creating}>
        {creating ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.primaryBtnText}>Create Invoice</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ── On-chain (Silent Payments) ───────────────────────────────────────────────
function OnchainReceive({ onScan }: { onScan: () => void }) {
  const { wallet, loading, error, reload: load } = useSilntWallet();

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={PRIMARY} />
        <Text style={styles.pendingText}>Loading address…</Text>
      </View>
    );
  }

  if (error || !wallet) {
    return (
      <View style={styles.card}>
        <Text style={styles.error}>{error || 'No address available.'}</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={load}>
          <Text style={styles.primaryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const address = wallet.sp_address;
  const hr = wallet.hr_address;

  return (
    <>
      <View style={styles.card}>
        <QRCode value={address} size={240} />
        {hr ? <Text style={styles.hrAddress}>{hr}</Text> : null}
        <Text style={styles.mono}>{truncateMiddle(address, 16, 12)}</Text>
        <Text style={styles.caption}>
          Reusable Silent Payments address — safe to share and reuse.
        </Text>
        <View style={styles.actionRow}>
          <CopyButton value={address} label="Copy address" />
          <ShareButton value={address} />
        </View>
      </View>

      <BitMailCard wallet={wallet} />
      {/* Below the BIP-353 details, not in the segment: finding payments
          already sent to you is a rescue action, not one of the two addresses
          this screen hands out. */}
      <ScanEntryRow wallet={wallet} onPress={onScan} />
    </>
  );
}

// The way into the manual scan.
//
// How loudly it asks depends on whether the server is already scanning for this
// wallet. With background scanning ON a manual scan is redundant — payments
// arrive on their own — so this is a quiet one-liner. With it OFF, scanning is
// the ONLY way a payment is ever found, so it says so plainly.
function ScanEntryRow({
  wallet,
  onPress,
}: {
  wallet: api.SilntWallet;
  onPress: () => void;
}) {
  const inkey = useAuthStore((s) => s.inkey);
  // null until known: neither wording is right while we are still asking, and
  // guessing would flip the row's meaning a moment after it rendered.
  const [bgOn, setBgOn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!inkey) return;
    api
      .getBackgroundScan(inkey, wallet.id)
      .then((on) => {
        if (!cancelled) setBgOn(on);
      })
      .catch(() => {
        // Can't tell — assume it is on, which keeps the row quiet rather than
        // alarming someone whose payments are in fact arriving fine.
        if (!cancelled) setBgOn(true);
      });
    return () => {
      cancelled = true;
    };
  }, [inkey, wallet.id]);

  if (bgOn === null) return null;

  return (
    <TouchableOpacity style={styles.collapsedRow} onPress={onPress}>
      <View style={styles.collapsedRowText}>
        <Text style={styles.collapsedRowTitle}>
          {bgOn ? 'Missing a payment?' : 'Scan for payments'}
        </Text>
        <Text style={styles.collapsedRowSub}>
          {bgOn
            ? 'Payments arrive on their own — scan manually only if one seems late.'
            : 'Background scanning is off, so payments are only found when you scan.'}
        </Text>
      </View>
      <Text style={styles.collapsedRowChevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 12,
    letterSpacing: 0.3,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    padding: 3,
  },
  backLink: { color: colors.muted, fontSize: 15, fontWeight: '600', paddingVertical: 8 },
  collapsedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  collapsedRowText: { flex: 1 },
  collapsedRowTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  collapsedRowSub: { fontSize: 12, color: colors.faint, marginTop: 3, lineHeight: 17 },
  collapsedRowChevron: { fontSize: 22, color: colors.faint, paddingLeft: 10 },
  subSegmentWrap: { paddingHorizontal: 16, marginBottom: 4 },
  segmentBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.muted },
  segmentTextActive: { color: PRIMARY },

  content: { padding: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },

  label: {
    alignSelf: 'stretch',
    fontSize: 13,
    fontWeight: '600',
    color: colors.label,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  error: { color: colors.danger, fontSize: 13, marginTop: 14, textAlign: 'center' },

  primaryBtn: {
    alignSelf: 'stretch',
    backgroundColor: PRIMARY,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 22,
  },
  primaryBtnText: {
    color: colors.onPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  btnDisabled: { opacity: 0.45 },

  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    color: colors.strong,
    marginTop: 16,
  },
  caption: {
    fontSize: 12,
    color: colors.faint,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 8,
  },
  hrAddress: {
    fontSize: 15,
    fontWeight: '700',
    color: PRIMARY,
    marginTop: 16,
    textAlign: 'center',
  },

  actionRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    marginTop: 16,
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionBtnText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' },
  actionBtnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: PRIMARY,
  },
  actionBtnGhostText: { color: PRIMARY },

  linkBtn: { marginTop: 16, paddingVertical: 6 },
  linkBtnText: { color: colors.danger, fontSize: 14, fontWeight: '600' },

  pendingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 8 },
  pendingText: { fontSize: 14, color: colors.muted, marginTop: 8 },

  paidIcon: {
    fontSize: 48,
    color: GREEN,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  paidTitle: { fontSize: 20, fontWeight: 'bold', color: GREEN },
  paidSub: { fontSize: 15, color: colors.muted, marginTop: 4 },
});
