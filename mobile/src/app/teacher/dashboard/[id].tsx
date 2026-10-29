import { File, Paths } from 'expo-file-system';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Badge, Banner, Body, Button, Card, Chip, ListItem, Row, Screen, Stat } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { colors, fmtTime } from '@/lib/theme';

interface StudentRow {
  student_id: string;
  college_id: string;
  full_name: string;
  status: 'present' | 'present_exception' | 'pending' | 'rejected';
  method: string | null;
  marked_at: string | null;
  alternative_method: boolean;
  verification_requested: boolean;
  shared_device: boolean;
  location_failed: boolean;
}

interface Dash {
  session: { id: string; class_code: string; class_name: string; status: string; expires_at: string };
  counts: { total: number; present: number; face_verified: number; exceptions: number; pending: number; rejected: number; requests: number };
  students: StudentRow[];
}

const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'requests', label: 'Requests' },
  { key: 'present', label: 'Present' },
  { key: 'present_exception', label: 'Exceptions' },
  { key: 'pending', label: 'Pending' },
  { key: 'rejected', label: 'Rejected' },
];

export default function Dashboard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [dash, setDash] = useState<Dash | null>(null);
  const [filter, setFilter] = useState('all');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDash(await api<Dash>(`/sessions/${id}/attendance`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load.');
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Live updates while the session is open.
  useEffect(() => {
    if (dash?.session.status !== 'open') return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [dash?.session.status, load]);

  const exportCsv = async () => {
    if (!dash) return;
    setExporting(true);
    try {
      const csv = await api<string>(`/sessions/${id}/export.csv`, { raw: true });
      const file = new File(Paths.cache, `attendance_${dash.session.class_code}_${id.slice(0, 8)}.csv`);
      if (file.exists) file.delete();
      file.create();
      file.write(csv);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Export attendance' });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  if (!dash) return <Screen>{error ? <Banner kind="danger" title={error} /> : <Body muted>Loading…</Body>}</Screen>;

  const rows = dash.students.filter((s) =>
    filter === 'all' ? true : filter === 'requests' ? s.verification_requested : s.status === filter,
  );

  return (
    <Screen refreshing={false} onRefresh={load}>
      <Stack.Screen options={{ title: `${dash.session.class_code} – ${dash.session.class_name}` }} />
      <Row style={{ justifyContent: 'space-between' }}>
        <Badge status={dash.session.status} label={`Session: ${dash.session.status.toUpperCase()}`} />
      </Row>
      <Row style={{ flexWrap: 'wrap' }}>
        <Stat label="Present" value={`${dash.counts.present}/${dash.counts.total}`} color={colors.success} />
        <Stat label="Face verified" value={dash.counts.face_verified} />
        <Stat label="Exceptions" value={dash.counts.exceptions} color={colors.info} />
        <Stat label="Pending" value={dash.counts.pending} />
      </Row>

      {dash.counts.requests > 0 ? (
        <Banner kind="warning" title={`${dash.counts.requests} student(s) requested teacher verification`}>
          <Body>Confirm their identity in person, then tap their name.</Body>
        </Banner>
      ) : null}

      <Row style={{ flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </Row>

      <Card>
        {rows.length === 0 ? <Body muted>No students in this view.</Body> : null}
        {rows.map((s) => {
          const canVerify = s.status === 'pending' || s.status === 'rejected';
          return (
            <ListItem
              key={s.student_id}
              title={`${s.college_id}  ${s.full_name}`}
              subtitle={[
                s.method ?? (s.status === 'pending' ? 'Not yet marked' : ''),
                s.marked_at ? fmtTime(s.marked_at) : '',
                s.alternative_method ? 'Alternative method' : '',
                s.verification_requested ? '⚑ Requested verification' : '',
                s.shared_device ? '⚠ Same phone used by another student' : '',
                s.location_failed ? '📍 Location check failed' : '',
              ]
                .filter(Boolean)
                .join(' · ')}
              right={<Badge status={s.status} />}
              onPress={
                canVerify
                  ? () =>
                      router.push({
                        pathname: '/teacher/exception',
                        params: {
                          session_id: id,
                          student_id: s.student_id,
                          name: `${s.college_id} ${s.full_name}`,
                          requested: s.verification_requested ? '1' : '0',
                        },
                      })
                  : undefined
              }
            />
          );
        })}
      </Card>

      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <View style={{ gap: 8 }}>
        <Button title="Export CSV" variant="secondary" onPress={exportCsv} loading={exporting} />
        {dash.session.status === 'open' ? (
          <Button title="Show QR code" onPress={() => router.push({ pathname: '/teacher/session/[id]', params: { id } })} />
        ) : null}
      </View>
    </Screen>
  );
}
