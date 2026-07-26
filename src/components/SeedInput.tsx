import React, { useMemo, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { BIP39_WORDS } from '@/data/bip39-english';
import { colors } from '@/theme';

const WORDS = BIP39_WORDS as string[];
const WORDSET = new Set(WORDS);
const MAX_SUGGESTIONS = 8;

interface Props {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
}

/**
 * Recovery-phrase input with BIP-39 autocomplete. Suggests words for the token
 * currently being typed (tap to complete) and flags words not in the 2048-word
 * list. Advisory only — never blocks submission.
 */
export default function SeedInput({ value, onChangeText, placeholder }: Props) {
  // Masked by default; the user reveals it to check what they've entered.
  const [revealed, setRevealed] = useState(false);

  // The word being typed = the trailing token, unless a space already closed it.
  const endsMidWord = value.length > 0 && !/\s$/.test(value);
  const words = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const currentWord = endsMidWord ? words[words.length - 1] || '' : '';

  const suggestions = useMemo(() => {
    if (currentWord.length < 2) return [];
    const matches = WORDS.filter((w) => w.startsWith(currentWord)).slice(
      0,
      MAX_SUGGESTIONS,
    );
    // Already an exact, complete match — nothing to suggest.
    if (matches.length === 1 && matches[0] === currentWord) return [];
    return matches;
  }, [currentWord]);

  const invalid = useMemo(() => {
    const check = endsMidWord ? words.slice(0, -1) : words;
    return [...new Set(check.filter((w) => !WORDSET.has(w)))];
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (w: string) => {
    // Replace the trailing partial word with the chosen word + a space.
    const base = value.replace(/\S+$/, '');
    onChangeText(base + w + ' ');
  };

  return (
    <View>
      <View style={styles.toolbar}>
        <TouchableOpacity onPress={() => setRevealed((v) => !v)} hitSlop={8}>
          <Text style={styles.toggle}>{revealed ? '🙈 Hide' : '👁 Show'}</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#aaa"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        // secureTextEntry masks the words when hidden. It can't combine with
        // multiline, so we only wrap (multiline) while revealed.
        secureTextEntry={!revealed}
        multiline={revealed}
      />
      {suggestions.length ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          style={styles.sugRow}
          contentContainerStyle={styles.sugContent}>
          {suggestions.map((w) => (
            <TouchableOpacity key={w} style={styles.chip} onPress={() => apply(w)}>
              <Text style={styles.chipText}>{w}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
      {invalid.length ? (
        <Text style={styles.invalid}>
          Not in word list: {invalid.join(', ')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 6 },
  toggle: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#000',
    backgroundColor: '#fafafa',
    minHeight: 76,
    textAlignVertical: 'top',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  sugRow: { marginTop: 8 },
  sugContent: { paddingRight: 8 },
  chip: {
    backgroundColor: 'rgba(249,115,22,0.12)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginRight: 8,
  },
  chipText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  invalid: { color: '#c0392b', fontSize: 12, marginTop: 8 },
});
