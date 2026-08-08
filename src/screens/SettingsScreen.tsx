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
import { getWalletKeys } from '@services/secureKeys';
import { colors, DEVICE_TRUST_ENABLED } from '@/theme';
import DevicesModal from '../components/DevicesModal';

export default function SettingsScreen() {
  const username = useAuthStore((state) => state.username);
  const inkey = useAuthStore((state) => state.inkey);
  const logout = useAuthStore((state) => state.logout);
  const [devicesOpen, setDevicesOpen] = useState(false);

  // App lock (biometric / device PIN).
  const lockEnabled = useAppLockStore((s) => s.enabled);
  const setLockEnabled = useAppLockStore((s) => s.setEnabled);
  const [biometry, setBiometry] = useState<string | null>(null);
  const [lockBusy, setLockBusy] = useState(false);
  const [lockMsg, setLockMsg] = useState<string | null>(null);

  // Background scanning (opt-in server-side "Remote Scanner").
  const [bgWalletId, setBgWalletId] = useState<string | null>(null);
  const [bgEnabled, setBgEnabled] = useState(false);
  const [bgBusy, setBgBusy] = useState(false);
  const [bgMsg, setBgMsg] = useState<string | null>(null);

  // Push-notification self-test.
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [pushOk, setPushOk] = useState(false);

  useEffect(() => {
    (async () => {
      if (!inkey) return;
      try {
        const w = api.pickSilntWallet(await api.getSilntWallets(inkey));
        if (!w) return;
        setBgWalletId(w.id);
        setBgEnabled(await api.getBackgroundScan(inkey, w.id));
      } catch {
        /* leave the toggle off/disabled if we can't load status */
      }
    })();
  }, [inkey]);

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

  const onTestPush = useCallback(async () => {
    if (!inkey) return;
    setPushBusy(true);
    setPushMsg(null);
    setPushOk(false);
    try {
      const r = await api.sendTestPush(inkey);
      if (!r.push_enabled) {
        // The server returns the specific reason (env unset vs. file missing vs.
        // google-auth not installed) — surface it verbatim.
        setPushMsg(
          r.errors?.[0] ||
            "Server can't send push (no FCM credentials). Check the backend.",
        );
      } else if (r.tokens === 0) {
        setPushMsg(
          'This device is not registered for push. Make sure the build has ' +
            'google-services.json and that you granted notification permission, ' +
            'then sign out and back in.',
        );
      } else if (r.sent > 0) {
        setPushOk(true);
        setPushMsg(
          `Sent to ${r.sent} device${r.sent === 1 ? '' : 's'}. If it doesn't ` +
            'appear, check the OS notification settings for the app.',
        );
      } else {
        setPushMsg(
          r.errors?.[0] || 'FCM accepted no devices. See server logs for detail.',
        );
      }
    } catch (e: any) {
      setPushMsg(e?.message || 'Could not send test notification.');
    } finally {
      setPushBusy(false);
    }
  }, [inkey]);

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

            <View style={styles.divider} />

            <TouchableOpacity
              style={styles.switchRow}
              onPress={onTestPush}
              disabled={pushBusy}
              accessibilityRole="button">
              <Text style={styles.itemLabel}>Send test notification</Text>
              {pushBusy ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.itemValue}>Send ›</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.help}>
              Checks that push notifications are set up end-to-end (server
              credentials + this device registered), without waiting for a real
              payment.
            </Text>
            {pushMsg ? (
              <Text style={pushOk ? styles.help : styles.dustError}>{pushMsg}</Text>
            ) : null}
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
    marginVertical: 14,
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
