import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

import { Column, DataTable } from '@/components/DataTable';
import { Banner, Body, Card, Chip, EmptyState, Row, Screen, Stat } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { TeacherClass } from '@/lib/teacher';
import { colors, fmtMinutes } from '@/lib/theme';

interface ReportRow {
  student_id: string;
  college_id: string;
  full_name: string;
  attended: number;
  sessions: number;
  exceptions: number;
  weighted_attended: number;
  total_weight: number;
  percent: number | null;
}

interface Report {
  class: TeacherClass;
  sessions: number;
  total_weight: number;
  students: ReportRow[];
}

export default function TeacherReports() {
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async (id: string) => {
    setError(null);
    try {
      setReport(await api<Report>(`/teacher/classes/${id}/report`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the report.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      api<TeacherClass[]>('/teacher/classes')
        .then((c) => {
          setClasses(c);
          const id = selected ?? c[0]?.id;
          if (id) {
            setSelected(id);
            loadReport(id);
          }
        })
        .catch(() => {});
    }, [selected, loadReport]),
  );

  const columns: Column<ReportRow>[] = [
    { key: 'name', title: 'Student', width: 150, value: (r) => r.full_name, sortable: true },
    { key: 'id', title: 'ID', width: 90, value: (r) => r.college_id, sortable: true },
    { key: 'att', title: 'Attended', width: 90, value: (r) => r.attended, render: (r) => <Text>{`${r.attended}/${r.sessions}`}</Text>, sortable: true, align: 'right' },
    { key: 'exc', title: 'Exceptions', width: 90, value: (r) => r.exceptions, sortable: true, align: 'right' },
    { key: 'w', title: 'Weighted', width: 100, value: (r) => r.weighted_attended, render: (r) => <Text>{`${r.weighted_attended}/${r.total_weight}`}</Text>, sortable: true, align: 'right' },
    {
      key: 'pct',
      title: 'Attendance %',
      width: 110,
      value: (r) => r.percent ?? -1,
      render: (r) => <Text style={{ fontWeight: '800', color: r.percent != null && r.percent < 75 ? colors.danger : colors.success }}>{r.percent != null ? `${r.percent}%` : '—'}</Text>,
      sortable: true,
      align: 'right',
    },
  ];

  const low = report?.students.filter((s) => s.percent != null && s.percent < 75).length ?? 0;

  return (
    <Screen>
      {classes.length === 0 ? (
        <Card>
          <EmptyState icon="bar-chart-outline" title="No classes yet" />
        </Card>
      ) : (
        <Row style={{ flexWrap: 'wrap' }}>
          {classes.map((c) => (
            <Chip
              key={c.id}
              label={c.code}
              selected={selected === c.id}
              onPress={() => setSelected(c.id)}
            />
          ))}
        </Row>
      )}
      {error ? <Banner kind="danger" title={error} /> : null}
      {report ? (
        <>
          <Row style={{ flexWrap: 'wrap' }}>
            <Stat icon="calendar-outline" label="Sessions" value={report.sessions} />
            <Stat icon="scale-outline" label="Weight / session" value={report.class.effective_weightage} />
            <Stat icon="warning-outline" label="Below 75%" value={low} color={low ? colors.danger : undefined} />
          </Row>
          <Card>
            <Body muted style={{ fontSize: 14 }}>
              {report.class.code} – {report.class.name} · {fmtMinutes(report.class.duration_minutes)} per class. Attendance % =
              weighted sessions attended ÷ total session weight. Exceptions (teacher-verified) count as present.
            </Body>
            <DataTable rows={report.students} columns={columns} rowKey={(r) => r.student_id} searchPlaceholder="Search students" filters={[{ key: 'low', label: 'Below 75%', test: (r) => r.percent != null && r.percent < 75 }]} emptyTitle="No students in this class" emptyIcon="people-outline" />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
