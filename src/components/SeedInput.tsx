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
import Clipboard from '@react-native-clipboard/clipboard';
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

  // Explicit paste: long-press-to-paste is unreliable while the field is masked
  // (transparent text + hidden caret), so give a button. Collapses any newlines/
  // extra spaces from the pasted phrase into single spaces.
  const onPaste = async () => {
    try {
      const txt = await Clipboard.getString();
      if (txt) onChangeText(txt.replace(/\s+/g, ' ').trim());
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  return (
    <View>
      <View style={styles.toolbar}>
        <TouchableOpacity onPress={onPaste} hitSlop={8}>
          <Text style={styles.toggle}>📋 Paste</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setRevealed((v) => !v)} hitSlop={8}>
          <Text style={styles.toggle}>{revealed ? '🙈 Hide' : '👁 Show'}</Text>
        </TouchableOpacity>
      </View>
      {/* Always multiline (words wrap in both states). secureTextEntry can't
          combine with multiline, so we mask manually: the real text is made
          transparent when hidden and a dot overlay is drawn on top. */}
      <View>
        <TextInput
          style={[styles.input, !revealed && styles.inputHidden]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          caretHidden={!revealed}
          multiline
        />
        {!revealed && value.length > 0 ? (
          <View style={styles.maskWrap} pointerEvents="none">
            <Text style={styles.mask}>{value.replace(/\S/g, '•')}</Text>
          </View>
        ) : null}
      </View>
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
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  toggle: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    minHeight: 76,
    textAlignVertical: 'top',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  inputHidden: { color: 'transparent' },
  // Dot overlay aligned to the input's text box (matches padding). Monospace
  // makes '•' the same width as every letter, so wrapping is identical.
  maskWrap: { position: 'absolute', top: 10, left: 12, right: 12, bottom: 10 },
  mask: {
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    includeFontPadding: false,
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
  invalid: { color: colors.danger, fontSize: 12, marginTop: 8 },
});
