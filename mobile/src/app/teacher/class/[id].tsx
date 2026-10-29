import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Switch, View } from 'react-native';

import { Badge, Body, Button, Card, Chip, ErrorText, H2, ListItem, Row, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { getFix, LocationError } from '@/lib/location';
import { fmtDateTime, space } from '@/lib/theme';

interface SessionItem {
  id: string;
  class_code: string;
  class_name: string;
  starts_at: string;
  expires_at: string;
  status: string;
  face_required: boolean;
  location_restricted: boolean;
  geofence_radius_m: number | null;
  present_count: number;
}

const DURATIONS = [5, 10, 15, 30, 60];
const RADII = [50, 100, 200];

export default function ClassScreen() {
  const { id, title: titleParam } = useLocalSearchParams<{ id: string; title?: string }>();
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [duration, setDuration] = useState(10);
  const [faceRequired, setFaceRequired] = useState(true);
  const [locationOn, setLocationOn] = useState(true);
  const [radius, setRadius] = useState(100);
  const [step, setStep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setSessions(await api<SessionItem[]>(`/teacher/classes/${id}/sessions`));
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { class_id: id, duration_minutes: duration, face_required: faceRequired };
      if (locationOn) {
        setStep('Getting your location… (stand inside the classroom)');
        const fix = await getFix();
        body.location = fix;
        body.geofence_radius_m = radius;
      }
      setStep('Starting session…');
      const s = await api<SessionItem>('/sessions', { body });
      router.push({ pathname: '/teacher/session/[id]', params: { id: s.id } });
    } catch (e) {
      setError(
        e instanceof LocationError
          ? `${e.message} You can also turn off "Restrict to classroom location".`
          : e instanceof ApiError
            ? e.message
            : 'Could not start the session.',
      );
    } finally {
      setStep(null);
      setBusy(false);
    }
  };

  const open = sessions.find((s) => s.status === 'open');
  const title = titleParam ?? sessions[0]?.class_code ?? 'Class';

  return (
    <Screen refreshing={refreshing} onRefresh={load}>
      <Stack.Screen options={{ title }} />
      {open ? (
        <Card>
          <H2>Session in progress</H2>
          <Body muted>Started {fmtDateTime(open.starts_at)} · {open.present_count} present</Body>
          <Button title="Show QR code" onPress={() => router.push({ pathname: '/teacher/session/[id]', params: { id: open.id } })} />
          <Button
            title="Open dashboard"
            variant="secondary"
            onPress={() => router.push({ pathname: '/teacher/dashboard/[id]', params: { id: open.id } })}
          />
        </Card>
      ) : (
        <Card>
          <H2>Start attendance</H2>
          <Body muted>Duration</Body>
          <Row style={{ flexWrap: 'wrap' }}>
            {DURATIONS.map((d) => (
              <Chip key={d} label={`${d} min`} selected={duration === d} onPress={() => setDuration(d)} />
            ))}
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Body>Face verification required</Body>
              <Body muted style={{ fontSize: 13 }}>Recommended. Turn off only for low-stakes sessions.</Body>
            </View>
            <Switch value={faceRequired} onValueChange={setFaceRequired} accessibilityLabel="Face verification required" />
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Body>Restrict to classroom location</Body>
              <Body muted style={{ fontSize: 13 }}>Uses your phone’s position now. Students must be within the radius.</Body>
            </View>
            <Switch value={locationOn} onValueChange={setLocationOn} accessibilityLabel="Restrict to classroom location" />
          </Row>
          {locationOn ? (
            <Row style={{ flexWrap: 'wrap' }}>
              {RADII.map((r) => (
                <Chip key={r} label={`${r} m`} selected={radius === r} onPress={() => setRadius(r)} />
              ))}
            </Row>
          ) : null}
          {step ? <Body muted>{step}</Body> : null}
          <ErrorText error={error} />
          <Button title="Start session & show QR" onPress={start} loading={busy} />
        </Card>
      )}

      <Card>
        <H2>Past sessions</H2>
        {sessions.length === 0 ? <Body muted>No sessions yet.</Body> : null}
        {sessions.map((s) => (
          <ListItem
            key={s.id}
            title={fmtDateTime(s.starts_at)}
            subtitle={`${s.present_count} present · ${s.face_required ? 'QR + Face' : 'QR only'}${s.location_restricted ? ` · ${s.geofence_radius_m} m` : ''}`}
            right={<Badge status={s.status} />}
            onPress={() => router.push({ pathname: '/teacher/dashboard/[id]', params: { id: s.id } })}
          />
        ))}
      </Card>
      <View style={{ height: space.md }} />
    </Screen>
  );
}
