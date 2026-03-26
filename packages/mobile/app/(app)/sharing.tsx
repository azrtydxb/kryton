import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import { useRouter } from "expo-router";
import { database } from "../../src/db";
import NoteShareModel from "../../src/db/models/NoteShareModel";
import { api, AccessRequestData } from "../../src/lib/api";
import { useAuth } from "../../src/hooks/useAuth";
import { useNetworkStatus } from "../../src/hooks/useNetworkStatus";
import { colors, fontSize, spacing, borderRadius } from "../../src/lib/theme";

interface ShareRecord {
  id: string;
  ownerUserId: string;
  path: string;
  isFolder: boolean;
  permission: string;
  sharedWithUserId: string;
}

export default function SharingScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { isOnline } = useNetworkStatus();
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRequestData[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);

  useEffect(() => {
    const collection = database.get<NoteShareModel>("note_shares");
    const subscription = collection
      .query()
      .observe()
      .subscribe((records) => {
        setShares(
          records.map((r) => ({
            id: r.id,
            ownerUserId: r.ownerUserId,
            path: r.path,
            isFolder: r.isFolder,
            permission: r.permission,
            sharedWithUserId: r.sharedWithUserId,
          }))
        );
      });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isOnline) return;
    loadAccessRequests();
  }, [isOnline]);

  async function loadAccessRequests() {
    setLoadingRequests(true);
    try {
      const requests = await api.listAccessRequests();
      setAccessRequests(requests);
    } catch {
      // Silently fail — not critical
    } finally {
      setLoadingRequests(false);
    }
  }

  const myShares = user
    ? shares.filter((s) => s.ownerUserId === user.id)
    : [];
  const sharedWithMe = user
    ? shares.filter((s) => s.sharedWithUserId === user.id)
    : [];

  function permissionLabel(permission: string): string {
    if (permission === "readwrite") return "Read & Write";
    return "Read Only";
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Sharing</Text>
      </View>

      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>Requires connection for access request management</Text>
        </View>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* My Shares */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>My Shares</Text>
          {myShares.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyCardText}>
                You haven't shared any notes yet.
              </Text>
            </View>
          ) : (
            myShares.map((share) => (
              <View key={share.id} style={styles.shareRow}>
                <View style={styles.shareInfo}>
                  <Text style={styles.sharePath}>{share.path}</Text>
                  <Text style={styles.shareDetail}>
                    {share.isFolder ? "Folder" : "Note"} •{" "}
                    {permissionLabel(share.permission)}
                  </Text>
                  <Text style={styles.shareWith}>
                    Shared with: {share.sharedWithUserId}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Shared With Me */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Shared With Me</Text>
          {sharedWithMe.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyCardText}>
                No notes have been shared with you.
              </Text>
            </View>
          ) : (
            sharedWithMe.map((share) => (
              <View key={share.id} style={styles.shareRow}>
                <View style={styles.shareInfo}>
                  <Text style={styles.sharePath}>{share.path}</Text>
                  <Text style={styles.shareDetail}>
                    {share.isFolder ? "Folder" : "Note"} •{" "}
                    {permissionLabel(share.permission)}
                  </Text>
                  <Text style={styles.shareWith}>
                    From: {share.ownerUserId}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.openButton}
                  onPress={() => router.push(`/note/${share.path}`)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.openText}>Open</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* Access Requests */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Access Requests</Text>
          {!isOnline ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyCardText}>
                Requires connection to view access requests.
              </Text>
            </View>
          ) : loadingRequests ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.loadingText}>Loading requests...</Text>
            </View>
          ) : accessRequests.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyCardText}>No pending access requests.</Text>
            </View>
          ) : (
            accessRequests.map((req) => (
              <View key={req.id} style={styles.requestRow}>
                <View style={styles.requestInfo}>
                  <Text style={styles.requestPath}>{req.notePath}</Text>
                  <Text style={styles.requestDetail}>
                    From: {req.requesterName ?? req.requesterEmail ?? req.requesterUserId}
                  </Text>
                  <Text style={styles.requestStatus}>Status: {req.status}</Text>
                </View>
              </View>
            ))
          )}
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
  offlineBanner: {
    backgroundColor: colors.warning + "22",
    borderBottomWidth: 1,
    borderBottomColor: colors.warning + "44",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  offlineText: {
    color: colors.warning,
    fontSize: fontSize.sm,
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
  sectionLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
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
  shareRow: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  shareInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  sharePath: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
  shareDetail: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  shareWith: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  openButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  openText: {
    color: "#fff",
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  requestRow: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  requestInfo: {
    gap: spacing.xs,
  },
  requestPath: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
  requestDetail: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  requestStatus: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
});
