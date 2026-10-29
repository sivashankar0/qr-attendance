import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/lib/auth';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.card },
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
          <Stack.Screen name="auth/index" options={{ title: 'Choose user type' }} />
          <Stack.Screen name="auth/[role]" options={{ title: 'Sign in' }} />
          <Stack.Screen name="auth/forgot" options={{ title: 'Forgot password' }} />
          <Stack.Screen name="student" options={{ headerShown: false }} />
          <Stack.Screen name="teacher" options={{ headerShown: false }} />
          <Stack.Screen name="admin" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ title: 'Settings & privacy' }} />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
