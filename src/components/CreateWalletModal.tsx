import React, { useCallback, useState } from 'react';
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
import Clipboard from '@react-native-clipboard/clipboard';
import Config from 'react-native-config';
import CryptoJS from 'crypto-js';
import { useAuthStore } from '@stores/authStore';
import * as api from '@services/api';
import { colors } from '@/theme';

const PRIMARY = colors.primary;

interface Props {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}

type Step = 'form' | 'reveal';
type Mode = 'generate' | 'import';

// The backend decrypts the imported seed with String(last_height) as the AES
// key (lnbits AESCipher == CryptoJS OpenSSL "Salted__" format), so we encrypt
// exactly the way the web app does before sending it.
function encryptMnemonicForImport(mnemonic: string, lastHeight: number): string {
  return CryptoJS.AES.encrypt(mnemonic, String(lastHeight)).toString();
}

export default function CreateWalletModal({ visible, onClose, onCreated }: Props) {
  const inkey = useAuthStore((s) => s.inkey);
  const network = (Config.NETWORK_LOCK || 'mainnet').toUpperCase();

  const [step, setStep] = useState<Step>('form');
  const [mode, setMode] = useState<Mode>('generate');
  const [title, setTitle] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [mnemonicInput, setMnemonicInput] = useState('');
  const [birthHeight, setBirthHeight] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mnemonic, setMnemonic] = useState<string>('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);

  const reset = useCallback(() => {
    setStep('form');
    setMode('generate');
    setTitle('');
    setPassphrase('');
    setMnemonicInput('');
    setBirthHeight('');
    setShowAdvanced(false);
    setCreating(false);
    setError(null);
    setMnemonic('');
    setAcknowledged(false);
    setCopied(false);
  }, []);

  const onCreate = useCallback(async () => {
    setError(null);
    if (!title.trim()) {
      setError('Please enter a title for the wallet.');
      return;
    }
    if (!inkey) {
      setError('Not logged in.');
      return;
    }

    const data: {
      title: string;
      passphrase?: string;
      mnemonic?: string;
      last_height?: number;
    } = { title: title.trim() };
    if (passphrase) data.passphrase = passphrase;

    if (mode === 'import') {
      const words = mnemonicInput.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (words.length !== 12) {
        setError('Recovery phrase must be exactly 12 words.');
        return;
      }
      const height = Number(birthHeight);
      if (!birthHeight || !Number.isFinite(height) || height < 0) {
        setError('Enter the wallet birth height (block number) to import.');
        return;
      }
      data.last_height = Math.floor(height);
      data.mnemonic = encryptMnemonicForImport(words.join(' '), Math.floor(height));
    }

    setCreating(true);
    try {
      const res = await api.createSilntWallet(inkey, data);
      if (res.mnemonic && res.generated) {
        // Fresh seed — show it once so the user can back it up.
        setMnemonic(res.mnemonic);
        setStep('reveal');
      } else {
        // Import: the user already has their phrase — just finish.
        onCreated();
        reset();
        onClose();
      }
    } catch (e: any) {
      setError(e?.message || 'Could not create wallet.');
    } finally {
      setCreating(false);
    }
  }, [
    title,
    passphrase,
    mode,
    mnemonicInput,
    birthHeight,
    inkey,
    onCreated,
    onClose,
    reset,
  ]);

  const finishReveal = useCallback(() => {
    onCreated();
    reset();
    onClose();
  }, [onCreated, reset, onClose]);

  const copyMnemonic = useCallback(() => {
    Clipboard.setString(mnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [mnemonic]);

  const words = mnemonic ? mnemonic.trim().split(/\s+/) : [];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={step === 'reveal' ? undefined : onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {step === 'form' ? (
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.heading}>New Wallet</Text>
              <Text style={styles.networkTag}>{network}</Text>

              <View style={styles.segment}>
                <TouchableOpacity
                  style={[styles.segBtn, mode === 'generate' && styles.segBtnOn]}
                  onPress={() => {
                    setMode('generate');
                    setError(null);
                  }}>
                  <Text
                    style={[
                      styles.segText,
                      mode === 'generate' && styles.segTextOn,
                    ]}>
                    Generate
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.segBtn, mode === 'import' && styles.segBtnOn]}
                  onPress={() => {
                    setMode('import');
                    setError(null);
                  }}>
                  <Text
                    style={[
                      styles.segText,
                      mode === 'import' && styles.segTextOn,
                    ]}>
                    Import
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Wallet name</Text>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder="My Wallet"
                placeholderTextColor="#aaa"
                maxLength={40}
                autoFocus
              />

              {mode === 'import' ? (
                <>
                  <Text style={styles.label}>Recovery phrase (12 words)</Text>
                  <TextInput
                    style={[styles.input, styles.mnemonicInput]}
                    value={mnemonicInput}
                    onChangeText={setMnemonicInput}
                    placeholder="word1 word2 word3 …"
                    placeholderTextColor="#aaa"
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                  />
                  <Text style={styles.label}>Born at height (block)</Text>
                  <TextInput
                    style={styles.input}
                    value={birthHeight}
                    onChangeText={(t) => setBirthHeight(t.replace(/[^0-9]/g, ''))}
                    placeholder="e.g. 840000"
                    placeholderTextColor="#aaa"
                    keyboardType="number-pad"
                  />
                  <Text style={styles.hint}>
                    The block height the wallet was created at. Scanning starts
                    here, so an accurate value avoids missing funds.
                  </Text>
                </>
              ) : null}

              <TouchableOpacity
                onPress={() => setShowAdvanced((v) => !v)}
                style={styles.advancedToggle}>
                <Text style={styles.advancedText}>
                  {showAdvanced ? '▾' : '▸'} Advanced (optional passphrase)
                </Text>
              </TouchableOpacity>
              {showAdvanced ? (
                <>
                  <Text style={styles.label}>BIP-39 passphrase</Text>
                  <TextInput
                    style={styles.input}
                    value={passphrase}
                    onChangeText={setPassphrase}
                    placeholder="Leave blank for none"
                    placeholderTextColor="#aaa"
                    autoCapitalize="none"
                    secureTextEntry
                  />
                  <Text style={styles.hint}>
                    An extra word mixed into your seed. If you set one, you must
                    remember it — it cannot be recovered.
                  </Text>
                </>
              ) : null}

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <TouchableOpacity
                style={[styles.primaryBtn, creating && styles.btnDisabled]}
                onPress={onCreate}
                disabled={creating}>
                {creating ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {mode === 'import' ? 'Import Wallet' : 'Create Wallet'}
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkBtn} onPress={onClose}>
                <Text style={styles.linkBtnText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.heading}>Save your recovery phrase</Text>
              <Text style={styles.warn}>
                Write these 12 words down in order and keep them safe. This is
                the ONLY way to recover your wallet. It will not be shown again.
              </Text>

              <View style={styles.wordGrid}>
                {words.map((w, i) => (
                  <View key={`${i}-${w}`} style={styles.wordChip}>
                    <Text style={styles.wordIndex}>{i + 1}</Text>
                    <Text style={styles.wordText}>{w}</Text>
                  </View>
                ))}
              </View>

              <TouchableOpacity style={styles.copyBtn} onPress={copyMnemonic}>
                <Text style={styles.copyBtnText}>
                  {copied ? '✓ Copied' : 'Copy phrase'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.checkRow}
                onPress={() => setAcknowledged((v) => !v)}>
                <View style={[styles.checkbox, acknowledged && styles.checkboxOn]}>
                  {acknowledged ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
                <Text style={styles.checkLabel}>
                  I have written down my recovery phrase.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.primaryBtn, !acknowledged && styles.btnDisabled]}
                onPress={finishReveal}
                disabled={!acknowledged}>
                <Text style={styles.primaryBtnText}>Done</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
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
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '90%',
  },
  heading: { fontSize: 20, fontWeight: 'bold', color: '#000' },
  networkTag: {
    alignSelf: 'flex-start',
    marginTop: 6,
    marginBottom: 8,
    fontSize: 11,
    fontWeight: '700',
    color: PRIMARY,
    backgroundColor: 'rgba(249,115,22,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#e9e9ee',
    borderRadius: 10,
    padding: 3,
    marginTop: 14,
  },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segBtnOn: { backgroundColor: '#fff' },
  segText: { fontSize: 14, fontWeight: '600', color: '#666' },
  segTextOn: { color: PRIMARY },
  mnemonicInput: { minHeight: 76, textAlignVertical: 'top' },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#444',
    marginTop: 14,
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
  hint: { fontSize: 12, color: '#999', marginTop: 6 },
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

  warn: {
    fontSize: 13,
    color: '#c0392b',
    marginTop: 10,
    marginBottom: 16,
    lineHeight: 19,
  },
  wordGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  wordChip: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '48%',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  wordIndex: {
    fontSize: 11,
    color: '#999',
    width: 20,
    fontVariant: ['tabular-nums'],
  },
  wordText: { fontSize: 15, fontWeight: '600', color: '#000' },
  copyBtn: {
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 6,
  },
  copyBtnText: { color: PRIMARY, fontSize: 14, fontWeight: '600' },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxOn: { backgroundColor: PRIMARY },
  checkMark: { color: colors.onPrimary, fontSize: 14, fontWeight: 'bold' },
  checkLabel: { flex: 1, fontSize: 14, color: '#333' },
});
