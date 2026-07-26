import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@stores/authStore';
import * as api from '@services/api';
import * as deviceTrust from '@services/deviceTrust';
import { colors } from '@/theme';

const PRIMARY = colors.primary;

// Format a unix-seconds timestamp without relying on Intl (Hermes ships no full
// Intl): YYYY-MM-DD HH:MM.
function fmt(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

// Trusted-device management (list + revoke). Only meaningful when device-trust
// is enabled; Settings gates the entry point on the flag.
export default function DevicesModal({ visible, onClose }: Props) {
  const inkey = useAuthStore((s) => s.inkey);
  const username = useAuthStore((s) => s.username);
  const logout = useAuthStore((s) => s.logout);

  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<api.TrustedDevice[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [cap, setCap] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!inkey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listDevices(inkey);
      setDevices(res.devices || []);
      setCurrentId(res.current_device || null);
      setCap(res.cap || 5);
    } catch (e: any) {
      setError(e?.message || 'Could not load devices.');
    } finally {
      setLoading(false);
    }
  }, [inkey]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const doRevoke = useCallback(
    async (d: api.TrustedDevice) => {
      if (!inkey) return;
      setBusyId(d.id);
      setError(null);
      try {
        const res = await api.revokeDevice(inkey, d.id);
        if (res.was_current) {
          // Revoked the device we're on — trust is gone; forget and sign out.
          if (username) await deviceTrust.forget(username);
          logout();
          return;
        }
        await load();
      } catch (e: any) {
        setError(e?.message || 'Could not revoke device.');
      } finally {
        setBusyId(null);
      }
    },
    [inkey, username, logout, load],
  );

  const confirmRevoke = useCallback(
    (d: api.TrustedDevice) => {
      const isCurrent = d.device_id === currentId;
      Alert.alert(
        'Revoke device?',
        isCurrent
          ? 'This is the device you are using. Revoking it will sign you out here, and you will need to confirm again next time.'
          : 'That device will need to be confirmed again before it can access the wallet.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Revoke',
            style: 'destructive',
            onPress: () => doRevoke(d),
          },
        ],
      );
    },
    [currentId, doRevoke],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Trusted devices</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.close}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          <Text style={styles.help}>
            Devices confirmed by email code can access this wallet. You can trust
            up to {cap}. Revoke any you don't recognise.
          </Text>

          {loading ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={PRIMARY} />
          ) : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : devices.length === 0 ? (
            <Text style={styles.empty}>No trusted devices yet.</Text>
          ) : (
            devices.map((d) => {
              const isCurrent = d.device_id === currentId;
              return (
                <View key={d.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <Text style={styles.deviceName} numberOfLines={2}>
                      {d.label || d.user_agent || 'Unknown device'}
                    </Text>
                    {isCurrent ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>This device</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.meta}>
                    Last seen {fmt(d.last_seen_at)}
                    {d.ip ? ` · ${d.ip}` : ''}
                  </Text>
                  <Text style={styles.meta}>Confirmed {fmt(d.confirmed_at)}</Text>
                  <TouchableOpacity
                    style={styles.revokeBtn}
                    onPress={() => confirmRevoke(d)}
                    disabled={busyId === d.id}>
                    {busyId === d.id ? (
                      <ActivityIndicator color={colors.danger} />
                    ) : (
                      <Text style={styles.revokeText}>Revoke</Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  close: { fontSize: 16, color: PRIMARY, fontWeight: '600' },
  content: { flex: 1, padding: 16 },
  help: { fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: 16 },
  empty: { fontSize: 14, color: colors.faint, textAlign: 'center', marginTop: 24 },
  error: { fontSize: 14, color: colors.danger, marginTop: 16 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  deviceName: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1, paddingRight: 8 },
  badge: {
    backgroundColor: 'rgba(30,125,79,0.12)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { color: colors.green, fontSize: 11, fontWeight: '700' },
  meta: { fontSize: 12, color: colors.faint, marginTop: 4 },
  revokeBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 12,
  },
  revokeText: { color: colors.danger, fontSize: 14, fontWeight: '600' },
});
