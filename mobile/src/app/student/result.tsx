import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { Banner, Body, Button, Card, H1, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { flow } from '@/lib/flow';
import { colors, fmtTime, space } from '@/lib/theme';

const METHOD: Record<string, string> = { qr_face: 'QR + Face', qr_only: 'QR', manual_exception: 'Teacher verified' };

// Reasons where trying the face step again can help.
const RETRYABLE = new Set(['FACE_NOT_DETECTED', 'MULTIPLE_FACES', 'LOW_QUALITY', 'LIVENESS_FAILED', 'FACE_MISMATCH', 'SERVER_ERROR']);

export default function Result() {
  const { result, sessionId, classCode, className } = flow.get();
  const [wait, setWait] = useState(result?.retry_after ?? 0);
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(result?.reason === 'MANUAL_REQUIRED');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  if (!result) {
    router.replace('/student');
    return null;
  }

  const done = () => {
    flow.clear();
    router.replace('/student');
  };

  const retry = () => {
    if (!result.retry) return;
    flow.set({
      challenge: {
        nonce: result.retry.nonce,
        challenge: result.retry.challenge,
        attempt_no: result.retry.attempt_no,
        max_attempts: result.max_attempts ?? 3,
      },
      result: undefined,
    });
    router.replace('/student/verify');
  };

  const requestManual = async () => {
    if (!sessionId) return;
    setRequesting(true);
    setError(null);
    try {
      await api('/attendance/requests', { body: { session_id: sessionId } });
      setRequested(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the request.');
    } finally {
      setRequesting(false);
    }
  };

  if (result.ok) {
    return (
      <Screen>
        <View style={{ alignItems: 'center', gap: space.md, marginTop: space.xxl }}>
          <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.successBg, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 52, color: colors.success }}>✓</Text>
          </View>
          <H1>Attendance recorded</H1>
        </View>
        <Card>
          <Info label="Class" value={`${classCode ?? ''} – ${className ?? ''}`} />
          <Info label="Time (server)" value={fmtTime(result.marked_at)} />
          <Info label="Method" value={METHOD[result.method ?? ''] ?? result.method ?? '—'} />
        </Card>
        <Button title="Done" onPress={done} />
      </Screen>
    );
  }

  const canRetry = !!result.retry && RETRYABLE.has(result.reason ?? '');
  const showManual = !!sessionId && (result.can_request_manual || result.reason === 'RETRY_LIMIT') && result.reason !== 'ALREADY_MARKED';

  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: space.md, marginTop: space.xl }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: requested ? colors.infoBg : colors.dangerBg, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 48, color: requested ? colors.info : colors.danger }}>{requested ? 'i' : '!'}</Text>
        </View>
        <H1>{requested ? 'Teacher verification requested' : result.reason === 'ALREADY_MARKED' ? 'Already recorded' : 'Not recorded'}</H1>
      </View>
      {classCode ? (
        <Body muted style={{ textAlign: 'center' }}>
          {classCode} – {className}
        </Body>
      ) : null}

      {requested ? (
        <Banner kind="info" title="Request sent">
          <Body>Go to your teacher. They will confirm your identity in person and mark you present.</Body>
        </Banner>
      ) : (
        <Banner kind={result.reason === 'ALREADY_MARKED' ? 'success' : 'danger'} title={result.message ?? 'Attendance was not recorded.'}>
          {result.attempt_no && result.max_attempts ? (
            <Body>
              Attempt {result.attempt_no} of {result.max_attempts}
            </Body>
          ) : null}
        </Banner>
      )}

      {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}

      <View style={{ gap: space.sm }}>
        {canRetry && !requested ? (
          <Button title={wait > 0 ? `Try again in ${wait}s` : 'Try again'} onPress={retry} disabled={wait > 0} />
        ) : null}
        {result.location_blocked ? (
          <Button title="Open settings to allow location" variant="secondary" onPress={() => Linking.openSettings()} />
        ) : null}
        {result.reason === 'FACE_NOT_ENROLLED' ? (
          <Button title="Set up face enrollment" variant="secondary" onPress={() => router.replace('/student/enrollment')} />
        ) : null}
        {['SESSION_INVALID', 'CHALLENGE_INVALID', 'COOLDOWN', 'RATE_LIMITED', 'LOCATION_REQUIRED', 'LOCATION_INACCURATE', 'LOCATION_OUT_OF_RANGE', 'LOCATION_MOCKED'].includes(result.reason ?? '') ? (
          <Button title="Scan again" onPress={() => router.replace('/student/scan')} />
        ) : null}
        {showManual && !requested ? (
          <Button title="Request teacher verification" variant="secondary" onPress={requestManual} loading={requesting} />
        ) : null}
        <Button title="Back to home" variant="ghost" onPress={done} />
      </View>
    </Screen>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
      <Body muted>{label}</Body>
      <Body style={{ fontWeight: '700', flexShrink: 1, textAlign: 'right' }}>{value}</Body>
    </View>
  );
}
