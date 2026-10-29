export const colors = {
  bg: '#F4F6FA',
  card: '#FFFFFF',
  text: '#111827',
  muted: '#5B6475',
  border: '#E2E6EE',
  primary: '#2F5BEA',
  primaryDark: '#1E3FB0',
  primarySoft: '#E8EEFE',
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
export const radius = { sm: 8, md: 12, lg: 16, xl: 24 };

export const shadow = {
  shadowColor: '#0B1B4D',
  shadowOpacity: 0.08,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
};

export const statusStyle: Record<string, { label: string; fg: string; bg: string }> = {
  present: { label: 'Present', fg: colors.success, bg: colors.successBg },
  present_exception: { label: 'Present (exception)', fg: colors.info, bg: colors.infoBg },
  pending: { label: 'Pending', fg: colors.muted, bg: '#EEF0F4' },
  rejected: { label: 'Rejected', fg: colors.danger, bg: colors.dangerBg },
  absent: { label: 'Absent', fg: colors.danger, bg: colors.dangerBg },
  open: { label: 'Open now', fg: colors.warning, bg: colors.warningBg },
  expired: { label: 'Expired', fg: colors.muted, bg: '#EEF0F4' },
  closed: { label: 'Closed', fg: colors.muted, bg: '#EEF0F4' },
  approved: { label: 'Approved', fg: colors.success, bg: colors.successBg },
};

/** Session lifecycle shown to teachers: backend "open" is the Active state. */
export const sessionStatus: Record<string, { label: string; fg: string; bg: string }> = {
  scheduled: { label: 'Scheduled', fg: colors.info, bg: colors.infoBg },
  open: { label: 'Active', fg: colors.success, bg: colors.successBg },
  expired: { label: 'Ended', fg: colors.muted, bg: '#EEF0F4' },
  closed: { label: 'Closed', fg: colors.muted, bg: '#EEF0F4' },
  cancelled: { label: 'Cancelled', fg: colors.danger, bg: colors.dangerBg },
};

export function fmtDateTime(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtTime(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function fmtMinutes(m?: number | null) {
  if (m == null) return '—';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`;
}

export const roleLabel: Record<string, string> = {
  student: 'Student',
  teacher: 'Teacher',
  admin: 'Administrator',
  biometric_officer: 'Biometric officer',
};
