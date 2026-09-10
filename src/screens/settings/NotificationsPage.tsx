import React, { useCallback, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { useNotifyStore } from '@stores/notifyStore';
import { usePushBanner } from '@stores/pushBanner';
import {
  ensureNotificationPermission,
  hasNotificationPermission,
} from '@services/push';
import { Block, Group, NavRow, Note, Page, SwitchRow } from './ui';

// One switch, and the truth about whether the phone will honour it.
export default function NotificationsPage({ onBack }: { onBack: () => void }) {
  const paymentAlerts = useNotifyStore((s) => s.paymentAlerts);
  const setPaymentAlerts = useNotifyStore((s) => s.setPaymentAlerts);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [permBlocked, setPermBlocked] = useState(false);

  // Alerts can be on in the app while the phone blocks notifications for
  // Thrilla (permission denied, or revoked later in system settings) — say so
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
              "Notifications are blocked for Thrilla in your phone's settings. Allow them there, then turn this on again.",
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
              Your phone is blocking notifications for Thrilla, so alerts will
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
      </Group>
    </Page>
  );
}
