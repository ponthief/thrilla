// Paying a bolt11 from the LNbits wallet the account already has.
//
// WHY THE PHONE NEEDS THIS AT ALL. It could create invoices and never spend,
// which was survivable while the LN balance only ever arrived from a swap the
// user started — they knew it was there and could finish on the web. It stops
// being survivable once a Tango's change is credited to that wallet: a balance
// the wallet puts in your account and gives you no way to move is not a
// balance. Onboarding is mobile-only, so "do it in the browser" is not an
// answer for most people who will have one.
//
// Mirrors the web app's LightningView send tab. Two deliberate refusals here
// that the invoice format allows:
//
//   * a zero-amount invoice. LNbits takes no amount argument on `out: true`,
//     so the payer cannot choose one, and sending it anyway fails inside
//     LNbits with a message about the wrong thing. Refused with the reason.
//   * an invoice for more than the balance. The server would refuse it too,
//     but saying so before the Pay button is pressed costs nothing.
//
// It decodes before paying because a bolt11 is unreadable: nobody can tell
// 40,000 sats from 4,000 by looking at it, and this is the last screen before
// the money goes.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useAuthStore } from '@stores/authStore';
import * as api from '@services/api';
import { colors } from '@/theme';

const PRIMARY = colors.primary;

function groupThousands(n: number): string {
  // Not toLocaleString: Hermes ships without full Intl.
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** bolt11 for any network: lnbc / lntb / lntbs / lnbcrt, case-insensitive. */
function looksBolt11(s: string): boolean {
  return /^ln(bc|tbs?|bcrt)[0-9]/i.test(s.trim());
}

export default function LightningSend({
  onPaid,
}: {
  /** Fired after a successful payment so the caller can refresh a balance. */
  onPaid?: () => void;
}) {
  const inkey = useAuthStore((s) => s.inkey);
  const adminkey = useAuthStore((s) => s.adminkey);

  const [balanceSats, setBalanceSats] = useState<number | null>(null);
  const [bolt11, setBolt11] = useState('');
  const [decoded, setDecoded] = useState<api.DecodedInvoice | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paidSats, setPaidSats] = useState<number | null>(null);

  const loadBalance = useCallback(async () => {
    if (!inkey) return;
    try {
      const w = await api.lnGetWallet(inkey);
      setBalanceSats(Math.floor((w.balance ?? 0) / 1000)); // msat → sats
    } catch {
      // A balance we cannot read is not a reason to block a payment the
      // server will price itself. The pre-check below simply does not run.
      setBalanceSats(null);
    }
  }, [inkey]);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  const invoiceSats = useMemo(
    () =>
      decoded?.amount_msat != null
        ? Math.floor(decoded.amount_msat / 1000)
        : null,
    [decoded],
  );

  const reset = useCallback(() => {
    setBolt11('');
    setDecoded(null);
    setError(null);
    setPaidSats(null);
  }, []);

  const onPaste = useCallback(async () => {
    const text = (await Clipboard.getString()).trim();
    if (!text) return;
    setBolt11(text);
    setDecoded(null);
    setError(null);
  }, []);

  const onDecode = useCallback(async () => {
    Keyboard.dismiss();
    setError(null);
    setDecoded(null);
    const raw = bolt11.trim();
    // A lightning: URI is what a QR scan and most "copy invoice" buttons
    // hand over, and LNbits will not decode it with the scheme attached.
    const clean = raw.replace(/^lightning:/i, '').trim();
    if (!clean) {
      setError('Paste a Lightning invoice.');
      return;
    }
    if (!looksBolt11(clean)) {
      setError('That does not look like a Lightning invoice (it starts ln…).');
      return;
    }
    if (!inkey) {
      setError('Not logged in.');
      return;
    }
    setDecoding(true);
    try {
      const res = await api.lnDecodeInvoice(inkey, clean);
      setBolt11(clean);
      setDecoded(res);
    } catch (e: any) {
      setError(e?.message || 'Could not read that invoice.');
    } finally {
      setDecoding(false);
    }
  }, [bolt11, inkey]);

  const onPay = useCallback(async () => {
    setError(null);
    if (!adminkey) {
      // The invoice key can ask to be paid; only the admin key spends.
      setError('This device cannot spend from the Lightning wallet.');
      return;
    }
    setPaying(true);
    try {
      await api.lnPayInvoice(adminkey, bolt11.trim());
      setPaidSats(invoiceSats);
      setDecoded(null);
      setBolt11('');
      await loadBalance();
      onPaid?.();
    } catch (e: any) {
      setError(e?.message || 'The payment failed.');
    } finally {
      setPaying(false);
    }
  }, [adminkey, bolt11, invoiceSats, loadBalance, onPaid]);

  // Why Pay is unavailable, in the order a person hits them.
  const blocked = useMemo(() => {
    if (!decoded) return null;
    if (invoiceSats == null || invoiceSats <= 0) {
      return 'This invoice asks for no particular amount, and the wallet '
        + 'cannot choose one. Ask for an invoice with the amount set.';
    }
    if (balanceSats != null && invoiceSats > balanceSats) {
      return `That is ${groupThousands(invoiceSats)} sats and the wallet holds `
        + `${groupThousands(balanceSats)}.`;
    }
    return null;
  }, [decoded, invoiceSats, balanceSats]);

  if (paidSats != null) {
    return (
      <View style={styles.center}>
        <Text style={styles.paidIcon}>✓</Text>
        <Text style={styles.paidTitle}>Payment sent</Text>
        <Text style={styles.paidSub}>{groupThousands(paidSats)} sats</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={reset}>
          <Text style={styles.primaryBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Lightning balance</Text>
        <Text style={styles.balanceValue}>
          {balanceSats == null ? '—' : `${groupThousands(balanceSats)} sats`}
        </Text>
      </View>

      <Text style={styles.label}>Invoice</Text>
      <TextInput
        style={[styles.input, styles.invoiceInput]}
        value={bolt11}
        onChangeText={(t) => {
          setBolt11(t);
          // A decoded invoice describes the text that produced it, so it must
          // not outlive an edit — otherwise Pay reads one invoice's amount and
          // sends another's.
          setDecoded(null);
          setError(null);
        }}
        placeholder="lnbc…"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
      />

      <View style={styles.row}>
        <TouchableOpacity style={styles.ghostBtn} onPress={onPaste}>
          <Text style={styles.ghostBtnText}>Paste</Text>
        </TouchableOpacity>
        {bolt11.trim() ? (
          <TouchableOpacity style={styles.ghostBtn} onPress={reset}>
            <Text style={styles.ghostBtnText}>Clear</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {decoded ? (
        <View style={styles.card}>
          <Row
            label="Amount"
            value={
              invoiceSats != null && invoiceSats > 0
                ? `${groupThousands(invoiceSats)} sats`
                : 'not set'
            }
          />
          {decoded.description ? (
            <Row label="Description" value={decoded.description} />
          ) : null}
          {decoded.payee ? <Row label="Payee" value={decoded.payee} mono /> : null}
        </View>
      ) : null}

      {blocked ? <Text style={styles.warn}>{blocked}</Text> : null}

      {decoded ? (
        <TouchableOpacity
          style={[styles.primaryBtn, (paying || !!blocked) && styles.btnDisabled]}
          onPress={onPay}
          disabled={paying || !!blocked}>
          {paying ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.primaryBtnText}>Pay</Text>
          )}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            (decoding || !bolt11.trim()) && styles.btnDisabled,
          ]}
          onPress={onDecode}
          disabled={decoding || !bolt11.trim()}>
          {decoding ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.primaryBtnText}>Review</Text>
          )}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        style={[styles.detailValue, mono && styles.monoValue]}
        numberOfLines={mono ? 1 : undefined}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  balanceCard: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 18,
  },
  balanceLabel: { fontSize: 12, color: colors.muted },
  balanceValue: { fontSize: 22, color: colors.text, marginTop: 2 },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
  },
  invoiceInput: { minHeight: 88, fontFamily: 'monospace', fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, gap: 12 },
  detailLabel: { fontSize: 13, color: colors.muted },
  detailValue: { fontSize: 13, color: colors.text, flexShrink: 1, textAlign: 'right' },
  monoValue: { fontFamily: 'monospace', fontSize: 11 },
  primaryBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 18,
  },
  primaryBtnText: { color: colors.onPrimary, fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  ghostBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  ghostBtnText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 13, marginTop: 12, lineHeight: 18 },
  warn: { color: colors.warn, fontSize: 13, marginTop: 12, lineHeight: 18 },
  paidIcon: { fontSize: 40, color: colors.green, marginBottom: 12 },
  paidTitle: { fontSize: 20, fontWeight: '600', color: colors.text },
  paidSub: { fontSize: 15, color: colors.muted, marginTop: 4 },
});
