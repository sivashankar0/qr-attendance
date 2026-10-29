import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { Badge, Banner, Body, Button, Card, H2, ListItem, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/theme';

interface Status {
  identity_verified: boolean;
  consent_active: boolean;
  current_consent_version: string;
  template_status: string;
  enrolled_at: string | null;
  alternative_method: boolean;
  consent_history: { version: string; granted_at: string; withdrawn_at: string | null }[];
}

const LABEL: Record<string, [string, string]> = {
  not_enrolled: ['Not enrolled', 'pending'],
  active: ['Active', 'present'],
  pending_review: ['Pending review', 'open'],
  revoked: ['Revoked', 'rejected'],
  deleted: ['Deleted', 'rejected'],
};

export default function Enrollment() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setS(await api<Status>('/face/enrollment/status'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load status.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const withdraw = () => {
    Alert.alert(
      'Withdraw consent and delete?',
      'Your face template will be permanently deleted. You can still mark attendance through teacher verification, and you can enrol again later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Withdraw and delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await api('/face/enrollment', { method: 'DELETE' });
              await load();
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'Could not delete.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  if (!s) return <Screen>{error ? <Body>{error}</Body> : <Body muted>Loading…</Body>}</Screen>;

  const [label, badge] = LABEL[s.template_status] ?? [s.template_status, 'pending'];
  const enrolled = s.template_status === 'active' || s.template_status === 'pending_review';

  return (
    <Screen>
      <Card>
        <H2>Status</H2>
        <Badge status={badge} label={label} />
        {s.enrolled_at ? <Body muted>Enrolled {fmtDateTime(s.enrolled_at)}</Body> : null}
        {s.alternative_method ? <Body>You use the alternative (teacher-verified) method.</Body> : null}
      </Card>

      {!s.identity_verified ? (
        <Banner kind="warning" title="Identity check needed first">
          <Body>
            Before you can enrol, the college must verify your identity. Visit the office with your college ID card.
          </Body>
        </Banner>
      ) : null}

      <Card>
        <H2>{enrolled ? 'Update' : 'Set up'}</H2>
        <Body muted>
          Face verification is optional. If you decline, your teacher verifies you in person — with no penalty.
        </Body>
        <Button
          title={enrolled ? 'Re-enrol (e.g. new glasses, beard)' : 'Enrol my face'}
          onPress={() => router.push('/student/enroll')}
          disabled={!s.identity_verified}
        />
        {enrolled || s.consent_active ? (
          <Button title="Withdraw consent and delete my face data" variant="danger" onPress={withdraw} loading={busy} />
        ) : null}
      </Card>

      <Card>
        <H2>Consent history</H2>
        {s.consent_history.length === 0 ? <Body muted>No consent recorded.</Body> : null}
        {s.consent_history.map((c) => (
          <ListItem
            key={c.granted_at}
            title={`Notice ${c.version}`}
            subtitle={`Given ${fmtDateTime(c.granted_at)}${c.withdrawn_at ? ` · Withdrawn ${fmtDateTime(c.withdrawn_at)}` : ''}`}
          />
        ))}
        <Button title="Read privacy notice" variant="ghost" onPress={() => router.push('/settings')} />
      </Card>
    </Screen>
  );
}
