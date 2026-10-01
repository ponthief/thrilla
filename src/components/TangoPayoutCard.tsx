// Where a Tango's change goes, if not into your own wallet.
//
// WHAT THIS SETTING IS FOR. A round leaves a change output, and it is the
// strongest remaining linkability problem in Tango: its value is fixed by the
// round's arithmetic, so spending it later — to anyone, on its own, months
// afterwards — identifies which of the two identical shares were yours. The
// wallet can refuse to spend it alongside a share (undoesARound does), but it
// cannot stop the coin from eventually being spent. Getting it out of the
// wallet is the only clean fix.
//
// So: give a Lightning address, and the change output pays the service
// instead, with its value sent on minus a fee. WhiSPa holds no Lightning
// balance — this money goes to an account the app never touches.
//
// IT SAYS THE COIN STOPS BEING YOURS, in those words, before it is switched
// on. That is the part nobody would guess from "send my change over
// Lightning", and it is not something to discover after a round.
//
// Not shown off mainnet. A Lightning address is a mainnet endpoint and signet
// change is worthless, so the server reports `offered: false` and this renders
// nothing rather than a field that cannot work.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as api from '@services/api';
import {
  PAYOUT_CONSENT,
  PAYOUT_TITLE,
  PAYOUT_WHY,
  lnAddressProblem,
  payoutFeeNote,
} from '@services/lnAddress';
import { colors } from '@/theme';

const PRIMARY = colors.primary;

export default function TangoPayoutCard({
  inkey,
  network,
}: {
  inkey: string | null;
  network: string;
}) {
  const [setting, setSetting] = useState<api.TangoPayoutSetting | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!inkey || !network) return;
    try {
      const s = await api.getTangoPayoutSetting(inkey, network);
      setSetting(s);
      setDraft(s.address || '');
    } catch {
      // A setting that cannot be read is not worth an error on a screen about
      // something else. It renders nothing, and the round is unaffected.
      setSetting(null);
    }
  }, [inkey, network]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async () => {
    Keyboard.dismiss();
    setError(null);
    setNote(null);
    const value = draft.trim().toLowerCase();
    // The shape, locally, so an obvious typo costs no round trip. Whether
    // anyone answers there is the server's to find out.
    const problem = lnAddressProblem(value);
    if (problem) {
      setError(problem);
      return;
    }
    if (!inkey) return;
    setBusy(true);
    try {
      await api.setTangoLnAddress(inkey, network, value);
      setEditing(false);
      setNote('Saved. Your change will be sent here after a round confirms.');
      await load();
    } catch (e: any) {
      // Worth showing verbatim: the server resolved the address and is saying
      // what it found — unreachable, or a minimum above a change payout.
      setError(e?.message || 'Could not save that address.');
    } finally {
      setBusy(false);
    }
  }, [draft, inkey, network, load]);

  const remove = useCallback(async () => {
    if (!inkey) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteTangoLnAddress(inkey, network);
      setNote('Turned off. Your change will stay in your wallet.');
      setDraft('');
      setEditing(false);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not turn that off.');
    } finally {
      setBusy(false);
    }
  }, [inkey, network, load]);

  // Off mainnet, or not configured on this instance: nothing to offer, and a
  // field that cannot work is worse than no field.
  if (!setting || !setting.offered) return null;

  const saved = !!setting.address;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{PAYOUT_TITLE}</Text>

      {!setting.ready ? (
        // The chain allows it; this instance has not switched it on.
        <Text style={styles.muted}>
          Not available on this server yet. Your change stays in your wallet.
        </Text>
      ) : (
        <>
          <Text style={styles.body}>{PAYOUT_WHY}</Text>
          <Text style={styles.consent}>{PAYOUT_CONSENT}</Text>
          <Text style={styles.muted}>
            {payoutFeeNote(
              setting.fee_pct,
              setting.fee_floor_sats,
              setting.min_change_sats,
            )}
          </Text>

          {saved && !editing ? (
            <View style={styles.savedRow}>
              <Text style={styles.savedAddr} numberOfLines={1}>
                {setting.address}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setNote(null);
                  setError(null);
                  setEditing(true);
                }}>
                <Text style={styles.link}>Change</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={remove} disabled={busy}>
                <Text style={styles.removeLink}>Turn off</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={(t) => {
                  setDraft(t);
                  setError(null);
                  setNote(null);
                }}
                placeholder="satoshi@coinos.io"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[
                    styles.saveBtn,
                    (busy || !draft.trim()) && styles.btnDisabled,
                  ]}
                  onPress={save}
                  disabled={busy || !draft.trim()}>
                  {busy ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <Text style={styles.saveText}>Save</Text>
                  )}
                </TouchableOpacity>
                {saved ? (
                  <TouchableOpacity
                    onPress={() => {
                      setEditing(false);
                      setDraft(setting.address);
                      setError(null);
                    }}>
                    <Text style={styles.link}>Cancel</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {note ? <Text style={styles.note}>{note}</Text> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
  },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  body: { fontSize: 13, color: colors.muted, lineHeight: 18, marginTop: 6 },
  consent: { fontSize: 13, color: colors.warn, lineHeight: 18, marginTop: 8 },
  muted: { fontSize: 12, color: colors.faint, lineHeight: 17, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginTop: 12,
    fontSize: 13,
    color: colors.text,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  saveBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  saveText: { color: colors.onPrimary, fontSize: 13, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 12,
  },
  savedAddr: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    fontFamily: 'monospace',
  },
  link: { fontSize: 13, fontWeight: '600', color: PRIMARY },
  removeLink: { fontSize: 13, fontWeight: '600', color: colors.danger },
  error: { fontSize: 12, color: colors.danger, lineHeight: 17, marginTop: 10 },
  note: { fontSize: 12, color: colors.green, lineHeight: 17, marginTop: 10 },
});
