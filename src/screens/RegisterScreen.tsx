import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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

interface Captcha {
  a: number;
  b: number;
  op: '+' | '×';
  answer: number;
}

function makeCaptcha(): Captcha {
  const a = Math.floor(Math.random() * 9) + 2;
  const b = Math.floor(Math.random() * 9) + 1;
  const op: '+' | '×' = Math.random() > 0.5 ? '+' : '×';
  return { a, b, op, answer: op === '+' ? a + b : a * b };
}

export default function RegisterScreen({ onBackToLogin }: Props) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [captcha, setCaptcha] = useState<Captcha>(makeCaptcha);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const newCaptcha = useCallback(() => {
    setCaptcha(makeCaptcha());
    setCaptchaAnswer('');
  }, []);

  const passwordsMatch = confirm.length > 0 && confirm === password;

  const canSubmit = useMemo(
    () =>
      username.trim().length >= 3 &&
      email.includes('@') &&
      password.length >= 8 &&
      password === confirm &&
      captchaAnswer.trim().length > 0 &&
      !loading,
    [username, email, password, confirm, captchaAnswer, loading],
  );

  const onSubmit = useCallback(async () => {
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (Number(captchaAnswer) !== captcha.answer) {
      setError('Captcha answer is incorrect. Try again.');
      newCaptcha();
      return;
    }
    setLoading(true);
    try {
      await api.startRegistration(username.trim(), password, email.trim());
      setSentTo(email.trim());
    } catch (e: any) {
      setError(e?.message || 'Registration failed.');
      newCaptcha();
    } finally {
      setLoading(false);
    }
  }, [username, email, password, confirm, captchaAnswer, captcha, newCaptcha]);

  // Verification email sent — replaces the form.
  if (sentTo) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.sentWrap}>
          <Text style={styles.sentIcon}>📧</Text>
          <Text style={styles.sentTitle}>Check your email</Text>
          <Text style={styles.sentSub}>We've sent a verification link to</Text>
          <Text style={styles.sentEmail}>{sentTo}</Text>
          <Text style={styles.sentHint}>
            Click the link in the email within 1 hour to activate your account.
            Don't forget to check your spam folder.
          </Text>
          <TouchableOpacity style={styles.ghostBtn} onPress={onBackToLogin}>
            <Text style={styles.ghostBtnText}>← Back to sign in</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled">
          <Image
            source={require('../assets/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Register for Thrilla</Text>

          <View style={styles.form}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              placeholder="satoshi"
              placeholderTextColor={colors.faint}
              maxLength={32}
            />

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
              placeholderTextColor={colors.faint}
            />

            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="password-new"
                placeholder="••••••••••••"
                placeholderTextColor={colors.faint}
              />
              <TouchableOpacity
                style={styles.reveal}
                onPress={() => setShowPassword((v) => !v)}>
                <Text style={styles.revealText}>{showPassword ? '🙈' : '👁'}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>Minimum 8 characters.</Text>

            <Text style={styles.label}>Confirm Password</Text>
            <TextInput
              style={[
                styles.input,
                confirm.length > 0 && !passwordsMatch && styles.inputError,
              ]}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="password-new"
              placeholder="••••••••••••"
              placeholderTextColor={colors.faint}
            />
            {confirm.length > 0 ? (
              passwordsMatch ? (
                <Text style={styles.matchOk}>✓ Passwords match.</Text>
              ) : (
                <Text style={styles.matchBad}>⚠ Passwords do not match.</Text>
              )
            ) : null}

            <Text style={styles.label}>Verification — solve to continue</Text>
            <View style={styles.captchaRow}>
              <Text style={styles.captchaQuestion}>
                {captcha.a} {captcha.op} {captcha.b} =
              </Text>
              <TextInput
                style={[styles.input, styles.captchaInput]}
                value={captchaAnswer}
                onChangeText={(t) => setCaptchaAnswer(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                placeholder="?"
                placeholderTextColor={colors.faint}
              />
              <TouchableOpacity style={styles.refresh} onPress={newCaptcha}>
                <Text style={styles.refreshText}>↻</Text>
              </TouchableOpacity>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.primaryBtn, !canSubmit && styles.btnDisabled]}
              onPress={onSubmit}
              disabled={!canSubmit}>
              {loading ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryBtnText}>Create Account</Text>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.footer} onPress={onBackToLogin}>
            <Text style={styles.footerText}>
              Already have an account? <Text style={styles.footerLink}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { padding: 24, paddingTop: 40 },
  logo: { width: 72, height: 72, alignSelf: 'center', marginBottom: 10 },
  title: { fontSize: 30, fontWeight: 'bold', color: PRIMARY, textAlign: 'center' },
  subtitle: { fontSize: 15, color: colors.muted, textAlign: 'center', marginBottom: 28 },
  form: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.label,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  inputError: { borderColor: colors.danger },
  passwordWrap: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 44 },
  reveal: { position: 'absolute', right: 8, padding: 8 },
  revealText: { fontSize: 16 },
  hint: { fontSize: 12, color: colors.faint, marginTop: 6 },
  matchOk: { fontSize: 12, color: PRIMARY, marginTop: 6 },
  matchBad: { fontSize: 12, color: colors.danger, marginTop: 6 },
  captchaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  captchaQuestion: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: 1,
  },
  captchaInput: { width: 72, textAlign: 'center' },
  refresh: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  refreshText: { fontSize: 16, color: colors.muted },
  error: { color: colors.danger, fontSize: 13, marginTop: 14 },
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
  footerText: { color: colors.muted, fontSize: 14 },
  footerLink: { color: PRIMARY, fontWeight: '600' },

  // Success state
  sentWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  sentIcon: { fontSize: 48, marginBottom: 12 },
  sentTitle: { fontSize: 22, fontWeight: 'bold', color: colors.text, marginBottom: 8 },
  sentSub: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  sentEmail: {
    fontSize: 14,
    color: PRIMARY,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 16,
    textAlign: 'center',
  },
  sentHint: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 19,
  },
  ghostBtn: {
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  ghostBtnText: { color: PRIMARY, fontSize: 15, fontWeight: '600' },
});
