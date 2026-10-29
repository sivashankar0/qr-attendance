import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Text } from 'react-native';

import { Column, DataTable } from '@/components/DataTable';
import { Badge, Button, Card, Row, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { TeacherSession } from '@/lib/teacher';
import { fmtDate, fmtMinutes, fmtTime, sessionStatus } from '@/lib/theme';

export default function TeacherSessions() {
  const [rows, setRows] = useState<TeacherSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setRows(await api<TeacherSession[]>('/teacher/sessions?limit=500'));
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const close = (s: TeacherSession) =>
    Alert.alert('Close this session?', `${s.class_code}: ${s.present_count} of ${s.total_students} present. Attendance and the QR code stop immediately.`, [
      { text: 'Keep open', style: 'cancel' },
      {
        text: 'Close session',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/sessions/${s.id}/close`, { method: 'POST' });
            load();
          } catch (e) {
            Alert.alert('Could not close', e instanceof ApiError ? e.message : 'Try again.');
          }
        },
      },
    ]);

  const columns: Column<TeacherSession>[] = [
    { key: 'id', title: 'Session ID', width: 100, value: (s) => s.id.slice(0, 8) },
    { key: 'class', title: 'Class', width: 150, value: (s) => `${s.class_code} ${s.class_name}`, render: (s) => <Text numberOfLines={2}>{`${s.class_code} – ${s.class_name}`}</Text>, sortable: true },
    { key: 'date', title: 'Date', width: 110, value: (s) => s.starts_at, render: (s) => <Text>{fmtDate(s.starts_at)}</Text>, sortable: true },
    { key: 'start', title: 'Start', width: 70, value: (s) => fmtTime(s.starts_at) },
    { key: 'end', title: 'End', width: 70, value: (s) => fmtTime(s.ends_at) },
    { key: 'dur', title: 'Duration', width: 90, value: (s) => s.duration_minutes, render: (s) => <Text>{fmtMinutes(s.duration_minutes)}</Text>, sortable: true },
    { key: 'count', title: 'Present', width: 80, value: (s) => s.present_count, render: (s) => <Text>{`${s.present_count}/${s.total_students}`}</Text>, sortable: true, align: 'right' },
    { key: 'pct', title: '%', width: 70, value: (s) => s.attendance_percent ?? -1, render: (s) => <Text>{s.attendance_percent != null ? `${s.attendance_percent}%` : '—'}</Text>, sortable: true, align: 'right' },
    { key: 'weight', title: 'Weight', width: 70, value: (s) => s.weight, sortable: true, align: 'right' },
    { key: 'status', title: 'Status', width: 90, value: (s) => s.status, render: (s) => <Badge status={s.status} palette={sessionStatus} />, sortable: true },
    {
      key: 'actions',
      title: 'Actions',
      width: 210,
      render: (s) => (
        <Row>
          <Button compact variant="secondary" title="Details" onPress={() => router.push({ pathname: '/teacher/dashboard/[id]', params: { id: s.id } })} />
          {s.status === 'open' ? (
            <>
              <Button compact title="QR" onPress={() => router.push({ pathname: '/teacher/session/[id]', params: { id: s.id } })} />
              <Button compact variant="danger" title="Close" onPress={() => close(s)} />
            </>
          ) : null}
        </Row>
      ),
    },
  ];

  const classes = Array.from(new Set(rows.map((r) => r.class_code)));

  return (
    <Screen refreshing={refreshing} onRefresh={load}>
      <Card>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(s) => s.id}
          loading={loading}
          searchPlaceholder="Search sessions"
          filters={[
            { key: 'active', label: 'Active', test: (s) => s.status === 'open' },
            { key: 'done', label: 'Closed / ended', test: (s) => s.status !== 'open' },
            ...classes.map((c) => ({ key: `c:${c}`, label: c, test: (s: TeacherSession) => s.class_code === c })),
          ]}
          emptyTitle="No attendance sessions yet"
          emptyBody="Open Classes and start a session."
          emptyIcon="time-outline"
        />
      </Card>
    </Screen>
  );
}
