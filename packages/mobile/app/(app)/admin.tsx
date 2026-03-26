import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
  SafeAreaView,
} from "react-native";
import { useRouter } from "expo-router";
import { api } from "../../src/lib/api";
import { useAuth } from "../../src/hooks/useAuth";
import { useNetworkStatus } from "../../src/hooks/useNetworkStatus";
import { colors, fontSize, spacing, borderRadius } from "../../src/lib/theme";

interface UserRecord {
  id: string;
  name: string;
  email: string;
  role?: string;
  disabled?: boolean;
}

interface InviteCode {
  code: string;
  createdAt: string;
  usedAt?: string | null;
}

export default function AdminScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { isOnline } = useNetworkStatus();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [newInviteEmail, setNewInviteEmail] = useState("");

  // Redirect non-admins
  const isAdmin = (user as (UserRecord & { role?: string }) | null)?.role === "admin";

  useEffect(() => {
    if (!isOnline || !isAdmin) {
      setLoading(false);
      return;
    }
    loadData();
  }, [isOnline, isAdmin]);

  async function loadData() {
    setLoading(true);
    try {
      const userList = await api.listUsers();
      setUsers(userList as UserRecord[]);
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Could not load users"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleRole(targetUser: UserRecord) {
    if (!isOnline) {
      Alert.alert("Requires connection", "This action requires an internet connection.");
      return;
    }
    const newRole = targetUser.role === "admin" ? "user" : "admin";
    Alert.alert(
      "Change Role",
      `Set ${targetUser.name} to ${newRole}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: async () => {
            try {
              await fetch; // placeholder — actual endpoint depends on server API
              setUsers((prev) =>
                prev.map((u) =>
                  u.id === targetUser.id ? { ...u, role: newRole } : u
                )
              );
            } catch (err) {
              Alert.alert(
                "Error",
                err instanceof Error ? err.message : "Could not update role"
              );
            }
          },
        },
      ]
    );
  }

  async function handleToggleDisabled(targetUser: UserRecord) {
    if (!isOnline) {
      Alert.alert("Requires connection", "This action requires an internet connection.");
      return;
    }
    const action = targetUser.disabled ? "Enable" : "Disable";
    Alert.alert(`${action} User`, `${action} ${targetUser.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: action,
        style: targetUser.disabled ? "default" : "destructive",
        onPress: async () => {
          try {
            // Update local state optimistically; server call would go here
            setUsers((prev) =>
              prev.map((u) =>
                u.id === targetUser.id
                  ? { ...u, disabled: !u.disabled }
                  : u
              )
            );
          } catch (err) {
            Alert.alert(
              "Error",
              err instanceof Error ? err.message : "Could not update user"
            );
          }
        },
      },
    ]);
  }

  function handleCreateInvite() {
    if (!isOnline) {
      Alert.alert("Requires connection", "This action requires an internet connection.");
      return;
    }
    setNewInviteEmail("");
    setInviteModalVisible(true);
  }

  async function handleGenerateInvite() {
    // Placeholder — generate invite code via server
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    setInviteCodes((prev) => [
      { code, createdAt: new Date().toISOString(), usedAt: null },
      ...prev,
    ]);
    setInviteModalVisible(false);
    Alert.alert("Invite Code Created", `Code: ${code}`);
  }

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Admin</Text>
        </View>
        <View style={styles.centerState}>
          <Text style={styles.centerTitle}>Access Denied</Text>
          <Text style={styles.centerSubtext}>
            You do not have admin privileges.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isOnline) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Admin</Text>
        </View>
        <View style={styles.centerState}>
          <Text style={styles.centerTitle}>Requires connection</Text>
          <Text style={styles.centerSubtext}>
            The admin panel is only available when online.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Admin</Text>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.centerSubtext}>Loading...</Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {/* Users */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>
                Users ({users.length})
              </Text>
              <TouchableOpacity onPress={loadData}>
                <Text style={styles.refreshText}>Refresh</Text>
              </TouchableOpacity>
            </View>
            {users.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyCardText}>No users found.</Text>
              </View>
            ) : (
              users.map((u) => (
                <View key={u.id} style={styles.userRow}>
                  <View style={styles.userInfo}>
                    <View style={styles.userNameRow}>
                      <Text style={styles.userName}>{u.name}</Text>
                      {u.role === "admin" && (
                        <View style={styles.adminBadge}>
                          <Text style={styles.adminBadgeText}>Admin</Text>
                        </View>
                      )}
                      {u.disabled && (
                        <View style={styles.disabledBadge}>
                          <Text style={styles.disabledBadgeText}>Disabled</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.userEmail}>{u.email}</Text>
                  </View>
                  <View style={styles.userActions}>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => handleToggleRole(u)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.actionText}>
                        {u.role === "admin" ? "Demote" : "Promote"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.actionButton,
                        u.disabled ? styles.enableButton : styles.disableButton,
                      ]}
                      onPress={() => handleToggleDisabled(u)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.actionText,
                          u.disabled
                            ? styles.enableText
                            : styles.disableText,
                        ]}
                      >
                        {u.disabled ? "Enable" : "Disable"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* Invite Codes */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>Invite Codes</Text>
              <TouchableOpacity
                style={styles.createInviteButton}
                onPress={handleCreateInvite}
                activeOpacity={0.8}
              >
                <Text style={styles.createInviteText}>+ New Code</Text>
              </TouchableOpacity>
            </View>
            {inviteCodes.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyCardText}>
                  No invite codes yet. Create one to invite new users.
                </Text>
              </View>
            ) : (
              inviteCodes.map((invite) => (
                <View key={invite.code} style={styles.inviteRow}>
                  <Text style={styles.inviteCode}>{invite.code}</Text>
                  <Text style={styles.inviteDate}>
                    {invite.usedAt ? "Used" : "Active"}
                  </Text>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}

      <Modal
        visible={inviteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setInviteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create Invite Code</Text>
            <Text style={styles.modalSubtitle}>
              Generate a one-time invite code for a new user.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={newInviteEmail}
              onChangeText={setNewInviteEmail}
              placeholder="Email (optional)"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setInviteModalVisible(false)}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.generateButton}
                onPress={handleGenerateInvite}
              >
                <Text style={styles.generateText}>Generate</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  backButton: {
    paddingVertical: spacing.xs,
  },
  backText: {
    color: colors.primary,
    fontSize: fontSize.md,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: "700",
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  centerTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  centerSubtext: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: "center",
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  section: {
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  refreshText: {
    color: colors.primary,
    fontSize: fontSize.sm,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  emptyCardText: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: "center",
  },
  userRow: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  userInfo: {
    gap: spacing.xs,
  },
  userNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  userName: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
  adminBadge: {
    backgroundColor: colors.primary + "33",
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.primary + "66",
  },
  adminBadgeText: {
    color: colors.primary,
    fontSize: fontSize.xs,
    fontWeight: "700",
  },
  disabledBadge: {
    backgroundColor: colors.error + "22",
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.error + "44",
  },
  disabledBadgeText: {
    color: colors.error,
    fontSize: fontSize.xs,
    fontWeight: "700",
  },
  userEmail: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  userActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  enableButton: {
    borderColor: colors.success + "66",
    backgroundColor: colors.success + "22",
  },
  enableText: {
    color: colors.success,
  },
  disableButton: {
    borderColor: colors.error + "66",
    backgroundColor: colors.error + "22",
  },
  disableText: {
    color: colors.error,
  },
  createInviteButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  createInviteText: {
    color: "#fff",
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  inviteRow: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  inviteCode: {
    color: colors.text,
    fontSize: fontSize.md,
    fontFamily: "monospace",
    fontWeight: "600",
  },
  inviteDate: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    width: "100%",
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  modalTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  modalSubtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  modalInput: {
    backgroundColor: colors.background,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
  },
  modalButtons: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
  generateButton: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
  },
  generateText: {
    color: "#fff",
    fontSize: fontSize.md,
    fontWeight: "700",
  },
});
