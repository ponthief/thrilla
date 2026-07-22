import React, { useState } from 'react';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import WalletScreen from './screens/WalletScreen';
import SendScreen from './screens/SendScreen';
import ReceiveScreen from './screens/ReceiveScreen';
import SettingsScreen from './screens/SettingsScreen';
import LoginScreen from './screens/LoginScreen';
import { useAuthStore } from '@stores/authStore';
import { colors } from '@/theme';

type TabKey = 'wallet' | 'send' | 'receive' | 'settings';

const TABS: { key: TabKey; label: string; icon: string; Screen: React.ComponentType }[] = [
  { key: 'wallet', label: 'Wallet', icon: '₿', Screen: WalletScreen },
  { key: 'send', label: 'Send', icon: '↑', Screen: SendScreen },
  { key: 'receive', label: 'Receive', icon: '↓', Screen: ReceiveScreen },
  { key: 'settings', label: 'Settings', icon: '⚙', Screen: SettingsScreen },
];

const PRIMARY = colors.primary;
const INACTIVE = '#8e8e93';

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
      <StatusBar barStyle="light-content" backgroundColor={PRIMARY} />
      <View style={styles.content}>
        <ActiveScreen />
      </View>
      <TabBar active={active} onSelect={setActive} />
    </View>
  );
}

const App = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return (
    <SafeAreaProvider>
      {isAuthenticated ? <Shell /> : <LoginScreen />}
    </SafeAreaProvider>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#d1d1d6',
    backgroundColor: '#ffffff',
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
