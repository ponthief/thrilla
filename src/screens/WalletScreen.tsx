import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@stores/authStore';
import { useWalletStore } from '@stores/walletStore';
import * as api from '@services/api';
import { colors } from '@/theme';
import CreateWalletModal from '../components/CreateWalletModal';

// Group thousands without relying on Intl (Hermes ships without full Intl).
function groupThousands(n: number): string {
  return Math.floor(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

type WalletKind = 'sp' | 'ln';

export default function WalletScreen() {
  const inkey = useAuthStore((s) => s.inkey);
  const setBalance = useWalletStore((s) => s.setBalance);

  // Silent Payments is the primary wallet — land here, offer Lightning as a tab.
  const [kind, setKind] = useState<WalletKind>('sp');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rate, setRate] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [spSats, setSpSats] = useState<number | null>(null);
  const [spName, setSpName] = useState('');
  const [spError, setSpError] = useState<string | null>(null);
  // No wallet exists on this network (distinct from a request failure).
  const [spMissing, setSpMissing] = useState(false);

  const [lnSats, setLnSats] = useState<number | null>(null);
  const [lnName, setLnName] = useState('');
  const [lnError, setLnError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!inkey) {
      setLoading(false);
      return;
    }
    const [spRes, lnRes, rateRes] = await Promise.allSettled([
      api.getSilntWallets(inkey),
      api.lnGetWallet(inkey),
      api.getUsdRate(inkey),
    ]);

    let newSpSats: number | null = null;
    if (spRes.status === 'fulfilled') {
      const w = api.pickSilntWallet(spRes.value);
      if (w) {
        newSpSats = w.balance;
        setSpSats(w.balance);
        setSpName(w.title || 'Silent Payments');
        setSpError(null);
        setSpMissing(false);
      } else {
        setSpSats(null);
        setSpError(null);
        setSpMissing(true);
      }
    } else {
      setSpMissing(false);
      setSpError(spRes.reason?.message || 'Failed to load balance');
    }

    let newLnSats: number | null = null;
    if (lnRes.status === 'fulfilled') {
      newLnSats = Math.floor((lnRes.value.balance ?? 0) / 1000); // msat → sats
      setLnSats(newLnSats);
      setLnName(lnRes.value.name || 'Lightning');
      setLnError(null);
    } else {
      setLnError(lnRes.reason?.message || 'Failed to load balance');
    }

    // Fiat is best-effort; a failure must not blank a balance.
    setRate(
      rateRes.status === 'fulfilled' && rateRes.value.rate > 0
        ? rateRes.value.rate
        : null,
    );

    // Mirror the combined balance into the shared store (BTC).
    setBalance(((newSpSats ?? 0) + (newLnSats ?? 0)) / 1e8);

    setLoading(false);
  }, [inkey, setBalance]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const isSp = kind === 'sp';
  const sats = isSp ? spSats : lnSats;
  const error = isSp ? spError : lnError;
  const name = isSp ? spName || 'Silent Payments' : lnName || 'Lightning';

  const btc = sats != null ? (sats / 1e8).toFixed(8) : null;
  const usd = sats != null && rate != null ? (sats / 1e8) * rate : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }>
        <View style={styles.segment}>
          <SegmentButton
            label="Silent Payments"
            active={isSp}
            onPress={() => setKind('sp')}
          />
          <SegmentButton
            label="Lightning"
            active={!isSp}
            onPress={() => setKind('ln')}
          />
        </View>

        {isSp && spMissing && !loading ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>🔒</Text>
            <Text style={styles.emptyTitle}>No wallet yet</Text>
            <Text style={styles.emptyBody}>
              Create your Thrilla Silent Payments wallet to start receiving.
            </Text>
            <TouchableOpacity
              style={styles.createBtn}
              onPress={() => setShowCreate(true)}>
              <Text style={styles.createBtnText}>＋ New Wallet</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>{name}</Text>
              {loading ? (
                <ActivityIndicator style={styles.spinner} color={colors.primary} />
              ) : error ? (
                <Text style={styles.error}>{error}</Text>
              ) : sats == null ? (
                <Text style={styles.error}>No balance available.</Text>
              ) : (
                <>
                  <Text style={styles.balance}>{btc} BTC</Text>
                  <Text style={styles.sub}>{groupThousands(sats)} sats</Text>
                  {usd != null ? (
                    <Text style={styles.sub}>≈ ${usd.toFixed(2)} USD</Text>
                  ) : null}
                </>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Recent Transactions</Text>
              <Text style={styles.emptyState}>No transactions yet</Text>
            </View>

            <Text style={styles.hint}>Pull down to refresh</Text>
          </>
        )}
      </ScrollView>

      <CreateWalletModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          setLoading(true);
          load();
        }}
      />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { flex: 1, padding: 16 },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#e9e9ee',
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
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
  segmentTextActive: { color: colors.primary },
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
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 28,
    alignItems: 'center',
  },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#000', marginBottom: 8 },
  emptyBody: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  createBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  createBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
});
