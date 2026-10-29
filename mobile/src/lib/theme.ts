export const colors = {
  bg: '#F4F6FA',
  card: '#FFFFFF',
  text: '#111827',
  muted: '#5B6475',
  border: '#E2E6EE',
  primary: '#2F5BEA',
  primaryText: '#FFFFFF',
  success: '#14804A',
  successBg: '#E5F6EC',
  warning: '#A15C00',
  warningBg: '#FFF4E0',
  danger: '#C62828',
  dangerBg: '#FDECEC',
  info: '#1F5FAD',
  infoBg: '#E7F0FC',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16 };

export const statusStyle: Record<string, { label: string; fg: string; bg: string }> = {
  present: { label: 'Present', fg: colors.success, bg: colors.successBg },
  present_exception: { label: 'Present (exception)', fg: colors.info, bg: colors.infoBg },
  pending: { label: 'Pending', fg: colors.muted, bg: '#EEF0F4' },
  rejected: { label: 'Rejected', fg: colors.danger, bg: colors.dangerBg },
  absent: { label: 'Absent', fg: colors.danger, bg: colors.dangerBg },
  open: { label: 'Open now', fg: colors.warning, bg: colors.warningBg },
  expired: { label: 'Expired', fg: colors.muted, bg: '#EEF0F4' },
  closed: { label: 'Closed', fg: colors.muted, bg: '#EEF0F4' },
};

export function fmtDateTime(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtTime(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
