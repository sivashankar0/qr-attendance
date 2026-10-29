import { Stack } from 'expo-router';

import { RoleGate } from '@/components/RoleGate';
import { colors } from '@/lib/theme';

export default function TeacherLayout() {
  return (
    <RoleGate roles={['teacher']}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'My classes' }} />
        <Stack.Screen name="class/[id]" options={{ title: 'Class' }} />
        <Stack.Screen name="session/[id]" options={{ title: 'Attendance QR' }} />
        <Stack.Screen name="dashboard/[id]" options={{ title: 'Attendance dashboard' }} />
        <Stack.Screen name="exception" options={{ title: 'Manual verification', presentation: 'modal' }} />
      </Stack>
    </RoleGate>
  );
}
