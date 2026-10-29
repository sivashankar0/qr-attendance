import { RoleTabs } from '@/components/TabsLayout';

export default function StudentTabs() {
  return (
    <RoleTabs
      tabs={[
        { name: 'index', title: 'Home', icon: 'home-outline' },
        { name: 'history', title: 'History', icon: 'calendar-outline' },
        { name: 'enrollment', title: 'Face', icon: 'happy-outline' },
        { name: 'profile', title: 'Profile', icon: 'person-circle-outline' },
      ]}
    />
  );
}
