import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

// Public configuration only. The APK holds no secrets (roadmap 10.4).
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

const ACCESS_KEY = 'qa.access';
const REFRESH_KEY = 'qa.refresh';
const DEVICE_KEY = 'qa.device';

export type Role = 'student' | 'teacher' | 'admin' | 'biometric_officer';

export interface User {
  id: string;
  role: Role;
  college_id: string;
  full_name: string;
  email: string;
  identity_verified: boolean;
}

export class ApiError extends Error {
  status: number;
  reason?: string;
  body: any;
  constructor(status: number, message: string, body: any) {
    super(message);
    this.status = status;
    this.body = body;
    this.reason = body?.reason ?? body?.detail?.reason;
  }
}

let accessToken: string | null = null;
let deviceId: string | null = null;
let onUnauthorized: (() => void) | null = null;
let refreshing: Promise<boolean> | null = null;

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function loadTokens(): Promise<boolean> {
  accessToken = await SecureStore.getItemAsync(ACCESS_KEY);
  return !!(accessToken || (await SecureStore.getItemAsync(REFRESH_KEY)));
}

export async function saveTokens(access: string, refresh: string) {
  accessToken = access;
  await SecureStore.setItemAsync(ACCESS_KEY, access);
  await SecureStore.setItemAsync(REFRESH_KEY, refresh);
}

export async function clearTokens() {
  accessToken = null;
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export async function getRefreshToken() {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

/** Random per-install id. The server only stores an HMAC of it (shared-device detection). */
async function getDeviceId(): Promise<string> {
  if (deviceId) return deviceId;
  deviceId = await SecureStore.getItemAsync(DEVICE_KEY);
  if (!deviceId) {
    deviceId = Crypto.randomUUID();
    await SecureStore.setItemAsync(DEVICE_KEY, deviceId);
  }
  return deviceId;
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const rt = await getRefreshToken();
      if (!rt) return false;
      try {
        const res = await fetch(`${API_URL}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: rt }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        await saveTokens(data.access_token, data.refresh_token);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      setTimeout(() => (refreshing = null), 0);
    });
  }
  return refreshing;
}

function errorMessage(status: number, body: any): string {
  if (body?.message) return body.message;
  const d = body?.detail;
  if (typeof d === 'string') return d;
  if (d?.message) return d.message;
  if (Array.isArray(d)) return 'Some fields are invalid. Please check and try again.';
  if (status === 0) return 'Cannot reach the server. Check your connection.';
  return 'Something went wrong. Try again.';
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  raw?: boolean; // return text instead of JSON
  timeoutMs?: number;
}

export async function api<T = any>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Device-Id': await getDeviceId() };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.', null);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 && !retried && !path.startsWith('/auth/login')) {
    if (await tryRefresh()) return api<T>(path, opts, true);
    await clearTokens();
    onUnauthorized?.();
  }

  if (opts.raw && res.ok) return (await res.text()) as T;
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw new ApiError(res.status, errorMessage(res.status, body), body);
  return body as T;
}
