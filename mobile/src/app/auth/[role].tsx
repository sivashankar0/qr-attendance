import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';

import { Banner, Body, Button, Card, Field, H1, IconName, Screen, Segmented } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { homeFor, LoginRole, useAuth } from '@/lib/auth';
import { colors, space } from '@/lib/theme';

const META: Record<LoginRole, { title: string; icon: IconName; idLabel: string; idPlaceholder: string; canSignUp: boolean }> = {
  student: { title: 'Student', icon: 'school-outline', idLabel: 'Roll number / college ID', idPlaceholder: 'e.g. 26CS001', canSignUp: true },
  teacher: { title: 'Teacher', icon: 'easel-outline', idLabel: 'Employee ID', idPlaceholder: 'e.g. T1001', canSignUp: true },
  admin: { title: 'Admin / Staff', icon: 'shield-checkmark-outline', idLabel: 'Staff ID', idPlaceholder: 'e.g. ADMIN01', canSignUp: false },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RoleAuth() {
  const { role: raw } = useLocalSearchParams<{ role: string }>();
  const role: LoginRole = raw === 'teacher' || raw === 'admin' ? raw : 'student';
  const meta = META[role];
  const { user, login } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  if (user) return <Redirect href={homeFor(user.role)} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: meta.title }} />
      <Screen>
        <View style={{ alignItems: 'center', gap: space.sm, marginTop: space.md }}>
          <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={meta.icon} size={32} color={colors.primary} />
          </View>
          <H1>{mode === 'login' ? `${meta.title} sign in` : `${meta.title} sign up`}</H1>
        </View>
        {meta.canSignUp ? (
          <Segmented
            options={[
              { key: 'login', label: 'Sign in' },
              { key: 'signup', label: 'Sign up' },
            ]}
            value={mode}
            onChange={setMode}
          />
        ) : null}
        {mode === 'login' ? (
          <LoginForm role={role} meta={meta} onLogin={login} />
        ) : (
          <SignUpForm role={role as 'student' | 'teacher'} meta={meta} onDone={() => setMode('login')} />
        )}
        {!meta.canSignUp ? (
          <Body muted style={{ textAlign: 'center', fontSize: 14 }}>
            Admin and staff accounts are created by the college. Contact your administrator.
          </Body>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function LoginForm({
  role,
  meta,
  onLogin,
}: {
  role: LoginRole;
  meta: (typeof META)[LoginRole];
  onLogin: (u: string, p: string, r: LoginRole) => Promise<{ role: any }>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ username?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const e: typeof errors = {};
    if (!username.trim()) e.username = `Enter your ${meta.idLabel.toLowerCase()} or email.`;
    if (!password) e.password = 'Enter your password.';
    setErrors(e);
    if (e.username || e.password) return;
    setBusy(true);
    try {
      const u = await onLogin(username.trim(), password, role);
      setPassword('');
      router.replace(homeFor(u.role));
    } catch (err) {
      setErrors({
        form:
          err instanceof ApiError && err.status === 401
            ? `Incorrect ID or password for a ${meta.title} account. After 5 failed tries the account is locked for 15 minutes.`
            : err instanceof ApiError
              ? err.message
              : 'Sign in failed. Try again.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Field
        label={`${meta.idLabel} or email`}
        icon="person-outline"
        placeholder={meta.idPlaceholder}
        value={username}
        onChangeText={(t) => {
          setUsername(t);
          setErrors((x) => ({ ...x, username: undefined, form: undefined }));
        }}
        error={errors.username}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        returnKeyType="next"
      />
      <Field
        label="Password"
        icon="lock-closed-outline"
        value={password}
        onChangeText={(t) => {
          setPassword(t);
          setErrors((x) => ({ ...x, password: undefined, form: undefined }));
        }}
        error={errors.password}
        secureToggle
        autoComplete="password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {errors.form ? <Banner kind="danger" title={errors.form} /> : null}
      <Button title="Sign in" icon="log-in-outline" onPress={submit} loading={busy} />
      <Pressable
        onPress={() => router.push({ pathname: '/auth/forgot', params: { role } })}
        accessibilityRole="link"
        style={{ alignSelf: 'center', padding: space.sm }}
      >
        <Text style={{ color: colors.primary, fontWeight: '700' }}>Forgot password?</Text>
      </Pressable>
    </Card>
  );
}

function SignUpForm({
  role,
  meta,
  onDone,
}: {
  role: 'student' | 'teacher';
  meta: (typeof META)[LoginRole];
  onDone: () => void;
}) {
  const [form, setForm] = useState({ college_id: '', full_name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined, form: undefined }));
  };

  const submit = async () => {
    const e: Record<string, string> = {};
    if (form.college_id.trim().length < 2) e.college_id = `Enter your ${meta.idLabel.toLowerCase()}.`;
    if (form.full_name.trim().length < 2) e.full_name = 'Enter your full name.';
    if (!EMAIL_RE.test(form.email.trim())) e.email = 'Enter a valid email address.';
    if (form.password.length < 10) e.password = 'Use at least 10 characters.';
    if (form.confirm !== form.password) e.confirm = 'Passwords do not match.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await api<{ message: string }>('/auth/register', {
        body: { role, college_id: form.college_id.trim(), full_name: form.full_name.trim(), email: form.email.trim(), password: form.password },
      });
      setDone(r.message);
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? err.message : 'Sign up failed. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Card>
        <Banner kind="success" title="Sign-up submitted">
          <Body>{done}</Body>
        </Banner>
        <Body muted>
          {role === 'student'
            ? 'After approval, bring your college ID card to the office so your identity can be verified before face enrollment.'
            : 'After approval, the administrator will assign your classes.'}
        </Body>
        <Button title="Back to sign in" icon="log-in-outline" onPress={onDone} />
      </Card>
    );
  }

  return (
    <Card>
      <Field label={meta.idLabel} icon="id-card-outline" placeholder={meta.idPlaceholder} value={form.college_id} onChangeText={set('college_id')} error={errors.college_id} autoCapitalize="characters" autoCorrect={false} />
      <Field label="Full name" icon="person-outline" value={form.full_name} onChangeText={set('full_name')} error={errors.full_name} autoComplete="name" />
      <Field label="College email" icon="mail-outline" value={form.email} onChangeText={set('email')} error={errors.email} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label="Password" icon="lock-closed-outline" value={form.password} onChangeText={set('password')} error={errors.password} secureToggle hint="At least 10 characters" autoComplete="new-password" />
      <Field label="Confirm password" icon="lock-closed-outline" value={form.confirm} onChangeText={set('confirm')} error={errors.confirm} secureToggle autoComplete="new-password" />
      {errors.form ? <Banner kind="danger" title={errors.form} /> : null}
      <Banner kind="info" title="Admin approval required">
        <Body>For security, new accounts can sign in only after the college approves them.</Body>
      </Banner>
      <Button title="Create account" icon="person-add-outline" onPress={submit} loading={busy} />
    </Card>
  );
}
