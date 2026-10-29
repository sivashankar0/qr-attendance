import { Ionicons } from '@expo/vector-icons';
import { ReactNode, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { colors, radius, space } from '@/lib/theme';

import { Chip, EmptyState, IconName, Row } from './ui';

export interface Column<T> {
  key: string;
  title: string;
  width: number;
  /** Value used for search and sort. */
  value?: (row: T) => string | number | null | undefined;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
}

export interface Filter<T> {
  key: string;
  label: string;
  test: (row: T) => boolean;
}

/** Search + sort + filter chips + pagination. Scrolls horizontally on narrow screens. */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  filters,
  searchPlaceholder = 'Search',
  pageSize = 10,
  emptyTitle = 'No records yet',
  emptyBody,
  emptyIcon,
  onRowPress,
  loading,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  filters?: Filter<T>[];
  searchPlaceholder?: string;
  pageSize?: number;
  emptyTitle?: string;
  emptyBody?: string;
  emptyIcon?: IconName;
  onRowPress?: (row: T) => void;
  loading?: boolean;
}) {
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const tableWidth = columns.reduce((s, c) => s + c.width, 0);
  // On wide screens stretch columns to fill; on phones keep widths and scroll sideways.
  const scale = Math.max(1, (width - space.lg * 4) / tableWidth);

  const shown = useMemo(() => {
    let out = rows;
    const f = filters?.find((x) => x.key === filter);
    if (f) out = out.filter(f.test);
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        columns.some((c) => {
          const v = c.value?.(r);
          return v != null && String(v).toLowerCase().includes(q);
        }),
      );
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.value) {
        out = [...out].sort((a, b) => {
          const va = col.value!(a);
          const vb = col.value!(b);
          if (va == null) return 1;
          if (vb == null) return -1;
          return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
        });
      }
    }
    return out;
  }, [rows, columns, filters, filter, query, sort]);

  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const current = Math.min(page, pages - 1);
  const pageRows = shown.slice(current * pageSize, current * pageSize + pageSize);

  const toggleSort = (key: string) => {
    setPage(0);
    setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));
  };

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.search}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            setPage(0);
          }}
          placeholder={searchPlaceholder}
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          accessibilityLabel={searchPlaceholder}
          autoCorrect={false}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} accessibilityLabel="Clear search" hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {filters?.length ? (
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="All" selected={!filter} onPress={() => { setFilter(null); setPage(0); }} />
          {filters.map((f) => (
            <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => { setFilter(f.key); setPage(0); }} />
          ))}
        </Row>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator bounces={false}>
        <View style={styles.table}>
          <View style={[styles.tr, styles.thead]}>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const content = (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start' }}>
                  <Text style={styles.th} numberOfLines={1}>{c.title}</Text>
                  {c.sortable ? (
                    <Ionicons
                      name={active ? (sort!.dir === 1 ? 'arrow-up' : 'arrow-down') : 'swap-vertical'}
                      size={14}
                      color={active ? colors.primary : colors.muted}
                    />
                  ) : null}
                </View>
              );
              return (
                <View key={c.key} style={[styles.cell, { width: c.width * scale }]}>
                  {c.sortable ? (
                    <Pressable onPress={() => toggleSort(c.key)} accessibilityRole="button" accessibilityLabel={`Sort by ${c.title}`}>
                      {content}
                    </Pressable>
                  ) : (
                    content
                  )}
                </View>
              );
            })}
          </View>
          {pageRows.map((r, i) => {
            const cells = columns.map((c) => (
              <View key={c.key} style={[styles.cell, { width: c.width * scale, alignItems: c.align === 'right' ? 'flex-end' : c.align === 'center' ? 'center' : 'flex-start' }]}>
                {c.render ? c.render(r) : <Text style={styles.td} numberOfLines={2}>{String(c.value?.(r) ?? '—')}</Text>}
              </View>
            ));
            const style = [styles.tr, i % 2 === 1 && { backgroundColor: '#FAFBFD' }];
            return onRowPress ? (
              <Pressable key={rowKey(r)} onPress={() => onRowPress(r)} style={({ pressed }) => [...style, pressed && { backgroundColor: colors.primarySoft }]} accessibilityRole="button">
                {cells}
              </Pressable>
            ) : (
              <View key={rowKey(r)} style={style}>
                {cells}
              </View>
            );
          })}
        </View>
      </ScrollView>

      {!loading && shown.length === 0 ? (
        <EmptyState icon={emptyIcon} title={query || filter ? 'No matching records' : emptyTitle} body={query || filter ? 'Try a different search or filter.' : emptyBody} />
      ) : null}

      {shown.length > pageSize ? (
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ color: colors.muted }}>
            {current * pageSize + 1}–{Math.min(shown.length, (current + 1) * pageSize)} of {shown.length}
          </Text>
          <Row>
            <Pressable disabled={current === 0} onPress={() => setPage(current - 1)} style={[styles.pageBtn, current === 0 && { opacity: 0.4 }]} accessibilityLabel="Previous page">
              <Ionicons name="chevron-back" size={18} color={colors.primary} />
            </Pressable>
            <Text style={{ fontWeight: '700' }}>
              {current + 1} / {pages}
            </Text>
            <Pressable disabled={current >= pages - 1} onPress={() => setPage(current + 1)} style={[styles.pageBtn, current >= pages - 1 && { opacity: 0.4 }]} accessibilityLabel="Next page">
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </Pressable>
          </Row>
        </Row>
      ) : shown.length > 0 ? (
        <Text style={{ color: colors.muted }}>{shown.length} record{shown.length === 1 ? '' : 's'}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    backgroundColor: colors.card,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 15, color: colors.text },
  table: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  tr: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.card },
  thead: { backgroundColor: '#F1F4FA' },
  cell: { paddingHorizontal: space.sm, paddingVertical: 10, justifyContent: 'center' },
  th: { fontWeight: '700', color: colors.muted, fontSize: 13, textTransform: 'uppercase' },
  td: { fontSize: 14, color: colors.text },
  pageBtn: { padding: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
});
