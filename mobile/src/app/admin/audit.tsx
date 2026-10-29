import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { Body, Card, Chip, ListItem, Row, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/theme';

interface Entry {
  id: number;
  actor_id: string | null;
  action: string;
  target_id: string | null;
  ip: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

const FILTERS = ['', 'template', 'enrollment', 'consent', 'exception', 'attendance', 'auth', 'anomaly', 'user'];

export default function Audit() {
  const [action, setAction] = useState('');
  const [items, setItems] = useState<Entry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setItems(await api<Entry[]>(`/admin/audit?limit=300${action ? `&action=${action}` : ''}`));
    } finally {
      setRefreshing(false);
    }
  }, [action]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <Screen refreshing={refreshing} onRefresh={load}>
      <Row style={{ flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <Chip key={f || 'all'} label={f || 'All'} selected={action === f} onPress={() => setAction(f)} />
        ))}
      </Row>
      <Card>
        {items.length === 0 ? <Body muted>No entries.</Body> : null}
        {items.map((e) => (
          <ListItem
            key={e.id}
            title={e.action}
            subtitle={`${fmtDateTime(e.created_at)} · actor ${e.actor_id?.slice(0, 8) ?? 'system'}${
              e.target_id ? ` → ${e.target_id.slice(0, 8)}` : ''
            }${e.ip ? ` · ${e.ip}` : ''}${e.details ? ` · ${JSON.stringify(e.details)}` : ''}`}
          />
        ))}
      </Card>
    </Screen>
  );
}
