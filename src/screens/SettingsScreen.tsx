import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWalletStore } from '@stores/walletStore';
import { useAuthStore } from '@stores/authStore';

export default function SettingsScreen() {
  const network = useWalletStore((state) => state.network);
  const lnbitsUrl = useWalletStore((state) => state.lnbitsUrl);
  const username = useAuthStore((state) => state.username);
  const logout = useAuthStore((state) => state.logout);

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
          <Text style={styles.sectionTitle}>Wallet</Text>
          <View style={styles.item}>
            <Text style={styles.itemLabel}>Network</Text>
            <Text style={styles.itemValue}>{network.toUpperCase()}</Text>
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>API</Text>
          <View style={styles.item}>
            <Text style={styles.itemLabel}>LNbits URL</Text>
            <Text style={styles.itemValue}>{lnbitsUrl || 'Not configured'}</Text>
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.item}>
            <Text style={styles.itemLabel}>Version</Text>
            <Text style={styles.itemValue}>0.1.0</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.logout} onPress={logout}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  item: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemLabel: {
    fontSize: 14,
    color: '#000',
    fontWeight: '500',
  },
  itemValue: {
    fontSize: 12,
    color: '#999',
    flex: 1,
    textAlign: 'right',
    marginLeft: 8,
  },
  logout: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  logoutText: {
    color: '#c0392b',
    fontSize: 15,
    fontWeight: '600',
  },
});
