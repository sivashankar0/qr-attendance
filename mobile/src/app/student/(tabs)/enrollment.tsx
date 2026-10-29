import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { Badge, Banner, Body, Button, Card, ErrorText, Field, H2, ListItem, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { colors, fmtDateTime, space } from '@/lib/theme';

interface Status {
  identity_verified: boolean;
  consent_active: boolean;
  current_consent_version: string;
  template_status: string;
  enrolled_at: string | null;
  alternative_method: boolean;
  consent_history: { version: string; granted_at: string; withdrawn_at: string | null }[];
  face_changes: {
    enrolled_once: boolean;
    changes_used: number;
    changes_allowed: number;
    changes_remaining: number;
    limit_reached: boolean;
  };
  change_request: { status: string; created_at?: string; decided_at?: string | null; note?: string | null } | null;
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
  const [reason, setReason] = useState('');
  const [reqMsg, setReqMsg] = useState<string | null>(null);

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
      'Your face template will be permanently deleted. You can still mark attendance through teacher verification. Enrolling again later counts as a face change.',
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

  const requestChange = async () => {
    if (reason.trim().length < 5) return setError('Tell the administrator why you need a new face change (at least 5 characters).');
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ message: string }>('/face/change-requests', { body: { reason: reason.trim() } });
      setReqMsg(r.message);
      setReason('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the request.');
    } finally {
      setBusy(false);
    }
  };

  if (!s) return <Screen>{error ? <Body>{error}</Body> : <Body muted>Loading…</Body>}</Screen>;

  const [label, badge] = LABEL[s.template_status] ?? [s.template_status, 'pending'];
  const enrolled = s.template_status === 'active' || s.template_status === 'pending_review';
  const fc = s.face_changes;
  const pending = s.change_request?.status === 'pending';

  return (
    <Screen>
      <Card>
        <H2>Status</H2>
        <Badge status={badge} label={label} />
        {s.enrolled_at ? <Body muted>Enrolled {fmtDateTime(s.enrolled_at)}</Body> : null}
        {s.alternative_method ? <Body>You use the alternative (teacher-verified) method.</Body> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs }}>
          <Body muted>Face changes remaining</Body>
          <Body style={{ fontWeight: '800', color: fc.changes_remaining === 0 && fc.enrolled_once ? colors.danger : colors.success }}>
            {fc.enrolled_once ? `${fc.changes_remaining} of ${fc.changes_allowed}` : `${fc.changes_allowed} (first enrollment is free)`}
          </Body>
        </View>
      </Card>

      {!s.identity_verified ? (
        <Banner kind="warning" title="Identity check needed first">
          <Body>Before you can enrol, the college must verify your identity. Visit the office with your college ID card.</Body>
        </Banner>
      ) : null}

      {fc.limit_reached ? (
        <Card>
          <Banner kind="warning" title="Face change limit reached">
            <Body>
              You have used all {fc.changes_allowed} self-service face changes. Further changes need administrator approval.
            </Body>
          </Banner>
          {pending ? (
            <Banner kind="info" title="Request waiting for approval">
              <Body>Sent {fmtDateTime(s.change_request?.created_at)}. You will be able to re-enrol once it is approved.</Body>
            </Banner>
          ) : (
            <>
              {s.change_request?.status === 'rejected' ? (
                <Banner kind="danger" title="Your last request was not approved">
                  {s.change_request.note ? <Body>{s.change_request.note}</Body> : null}
                </Banner>
              ) : null}
              <Field label="Reason for a new face change" icon="chatbox-ellipses-outline" value={reason} onChangeText={setReason} multiline maxLength={300} placeholder="e.g. new glasses, injury, old photo was poor" />
              <Button title="Request admin approval" icon="paper-plane-outline" onPress={requestChange} loading={busy} />
            </>
          )}
          {reqMsg ? <Body style={{ color: colors.success }}>{reqMsg}</Body> : null}
        </Card>
      ) : (
        <Card>
          <H2>{enrolled ? 'Update' : 'Set up'}</H2>
          <Body muted>Face verification is optional. If you decline, your teacher verifies you in person — with no penalty.</Body>
          {enrolled ? (
            <Banner kind="info" title={`Re-enrolling uses 1 of your ${fc.changes_remaining} remaining change${fc.changes_remaining === 1 ? '' : 's'}`} />
          ) : null}
          <Button
            title={enrolled ? 'Re-enrol (e.g. new glasses, beard)' : 'Enrol my face'}
            icon="scan-outline"
            onPress={() => router.push('/student/enroll')}
            disabled={!s.identity_verified}
          />
        </Card>
      )}

      {enrolled || s.consent_active ? (
        <Button title="Withdraw consent and delete my face data" variant="danger" icon="trash-outline" onPress={withdraw} loading={busy} />
      ) : null}
      <ErrorText error={error} />

      <Card>
        <H2>Consent history</H2>
        {s.consent_history.length === 0 ? <Body muted>No consent recorded.</Body> : null}
        {s.consent_history.map((c) => (
          <ListItem
            key={c.granted_at}
            icon="document-text-outline"
            title={`Notice ${c.version}`}
            subtitle={`Given ${fmtDateTime(c.granted_at)}${c.withdrawn_at ? ` · Withdrawn ${fmtDateTime(c.withdrawn_at)}` : ''}`}
          />
        ))}
        <Button title="Read privacy notice" variant="ghost" onPress={() => router.push('/settings')} />
      </Card>
    </Screen>
  );
}
