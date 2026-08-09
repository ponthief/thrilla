import React, { useCallback, useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import PinPad from './PinPad';
import { setPin as savePin, setDuressPin } from '@services/appPin';
import { colors } from '@/theme';

type Mode = 'normal' | 'duress';
type Phase = 'enter' | 'confirm';
const LEN = 6;

interface Props {
  visible: boolean;
  mode: Mode;
  onClose: () => void;
  onDone: () => void;
}

// Two-step PIN setter (enter → confirm) for the normal or duress PIN. Never
// stores plaintext — appPin hashes it.
export default function PinSetupModal({ visible, mode, onClose, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('enter');
  const [first, setFirst] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setPhase('enter');
      setFirst('');
      setPin('');
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  const finish = useCallback(
    async (confirmed: string) => {
      setBusy(true);
      const ok =
        mode === 'duress'
          ? await setDuressPin(confirmed)
          : await savePin(confirmed);
      if (!ok) {
        setError(
          mode === 'duress'
            ? 'Duress PIN must be different from your normal PIN.'
            : 'Could not save the PIN. Try again.',
        );
        setPhase('enter');
        setFirst('');
        setPin('');
        setBusy(false);
        return;
      }
      onDone();
    },
    [mode, onDone],
  );

  useEffect(() => {
    if (busy || pin.length !== LEN) return;
    if (phase === 'enter') {
      setFirst(pin);
      setPin('');
      setError(null);
      setPhase('confirm');
    } else if (pin === first) {
      finish(pin);
    } else {
      setError("PINs don't match. Start again.");
      setFirst('');
      setPin('');
      setPhase('enter');
    }
  }, [pin, phase, first, busy, finish]);

  const heading =
    mode === 'duress'
      ? phase === 'enter'
        ? 'Set a duress PIN'
        : 'Confirm duress PIN'
      : phase === 'enter'
        ? 'Set a PIN'
        : 'Confirm PIN';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.heading}>{heading}</Text>
          <Text style={styles.sub}>
            {mode === 'duress'
              ? "Entering this PIN at the lock screen silently wipes this device's wallet keys. Pick one different from your normal PIN."
              : "You'll enter this 6-digit PIN to unlock Thrilla."}
          </Text>

          <PinPad
            value={pin}
            onChange={(v) => {
              setError(null);
              setPin(v);
            }}
            length={LEN}
            disabled={busy}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity style={styles.cancel} onPress={onClose} disabled={busy}>
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
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  heading: { fontSize: 20, fontWeight: 'bold', color: colors.text },
  sub: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
    lineHeight: 19,
    paddingHorizontal: 8,
  },
  error: { color: colors.danger, fontSize: 13, marginTop: 16, textAlign: 'center' },
  cancel: { marginTop: 22, paddingVertical: 8 },
  cancelText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
});
