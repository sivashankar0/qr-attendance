import { useKeepAwake } from 'expo-keep-awake';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Text, useWindowDimensions, View } from 'react-native';

import { QrMatrix } from '@/components/QrMatrix';
import { Banner, Body, Button, Row, Screen, Stat } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { colors, space } from '@/lib/theme';

interface Dash {
  session: {
    class_code: string;
    class_name: string;
    expires_at: string;
    status: string;
    face_required: boolean;
    location_restricted: boolean;
    geofence_radius_m: number | null;
  };
  counts: { total: number; present: number; face_verified: number; exceptions: number; pending: number; requests: number };
}

export default function SessionQr() {
  useKeepAwake();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const [qr, setQr] = useState<string | null>(null);
  const [rotateAt, setRotateAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [dash, setDash] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch the rotating QR and re-fetch right after each rotation.
  useEffect(() => {
    let cancelled = false;
    const fetchQr = async () => {
      try {
        const r = await api<{ qr: string; rotates_in: number }>(`/sessions/${id}/qr`);
        if (cancelled) return;
        setQr(r.qr);
        setError(null);
        setRotateAt(Date.now() + r.rotates_in * 1000);
        timer.current = setTimeout(fetchQr, Math.max(500, r.rotates_in * 1000 + 300));
      } catch (e) {
        if (cancelled) return;
        setQr(null);
        if (e instanceof ApiError && e.status === 409) setError('This session is closed or has expired.');
        else {
          setError(e instanceof ApiError ? e.message : 'Connection problem. Retrying…');
          timer.current = setTimeout(fetchQr, 3000);
        }
      }
    };
    fetchQr();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const d = await api<Dash>(`/sessions/${id}/attendance`);
        if (active) setDash(d);
      } catch {
        // transient; keep polling
      }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [id]);

  const close = () =>
    Alert.alert('Close session?', 'Students will no longer be able to mark attendance. Late cases go through manual verification.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close session',
        style: 'destructive',
        onPress: async () => {
          await api(`/sessions/${id}/close`, { method: 'POST' });
          if (timer.current) clearTimeout(timer.current);
          router.replace({ pathname: '/teacher/dashboard/[id]', params: { id } });
        },
      },
    ]);

  const secsLeft = dash ? Math.max(0, Math.floor((new Date(dash.session.expires_at).getTime() - now) / 1000)) : 0;
  const rotateIn = Math.max(0, Math.ceil((rotateAt - now) / 1000));
  const size = Math.min(width - space.lg * 2, 420);

  return (
    <Screen>
      <Stack.Screen options={{ title: dash ? `${dash.session.class_code} – ${dash.session.class_name}` : 'Attendance QR' }} />
      <Row style={{ justifyContent: 'space-between' }}>
        <Body style={{ fontWeight: '700' }}>
          {dash?.session.face_required ? 'QR + Face' : 'QR only'}
          {dash?.session.location_restricted ? ` · 📍 ${dash.session.geofence_radius_m} m` : ''}
        </Body>
        <Body style={{ fontWeight: '700', color: secsLeft < 60 ? colors.danger : colors.text }}>
          {Math.floor(secsLeft / 60)}:{String(secsLeft % 60).padStart(2, '0')} left
        </Body>
      </Row>

      {error ? (
        <Banner kind="warning" title={error} />
      ) : (
        <View style={{ alignItems: 'center', gap: space.sm }}>
          <View style={{ backgroundColor: '#fff', padding: space.md, borderRadius: 16 }}>
            {qr ? <QrMatrix value={qr} size={size - space.md * 2} /> : <View style={{ width: size - space.md * 2, height: size - space.md * 2 }} />}
          </View>
          <Text style={{ color: colors.muted, fontSize: 15 }} accessibilityLiveRegion="polite">
            Code refreshes in {rotateIn}s — screenshots stop working quickly
          </Text>
        </View>
      )}

      {dash ? (
        <Row style={{ flexWrap: 'wrap' }}>
          <Stat label="Present" value={`${dash.counts.present}/${dash.counts.total}`} color={colors.success} />
          <Stat label="Face verified" value={dash.counts.face_verified} />
          <Stat label="Pending" value={dash.counts.pending} />
          <Stat label="Requests" value={dash.counts.requests} color={dash.counts.requests ? colors.warning : undefined} />
        </Row>
      ) : null}

      <Button title="Open dashboard" variant="secondary" onPress={() => router.push({ pathname: '/teacher/dashboard/[id]', params: { id } })} />
      {!error ? <Button title="Close session" variant="danger" onPress={close} /> : null}
    </Screen>
  );
}
