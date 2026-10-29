import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { Badge, Body, Card, Chip, ListItem, Row, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/theme';

interface Item {
  session_id: string;
  class_code: string;
  class_name: string;
  starts_at: string;
  status: string;
  method: string | null;
  marked_at: string | null;
}

export default function History() {
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const d = await api<{ history: Item[] }>('/attendance/me');
      setItems(d.history);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const codes = Array.from(new Set(items.map((i) => i.class_code)));
  const shown = filter ? items.filter((i) => i.class_code === filter) : items;

  return (
    <Screen refreshing={refreshing} onRefresh={load}>
      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label="All" selected={!filter} onPress={() => setFilter(null)} />
        {codes.map((c) => (
          <Chip key={c} label={c} selected={filter === c} onPress={() => setFilter(c)} />
        ))}
      </Row>
      <Card>
        {shown.length === 0 ? <Body muted>No sessions yet.</Body> : null}
        {shown.map((i) => (
          <ListItem
            key={i.session_id}
            title={`${i.class_code} – ${i.class_name}`}
            subtitle={`${fmtDateTime(i.starts_at)}${i.method ? ` · ${i.method}` : ''}`}
            right={
              <View>
                <Badge status={i.status} />
              </View>
            }
          />
        ))}
      </Card>
    </Screen>
  );
}
