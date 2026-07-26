import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@stores/authStore';
import { useSettingsStore } from '@stores/settingsStore';
import * as api from '@services/api';
import { colors } from '@/theme';

const PRIMARY = colors.primary;

function groupThousands(n: number): string {
  return Math.floor(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function key(u: api.Utxo): string {
  return `${u.txid}:${u.vout}`;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function CoinsScreen({ visible, onClose }: Props) {
  const inkey = useAuthStore((s) => s.inkey);
  const dustThreshold = useSettingsStore((s) => s.dustThreshold);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [utxos, setUtxos] = useState<api.Utxo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const isDust = useCallback(
    (u: api.Utxo) => !!u.suspected_dust || u.amount <= dustThreshold,
    [dustThreshold],
  );

  const load = useCallback(async () => {
    if (!inkey) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const wallets = await api.getSilntWallets(inkey);
      const w = api.pickSilntWallet(wallets);
      if (!w) {
        setWalletId(null);
        setUtxos([]);
        setError('No Silent Payments wallet on this network.');
        return;
      }
      setWalletId(w.id);
      const list = await api.getUtxos(inkey, w.id);
      // Hide fully spent coins; keep unspent + pending. Unfrozen first.
      const visible = list
        .filter((u) => u.utxo_state !== 'spent')
        .sort((a, b) => Number(a.frozen) - Number(b.frozen) || b.amount - a.amount);
      setUtxos(visible);
    } catch (e: any) {
      setError(e?.message || 'Failed to load coins.');
    } finally {
      setLoading(false);
    }
  }, [inkey]);

  useEffect(() => {
    if (visible) {
      setLoading(true);
      load();
    }
  }, [visible, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const spendable = useMemo(
    () =>
      utxos
        .filter((u) => u.utxo_state === 'unspent' && !u.frozen)
        .reduce((s, u) => s + u.amount, 0),
    [utxos],
  );
  const dustCoins = useMemo(
    () => utxos.filter((u) => u.utxo_state === 'unspent' && !u.frozen && isDust(u)),
    [utxos, isDust],
  );

  const setFrozen = useCallback(
    async (u: api.Utxo, frozen: boolean) => {
      if (!inkey) return;
      setBusyKey(key(u));
      try {
        await api.setUtxoFrozen(inkey, u.txid, u.vout, frozen);
        setUtxos((prev) =>
          prev.map((x) => (key(x) === key(u) ? { ...x, frozen } : x)),
        );
      } catch (e: any) {
        setError(e?.message || 'Failed to update coin.');
      } finally {
        setBusyKey(null);
      }
    },
    [inkey],
  );

  const freezeAllDust = useCallback(async () => {
    if (!inkey || !dustCoins.length) return;
    setBulkBusy(true);
    try {
      for (const u of dustCoins) {
        await api.setUtxoFrozen(inkey, u.txid, u.vout, true);
      }
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to freeze dust.');
    } finally {
      setBulkBusy(false);
    }
  }, [inkey, dustCoins, load]);

  const saveLabel = useCallback(
    async (u: api.Utxo) => {
      if (!inkey || !walletId) return;
      const label = draft.trim();
      setBusyKey(key(u));
      try {
        await api.updateUtxoLabel(inkey, u.txid, label, walletId);
        setUtxos((prev) =>
          prev.map((x) => (key(x) === key(u) ? { ...x, label } : x)),
        );
        setEditingKey(null);
        setDraft('');
      } catch (e: any) {
        setError(e?.message || 'Failed to save label.');
      } finally {
        setBusyKey(null);
      }
    },
    [inkey, walletId, draft],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title}>Coins</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text style={styles.close}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{groupThousands(spendable)}</Text>
              <Text style={styles.statLabel}>spendable sats</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{utxos.length}</Text>
              <Text style={styles.statLabel}>coins</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, dustCoins.length > 0 && styles.dustColor]}>
                {dustCoins.length}
              </Text>
              <Text style={styles.statLabel}>dust</Text>
            </View>
          </View>

          {dustCoins.length > 0 ? (
            <TouchableOpacity
              style={[styles.dustBtn, bulkBusy && styles.disabled]}
              onPress={freezeAllDust}
              disabled={bulkBusy}>
              {bulkBusy ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.dustBtnText}>
                  Freeze {dustCoins.length} dust coin
                  {dustCoins.length === 1 ? '' : 's'} (≤ {groupThousands(dustThreshold)} sats)
                </Text>
              )}
            </TouchableOpacity>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {loading ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={PRIMARY} />
          ) : utxos.length === 0 && !error ? (
            <Text style={styles.empty}>No coins yet.</Text>
          ) : (
            utxos.map((u) => {
              const k = key(u);
              const dust = isDust(u);
              const busy = busyKey === k;
              const editing = editingKey === k;
              return (
                <View key={k} style={styles.coin}>
                  <View style={styles.coinTop}>
                    <Text style={styles.amount}>{groupThousands(u.amount)} sats</Text>
                    <View style={styles.badges}>
                      {u.frozen ? (
                        <View style={[styles.badge, styles.badgeGray]}>
                          <Text style={styles.badgeGrayText}>frozen</Text>
                        </View>
                      ) : null}
                      {dust ? (
                        <View style={[styles.badge, styles.badgeDust]}>
                          <Text style={styles.badgeDustText}>dust</Text>
                        </View>
                      ) : null}
                      {u.utxo_state !== 'unspent' ? (
                        <View style={[styles.badge, styles.badgeGray]}>
                          <Text style={styles.badgeGrayText}>{u.utxo_state}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  <Text style={styles.outpoint} numberOfLines={1}>
                    {u.txid.slice(0, 12)}…:{u.vout}
                  </Text>

                  {editing ? (
                    <View style={styles.labelEditRow}>
                      <TextInput
                        style={styles.labelInput}
                        value={draft}
                        onChangeText={setDraft}
                        placeholder="Label this coin"
                        placeholderTextColor="#aaa"
                        autoFocus
                        maxLength={60}
                      />
                      <TouchableOpacity
                        style={styles.smallBtn}
                        onPress={() => saveLabel(u)}
                        disabled={busy}>
                        <Text style={styles.smallBtnText}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.smallGhost}
                        onPress={() => {
                          setEditingKey(null);
                          setDraft('');
                        }}>
                        <Text style={styles.smallGhostText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.coinBottom}>
                      <TouchableOpacity
                        onPress={() => {
                          setEditingKey(k);
                          setDraft(u.label || '');
                        }}>
                        <Text style={u.label ? styles.label : styles.labelAdd}>
                          {u.label || '+ label'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.freezeBtn}
                        onPress={() => setFrozen(u, !u.frozen)}
                        disabled={busy}>
                        {busy ? (
                          <ActivityIndicator size="small" color={PRIMARY} />
                        ) : (
                          <Text style={styles.freezeText}>
                            {u.frozen ? 'Unfreeze' : 'Freeze'}
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          )}

          <Text style={styles.hint}>
            Frozen coins are excluded when sending. Set the dust threshold in
            Settings.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
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

  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  stat: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statValue: { fontSize: 18, fontWeight: '700', color: '#000' },
  statLabel: { fontSize: 11, color: '#888', marginTop: 2 },
  dustColor: { color: PRIMARY },

  dustBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  dustBtnText: { color: colors.onPrimary, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.5 },

  error: { color: '#c0392b', fontSize: 13, marginBottom: 12 },
  empty: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 24 },

  coin: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10 },
  coinTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  amount: { fontSize: 16, fontWeight: '700', color: '#000' },
  badges: { flexDirection: 'row', gap: 6 },
  badge: { borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3 },
  badgeGray: { backgroundColor: '#eee' },
  badgeGrayText: { fontSize: 11, color: '#666', fontWeight: '600' },
  badgeDust: { backgroundColor: 'rgba(249,115,22,0.14)' },
  badgeDustText: { fontSize: 11, color: PRIMARY, fontWeight: '700' },
  outpoint: {
    fontSize: 12,
    color: '#aaa',
    marginTop: 4,
    fontFamily: 'monospace',
  },
  coinBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  label: { fontSize: 14, color: '#333', fontWeight: '500' },
  labelAdd: { fontSize: 14, color: '#aaa' },
  freezeBtn: {
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 7,
    minWidth: 92,
    alignItems: 'center',
  },
  freezeText: { color: PRIMARY, fontSize: 13, fontWeight: '600' },
  labelEditRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 },
  labelInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#000',
    backgroundColor: '#fafafa',
  },
  smallBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  smallBtnText: { color: colors.onPrimary, fontSize: 13, fontWeight: '600' },
  smallGhost: { paddingHorizontal: 8, paddingVertical: 9 },
  smallGhostText: { color: '#666', fontSize: 13, fontWeight: '600' },

  hint: {
    fontSize: 12,
    color: '#bbb',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 17,
  },
});
