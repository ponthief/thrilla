import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  ScrollView,
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
import { colors } from '@/theme';

const PRIMARY = colors.primary;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function groupThousands(n: number): string {
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function fmtTime(ts?: number | null): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${hh}:${mm}`;
}

interface Props {
  visible: boolean;
  walletId: string | null;
  txid: string | null;
  initialLabel?: string;
  onClose: () => void;
  onLabelSaved?: () => void;
}

export default function TxDetailModal({
  visible,
  walletId,
  txid,
  initialLabel = '',
  onClose,
  onLabelSaved,
}: Props) {
  const inkey = useAuthStore((s) => s.inkey);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<api.WalletTxDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [labelDraft, setLabelDraft] = useState(initialLabel);
  const [labelBusy, setLabelBusy] = useState(false);
  const [labelSaved, setLabelSaved] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setLabelDraft(initialLabel);
      setLabelSaved(false);
      setLabelError(null);
    }
  }, [visible, initialLabel]);

  const saveLabel = useCallback(async () => {
    if (!inkey || !walletId || !txid) return;
    setLabelBusy(true);
    setLabelSaved(false);
    setLabelError(null);
    try {
      await api.updateUtxoLabel(inkey, txid, labelDraft.trim(), walletId);
      setLabelSaved(true);
      onLabelSaved?.();
    } catch (e: any) {
      setLabelError(e?.message || 'Could not save label.');
    } finally {
      setLabelBusy(false);
    }
  }, [inkey, walletId, txid, labelDraft, onLabelSaved]);

  const load = useCallback(async () => {
    if (!inkey || !walletId || !txid) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.getWalletTransaction(inkey, walletId, txid));
    } catch (e: any) {
      setError(e?.message || 'Could not load transaction.');
    } finally {
      setLoading(false);
    }
  }, [inkey, walletId, txid]);

  useEffect(() => {
    if (visible) {
      setDetail(null);
      load();
    }
  }, [visible, load]);

  const copyTxid = () => {
    if (!txid) return;
    Clipboard.setString(txid);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title}>Transaction</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text style={styles.close}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {loading ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={PRIMARY} />
          ) : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : detail ? (
            <>
              <View style={styles.card}>
                <Row label="Status">
                  {detail.confirmed === true ? (
                    <Text style={styles.ok}>
                      ✓ Confirmed
                      {detail.block_height
                        ? ` · block ${groupThousands(detail.block_height)}`
                        : ''}
                    </Text>
                  ) : detail.confirmed === false ? (
                    <Text style={styles.pending}>⌛ Unconfirmed</Text>
                  ) : (
                    <Text style={styles.muted}>Unknown</Text>
                  )}
                </Row>
                {detail.block_time ? (
                  <Row label="Time">
                    <Text style={styles.value}>{fmtTime(detail.block_time)}</Text>
                  </Row>
                ) : null}
                {detail.fee_sats != null ? (
                  <Row label="Fee">
                    <Text style={styles.value}>
                      {groupThousands(detail.fee_sats)} sats
                    </Text>
                  </Row>
                ) : null}
              </View>

              {/* A label is stored on a coin this wallet owns, matched by the
                  funding txid. The only output a send gives us is its change,
                  and that does not exist until the send confirms and a scan
                  picks it up — so offering the field before then produces a
                  "UTXO not found in this wallet" from the server. Say why
                  instead of failing. */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Label</Text>
                {!detail.own_outputs?.length ? (
                  <Text style={styles.labelHint}>
                    {detail.confirmed === false
                      ? 'You can label this once it confirms — the coin it pays back to you doesn’t exist on-chain yet.'
                      : 'Nothing to label: this transaction left no coin in this wallet.'}
                  </Text>
                ) : (
                <>
                <View style={styles.labelRow}>
                  <TextInput
                    style={styles.labelInput}
                    value={labelDraft}
                    onChangeText={(t) => {
                      setLabelDraft(t);
                      setLabelSaved(false);
                      setLabelError(null);
                    }}
                    placeholder="Label this transaction"
                    placeholderTextColor={colors.faint}
                    maxLength={60}
                  />
                  <TouchableOpacity
                    style={[styles.btn, styles.labelSave, labelBusy && styles.disabled]}
                    onPress={saveLabel}
                    disabled={labelBusy}>
                    {labelBusy ? (
                      <ActivityIndicator color={colors.onPrimary} />
                    ) : (
                      <Text style={styles.btnText}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
                {labelSaved ? <Text style={styles.saved}>✓ Saved</Text> : null}
                {labelError ? <Text style={styles.errorSm}>{labelError}</Text> : null}
                <Text style={styles.labelHint}>
                  Labels this transaction's coin in your wallet.
                </Text>
                </>
                )}
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Transaction ID</Text>
                <Text style={styles.mono} selectable>
                  {detail.txid}
                </Text>
                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.btn} onPress={copyTxid}>
                    <Text style={styles.btnText}>{copied ? '✓ Copied' : 'Copy'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnGhost]}
                    onPress={() => Linking.openURL(detail.explorer_url).catch(() => {})}>
                    <Text style={[styles.btnText, styles.btnGhostText]}>
                      View on explorer ↗
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {detail.recipients?.length ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Recipients</Text>
                  {detail.recipients.map((r, i) => (
                    <View key={i} style={styles.recipient}>
                      <Text style={styles.recipientAddr} numberOfLines={1}>
                        {r.address || r.type || 'output'}
                      </Text>
                      {r.amount != null ? (
                        <Text style={styles.recipientAmt}>
                          {groupThousands(r.amount)} sats
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValue}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 22, fontWeight: 'bold', color: colors.text },
  close: { fontSize: 16, fontWeight: '600', color: PRIMARY },
  content: { padding: 16, paddingTop: 4 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  rowLabel: { fontSize: 14, color: colors.muted },
  rowValue: { flex: 1, alignItems: 'flex-end' },
  value: { fontSize: 14, color: colors.text, fontWeight: '500' },
  muted: { fontSize: 14, color: colors.faint },
  ok: { fontSize: 14, color: colors.green, fontWeight: '600' },
  pending: { fontSize: 14, color: PRIMARY, fontWeight: '600' },
  mono: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: colors.strong,
    marginBottom: 12,
  },
  actionRow: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1,
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  btnText: { color: colors.onPrimary, fontSize: 14, fontWeight: '600' },
  btnGhost: { backgroundColor: colors.surface, borderWidth: 1, borderColor: PRIMARY },
  btnGhostText: { color: PRIMARY },
  recipient: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    gap: 12,
  },
  recipientAddr: { flex: 1, fontSize: 12, color: colors.strong, fontFamily: 'monospace' },
  recipientAmt: { fontSize: 13, color: colors.text, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center', marginTop: 24 },
  labelRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  labelInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  labelSave: { flex: 0, paddingHorizontal: 18 },
  disabled: { opacity: 0.5 },
  saved: { color: colors.green, fontSize: 13, fontWeight: '600', marginTop: 8 },
  errorSm: { color: colors.danger, fontSize: 13, marginTop: 8 },
  labelHint: { fontSize: 12, color: colors.faint, marginTop: 8 },
});
