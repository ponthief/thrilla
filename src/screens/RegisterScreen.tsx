import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
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
import { useAuthStore } from '@stores/authStore';
import { useVerifyStore } from '@stores/verifyStore';
import { colors } from '@/theme';

const PRIMARY = colors.primary;

// Matches REGISTRATION_CODE_DIGITS on the server.
const CODE_LENGTH = 6;

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

  const [finishing, setFinishing] = useState(false);
  const [notYet, setNotYet] = useState(false);
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const newCaptcha = useCallback(() => {
    setCaptcha(makeCaptcha());
    setCaptchaAnswer('');
  }, []);

  // What was just registered, so returning from the email can finish the job.
  //
  // Verification happens somewhere else entirely — a mail app, then a browser,
  // where the link activates the account and tells the user to "sign in". Left
  // alone, they come back and type the password they typed sixty seconds ago,
  // which is now the ONLY password prompt in the app's life (the session is
  // kept after this) and a silly one to make them face.
  //
  // Held in a ref, in memory, never written anywhere. If the OS kills the app
  // while they are in the browser this is simply gone and they land on the
  // login form as before — the honest fallback. Persisting a password to close
  // that gap would trade the whole point of the change for a little polish.
  const pending = useRef<{ username: string; password: string } | null>(null);

  // Dropped explicitly on the way out rather than left to the garbage
  // collector, so the window in which this exists is the one the screen is
  // visible for and nothing longer.
  useEffect(
    () => () => {
      pending.current = null;
    },
    [],
  );

  const login = useAuthStore((s) => s.login);

  const finishRegistration = useCallback(async () => {
    const creds = pending.current;
    if (!creds || finishing) return;
    setFinishing(true);
    setNotYet(false);
    // A failure here is the ordinary case, not an error: it means the link has
    // not been clicked yet, so the account does not exist. Say so in those
    // terms rather than showing a sign-in failure for something the user has
    // not done wrong.
    const ok = await login(creds.username, creds.password);
    if (ok) {
      // App.tsx swaps to the lock-setup screen the moment this resolves; there
      // is nothing left for this screen to do.
      pending.current = null;
      return;
    }
    // login() parks its message in the store's error field, which the login
    // screen renders. Clear it so backing out of here does not show "invalid
    // username or password" for an account that is merely unverified.
    useAuthStore.setState({ error: null });
    setNotYet(true);
    setFinishing(false);
  }, [finishing, login]);

  // Returning to the foreground is the signal. The user left to open a link and
  // came back, which is exactly when the account has just become real — better
  // than polling, which would keep asking while they are still reading email.
  //
  // Still the path for a link opened in a browser, which is every case where
  // the App Link is not verified for the device (see hooks/useVerifyLink).
  useEffect(() => {
    if (!sentTo) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') finishRegistration();
    });
    return () => sub.remove();
  }, [sentTo, finishRegistration]);

  // The App Link path: the link opened the app, useVerifyLink redeemed the
  // token, and this screen is still holding the password. Nothing for the user
  // to press, and no round trip through a browser.
  const verifyStatus = useVerifyStore((s) => s.status);
  useEffect(() => {
    if (sentTo && verifyStatus === 'done') finishRegistration();
  }, [sentTo, verifyStatus, finishRegistration]);

  // The code path, which is the one that works with the web app closed.
  //
  // Redeeming the code CREATES the account, so a success here is followed
  // immediately by the sign-in that the password in `pending` makes possible —
  // the user typed six digits and lands in the wallet.
  const submitCode = useCallback(async () => {
    if (!sentTo || code.length !== CODE_LENGTH || confirming) return;
    setConfirming(true);
    setCodeError(null);
    try {
      await api.confirmRegistration(sentTo, code);
    } catch (e: any) {
      // The server answers every rejection identically on purpose — a wrong
      // code and an expired one are one message — so this is passed through
      // rather than interpreted.
      setCodeError(e?.message || 'That code could not be verified.');
      setConfirming(false);
      return;
    }
    // The account now exists. finishRegistration owns the sign-in and clears
    // the held credentials; leave `confirming` set so the button stays busy
    // through the handover rather than flickering back to idle.
    await finishRegistration();
    setConfirming(false);
  }, [sentTo, code, confirming, finishRegistration]);

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
      // Remembered only in memory, and only now that the server has accepted
      // the registration — see the `pending` ref.
      pending.current = { username: username.trim(), password };
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
        {/* Wrapped now that this screen has an input: on a short screen the
            number pad would otherwise sit over the Verify button. */}
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.sentWrap}
          keyboardShouldPersistTaps="handled">
          <Text style={styles.sentIcon}>📧</Text>
          <Text style={styles.sentTitle}>Check your email</Text>
          <Text style={styles.sentSub}>We've sent a 6-digit code to</Text>
          <Text style={styles.sentEmail}>{sentTo}</Text>
          <Text style={styles.sentHint}>
            Enter it below within 1 hour to activate your account. Don't forget
            to check your spam folder.
          </Text>

          {/* The code, not the link, is what this screen asks for: it needs
              nothing but the API, so it works on a deployment whose web app is
              closed to the outside. The same email still carries a link for
              anyone who registered in a browser, and opening it does the same
              job — the effects below pick that up too. */}
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={code}
            onChangeText={(v) => {
              setCodeError(null);
              // Digits only, so a pasted "code: 123456" or a stray space does
              // not fail a code the user copied correctly.
              setCode(v.replace(/\D/g, '').slice(0, CODE_LENGTH));
            }}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            placeholder="123456"
            placeholderTextColor={colors.faint}
            maxLength={CODE_LENGTH}
            editable={!confirming && !finishing}
          />

          {codeError ? <Text style={styles.error}>{codeError}</Text> : null}

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              (code.length !== CODE_LENGTH || confirming || finishing) &&
                styles.btnDisabled,
            ]}
            onPress={submitCode}
            disabled={code.length !== CODE_LENGTH || confirming || finishing}>
            {confirming || finishing ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.primaryBtnText}>Verify and sign in</Text>
            )}
          </TouchableOpacity>

          {/* Only mentioned once the user has been given a reason to wonder:
              the link path is a fallback, and leading with it on a deployment
              where it cannot open would be actively misleading. */}
          {notYet ? (
            <Text style={styles.sentHint}>
              Opened the link in the email instead? Come back to this screen and
              you'll be signed in automatically.
            </Text>
          ) : null}

          <TouchableOpacity style={styles.ghostBtn} onPress={onBackToLogin}>
            <Text style={styles.ghostBtnText}>← Back to sign in</Text>
          </TouchableOpacity>
        </ScrollView>
        </KeyboardAvoidingView>
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
  // Wide-tracked and centred: six digits read as a code rather than as text,
  // and it is the one field on this screen.
  codeInput: {
    marginTop: 20,
    alignSelf: 'stretch',
    textAlign: 'center',
    fontSize: 28,
    letterSpacing: 8,
    paddingVertical: 12,
    fontFamily: 'monospace',
  },
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
    alignSelf: 'stretch',
  },
  primaryBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  footer: { marginTop: 24, alignItems: 'center' },
  footerText: { color: colors.muted, fontSize: 14 },
  footerLink: { color: PRIMARY, fontWeight: '600' },

  // Success state
  sentWrap: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
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
