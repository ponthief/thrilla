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
import { deriveSilentPayment, isValidMnemonic } from '@services/spKeys';
import { keysForIndices } from '@services/sweepChain';
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

type Stage = 'review' | 'done';

interface Props {
  visible: boolean;
  wallet: api.SilntWallet;
  accountXprv: string;
  // Chain indices holding confirmed coins, from the walk in services/sweepChain.
  fundedIndices: number[];
  onClose: () => void;
  onSwept: () => void;
}

/**
 * Confirms and broadcasts a sweep: everything on the wallet's BIP-84 chain moves
 * into its Silent Payment address in one transaction.
 *
 * No recovery phrase. The account key lives in the device keystore beside the
 * scan and spend keys, so the signing keys for the funded addresses are derived
 * here and sent transiently, exactly as buildTx sends the spend key. Only the
 * keys for addresses that actually hold coins leave the device.
 */
export default function SweepModal({
  visible,
  wallet,
  accountXprv,
  fundedIndices,
  onClose,
  onSwept,
}: Props) {
  const adminkey = useAuthStore((s) => s.adminkey);
  const inkey = useAuthStore((s) => s.inkey);

  const [stage, setStage] = useState<Stage>('review');
  const [feeRate, setFeeRate] = useState('1');
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [built, setBuilt] = useState<api.BuiltSweep | null>(null);
  const [txid, setTxid] = useState<string | null>(null);

  const build = useCallback(
    async (rate: number) => {
      if (!adminkey) {
        setError('Not logged in.');
        setBuilding(false);
        return;
      }
      setBuilding(true);
      setError(null);
      try {
        setBuilt(
          await api.buildSweepTx(
            adminkey,
            wallet.id,
            keysForIndices(accountXprv, wallet.network, fundedIndices),
            rate,
          ),
        );
      } catch (e: any) {
        setBuilt(null);
        setError(e?.message || 'Could not build the sweep.');
      } finally {
        setBuilding(false);
      }
    },
    [adminkey, wallet.id, wallet.network, accountXprv, fundedIndices],
  );

  useEffect(() => {
    if (!visible) return;
    setStage('review');
    setBuilt(null);
    setTxid(null);
    setError(null);
    let cancelled = false;
    // A sweep is never urgent — start from the half-hour rate rather than the
    // top of the mempool, then build so the user sees a real fee, not an
    // estimate.
    (async () => {
      let rate = 1;
      try {
        if (inkey) {
          const t = await api.getRecommendedFees(inkey);
          rate = t.halfHourFee ?? t.hourFee ?? t.fastestFee ?? 1;
        }
      } catch {
        /* keep 1 sat/vB; the field is editable */
      }
      if (cancelled) return;
      setFeeRate(String(rate));
      await build(rate);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, inkey, build]);

  const onRebuild = useCallback(() => {
    const rate = Number(feeRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      setError('Enter a fee rate above zero.');
      return;
    }
    build(rate);
  }, [feeRate, build]);

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
      onSwept();
    } catch (e: any) {
      setError(e?.message || 'Broadcast failed.');
    } finally {
      setBusy(false);
    }
  }, [built, adminkey, wallet.id, onSwept]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled">
            {stage === 'review' ? (
              <>
                <Text style={styles.heading}>Sweep into wallet</Text>
                <Text style={styles.sub}>
                  Everything on your sweep addresses moves into this wallet in one
                  transaction. Nothing is left behind.
                </Text>

                {building ? (
                  <ActivityIndicator color={PRIMARY} style={styles.spinner} />
                ) : null}

                {built ? (
                  <>
                    <Row
                      label="Moving in"
                      value={`${groupThousands(built.amount)} sats`}
                    />
                    <Row
                      label="Network fee"
                      value={`${groupThousands(built.fee)} sats`}
                    />
                    <Row
                      label="Coins"
                      value={`${built.input_count} (${groupThousands(
                        built.total_input,
                      )} sats)`}
                    />
                    {built.swept_addresses.length > 1 ? (
                      <Row
                        label="Addresses"
                        value={String(built.swept_addresses.length)}
                      />
                    ) : null}
                    {built.unconfirmed_sats > 0 ? (
                      <Text style={styles.hint}>
                        {groupThousands(built.unconfirmed_sats)} sats aren't
                        confirmed yet and are not included. Sweep again once
                        they're mined.
                      </Text>
                    ) : null}
                  </>
                ) : null}

                <Text style={styles.label}>Fee rate (sat/vB)</Text>
                <View style={styles.feeRow}>
                  <TextInput
                    style={[styles.input, styles.feeInput]}
                    value={feeRate}
                    onChangeText={setFeeRate}
                    keyboardType="numeric"
                    placeholderTextColor={colors.faint}
                  />
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={onRebuild}
                    disabled={building}>
                    <Text style={styles.secondaryBtnText}>Recalculate</Text>
                  </TouchableOpacity>
                </View>

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <TouchableOpacity
                  style={[styles.primaryBtn, (busy || !built) && styles.btnDisabled]}
                  onPress={onConfirm}
                  disabled={busy || !built}>
                  {busy ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.primaryBtnText}>Broadcast sweep</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.linkBtn}
                  onPress={onClose}
                  disabled={busy}>
                  <Text style={styles.linkBtnText}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.heading}>Sweep sent</Text>
                <Text style={styles.sub}>
                  Broadcast. The coins land in your balance once the transaction
                  confirms and the block is scanned — you'll get a notice when
                  that happens.
                </Text>
                <Text style={styles.mono}>{txid}</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={onClose}>
                  <Text style={styles.primaryBtnText}>Done</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * One-off prompt for wallets stored before the sweep chain existed: their
 * keystore entry has no account key, so it gets derived from the recovery phrase
 * once and saved. After this the sweep never asks again.
 *
 * The phrase is checked by re-deriving the wallet's Silent Payment address from
 * it — a wrong phrase or a forgotten passphrase is a different wallet entirely,
 * and would otherwise install an account key for addresses the user can't see.
 */
export function SweepSetupModal({
  visible,
  wallet,
  onClose,
  onReady,
}: {
  visible: boolean;
  wallet: api.SilntWallet;
  onClose: () => void;
  onReady: () => void;
}) {
  const [mnemonic, setMnemonic] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setMnemonic('');
    setPassphrase('');
    setError(null);
  }, [visible]);

  const onSubmit = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const words = mnemonic.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (words.length !== 12) {
        throw new Error('Recovery phrase must be exactly 12 words.');
      }
      const phrase = words.join(' ');
      if (!isValidMnemonic(phrase)) {
        throw new Error(
          'Invalid recovery phrase — the checksum (last word) is incorrect.',
        );
      }
      const derived = deriveSilentPayment(phrase, passphrase, wallet.network);
      if (
        derived.spAddress.toLowerCase() !== (wallet.sp_address || '').toLowerCase()
      ) {
        throw new Error(
          "That phrase doesn't match this wallet's address. Check the words and passphrase.",
        );
      }
      const existing = await getWalletKeys(wallet.id);
      await storeWalletKeys(wallet.id, {
        scanSecret: existing?.scanSecret || derived.scanSecret,
        spendKey: existing?.spendKey || derived.spendKey,
        refundAddress: derived.refundAddress,
        sweepAccount: derived.sweepAccount,
      });
      onReady();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not set up sweeping.');
    } finally {
      setBusy(false);
    }
  }, [mnemonic, passphrase, wallet, onReady, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.heading}>Set up sweeping</Text>
            <Text style={styles.sub}>
              This wallet predates sweep addresses, so its key for them needs
              deriving once. Enter your recovery phrase and this device will
              handle sweeping from then on — you won't be asked again.
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

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.primaryBtn, busy && styles.btnDisabled]}
              onPress={onSubmit}
              disabled={busy}>
              {busy ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryBtnText}>Set up</Text>
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
  feeRow: { flexDirection: 'row', alignItems: 'center' },
  feeInput: { flex: 1 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginLeft: 8,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600', color: colors.text },
  spinner: { marginTop: 18 },
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
