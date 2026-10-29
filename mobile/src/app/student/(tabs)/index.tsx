import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { Banner, Body, Button, Card, H1, H2, ListItem, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, space } from '@/lib/theme';

interface Status {
  identity_verified: boolean;
  consent_active: boolean;
  template_status: 'not_enrolled' | 'active' | 'pending_review' | 'revoked' | 'deleted';
  alternative_method: boolean;
}

interface Summary {
  classes: { class_code: string; class_name: string; sessions: number; attended: number; weighted_percent: number | null }[];
  history: { status: string }[];
  overall_weighted_percent: number | null;
}

export default function StudentHome() {
  const { user } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [s, m] = await Promise.all([api<Status>('/face/enrollment/status'), api<Summary>('/attendance/me')]);
      setStatus(s);
      setSummary(m);
    } catch {
      // keep previous data
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const openNow = summary?.history.filter((h) => h.status === 'open').length ?? 0;

  return (
    <Screen refreshing={refreshing} onRefresh={load}>
      <View>
        <Body muted>Welcome,</Body>
        <H1>{user?.full_name}</H1>
        <Body muted>{user?.college_id}</Body>
      </View>

      {status && <EnrollmentBanner status={status} />}

      <Card style={{ alignItems: 'stretch' }}>
        <H2>Mark attendance</H2>
        <Body muted>
          {openNow > 0
            ? `${openNow} class session${openNow > 1 ? 's are' : ' is'} open now.`
            : "Scan the QR code on your teacher's screen."}
        </Body>
        <Button title="Scan QR code" icon="qr-code-outline" onPress={() => router.push('/student/scan')} />
      </Card>

      <Card>
        <H2>My classes</H2>
        {summary?.overall_weighted_percent != null ? (
          <Body muted>
            Overall attendance (weighted by class duration): <Text style={{ fontWeight: '800', color: colors.text }}>{summary.overall_weighted_percent}%</Text>
          </Body>
        ) : null}
        {summary?.classes.length ? (
          summary.classes.map((c) => {
            const pct = c.weighted_percent ?? (c.sessions ? Math.round((c.attended / c.sessions) * 100) : 0);
            return (
              <ListItem
                key={c.class_code}
                title={`${c.class_code} – ${c.class_name}`}
                subtitle={`${c.attended} of ${c.sessions} sessions attended`}
                right={
                  <Text style={{ fontWeight: '800', fontSize: 18, color: pct < 75 && c.sessions ? colors.danger : colors.success }}>
                    {c.sessions ? `${pct}%` : '—'}
                  </Text>
                }
              />
            );
          })
        ) : (
          <Body muted>You are not enrolled in any class yet.</Body>
        )}
        <Button title="View attendance history" variant="secondary" onPress={() => router.push('/student/history')} />
      </Card>

    </Screen>
  );
}

function EnrollmentBanner({ status }: { status: Status }) {
  if (status.alternative_method)
    return (
      <Banner kind="info" title="Alternative verification method">
        <Body>Your teacher will verify your attendance in person.</Body>
      </Banner>
    );
  if (status.template_status === 'active') return null;
  if (status.template_status === 'pending_review')
    return (
      <Banner kind="info" title="Face enrollment: pending review">
        <Body>A staff member will review your enrollment. Until then, ask your teacher to verify you.</Body>
      </Banner>
    );
  return (
    <Banner kind="warning" title="Face enrollment: not set up">
      <Body>Set it up once to mark attendance quickly, or use teacher verification instead.</Body>
      <View style={{ marginTop: space.sm }}>
        <Button title="Set up now" onPress={() => router.push('/student/enrollment')} />
      </View>
    </Banner>
  );
}
