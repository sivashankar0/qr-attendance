/** Shared teacher-side types and helpers (data always comes from the backend). */
export interface TeacherClass {
  id: string;
  code: string;
  name: string;
  term: string;
  student_count: number;
  start_time: string | null;
  end_time: string | null;
  crosses_midnight: boolean;
  days_of_week: string | null;
  duration_minutes: number | null;
  weightage: number | null;
  recommended_weightage: number | null;
  effective_weightage: number;
  latest_session: { id: string; status: string; starts_at: string } | null;
}

export interface TeacherSession {
  id: string;
  class_id: string;
  class_code: string;
  class_name: string;
  starts_at: string;
  ends_at: string;
  expires_at: string;
  closed_at: string | null;
  duration_minutes: number;
  status: string;
  face_required: boolean;
  location_restricted: boolean;
  geofence_radius_m: number | null;
  weight: number;
  present_count: number;
  total_students: number;
  attendance_percent: number | null;
}

export function timing(c: Pick<TeacherClass, 'start_time' | 'end_time' | 'crosses_midnight'>) {
  if (!c.start_time || !c.end_time) return 'Not scheduled';
  return `${c.start_time}–${c.end_time}${c.crosses_midnight ? ' (+1 day)' : ''}`;
}
