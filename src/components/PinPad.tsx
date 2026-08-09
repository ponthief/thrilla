import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '@/theme';

// A controlled numeric PIN pad: shows `length` dots for progress and a keypad.
// The parent owns the value and reacts (e.g. auto-submits) when it fills.
interface Props {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  disabled?: boolean;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export default function PinPad({ value, onChange, length = 6, disabled }: Props) {
  const press = (k: string) => {
    if (disabled) return;
    if (k === '⌫') {
      onChange(value.slice(0, -1));
    } else if (k !== '' && value.length < length) {
      onChange(value + k);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.dots}>
        {Array.from({ length }).map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i < value.length && styles.dotFilled]}
          />
        ))}
      </View>

      <View style={styles.pad}>
        {KEYS.map((k, i) =>
          k === '' ? (
            <View key={i} style={styles.key} />
          ) : (
            <TouchableOpacity
              key={i}
              style={styles.key}
              onPress={() => press(k)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={k === '⌫' ? 'Delete' : k}>
              <Text style={styles.keyText}>{k}</Text>
            </TouchableOpacity>
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  dots: { flexDirection: 'row', marginBottom: 28 },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginHorizontal: 8,
    borderWidth: 1.5,
    borderColor: colors.muted,
  },
  dotFilled: { backgroundColor: colors.primary, borderColor: colors.primary },
  pad: { width: 260, flexDirection: 'row', flexWrap: 'wrap' },
  key: {
    width: 260 / 3,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: { fontSize: 26, color: colors.text, fontWeight: '500' },
});
