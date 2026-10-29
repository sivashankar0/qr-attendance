import { router } from 'expo-router';
import { ReactNode, useState } from 'react';
import { Text, View } from 'react-native';

import { api, ApiError, User } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, roleLabel, space } from '@/lib/theme';

import { Avatar, Body, Button, Card, Collapsible, ErrorText, Field, H1 } from './ui';

export function ProfileHeader({ user, extra }: { user: User | null; extra?: ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: space.xl }}>
      <Avatar name={user?.full_name} size={84} />
      <H1>{user?.full_name}</H1>
      <Text style={{ color: colors.primary, fontWeight: '700' }}>{roleLabel[user?.role ?? ''] ?? user?.role}</Text>
      <Body muted>
        {user?.college_id} · {user?.email}
      </Body>
      {extra}
    </Card>
  );
}

export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: 6 }}>
      <Body muted>{label}</Body>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Body style={{ fontWeight: '700', flexShrink: 1, textAlign: 'right' }}>{value}</Body>
      ) : (
        value
      )}
    </View>
  );
}

/** Collapsible settings shared by every role: password, privacy notice, sign out. */
export function SettingsSection() {
  const { logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = async () => {
    setErr(null);
    setMsg(null);
    if (next.length < 10) return setErr('New password must be at least 10 characters.');
    if (next !== confirm) return setErr('The new passwords do not match.');
    setBusy(true);
    try {
      await api('/auth/change-password', { body: { current_password: current, new_password: next } });
      setCurrent('');
      setNext('');
      setConfirm('');
      setMsg('Password changed. Other devices have been signed out.');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not change password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <Collapsible title="Password & security" icon="lock-closed-outline">
        <Field label="Current password" icon="key-outline" value={current} onChangeText={setCurrent} secureToggle />
        <Field label="New password" icon="lock-closed-outline" value={next} onChangeText={setNext} secureToggle hint="At least 10 characters" />
        <Field label="Confirm new password" icon="lock-closed-outline" value={confirm} onChangeText={setConfirm} secureToggle />
        <ErrorText error={err} />
        {msg ? <Body style={{ color: colors.success }}>{msg}</Body> : null}
        <Button title="Update password" icon="save-outline" onPress={change} loading={busy} />
      </Collapsible>
      <Collapsible title="Privacy" icon="shield-outline">
        <Body muted>How face data and location are used, stored and deleted.</Body>
        <Button title="Read the privacy notice" variant="secondary" icon="document-text-outline" onPress={() => router.push('/settings')} />
      </Collapsible>
      <Button
        title="Sign out"
        variant="danger"
        icon="log-out-outline"
        onPress={async () => {
          await logout();
          router.replace('/welcome');
        }}
      />
    </View>
  );
}
