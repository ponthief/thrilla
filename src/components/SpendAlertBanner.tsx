import React, { useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@stores/authStore';
import { useNavStore } from '@stores/navStore';
import { useSpendAlerts } from '@stores/spendAlertStore';
import { colors } from '@/theme';

// The warning shown when coins left this wallet in a transaction it did not
// broadcast — the visible half of helpers/spend_watch.py.
//
// Not a PushBanner. Those slide away after six seconds, which is right for "a
// payment arrived" and wrong for this: it stays until the user acknowledges it,
// and comes back on the next poll if they close the app without doing so.
//
// The call to action is deliberately NOT "replace the transaction". Whoever
// signed it holds the same key the wallet does, so a replacement is a fee
// auction they can counter, and winning it changes nothing durable. What is
// still winnable is the coins they have not touched yet — hence "move what is
// left, now", which is what both this and the push say.

function when(ts: number): string {
  if (!ts) return '';
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return '';
  }
}

export default function SpendAlertBanner() {
  const alerts = useSpendAlerts((s) => s.alerts);
  const explorerBase = useSpendAlerts((s) => s.explorerBase);
  const acking = useSpendAlerts((s) => s.acking);
  const acknowledge = useSpendAlerts((s) => s.acknowledge);
  const adminkey = useAuthStore((s) => s.adminkey);
  const setTab = useNavStore((s) => s.setTab);
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  if (!alerts.length) return null;

  // Newest first from the server. One bar however many there are; the sheet
  // lists them all, because "three of these" is itself information.
  const latest = alerts[0];
  const more = alerts.length - 1;

  const dismiss = (txid: string) => {
    if (!adminkey) return;
    Alert.alert(
      'Dismiss this warning?',
      'Only do this once your remaining funds are somewhere safe, or if you know this transaction was yours. It will not be shown again.',
      [
        { text: 'Keep showing', style: 'cancel' },
        {
          text: 'Dismiss',
          style: 'destructive',
          onPress: () => {
            acknowledge(adminkey, txid).catch(() => {
              Alert.alert(
                'Could not dismiss',
                'The warning is still active. Try again when you are back online.',
              );
            });
          },
        },
      ],
    );
  };

  return (
    <>
      <View style={[styles.wrap, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setOpen(true)}
          style={styles.bar}
          accessibilityRole="button"
          accessibilityLabel={`Unrecognised transaction. Coins left this wallet in a transaction it did not send. Tap for what to do.`}>
          <Text style={styles.barTitle}>⚠  Unrecognised transaction</Text>
          <Text style={styles.barBody}>
            {more > 0
              ? `${alerts.length} transactions spent your coins and this wallet sent none of them. Tap for what to do.`
              : 'Coins left this wallet in a transaction it did not send. Tap for what to do.'}
          </Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <ScrollView
              contentContainerStyle={styles.sheetBody}
              showsVerticalScrollIndicator={false}>
              <Text style={styles.title}>Your spend key may be compromised</Text>
              <Text style={styles.para}>
                Coins from this wallet were spent in a transaction it did not
                broadcast. The only thing that can sign such a transaction is
                your spend key, so treat the key — and the recovery phrase it
                comes from — as being in someone else’s hands.
              </Text>

              <Text style={styles.heading}>What to do now</Text>
              <Text style={styles.step}>
                1. Create a new wallet from a NEW recovery phrase, on a device
                you trust. Do not reuse this one.
              </Text>
              <Text style={styles.step}>
                2. Send everything still in this wallet to that new wallet,
                immediately. Whatever they have not touched yet is still yours
                to move.
              </Text>
              <Text style={styles.step}>
                3. Stop using this wallet to receive. Anything paid to it later
                can be taken the same way.
              </Text>

              <Text style={styles.aside}>
                Replacing their transaction with a higher fee (RBF) is not a way
                out: it spends the same coins with the same key they hold, so
                they can simply replace it back, and it would not protect
                anything they have not spent yet. Moving the rest is what
                helps.
              </Text>

              <Text style={styles.heading}>
                {alerts.length > 1 ? 'The transactions' : 'The transaction'}
              </Text>
              {alerts.map((a) => (
                <View key={a.txid} style={styles.txRow}>
                  <Text style={styles.txid} numberOfLines={1} ellipsizeMode="middle">
                    {a.txid}
                  </Text>
                  {when(a.detected_at) ? (
                    <Text style={styles.txWhen}>Noticed {when(a.detected_at)}</Text>
                  ) : null}
                  <View style={styles.txActions}>
                    <TouchableOpacity
                      onPress={() =>
                        Linking.openURL(`${explorerBase}/tx/${a.txid}`).catch(
                          () => {},
                        )
                      }>
                      <Text style={styles.link}>View on explorer ↗</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => dismiss(a.txid)}
                      disabled={acking === a.txid || !adminkey}>
                      <Text
                        style={[
                          styles.dismiss,
                          (acking === a.txid || !adminkey) && styles.disabled,
                        ]}>
                        {acking === a.txid ? 'Dismissing…' : 'Dismiss'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={styles.primary}
              onPress={() => {
                setOpen(false);
                setTab('send');
              }}>
              <Text style={styles.primaryText}>Move my funds</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.close}
              onPress={() => setOpen(false)}
              accessibilityRole="button">
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingBottom: 10,
    // Above PushBanner (1000): a routine "payment received" must never cover
    // this one.
    zIndex: 1100,
    elevation: 1100,
  },
  bar: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  barTitle: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 3,
  },
  barBody: { color: colors.text, fontSize: 13, lineHeight: 18 },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '88%',
    backgroundColor: colors.bg,
    borderRadius: 16,
    padding: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
  },
  sheetBody: { paddingBottom: 8 },
  title: {
    fontSize: 19,
    fontWeight: 'bold',
    color: colors.danger,
    marginBottom: 12,
  },
  para: { fontSize: 14, color: colors.text, lineHeight: 21 },
  heading: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.label,
    marginTop: 20,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  step: { fontSize: 14, color: colors.text, lineHeight: 21, marginBottom: 8 },
  aside: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
    marginTop: 8,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  txRow: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  txid: { fontSize: 12, color: colors.strong, fontFamily: 'monospace' },
  txWhen: { fontSize: 12, color: colors.faint, marginTop: 4 },
  txActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  link: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  dismiss: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  primary: {
    backgroundColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  primaryText: { color: '#000', fontSize: 15, fontWeight: '700' },
  close: { marginTop: 12, paddingVertical: 6, alignItems: 'center' },
  closeText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
});
