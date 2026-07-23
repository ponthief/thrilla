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
import { colors } from '@/theme';

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

export default function ReceiveScreen() {
  const [mode, setMode] = useState<Mode>('lightning');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Receive</Text>
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
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          {mode === 'lightning' ? <LightningReceive /> : <OnchainReceive />}
        </ScrollView>
      </KeyboardAvoidingView>
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
        placeholderTextColor="#aaa"
        returnKeyType="done"
      />
      <Text style={styles.label}>Memo (optional)</Text>
      <TextInput
        style={styles.input}
        value={memo}
        onChangeText={setMemo}
        placeholder="What's it for?"
        placeholderTextColor="#aaa"
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
function OnchainReceive() {
  const inkey = useAuthStore((s) => s.inkey);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<api.SilntWallet | null>(null);

  const load = useCallback(async () => {
    if (!inkey) {
      setLoading(false);
      setError('Not logged in.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const wallets = await api.getSilntWallets(inkey);
      const chosen = api.pickSilntWallet(wallets);
      if (!chosen) {
        setWallet(null);
        setError(
          'No Silent Payments wallet on this network yet. Open the Wallet tab to create one.',
        );
      } else {
        setWallet(chosen);
      }
    } catch (e: any) {
      setError(e?.message || 'Could not load your receive address.');
    } finally {
      setLoading(false);
    }
  }, [inkey]);

  useEffect(() => {
    load();
  }, [load]);

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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  flex: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#000', marginBottom: 12 },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#e9e9ee',
    borderRadius: 10,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1,
  },
  segmentText: { fontSize: 14, fontWeight: '600', color: '#666' },
  segmentTextActive: { color: PRIMARY },

  content: { padding: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },

  label: {
    alignSelf: 'stretch',
    fontSize: 13,
    fontWeight: '600',
    color: '#444',
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#000',
    backgroundColor: '#fafafa',
  },
  error: { color: '#c0392b', fontSize: 13, marginTop: 14, textAlign: 'center' },

  primaryBtn: {
    alignSelf: 'stretch',
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 22,
  },
  primaryBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },

  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    color: '#333',
    marginTop: 16,
  },
  caption: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 8,
  },
  hrAddress: {
    fontSize: 15,
    fontWeight: '600',
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
  actionBtnText: { color: colors.onPrimary, fontSize: 14, fontWeight: '600' },
  actionBtnGhost: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: PRIMARY,
  },
  actionBtnGhostText: { color: PRIMARY },

  linkBtn: { marginTop: 16, paddingVertical: 6 },
  linkBtnText: { color: '#c0392b', fontSize: 14, fontWeight: '600' },

  pendingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 8 },
  pendingText: { fontSize: 14, color: '#666', marginTop: 8 },

  paidIcon: {
    fontSize: 48,
    color: GREEN,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  paidTitle: { fontSize: 20, fontWeight: 'bold', color: GREEN },
  paidSub: { fontSize: 15, color: '#666', marginTop: 4 },
});
