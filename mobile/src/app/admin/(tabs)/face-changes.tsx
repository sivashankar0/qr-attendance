import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { Badge, Banner, Body, Button, Card, Chip, EmptyState, Field, H2, Row, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { colors, fmtDateTime, space } from '@/lib/theme';

interface Req {
  id: string;
  student_id: string;
  college_id: string;
  full_name: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  decided_at: string | null;
  note: string | null;
  face_changes: { changes_used: number; changes_allowed: number; changes_remaining: number };
}

const TABS: { key: string; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

export default function FaceChanges() {
  const [tab, setTab] = useState('pending');
  const [items, setItems] = useState<Req[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setItems(await api<Req[]>(`/admin/face-change-requests?status=${tab}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load requests.');
    } finally {
      setRefreshing(false);
    }
  }, [tab]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const decide = (r: Req, decision: 'approve' | 'reject') =>
    Alert.alert(
      decision === 'approve' ? 'Approve one more face change?' : 'Reject this request?',
      decision === 'approve'
        ? `${r.full_name} (${r.college_id}) will be able to re-enrol their face once. Confirm their identity in person first.`
        : `${r.full_name} keeps their current face template.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: decision === 'approve' ? 'Approve' : 'Reject',
          style: decision === 'approve' ? 'default' : 'destructive',
          onPress: async () => {
            setBusy(r.id);
            try {
              await api(`/admin/face-change-requests/${r.id}/decide`, { body: { decision, note: notes[r.id]?.trim() || null } });
              await load();
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'Action failed.');
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );

  return (
    <Screen refreshing={refreshing} onRefresh={load}>
      <Banner kind="info" title="Face re-enrollment policy">
        <Body>Students get their first enrollment free plus 2 self-service changes. Each approval here grants exactly one more change. Every decision is logged with your name and the time.</Body>
      </Banner>
      <Row style={{ flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <Chip key={t.key} label={t.label} selected={tab === t.key} onPress={() => setTab(t.key)} />
        ))}
      </Row>
      {error ? <Banner kind="danger" title={error} /> : null}
      {items.length === 0 ? (
        <Card>
          <EmptyState icon="shield-checkmark-outline" title={tab === 'pending' ? 'No pending requests' : 'Nothing here'} />
        </Card>
      ) : null}
      {items.map((r) => (
        <Card key={r.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <H2>
              {r.college_id} · {r.full_name}
            </H2>
            <Badge status={r.status === 'pending' ? 'open' : r.status} label={r.status} />
          </Row>
          <Body muted>Requested {fmtDateTime(r.created_at)}</Body>
          <View style={{ backgroundColor: colors.bg, padding: space.md, borderRadius: 12 }}>
            <Body>“{r.reason}”</Body>
          </View>
          <Body muted style={{ fontSize: 14 }}>
            Changes used: {r.face_changes.changes_used} of {r.face_changes.changes_allowed}
          </Body>
          {r.status === 'pending' ? (
            <>
              <Field label="Note (optional, shown to the student)" value={notes[r.id] ?? ''} onChangeText={(t) => setNotes((n) => ({ ...n, [r.id]: t }))} maxLength={300} />
              <Row>
                <View style={{ flex: 1 }}>
                  <Button title="Approve" icon="checkmark" onPress={() => decide(r, 'approve')} loading={busy === r.id} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Reject" variant="secondary" icon="close" onPress={() => decide(r, 'reject')} disabled={busy === r.id} />
                </View>
              </Row>
            </>
          ) : (
            <Body muted style={{ fontSize: 14 }}>
              Decided {fmtDateTime(r.decided_at)}
              {r.note ? ` · “${r.note}”` : ''}
            </Body>
          )}
        </Card>
      ))}
    </Screen>
  );
}
