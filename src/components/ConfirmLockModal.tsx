import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAppLockStore } from '@stores/appLockStore';
import { useAuthStore } from '@stores/authStore';
import * as appLock from '@services/appLock';
import { verifyPin } from '@services/appPin';
import { runDuress } from '@services/duress';
import PinPad from './PinPad';
import { colors } from '@/theme';

const PIN_LENGTH = 6;

interface Props {
  visible: boolean;
  onAuthenticated: () => void;
  onCancel: () => void;
  title?: string;
  subtitle?: string;
}

// Re-authentication gate for a sensitive action (e.g. sending funds). Reuses the
// app-lock the user already configured:
//   - PIN set        → in-app PIN pad. The normal PIN authorizes; a duress PIN
//                      wipes this device and logs out (identical to the lock
//                      screen), so a coerced send can be escaped.
//   - biometric only → the OS fingerprint/Face/passcode prompt.
// The caller should only mount this when a lock is actually enabled; with no
// lock there's nothing to prompt.
export default function ConfirmLockModal({
  visible,
  onAuthenticated,
  onCancel,
  title = 'Confirm it’s you',
  subtitle = 'Authenticate to authorize this transaction.',
}: Props) {
  const pinSet = useAppLockStore((s) => s.pinSet);
  const bioEnabled = useAppLockStore((s) => s.bioEnabled);
  const inkey = useAuthStore((s) => s.inkey);
  const logout = useAuthStore((s) => s.logout);

  // PIN mode takes precedence when set (mirrors the lock screen).
  const usePinMode = pinSet;

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bioFailed, setBioFailed] = useState(false);

  // Reset transient state whenever the sheet opens/closes.
  useEffect(() => {
    if (visible) {
      setPin('');
      setPinError(false);
      setBusy(false);
      setBioFailed(false);
    }
  }, [visible]);

  // ── Biometric mode ──
  const promptBiometric = useCallback(async () => {
    setBusy(true);
    setBioFailed(false);
    let ok = false;
    try {
      ok = await appLock.authenticate('Confirm to send');
    } catch {
      ok = false;
    }
    setBusy(false);
    if (ok) onAuthenticated();
    else setBioFailed(true);
  }, [onAuthenticated]);

  // Auto-trigger the OS prompt as soon as the biometric sheet opens.
  useEffect(() => {
    if (visible && !usePinMode && bioEnabled) promptBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, usePinMode, bioEnabled]);

  // ── PIN mode ──
  const submitPin = useCallback(
    async (entered: string) => {
      setBusy(true);
      const kind = await verifyPin(entered);
      if (kind === 'duress') {
        setPin('');
        await runDuress(inkey, logout); // wipes + logs out; modal unmounts
        return;
      }
      if (kind === 'normal') {
        setPin('');
        setBusy(false);
        onAuthenticated();
        return;
      }
      setPin('');
      setPinError(true);
      setBusy(false);
    },
    [inkey, logout, onAuthenticated],
  );

  useEffect(() => {
    if (usePinMode && !busy && pin.length === PIN_LENGTH) submitPin(pin);
  }, [pin, busy, usePinMode, submitPin]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          {usePinMode ? (
            <>
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
                <View style={styles.row}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.checking}>Checking…</Text>
                </View>
              ) : pinError ? (
                <Text style={styles.error}>Incorrect PIN. Try again.</Text>
              ) : null}
            </>
          ) : (
            <View style={styles.bioBox}>
              {busy ? (
                <ActivityIndicator color={colors.primary} />
              ) : bioFailed ? (
                <>
                  <Text style={styles.error}>
                    Couldn’t verify it’s you.
                  </Text>
                  <TouchableOpacity
                    style={styles.retryBtn}
                    onPress={promptBiometric}>
                    <Text style={styles.retryText}>Try again</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          )}

          <TouchableOpacity style={styles.cancel} onPress={onCancel} disabled={busy}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.bg,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  title: { fontSize: 20, fontWeight: 'bold', color: colors.text },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
    lineHeight: 20,
  },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  checking: { color: colors.muted, fontSize: 13, marginLeft: 8 },
  error: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 8,
  },
  bioBox: { minHeight: 72, justifyContent: 'center', alignItems: 'center' },
  retryBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 28,
    marginTop: 16,
  },
  retryText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  cancel: { marginTop: 24, paddingVertical: 6 },
  cancelText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
});
