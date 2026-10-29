import { Href, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { InfoRow, ProfileHeader, SettingsSection } from '@/components/ProfileParts';
import { Body, Card, H2, ListItem, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/theme';

interface Profile {
  member_since: string;
  staff: { pending_signups: number; pending_face_changes: number; password_reset_requests: number };
}

export default function AdminProfile() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
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
        <H2>Administration</H2>
        <InfoRow label="Staff ID" value={user?.college_id ?? '—'} />
        <InfoRow label="Email" value={user?.email ?? '—'} />
        {isAdmin ? <InfoRow label="Pending sign-ups" value={p?.staff.pending_signups ?? '—'} /> : null}
        <InfoRow label="Pending face changes" value={p?.staff.pending_face_changes ?? '—'} />
        {isAdmin ? <InfoRow label="Password reset requests" value={p?.staff.password_reset_requests ?? '—'} /> : null}
        <ListItem icon="shield-checkmark-outline" title="Face change approvals" onPress={() => router.navigate('/admin/face-changes' as Href)} />
        <ListItem icon="people-outline" title="User management" onPress={() => router.navigate('/admin/users' as Href)} />
      </Card>
      <SettingsSection />
    </Screen>
  );
}
