import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Banner, Body, Button, Card, Chip, ErrorText, Field, H2, Row, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { colors, space } from '@/lib/theme';

const REASONS = [
  { key: 'camera_failure', label: 'Camera failure' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'false_rejection', label: 'False rejection' },
  { key: 'not_enrolled', label: 'Not enrolled' },
  { key: 'other', label: 'Other' },
];

export default function ExceptionScreen() {
  const { session_id, student_id, name, requested } = useLocalSearchParams<{
    session_id: string;
    student_id: string;
    name: string;
    requested: string;
  }>();
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason) return setError('Choose a reason.');
    if (!confirmed) return setError('Confirm that you checked the student’s identity in person.');
    setBusy(true);
    setError(null);
    try {
      await api('/attendance/exceptions', {
        body: { session_id, student_id, reason_category: reason, reason_note: note.trim() || null, identity_confirmed: true },
      });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    setBusy(true);
    try {
      await api(`/sessions/${session_id}/requests/${student_id}/dismiss`, { method: 'POST' });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not dismiss.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <H2>{name}</H2>
        <Body muted>Mark present after confirming identity in person (visual check, college ID card).</Body>
      </Card>

      <Card>
        <Body style={{ fontWeight: '700' }}>Reason</Body>
        <Row style={{ flexWrap: 'wrap' }}>
          {REASONS.map((r) => (
            <Chip key={r.key} label={r.label} selected={reason === r.key} onPress={() => setReason(r.key)} />
          ))}
        </Row>
        <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={500} multiline />
        <Pressable
          onPress={() => setConfirmed((c) => !c)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: confirmed }}
          style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}
        >
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              borderWidth: 2,
              borderColor: colors.primary,
              backgroundColor: confirmed ? colors.primary : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {confirmed ? <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text> : null}
          </View>
          <Body style={{ flex: 1 }}>I have confirmed this student’s identity in person.</Body>
        </Pressable>
      </Card>

      <Banner kind="info" title="This action is logged">
        <Body>Your name, the reason and the server time are recorded. Exceptions are flagged in reports and reviewed.</Body>
      </Banner>
      <ErrorText error={error} />
      <Button title="Confirm – mark present (exception)" onPress={submit} loading={busy} />
      {requested === '1' ? <Button title="Dismiss request" variant="secondary" onPress={dismiss} disabled={busy} /> : null}
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
