import React, { useCallback, useEffect, useRef } from 'react';
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
  const attempted = useRef(false);

  const prompt = useCallback(async () => {
    if (unlocking) return;
    setUnlocking(true);
    const ok = await appLock.authenticate();
    if (ok) {
      unlock();
    } else {
      setUnlocking(false);
    }
  }, [unlocking, setUnlocking, unlock]);

  // Prompt once automatically when the lock screen appears.
  useEffect(() => {
    if (!attempted.current) {
      attempted.current = true;
      prompt();
    }
  }, [prompt]);

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
            <Text style={styles.buttonText}>Unlock</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.logout} onPress={() => logout()}>
          <Text style={styles.logoutText}>Log out instead</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  logo: { width: 88, height: 88, marginBottom: 16 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#000' },
  subtitle: {
    fontSize: 14,
    color: '#666',
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
  logout: { marginTop: 20 },
  logoutText: { color: '#666', fontSize: 14, fontWeight: '600' },
});
