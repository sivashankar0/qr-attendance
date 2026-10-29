import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { InfoRow, ProfileHeader, SettingsSection } from '@/components/ProfileParts';
import { Body, Card, H2, ListItem, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/theme';

interface Profile {
  member_since: string;
  teacher: { classes: { code: string; name: string; term: string }[]; sessions_run: number };
}

export default function TeacherProfile() {
  const { user } = useAuth();
  const [p, setP] = useState<Profile | null>(null);

  useFocusEffect(
    useCallback(() => {
      api<Profile>('/auth/profile').then(setP).catch(() => {});
    }, []),
  );

  return (
    <Screen>
      <ProfileHeader user={user} extra={p ? <Body muted>Member since {fmtDate(p.member_since)}</Body> : null} />
      <Card>
        <H2>Teaching</H2>
        <InfoRow label="Employee ID" value={user?.college_id ?? '—'} />
        <InfoRow label="Email" value={user?.email ?? '—'} />
        <InfoRow label="Classes" value={p?.teacher.classes.length ?? '—'} />
        <InfoRow label="Sessions run" value={p?.teacher.sessions_run ?? '—'} />
        {p?.teacher.classes.map((c) => (
          <ListItem key={c.code} icon="book-outline" title={`${c.code} – ${c.name}`} subtitle={c.term} />
        ))}
      </Card>
      <SettingsSection />
    </Screen>
  );
}
