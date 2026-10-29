import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { Body, Button, Card, Chip, ErrorText, Field, H2, ListItem, Row, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { colors } from '@/lib/theme';

interface ClassItem {
  id: string;
  code: string;
  name: string;
  term: string;
  teacher_name: string;
  student_count: number;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
  effective_weightage: number;
}
interface Teacher {
  id: string;
  college_id: string;
  full_name: string;
}

export default function Classes() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', term: '', teacher_id: '', start_time: '', end_time: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, t] = await Promise.all([api<ClassItem[]>('/admin/classes'), api<Teacher[]>('/admin/users?role=teacher')]);
    setClasses(c);
    setTeachers(t);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/admin/classes', {
        body: { ...form, start_time: form.start_time || null, end_time: form.end_time || null },
      });
      setCreating(false);
      setForm({ code: '', name: '', term: '', teacher_id: '', start_time: '', end_time: '' });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create class.');
    } finally {
      setBusy(false);
    }
  };

  if (creating) {
    return (
      <Screen>
        <H2>New class</H2>
        <Field label="Code (e.g. CS201)" value={form.code} onChangeText={(v) => setForm({ ...form, code: v })} autoCapitalize="characters" />
        <Field label="Name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
        <Field label="Term (e.g. 2026-ODD)" value={form.term} onChangeText={(v) => setForm({ ...form, term: v })} autoCapitalize="characters" />
        <Row style={{ gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label="Start (HH:MM)" value={form.start_time} onChangeText={(v) => setForm({ ...form, start_time: v })} placeholder="09:00" maxLength={5} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="End (HH:MM)" value={form.end_time} onChangeText={(v) => setForm({ ...form, end_time: v })} placeholder="10:00" maxLength={5} />
          </View>
        </Row>
        <Body muted style={{ fontSize: 13 }}>Optional. Duration and recommended weightage are calculated automatically; edit days and weightage after creating.</Body>
        <Body muted>Teacher</Body>
        <Row style={{ flexWrap: 'wrap' }}>
          {teachers.map((t) => (
            <Chip key={t.id} label={t.full_name} selected={form.teacher_id === t.id} onPress={() => setForm({ ...form, teacher_id: t.id })} />
          ))}
        </Row>
        <ErrorText error={error} />
        <Button title="Create class" onPress={create} loading={busy} disabled={!form.code || !form.name || !form.term || !form.teacher_id} />
        <Button title="Cancel" variant="ghost" onPress={() => setCreating(false)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Button title="New class" onPress={() => setCreating(true)} />
      <Card>
        {classes.length === 0 ? <Body muted>No classes yet.</Body> : null}
        {classes.map((c) => (
          <ListItem
            key={c.id}
            title={`${c.code} – ${c.name}`}
            subtitle={`${c.term} · ${c.teacher_name} · ${c.student_count} students${c.start_time ? ` · ${c.start_time}–${c.end_time}` : ''} · weight ${c.effective_weightage}`}
            onPress={() => router.push({ pathname: '/admin/class/[id]', params: { id: c.id, title: c.code } })}
            right={<Text style={{ color: colors.primary, fontSize: 22 }}>›</Text>}
          />
        ))}
      </Card>
    </Screen>
  );
}
