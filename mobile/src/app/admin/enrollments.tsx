import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { Badge, Body, Button, Card, Chip, ErrorText, Field, H2, ListItem, Row, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime, space } from '@/lib/theme';

interface Enrollment {
  student_id: string;
  college_id: string;
  full_name: string;
  status: string;
  enrolled_at: string;
  model: string;
  quality_score: number | null;
}
interface OptOut {
  student_id: string;
  college_id: string;
  full_name: string;
  reason_category: string;
  created_at: string;
}
interface Student {
  id: string;
  college_id: string;
  full_name: string;
}

const REASONS = ['accessibility', 'camera_failure', 'not_enrolled', 'other'];
const STATUS_BADGE: Record<string, string> = { active: 'present', pending_review: 'open', revoked: 'rejected' };

export default function Enrollments() {
  const [tab, setTab] = useState<'pending_review' | 'all' | 'optouts'>('pending_review');
  const [items, setItems] = useState<Enrollment[]>([]);
  const [optOuts, setOptOuts] = useState<OptOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Student[]>([]);
  const [reason, setReason] = useState('accessibility');

  const load = useCallback(async () => {
    setError(null);
    try {
      if (tab === 'optouts') setOptOuts(await api<OptOut[]>('/admin/opt-outs'));
      else setItems(await api<Enrollment[]>(`/admin/enrollments${tab === 'pending_review' ? '?status=pending_review' : ''}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load.');
    }
  }, [tab]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (tab !== 'optouts' || search.trim().length < 2) return;
    const t = setTimeout(async () => {
      try {
        setFound(await api<Student[]>(`/admin/users?role=student&q=${encodeURIComponent(search.trim())}`));
      } catch {
        setFound([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search, tab]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action failed.');
    }
  };

  const review = (e: Enrollment, decision: 'approve' | 'reject') =>
    act(() => api(`/admin/enrollments/${e.student_id}/review`, { body: { decision } }));

  const del = (e: Enrollment) =>
    Alert.alert('Delete face template?', `${e.college_id} ${e.full_name}'s template will be permanently deleted. They must re-enrol to use face verification.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => act(() => api(`/admin/enrollments/${e.student_id}`, { method: 'DELETE' })) },
    ]);

  return (
    <Screen>
      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label="Pending review" selected={tab === 'pending_review'} onPress={() => setTab('pending_review')} />
        <Chip label="All enrollments" selected={tab === 'all'} onPress={() => setTab('all')} />
        <Chip label="Opt-outs" selected={tab === 'optouts'} onPress={() => setTab('optouts')} />
      </Row>
      <ErrorText error={error} />

      {tab !== 'optouts' ? (
        <Card>
          {items.length === 0 ? <Body muted>Nothing here.</Body> : null}
          {items.map((e) => (
            <View key={e.student_id} style={{ gap: space.sm, paddingBottom: space.md }}>
              <ListItem
                title={`${e.college_id}  ${e.full_name}`}
                subtitle={`${fmtDateTime(e.enrolled_at)} · ${e.model}${e.quality_score != null ? ` · quality ${e.quality_score}` : ''}`}
                right={<Badge status={STATUS_BADGE[e.status] ?? 'pending'} label={e.status.replace('_', ' ')} />}
              />
              <Row>
                {e.status === 'pending_review' ? (
                  <>
                    <View style={{ flex: 1 }}>
                      <Button title="Approve" onPress={() => review(e, 'approve')} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button title="Reject" variant="secondary" onPress={() => review(e, 'reject')} />
                    </View>
                  </>
                ) : (
                  <View style={{ flex: 1 }}>
                    <Button title="Delete template" variant="secondary" onPress={() => del(e)} />
                  </View>
                )}
              </Row>
            </View>
          ))}
        </Card>
      ) : (
        <>
          <Card>
            <H2>Approve alternative method</H2>
            <Body muted>For students who cannot or will not use face verification. Teachers only see “alternative method”.</Body>
            <Row style={{ flexWrap: 'wrap' }}>
              {REASONS.map((r) => (
                <Chip key={r} label={r.replace('_', ' ')} selected={reason === r} onPress={() => setReason(r)} />
              ))}
            </Row>
            <Field label="Find student" value={search} onChangeText={setSearch} placeholder="Roll no. or name" />
            {(search.trim().length >= 2 ? found : []).map((s) => (
              <ListItem
                key={s.id}
                title={`${s.college_id}  ${s.full_name}`}
                subtitle="Tap to approve opt-out"
                onPress={() =>
                  act(async () => {
                    await api('/admin/opt-outs', { body: { student_id: s.id, reason_category: reason } });
                    setSearch('');
                  })
                }
              />
            ))}
          </Card>
          <Card>
            <H2>Current opt-outs</H2>
            {optOuts.length === 0 ? <Body muted>None.</Body> : null}
            {optOuts.map((o) => (
              <ListItem
                key={o.student_id}
                title={`${o.college_id}  ${o.full_name}`}
                subtitle={`${o.reason_category.replace('_', ' ')} · ${fmtDateTime(o.created_at)} · tap to remove`}
                onPress={() =>
                  Alert.alert('Remove opt-out?', 'The student will be asked to use face verification again.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => act(() => api(`/admin/opt-outs/${o.student_id}`, { method: 'DELETE' })) },
                  ])
                }
              />
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
