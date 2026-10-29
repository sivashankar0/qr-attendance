import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Body, Button, Card, ErrorText, Field, H2, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { space } from '@/lib/theme';

interface Notice {
  version: string;
  title: string;
  sections: { heading: string; body: string }[];
}

export default function Settings() {
  const { user, logout } = useAuth();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Notice>('/face/consent-notice').then(setNotice).catch(() => {});
  }, []);

  const changePassword = async () => {
    setErr(null);
    setMsg(null);
    if (next.length < 10) return setErr('New password must be at least 10 characters.');
    setBusy(true);
    try {
      await api('/auth/change-password', { body: { current_password: current, new_password: next } });
      setCurrent('');
      setNext('');
      setMsg('Password changed. Other devices have been signed out.');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not change password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <H2>Account</H2>
        <Body>{user?.full_name}</Body>
        <Body muted>
          {user?.college_id} · {user?.role.replace('_', ' ')}
        </Body>
        <Button
          title="Sign out"
          variant="secondary"
          onPress={async () => {
            await logout();
            router.replace('/welcome');
          }}
        />
      </Card>

      <Card>
        <H2>Change password</H2>
        <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry />
        <Field label="New password (min 10 characters)" value={next} onChangeText={setNext} secureTextEntry />
        <ErrorText error={err} />
        {msg ? <Body style={{ color: 'green' }}>{msg}</Body> : null}
        <Button title="Update password" onPress={changePassword} loading={busy} />
      </Card>

      {notice ? (
        <Card>
          <H2>Privacy notice (face verification)</H2>
          <Body muted>Version {notice.version}</Body>
          {notice.sections.map((s) => (
            <View key={s.heading} style={{ gap: space.xs }}>
              <Text style={{ fontWeight: '700', fontSize: 15 }}>{s.heading}</Text>
              <Body>{s.body}</Body>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
