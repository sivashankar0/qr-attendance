import { Stack } from 'expo-router';

import { RoleGate } from '@/components/RoleGate';
import { colors } from '@/lib/theme';

export default function AdminLayout() {
  return (
    <RoleGate roles={['admin', 'biometric_officer']}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Administration' }} />
        <Stack.Screen name="users" options={{ title: 'Users' }} />
        <Stack.Screen name="classes" options={{ title: 'Classes' }} />
        <Stack.Screen name="class/[id]" options={{ title: 'Class members' }} />
        <Stack.Screen name="enrollments" options={{ title: 'Enrollments & opt-outs' }} />
        <Stack.Screen name="reports" options={{ title: 'Reports & retention' }} />
        <Stack.Screen name="audit" options={{ title: 'Audit log' }} />
      </Stack>
    </RoleGate>
  );
}
