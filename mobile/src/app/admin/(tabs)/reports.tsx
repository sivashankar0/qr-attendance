import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { Badge, Banner, Body, Button, Card, Chip, H2, ListItem, Row, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

interface Rate {
  class_code: string;
  class_name: string;
  teacher: string;
  records: number;
  exceptions: number;
  exception_rate: number;
  flagged: boolean;
}

export default function Reports() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Rate[]>([]);
  const [retention, setRetention] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<Rate[]>(`/admin/reports/exceptions?days=${days}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load.');
    }
  }, [days]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const runRetention = async () => {
    setBusy(true);
    try {
      setRetention(await api('/admin/retention/run', { method: 'POST' }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Retention job failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {error ? <Banner kind="danger" title={error} /> : null}
      <Card>
        <H2>Manual exception rates</H2>
        <Row>
          {[7, 30, 90].map((d) => (
            <Chip key={d} label={`${d} days`} selected={days === d} onPress={() => setDays(d)} />
          ))}
        </Row>
        {rows.length === 0 ? <Body muted>No attendance in this period.</Body> : null}
        {rows.map((r) => (
          <ListItem
            key={r.class_code}
            title={`${r.class_code} – ${r.class_name}`}
            subtitle={`${r.teacher} · ${r.exceptions} of ${r.records} records (${Math.round(r.exception_rate * 100)}%)`}
            right={r.flagged ? <Badge status="rejected" label="Review" /> : null}
          />
        ))}
        <Body muted style={{ fontSize: 13 }}>Flagged when more than 15% of at least 10 records are manual exceptions.</Body>
      </Card>
      <Card>
        <H2>Data retention</H2>
        <Body muted>
          Runs automatically every 6 hours: purges verification results after 90 days, deletes templates of deactivated
          students after 30 days, and clears expired tokens.
        </Body>
        <Button title="Run now" variant="secondary" onPress={runRetention} loading={busy} />
        {retention ? (
          <Body>
            Purged: {retention.verification_results} verification results, {retention.templates} templates,{' '}
            {retention.challenges} challenges, {retention.refresh_tokens} tokens.
          </Body>
        ) : null}
      </Card>
    </Screen>
  );
}
