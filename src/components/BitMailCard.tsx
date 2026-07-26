import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
const USERNAME_RE = /^[a-z0-9]([a-z0-9._-]{0,30}[a-z0-9])?$/;

interface Props {
  wallet: api.SilntWallet;
}

/**
 * BitMail (BIP-353) request card. Rendered only when the account has an SP
 * wallet (the parent gates on that) and the server has a domain configured.
 * Shows the existing BitMail, a pending request (with cancel), or a request form.
 */
export default function BitMailCard({ wallet }: Props) {
  const inkey = useAuthStore((s) => s.inkey);

  const [loading, setLoading] = useState(true);
  const [domain, setDomain] = useState('');
  const [requests, setRequests] = useState<api.Bip353Request[]>([]);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!inkey) return;
    try {
      const [dom, reqs] = await Promise.allSettled([
        api.getBitmailDomain(inkey),
        api.listMyBip353Requests(inkey),
      ]);
      setDomain(dom.status === 'fulfilled' ? dom.value?.domain || '' : '');
      setRequests(reqs.status === 'fulfilled' ? reqs.value : []);
    } catch {
      /* leave defaults */
    } finally {
      setLoading(false);
    }
  }, [inkey]);

  useEffect(() => {
    load();
  }, [load]);

  const pending = useMemo(
    () =>
      requests.find((r) => r.wallet_id === wallet.id && r.status === 'pending'),
    [requests, wallet.id],
  );
  const approved = useMemo(
    () =>
      requests.find((r) => r.wallet_id === wallet.id && r.status === 'approved'),
    [requests, wallet.id],
  );

  const current =
    wallet.hr_address ||
    (approved && domain
      ? `${approved.final_username || approved.requested_username}@${domain}`
      : '');

  const onRequest = useCallback(async () => {
    setError(null);
    const u = username.trim().toLowerCase();
    if (!USERNAME_RE.test(u)) {
      setError('Use 1–32 letters, numbers, dots or hyphens.');
      return;
    }
    if (!inkey) return;
    setBusy(true);
    try {
      await api.createBip353Request(inkey, {
        wallet_id: wallet.id,
        requested_username: u,
      });
      setUsername('');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not submit request.');
    } finally {
      setBusy(false);
    }
  }, [username, inkey, wallet.id, load]);

  const onCancel = useCallback(async () => {
    if (!inkey || !pending) return;
    setBusy(true);
    try {
      await api.cancelBip353Request(inkey, pending.id);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not cancel request.');
    } finally {
      setBusy(false);
    }
  }, [inkey, pending, load]);

  // Feature unavailable on this server — render nothing.
  if (!loading && !domain) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>BitMail (BIP-353)</Text>

      {loading ? (
        <ActivityIndicator style={styles.spinner} color={PRIMARY} />
      ) : current ? (
        <>
          <Text style={styles.caption}>
            A human-readable address that resolves to this wallet.
          </Text>
          <Text style={styles.address}>{current}</Text>
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={() => Clipboard.setString(current)}>
            <Text style={styles.ghostBtnText}>Copy</Text>
          </TouchableOpacity>
        </>
      ) : pending ? (
        <>
          <Text style={styles.caption}>Request submitted — awaiting approval.</Text>
          <Text style={styles.address}>
            {pending.requested_username}@{domain}
          </Text>
          <View style={styles.pendingRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Pending</Text>
            </View>
            <TouchableOpacity onPress={onCancel} disabled={busy}>
              <Text style={styles.cancel}>{busy ? '…' : 'Cancel'}</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.caption}>
            Request a memorable address like name@{domain} for this wallet.
          </Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={(t) =>
                setUsername(t.replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase())
              }
              placeholder="name"
              placeholderTextColor="#aaa"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={32}
            />
            <Text style={styles.domain}>@{domain}</Text>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[styles.primaryBtn, (busy || !username) && styles.btnDisabled]}
            onPress={onRequest}
            disabled={busy || !username}>
            {busy ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.primaryBtnText}>Request BitMail</Text>
            )}
          </TouchableOpacity>
        </>
      )}
      {error && (current || pending) ? (
        <Text style={styles.error}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginTop: 16,
    alignSelf: 'stretch',
  },
  title: { fontSize: 16, fontWeight: '700', color: '#000' },
  caption: { fontSize: 13, color: '#666', marginTop: 6, lineHeight: 18 },
  spinner: { marginTop: 12, alignSelf: 'flex-start' },
  address: {
    fontSize: 16,
    fontWeight: '600',
    color: PRIMARY,
    marginTop: 12,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#000',
    backgroundColor: '#fafafa',
  },
  domain: { fontSize: 15, color: '#666', marginLeft: 8 },
  primaryBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  primaryBtnText: { color: colors.onPrimary, fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  ghostBtn: {
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 14,
  },
  ghostBtnText: { color: PRIMARY, fontSize: 14, fontWeight: '600' },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  badge: {
    backgroundColor: 'rgba(249,115,22,0.12)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { color: PRIMARY, fontSize: 12, fontWeight: '700' },
  cancel: { color: '#c0392b', fontSize: 14, fontWeight: '600' },
  error: { color: '#c0392b', fontSize: 13, marginTop: 12 },
});
