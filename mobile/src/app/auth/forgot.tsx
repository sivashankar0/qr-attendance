import { router } from 'expo-router';
import { useState } from 'react';

import { Banner, Body, Button, Card, Field, H1, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

export default function ForgotPassword() {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!username.trim()) return setError('Enter your college ID or email.');
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ message: string }>('/auth/forgot-password', { body: { username: username.trim() } });
      setDone(r.message);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <H1>Reset your password</H1>
      <Body muted>
        For security, passwords are reset by the college administrator, not by email. Send a request and the office will
        give you a new password.
      </Body>
      {done ? (
        <Card>
          <Banner kind="success" title="Request sent">
            <Body>{done}</Body>
          </Banner>
          <Button title="Back to sign in" icon="arrow-back" onPress={() => router.back()} />
        </Card>
      ) : (
        <Card>
          <Field
            label="College ID or email"
            icon="person-outline"
            value={username}
            onChangeText={(t) => {
              setUsername(t);
              setError(null);
            }}
            error={error}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <Button title="Request password reset" icon="paper-plane-outline" onPress={submit} loading={busy} />
          <Button title="Back to sign in" variant="ghost" onPress={() => router.back()} />
        </Card>
      )}
    </Screen>
  );
}
