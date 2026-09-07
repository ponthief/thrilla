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
import PinSetupModal from '../components/PinSetupModal';
import { colors } from '@/theme';

const PRIMARY = colors.primary;

// Shown once, after the first sign-in, when the session is about to be kept on
// this device and nothing yet guards it.
//
// This screen is the whole reason keeping the session is not a security
// downgrade. Before, the wallet was behind a password on every cold start. Now
// it is behind the app lock — so the app lock stops being an optional
// preference and becomes the condition for having a stored session at all.
// Without it, persisting the keys would mean anyone holding an unlocked phone
// walks straight into a live wallet.
//
// There is deliberately no skip. What there is instead is a way out that costs
// the user something honest: sign out, and go back to typing a password every
// launch.
export default function LockSetupScreen() {
  const setPinSet = useAppLockStore((s) => s.setPinSet);
  const setBioEnabled = useAppLockStore((s) => s.setBioEnabled);
  const logout = useAuthStore((s) => s.logout);

  const [biometry, setBiometry] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    appLock
      .biometryType()
      .then((t) => {
        if (!cancelled) {
          setBiometry(t);
          setChecking(false);
        }
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enableBiometric = useCallback(async () => {
    setBusy(true);
    setError(null);
    // enable() writes the guarded sentinel and then prompts once to confirm the
    // device really can unlock it, so a success here is proof and not a guess.
    const ok = await appLock.enable();
    if (ok) {
      setBioEnabled(true);
      return;
    }
    setError(
      "Couldn't turn on biometric unlock. Use a PIN instead, or check your device's screen-lock settings.",
    );
    setBusy(false);
  }, [setBioEnabled]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Image
          source={require('../assets/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>Protect your wallet</Text>
        <Text style={styles.subtitle}>
          You won't be asked for your password again on this device. Choose how
          to unlock the app instead — this is what keeps your wallet private if
          someone else picks up your phone.
        </Text>

        {checking ? (
          <ActivityIndicator color={PRIMARY} />
        ) : (
          <>
            {/* Offered first where available: it is faster than a PIN and the
                device already knows how to do it. */}
            <TouchableOpacity
              style={[styles.button, busy && styles.buttonDisabled]}
              onPress={enableBiometric}
              disabled={busy}>
              {busy ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.buttonText}>
                  {biometry ? `Use ${biometry}` : 'Use device unlock'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => setPinOpen(true)}
              disabled={busy}>
              <Text style={styles.secondaryBtnText}>Set a 6-digit PIN</Text>
            </TouchableOpacity>

            <Text style={styles.note}>
              A PIN also lets you set a separate duress PIN later, which wipes
              this device's keys as it unlocks.
            </Text>
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Not a skip. Signing out is the honest alternative: the session stops
            being stored, and the password comes back every launch. */}
        <TouchableOpacity style={styles.logout} onPress={() => logout()}>
          <Text style={styles.logoutText}>Sign out instead</Text>
        </TouchableOpacity>
      </View>

      <PinSetupModal
        visible={pinOpen}
        mode="normal"
        onClose={() => setPinOpen(false)}
        onDone={() => {
          setPinOpen(false);
          setPinSet(true);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  logo: { width: 72, height: 72, marginBottom: 16 },
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
    paddingHorizontal: 40,
    alignItems: 'center',
    minWidth: 240,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 13,
    paddingHorizontal: 40,
    alignItems: 'center',
    marginTop: 12,
    minWidth: 240,
  },
  secondaryBtnText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  note: {
    fontSize: 12,
    color: colors.faint,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 17,
    paddingHorizontal: 8,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 8,
  },
  logout: { marginTop: 28 },
  logoutText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
});
