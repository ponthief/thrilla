import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import * as api from '@services/api';
import { useAppLockStore } from '@stores/appLockStore';
import { useAuthStore } from '@stores/authStore';
import { useNotifyStore } from '@stores/notifyStore';
import { useSilntWallet } from '../hooks/useSilntWallet';
import AboutPage from './settings/AboutPage';
import AccountPage from './settings/AccountPage';
import NotificationsPage from './settings/NotificationsPage';
import ScanningPage from './settings/ScanningPage';
import SecurityPage from './settings/SecurityPage';
import TangoChangePage from './settings/TangoChangePage';
import WalletPage from './settings/WalletPage';
import { Group, NavRow, Page } from './settings/ui';

// Settings, as a menu of six pages rather than one scroll of eight sections.
//
// It was one page, and the length was the problem: the recovery phrase was
// buried under "Scanning", the dust threshold came second because it happened to
// be written second, and finding anything meant reading everything. Each page
// here is short enough to take in without scrolling, and the menu says what is
// on it — with the current setting on the right where the app already knows it,
// so checking whether the lock is on costs no taps at all.
//
// The app has no router (see stores/navStore), so this is a state switch, with
// Android's back button wired to it. Rendering the menu underneath and the page
// on top would need a stack; one at a time is what the tab bar expects.

type PageKey =
  | 'account'
  | 'security'
  | 'notifications'
  | 'scanning'
  | 'wallet'
  | 'tangochange'
  | 'about';

export default function SettingsScreen() {
  const [page, setPage] = useState<PageKey | null>(null);

  const username = useAuthStore((s) => s.username);
  const pinSet = useAppLockStore((s) => s.pinSet);
  const bioEnabled = useAppLockStore((s) => s.bioEnabled);
  const lockEnabled = useAppLockStore((s) => s.enabled);
  const autoLockMs = useAppLockStore((s) => s.autoLockMs);
  const alerts = useNotifyStore((s) => s.alerts);

  // Whether to list the Tango change payout at all, and what it says on the
  // right. The server decides whether it is offered — mainnet only, and
  // configured — and a row leading to a page that renders nothing is worse
  // than no row. Failing to read it hides the row, which is the state every
  // build had before this existed.
  const inkey = useAuthStore((s) => s.inkey);
  const { wallet } = useSilntWallet();
  const walletNetwork = wallet?.network ?? null;
  const [payout, setPayout] = useState<api.TangoPayoutSetting | null>(null);

  useEffect(() => {
    if (!inkey || !walletNetwork) return;
    let alive = true;
    api
      .getTangoPayoutSetting(inkey, walletNetwork)
      .then((s) => {
        if (alive) setPayout(s);
      })
      .catch(() => {
        if (alive) setPayout(null);
      });
    return () => {
      alive = false;
    };
  }, [inkey, walletNetwork]);

  const back = useCallback(() => setPage(null), []);

  // Hardware back closes the open page instead of leaving the app. Returning
  // false on the menu hands the press back to the OS, so Settings is still an
  // exit point the way every other tab is.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page === null) return false;
      setPage(null);
      return true;
    });
    return () => sub.remove();
  }, [page]);

  if (page === 'account') return <AccountPage onBack={back} />;
  if (page === 'security') return <SecurityPage onBack={back} />;
  if (page === 'notifications') return <NotificationsPage onBack={back} />;
  if (page === 'scanning') return <ScanningPage onBack={back} />;
  if (page === 'wallet') return <WalletPage onBack={back} />;
  if (page === 'tangochange') return <TangoChangePage onBack={back} />;
  if (page === 'about') return <AboutPage onBack={back} />;

  // What the lock is, in the two words the menu has room for. "Off" is the one
  // worth seeing from here without opening anything.
  const lockSummary = !lockEnabled
    ? 'Off'
    : pinSet
    ? 'PIN'
    : bioEnabled
    ? 'Biometric'
    : 'On';
  const lockRowHelp = !lockEnabled
    ? 'Nothing is guarding your wallet on this phone'
    : autoLockMs === 0
    ? 'Locks as soon as you leave the app'
    : 'Unlocking, auto-lock, duress PIN, recovery phrase';

  // Three states, not two: an address kept but switched off is the one the
  // menu most needs to show, because it is the one somebody comes back to
  // Settings to turn on again.
  const payoutSummary = !payout?.ready
    ? 'Unavailable'
    : payout.address
      ? payout.enabled
        ? 'On'
        : 'Off'
      : 'Not set';

  return (
    <Page title="Settings" subtitle={username ? `Signed in as ${username}` : undefined}>
      <Group title="You">
        <NavRow
          first
          title="Account"
          help="Username, email, invites, signing out"
          value={username || undefined}
          onPress={() => setPage('account')}
        />
      </Group>

      <Group title="This phone">
        <NavRow
          first
          title="Security"
          help={lockRowHelp}
          value={lockSummary}
          danger={!lockEnabled}
          onPress={() => setPage('security')}
        />
        <NavRow
          title="Notifications"
          help="Whether payments and Tango announce themselves"
          value={alerts ? 'On' : 'Off'}
          onPress={() => setPage('notifications')}
        />
      </Group>

      <Group title="Wallet">
        <NavRow
          first
          title="Scanning"
          help="Background scanning, and how much catches up quietly"
          onPress={() => setPage('scanning')}
        />
        <NavRow
          title="Wallet"
          help="Dust threshold, and removing this wallet"
          onPress={() => setPage('wallet')}
        />
        {payout?.offered ? (
          <NavRow
            title="Tango change"
            help="Send a round's change to a Lightning address you control"
            value={payoutSummary}
            onPress={() => setPage('tangochange')}
          />
        ) : null}
      </Group>

      <Group title="App">
        <NavRow
          first
          title="About"
          help="Version and source code"
          onPress={() => setPage('about')}
        />
      </Group>
    </Page>
  );
}
