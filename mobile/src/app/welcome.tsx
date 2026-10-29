import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, IconName } from '@/components/ui';
import { homeFor, useAuth } from '@/lib/auth';
import { colors, radius, shadow, space } from '@/lib/theme';

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'qr-code-outline', title: 'Rotating QR codes', body: 'A fresh code every 5 seconds — screenshots stop working.' },
  { icon: 'happy-outline', title: 'Face check', body: 'A quick live face check confirms it is really you.' },
  { icon: 'location-outline', title: 'In-class only', body: 'Attendance is accepted only inside the classroom.' },
];

export default function Welcome() {
  const { user } = useAuth();
  if (user) return <Redirect href={homeFor(user.role)} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.primaryDark }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={styles.hero}>
          <View style={styles.bubbleA} />
          <View style={styles.bubbleB} />
          <View style={styles.logo}>
            <Ionicons name="qr-code" size={44} color={colors.primary} />
            <View style={styles.logoCheck}>
              <Ionicons name="checkmark" size={18} color="#fff" />
            </View>
          </View>
          <Text style={styles.title} accessibilityRole="header">
            QR Attendance
          </Text>
          <Text style={styles.tagline}>Fast, fair and verified class attendance for your college.</Text>
        </View>

        <View style={styles.sheet}>
          {FEATURES.map((f) => (
            <View key={f.title} style={styles.feature}>
              <View style={styles.featureIcon}>
                <Ionicons name={f.icon} size={24} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureBody}>{f.body}</Text>
              </View>
            </View>
          ))}
          <View style={{ gap: space.sm, marginTop: space.md }}>
            <Button title="Get started" icon="arrow-forward" onPress={() => router.push('/auth')} />
            <Text style={styles.footnote}>Choose Student, Teacher or Admin on the next screen.</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingHorizontal: space.xl, paddingTop: space.xxl * 1.5, paddingBottom: space.xxl, overflow: 'hidden' },
  bubbleA: { position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(255,255,255,0.07)', top: -80, right: -60 },
  bubbleB: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.06)', bottom: -40, left: -50 },
  logo: { width: 88, height: 88, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...shadow },
  logoCheck: { position: 'absolute', right: -6, bottom: -6, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.primaryDark },
  title: { color: '#fff', fontSize: 32, fontWeight: '800', marginTop: space.xl },
  tagline: { color: '#D6E0FF', fontSize: 17, textAlign: 'center', marginTop: space.sm, lineHeight: 24 },
  sheet: { flex: 1, backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, gap: space.lg },
  feature: { flexDirection: 'row', gap: space.md, alignItems: 'center', backgroundColor: colors.card, padding: space.lg, borderRadius: radius.lg, ...shadow },
  featureIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  featureTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  featureBody: { fontSize: 14, color: colors.muted, marginTop: 2, lineHeight: 20 },
  footnote: { textAlign: 'center', color: colors.muted, fontSize: 14 },
});
