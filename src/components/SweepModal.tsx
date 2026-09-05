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
import { useAuthStore } from '@stores/authStore';
import { getWalletKeys, storeWalletKeys } from '@services/secureKeys';
import { deriveSilentPayment, deriveSweepKey, isValidMnemonic } from '@services/spKeys';
import { usePendingSends } from '@stores/pendingSends';
import SeedInput from './SeedInput';
import { colors } from '@/theme';

const PRIMARY = colors.primary;

// Group thousands without Intl (Hermes ships without full Intl support).
function groupThousands(n: number): string {
  return Math.floor(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

type Mode = 'reveal' | 'sweep';
type Stage = 'phrase' | 'review' | 'done';

interface Props {
  visible: boolean;
  mode: Mode;
  wallet: api.SilntWallet;
  onClose: () => void;
  // Fired after the address is derived (reveal) or the sweep is broadcast, so
  // the card behind can refresh.
  onChanged: () => void;
}

/**
 * Sweeps the wallet's plain BIP-84 address into its Silent Payment address —
 * the way coins get in from a service that can only pay bech32.
 *
 * Asks for the recovery phrase every time, by design. The BIP-84 branch is the
 * one key this wallet does NOT keep: not in the device keystore beside the scan
 * and spend keys, not on the server. Its address holds coins only in transit, so
 * a key at rest for it would be a standing risk in exchange for saving a few
 * seconds on a rare action. The phrase is used to derive, sign, and is then gone
 * with the component state.
 *
 * The phrase is checked by re-deriving the wallet's Silent Payment address from
 * it and comparing — a wrong phrase or a forgotten passphrase produces a
 * different wallet entirely, and would otherwise sweep to an address the user
 * cannot see.
 */
export default function SweepModal({ visible, mode, wallet, onClose, onChanged }: Props) {
  const adminkey = useAuthStore((s) => s.adminkey);
  const inkey = useAuthStore((s) => s.inkey);

  const [stage, setStage] = useState<Stage>('phrase');
  const [mnemonic, setMnemonic] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [feeRate, setFeeRate] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [built, setBuilt] = useState<api.BuiltSweep | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStage('phrase');
    setMnemonic('');
    setPassphrase('');
    setBuilt(null);
    setTxid(null);
    setAddress(null);
    setError(null);
    // A sweep is never urgent — default to the half-hour rate rather than the
    // top of the mempool, and let it be edited.
    if (inkey) {
      api
        .getRecommendedFees(inkey)
        .then((t) => {
          const r = t.halfHourFee ?? t.hourFee ?? t.fastestFee ?? 1;
          setFeeRate(String(r));
        })
        .catch(() => {
          /* keep the default; the field is editable */
        });
    }
  }, [visible, inkey]);

  // Derive from the phrase and prove it belongs to THIS wallet.
  const deriveVerified = useCallback(() => {
    const words = mnemonic.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length !== 12) {
      throw new Error('Recovery phrase must be exactly 12 words.');
    }
    const phrase = words.join(' ');
    if (!isValidMnemonic(phrase)) {
      throw new Error('Invalid recovery phrase — the checksum (last word) is incorrect.');
    }
    const sp = deriveSilentPayment(phrase, passphrase, wallet.network);
    if (sp.spAddress.toLowerCase() !== (wallet.sp_address || '').toLowerCase()) {
      throw new Error(
        "That phrase doesn't match this wallet's address. Check the words and passphrase.",
      );
    }
    return deriveSweepKey(phrase, passphrase, wallet.network);
  }, [mnemonic, passphrase, wallet.network, wallet.sp_address]);

  // The address is public, so caching it in the keystore entry means the card
  // can show it without ever asking for the phrase again.
  const rememberAddress = useCallback(
    async (addr: string) => {
      const keys = await getWalletKeys(wallet.id);
      if (keys && keys.refundAddress !== addr) {
        await storeWalletKeys(wallet.id, keys.scanSecret, keys.spendKey, addr);
      }
    },
    [wallet.id],
  );

  const onSubmitPhrase = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const sweep = deriveVerified();
      await rememberAddress(sweep.address);

      if (mode === 'reveal') {
        setAddress(sweep.address);
        setStage('done');
        onChanged();
        return;
      }

      const rate = Number(feeRate);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error('Enter a fee rate above zero.');
      }
      if (!adminkey) throw new Error('Not logged in.');
      const res = await api.buildSweepTx(adminkey, wallet.id, sweep.privateKeyHex, rate);
      setBuilt(res);
      setAddress(sweep.address);
      setStage('review');
    } catch (e: any) {
      setError(e?.message || 'Could not prepare the sweep.');
    } finally {
      setBusy(false);
    }
  }, [deriveVerified, rememberAddress, mode, feeRate, adminkey, wallet.id, onChanged]);

  const onConfirm = useCallback(async () => {
    if (!built || !adminkey) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.broadcastSweepTx(adminkey, wallet.id, built.tx_hex);
      setTxid(res.txid);
      // Watched like a pending send: the shared watcher notices the first
      // confirmation and scans that block, which is what actually brings the
      // swept coins into the wallet. Only an optimisation — the watch list is
      // in memory, so closing the app loses it, and the catch-up scan on the
      // next wallet open finds the output anyway (a bounded scan never advances
      // last_height, so the gap it covers still includes this block).
      usePendingSends.getState().add({
        txid: res.txid,
        walletId: wallet.id,
        amountSats: built.amount,
        kind: 'sweep',
      });
      setStage('done');
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Broadcast failed.');
    } finally {
      setBusy(false);
    }
  }, [built, adminkey, wallet.id, onChanged]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled">
            {stage === 'phrase' ? (
              <>
                <Text style={styles.heading}>
                  {mode === 'reveal' ? 'Show sweep address' : 'Sweep into wallet'}
                </Text>
                <Text style={styles.sub}>
                  {mode === 'reveal'
                    ? 'Your sweep address comes from the same recovery phrase as this wallet. Enter it once and this device will remember the address.'
                    : "Enter this wallet's recovery phrase to sign the sweep. The key for the sweep address is never stored — on this device or the server — so it's derived here and discarded."}
                </Text>

                <Text style={styles.label}>Recovery phrase (12 words)</Text>
                <SeedInput
                  value={mnemonic}
                  onChangeText={setMnemonic}
                  placeholder="word1 word2 word3 …"
                />

                <Text style={styles.label}>Passphrase</Text>
                <TextInput
                  style={styles.input}
                  value={passphrase}
                  onChangeText={setPassphrase}
                  placeholder="Leave blank if none"
                  placeholderTextColor={colors.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                />

                {mode === 'sweep' ? (
                  <>
                    <Text style={styles.label}>Fee rate (sat/vB)</Text>
                    <TextInput
                      style={styles.input}
                      value={feeRate}
                      onChangeText={setFeeRate}
                      keyboardType="numeric"
                      placeholderTextColor={colors.faint}
                    />
                  </>
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <TouchableOpacity
                  style={[styles.primaryBtn, busy && styles.btnDisabled]}
                  onPress={onSubmitPhrase}
                  disabled={busy}>
                  {busy ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.primaryBtnText}>
                      {mode === 'reveal' ? 'Show address' : 'Continue'}
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            ) : null}

            {stage === 'review' && built ? (
              <>
                <Text style={styles.heading}>Confirm sweep</Text>
                <Text style={styles.sub}>
                  Everything on your sweep address moves into this wallet in one
                  transaction. Nothing is left behind.
                </Text>

                <Row label="Moving in" value={`${groupThousands(built.amount)} sats`} />
                <Row
                  label="Network fee"
                  value={`${groupThousands(built.fee)} sats @ ${built.fee_rate_used} sat/vB`}
                />
                <Row
                  label="Coins"
                  value={`${built.input_count} (${groupThousands(built.total_input)} sats)`}
                />
                {built.unconfirmed_sats > 0 ? (
                  <Text style={styles.hint}>
                    {groupThousands(built.unconfirmed_sats)} sats on this address
                    aren't confirmed yet and are not included. Sweep again once
                    they're mined.
                  </Text>
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <TouchableOpacity
                  style={[styles.primaryBtn, busy && styles.btnDisabled]}
                  onPress={onConfirm}
                  disabled={busy}>
                  {busy ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.primaryBtnText}>Broadcast sweep</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : null}

            {stage === 'done' ? (
              <>
                <Text style={styles.heading}>
                  {txid ? 'Sweep sent' : 'Sweep address'}
                </Text>
                {txid ? (
                  <>
                    <Text style={styles.sub}>
                      Broadcast. The coins land in your balance once the
                      transaction confirms and the block is scanned — you'll get a
                      notice when that happens.
                    </Text>
                    <Text style={styles.mono}>{txid}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.sub}>
                      This device will remember it now, so you won't be asked for
                      your phrase again just to see it.
                    </Text>
                    <Text style={styles.mono}>{address}</Text>
                  </>
                )}
                <TouchableOpacity style={styles.primaryBtn} onPress={onClose}>
                  <Text style={styles.primaryBtnText}>Done</Text>
                </TouchableOpacity>
              </>
            ) : null}

            {stage !== 'done' ? (
              <TouchableOpacity style={styles.linkBtn} onPress={onClose} disabled={busy}>
                <Text style={styles.linkBtnText}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
  },
  rowLabel: { fontSize: 13, color: colors.muted },
  rowValue: { fontSize: 15, fontWeight: '600', color: colors.text },
  mono: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: colors.text,
    marginTop: 14,
    lineHeight: 18,
  },
  hint: { fontSize: 12, color: colors.faint, marginTop: 12, lineHeight: 17 },
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
