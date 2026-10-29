/**
 * In-memory hand-off between attendance screens. Nonces live only in memory (never persisted,
 * never put in route params / URLs).
 */
export interface Challenge {
  nonce: string;
  challenge: 'turn_left' | 'turn_right';
  attempt_no: number;
  max_attempts: number;
}

export interface AttendanceResult {
  ok: boolean;
  reason?: string;
  message?: string;
  status?: string;
  method?: string;
  marked_at?: string;
  attempt_no?: number;
  max_attempts?: number;
  retry?: { nonce: string; challenge: Challenge['challenge']; attempt_no: number } | null;
  retry_after?: number;
  can_request_manual?: boolean;
  mode?: string;
  location_blocked?: boolean;
}

interface FlowState {
  sessionId?: string;
  classCode?: string;
  className?: string;
  challenge?: Challenge;
  result?: AttendanceResult;
}

let state: FlowState = {};

export const flow = {
  get: () => state,
  set: (patch: Partial<FlowState>) => {
    state = { ...state, ...patch };
  },
  clear: () => {
    state = {};
  },
};
