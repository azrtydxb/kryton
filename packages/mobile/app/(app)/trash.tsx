import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  SafeAreaView,
} from "react-native";
import { useRouter } from "expo-router";
import { database } from "../../src/db";
import TrashItemModel from "../../src/db/models/TrashItemModel";
import { api } from "../../src/lib/api";
import { useNetworkStatus } from "../../src/hooks/useNetworkStatus";
import { colors, fontSize, spacing, borderRadius } from "../../src/lib/theme";
import { timeAgo } from "../../src/lib/utils";

interface TrashRecord {
  id: string;
  originalPath: string;
  trashedAt: Date;
}

export default function TrashScreen() {
  const router = useRouter();
  const { isOnline } = useNetworkStatus();
  const [trashItems, setTrashItems] = useState<TrashRecord[]>([]);

  useEffect(() => {
    const collection = database.get<TrashItemModel>("trash_items");
    const subscription = collection
      .query()
      .observe()
      .subscribe((records) => {
        const items = records
          .sort((a, b) => b.trashedAt.getTime() - a.trashedAt.getTime())
          .map((r) => ({
            id: r.id,
            originalPath: r.originalPath,
            trashedAt: r.trashedAt,
          }));
        setTrashItems(items);
      });
    return () => subscription.unsubscribe();
  }, []);

  function requireOnline(): boolean {
    if (!isOnline) {
      Alert.alert("Requires connection", "This action requires an internet connection.");
      return false;
    }
    return true;
  }

  async function handleRestore(item: TrashRecord) {
    if (!requireOnline()) return;
    try {
      await api.restoreFromTrash(item.originalPath);
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Could not restore item"
      );
    }
  }

  async function handleDeletePermanently(item: TrashRecord) {
    if (!requireOnline()) return;
    Alert.alert(
      "Delete Permanently",
      `Are you sure you want to permanently delete "${item.originalPath}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              // Delete from local DB; server sync will handle server side
              const collection = database.get<TrashItemModel>("trash_items");
              const records = await collection.query().fetch();
              const target = records.find((r) => r.id === item.id);
              if (target) {
                await database.write(async () => {
                  await target.destroyPermanently();
                });
              }
            } catch (err) {
              Alert.alert(
                "Error",
                err instanceof Error ? err.message : "Could not delete item"
              );
            }
          },
        },
      ]
    );
  }

  async function handleEmptyTrash() {
    if (!requireOnline()) return;
    if (trashItems.length === 0) return;
    Alert.alert(
      "Empty Trash",
      "This will permanently delete all trashed items. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Empty Trash",
          style: "destructive",
          onPress: async () => {
            try {
              await api.emptyTrash();
              // Clear local DB trash items
              const collection = database.get<TrashItemModel>("trash_items");
              const records = await collection.query().fetch();
              await database.write(async () => {
                for (const record of records) {
                  await record.destroyPermanently();
                }
              });
            } catch (err) {
              Alert.alert(
                "Error",
                err instanceof Error ? err.message : "Could not empty trash"
              );
            }
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Trash</Text>
      </View>

      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            Requires connection for restore and delete actions
          </Text>
        </View>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {trashItems.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Trash is empty</Text>
            <Text style={styles.emptySubtext}>
              Deleted notes will appear here.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            <Text style={styles.sectionLabel}>
              {trashItems.length} item{trashItems.length !== 1 ? "s" : ""}
            </Text>
            {trashItems.map((item) => (
              <View key={item.id} style={styles.trashRow}>
                <View style={styles.trashInfo}>
                  <Text style={styles.trashPath}>{item.originalPath}</Text>
                  <Text style={styles.trashTime}>
                    Deleted {timeAgo(item.trashedAt.getTime())}
                  </Text>
                </View>
                <View style={styles.trashActions}>
                  <TouchableOpacity
                    style={styles.restoreButton}
                    onPress={() => handleRestore(item)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.restoreText}>Restore</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => handleDeletePermanently(item)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.deleteText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {trashItems.length > 0 && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.emptyTrashButton}
            onPress={handleEmptyTrash}
            activeOpacity={0.8}
          >
            <Text style={styles.emptyTrashText}>Empty Trash</Text>
          </TouchableOpacity>
        </View>
      )}
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
    paddingBottom: spacing.xxl,
  },
  emptyState: {
    alignItems: "center",
    paddingTop: spacing.xxl * 2,
    gap: spacing.sm,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  emptySubtext: {
    color: colors.textMuted,
    fontSize: fontSize.md,
  },
  list: {
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
  trashRow: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  trashInfo: {
    gap: spacing.xs,
  },
  trashPath: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "500",
  },
  trashTime: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  trashActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  restoreButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primary + "22",
    borderWidth: 1,
    borderColor: colors.primary + "66",
  },
  restoreText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  deleteButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: borderRadius.sm,
    backgroundColor: colors.error + "22",
    borderWidth: 1,
    borderColor: colors.error + "66",
  },
  deleteText: {
    color: colors.error,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  emptyTrashButton: {
    backgroundColor: colors.error,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  emptyTrashText: {
    color: "#fff",
    fontSize: fontSize.md,
    fontWeight: "700",
  },
});
