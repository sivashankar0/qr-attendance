import { RoleTabs } from '@/components/TabsLayout';

export default function TeacherTabs() {
  return (
    <RoleTabs
      tabs={[
        { name: 'index', title: 'Dashboard', icon: 'grid-outline' },
        { name: 'classes', title: 'Classes', icon: 'school-outline' },
        { name: 'sessions', title: 'Sessions', icon: 'time-outline' },
        { name: 'reports', title: 'Reports', icon: 'bar-chart-outline' },
        { name: 'profile', title: 'Profile', icon: 'person-circle-outline' },
      ]}
    />
  );
}
