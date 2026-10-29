import { Redirect } from 'expo-router';

import { Loading } from '@/components/ui';
import { homeFor, useAuth } from '@/lib/auth';

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Redirect href="/welcome" />;
  return <Redirect href={homeFor(user.role)} />;
}
