import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as api from '@services/api';
import { storeWalletKeys } from '@services/secureKeys';
import { deriveSilentPayment, isValidMnemonic } from '@services/spKeys';
import { resetCatchUp } from '../hooks/useCatchUpScan';
import SeedInput from './SeedInput';
import { colors } from '@/theme';

const PRIMARY = colors.primary;

interface Props {
  visible: boolean;
  wallet: api.SilntWallet | null;
  onClose: () => void;
  onRecovered: () => void;
}

export default function RecoverKeysModal({
  visible,
  wallet,
  onClose,
  onRecovered,
}: Props) {
  const [mnemonic, setMnemonic] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setMnemonic('');
      setPassphrase('');
      setShowAdvanced(false);
      setError(null);
    }
  }, [visible, wallet]);

  const onSubmit = useCallback(async () => {
    setError(null);
    if (!wallet) return;
    const words = mnemonic.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length !== 12) {
      setError('Recovery phrase must be exactly 12 words.');
      return;
    }
    const phrase = words.join(' ');
    if (!isValidMnemonic(phrase)) {
      setError('Invalid recovery phrase — the checksum (last word) is incorrect.');
      return;
    }
    setBusy(true);
    try {
      // Derive entirely on-device, then confirm it reproduces THIS wallet's
      // address before trusting it — a wrong phrase or passphrase derives a
      // different address. Nothing is sent to the server.
      const keys = deriveSilentPayment(phrase, passphrase, wallet.network);
      if (
        keys.spAddress.toLowerCase() !== (wallet.sp_address || '').toLowerCase()
      ) {
        throw new Error(
          "That phrase doesn't match this wallet's address. Check the words and passphrase.",
        );
      }
      await storeWalletKeys(wallet.id, keys.scanSecret, keys.spendKey);
      resetCatchUp(wallet.id);
      onRecovered();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Recovery failed. Check the phrase and try again.');
    } finally {
      setBusy(false);
    }
  }, [wallet, mnemonic, passphrase, onRecovered, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.heading}>Recover wallet keys</Text>
            <Text style={styles.sub}>
              Enter this wallet's 12-word recovery phrase to restore its keys on
              this device. Keys stay on-device — they're never sent to the server.
            </Text>

            <Text style={styles.label}>Recovery phrase (12 words)</Text>
            <SeedInput
              value={mnemonic}
              onChangeText={setMnemonic}
              placeholder="word1 word2 word3 …"
            />

            <TouchableOpacity
              style={styles.advancedToggle}
              onPress={() => setShowAdvanced((v) => !v)}>
              <Text style={styles.advancedText}>
                {showAdvanced ? '▾' : '▸'} Advanced (passphrase)
              </Text>
            </TouchableOpacity>
            {showAdvanced ? (
              <TextInput
                style={styles.input}
                value={passphrase}
                onChangeText={setPassphrase}
                placeholder="BIP-39 passphrase (if you set one)"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                secureTextEntry
              />
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.primaryBtn, busy && styles.btnDisabled]}
              onPress={onSubmit}
              disabled={busy}>
              {busy ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryBtnText}>Recover Keys</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkBtn} onPress={onClose} disabled={busy}>
              <Text style={styles.linkBtnText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '90%',
  },
  heading: { fontSize: 20, fontWeight: 'bold', color: colors.text },
  sub: { fontSize: 13, color: colors.muted, marginTop: 8, lineHeight: 19 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.label,
    marginTop: 16,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  mnemonic: { minHeight: 76, textAlignVertical: 'top' },
  advancedToggle: { marginTop: 16 },
  advancedText: { color: PRIMARY, fontSize: 13, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 13, marginTop: 14 },
  primaryBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 22,
  },
  primaryBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  linkBtn: { marginTop: 12, paddingVertical: 8, alignItems: 'center' },
  linkBtnText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
});
