import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { Body, Button, Card, ErrorText, Field, H1, Screen } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';
import { space } from '@/lib/theme';

export default function Login() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Redirect href={homeFor(user.role)} />;

  const submit = async () => {
    if (!username.trim() || !password) {
      setError('Enter your college ID and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const u = await login(username.trim(), password);
      setPassword('');
      router.replace(homeFor(u.role));
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401
          ? 'College ID or password is incorrect. After 5 failed tries the account is locked for 15 minutes.'
          : e instanceof ApiError
            ? e.message
            : 'Login failed. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ height: space.xxl * 2 }} />
        <H1>QR Attendance</H1>
        <Body muted>Sign in with your college ID or email.</Body>
        <Card>
          <Field
            label="College ID or email"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          <ErrorText error={error} />
          <Button title="Sign in" onPress={submit} loading={busy} />
        </Card>
        <Body muted style={{ fontSize: 14 }}>
          Forgot your password? Contact the college office; an administrator can reset it.
        </Body>
      </Screen>
    </KeyboardAvoidingView>
  );
}
