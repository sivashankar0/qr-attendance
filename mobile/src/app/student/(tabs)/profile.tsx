import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { InfoRow, ProfileHeader, SettingsSection } from '@/components/ProfileParts';
import { Badge, Body, Button, Card, H2, ListItem, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors, fmtDate } from '@/lib/theme';

interface Profile {
  member_since: string;
  student: {
    classes: { code: string; name: string; term: string; teacher: string }[];
    face: {
      template_status: string;
      change_request_pending: boolean;
      enrolled_once: boolean;
      changes_used: number;
      changes_allowed: number;
      changes_remaining: number;
      limit_reached: boolean;
    };
    attendance: { sessions: number; attended: number; weighted_percent: number | null };
  };
}

const FACE: Record<string, [string, string]> = {
  not_enrolled: ['Not enrolled', 'pending'],
  active: ['Active', 'present'],
  pending_review: ['Pending review', 'open'],
};

export default function StudentProfile() {
  const { user } = useAuth();
  const [p, setP] = useState<Profile | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setP(await api<Profile>('/auth/profile'));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const s = p?.student;
  const [faceLabel, faceBadge] = FACE[s?.face.template_status ?? 'not_enrolled'] ?? ['Unknown', 'pending'];
  const pct = s?.attendance.weighted_percent;

  return (
    <Screen refreshing={refreshing} onRefresh={load}>
      <ProfileHeader user={user} extra={p ? <Body muted>Member since {fmtDate(p.member_since)}</Body> : null} />

      <Card>
        <H2>Account details</H2>
        <InfoRow label="Student ID" value={user?.college_id ?? '—'} />
        <InfoRow label="Email" value={user?.email ?? '—'} />
        <InfoRow label="Identity verified" value={user?.identity_verified ? 'Yes' : 'Not yet'} />
        <InfoRow
          label="Overall attendance (weighted)"
          value={pct == null ? '—' : `${pct}%`}
        />
        {s ? <InfoRow label="Sessions attended" value={`${s.attendance.attended} of ${s.attendance.sessions}`} /> : null}
      </Card>

      <Card>
        <H2>Face verification</H2>
        <InfoRow label="Status" value={<Badge status={faceBadge} label={faceLabel} />} />
        {s ? (
          <InfoRow
            label="Face changes remaining"
            value={
              <Body style={{ fontWeight: '800', color: s.face.changes_remaining === 0 ? colors.danger : colors.success }}>
                {s.face.changes_remaining} of {s.face.changes_allowed}
              </Body>
            }
          />
        ) : null}
        <Body muted style={{ fontSize: 14 }}>
          Your first enrollment is free. Each later replacement uses one change; after that an administrator must approve.
        </Body>
        <Button title="Manage face verification" variant="secondary" icon="happy-outline" onPress={() => router.navigate('/student/enrollment')} />
      </Card>

      <Card>
        <H2>Enrolled classes</H2>
        {s?.classes.length ? (
          s.classes.map((c) => <ListItem key={c.code} icon="book-outline" title={`${c.code} – ${c.name}`} subtitle={`${c.term} · ${c.teacher}`} />)
        ) : (
          <Body muted>You are not enrolled in any class yet.</Body>
        )}
      </Card>

      <SettingsSection />
    </Screen>
  );
}
