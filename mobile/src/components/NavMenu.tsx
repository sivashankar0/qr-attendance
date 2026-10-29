/**
 * Role-based navigation: hamburger menu (header left) + profile avatar (header right).
 * UI-level only; every screen's data is still protected by backend role checks.
 */
import { Ionicons } from '@expo/vector-icons';
import { Href, router, usePathname } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth';
import { colors, roleLabel, space } from '@/lib/theme';

import { Avatar, IconButton, IconName } from './ui';

export interface NavItem {
  label: string;
  icon: IconName;
  href: string;
}

export function navFor(role?: string): NavItem[] {
  switch (role) {
    case 'student':
      return [
        { label: 'Home', icon: 'home-outline', href: '/student' },
        { label: 'Scan QR', icon: 'qr-code-outline', href: '/student/scan' },
        { label: 'Attendance history', icon: 'calendar-outline', href: '/student/history' },
        { label: 'Face verification', icon: 'happy-outline', href: '/student/enrollment' },
        { label: 'Profile', icon: 'person-circle-outline', href: '/student/profile' },
      ];
    case 'teacher':
      return [
        { label: 'Dashboard', icon: 'grid-outline', href: '/teacher' },
        { label: 'Classes', icon: 'school-outline', href: '/teacher/classes' },
        { label: 'Attendance sessions', icon: 'time-outline', href: '/teacher/sessions' },
        { label: 'Reports', icon: 'bar-chart-outline', href: '/teacher/reports' },
        { label: 'Profile', icon: 'person-circle-outline', href: '/teacher/profile' },
      ];
    case 'admin':
      return [
        { label: 'Dashboard', icon: 'grid-outline', href: '/admin' },
        { label: 'User management', icon: 'people-outline', href: '/admin/users' },
        { label: 'Face change approvals', icon: 'shield-checkmark-outline', href: '/admin/face-changes' },
        { label: 'Classes', icon: 'school-outline', href: '/admin/classes' },
        { label: 'Enrollments & opt-outs', icon: 'finger-print-outline', href: '/admin/enrollments' },
        { label: 'Reports', icon: 'bar-chart-outline', href: '/admin/reports' },
        { label: 'Audit log', icon: 'document-text-outline', href: '/admin/audit' },
        { label: 'Settings & profile', icon: 'settings-outline', href: '/admin/profile' },
      ];
    case 'biometric_officer':
      return [
        { label: 'Dashboard', icon: 'grid-outline', href: '/admin' },
        { label: 'Users', icon: 'people-outline', href: '/admin/users' },
        { label: 'Face change approvals', icon: 'shield-checkmark-outline', href: '/admin/face-changes' },
        { label: 'Enrollments & opt-outs', icon: 'finger-print-outline', href: '/admin/enrollments' },
        { label: 'Audit log', icon: 'document-text-outline', href: '/admin/audit' },
        { label: 'Settings & profile', icon: 'settings-outline', href: '/admin/profile' },
      ];
    default:
      return [];
  }
}

export function profileHref(role?: string): string {
  return role === 'student' ? '/student/profile' : role === 'teacher' ? '/teacher/profile' : '/admin/profile';
}

export function MenuButton() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = navFor(user?.role);

  const go = (href: string) => {
    setOpen(false);
    if (href !== pathname) router.navigate(href as Href);
  };

  return (
    <>
      <View style={{ marginLeft: space.sm }}>
        <IconButton icon="menu" label="Open menu" onPress={() => setOpen(true)} />
      </View>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close menu" />
        <SafeAreaView style={styles.drawer} edges={['top', 'bottom', 'left']}>
          <View style={styles.drawerHead}>
            <Avatar name={user?.full_name} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{user?.full_name}</Text>
              <Text style={styles.role}>
                {roleLabel[user?.role ?? ''] ?? ''} · {user?.college_id}
              </Text>
            </View>
          </View>
          <View style={{ gap: 2, flex: 1 }}>
            {items.map((i) => {
              const active = pathname === i.href;
              return (
                <Pressable
                  key={i.href}
                  onPress={() => go(i.href)}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: active }}
                  style={[styles.item, active && styles.itemActive]}
                >
                  <Ionicons name={i.icon} size={22} color={active ? colors.primary : colors.muted} />
                  <Text style={[styles.itemText, active && { color: colors.primary }]}>{i.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            onPress={async () => {
              setOpen(false);
              await logout();
              router.replace('/welcome');
            }}
            style={styles.item}
            accessibilityRole="button"
          >
            <Ionicons name="log-out-outline" size={22} color={colors.danger} />
            <Text style={[styles.itemText, { color: colors.danger }]}>Sign out</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>
    </>
  );
}

export function ProfileButton() {
  const { user } = useAuth();
  return (
    <Pressable
      onPress={() => router.navigate(profileHref(user?.role) as Href)}
      accessibilityRole="button"
      accessibilityLabel="Open profile and settings"
      style={{ marginRight: space.md }}
      hitSlop={8}
    >
      <Avatar name={user?.full_name} size={34} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10,20,40,0.45)' },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '80%',
    maxWidth: 340,
    backgroundColor: colors.card,
    paddingHorizontal: space.md,
    paddingBottom: space.md,
  },
  drawerHead: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'center',
    paddingVertical: space.xl,
    paddingHorizontal: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: space.sm,
  },
  name: { fontSize: 17, fontWeight: '800', color: colors.text },
  role: { fontSize: 14, color: colors.muted, marginTop: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 14, paddingHorizontal: space.md, borderRadius: 12 },
  itemActive: { backgroundColor: colors.primarySoft },
  itemText: { fontSize: 16, fontWeight: '600', color: colors.text },
});
