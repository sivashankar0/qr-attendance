import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CaptureStep, FaceCapture } from '@/components/FaceCapture';
import { Banner, Body, Button, Card, H1, H2, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { colors, space } from '@/lib/theme';

interface Notice {
  version: string;
  title: string;
  sections: { heading: string; body: string }[];
}

type Phase = 'consent' | 'capture' | 'submitting' | 'done' | 'declined';

export default function Enroll() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [checked, setChecked] = useState(false);
  const [phase, setPhase] = useState<Phase>('consent');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Notice>('/face/consent-notice').then(setNotice).catch(() => setError('Could not load the notice.'));
  }, []);

  const steps = useMemo<CaptureStep[]>(
    () => [
      { key: 'front', prompt: 'Look straight at the camera', frames: 2, settleMs: 1500, gapMs: 300 },
      { key: 'left', prompt: 'Turn your head slightly to your LEFT', arrow: 'left', frames: 2, settleMs: 1500, gapMs: 300 },
      { key: 'right', prompt: 'Now slightly to your RIGHT', arrow: 'right', frames: 2, settleMs: 1800, gapMs: 300 },
    ],
    [],
  );

  const accept = async () => {
    if (!notice) return;
    setBusy(true);
    setError(null);
    try {
      await api('/face/enrollment/consent', { body: { consent_version: notice.version, accepted: true } });
      setPhase('capture');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not record consent.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (frames: Record<string, string[]>) => {
    setPhase('submitting');
    try {
      const r = await api<{ status: string }>('/face/enrollment', {
        body: { front: frames.front, left: frames.left, right: frames.right },
        timeoutMs: 60000,
      });
      setOutcome(r.status);
      setPhase('done');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Enrollment failed. Try again.');
      setPhase('capture');
    }
  };

  if (phase === 'capture') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <FaceCapture
          steps={steps}
          onComplete={submit}
          onCancel={() => router.back()}
          startLabel="Start enrollment"
          header={
            error ? (
              <View style={{ backgroundColor: colors.danger, padding: space.md, borderRadius: 12 }}>
                <Text style={{ color: '#fff', fontSize: 15 }}>{error}</Text>
              </View>
            ) : (
              <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', padding: space.md, borderRadius: 12 }}>
                <Text style={{ color: '#fff', fontSize: 15 }}>
                  We take a few pictures: straight, then slightly left and right.
                </Text>
              </View>
            )
          }
        />
      </SafeAreaView>
    );
  }

  if (phase === 'submitting') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md }}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Body>Creating your secure face template…</Body>
      </View>
    );
  }

  if (phase === 'done') {
    return (
      <Screen>
        <H1>{outcome === 'active' ? 'Enrollment complete' : 'Enrollment submitted'}</H1>
        <Banner kind={outcome === 'active' ? 'success' : 'info'} title={outcome === 'active' ? 'Status: Active' : 'Status: Pending review'}>
          <Body>
            {outcome === 'active'
              ? 'You can now mark attendance with QR + face. Your photos were discarded after creating the template.'
              : 'The picture quality was borderline, so a staff member will review it. Until then, use teacher verification.'}
          </Body>
        </Banner>
        <Button title="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (phase === 'declined') {
    return (
      <Screen>
        <H1>No problem</H1>
        <Banner kind="info" title="Use teacher verification">
          <Body>
            When you scan the QR code, choose “Request teacher verification”. Your teacher confirms you in person. There
            is no penalty for declining.
          </Body>
        </Banner>
        <Button title="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <H1>{notice?.title ?? 'Face verification'}</H1>
      <Body muted>Please read carefully. Version {notice?.version}</Body>
      <Card>
        {notice?.sections.map((s) => (
          <View key={s.heading} style={{ gap: space.xs }}>
            <H2>{s.heading}</H2>
            <Body>{s.body}</Body>
          </View>
        ))}
      </Card>
      <Pressable
        onPress={() => setChecked((c) => !c)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: colors.primary,
            backgroundColor: checked ? colors.primary : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {checked ? <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text> : null}
        </View>
        <Body style={{ flex: 1 }}>I have read the notice and agree to face verification for attendance.</Body>
      </Pressable>
      {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
      <Button title="Accept and continue" onPress={accept} disabled={!checked || !notice} loading={busy} />
      <Button title="Decline and use the alternative method" variant="secondary" onPress={() => setPhase('declined')} />
    </Screen>
  );
}
