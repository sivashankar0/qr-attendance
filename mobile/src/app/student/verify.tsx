import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CaptureStep, FaceCapture } from '@/components/FaceCapture';
import { api, ApiError } from '@/lib/api';
import { AttendanceResult, flow } from '@/lib/flow';
import { space } from '@/lib/theme';

export default function Verify() {
  const { challenge, classCode, className } = flow.get();
  const [submitting, setSubmitting] = useState(false);

  const steps = useMemo<CaptureStep[]>(
    () => [
      { key: 'front', prompt: 'Look straight at the camera', frames: 2, settleMs: 1200, gapMs: 250 },
      {
        key: 'challenge',
        prompt: challenge?.challenge === 'turn_left' ? 'Turn your head slowly to your LEFT' : 'Turn your head slowly to your RIGHT',
        arrow: challenge?.challenge === 'turn_left' ? 'left' : 'right',
        frames: 3,
        settleMs: 1100,
        gapMs: 350,
      },
    ],
    [challenge?.challenge],
  );

  if (!challenge) {
    router.replace('/student');
    return null;
  }

  const submit = async (frames: Record<string, string[]>) => {
    setSubmitting(true);
    let result: AttendanceResult;
    try {
      result = await api<AttendanceResult>('/attendance/verify', {
        body: { nonce: challenge.nonce, front_frames: frames.front, challenge_frames: frames.challenge },
        timeoutMs: 60000,
      });
    } catch (e) {
      result = {
        ok: false,
        reason: e instanceof ApiError ? (e.reason ?? 'SERVER_ERROR') : 'SERVER_ERROR',
        message: e instanceof Error ? e.message : 'Something went wrong.',
        can_request_manual: true,
      };
    }
    flow.set({ result, challenge: undefined });
    router.replace('/student/result');
  };

  const cancelToManual = () => {
    flow.set({ result: { ok: false, reason: 'CANCELLED', message: 'Face verification was cancelled.', can_request_manual: true } });
    router.replace('/student/result');
  };

  if (submitting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
        <Text style={styles.centerText}>Verifying…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['top', 'bottom']}>
      <FaceCapture
        steps={steps}
        onComplete={submit}
        onCancel={cancelToManual}
        header={
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {classCode} – {className}
            </Text>
            <Text style={styles.headerSub}>
              Attempt {challenge.attempt_no} of {challenge.max_attempts}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: space.md },
  centerText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  header: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, padding: space.md },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  headerSub: { color: '#D8DDE6', fontSize: 14, marginTop: 2 },
});
