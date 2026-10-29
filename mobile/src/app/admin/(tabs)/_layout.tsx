import { RoleTabs } from '@/components/TabsLayout';
import { useAuth } from '@/lib/auth';

export default function AdminTabs() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  return (
    <RoleTabs
      tabs={[
        { name: 'index', title: 'Dashboard', icon: 'grid-outline' },
        { name: 'users', title: 'Users', icon: 'people-outline' },
        { name: 'face-changes', title: 'Face changes', icon: 'shield-checkmark-outline' },
        // Reports are admin-only (backend enforces this too).
        { name: 'reports', title: 'Reports', icon: 'bar-chart-outline', hidden: !isAdmin },
        { name: 'profile', title: 'Settings', icon: 'settings-outline' },
      ]}
    />
  );
}
