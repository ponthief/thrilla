import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
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
  onClose: () => void;
}

export default function TxDetailModal({ visible, walletId, txid, onClose }: Props) {
  const inkey = useAuthStore((s) => s.inkey);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<api.WalletTxDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 22, fontWeight: 'bold', color: '#000' },
  close: { fontSize: 16, fontWeight: '600', color: PRIMARY },
  content: { padding: 16, paddingTop: 4 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  rowLabel: { fontSize: 14, color: '#666' },
  rowValue: { flex: 1, alignItems: 'flex-end' },
  value: { fontSize: 14, color: '#000', fontWeight: '500' },
  muted: { fontSize: 14, color: '#999' },
  ok: { fontSize: 14, color: colors.green, fontWeight: '600' },
  pending: { fontSize: 14, color: PRIMARY, fontWeight: '600' },
  mono: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#333',
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
  btnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: PRIMARY },
  btnGhostText: { color: PRIMARY },
  recipient: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    gap: 12,
  },
  recipientAddr: { flex: 1, fontSize: 12, color: '#333', fontFamily: 'monospace' },
  recipientAmt: { fontSize: 13, color: '#000', fontWeight: '600' },
  error: { color: '#c0392b', fontSize: 14, textAlign: 'center', marginTop: 24 },
});
