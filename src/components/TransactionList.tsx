import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
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
  onPressItem?: (id: string) => void; // tappable rows (SP tx → detail)
}

export default function TransactionList({
  title,
  items,
  loading,
  emptyText = 'No transactions yet',
  onPressItem,
}: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {loading ? (
        <ActivityIndicator style={styles.spinner} color={colors.primary} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>{emptyText}</Text>
      ) : (
        items.map((tx, i) => {
          const tappable = !!onPressItem && !!tx.id;
          const Wrapper: any = tappable ? TouchableOpacity : View;
          return (
            <Wrapper
              key={tx.id || String(i)}
              style={[styles.row, i > 0 && styles.rowDivider]}
              onPress={tappable ? () => onPressItem!(tx.id) : undefined}>
              <View style={styles.rowLeft}>
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {tx.label}
                </Text>
                {tx.pending ? (
                  <View style={styles.pendingRow}>
                    <View style={styles.pendingDot} />
                    <Text style={styles.pendingText}>
                      Pending · waiting for 1st confirmation
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.rowMeta}>
                    {fmtDate(tx.timestamp) || 'settled'}
                  </Text>
                )}
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
              {tappable ? <Text style={styles.chevron}>›</Text> : null}
            </Wrapper>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 8 },
  // Pending needs to read as a state, not as a missing date — the whole point
  // is that the user should not have to open Manage coins to learn a send is
  // still in flight.
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  pendingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  pendingText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  spinner: { marginVertical: 12, alignSelf: 'flex-start' },
  empty: { fontSize: 14, color: colors.faint },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowLeft: { flex: 1, marginRight: 12 },
  rowLabel: { fontSize: 15, color: colors.text, fontWeight: '500' },
  rowMeta: { fontSize: 12, color: colors.faint, marginTop: 2 },
  amount: { fontSize: 14, fontWeight: '600' },
  amountIn: { color: colors.green },
  amountOut: { color: colors.strong },
  chevron: { fontSize: 20, color: colors.faint, marginLeft: 8 },
});
