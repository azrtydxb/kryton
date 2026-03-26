import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../../src/hooks/useAuth";
import { SyncStatus } from "../../../src/components/SyncStatus";
import { colors, fontSize, spacing, borderRadius } from "../../../src/lib/theme";

interface NavRow {
  label: string;
  route: string;
  adminOnly?: boolean;
}

const navRows: NavRow[] = [
  { label: "Daily Notes", route: "/(app)/daily" },
  { label: "Templates", route: "/(app)/templates" },
  { label: "Trash", route: "/(app)/trash" },
  { label: "Sharing", route: "/(app)/sharing" },
  { label: "Admin", route: "/(app)/admin", adminOnly: true },
];

export default function SettingsScreen() {
  const { logout, user, serverUrl } = useAuth();
  const router = useRouter();

  const isAdmin =
    user && (user as typeof user & { role?: string }).role === "admin";

  function handleLogout() {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: () => logout(),
      },
    ]);
  }

  const visibleNavRows = navRows.filter(
    (row) => !row.adminOnly || isAdmin
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Account */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account</Text>
          {user && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Name</Text>
              <Text style={styles.infoValue}>{user.name}</Text>
            </View>
          )}
          {user && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>{user.email}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Server</Text>
            <Text style={styles.infoValue} numberOfLines={1}>
              {serverUrl ?? "Not configured"}
            </Text>
          </View>
        </View>

        {/* Sync */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Sync</Text>
          <SyncStatus />
        </View>

        {/* Navigation */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Navigation</Text>
          {visibleNavRows.map((row) => (
            <TouchableOpacity
              key={row.route}
              style={styles.navRow}
              onPress={() => router.push(row.route as Parameters<typeof router.push>[0])}
              activeOpacity={0.7}
            >
              <Text style={styles.navLabel}>{row.label}</Text>
              <Text style={styles.navArrow}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Sign Out */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.logoutButton}
            onPress={handleLogout}
            activeOpacity={0.8}
          >
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: "700",
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: spacing.xxl,
  },
  section: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    width: 60,
  },
  infoValue: {
    color: colors.text,
    fontSize: fontSize.md,
    flex: 1,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "space-between",
  },
  navLabel: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "500",
  },
  navArrow: {
    color: colors.textMuted,
    fontSize: fontSize.lg,
  },
  logoutButton: {
    backgroundColor: colors.error,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  logoutText: {
    color: "#fff",
    fontSize: fontSize.md,
    fontWeight: "700",
  },
});
