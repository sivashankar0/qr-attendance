import { useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { api, ApiError } from '@/lib/api';
import { TeacherClass } from '@/lib/teacher';
import { colors, fmtMinutes, space } from '@/lib/theme';

import { Banner, Body, Button, Card, Chip, ErrorText, Field, H2, Row } from './ui';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

function minutesBetween(a: string, b: string): number | null {
  if (!HHMM.test(a) || !HHMM.test(b)) return null;
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  const s = ah * 60 + am;
  const e = bh * 60 + bm;
  if (s === e) return null;
  return e > s ? e - s : e + 1440 - s;
}

/** Recommended weightage mirrors the backend rule: hours rounded to 0.25, min 0.25. */
function recommended(m: number | null) {
  return m ? Math.max(0.25, Math.round((m / 60) * 4) / 4) : null;
}

/**
 * Class timing + attendance weightage editor.
 * `endpoint` is /teacher/classes/{id} for teachers (own classes) or /admin/classes/{id} for admins.
 */
export function ClassScheduleEditor({ endpoint, initial, onSaved }: { endpoint: string; initial: TeacherClass; onSaved?: (c: TeacherClass) => void }) {
  // Initialised once from the loaded class; the parent remounts this (key) to reset it.
  const [start, setStart] = useState(initial.start_time ?? '');
  const [end, setEnd] = useState(initial.end_time ?? '');
  const [days, setDays] = useState<string[]>(initial.days_of_week ? initial.days_of_week.split(',') : []);
  const [auto, setAuto] = useState(initial.weightage == null);
  const [weight, setWeight] = useState(initial.weightage != null ? String(initial.weightage) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const minutes = start && end ? minutesBetween(start, end) : null;
  const rec = recommended(minutes);
  const crosses = minutes != null && HHMM.test(start) && HHMM.test(end) && end < start;

  const save = async () => {
    setError(null);
    setSaved(false);
    if ((start && !HHMM.test(start)) || (end && !HHMM.test(end))) return setError('Use 24-hour HH:MM times, e.g. 09:30 or 14:00.');
    if (!!start !== !!end) return setError('Enter both start and end time, or leave both empty.');
    if (start && minutes == null) return setError('Start and end time cannot be the same.');
    const w = Number(weight);
    if (!auto && (!weight || Number.isNaN(w) || w < 0.25 || w > 5)) return setError('Weightage must be a number between 0.25 and 5.');
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        start_time: start || null,
        end_time: end || null,
        days_of_week: days.join(',') || null,
      };
      if (auto) body.clear_weightage = true;
      else body.weightage = w;
      const c = await api<TeacherClass>(endpoint, { method: 'PATCH', body });
      setSaved(true);
      onSaved?.(c);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <H2>Class timing & weightage</H2>
      <Row style={{ gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Field label="Start (HH:MM)" icon="time-outline" value={start} onChangeText={setStart} placeholder="09:00" keyboardType="numbers-and-punctuation" maxLength={5} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="End (HH:MM)" icon="time-outline" value={end} onChangeText={setEnd} placeholder="10:00" keyboardType="numbers-and-punctuation" maxLength={5} />
        </View>
      </Row>
      <Body muted style={{ fontSize: 14 }}>
        Duration: <Text style={{ fontWeight: '800', color: colors.text }}>{fmtMinutes(minutes)}</Text>
        {crosses ? ' (ends the next day)' : ''}
      </Body>
      <Text style={{ fontWeight: '600', color: colors.muted }}>Days</Text>
      <Row style={{ flexWrap: 'wrap' }}>
        {DAYS.map((d) => (
          <Chip key={d} label={d} selected={days.includes(d)} onPress={() => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]))} />
        ))}
      </Row>

      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Body>Automatic weightage</Body>
          <Body muted style={{ fontSize: 13 }}>1 hour of class = 1.0 (rounded to 0.25)</Body>
        </View>
        <Switch value={auto} onValueChange={setAuto} accessibilityLabel="Automatic weightage" />
      </Row>
      {auto ? (
        <Banner kind="info" title={`Weightage: ${rec ?? 1.0}${rec == null ? ' (default – set timings to calculate)' : ''}`} />
      ) : (
        <Field label="Weightage (0.25 – 5)" icon="scale-outline" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" hint={rec != null ? `Recommended for ${fmtMinutes(minutes)}: ${rec}` : undefined} />
      )}
      <Body muted style={{ fontSize: 13 }}>
        Each session saves the weightage at the moment it starts, so changes apply to future sessions only. A student’s
        overall attendance % is weighted by these values.
      </Body>
      <ErrorText error={error} />
      {saved ? <Text style={{ color: colors.success, fontWeight: '700' }}>Saved.</Text> : null}
      <Button title="Save timing & weightage" icon="save-outline" onPress={save} loading={busy} />
    </Card>
  );
}
