import { router } from 'expo-router';
import { Text } from 'react-native';

import { Body, Card, H1, ListItem, Screen, Button } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

export default function AdminHome() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const items: { title: string; subtitle: string; href: any; show: boolean }[] = [
    { title: 'Users', subtitle: 'Create, import, verify identity, reset passwords', href: '/admin/users', show: true },
    { title: 'Classes', subtitle: 'Create classes, assign teachers, add students', href: '/admin/classes', show: isAdmin },
    { title: 'Enrollments & opt-outs', subtitle: 'Review queue, deletions, alternative method', href: '/admin/enrollments', show: true },
    { title: 'Reports & retention', subtitle: 'Exception rates, run retention job', href: '/admin/reports', show: isAdmin },
    { title: 'Audit log', subtitle: 'Enrollments, template access, exceptions, logins', href: '/admin/audit', show: true },
  ];
  return (
    <Screen>
      <H1>{user?.full_name}</H1>
      <Body muted>{isAdmin ? 'Administrator' : 'Biometric officer'}</Body>
      <Card>
        {items
          .filter((i) => i.show)
          .map((i) => (
            <ListItem
              key={i.title}
              title={i.title}
              subtitle={i.subtitle}
              onPress={() => router.push(i.href)}
              right={<Text style={{ color: colors.primary, fontSize: 22 }}>›</Text>}
            />
          ))}
      </Card>
      <Body muted style={{ fontSize: 14 }}>
        Administrators never see face images, templates or match scores.
      </Body>
      <Button title="Settings" variant="ghost" onPress={() => router.push('/settings')} />
    </Screen>
  );
}
