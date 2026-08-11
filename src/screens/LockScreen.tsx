import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppLockStore } from '@stores/appLockStore';
import { useAuthStore } from '@stores/authStore';
import * as appLock from '@services/appLock';
import { verifyPin } from '@services/appPin';
import { runDuress } from '@services/duress';
import PinPad from '../components/PinPad';
import { colors } from '@/theme';

const PRIMARY = colors.primary;
const PIN_LENGTH = 6;

// Shown when the app is locked. Two modes:
//  - PIN set  → numeric PIN pad. The normal PIN unlocks; a duress PIN silently
//    wipes this device's wallet keys first, then unlocks identically.
//  - otherwise → the device biometric/passcode prompt.
export default function LockScreen() {
  const unlock = useAppLockStore((s) => s.unlock);
  const unlocking = useAppLockStore((s) => s.unlocking);
  const setUnlocking = useAppLockStore((s) => s.setUnlocking);
  const pinSet = useAppLockStore((s) => s.pinSet);
  const logout = useAuthStore((s) => s.logout);
  const inkey = useAuthStore((s) => s.inkey);
  const [failed, setFailed] = useState(false);

  // ── Biometric mode ──
  const prompt = useCallback(async () => {
    if (unlocking) return;
    setUnlocking(true);
    setFailed(false);
    try {
      const ok = await appLock.authenticate();
      if (ok) {
        unlock();
        return;
      }
    } catch {
      /* authenticate() swallows errors; never wedge the button */
    }
    setFailed(true);
    setUnlocking(false);
  }, [unlocking, setUnlocking, unlock]);

  // ── PIN mode ──
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [busy, setBusy] = useState(false);

  const submitPin = useCallback(
    async (entered: string) => {
      setBusy(true);
      const kind = await verifyPin(entered);
      if (kind === 'duress') {
        // Silent duress response — looks like a normal unlock but wipes the
        // device and drops the session (see runDuress).
        setPin('');
        await runDuress(inkey, logout);
        return;
      }
      if (kind === 'normal') {
        setPin('');
        unlock();
        return;
      }
      setPin('');
      setPinError(true);
      setBusy(false);
    },
    [unlock, logout, inkey],
  );

  useEffect(() => {
    if (!busy && pin.length === PIN_LENGTH) submitPin(pin);
  }, [pin, busy, submitPin]);

  if (pinSet) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Image
            source={require('../assets/icon.png')}
            style={styles.logoSm}
            resizeMode="contain"
          />
          <Text style={styles.title}>Enter your PIN</Text>
          <Text style={styles.subtitle}>Enter your PIN to unlock Thrilla.</Text>

          <PinPad
            value={pin}
            onChange={(v) => {
              setPinError(false);
              setPin(v);
            }}
            length={PIN_LENGTH}
            disabled={busy}
          />

          {busy ? (
            <View style={styles.checkingRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.checking}>Checking…</Text>
            </View>
          ) : pinError ? (
            <Text style={styles.error}>Incorrect PIN. Try again.</Text>
          ) : null}

          <TouchableOpacity style={styles.logout} onPress={() => logout()}>
            <Text style={styles.logoutText}>Log out instead</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Image
          source={require('../assets/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>Thrilla is locked</Text>
        <Text style={styles.subtitle}>
          Unlock with your fingerprint, face, or device PIN to continue.
        </Text>

        <TouchableOpacity
          style={[styles.button, unlocking && styles.buttonDisabled]}
          onPress={prompt}
          disabled={unlocking}>
          {unlocking ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>{failed ? 'Try again' : 'Unlock'}</Text>
          )}
        </TouchableOpacity>

        {failed ? (
          <Text style={styles.error}>
            Couldn't verify it's you. Try again, or log out.
          </Text>
        ) : null}

        <TouchableOpacity style={styles.logout} onPress={() => logout()}>
          <Text style={styles.logoutText}>Log out instead</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  logo: { width: 88, height: 88, marginBottom: 16 },
  logoSm: { width: 56, height: 56, marginBottom: 12 },
  title: { fontSize: 24, fontWeight: 'bold', color: colors.text },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 28,
    lineHeight: 20,
  },
  button: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 48,
    alignItems: 'center',
    minWidth: 200,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
  error: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 8,
  },
  checkingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  checking: { color: colors.muted, fontSize: 13, marginLeft: 8 },
  logout: { marginTop: 28 },
  logoutText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
});
