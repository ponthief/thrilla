import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@stores/authStore';
import * as api from '@services/api';
import * as deviceTrust from '@services/deviceTrust';
import { colors } from '@/theme';

const PRIMARY = colors.primary;

// Shown after login when this device isn't yet trusted (DEVICE_TRUST_ENABLED).
// Step 1: request a 6-digit code by email. Step 2: enter it. On success the
// server returns the device_id we persist, and the wallet unlocks.
export default function DeviceConfirmScreen() {
  const inkey = useAuthStore((s) => s.inkey);
  const username = useAuthStore((s) => s.username);
  const setTrusted = useAuthStore((s) => s.setTrusted);
  const logout = useAuthStore((s) => s.logout);

  const [phase, setPhase] = useState<'request' | 'enter'>('request');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const sendCode = useCallback(async () => {
    if (!inkey) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await api.deviceRequestConfirm(inkey);
      if (res.status === 'already-trusted') {
        // Rare: became trusted between the check and now.
        setTrusted();
        return;
      }
      setPhase('enter');
      setInfo('We emailed a 6-digit code. Enter it below.');
    } catch (e: any) {
      setError(e?.message || 'Could not send the code. Try again.');
    } finally {
      setBusy(false);
    }
  }, [inkey, setTrusted]);

  const verify = useCallback(async () => {
    if (!inkey || code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.deviceVerifyCode(inkey, code);
      if (res.confirmed && res.device_id) {
        if (username) await deviceTrust.setDeviceId(username, res.device_id);
        setTrusted();
        return;
      }
      setError('Could not confirm this device. Request a new code.');
    } catch (e: any) {
      setError(e?.message || 'That code is incorrect or expired.');
    } finally {
      setBusy(false);
    }
  }, [inkey, code, username, setTrusted]);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          <Text style={styles.badge}>🔒</Text>
          <Text style={styles.title}>Confirm this device</Text>
          <Text style={styles.subtitle}>
            For your security, a new device has to be confirmed with a code sent
            to your email before it can use the wallet.
          </Text>

          <View style={styles.card}>
            {phase === 'request' ? (
              <>
                <Text style={styles.body}>
                  We'll send a 6-digit code to the email on your account. You can
                  trust up to 5 devices.
                </Text>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <TouchableOpacity
                  style={[styles.primaryBtn, busy && styles.btnDisabled]}
                  onPress={sendCode}
                  disabled={busy}>
                  {busy ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.primaryBtnText}>Email me a code</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                {info ? <Text style={styles.body}>{info}</Text> : null}
                <TextInput
                  style={styles.codeInput}
                  value={code}
                  onChangeText={(t) => {
                    setCode(t.replace(/[^0-9]/g, '').slice(0, 6));
                    setError(null);
                  }}
                  keyboardType="number-pad"
                  placeholder="123456"
                  placeholderTextColor={colors.faint}
                  maxLength={6}
                  autoFocus
                  textAlign="center"
                />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <TouchableOpacity
                  style={[
                    styles.primaryBtn,
                    (busy || code.length !== 6) && styles.btnDisabled,
                  ]}
                  onPress={verify}
                  disabled={busy || code.length !== 6}>
                  {busy ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.primaryBtnText}>Confirm device</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.resend}
                  onPress={sendCode}
                  disabled={busy}>
                  <Text style={styles.resendText}>Resend code</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          <TouchableOpacity style={styles.logout} onPress={() => logout()}>
            <Text style={styles.logoutText}>Log out</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', padding: 24 },
  badge: { fontSize: 44, textAlign: 'center', marginBottom: 8 },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 24,
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 20,
  },
  body: { fontSize: 14, color: colors.label, lineHeight: 20 },
  codeInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 14,
    fontSize: 28,
    letterSpacing: 8,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    marginTop: 16,
  },
  primaryBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 18,
  },
  primaryBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  resend: { marginTop: 16, alignItems: 'center' },
  resendText: { color: PRIMARY, fontSize: 14, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 13, marginTop: 14 },
  logout: { marginTop: 24, alignItems: 'center' },
  logoutText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
});
