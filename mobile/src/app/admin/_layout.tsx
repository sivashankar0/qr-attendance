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
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="classes" options={{ title: 'Classes' }} />
        <Stack.Screen name="class/[id]" options={{ title: 'Class' }} />
        <Stack.Screen name="enrollments" options={{ title: 'Enrollments & opt-outs' }} />
        <Stack.Screen name="audit" options={{ title: 'Audit log' }} />
      </Stack>
    </RoleGate>
  );
}
