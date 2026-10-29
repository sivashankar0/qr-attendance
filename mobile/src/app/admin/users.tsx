import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { Badge, Body, Button, Card, Chip, ErrorText, Field, H2, ListItem, Row, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, space } from '@/lib/theme';

interface AdminUser {
  id: string;
  role: string;
  college_id: string;
  full_name: string;
  email: string;
  identity_verified: boolean;
  is_active: boolean;
}

const ROLES = ['student', 'teacher', 'admin', 'biometric_officer'];

export default function Users() {
  const { user: me } = useAuth();
  const isAdmin = me?.role === 'admin';
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState('');
  const [role, setRole] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [mode, setMode] = useState<'list' | 'create' | 'import'>('list');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (role) params.set('role', role);
    try {
      setUsers(await api<AdminUser[]>(`/admin/users?${params.toString()}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load users.');
    }
  }, [q, role]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  if (mode === 'create') return <CreateUser onDone={() => { setMode('list'); load(); }} />;
  if (mode === 'import') return <ImportUsers onDone={() => { setMode('list'); load(); }} />;
  if (selected) return <EditUser user={selected} isAdmin={isAdmin} onDone={() => { setSelected(null); load(); }} />;

  return (
    <Screen>
      {isAdmin ? (
        <Row>
          <View style={{ flex: 1 }}>
            <Button title="New user" onPress={() => setMode('create')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Import CSV" variant="secondary" onPress={() => setMode('import')} />
          </View>
        </Row>
      ) : null}
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Name, college ID or email" autoCapitalize="none" />
      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label="All" selected={!role} onPress={() => setRole(null)} />
        {ROLES.map((r) => (
          <Chip key={r} label={r.replace('_', ' ')} selected={role === r} onPress={() => setRole(r)} />
        ))}
      </Row>
      <ErrorText error={error} />
      <Card>
        {users.length === 0 ? <Body muted>No users found.</Body> : null}
        {users.map((u) => (
          <ListItem
            key={u.id}
            title={`${u.college_id}  ${u.full_name}`}
            subtitle={`${u.role.replace('_', ' ')} · ${u.email}${u.identity_verified ? ' · ID verified' : ''}`}
            right={!u.is_active ? <Badge status="rejected" label="Inactive" /> : null}
            onPress={isAdmin ? () => setSelected(u) : undefined}
          />
        ))}
      </Card>
    </Screen>
  );
}

function CreateUser({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ role: 'student', college_id: '', full_name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/admin/users', { body: form });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create user.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <H2>New user</H2>
      <Row style={{ flexWrap: 'wrap' }}>
        {ROLES.map((r) => (
          <Chip key={r} label={r.replace('_', ' ')} selected={form.role === r} onPress={() => set('role')(r)} />
        ))}
      </Row>
      <Field label="College ID / roll no." value={form.college_id} onChangeText={set('college_id')} autoCapitalize="characters" />
      <Field label="Full name" value={form.full_name} onChangeText={set('full_name')} />
      <Field label="Email" value={form.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" />
      <Field label="Initial password (min 10)" value={form.password} onChangeText={set('password')} secureTextEntry />
      <ErrorText error={error} />
      <Button title="Create" onPress={submit} loading={busy} />
      <Button title="Cancel" variant="ghost" onPress={onDone} />
    </Screen>
  );
}

function ImportUsers({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('role,college_id,full_name,email,password\n');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; errors: { line: number; error: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api('/admin/users/import', { body: { csv_text: text } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <H2>Import users (CSV)</H2>
      <Body muted>Paste CSV with header: role,college_id,full_name,email,password</Body>
      <Field label="CSV" value={text} onChangeText={setText} multiline autoCapitalize="none" autoCorrect={false} style={{ minHeight: 200, textAlignVertical: 'top', fontFamily: 'monospace' } as any} />
      <ErrorText error={error} />
      {result ? (
        <Card>
          <Body>Created: {result.created}</Body>
          {result.errors.map((e) => (
            <Body key={e.line} style={{ color: colors.danger }}>
              Line {e.line}: {e.error}
            </Body>
          ))}
        </Card>
      ) : null}
      <Button title="Import" onPress={submit} loading={busy} />
      <Button title="Back" variant="ghost" onPress={onDone} />
    </Screen>
  );
}

function EditUser({ user, isAdmin, onDone }: { user: AdminUser; isAdmin: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>, msg?: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/users/${user.id}`, { method: 'PATCH', body });
      if (msg) Alert.alert(msg);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <H2>
          {user.college_id} {user.full_name}
        </H2>
        <Body muted>
          {user.role.replace('_', ' ')} · {user.email}
        </Body>
        <Row style={{ gap: space.sm }}>
          <Badge status={user.is_active ? 'present' : 'rejected'} label={user.is_active ? 'Active' : 'Inactive'} />
          <Badge status={user.identity_verified ? 'present' : 'pending'} label={user.identity_verified ? 'ID verified' : 'ID not verified'} />
        </Row>
      </Card>
      {isAdmin && user.role === 'student' ? (
        <Card>
          <H2>Identity check</H2>
          <Body muted>Mark verified only after checking the student’s college ID in person. Required before face enrollment.</Body>
          <Button
            title={user.identity_verified ? 'Remove identity verification' : 'Mark identity verified'}
            variant={user.identity_verified ? 'secondary' : 'primary'}
            onPress={() => patch({ identity_verified: !user.identity_verified })}
            loading={busy}
          />
        </Card>
      ) : null}
      {isAdmin ? (
        <Card>
          <H2>Reset password</H2>
          <Field label="New password (min 10)" value={password} onChangeText={setPassword} secureTextEntry />
          <Button title="Reset password" variant="secondary" onPress={() => patch({ new_password: password }, 'Password reset')} disabled={password.length < 10} />
          <Button
            title={user.is_active ? 'Deactivate account' : 'Reactivate account'}
            variant={user.is_active ? 'danger' : 'primary'}
            onPress={() => patch({ is_active: !user.is_active })}
          />
        </Card>
      ) : null}
      <ErrorText error={error} />
      <Button title="Back" variant="ghost" onPress={onDone} />
    </Screen>
  );
}
