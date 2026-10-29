import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { Badge, Body, Card, EmptyState, ListItem, Row, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { TeacherClass, timing } from '@/lib/teacher';
import { colors, fmtMinutes, sessionStatus, space } from '@/lib/theme';

export default function TeacherClasses() {
  const [classes, setClasses] = useState<TeacherClass[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setClasses(await api<TeacherClass[]>('/teacher/classes'));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <Screen refreshing={refreshing} onRefresh={load}>
      {classes?.length === 0 ? (
        <Card>
          <EmptyState icon="school-outline" title="No classes assigned yet" body="Ask the administrator to assign your classes." />
        </Card>
      ) : null}
      {classes?.map((c) => (
        <Card key={c.id}>
          <ListItem
            icon="book-outline"
            title={`${c.code} – ${c.name}`}
            subtitle={`${c.term} · ${c.student_count} students`}
            onPress={() => router.push({ pathname: '/teacher/class/[id]', params: { id: c.id, title: c.code } })}
            right={<Ionicons name="chevron-forward" size={22} color={colors.primary} />}
          />
          <View style={{ gap: space.xs }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Body muted>Timing</Body>
              <Body style={{ fontWeight: '700' }}>
                {timing(c)}
                {c.days_of_week ? ` · ${c.days_of_week}` : ''}
              </Body>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Body muted>Duration</Body>
              <Body style={{ fontWeight: '700' }}>{fmtMinutes(c.duration_minutes)}</Body>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Body muted>Attendance weightage</Body>
              <Text style={{ fontWeight: '800', color: colors.primary, fontSize: 16 }}>
                {c.effective_weightage}
                {c.weightage == null && c.recommended_weightage != null ? ' (auto)' : ''}
              </Text>
            </Row>
            {c.latest_session ? (
              <Row style={{ justifyContent: 'space-between' }}>
                <Body muted>Latest session</Body>
                <Badge status={c.latest_session.status} palette={sessionStatus} />
              </Row>
            ) : null}
          </View>
        </Card>
      ))}
    </Screen>
  );
}
