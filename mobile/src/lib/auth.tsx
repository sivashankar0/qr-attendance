import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, clearTokens, getRefreshToken, loadTokens, saveTokens, setUnauthorizedHandler, User } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const data = await api<{ user: User }>('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    (async () => {
      if (await loadTokens()) await reload();
      setLoading(false);
    })();
  }, [reload]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api<{ access_token: string; refresh_token: string; user: User }>('/auth/login', {
      body: { username, password },
    });
    await saveTokens(data.access_token, data.refresh_token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    const rt = await getRefreshToken();
    if (rt) {
      try {
        await api('/auth/logout', { body: { refresh_token: rt } });
      } catch {
        // still clear locally
      }
    }
    await clearTokens();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, reload }), [user, loading, login, logout, reload]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function homeFor(role: User['role']): '/student' | '/teacher' | '/admin' {
  if (role === 'student') return '/student';
  if (role === 'teacher') return '/teacher';
  return '/admin';
}
