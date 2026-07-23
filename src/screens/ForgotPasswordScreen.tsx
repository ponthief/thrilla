import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as api from '@services/api';
import { colors } from '@/theme';

const PRIMARY = colors.primary;

interface Props {
  onBackToLogin: () => void;
}

export default function ForgotPasswordScreen({ onBackToLogin }: Props) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const canSubmit = email.includes('@') && !loading;

  const onSubmit = useCallback(async () => {
    setError(null);
    setSent(false);
    setLoading(true);
    try {
      await api.requestPasswordReset(email.trim());
      setSent(true);
    } catch (e: any) {
      const msg = (e?.message || '').toLowerCase();
      if (msg.includes('smtp')) {
        setError(
          'Email reset is not available on this server. Contact your administrator to reset your password.',
        );
      } else {
        // Don't leak whether the email exists — show the generic sent message.
        setSent(true);
      }
    } finally {
      setLoading(false);
    }
  }, [email]);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          <Image
            source={require('../assets/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>Forgot Password</Text>
          <Text style={styles.subtitle}>Reset your password via email</Text>

          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor="#aaa"
              returnKeyType="go"
              onSubmitEditing={() => canSubmit && onSubmit()}
            />
            <Text style={styles.hint}>
              We'll email a reset link to this address if it's registered. The
              link expires after a short time.
            </Text>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {sent ? (
              <Text style={styles.success}>
                ✓ If {email.trim()} is registered, a reset link is on its way.
                Check your inbox.
              </Text>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryBtn, !canSubmit && styles.btnDisabled]}
              onPress={onSubmit}
              disabled={!canSubmit}>
              {loading ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryBtnText}>Send Reset Link</Text>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.footer} onPress={onBackToLogin}>
            <Text style={styles.footerLink}>← Back to sign in</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  flex: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', padding: 24 },
  logo: { width: 72, height: 72, alignSelf: 'center', marginBottom: 10 },
  title: { fontSize: 30, fontWeight: 'bold', color: PRIMARY, textAlign: 'center' },
  subtitle: { fontSize: 15, color: '#666', textAlign: 'center', marginBottom: 28 },
  form: { backgroundColor: '#fff', borderRadius: 12, padding: 20 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#444',
    marginBottom: 6,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#000',
    backgroundColor: '#fafafa',
  },
  hint: { fontSize: 12, color: '#999', marginTop: 8 },
  error: { color: '#c0392b', fontSize: 13, marginTop: 14 },
  success: { color: colors.green, fontSize: 13, marginTop: 14, lineHeight: 18 },
  primaryBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 22,
  },
  primaryBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  footer: { marginTop: 24, alignItems: 'center' },
  footerLink: { color: PRIMARY, fontSize: 14, fontWeight: '600' },
});
