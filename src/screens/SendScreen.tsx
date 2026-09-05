import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';
import { useAuthStore } from '@stores/authStore';
import { useAppLockStore } from '@stores/appLockStore';
import * as api from '@services/api';
import { getWalletKeys } from '@services/secureKeys';
import { usePendingSends } from '@stores/pendingSends';
import { useTxLabelStore } from '@stores/txLabelStore';
import { markScanStarted } from '@services/scanCooldown';
import { colors } from '@/theme';
import QRScanner from '../components/QRScanner';
import ContactsModal from '../components/ContactsModal';
import ConfirmLockModal from '../components/ConfirmLockModal';

type RecipientKind = 'sp' | 'onchain' | 'bitmail' | '';

// Classify a recipient so we can label it and gate contact-saving (the backend
// only saves sp/bitmail contacts, though sends also accept bech32 on-chain).
function recipientKind(v: string): RecipientKind {
  const s = v.trim().toLowerCase();
  if (!s) return '';
  if (s.includes('@')) return 'bitmail';
  if (s.startsWith('sp1') || s.startsWith('tsp1')) return 'sp';
  if (s.startsWith('bc1') || s.startsWith('tb1') || s.startsWith('bcrt1')) return 'onchain';
  return '';
}

const KIND_LABEL: Record<RecipientKind, string> = {
  sp: 'Silent Payment address',
  onchain: 'On-chain address',
  bitmail: 'BitMail',
  '': '',
};

// Extract an SP address from a scanned value: a bare address, a bitcoin: URI, or
// a URI carrying an `sp=` parameter.
function parseScannedAddress(raw: string): string {
  const s = raw.trim();
  const m = s.match(/[?&]sp=([^&]+)/i);
  if (m) return decodeURIComponent(m[1]);
  return s.replace(/^bitcoin:/i, '').trim();
}

const PRIMARY = colors.primary;

type Step = 'form' | 'review' | 'done';

const FEE_TIERS: { key: keyof api.FeeTiers; label: string; hint: string }[] = [
  { key: 'fastestFee', label: 'Fastest', hint: '~10 min' },
  { key: 'halfHourFee', label: 'Fast', hint: '~30 min' },
  { key: 'hourFee', label: 'Normal', hint: '~1 hr' },
  { key: 'economyFee', label: 'Economy', hint: 'slower' },
];

