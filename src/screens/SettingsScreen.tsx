import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@stores/authStore';
import { useSettingsStore } from '@stores/settingsStore';
import { colors } from '@/theme';

export default function SettingsScreen() {
  const username = useAuthStore((state) => state.username);
  const logout = useAuthStore((state) => state.logout);
  const dustThreshold = useSettingsStore((s) => s.dustThreshold);
  const setDustThreshold = useSettingsStore((s) => s.setDustThreshold);

  const [dustDraft, setDustDraft] = useState(String(dustThreshold));

  // Keep the field in sync once settings hydrate from storage.
  useEffect(() => {
    setDustDraft(String(dustThreshold));
  }, [dustThreshold]);

  const dirty = dustDraft.trim() !== String(dustThreshold);
  const saveDust = () => {
    const n = Number(dustDraft);
    setDustThreshold(Number.isFinite(n) && n >= 0 ? n : dustThreshold);
  };

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
              Coins at or below this are flagged as dust in Coin Control so you
              can freeze them.
            </Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={dustDraft}
                onChangeText={(t) => setDustDraft(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                placeholder="1000"
                placeholderTextColor="#aaa"
              />
              <TouchableOpacity
                style={[styles.saveBtn, !dirty && styles.saveDisabled]}
                onPress={saveDust}
                disabled={!dirty}>
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
            </View>
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
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { flex: 1, padding: 16 },
  section: { marginBottom: 20 },
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
  column: { backgroundColor: '#fff', borderRadius: 8, padding: 14 },
  itemLabel: { fontSize: 14, color: '#000', fontWeight: '500' },
  itemValue: {
    fontSize: 12,
    color: '#999',
    flex: 1,
    textAlign: 'right',
    marginLeft: 8,
  },
  help: { fontSize: 12, color: '#888', marginTop: 4, lineHeight: 17 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#000',
    backgroundColor: '#fafafa',
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
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  logoutText: { color: '#c0392b', fontSize: 15, fontWeight: '600' },
});
