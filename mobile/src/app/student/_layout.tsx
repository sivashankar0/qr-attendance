import { Stack } from 'expo-router';

import { RoleGate } from '@/components/RoleGate';
import { colors } from '@/lib/theme';

export default function StudentLayout() {
  return (
    <RoleGate roles={['student']}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Home' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan QR', headerShown: false }} />
        <Stack.Screen name="verify" options={{ title: 'Face verification', headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="result" options={{ title: 'Result', headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="history" options={{ title: 'My attendance' }} />
        <Stack.Screen name="enrollment" options={{ title: 'Face enrollment' }} />
        <Stack.Screen name="enroll" options={{ title: 'Enrol your face' }} />
      </Stack>
    </RoleGate>
  );
}
