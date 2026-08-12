import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Switch,
  Text,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@stores/authStore';
import { useAppLockStore } from '@stores/appLockStore';
import * as api from '@services/api';
import * as appLock from '@services/appLock';
import * as appPin from '@services/appPin';
import { getWalletKeys, hasWalletKeys, removeWalletKeys } from '@services/secureKeys';
import { resetCatchUp } from '../hooks/useCatchUpScan';
import { colors, DEVICE_TRUST_ENABLED } from '@/theme';
import DevicesModal from '../components/DevicesModal';
import PinSetupModal from '../components/PinSetupModal';

export default function SettingsScreen() {
  const username = useAuthStore((state) => state.username);
  const email = useAuthStore((state) => state.email);
  const inkey = useAuthStore((state) => state.inkey);
  const logout = useAuthStore((state) => state.logout);
  const [devicesOpen, setDevicesOpen] = useState(false);

  // App lock (biometric / device PIN).
  const lockEnabled = useAppLockStore((s) => s.bioEnabled);
  const setLockEnabled = useAppLockStore((s) => s.setBioEnabled);
  const [biometry, setBiometry] = useState<string | null>(null);
  const [lockBusy, setLockBusy] = useState(false);
  const [lockMsg, setLockMsg] = useState<string | null>(null);

  // In-app PIN + duress PIN.
  const pinSet = useAppLockStore((s) => s.pinSet);
  const setPinSet = useAppLockStore((s) => s.setPinSet);
  const [hasDuress, setHasDuress] = useState(false);
  const [pinModal, setPinModal] = useState<null | 'normal' | 'duress'>(null);

  useEffect(() => {
    appPin.hasDuressPin().then(setHasDuress);
  }, [pinSet]);

  const onTogglePin = useCallback(
    (v: boolean) => {
      if (v) {
        setPinModal('normal');
        return;
      }
      Alert.alert(
        'Turn off App PIN?',
        'This removes your PIN and any duress PIN, and returns to biometric unlock.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Turn off',
            style: 'destructive',
            onPress: async () => {
              await appPin.clearPins();
              setPinSet(false);
              setHasDuress(false);
            },
          },
        ],
      );
    },
    [setPinSet],
  );

  const onPinDone = useCallback(() => {
    setPinModal(null);
    appPin.hasPin().then(setPinSet);
    appPin.hasDuressPin().then(setHasDuress);
  }, [setPinSet]);

  const onToggleDuress = useCallback((v: boolean) => {
    if (v) {
      setPinModal('duress');
      return;
    }
    appPin.setDuressPin(null).then(() => setHasDuress(false));
  }, []);

  // Current wallet (for background scanning + removal).
  const [wallet, setWallet] = useState<api.SilntWallet | null>(null);
  const bgWalletId = wallet?.id ?? null;
  const [bgEnabled, setBgEnabled] = useState(false);
  const [bgBusy, setBgBusy] = useState(false);
  const [bgMsg, setBgMsg] = useState<string | null>(null);

  // Remove wallet.
  const [removing, setRemoving] = useState(false);
  const [removeMsg, setRemoveMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!inkey) return;
      try {
        const w = api.pickSilntWallet(await api.getSilntWallets(inkey));
        if (!w) return;
        setWallet(w);
        setBgEnabled(await api.getBackgroundScan(inkey, w.id));
      } catch {
        /* leave the toggle off/disabled if we can't load status */
      }
    })();
  }, [inkey]);

  const doRemoveWallet = useCallback(async () => {
    if (!inkey || !wallet) return;
    setRemoving(true);
    setRemoveMsg(null);
    try {
      // Best-effort: pull this wallet's scan key off the server first so nothing
      // lingers there if the delete itself is retried. Deleting the wallet
      // removes its record, coins, labeled addresses, and BitMail DNS too.
      try {
        await api.disableBackgroundScan(inkey, wallet.id);
      } catch {
        /* not enabled / already gone — ignore */
      }
      await api.deleteSilntWallet(inkey, wallet.id);
      // Wipe the local keys and forget the catch-up evaluation for this id.
      await removeWalletKeys(wallet.id);
      resetCatchUp(wallet.id);
      setWallet(null);
      setBgEnabled(false);
      setRemoveMsg('Wallet removed. Create or import one on the Wallet tab.');
    } catch (e: any) {
      setRemoveMsg(e?.message || 'Could not remove the wallet. Please try again.');
    } finally {
      setRemoving(false);
    }
  }, [inkey, wallet]);

  const onRemoveWallet = useCallback(async () => {
    if (!inkey || !wallet) return;
    // Only allow removal from a device that holds the wallet's keys — proof the
    // user can recover it from their seed afterwards (mirrors the web gate).
    if (!(await hasWalletKeys(wallet.id))) {
      Alert.alert(
        'Keys not on this device',
        "This wallet's keys aren't stored on this phone, so it can't be removed " +
          'here. Recover the wallet from its recovery phrase first (Scan tab), ' +
          'then remove it.',
      );
      return;
    }
    Alert.alert(
      'Remove this wallet?',
      `This permanently deletes "${wallet.title || 'this wallet'}" and all its ` +
        'coins from the server, and erases its keys from this device. This ' +
        "can't be undone — you can only restore it from your recovery phrase " +
        '(and passphrase, if you set one).',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove wallet', style: 'destructive', onPress: doRemoveWallet },
      ],
    );
  }, [inkey, wallet, doRemoveWallet]);

  const applyBackgroundScan = useCallback(
    async (enable: boolean) => {
      if (!inkey || !bgWalletId) return;
      setBgBusy(true);
      setBgMsg(null);
      try {
        if (enable) {
          const keys = await getWalletKeys(bgWalletId);
          if (!keys?.scanSecret) {
            setBgMsg('Wallet keys are not on this device. Recover them first.');
            return;
          }
          await api.enableBackgroundScan(inkey, bgWalletId, keys.scanSecret);
          setBgEnabled(true);
        } else {
          await api.disableBackgroundScan(inkey, bgWalletId);
          setBgEnabled(false);
        }
      } catch (e: any) {
        setBgMsg(e?.message || 'Could not update background scanning.');
      } finally {
        setBgBusy(false);
      }
    },
    [inkey, bgWalletId],
  );

  const onToggleBackgroundScan = useCallback(
    (value: boolean) => {
      if (!value) {
        applyBackgroundScan(false);
        return;
      }
      // Enabling uploads the scan key — get explicit, informed consent.
      Alert.alert(
        'Turn on background scanning?',
        "This uploads this wallet's scan key to the server so it can find your " +
          'incoming payments while the app is closed. The server will then be ' +
          'able to see your payment history — but it can never spend your funds ' +
          '(your spend key never leaves this device). You can turn it off anytime.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Turn on', onPress: () => applyBackgroundScan(true) },
        ],
      );
    },
    [applyBackgroundScan],
  );

  useEffect(() => {
    appLock.biometryType().then(setBiometry);
  }, []);

  const onToggleLock = useCallback(
    async (val: boolean) => {
      setLockBusy(true);
      setLockMsg(null);
      try {
        if (val) {
          const ok = await appLock.enable();
          setLockEnabled(ok);
          if (!ok) {
            setLockMsg(
              'Could not turn on App Lock. Set up a fingerprint, face, or screen PIN on your device first.',
            );
          }
        } else {
          await appLock.disable();
          setLockEnabled(false);
        }
      } finally {
        setLockBusy(false);
      }
    },
    [setLockEnabled],
  );

  const lockSubtitle = biometry
    ? `Require ${biometry} or your device PIN when reopening the app.`
    : 'Require your device PIN or biometrics when reopening the app.';

  const [prefs, setPrefs] = useState<api.UserPrefs | null>(null);
  const [dustDraft, setDustDraft] = useState('');
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [savingDust, setSavingDust] = useState(false);
  const [dustError, setDustError] = useState<string | null>(null);
  const [dustSaved, setDustSaved] = useState(false);

  // Invite a friend by email.
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteErr, setInviteErr] = useState<string | null>(null);

  const onInvite = useCallback(async () => {
    if (!inkey) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setInviteErr('Enter a valid email address.');
      setInviteMsg(null);
      return;
    }
    setInviting(true);
    setInviteErr(null);
    setInviteMsg(null);
    try {
      const res = await api.sendInvite(inkey, email);
      setInviteEmail('');
      setInviteMsg(res?.message || `Invitation sent to ${email}.`);
    } catch (e: any) {
      setInviteErr(e?.message || 'Could not send the invitation.');
    } finally {
      setInviting(false);
    }
  }, [inkey, inviteEmail]);

  const loadPrefs = useCallback(async () => {
    if (!inkey) return;
    try {
      const p = await api.getUserPrefs(inkey);
      setPrefs(p);
      setDustDraft(p.dust_threshold_sats != null ? String(p.dust_threshold_sats) : '');
    } catch {
      /* leave unset */
    } finally {
      setLoadingPrefs(false);
    }
  }, [inkey]);

  useEffect(() => {
    loadPrefs();
  }, [loadPrefs]);

  const currentOverride =
    prefs?.dust_threshold_sats != null ? String(prefs.dust_threshold_sats) : '';
  const dirty = dustDraft.trim() !== currentOverride;

  const saveDust = useCallback(async () => {
    if (!inkey) return;
    setSavingDust(true);
    setDustError(null);
    setDustSaved(false);
    try {
      const n = Number(dustDraft);
      // Empty / 0 clears the override → back to the admin default.
      const value = dustDraft.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : n;
      if (value != null && value > 10000) {
        setDustError('Maximum is 10,000 sats.');
        setSavingDust(false);
        return;
      }
      const p = await api.updateUserPrefs(inkey, value);
      setPrefs(p);
      setDustDraft(p.dust_threshold_sats != null ? String(p.dust_threshold_sats) : '');
      setDustSaved(true);
    } catch (e: any) {
      setDustError(e?.message || 'Could not save. Please try again.');
    } finally {
      setSavingDust(false);
    }
  }, [inkey, dustDraft]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.item}>
            <Text style={styles.itemLabel}>Username</Text>
            <Text style={styles.itemValue}>{username || '—'}</Text>
          </View>
          <View style={styles.item}>
            <Text style={styles.itemLabel}>Email</Text>
            <Text style={styles.itemValue} numberOfLines={1}>{email || '—'}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Coin control</Text>
          <View style={styles.column}>
            <Text style={styles.itemLabel}>Dust threshold (sats)</Text>
            <Text style={styles.help}>
              Coins at or below this from other people are flagged as dust so you
              can freeze them. Your own change is never flagged. Leave blank to use
              the server default
              {prefs ? ` (${prefs.admin_default_dust} sats)` : ''}.
            </Text>
            {loadingPrefs ? (
              <ActivityIndicator style={{ marginTop: 12 }} color={colors.primary} />
            ) : (
              <>
                <View style={styles.inputRow}>
                  <TextInput
                    style={styles.input}
                    value={dustDraft}
                    onChangeText={(t) => {
                      setDustDraft(t.replace(/[^0-9]/g, ''));
                      setDustSaved(false);
                      setDustError(null);
                    }}
                    keyboardType="number-pad"
                    placeholder={
                      prefs ? String(prefs.admin_default_dust) : 'default'
                    }
                    placeholderTextColor={colors.faint}
                  />
                  <TouchableOpacity
                    style={[styles.saveBtn, (!dirty || savingDust) && styles.saveDisabled]}
                    onPress={saveDust}
                    disabled={!dirty || savingDust}>
                    {savingDust ? (
                      <ActivityIndicator color={colors.onPrimary} />
                    ) : (
                      <Text style={styles.saveText}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
                {dustError ? <Text style={styles.dustError}>{dustError}</Text> : null}
                {dustSaved ? (
                  <Text style={styles.dustSaved}>✓ Saved</Text>
                ) : null}
                {prefs ? (
                  <Text style={styles.effective}>
                    Currently using {prefs.effective_dust_threshold} sats
                    {prefs.dust_threshold_sats == null ? ' (server default)' : ' (your override)'}
                  </Text>
                ) : null}
              </>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Security</Text>

          <View style={styles.column}>
            <View style={styles.switchRow}>
              <Text style={styles.itemLabel}>App Lock</Text>
              {lockBusy ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Switch
                  value={lockEnabled}
                  onValueChange={onToggleLock}
                  trackColor={{ true: colors.primary }}
                />
              )}
            </View>
            <Text style={styles.help}>{lockSubtitle}</Text>
            {lockMsg ? <Text style={styles.dustError}>{lockMsg}</Text> : null}

            <View style={styles.divider} />

            <View style={styles.switchRow}>
              <Text style={styles.itemLabel}>App PIN</Text>
              <Switch
                value={pinSet}
                onValueChange={onTogglePin}
                trackColor={{ true: colors.primary }}
              />
            </View>
            <Text style={styles.help}>
              Unlock with a 6-digit PIN. When on, it replaces biometrics as the
              unlock method and enables a duress PIN.
            </Text>
            {pinSet ? (
              <TouchableOpacity
                style={[styles.switchRow, { marginTop: 12 }]}
                onPress={() => setPinModal('normal')}
                accessibilityRole="button">
                <Text style={styles.itemLabel}>Change PIN</Text>
                <Text style={styles.itemValue}>Change ›</Text>
              </TouchableOpacity>
            ) : null}

            {pinSet ? (
              <>
                <View style={[styles.switchRow, { marginTop: 14 }]}>
                  <Text style={styles.itemLabel}>Duress PIN</Text>
                  <Switch
                    value={hasDuress}
                    onValueChange={onToggleDuress}
                    trackColor={{ true: colors.primary }}
                  />
                </View>
                <Text style={styles.help}>
                  A second PIN that, entered at the lock screen, wipes this
                  device's wallet keys, turns off server-side scanning, and signs
                  you out. Funds can't be spent from here; they stay safe on-chain
                  and recover from your seed. Use it if you're ever forced to
                  unlock.
                </Text>
              </>
            ) : null}
          </View>

          {DEVICE_TRUST_ENABLED ? (
            <TouchableOpacity
              style={[styles.item, { marginTop: 8 }]}
              onPress={() => setDevicesOpen(true)}>
              <Text style={styles.itemLabel}>Trusted devices</Text>
              <Text style={styles.itemValue}>Manage ›</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Scanning</Text>
          <View style={styles.column}>
            <View style={styles.switchRow}>
              <Text style={styles.itemLabel}>Background scanning</Text>
              {bgBusy ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Switch
                  value={bgEnabled}
                  onValueChange={onToggleBackgroundScan}
                  disabled={!bgWalletId}
                  trackColor={{ true: colors.primary }}
                />
              )}
            </View>
            <Text style={styles.help}>
              Keep this wallet caught up on the server while you're away, so you
              don't face a long scan when you return. Uploads your scan key
              (detection only — it can never spend your funds).
            </Text>
            {bgMsg ? <Text style={styles.dustError}>{bgMsg}</Text> : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Invite a friend</Text>
          <View style={styles.column}>
            <Text style={styles.help}>
              Send someone an email invite to join Thrilla. We email them a
              sign-up link — their address is used only for this invite, not
              stored.
            </Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={inviteEmail}
                onChangeText={(t) => {
                  setInviteEmail(t);
                  setInviteErr(null);
                  setInviteMsg(null);
                }}
                placeholder="friend@email.com"
                placeholderTextColor={colors.faint}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[
                  styles.saveBtn,
                  (inviting || !inviteEmail.trim()) && styles.saveDisabled,
                ]}
                onPress={onInvite}
                disabled={inviting || !inviteEmail.trim()}>
                {inviting ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Text style={styles.saveText}>Send</Text>
                )}
              </TouchableOpacity>
            </View>
            {inviteErr ? <Text style={styles.dustError}>{inviteErr}</Text> : null}
            {inviteMsg ? <Text style={styles.dustSaved}>✓ {inviteMsg}</Text> : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wallet</Text>
          <View style={styles.column}>
            <Text style={styles.help}>
              Permanently delete this wallet and all its coins from the server and
              erase its keys from this device. You can only restore it afterwards
              from your recovery phrase (and passphrase, if set).
            </Text>
            <TouchableOpacity
              style={[
                styles.removeBtn,
                (!wallet || removing) && styles.saveDisabled,
              ]}
              onPress={onRemoveWallet}
              disabled={!wallet || removing}>
              {removing ? (
                <ActivityIndicator color={colors.danger} />
              ) : (
                <Text style={styles.removeText}>Remove wallet</Text>
              )}
            </TouchableOpacity>
            {removeMsg ? <Text style={styles.help}>{removeMsg}</Text> : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.item}>
            <Text style={styles.itemLabel}>Version</Text>
            <Text style={styles.itemValue}>0.1.0</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.logout} onPress={() => logout()}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {DEVICE_TRUST_ENABLED ? (
        <DevicesModal
          visible={devicesOpen}
          onClose={() => setDevicesOpen(false)}
        />
      ) : null}

      <PinSetupModal
        visible={pinModal !== null}
        mode={pinModal === 'duress' ? 'duress' : 'normal'}
        onClose={() => setPinModal(null)}
        onDone={onPinDone}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, padding: 16 },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  item: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  column: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 14,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemLabel: { fontSize: 14, color: colors.text, fontWeight: '500' },
  itemValue: {
    fontSize: 12,
    color: colors.faint,
    flex: 1,
    textAlign: 'right',
    marginLeft: 8,
  },
  help: { fontSize: 12, color: colors.faint, marginTop: 4, lineHeight: 17 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 16,
  },
  effective: { fontSize: 12, color: colors.muted, marginTop: 10, fontWeight: '600' },
  dustError: { fontSize: 13, color: colors.danger, marginTop: 10 },
  dustSaved: { fontSize: 13, color: colors.green, marginTop: 10, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  saveDisabled: { opacity: 0.5 },
  saveText: { color: colors.onPrimary, fontSize: 14, fontWeight: '600' },
  removeBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  removeText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  logout: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  logoutText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
});