function groupThousands(n: number): string {
  return Math.floor(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Blocks a wallet may lag the tip before the Send screen says so (~1 hour).
const STALE_BLOCKS = 6;

function utxoKey(u: api.Utxo): string {
  return `${u.txid}:${u.vout}`;
}

// Mirror the backend builder's vsize formula for a live fee estimate:
//   vsize = 10 + 57.5*inputs + 31*2 (recipient + change)
function estimateFee(numInputs: number, feeRate: number): number {
  if (!numInputs || !feeRate) return 0;
  const vsize = 10 + 57.5 * numInputs + 31 * 2;
  return Math.max(1, Math.ceil(vsize * feeRate));
}

export default function SendScreen() {
  const inkey = useAuthStore((s) => s.inkey);
  const adminkey = useAuthStore((s) => s.adminkey);
  // When an app lock (PIN or biometric) is on, re-authenticate before sending.
  const lockEnabled = useAppLockStore((s) => s.enabled);
  const [authOpen, setAuthOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [noKeys, setNoKeys] = useState(false);

  const [wallet, setWallet] = useState<api.SilntWallet | null>(null);
  const [utxos, setUtxos] = useState<api.Utxo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');

  const [tiers, setTiers] = useState<api.FeeTiers | null>(null);
  const [feeChoice, setFeeChoice] = useState<keyof api.FeeTiers | 'custom'>(
    'halfHourFee',
  );
  const [feeRate, setFeeRate] = useState<number>(1);

  const [step, setStep] = useState<Step>('form');
  const [built, setBuilt] = useState<api.BuiltTx | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txid, setTxid] = useState('');
  const [scanning, setScanning] = useState(false);

  // A catch-up scan (often thousands of blocks) can be running server-side after
  // login. While it is, this wallet's coin set is still incomplete, so sending
  // is paused until it finishes — then the user spends from a complete,
  // up-to-date balance (and can't trip the backend's "state just changed"
  // rejection). Progress is polled to clear the block the moment it's done.
  const [scanActive, setScanActive] = useState(false);
  const [scanCur, setScanCur] = useState(0);
  const [scanTot, setScanTot] = useState(0);

  // A wallet can also be behind the tip with NO scan running (the catch-up
  // prompt was dismissed, background scanning is off, a scan hit its cooldown).
  // Nothing is mid-flight then, so sending isn't paused — but the coin list may
  // be missing recent payments, which is worth saying out loud.
  const [tipHeight, setTipHeight] = useState(0);
  const [catchUpBusy, setCatchUpBusy] = useState(false);
  const [catchUpMsg, setCatchUpMsg] = useState<string | null>(null);

  const [contacts, setContacts] = useState<api.SpContact[]>([]);
  const [showContacts, setShowContacts] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [showSaveContact, setShowSaveContact] = useState(false);
  const [contactLabel, setContactLabel] = useState('');
  const [contactMsg, setContactMsg] = useState<string | null>(null);

  const loadContacts = useCallback(async () => {
    if (!inkey) return;
    try {
      setContacts(await api.listContacts(inkey));
    } catch {
      setContacts([]);
    }
  }, [inkey]);

  const load = useCallback(async (silent = false) => {
    if (!inkey) {
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setLoadError(null);
    setMissing(false);
    setNoKeys(false);
    try {
      const wallets = await api.getSilntWallets(inkey);
      const w = api.pickSilntWallet(wallets);
      if (!w) {
        setWallet(null);
        setMissing(true);
        return;
      }
      setWallet(w);
      setNoKeys(!(await getWalletKeys(w.id)));

      const [utxoRes, feeRes, tipRes] = await Promise.allSettled([
        api.getUtxos(inkey, w.id),
        api.getRecommendedFees(inkey),
        api.getChainTip(inkey),
      ]);

      if (utxoRes.status === 'fulfilled') {
        setUtxos(
          utxoRes.value.filter((u) => u.utxo_state === 'unspent' && !u.frozen),
        );
      } else {
        setUtxos([]);
      }

      if (feeRes.status === 'fulfilled') {
        setTiers(feeRes.value);
        const def = feeRes.value.halfHourFee ?? feeRes.value.fastestFee;
        if (def) setFeeRate(def);
      }

      // Unavailable oracle → 0, which reads as "can't tell" and shows no
      // warning rather than a bogus one.
      setTipHeight(
        tipRes.status === 'fulfilled' ? Number(tipRes.value?.height) || 0 : 0,
      );
    } catch (e: any) {
      setLoadError(e?.message || 'Failed to load wallet.');
    } finally {
      setLoading(false);
    }
  }, [inkey]);

  useEffect(() => {
    load();
    loadContacts();
  }, [load, loadContacts]);

  // Keep `load` reachable from the scan-watcher without making it a dependency
  // (avoids re-arming the poll every reload).
  const loadRef = useRef(load);
  loadRef.current = load;
  const wasScanningRef = useRef(false);

  // Poll for an in-flight catch-up scan while this screen is open. `scanActive`
  // gates the Review button; on the active → done transition we quietly refresh
  // so the just-scanned coins are present before the user sends.
  useEffect(() => {
    if (!inkey || !wallet?.id) return undefined;
    let cancelled = false;
    const walletId = wallet.id;
    const tick = async () => {
      try {
        const p = await api.getScanProgress(inkey, walletId);
        if (cancelled) return;
        const active = !!p.active;
        setScanActive(active);
        setScanCur(Number(p.current) || 0);
        setScanTot(Number(p.total) || 0);
        if (!active && wasScanningRef.current) loadRef.current(true);
        wasScanningRef.current = active;
      } catch {
        /* transient — keep polling */
      }
    };
    tick();
    const timer = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [inkey, wallet?.id]);

  const rKind = recipientKind(recipient);
  const saveable = rKind === 'sp' || rKind === 'bitmail';
  const alreadySaved = contacts.some(
    (c) => c.value.trim().toLowerCase() === recipient.trim().toLowerCase(),
  );

  const onSaveContact = useCallback(async () => {
    if (!inkey) return;
    const value = recipient.trim();
    setSavingContact(true);
    setContactMsg(null);
    try {
      await api.createContact(inkey, contactLabel.trim() || value, value);
      setContactLabel('');
      setShowSaveContact(false);
      setContactMsg('Contact saved.');
      await loadContacts();
    } catch (e: any) {
      setContactMsg(e?.message || 'Could not save contact.');
    } finally {
      setSavingContact(false);
    }
  }, [inkey, recipient, contactLabel, loadContacts]);

  const onDeleteContact = useCallback(
    async (id: string) => {
      if (!inkey) return;
      try {
        await api.deleteContact(inkey, id);
        await loadContacts();
      } catch {
        /* ignore */
      }
    },
    [inkey, loadContacts],
  );

  const toggleUtxo = useCallback((u: api.Utxo) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = utxoKey(u);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  const selectedUtxos = useMemo(
    () => utxos.filter((u) => selected.has(utxoKey(u))),
    [utxos, selected],
  );
  const selectedTotal = useMemo(
    () => selectedUtxos.reduce((s, u) => s + u.amount, 0),
    [selectedUtxos],
  );
  const amountSats = Number(amount) || 0;
  const estFee = estimateFee(selectedUtxos.length, feeRate);
  const insufficient =
    amountSats > 0 && selectedTotal > 0 && amountSats + estFee > selectedTotal;

  // How far this wallet has been scanned vs. the chain tip. last_scan_height is
  // progress, last_height the birth height (static) — a wallet born at the tip
  // has no progress yet but is up to date, so take the max (same rule as the
  // catch-up scan).
  const walletHeight = Math.max(
    Number(wallet?.last_scan_height ?? 0),
    Number(wallet?.last_height ?? 0),
  );
  const blocksBehind =
    tipHeight && walletHeight ? Math.max(0, tipHeight - walletHeight) : 0;
  // Blocks arrive every ~10 minutes, so a handful behind is normal and warning
  // about it would be noise. ~1 hour without scanning is worth flagging.
  const behind = !scanActive && blocksBehind > STALE_BLOCKS;

  const canBuild =
    !!recipient.trim() &&
    amountSats > 0 &&
    selectedUtxos.length > 0 &&
    feeRate > 0 &&
    !insufficient &&
    !noKeys &&
    !scanActive;

  const pickTier = useCallback(
    (key: keyof api.FeeTiers | 'custom') => {
      setFeeChoice(key);
      if (key !== 'custom' && tiers && tiers[key]) {
        setFeeRate(tiers[key] as number);
      }
    },
    [tiers],
  );

  const doBuild = useCallback(async () => {
    Keyboard.dismiss();
    setError(null);
    if (!wallet || !adminkey || !inkey) return;
    setBusy(true);
    try {
      const keys = await getWalletKeys(wallet.id);
      if (!keys) {
        setError('Wallet keys are not on this device. Re-import the wallet to send.');
        setBusy(false);
        return;
      }
      const result = await api.buildTx(
        adminkey,
        {
          wallet_id: wallet.id,
          recipient: recipient.trim(),
          amount: amountSats,
          fee_rate: feeRate,
          utxos: selectedUtxos.map((u) => ({
            txid: u.txid,
            vout: u.vout,
            amount: u.amount,
            priv_key_tweak: u.priv_key_tweak,
            pub_key: u.pub_key,
          })),
        },
        keys.spendKey,
        keys.scanSecret,
      );
      setBuilt(result);
      setStep('review');
    } catch (e: any) {
      setError(e?.message || 'Could not build the transaction.');
    } finally {
      setBusy(false);
    }
  }, [wallet, adminkey, inkey, recipient, amountSats, feeRate, selectedUtxos]);

  const doBroadcast = useCallback(async () => {
    if (!built || !wallet || !adminkey) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.broadcastTx(
        adminkey,
        built.tx_hex,
        wallet.id,
        selectedUtxos.map((u) => ({ txid: u.txid, vout: u.vout })),
        { recipient: recipient.trim(), amount: amountSats, fee: built.fee },
      );
      setTxid(res.txid);
      // Start the confirmation watch immediately, before any list refresh.
      usePendingSends.getState().add({
        txid: res.txid,
        walletId: wallet.id,
        amountSats: amountSats || null,
      });
      // Remember a BitMail recipient locally, matching the web app: it is the
      // one part of a send not derivable from the chain, and it names the
      // transaction before any change output exists to label. Raw sp1…/bc1…
      // are already on-chain, so there is nothing to remember.
      const typed = recipient.trim();
      if (typed.includes('@')) {
        useTxLabelStore.getState().setLabel(res.txid, typed).catch(() => {});
      }
      setStep('done');
    } catch (e: any) {
      setError(e?.message || 'Broadcast failed.');
    } finally {
      setBusy(false);
    }
  }, [built, wallet, adminkey, selectedUtxos, recipient, amountSats]);

  // Start a catch-up scan from here, so a wallet that's behind can be brought
  // up to date without leaving the Send screen. The existing poller takes over:
  // it flips to the "Sending is paused" banner and reloads the coins when the
  // scan finishes.
  const onCatchUp = useCallback(async () => {
    if (!inkey || !wallet) return;
    setCatchUpBusy(true);
    setCatchUpMsg(null);
    try {
      const keys = await getWalletKeys(wallet.id);
      if (!keys) {
        setCatchUpMsg(
          "This wallet's keys aren't on this device, so it can only be scanned " +
            'where they are.',
        );
        return;
      }
      await api.startScan(inkey, wallet.id, keys.scanSecret, walletHeight, null);
      markScanStarted(wallet.id);
      // Show the paused banner immediately rather than after the next poll, and
      // make sure the poller's active → done transition reloads the coin list.
      wasScanningRef.current = true;
      setScanActive(true);
    } catch (e: any) {
      const msg = e?.message || 'Could not start a scan.';
      // Already running / per-wallet cooldown: benign here, the poller picks it
      // up either way.
      setCatchUpMsg(
        /recently|already|budget|too many/i.test(msg)
          ? 'A scan was requested recently — this wallet will catch up shortly.'
          : msg,
      );
    } finally {
      setCatchUpBusy(false);
    }
  }, [inkey, wallet, walletHeight]);

  // Require re-authentication (PIN/biometric) first when an app lock is
  // enabled. Building the transaction exposes the spend key (sent to the server
  // to sign), so gate here rather than at the final broadcast. With no lock,
  // proceed straight to the review step.
  const proceedToReview = useCallback(() => {
    if (lockEnabled) {
      Keyboard.dismiss();
      setAuthOpen(true);
      return;
    }
    doBuild();
  }, [lockEnabled, doBuild]);

  const onReview = useCallback(() => {
    if (busy) return;
    // Merging coins is the one choice on this screen that can't be undone after
    // broadcast — the link between them is published on-chain for good. The
    // inline note sits below a long coin list where it's easy to scroll past,
    // so confirm it here, where it can't be missed.
    if (selectedUtxos.length > 1) {
      Keyboard.dismiss();
      Alert.alert(
        `Combine ${selectedUtxos.length} coins?`,
        `Spending ${selectedUtxos.length} coins in one transaction publicly ` +
          'links them to the same owner — you — and that link is permanent. ' +
          'Spend a single coin when one covers the amount.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Combine anyway', onPress: proceedToReview },
        ],
      );
      return;
    }
    proceedToReview();
  }, [busy, selectedUtxos.length, proceedToReview]);

  const onAuthenticated = useCallback(() => {
    setAuthOpen(false);
    doBuild();
  }, [doBuild]);

  const reset = useCallback(() => {
    setStep('form');
    setBuilt(null);
    setError(null);
    setTxid('');
    setRecipient('');
    setAmount('');
    setSelected(new Set());
    load();
  }, [load]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={PRIMARY} />
        </View>
      </SafeAreaView>
    );
  }

  if (missing) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.info}>
            No Silent Payments wallet on this network. Create one on the Wallet
            tab first.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.error}>{loadError}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => load()}>
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'done') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.doneIcon}>✓</Text>
          <Text style={styles.doneTitle}>Transaction broadcast</Text>
          <Text style={styles.doneSub}>
            {groupThousands(amountSats)} sats sent
          </Text>
          <Text style={styles.txidLabel}>Transaction ID</Text>
          <Text style={styles.txid} numberOfLines={1}>
            {txid}
          </Text>
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={() => Clipboard.setString(txid)}>
            <Text style={styles.ghostBtnText}>Copy TXID</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryBtn} onPress={reset}>
            <Text style={styles.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'review' && built) {
    const total = amountSats + (built.fee || 0);
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.header}>Review</Text>
          <View style={styles.card}>
            <ReviewRow label="To" value={recipient.trim()} mono />
            <ReviewRow label="Amount" value={`${groupThousands(amountSats)} sats`} />
            <ReviewRow
              label="Network fee"
              value={`${groupThousands(built.fee || 0)} sats`}
            />
            {/* The coin count drives both the fee and the on-chain link between
                them, so it belongs on the last screen before broadcast. */}
            <ReviewRow
              label="Coins"
              value={
                selectedUtxos.length > 1
                  ? `${selectedUtxos.length} — linked on-chain`
                  : '1'
              }
            />
            <View style={styles.divider} />
            <ReviewRow label="Total" value={`${groupThousands(total)} sats`} bold />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.primaryBtn, busy && styles.btnDisabled]}
            onPress={doBroadcast}
            disabled={busy}>
            {busy ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.primaryBtnText}>Confirm &amp; Send</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => {
              setStep('form');
              setError(null);
            }}
            disabled={busy}>
            <Text style={styles.linkBtnText}>Back</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // step === 'form'
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <Text style={styles.header}>Send</Text>

          {noKeys ? (
            <Text style={styles.warn}>
              This wallet's keys aren't on this device, so it can't sign a
              transaction. Re-import the wallet (Wallet tab) to send.
            </Text>
          ) : null}

          {scanActive ? (
            <View style={styles.scanBanner}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={styles.scanBannerText}>
                Catching up
                {scanTot
                  ? ` — block ${groupThousands(scanCur)} of ${groupThousands(scanTot)}`
                  : ''}
                . Sending is paused until your wallet finishes scanning, so you
                spend from a complete, up-to-date balance.
              </Text>
            </View>
          ) : null}

          {behind ? (
            <View style={styles.behindBanner}>
              <Text style={styles.behindText}>
                ⚠ This wallet is scanned up to block{' '}
                {groupThousands(walletHeight)} — {groupThousands(blocksBehind)}{' '}
                blocks behind the chain tip. Payments that arrived since then
                aren't listed below yet, so you may be spending from an
                incomplete balance. The coins shown are still yours to spend.
              </Text>
              <TouchableOpacity
                style={[styles.behindBtn, catchUpBusy && styles.btnDisabled]}
                onPress={onCatchUp}
                disabled={catchUpBusy}>
                {catchUpBusy ? (
                  <ActivityIndicator color={PRIMARY} />
                ) : (
                  <Text style={styles.behindBtnText}>Catch up now</Text>
                )}
              </TouchableOpacity>
              {catchUpMsg ? (
                <Text style={styles.behindMsg}>{catchUpMsg}</Text>
              ) : null}
            </View>
          ) : null}

          <Text style={styles.label}>Recipient</Text>
          <Text style={styles.recipientHelp}>
            Silent Payment (sp1…), on-chain (bc1…), or BitMail (name@domain).
          </Text>
          <TextInput
            style={[styles.input, styles.recipientInput]}
            value={recipient}
            onChangeText={(t) => {
              setRecipient(t);
              setContactMsg(null);
            }}
            placeholder="sp1… / bc1… / name@domain"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />

          {rKind ? (
            <Text style={styles.kindHint}>Detected: {KIND_LABEL[rKind]}</Text>
          ) : null}

          {/* Every one of these fills in the address above, so they sit in a
              single wrapping row beneath it. Beside the input they had to be a
              column, which set the row's height and left dead space under the
              address. */}
          <View style={styles.recipientActions}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => setScanning(true)}>
              <Text style={styles.actionBtnText}>Scan</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={async () =>
                setRecipient(parseScannedAddress(await Clipboard.getString()))
              }>
              <Text style={styles.actionBtnText}>Paste</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => setShowContacts(true)}>
              <Text style={styles.actionBtnText}>
                Contacts{contacts.length ? ` (${contacts.length})` : ''}
              </Text>
            </TouchableOpacity>
            {saveable && !alreadySaved ? (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => setShowSaveContact((v) => !v)}>
                <Text style={styles.actionBtnText}>★ Save contact</Text>
              </TouchableOpacity>
            ) : null}
            {alreadySaved ? (
              <Text style={styles.savedHint}>✓ In contacts</Text>
            ) : null}
          </View>

          {showSaveContact && saveable ? (
            <View style={styles.saveContactRow}>
              <TextInput
                style={[styles.input, styles.contactLabelInput]}
                value={contactLabel}
                onChangeText={setContactLabel}
                placeholder="Label (e.g. Alice)"
                placeholderTextColor={colors.faint}
                maxLength={40}
              />
              <TouchableOpacity
                style={[styles.inlineSaveBtn, savingContact && styles.btnDisabled]}
                onPress={onSaveContact}
                disabled={savingContact}>
                {savingContact ? (
                  <ActivityIndicator color={PRIMARY} />
                ) : (
                  <Text style={styles.inlineSaveText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : null}
          {contactMsg ? <Text style={styles.contactMsg}>{contactMsg}</Text> : null}

          <Text style={styles.label}>Amount</Text>
          <View style={styles.unitRow}>
            <TextInput
              style={[styles.input, styles.amountInput]}
              value={amount}
              onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.faint}
            />
            <Text style={styles.unitLabel}>sats</Text>
          </View>

          <Text style={styles.label}>Fee rate</Text>
          <View style={styles.feeRow}>
            {FEE_TIERS.map((t) => {
              const val = tiers?.[t.key];
              const active = feeChoice === t.key;
              return (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.feeChip, active && styles.feeChipOn]}
                  onPress={() => pickTier(t.key)}
                  disabled={!val}>
                  <Text style={[styles.feeChipLabel, active && styles.feeChipLabelOn]}>
                    {t.label}
                  </Text>
                  <Text style={[styles.feeChipHint, active && styles.feeChipLabelOn]}>
                    {val ? `${val} s/vB` : '—'}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[styles.feeChip, feeChoice === 'custom' && styles.feeChipOn]}
              onPress={() => pickTier('custom')}>
              <Text
                style={[
                  styles.feeChipLabel,
                  feeChoice === 'custom' && styles.feeChipLabelOn,
                ]}>
                Custom
              </Text>
            </TouchableOpacity>
          </View>
          {feeChoice === 'custom' ? (
            <View style={[styles.unitRow, styles.feeRateRow]}>
              <TextInput
                style={[styles.input, styles.feeRateInput]}
                value={String(feeRate || '')}
                onChangeText={(t) => setFeeRate(Number(t.replace(/[^0-9]/g, '')) || 0)}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={colors.faint}
              />
              <Text style={styles.unitLabel}>sat/vB</Text>
            </View>
          ) : null}

          <Text style={styles.label}>
            Coins ({selectedUtxos.length}/{utxos.length} selected)
          </Text>
          {utxos.length === 0 ? (
            <Text style={styles.info}>No spendable coins in this wallet yet.</Text>
          ) : (
            utxos.map((u) => {
              const on = selected.has(utxoKey(u));
              return (
                <TouchableOpacity
                  key={utxoKey(u)}
                  style={styles.utxoRow}
                  onPress={() => toggleUtxo(u)}>
                  <View style={[styles.checkbox, on && styles.checkboxOn]}>
                    {on ? <Text style={styles.checkMark}>✓</Text> : null}
                  </View>
                  <View style={styles.utxoInfo}>
                    <Text style={styles.utxoAmount}>
                      {groupThousands(u.amount)} sats
                    </Text>
                    <Text style={styles.utxoMeta} numberOfLines={1}>
                      {u.label ? `${u.label} · ` : ''}
                      {u.txid.slice(0, 10)}…:{u.vout}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}

          {selectedUtxos.length > 0 ? (
            <View style={styles.summary}>
              <SummaryRow
                label="Selected"
                value={`${groupThousands(selectedTotal)} sats`}
              />
              <SummaryRow
                label="Est. fee"
                value={`~${groupThousands(estFee)} sats`}
              />
            </View>
          ) : null}

          {selectedUtxos.length > 1 ? (
            <View style={styles.privacyWarn}>
              <Text style={styles.privacyText}>
                ⚠ Combining {selectedUtxos.length} coins in one transaction links
                them together on-chain, which reduces your privacy. Spend a single
                coin when you can.
              </Text>
            </View>
          ) : null}

          {insufficient ? (
            <Text style={styles.error}>
              Selected coins don't cover the amount plus fee.
            </Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.primaryBtn, (!canBuild || busy) && styles.btnDisabled]}
            onPress={onReview}
            disabled={!canBuild || busy}>
            {busy ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.primaryBtnText}>
                {scanActive ? 'Scanning… please wait' : 'Review'}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmLockModal
        visible={authOpen}
        onAuthenticated={onAuthenticated}
        onCancel={() => setAuthOpen(false)}
        title="Confirm it’s you"
        subtitle={`Authenticate to review this ${groupThousands(amountSats)} sats transaction.`}
      />

      <QRScanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onScanned={(v) => setRecipient(parseScannedAddress(v))}
      />

      <ContactsModal
        visible={showContacts}
        contacts={contacts}
        onClose={() => setShowContacts(false)}
        onPick={(v) => setRecipient(v)}
        onDelete={onDeleteContact}
      />
    </SafeAreaView>
  );
}

function ReviewRow({
  label,
  value,
  mono,
  bold,
}: {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
}) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text
        style={[
          styles.reviewValue,
          mono && styles.reviewMono,
          bold && styles.reviewBold,
        ]}
        numberOfLines={mono ? 2 : 1}>
        {value}
      </Text>
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  content: { padding: 16 },
  header: { fontSize: 24, fontWeight: 'bold', color: colors.text, marginBottom: 12 },

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
  recipientHelp: { fontSize: 12, color: colors.faint, marginBottom: 8, marginTop: -2 },
  recipientInput: { minHeight: 46 },
  kindHint: { fontSize: 12, color: PRIMARY, fontWeight: '600', marginTop: 6 },
  // Scan / Paste / Contacts / Save contact, wrapping onto a second line on
  // narrow screens instead of squeezing.
  recipientActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  actionBtnText: { color: PRIMARY, fontSize: 13, fontWeight: '600' },
  savedHint: { color: colors.green, fontSize: 13, fontWeight: '600' },
  saveContactRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  contactLabelInput: { flex: 1 },
  contactMsg: { fontSize: 13, color: colors.muted, marginTop: 8 },
  // The "Save" button beside the contact-label input: taller than actionBtn so
  // it lines up with the input's height.
  inlineSaveBtn: {
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inlineSaveText: { color: PRIMARY, fontWeight: '600', fontSize: 13 },

  // Short numeric fields (amount, custom fee rate) are sized to their content
  // rather than the screen width, with the unit beside the box so the narrower
  // field reads as deliberate. Widths are the digits each holds at fontSize 16
  // plus the input's own padding, and both fit a 320dp screen with the unit.
  unitRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  unitLabel: { fontSize: 14, fontWeight: '600', color: colors.muted },
  amountInput: { width: 150 }, // sats: up to ~9 digits
  feeRateInput: { width: 100 }, // sat/vB: 1–4 digits
  feeRateRow: { marginTop: 10 },

  feeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  feeChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    minWidth: 68,
  },
  feeChipOn: { borderColor: PRIMARY, backgroundColor: 'rgba(249,115,22,0.10)' },
  feeChipLabel: { fontSize: 13, fontWeight: '600', color: colors.strong },
  feeChipLabelOn: { color: PRIMARY },
  feeChipHint: { fontSize: 10, color: colors.faint, marginTop: 2 },

  utxoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxOn: { backgroundColor: PRIMARY },
  checkMark: { color: colors.onPrimary, fontSize: 14, fontWeight: 'bold' },
  utxoInfo: { flex: 1 },
  utxoAmount: { fontSize: 15, fontWeight: '600', color: colors.text },
  utxoMeta: { fontSize: 12, color: colors.faint, marginTop: 2 },

  summary: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  summaryLabel: { fontSize: 13, color: colors.muted },
  summaryValue: { fontSize: 13, fontWeight: '600', color: colors.text },

  primaryBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 22,
    alignSelf: 'stretch',
  },
  primaryBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  linkBtn: { marginTop: 14, paddingVertical: 6, alignItems: 'center' },
  linkBtnText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  ghostBtn: {
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 20,
  },
  ghostBtnText: { color: PRIMARY, fontSize: 14, fontWeight: '600' },

  card: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 20,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  reviewLabel: { fontSize: 14, color: colors.muted, marginRight: 12 },
  reviewValue: { fontSize: 14, color: colors.text, flex: 1, textAlign: 'right' },
  reviewMono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
  },
  reviewBold: { fontWeight: '700', fontSize: 16 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 6,
  },

  info: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  warn: {
    fontSize: 13,
    color: colors.danger,
    backgroundColor: 'rgba(255,107,94,0.08)',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    lineHeight: 18,
  },
  scanBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(249,115,22,0.10)',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  scanBannerText: { flex: 1, fontSize: 13, color: colors.primary, lineHeight: 18 },
  // Behind the tip but nothing scanning: a warning with a way to act on it,
  // not a block — the coins already listed are spendable either way.
  behindBanner: {
    backgroundColor: 'rgba(249,115,22,0.10)',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  behindText: { fontSize: 13, color: colors.primary, lineHeight: 18 },
  behindBtn: {
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  behindBtnText: { color: PRIMARY, fontSize: 13, fontWeight: '600' },
  behindMsg: { fontSize: 12, color: colors.muted, marginTop: 8, lineHeight: 17 },
  error: { color: colors.danger, fontSize: 13, marginTop: 14, textAlign: 'center' },
  privacyWarn: {
    backgroundColor: 'rgba(249,115,22,0.10)',
    borderRadius: 8,
    padding: 12,
    marginTop: 14,
  },
  privacyText: { fontSize: 13, color: colors.primary, lineHeight: 18 },

  doneIcon: {
    fontSize: 48,
    color: colors.green,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  doneTitle: { fontSize: 20, fontWeight: 'bold', color: colors.green },
  doneSub: { fontSize: 15, color: colors.muted, marginTop: 4, marginBottom: 20 },
  txidLabel: { fontSize: 12, color: colors.faint, marginTop: 8 },
  txid: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: colors.strong,
    marginTop: 4,
    paddingHorizontal: 24,
  },
});
