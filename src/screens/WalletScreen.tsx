import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@stores/authStore';
import { useWalletStore } from '@stores/walletStore';
import * as api from '@services/api';
import { colors } from '@/theme';

// Group thousands without relying on Intl (Hermes ships without full Intl).
function groupThousands(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export default function WalletScreen() {
  const inkey = useAuthStore((s) => s.inkey);
  const walletName = useAuthStore((s) => s.walletName);
  const setBalance = useWalletStore((s) => s.setBalance);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balanceSats, setBalanceSats] = useState(0);
  const [usd, setUsd] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!inkey) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const wallet = await api.lnGetWallet(inkey);
      const sats = Math.floor((wallet.balance ?? 0) / 1000); // msat → sats
      setBalanceSats(sats);
      setBalance(sats / 1e8);

      // Fiat is best-effort; a failure here must not blank the balance.
      try {
        const { rate } = await api.getUsdRate(inkey);
        setUsd(rate > 0 ? (sats / 1e8) * rate : null);
      } catch {
        setUsd(null);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load balance');
    } finally {
      setLoading(false);
    }
  }, [inkey, setBalance]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const btc = (balanceSats / 1e8).toFixed(8);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
        <View style={styles.card}>
          <Text style={styles.label}>{walletName || 'Total Balance'}</Text>
          {loading ? (
            <ActivityIndicator style={styles.spinner} color={colors.primary} />
          ) : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <>
              <Text style={styles.balance}>{btc} BTC</Text>
              <Text style={styles.sub}>{groupThousands(balanceSats)} sats</Text>
              {usd != null ? (
                <Text style={styles.sub}>
                  ≈ ${usd.toFixed(2)} USD
                </Text>
              ) : null}
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recent Transactions</Text>
          <Text style={styles.emptyState}>No transactions yet</Text>
        </View>

        <Text style={styles.hint}>Pull down to refresh</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { flex: 1, padding: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  label: { fontSize: 14, color: '#666', marginBottom: 8 },
  spinner: { marginVertical: 12, alignSelf: 'flex-start' },
  balance: { fontSize: 30, fontWeight: 'bold', color: colors.primary },
  sub: { fontSize: 15, color: '#666', marginTop: 4 },
  error: { fontSize: 14, color: '#c0392b', marginTop: 4 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#000', marginBottom: 8 },
  emptyState: { fontSize: 14, color: '#999' },
  hint: { fontSize: 12, color: '#bbb', textAlign: 'center', marginTop: 4 },
});
