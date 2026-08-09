import React, { useCallback, useState } from 'react';
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
import { colors } from '@/theme';

const PRIMARY = colors.primary;

// Shown when the app is locked. Auto-prompts for biometric/PIN unlock on mount;
// offers a manual retry and a way out (log out) if the user can't authenticate.
export default function LockScreen() {
  const unlock = useAppLockStore((s) => s.unlock);
  const unlocking = useAppLockStore((s) => s.unlocking);
  const setUnlocking = useAppLockStore((s) => s.setUnlocking);
  const logout = useAuthStore((s) => s.logout);
  const [failed, setFailed] = useState(false);

  const prompt = useCallback(async () => {
    if (unlocking) return;
    setUnlocking(true);
    setFailed(false);
    try {
      const ok = await appLock.authenticate();
      if (ok) {
        unlock();
        return; // unlock() clears `unlocking`; the lock screen unmounts
      }
    } catch {
      // authenticate() already swallows errors, but never let an unexpected
      // throw wedge the button in its disabled/spinner state.
    }
    // Failed / cancelled / unavailable: surface it (so it doesn't look like
    // nothing happened) and re-enable the button so the user can retry or use
    // "Log out instead". The Unlock button must never stay stuck disabled.
    setFailed(true);
    setUnlocking(false);
  }, [unlocking, setUnlocking, unlock]);

  // NOTE: we deliberately do NOT auto-trigger the biometric prompt on mount.
  // The lock screen appears as the Activity resumes from background, and Android's
  // BiometricPrompt fails (silently, sometimes leaving a fragment that swallows
  // touches) if started before the Activity is fully resumed — which made both
  // buttons appear dead. The user taps "Unlock" once resumed, which is reliable.

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
  logout: { marginTop: 20 },
  logoutText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
});
