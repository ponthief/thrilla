import React, { useCallback, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { useNotifyStore } from '@stores/notifyStore';
import { usePushBanner } from '@stores/pushBanner';
import { useAuthStore } from '@stores/authStore';
import * as api from '@services/api';
import {
  ensureNotificationPermission,
  hasNotificationPermission,
} from '@services/push';
import { Block, Group, NavRow, Note, Page, SwitchRow } from './ui';

// One switch, and the truth about whether the phone will honour it.
export default function NotificationsPage({ onBack }: { onBack: () => void }) {
  const paymentAlerts = useNotifyStore((s) => s.paymentAlerts);
  const setPaymentAlerts = useNotifyStore((s) => s.setPaymentAlerts);
  const inkey = useAuthStore((s) => s.inkey);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [permBlocked, setPermBlocked] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  // Alerts can be on in the app while the phone blocks notifications for
  // WhiSPa (permission denied, or revoked later in system settings) — say so
  // instead of showing a switch that promises alerts the OS will drop. Checked
  // on mount, so returning from system settings and reopening this page picks
  // up a fresh grant.
  useEffect(() => {
    if (!paymentAlerts) {
      setPermBlocked(false);
      return;
    }
    let cancelled = false;
    hasNotificationPermission().then((ok) => {
      if (!cancelled) setPermBlocked(!ok);
    });
    return () => {
      cancelled = true;
    };
  }, [paymentAlerts]);

  // Turning alerts on needs the OS notification permission; without it the
  // system notification would never show, so keep the switch off and point the
  // user at their phone's settings (Android won't re-prompt after two denials).
  // Turning them off only stores the pref — App.tsx reacts by removing this
  // device's push token from the server.
  const onToggle = useCallback(
    async (value: boolean) => {
      setBusy(true);
      setMsg(null);
      try {
        if (value) {
          if (!(await ensureNotificationPermission())) {
            setPermBlocked(true);
            setMsg(
              "Notifications are blocked for WhiSPa in your phone's settings. Allow them there, then turn this on again.",
            );
            return;
          }
          setPermBlocked(false);
          await setPaymentAlerts(true);
        } else {
          setPermBlocked(false);
          await setPaymentAlerts(false);
          // Drop any banner already on screen so the switch takes effect now.
          usePushBanner.getState().clear();
        }
      } finally {
        setBusy(false);
      }
    },
    [setPaymentAlerts],
  );

  // Push has three links — credentials on the server, a device token in the
  // database, and FCM accepting the send — and from the phone all three
  // failures look the same: nothing arrives. The server's report says which
  // one it is, so put it on screen rather than making the user infer it from
  // a payment that never announced itself.
  const onTest = useCallback(async () => {
    if (!inkey || testing) return;
    setTesting(true);
    setTest(null);
    try {
      const r = await api.testPushNotification(inkey);
      if (r.sent > 0) {
        setTest({
          ok: true,
          // While this screen is open the app is in the foreground, where
          // Android does not draw notification messages itself — push.ts shows
          // them as a banner instead. So a banner is the expected outcome here,
          // and the real notification is what arrives with the app closed.
          text: 'Sent. It should appear as a banner in a moment; with the app closed it arrives as a notification.',
        });
      } else if (!r.push_enabled) {
        setTest({
          ok: false,
          text:
            r.errors[0] ||
            'The server has no working Firebase credentials, so it cannot send notifications.',
        });
      } else if (r.tokens === 0) {
        setTest({
          ok: false,
          text: 'This phone is not registered with the server. Turn Payment alerts off and back on to register it again.',
        });
      } else {
        setTest({ ok: false, text: r.errors.join(' ') || 'Firebase refused the notification.' });
      }
    } catch (e: any) {
      setTest({ ok: false, text: e?.message || 'Could not reach the server.' });
    } finally {
      setTesting(false);
    }
  }, [inkey, testing]);

  return (
    <Page
      title="Notifications"
      subtitle="This phone only — your other devices keep their own setting."
      onBack={onBack}>
      <Group
        title="Payments"
        footer="Turn this off for silent receiving. Coins still arrive and still show up in your balance and history; nothing announces them.">
        <SwitchRow
          first
          title="Payment alerts"
          help="Be told when a payment arrives: a notification while the app is closed, which needs background scanning on, and a banner while it is open."
          value={paymentAlerts}
          onValueChange={onToggle}
          busy={busy}
        />
        {msg ? (
          <Block>
            <Note kind="error">{msg}</Note>
          </Block>
        ) : permBlocked ? (
          <Block>
            <Note kind="error">
              Your phone is blocking notifications for WhiSPa, so alerts will
              not appear while the app is closed.
            </Note>
          </Block>
        ) : null}
        {permBlocked ? (
          <NavRow
            title="Allow in system settings"
            value="Open"
            onPress={() => Linking.openSettings().catch(() => {})}
          />
        ) : null}
        {paymentAlerts ? (
          <NavRow
            title="Send a test notification"
            value={testing ? 'Sending…' : 'Send'}
            onPress={onTest}
          />
        ) : null}
        {test ? (
          <Block>
            <Note kind={test.ok ? 'ok' : 'error'}>{test.text}</Note>
          </Block>
        ) : null}
      </Group>
    </Page>
  );
}
