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
import CryptoJS from 'crypto-js';
import { useAuthStore } from '@stores/authStore';
import * as api from '@services/api';
import { storeWalletKeys } from '@services/secureKeys';
import { resetCatchUp } from '../hooks/useCatchUpScan';
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
  const inkey = useAuthStore((s) => s.inkey);

  const [mnemonic, setMnemonic] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [height, setHeight] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill the birth height from the wallet when the sheet opens.
  useEffect(() => {
    if (visible) {
      setHeight(wallet?.last_height ? String(wallet.last_height) : '');
      setMnemonic('');
      setPassphrase('');
      setShowAdvanced(false);
      setError(null);
    }
  }, [visible, wallet]);

  const onSubmit = useCallback(async () => {
    setError(null);
    if (!wallet || !inkey) return;
    const words = mnemonic.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length !== 12) {
      setError('Recovery phrase must be exactly 12 words.');
      return;
    }
    const h = Number(height);
    if (!height || !Number.isFinite(h) || h < 0) {
      setError('Enter the wallet birth height (block number).');
      return;
    }
    setBusy(true);
    try {
      // Same AES(mnemonic, String(last_height)) envelope as import.
      const enc = CryptoJS.AES.encrypt(words.join(' '), String(Math.floor(h))).toString();
      const res = await api.recoverWalletKeys(
        inkey,
        wallet.id,
        enc,
        Math.floor(h),
        passphrase || null,
      );
      if (!res?.scan_secret || !res?.spend_key) {
        throw new Error('Could not derive keys from that phrase.');
      }
      await storeWalletKeys(wallet.id, res.scan_secret, res.spend_key);
      resetCatchUp(wallet.id);
      onRecovered();
      onClose();
    } catch (e: any) {
      // The backend rejects a seed whose address doesn't match this wallet.
      setError(e?.message || 'Recovery failed. Check the phrase and try again.');
    } finally {
      setBusy(false);
    }
  }, [wallet, inkey, mnemonic, height, passphrase, onRecovered, onClose]);

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
            <TextInput
              style={[styles.input, styles.mnemonic]}
              value={mnemonic}
              onChangeText={setMnemonic}
              placeholder="word1 word2 word3 …"
              placeholderTextColor="#aaa"
              autoCapitalize="none"
              autoCorrect={false}
              multiline
            />

            <Text style={styles.label}>Born at height (block)</Text>
            <TextInput
              style={styles.input}
              value={height}
              onChangeText={(t) => setHeight(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="e.g. 840000"
              placeholderTextColor="#aaa"
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
                placeholderTextColor="#aaa"
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
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '90%',
  },
  heading: { fontSize: 20, fontWeight: 'bold', color: '#000' },
  sub: { fontSize: 13, color: '#666', marginTop: 8, lineHeight: 19 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#444',
    marginTop: 16,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#000',
    backgroundColor: '#fafafa',
  },
  mnemonic: { minHeight: 76, textAlignVertical: 'top' },
  advancedToggle: { marginTop: 16 },
  advancedText: { color: PRIMARY, fontSize: 13, fontWeight: '600' },
  error: { color: '#c0392b', fontSize: 13, marginTop: 14 },
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
  linkBtnText: { color: '#666', fontSize: 14, fontWeight: '600' },
});
