import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { Body, Button, Card, ErrorText, Field, H2, ListItem, Screen } from '@/components/ui';
import { ClassScheduleEditor } from '@/components/ClassScheduleEditor';
import { api, ApiError } from '@/lib/api';
import { TeacherClass } from '@/lib/teacher';

interface Member {
  id: string;
  college_id: string;
  full_name: string;
}

export default function ClassMembers() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const [members, setMembers] = useState<Member[]>([]);
  const [ids, setIds] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [klass, setKlass] = useState<TeacherClass | null>(null);

  const load = useCallback(async () => {
    const [m, cs] = await Promise.all([api<Member[]>(`/admin/classes/${id}/members`), api<TeacherClass[]>('/admin/classes')]);
    setMembers(m);
    setKlass(cs.find((c) => c.id === id) ?? null);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  const add = async () => {
    const list = ids.split(/[\s,;]+/).filter(Boolean);
    if (!list.length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ added: number; not_found: string[] }>(`/admin/classes/${id}/members`, { body: { college_ids: list } });
      setMsg(`Added ${r.added}.${r.not_found.length ? ` Not found: ${r.not_found.join(', ')}` : ''}`);
      setIds('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add students.');
    } finally {
      setBusy(false);
    }
  };

  const remove = (m: Member) =>
    Alert.alert('Remove student?', `${m.college_id} ${m.full_name} will be removed from this class.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await api(`/admin/classes/${id}/members/${m.id}`, { method: 'DELETE' });
          load();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: title ?? 'Class members' }} />
      {klass ? <ClassScheduleEditor key={klass.id} endpoint={`/admin/classes/${id}`} initial={klass} /> : null}
      <Card>
        <H2>Add students</H2>
        <Field
          label="Roll numbers (comma, space or new line separated)"
          value={ids}
          onChangeText={setIds}
          multiline
          autoCapitalize="characters"
        />
        <ErrorText error={error} />
        {msg ? <Body>{msg}</Body> : null}
        <Button title="Add" onPress={add} loading={busy} />
      </Card>
      <Card>
        <H2>Members ({members.length})</H2>
        {members.map((m) => (
          <ListItem key={m.id} title={`${m.college_id}  ${m.full_name}`} subtitle="Tap to remove" onPress={() => remove(m)} />
        ))}
      </Card>
    </Screen>
  );
}
