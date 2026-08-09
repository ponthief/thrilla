import React, { useEffect, useRef, useState } from 'react';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  AppState,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import WalletScreen from './screens/WalletScreen';
import SendScreen from './screens/SendScreen';
import ReceiveScreen from './screens/ReceiveScreen';
import SettingsScreen from './screens/SettingsScreen';
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import ForgotPasswordScreen from './screens/ForgotPasswordScreen';
import DeviceConfirmScreen from './screens/DeviceConfirmScreen';
import LockScreen from './screens/LockScreen';
import { useAuthStore } from '@stores/authStore';
import { useAppLockStore } from '@stores/appLockStore';
import { useIdleLogout } from './hooks/useIdleLogout';
import { touchActivity } from '@services/sessionActivity';
import { registerForPush, unregisterForPush } from '@services/push';
import PushBanner from './components/PushBanner';
import { colors, DEVICE_TRUST_ENABLED } from '@/theme';

// Scan lives inside Receive now (Address / Scan toggle), so it's no longer a tab.
type TabKey = 'wallet' | 'send' | 'receive' | 'settings';

const TABS: { key: TabKey; label: string; icon: string; Screen: React.ComponentType }[] = [
  { key: 'wallet', label: 'Wallet', icon: '₿', Screen: WalletScreen },
  { key: 'send', label: 'Send', icon: '↑', Screen: SendScreen },
  { key: 'receive', label: 'Receive', icon: '↓', Screen: ReceiveScreen },
  { key: 'settings', label: 'Settings', icon: '⚙', Screen: SettingsScreen },
];

const PRIMARY = colors.primary;
const INACTIVE = colors.inactive;

function TabBar({
  active,
  onSelect,
}: {
  active: TabKey;
  onSelect: (key: TabKey) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {TABS.map((tab) => {
        const focused = tab.key === active;
        const color = focused ? PRIMARY : INACTIVE;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tabItem}
            onPress={() => onSelect(tab.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.label}>
            <Text style={[styles.tabIcon, { color }]}>{tab.icon}</Text>
            <Text style={[styles.tabLabel, { color }]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Shell() {
  const [active, setActive] = useState<TabKey>('wallet');
  const ActiveScreen =
    TABS.find((t) => t.key === active)?.Screen ?? WalletScreen;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <View style={styles.content}>
        <ActiveScreen />
      </View>
      <TabBar active={active} onSelect={setActive} />
    </View>
  );
}

type AuthScreen = 'login' | 'register' | 'forgot';

// Minimal auth-flow navigator (the app has no router; a state switch is enough
// for the three unauthenticated screens).
function AuthNavigator() {
  const [screen, setScreen] = useState<AuthScreen>('login');
  switch (screen) {
    case 'register':
      return <RegisterScreen onBackToLogin={() => setScreen('login')} />;
    case 'forgot':
      return <ForgotPasswordScreen onBackToLogin={() => setScreen('login')} />;
    default:
      return (
        <LoginScreen
          onCreateAccount={() => setScreen('register')}
          onForgotPassword={() => setScreen('forgot')}
        />
      );
  }
}

const App = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const deviceStatus = useAuthStore((s) => s.deviceStatus);
  const inkey = useAuthStore((s) => s.inkey);

  // Register this device for push while signed in; unregister on sign-out (using
  // the last-known key, since inkey is cleared by logout). No-op when Firebase
  // isn't configured.
  const lastInkey = useRef<string | null>(null);
  useEffect(() => {
    if (isAuthenticated && inkey) {
      lastInkey.current = inkey;
      registerForPush(inkey);
    } else if (!isAuthenticated && lastInkey.current) {
      unregisterForPush(lastInkey.current);
      lastInkey.current = null;
    }
  }, [isAuthenticated, inkey]);

  const lockEnabled = useAppLockStore((s) => s.enabled);
  const locked = useAppLockStore((s) => s.locked);
  const unlocking = useAppLockStore((s) => s.unlocking);
  const refreshLock = useAppLockStore((s) => s.refresh);
  const lock = useAppLockStore((s) => s.lock);

  // Idle session timeout (mirrors web): sign out after inactivity.
  useIdleLogout();

  // Load the app-lock preference once at startup.
  useEffect(() => {
    refreshLock();
  }, [refreshLock]);

  // Lock when the app leaves the foreground (only 'background', not the
  // transient 'inactive' the OS emits during the unlock prompt itself, which
  // would otherwise re-lock mid-unlock). Re-locking happens while backgrounded
  // so the LockScreen is already up when the user returns.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && lockEnabled && !unlocking) lock();
    });
    return () => sub.remove();
  }, [lockEnabled, unlocking, lock]);

  // When device-trust is on, an authenticated-but-unconfirmed device must clear
  // the confirmation flow before reaching the wallet.
  const needsDeviceConfirm =
    DEVICE_TRUST_ENABLED && isAuthenticated && deviceStatus !== 'trusted';

  const showLock = isAuthenticated && lockEnabled && locked;

  return (
    <SafeAreaProvider>
      {/* Passive activity tracker: every touch refreshes the idle timer without
          intercepting the gesture (capture handler returns false). */}
      <View
        style={styles.appRoot}
        onStartShouldSetResponderCapture={() => {
          touchActivity();
          return false;
        }}>
        {!isAuthenticated ? (
          <AuthNavigator />
        ) : showLock ? (
          <LockScreen />
        ) : needsDeviceConfirm ? (
          <DeviceConfirmScreen />
        ) : (
          <Shell />
        )}
        {/* Foreground push messages overlay everything except the lock screen
            (no point surfacing wallet activity while locked). */}
        {isAuthenticated && !showLock ? <PushBanner /> : null}
      </View>
    </SafeAreaProvider>
  );
};

const styles = StyleSheet.create({
  appRoot: {
    flex: 1,
  },
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingTop: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
});

export default App;
