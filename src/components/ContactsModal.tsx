import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as api from '@services/api';
import { colors } from '@/theme';

const PRIMARY = colors.primary;

function truncMid(s: string, head = 12, tail = 8): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

interface Props {
  visible: boolean;
  contacts: api.SpContact[];
  onClose: () => void;
  onPick: (value: string) => void;
  onDelete: (id: string) => void;
}

export default function ContactsModal({
  visible,
  contacts,
  onClose,
  onPick,
  onDelete,
}: Props) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title}>Contacts</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text style={styles.close}>Done</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {contacts.length === 0 ? (
            <Text style={styles.empty}>
              No saved contacts yet. Enter a recipient on the Send screen and tap
              “Save contact”.
            </Text>
          ) : (
            contacts.map((c) => (
              <View key={c.id} style={styles.row}>
                <View style={styles.info}>
                  <Text style={styles.label} numberOfLines={1}>
                    {c.label || c.value}
                    {c.kind === 'bitmail' ? '  ✉' : ''}
                  </Text>
                  <Text style={styles.value} numberOfLines={1}>
                    {truncMid(c.value)}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.useBtn}
                  onPress={() => {
                    onPick(c.value);
                    onClose();
                  }}>
                  <Text style={styles.useText}>Use</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => onDelete(c.id)}>
                  <Text style={styles.removeText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 22, fontWeight: 'bold', color: '#000' },
  close: { fontSize: 16, fontWeight: '600', color: PRIMARY },
  content: { padding: 16, paddingTop: 4 },
  empty: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 24, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  info: { flex: 1, marginRight: 10 },
  label: { fontSize: 15, fontWeight: '600', color: '#000' },
  value: { fontSize: 12, color: '#999', fontFamily: 'monospace', marginTop: 2 },
  useBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  useText: { color: colors.onPrimary, fontSize: 13, fontWeight: '600' },
  removeBtn: { paddingHorizontal: 6, paddingVertical: 8 },
  removeText: { color: '#c0392b', fontSize: 13, fontWeight: '600' },
});
