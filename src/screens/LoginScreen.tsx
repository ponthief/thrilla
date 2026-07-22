import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@stores/authStore';
import { colors } from '@/theme';

const PRIMARY = colors.primary;

interface Props {
  onCreateAccount: () => void;
  onForgotPassword: () => void;
}

export default function LoginScreen({ onCreateAccount, onForgotPassword }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);

  const canSubmit = username.trim().length > 0 && password.length > 0 && !loading;

  const onSubmit = () => {
    if (!canSubmit) return;
    login(username.trim(), password);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          <Text style={styles.title}>Thrilla</Text>
          <Text style={styles.subtitle}>Silent Payments Wallet</Text>

          <View style={styles.form}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              placeholder="username"
              placeholderTextColor="#aaa"
              returnKeyType="next"
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              placeholder="password"
              placeholderTextColor="#aaa"
              returnKeyType="go"
              onSubmitEditing={onSubmit}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.button, !canSubmit && styles.buttonDisabled]}
              onPress={onSubmit}
              disabled={!canSubmit}>
              {loading ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.buttonText}>Log In</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.forgotLink}
              onPress={onForgotPassword}
              disabled={loading}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.footer}
            onPress={onCreateAccount}
            disabled={loading}>
            <Text style={styles.footerText}>
              Don't have an account? <Text style={styles.footerLink}>Create account</Text>
            </Text>
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
  title: {
    fontSize: 34,
    fontWeight: 'bold',
    color: PRIMARY,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
  },
  form: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#444',
    marginBottom: 6,
    marginTop: 12,
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
  error: {
    color: '#c0392b',
    fontSize: 13,
    marginTop: 14,
  },
  button: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 22,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
  forgotLink: { marginTop: 16, alignItems: 'center' },
  forgotText: { color: PRIMARY, fontSize: 14, fontWeight: '600' },
  footer: { marginTop: 24, alignItems: 'center' },
  footerText: { color: '#666', fontSize: 14 },
  footerLink: { color: PRIMARY, fontWeight: '600' },
});
