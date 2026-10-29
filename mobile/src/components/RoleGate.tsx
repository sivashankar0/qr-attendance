import { Redirect } from 'expo-router';
import { ReactNode } from 'react';

import { Role } from '@/lib/api';
import { useAuth } from '@/lib/auth';

import { Loading } from './ui';

/** UI-level guard only. The backend enforces every role check independently. */
export function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Redirect href="/welcome" />;
  if (!roles.includes(user.role)) return <Redirect href="/" />;
  return <>{children}</>;
}
