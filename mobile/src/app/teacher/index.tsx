import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

import { Body, Button, Card, H1, ListItem, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

interface ClassItem {
  id: string;
  code: string;
  name: string;
  term: string;
  student_count: number;
}

export default function TeacherHome() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<ClassItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setClasses(await api<ClassItem[]>('/teacher/classes'));
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
      <H1>{user?.full_name}</H1>
      <Card>
        {classes?.length === 0 ? <Body muted>No classes assigned yet. Ask the administrator.</Body> : null}
        {classes?.map((c) => (
          <ListItem
            key={c.id}
            title={`${c.code} – ${c.name}`}
            subtitle={`${c.term} · ${c.student_count} students`}
            onPress={() => router.push({ pathname: '/teacher/class/[id]', params: { id: c.id, title: c.code } })}
            right={<Text style={{ color: colors.primary, fontSize: 22 }}>›</Text>}
          />
        ))}
      </Card>
      <Button title="Settings" variant="ghost" onPress={() => router.push('/settings')} />
    </Screen>
  );
}
