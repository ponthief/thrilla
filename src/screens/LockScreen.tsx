import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
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

// Shown when the app is locked.
//
// Either method unlocks, and both are offered when both are set up. This screen
// used to pick one for you: a configured PIN hid the biometric prompt entirely,
// so setting a PIN cost you the fingerprint reader. Now biometric is attempted
// on arrival where it is enabled — it is the faster path and the device already
// knows how — with the PIN pad one tap away, and the PIN pad shown directly
// when that is all there is.
//
// The duress PIN still applies: it looks identical to a normal unlock but wipes
// this device's wallet keys first. It only exists for the PIN, because the OS
// never tells the app which finger or face unlocked it.
export default function LockScreen() {
  const unlock = useAppLockStore((s) => s.unlock);
  // Deliberately not subscribed to `unlocking` — this screen writes it for
  // App.tsx's benefit but must never gate itself on it. See the note below.
  const setUnlocking = useAppLockStore((s) => s.setUnlocking);
  const pinSet = useAppLockStore((s) => s.pinSet);
  const bioEnabled = useAppLockStore((s) => s.bioEnabled);
  const logout = useAuthStore((s) => s.logout);
  const inkey = useAuthStore((s) => s.inkey);
  const [failed, setFailed] = useState(false);
  // Which method the screen is showing. Starts on biometric wherever it is
  // available, and the user can switch; switching is remembered only for this
  // lock, so the next one starts from the fast path again.
  const [mode, setMode] = useState<'bio' | 'pin'>(
    bioEnabled ? 'bio' : 'pin',
  );

  // The initialiser above runs ONCE, on the first render, and reads store values
  // that load asynchronously. App.tsx holds a splash until they are in, so it is
  // right today — but if this screen ever mounted a frame early, a
  // biometric-only user would be shown a PIN pad for a PIN that does not exist
  // and no entry could ever succeed. Reconciling here means the wrong initial
  // guess corrects itself instead of trapping the user.
  const effectiveMode: 'bio' | 'pin' =
    mode === 'pin' && !pinSet && bioEnabled
      ? 'bio'
      : mode === 'bio' && !bioEnabled && pinSet
      ? 'pin'
      : mode;

  // ── Biometric mode ──
  //
  // `unlocking` is GLOBAL state, and it exists for one job: stopping App.tsx's
  // background handler from re-locking while the OS prompt is up (the prompt
  // itself sends the app to the background). It must not also be what gates
  // this screen's controls.
  //
  // It used to be both. If authenticate() never resolved — which is what
  // happens when the activity is destroyed and recreated while the native
  // prompt is showing — the flag stayed true, `prompt()` early-returned on it
  // forever, and the Unlock button was disabled on it forever. The lock screen
  // became unusable with no way out but force-quitting the app.
  //
  // So the button follows a LOCAL flag, cleared in a finally and again whenever
  // the app comes back to the foreground, and nothing on this screen is gated
  // on the global one.
  const [busyBio, setBusyBio] = useState(false);

  const prompt = useCallback(async () => {
    setBusyBio(true);
    setUnlocking(true);
    setFailed(false);
    let ok = false;
    try {
      ok = await appLock.authenticate();
    } catch {
      /* authenticate() swallows its own errors; treat a throw as a failure */
    } finally {
      // Always, on every path. This is the line whose absence wedged the screen.
      setBusyBio(false);
      setUnlocking(false);
    }
    if (ok) {
      unlock();
      return;
    }
    setFailed(true);
  }, [setUnlocking, unlock]);

  // Coming back to the foreground means no OS prompt is in front of us any
  // more, whatever happened to the promise we were waiting on. Clear both flags
  // so a prompt that died with the activity cannot leave the screen inert.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setBusyBio(false);
        setUnlocking(false);
      }
    });
    return () => sub.remove();
  }, [setUnlocking]);

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

  // Ask for the fingerprint as soon as the screen appears, rather than making
  // the user press Unlock first — the press was never doing anything but
  // triggering this. Only once per lock: `failed` gates a retry to the button,
  // so a cancelled prompt does not immediately reappear.
  const autoPrompted = useRef(false);
  useEffect(() => {
    if (effectiveMode !== 'bio' || !bioEnabled || autoPrompted.current) return;
    // Only while the app is actually in front. Firing during a cold start, when
    // the activity may still be settling, is how a prompt ends up outliving the
    // activity that owns it — the failure this screen is recovering from.
    if (AppState.currentState !== 'active') return;
    autoPrompted.current = true;
    prompt();
  }, [effectiveMode, bioEnabled, prompt]);

  if (effectiveMode === 'pin') {
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

          {bioEnabled ? (
            <TouchableOpacity
              style={styles.altMethod}
              onPress={() => {
                setPin('');
                setPinError(false);
                autoPrompted.current = false;
                setMode('bio');
              }}>
              <Text style={styles.altMethodText}>Use fingerprint instead</Text>
            </TouchableOpacity>
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
          style={[styles.button, busyBio && styles.buttonDisabled]}
          onPress={prompt}
          disabled={busyBio}>
          {busyBio ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>{failed ? 'Try again' : 'Unlock'}</Text>
          )}
        </TouchableOpacity>

        {failed ? (
          <Text style={styles.error}>
            Couldn't verify it's you. Try again{pinSet ? ', use your PIN' : ''},
            or log out.
          </Text>
        ) : null}

        {pinSet ? (
          <TouchableOpacity style={styles.altMethod} onPress={() => setMode('pin')}>
            <Text style={styles.altMethodText}>Use PIN instead</Text>
          </TouchableOpacity>
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
  altMethod: { marginTop: 20, paddingVertical: 6 },
  altMethodText: { color: PRIMARY, fontSize: 14, fontWeight: '600' },
  logout: { marginTop: 28 },
  logoutText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
});
