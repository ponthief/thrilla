import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme';

export interface TxItem {
  id: string;
  direction: 'in' | 'out';
  amountSats: number; // absolute value
  label: string;
  timestamp: number | null; // unix seconds
  pending: boolean;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Format without Intl (Hermes ships without full Intl): "Jul 25, 14:30".
function fmtDate(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${hh}:${mm}`;
}

function groupThousands(n: number): string {
  return Math.floor(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

interface Props {
  title: string;
  items: TxItem[];
  loading: boolean;
  emptyText?: string;
}

export default function TransactionList({
  title,
  items,
  loading,
  emptyText = 'No transactions yet',
}: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {loading ? (
        <ActivityIndicator style={styles.spinner} color={colors.primary} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>{emptyText}</Text>
      ) : (
        items.map((tx, i) => (
          <View
            key={tx.id || String(i)}
            style={[styles.row, i > 0 && styles.rowDivider]}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowLabel} numberOfLines={1}>
                {tx.label}
              </Text>
              <Text style={styles.rowMeta}>
                {tx.pending ? 'pending' : fmtDate(tx.timestamp) || 'settled'}
              </Text>
            </View>
            <Text
              style={[
                styles.amount,
                tx.direction === 'in' ? styles.amountIn : styles.amountOut,
              ]}
              numberOfLines={1}>
              {tx.direction === 'in' ? '+' : '−'}
              {groupThousands(tx.amountSats)} sats
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#000', marginBottom: 8 },
  spinner: { marginVertical: 12, alignSelf: 'flex-start' },
  empty: { fontSize: 14, color: '#999' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee' },
  rowLeft: { flex: 1, marginRight: 12 },
  rowLabel: { fontSize: 15, color: '#000', fontWeight: '500' },
  rowMeta: { fontSize: 12, color: '#999', marginTop: 2 },
  amount: { fontSize: 14, fontWeight: '600' },
  amountIn: { color: colors.green },
  amountOut: { color: '#333' },
});
