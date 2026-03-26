import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useSync } from "../hooks/useSync";
import { timeAgo } from "../lib/utils";
import { colors, fontSize, spacing, borderRadius } from "../lib/theme";

export function SyncStatus() {
  const { syncing, lastSyncAt, error, sync } = useSync();

  const lastSyncText = lastSyncAt
    ? `Last synced: ${timeAgo(lastSyncAt.getTime())}`
    : "Never synced";

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.statusBlock}>
          {syncing ? (
            <View style={styles.syncingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.syncingText}>Syncing...</Text>
            </View>
          ) : (
            <Text style={styles.lastSyncText}>{lastSyncText}</Text>
          )}
          {error && !syncing && (
            <Text style={styles.errorText}>{error}</Text>
          )}
        </View>
        <TouchableOpacity
          style={[styles.syncButton, syncing && styles.syncButtonDisabled]}
          onPress={sync}
          disabled={syncing}
          activeOpacity={0.8}
        >
          <Text style={styles.syncButtonText}>Sync Now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  statusBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  syncingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  syncingText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: "500",
  },
  lastSyncText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.xs,
  },
  syncButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  syncButtonDisabled: {
    opacity: 0.5,
  },
  syncButtonText: {
    color: "#fff",
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
});
