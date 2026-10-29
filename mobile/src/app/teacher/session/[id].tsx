import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Text, useWindowDimensions, View } from 'react-native';

import { QrMatrix } from '@/components/QrMatrix';
import { Badge, Banner, Body, Button, Card, Row, Screen, Stat } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { colors, sessionStatus, space } from '@/lib/theme';

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
  const [period, setPeriod] = useState(5);
  const [now, setNow] = useState(() => Date.now());
  const [dash, setDash] = useState<Dash | null>(null);
  const [ended, setEnded] = useState(false);
  const [netError, setNetError] = useState(false);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  // Rotating QR: fetch a fresh signed token right after each 5-second rotation.
  useEffect(() => {
    let cancelled = false;
    stopped.current = false;
    const fetchQr = async () => {
      try {
        const r = await api<{ qr: string; rotates_in: number; rotation_seconds: number }>(`/sessions/${id}/qr`, { timeoutMs: 8000 });
        if (cancelled || stopped.current) return;
        setQr(r.qr);
        setPeriod(r.rotation_seconds);
        setNetError(false);
        setRotateAt(Date.now() + r.rotates_in * 1000);
        timer.current = setTimeout(fetchQr, Math.max(300, r.rotates_in * 1000 + 150));
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 409) {
          // Closed or expired on the server: stop for good, never show a stale code.
          stopped.current = true;
          setQr(null);
          setEnded(true);
        } else {
          // Network hiccup: the old code is hidden once it expires; retry quickly.
          setNetError(true);
          timer.current = setTimeout(fetchQr, 1500);
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
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const d = await api<Dash>(`/sessions/${id}/attendance`);
        if (!active) return;
        setDash(d);
        if (d.session.status !== 'open') {
          stopped.current = true;
          setEnded(true);
          setQr(null);
        }
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

  const close = () => {
    const pending = dash ? dash.counts.total - dash.counts.present : 0;
    Alert.alert(
      'Close attendance session?',
      `${dash?.counts.present ?? 0} of ${dash?.counts.total ?? 0} students are marked present${pending ? ` and ${pending} have not marked yet` : ''}. ` +
        'Closing stops the timer and the QR code immediately; no more attendance can be submitted. Late cases go through manual verification.',
      [
        { text: 'Keep open', style: 'cancel' },
        {
          text: 'Close session',
          style: 'destructive',
          onPress: async () => {
            setClosing(true);
            try {
              await api(`/sessions/${id}/close`, { method: 'POST' });
              stopped.current = true;
              if (timer.current) clearTimeout(timer.current);
              setQr(null);
              setEnded(true);
              setDash((d) => (d ? { ...d, session: { ...d.session, status: 'closed' } } : d));
            } catch (e) {
              Alert.alert('Could not close the session', e instanceof ApiError ? e.message : 'Check your connection and try again.');
            } finally {
              setClosing(false);
            }
          },
        },
      ],
    );
  };

  const status = dash?.session.status ?? (ended ? 'closed' : 'open');
  const isActive = !ended && status === 'open';
  const secsLeft = dash ? Math.max(0, Math.floor((new Date(dash.session.expires_at).getTime() - now) / 1000)) : 0;
  const msToRotate = Math.max(0, rotateAt - now);
  const rotateIn = Math.ceil(msToRotate / 1000);
  const progress = period ? Math.min(1, msToRotate / (period * 1000)) : 0;
  const stale = netError && msToRotate === 0;
  const size = Math.min(width - space.lg * 2 - space.md * 2, 440);

  return (
    <Screen>
      <Stack.Screen options={{ title: dash ? `${dash.session.class_code} – ${dash.session.class_name}` : 'Attendance session' }} />

      <Row style={{ justifyContent: 'space-between' }}>
        <Badge status={status} palette={sessionStatus} />
        <Text style={{ fontWeight: '700', color: colors.muted }}>
          {dash?.session.face_required ? 'QR + Face' : 'QR only'}
          {dash?.session.location_restricted ? ` · 📍 ${dash.session.geofence_radius_m} m` : ''}
        </Text>
      </Row>

      {isActive ? (
        <View style={{ alignItems: 'center' }} accessibilityLabel={`Session time left ${Math.floor(secsLeft / 60)} minutes ${secsLeft % 60} seconds`}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' }}>Time left</Text>
          <Text style={{ fontSize: 40, fontWeight: '800', color: secsLeft < 60 ? colors.danger : colors.text, fontVariant: ['tabular-nums'] }}>
            {Math.floor(secsLeft / 60)}:{String(secsLeft % 60).padStart(2, '0')}
          </Text>
        </View>
      ) : null}

      {isActive ? (
        <Card style={{ alignItems: 'center', gap: space.sm }}>
          <View style={{ backgroundColor: '#fff', padding: space.md, borderRadius: 16 }}>
            {qr && !stale ? (
              <QrMatrix value={qr} size={size} />
            ) : (
              <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', gap: space.sm }}>
                <Ionicons name="cloud-offline-outline" size={40} color={colors.muted} />
                <Body muted>{qr ? 'Reconnecting…' : 'Loading code…'}</Body>
              </View>
            )}
          </View>
          <View style={{ width: '100%', height: 6, backgroundColor: '#E9EDF5', borderRadius: 3, overflow: 'hidden' }}>
            <View style={{ width: `${progress * 100}%`, height: 6, backgroundColor: colors.primary }} />
          </View>
          <Text style={{ color: colors.muted, fontSize: 15 }} accessibilityLiveRegion="polite">
            New code in {rotateIn}s · refreshes every {period} seconds
          </Text>
        </Card>
      ) : (
        <Card style={{ alignItems: 'center', paddingVertical: space.xl }}>
          <Ionicons name="lock-closed" size={44} color={colors.muted} />
          <Text style={{ fontSize: 20, fontWeight: '800' }}>Session {status === 'expired' ? 'ended' : 'closed'}</Text>
          <Body muted style={{ textAlign: 'center' }}>
            The QR code is no longer valid and no more attendance can be submitted.
          </Body>
        </Card>
      )}

      {isActive ? (
        <Button title="Close session" variant="danger" icon="stop-circle-outline" onPress={close} loading={closing} accessibilityHint="Stops the timer and attendance collection" />
      ) : null}

      {dash ? (
        <Row style={{ flexWrap: 'wrap' }}>
          <Stat label="Present" value={`${dash.counts.present}/${dash.counts.total}`} color={colors.success} />
          <Stat label="Face verified" value={dash.counts.face_verified} />
          <Stat label="Pending" value={dash.counts.pending} />
          <Stat label="Requests" value={dash.counts.requests} color={dash.counts.requests ? colors.warning : undefined} />
        </Row>
      ) : null}
      {dash?.counts.requests ? <Banner kind="warning" title={`${dash.counts.requests} student(s) asked for teacher verification`} /> : null}

      <Button title="Open attendance dashboard" variant="secondary" icon="list-outline" onPress={() => router.push({ pathname: '/teacher/dashboard/[id]', params: { id } })} />
    </Screen>
  );
}
