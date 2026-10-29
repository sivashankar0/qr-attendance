import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';

import { colors } from '@/lib/theme';

import { MenuButton, ProfileButton } from './NavMenu';
import { IconName } from './ui';

export interface TabDef {
  name: string;
  title: string;
  icon: IconName;
  hidden?: boolean;
}

/** Bottom tabs + header with hamburger menu (left) and profile avatar (right). Shared by all roles. */
export function RoleTabs({ tabs }: { tabs: TabDef[] }) {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTitleStyle: { fontWeight: '800' },
        headerTitleAlign: 'center',
        headerLeft: () => <MenuButton />,
        headerRight: () => <ProfileButton />,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
        tabBarStyle: { height: 64, paddingTop: 6, paddingBottom: 8 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {tabs.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            href: t.hidden ? null : undefined,
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={(focused ? String(t.icon).replace('-outline', '') : t.icon) as IconName} size={size} color={color as string} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
