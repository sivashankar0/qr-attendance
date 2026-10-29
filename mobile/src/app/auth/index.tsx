import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, H1, IconName, Screen } from '@/components/ui';
import { colors, radius, shadow, space } from '@/lib/theme';

const TYPES: { key: 'student' | 'teacher' | 'admin'; title: string; body: string; icon: IconName }[] = [
  { key: 'student', title: 'Student', body: 'Mark attendance, see your history and manage face verification.', icon: 'school-outline' },
  { key: 'teacher', title: 'Teacher', body: 'Run attendance sessions, see live dashboards and reports.', icon: 'easel-outline' },
  { key: 'admin', title: 'Admin / Staff', body: 'Manage users, classes, approvals and biometric records.', icon: 'shield-checkmark-outline' },
];

export default function ChooseUserType() {
  return (
    <Screen>
      <View style={{ gap: space.xs, marginTop: space.md }}>
        <H1>Who are you?</H1>
        <Body muted>Select your user type to sign in or create an account.</Body>
      </View>
      {TYPES.map((t) => (
        <Pressable
          key={t.key}
          onPress={() => router.push({ pathname: '/auth/[role]', params: { role: t.key } })}
          accessibilityRole="button"
          accessibilityLabel={`${t.title}. ${t.body}`}
          style={({ pressed }) => [styles.card, pressed && { borderColor: colors.primary, transform: [{ scale: 0.99 }] }]}
        >
          <View style={styles.icon}>
            <Ionicons name={t.icon} size={28} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{t.title}</Text>
            <Text style={styles.body}>{t.body}</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.muted} />
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    ...shadow,
  },
  icon: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  body: { fontSize: 14, color: colors.muted, marginTop: 4, lineHeight: 20 },
});
