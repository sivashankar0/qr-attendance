import { Ionicons } from '@expo/vector-icons';
import { Href, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { Body, Card, IconName, ListItem, Row, Screen, SectionTitle, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, roleLabel } from '@/lib/theme';

interface Summary {
  users: Record<string, number>;
  pending_signups: number;
  password_reset_requests: number;
  pending_face_changes: number;
  pending_enrollment_reviews: number;
  classes: number;
  open_sessions: number;
  attendance_today: number;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [s, setS] = useState<Summary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setS(await api<Summary>('/admin/summary'));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const todo: { icon: IconName; title: string; count: number; href: string; show: boolean }[] = [
    { icon: 'person-add-outline', title: 'Sign-ups waiting for approval', count: s?.pending_signups ?? 0, href: '/admin/users', show: isAdmin },
    { icon: 'key-outline', title: 'Password reset requests', count: s?.password_reset_requests ?? 0, href: '/admin/users', show: isAdmin },
    { icon: 'shield-checkmark-outline', title: 'Face change requests', count: s?.pending_face_changes ?? 0, href: '/admin/face-changes', show: true },
    { icon: 'finger-print-outline', title: 'Enrollments pending review', count: s?.pending_enrollment_reviews ?? 0, href: '/admin/enrollments', show: true },
  ];

  const tools: { icon: IconName; title: string; subtitle: string; href: string; show: boolean }[] = [
    { icon: 'people-outline', title: 'User management', subtitle: 'Create, import, approve, reset passwords', href: '/admin/users', show: true },
    { icon: 'school-outline', title: 'Classes', subtitle: 'Classes, timings, weightage and members', href: '/admin/classes', show: isAdmin },
    { icon: 'finger-print-outline', title: 'Enrollments & opt-outs', subtitle: 'Review queue, deletions, alternative method', href: '/admin/enrollments', show: true },
    { icon: 'document-text-outline', title: 'Audit log', subtitle: 'Logins, approvals, template access', href: '/admin/audit', show: true },
  ];

  return (
    <Screen refreshing={refreshing} onRefresh={load}>
      <View>
        <Body muted>{roleLabel[user?.role ?? '']}</Body>
        <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>{user?.full_name}</Text>
      </View>
      <Row style={{ flexWrap: 'wrap' }}>
        <Stat icon="school-outline" label="Students" value={s?.users.student ?? '—'} />
        <Stat icon="easel-outline" label="Teachers" value={s?.users.teacher ?? '—'} />
        <Stat icon="book-outline" label="Classes" value={s?.classes ?? '—'} />
      </Row>
      <Row style={{ flexWrap: 'wrap' }}>
        <Stat icon="radio-outline" label="Active sessions" value={s?.open_sessions ?? '—'} color={s?.open_sessions ? colors.success : undefined} />
        <Stat icon="checkmark-done-outline" label="Marked today" value={s?.attendance_today ?? '—'} />
      </Row>

      <Card>
        <SectionTitle title="Needs your attention" />
        {todo
          .filter((t) => t.show)
          .map((t) => (
            <ListItem
              key={t.title}
              icon={t.icon}
              title={t.title}
              onPress={() => router.navigate(t.href as Href)}
              right={
                <View style={{ minWidth: 32, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: t.count ? colors.warningBg : '#EEF0F4', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '800', color: t.count ? colors.warning : colors.muted }}>{t.count}</Text>
                </View>
              }
            />
          ))}
      </Card>

      <Card>
        <SectionTitle title="Tools" />
        {tools
          .filter((t) => t.show)
          .map((t) => (
            <ListItem key={t.title} icon={t.icon} title={t.title} subtitle={t.subtitle} onPress={() => router.push(t.href as Href)} right={<Ionicons name="chevron-forward" size={20} color={colors.primary} />} />
          ))}
      </Card>
      <Body muted style={{ fontSize: 14 }}>Administrators never see face images, templates or match scores.</Body>
    </Screen>
  );
}
