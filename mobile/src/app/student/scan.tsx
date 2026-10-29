import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, Body, Button, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { AttendanceResult, flow } from '@/lib/flow';
import { Fix, getFix, LocationError } from '@/lib/location';
import { space } from '@/lib/theme';

export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [busy, setBusy] = useState(false);
  const handled = useRef(false);
  const [locStatus, setLocStatus] = useState<'pending' | 'ok' | 'error'>('pending');
  const fixPromise = useRef<Promise<Fix | null> | null>(null);
  const locError = useRef<LocationError | null>(null);

  // Read the position once while the student aims the camera (used only for the classroom check).
  useEffect(() => {
    fixPromise.current = getFix()
      .then((f) => {
        setLocStatus('ok');
        return f;
      })
      .catch((e) => {
        locError.current = e instanceof LocationError ? e : null;
        setLocStatus('error');
        return null;
      });
  }, []);

  const onScanned = async ({ data }: BarcodeScanningResult) => {
    if (handled.current) return;
    if (!data.startsWith('QRA1.')) return; // ignore unrelated QR codes
    handled.current = true;
    setBusy(true);
    Haptics.selectionAsync();
    flow.clear();
    try {
      const fix = fixPromise.current ? await fixPromise.current : null;
      const res = await api<any>('/attendance/start', { body: { qr: data, ...(fix ? { location: fix } : {}) } });
      flow.set({ sessionId: res.session_id, classCode: res.class_code, className: res.class_name });
      if (res.mode === 'face') {
        flow.set({
          challenge: {
            nonce: res.nonce,
            challenge: res.challenge,
            attempt_no: res.attempt_no,
            max_attempts: res.max_attempts,
          },
        });
        router.replace('/student/verify');
      } else {
        // done (QR-only session) or manual (approved alternative method)
        flow.set({ result: { ...res, ok: res.mode === 'done', reason: res.mode === 'manual' ? 'MANUAL_REQUIRED' : undefined } });
        router.replace('/student/result');
      }
    } catch (e) {
      const body = e instanceof ApiError ? e.body : null;
      if (body?.session_id) flow.set({ sessionId: body.session_id, classCode: body.class_code, className: body.class_name });
      const reason = e instanceof ApiError ? (e.reason ?? 'SERVER_ERROR') : 'SERVER_ERROR';
      const result: AttendanceResult = {
        ok: false,
        reason,
        // If the server needs a location we could not read, explain why on this phone.
        message: reason === 'LOCATION_REQUIRED' && locError.current ? locError.current.message : e instanceof Error ? e.message : 'Something went wrong.',
        can_request_manual: !!body?.can_request_manual,
        location_blocked: reason === 'LOCATION_REQUIRED' && locError.current?.kind === 'blocked',
      };
      flow.set({ result });
      router.replace('/student/result');
    }
  };

  if (!permission) return <View />;

  if (!permission.granted) {
    return (
      <Screen>
        <Banner kind="warning" title="Camera permission is required">
          <Body>The camera is needed to scan the attendance QR code.</Body>
        </Banner>
        {permission.canAskAgain ? (
          <Button title="Allow camera" onPress={requestPermission} />
        ) : (
          <Button title="Open settings" onPress={() => Linking.openSettings()} />
        )}
        <Button title="Back" variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={busy ? undefined : onScanned}
      />
      <View pointerEvents="none" style={styles.frameWrap}>
        <View style={styles.frame} />
      </View>
      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <View style={styles.tip}>
          <Text style={styles.tipText}>Point the camera at the QR code on your teacher’s screen</Text>
          <Text style={styles.locText}>
            {locStatus === 'pending' ? '📍 Getting your location…' : locStatus === 'ok' ? '📍 Location ready' : '📍 Location unavailable'}
          </Text>
        </View>
        <View style={{ gap: space.sm }}>
          {busy ? <ActivityIndicator color="#fff" size="large" /> : null}
          <Button title={torch ? 'Torch off' : 'Torch on'} variant="secondary" onPress={() => setTorch((t) => !t)} />
          <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  frameWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 260, height: 260, borderWidth: 4, borderColor: '#fff', borderRadius: 24 },
  overlay: { flex: 1, justifyContent: 'space-between', padding: space.lg },
  tip: { backgroundColor: 'rgba(0,0,0,0.6)', padding: space.md, borderRadius: 12, marginTop: space.lg },
  tipText: { color: '#fff', fontSize: 16, textAlign: 'center', fontWeight: '600' },
  locText: { color: '#D8DDE6', fontSize: 14, textAlign: 'center', marginTop: 6 },
});
