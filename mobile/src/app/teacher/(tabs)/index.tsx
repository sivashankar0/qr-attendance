import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { Column, DataTable } from '@/components/DataTable';
import { Badge, Body, Button, Card, Chip, Row, Screen, SectionTitle, Stat } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { TeacherClass, TeacherSession, timing } from '@/lib/teacher';
import { colors, fmtDate, fmtMinutes, fmtTime, sessionStatus, space } from '@/lib/theme';

interface StudentRow {
  student_id: string;
  college_id: string;
  full_name: string;
  status: string;
  method: string | null;
  marked_at: string | null;
}

export default function TeacherDashboard() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [sessions, setSessions] = useState<TeacherSession[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [c, s] = await Promise.all([
        api<TeacherClass[]>('/teacher/classes'),
        api<TeacherSession[]>('/teacher/sessions?limit=200'),
      ]);
      setClasses(c);
      setSessions(s);
      setSelected((cur) => cur ?? s[0]?.id ?? null);
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

  const loadStudents = useCallback(async (sid: string) => {
    try {
      const d = await api<{ students: StudentRow[] }>(`/sessions/${sid}/attendance`);
      setStudents(d.students);
    } catch {
      setStudents([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (selected) loadStudents(selected);
    }, [selected, loadStudents]),
  );

  const closeSession = (s: TeacherSession) =>
    Alert.alert(
      'Close this session?',
      `${s.class_code}: ${s.present_count} of ${s.total_students} marked present. Students can no longer mark attendance and the QR code stops working.`,
      [
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
      ],
    );

  const active = sessions.filter((s) => s.status === 'open');
  const today = new Date().toDateString();
  const todayCount = sessions.filter((s) => new Date(s.starts_at).toDateString() === today).length;

  const classColumns = useMemo<Column<TeacherClass>[]>(
    () => [
      { key: 'code', title: 'Class ID', width: 90, value: (c) => c.code, sortable: true },
      { key: 'name', title: 'Subject', width: 170, value: (c) => c.name, sortable: true },
      { key: 'timing', title: 'Timing', width: 130, value: (c) => timing(c) },
      { key: 'dur', title: 'Duration', width: 90, value: (c) => c.duration_minutes ?? -1, render: (c) => <Text>{fmtMinutes(c.duration_minutes)}</Text>, sortable: true },
      { key: 'weight', title: 'Weight', width: 70, value: (c) => c.effective_weightage, sortable: true, align: 'right' },
      { key: 'students', title: 'Students', width: 80, value: (c) => c.student_count, sortable: true, align: 'right' },
      {
        key: 'status',
        title: 'Session',
        width: 100,
        value: (c) => c.latest_session?.status ?? 'none',
        render: (c) => (c.latest_session ? <Badge status={c.latest_session.status} palette={sessionStatus} /> : <Text style={{ color: colors.muted }}>None yet</Text>),
      },
      { key: 'date', title: 'Last date', width: 110, value: (c) => c.latest_session?.starts_at ?? '', render: (c) => <Text>{fmtDate(c.latest_session?.starts_at)}</Text>, sortable: true },
      {
        key: 'actions',
        title: 'Actions',
        width: 120,
        render: (c) =>
          c.latest_session?.status === 'open' ? (
            <Button compact title="Show QR" icon="qr-code-outline" onPress={() => router.push({ pathname: '/teacher/session/[id]', params: { id: c.latest_session!.id } })} />
          ) : (
            <Button compact title="Start" icon="play" onPress={() => router.push({ pathname: '/teacher/class/[id]', params: { id: c.id, title: c.code } })} />
          ),
      },
    ],
    [],
  );

  const sessionColumns = useMemo<Column<TeacherSession>[]>(
    () => [
      { key: 'id', title: 'Session', width: 90, value: (s) => s.id.slice(0, 8) },
      { key: 'class', title: 'Class', width: 90, value: (s) => s.class_code, sortable: true },
      { key: 'date', title: 'Date', width: 110, value: (s) => s.starts_at, render: (s) => <Text>{fmtDate(s.starts_at)}</Text>, sortable: true },
      { key: 'start', title: 'Start', width: 70, value: (s) => fmtTime(s.starts_at) },
      { key: 'end', title: 'End', width: 70, value: (s) => fmtTime(s.ends_at) },
      { key: 'dur', title: 'Duration', width: 90, value: (s) => s.duration_minutes, render: (s) => <Text>{fmtMinutes(s.duration_minutes)}</Text>, sortable: true },
      {
        key: 'att',
        title: 'Attendance',
        width: 110,
        value: (s) => s.attendance_percent ?? -1,
        render: (s) => <Text>{`${s.present_count}/${s.total_students}${s.attendance_percent != null ? ` · ${s.attendance_percent}%` : ''}`}</Text>,
        sortable: true,
      },
      { key: 'status', title: 'Status', width: 90, value: (s) => s.status, render: (s) => <Badge status={s.status} palette={sessionStatus} /> },
      {
        key: 'actions',
        title: 'Actions',
        width: 190,
        render: (s) => (
          <Row>
            <Button compact variant="secondary" title="View" onPress={() => router.push({ pathname: '/teacher/dashboard/[id]', params: { id: s.id } })} />
            {s.status === 'open' ? <Button compact variant="danger" title="Close" onPress={() => closeSession(s)} /> : null}
          </Row>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const studentColumns = useMemo<Column<StudentRow>[]>(() => {
    const cls = sessions.find((s) => s.id === selected)?.class_code ?? '';
    return [
      { key: 'name', title: 'Student', width: 150, value: (r) => r.full_name, sortable: true },
      { key: 'id', title: 'ID', width: 90, value: (r) => r.college_id, sortable: true },
      { key: 'class', title: 'Class', width: 80, value: () => cls },
      { key: 'status', title: 'Status', width: 150, value: (r) => r.status, render: (r) => <Badge status={r.status} />, sortable: true },
      { key: 'method', title: 'Method', width: 150, value: (r) => r.method ?? '—' },
      { key: 'time', title: 'Time', width: 80, value: (r) => r.marked_at ?? '', render: (r) => <Text>{fmtTime(r.marked_at)}</Text>, sortable: true },
    ];
  }, [sessions, selected]);

  return (
    <Screen refreshing={refreshing} onRefresh={load}>
      <View>
        <Body muted>Welcome back,</Body>
        <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>{user?.full_name}</Text>
      </View>
      <Row style={{ flexWrap: 'wrap' }}>
        <Stat icon="school-outline" label="Classes" value={classes.length} />
        <Stat icon="radio-outline" label="Active sessions" value={active.length} color={active.length ? colors.success : undefined} />
        <Stat icon="today-outline" label="Sessions today" value={todayCount} />
      </Row>

      {active.map((s) => (
        <Card key={s.id} style={{ borderColor: colors.success, borderWidth: 1.5 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '800', fontSize: 16 }}>
              {s.class_code} – {s.class_name}
            </Text>
            <Badge status="open" palette={sessionStatus} />
          </Row>
          <Body muted>
            {s.present_count} of {s.total_students} present · ends {fmtTime(s.expires_at)}
          </Body>
          <Button title="Show QR & live attendance" icon="qr-code-outline" onPress={() => router.push({ pathname: '/teacher/session/[id]', params: { id: s.id } })} />
        </Card>
      ))}

      <Card>
        <SectionTitle title="Class management" />
        <DataTable rows={classes} columns={classColumns} rowKey={(c) => c.id} loading={loading} searchPlaceholder="Search classes" pageSize={5} emptyTitle="No classes assigned" emptyBody="Ask the administrator to assign your classes." emptyIcon="school-outline" />
      </Card>

      <Card>
        <SectionTitle title="Attendance sessions" action={<Button compact variant="ghost" title="All" onPress={() => router.navigate('/teacher/sessions')} />} />
        <DataTable
          rows={sessions}
          columns={sessionColumns}
          rowKey={(s) => s.id}
          loading={loading}
          searchPlaceholder="Search by class or date"
          pageSize={5}
          filters={[
            { key: 'active', label: 'Active', test: (s) => s.status === 'open' },
            { key: 'closed', label: 'Closed / ended', test: (s) => s.status !== 'open' },
          ]}
          emptyTitle="No sessions yet"
          emptyBody="Start a session from Class management."
          emptyIcon="time-outline"
        />
      </Card>

      <Card>
        <SectionTitle title="Student attendance" />
        {sessions.length ? (
          <Row style={{ flexWrap: 'wrap', gap: space.sm }}>
            {sessions.slice(0, 6).map((s) => (
              <Chip key={s.id} label={`${s.class_code} · ${fmtDate(s.starts_at)}`} selected={selected === s.id} onPress={() => setSelected(s.id)} />
            ))}
          </Row>
        ) : null}
        <DataTable
          rows={students}
          columns={studentColumns}
          rowKey={(r) => r.student_id}
          searchPlaceholder="Search students"
          filters={[
            { key: 'present', label: 'Present', test: (r) => r.status === 'present' || r.status === 'present_exception' },
            { key: 'pending', label: 'Pending', test: (r) => r.status === 'pending' },
            { key: 'rejected', label: 'Rejected', test: (r) => r.status === 'rejected' },
          ]}
          emptyTitle={selected ? 'No students in this class' : 'Select a session'}
          emptyIcon="people-outline"
        />
      </Card>
    </Screen>
  );
}
