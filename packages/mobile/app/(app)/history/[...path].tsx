import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Modal,
  SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { api, NoteVersion, NoteVersionContent } from "../../../src/lib/api";
import { useNetworkStatus } from "../../../src/hooks/useNetworkStatus";
import { colors, fontSize, spacing, borderRadius } from "../../../src/lib/theme";
import { timeAgo } from "../../../src/lib/utils";

interface VersionRowProps {
  version: NoteVersion;
  onPreview: (version: NoteVersion) => void;
  onRestore: (version: NoteVersion) => void;
  formatSize: (bytes: number) => string;
}

const VersionRow = React.memo(function VersionRow({
  version,
  onPreview,
  onRestore,
  formatSize,
}: VersionRowProps) {
  return (
    <View style={versionRowStyles.row}>
      <View style={versionRowStyles.info}>
        <Text style={versionRowStyles.time}>{timeAgo(version.timestamp)}</Text>
        <Text style={versionRowStyles.date}>{version.date}</Text>
        <Text style={versionRowStyles.size}>{formatSize(version.size)}</Text>
      </View>
      <View style={versionRowStyles.actions}>
        <TouchableOpacity
          style={versionRowStyles.previewButton}
          onPress={() => onPreview(version)}
          activeOpacity={0.8}
        >
          <Text style={versionRowStyles.previewText}>Preview</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={versionRowStyles.restoreButton}
          onPress={() => onRestore(version)}
          activeOpacity={0.8}
        >
          <Text style={versionRowStyles.restoreText}>Restore</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

const versionRowStyles = StyleSheet.create({
  row: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  info: { gap: spacing.xs },
  time: { color: colors.text, fontSize: fontSize.md, fontWeight: "600" },
  date: { color: colors.textSecondary, fontSize: fontSize.sm },
  size: { color: colors.textMuted, fontSize: fontSize.sm },
  actions: { flexDirection: "row", gap: spacing.sm },
  previewButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
  },
  previewText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: "600" },
  restoreButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primary,
    minHeight: 44,
  },
  restoreText: { color: "#fff", fontSize: fontSize.sm, fontWeight: "600" },
});

export default function HistoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ path: string | string[] }>();
  const { isOnline } = useNetworkStatus();
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewVersion, setPreviewVersion] =
    useState<NoteVersionContent | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  const notePath = Array.isArray(params.path)
    ? params.path.join("/")
    : params.path ?? "";

  useEffect(() => {
    if (!isOnline) {
      setLoading(false);
      return;
    }
    loadVersions();
  }, [isOnline, notePath]);

  async function loadVersions() {
    setLoading(true);
    try {
      const result = await api.listVersions(notePath);
      setVersions(result.versions);
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Could not load version history"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handlePreview(version: NoteVersion) {
    setPreviewLoading(true);
    setModalVisible(true);
    try {
      const content = await api.getVersion(notePath, version.timestamp);
      setPreviewVersion(content);
    } catch (err) {
      setModalVisible(false);
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Could not load version"
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleRestore(version: NoteVersion) {
    Alert.alert(
      "Restore Version",
      `Restore to the version from ${timeAgo(version.timestamp)}? This will overwrite the current note.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          onPress: async () => {
            try {
              await api.restoreVersion(notePath, version.timestamp);
              router.back();
            } catch (err) {
              Alert.alert(
                "Error",
                err instanceof Error ? err.message : "Could not restore version"
              );
            }
          },
        },
      ]
    );
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (!isOnline) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={24} color={colors.primary} />
          </TouchableOpacity>
          <Text style={styles.title}>History</Text>
        </View>
        <View style={styles.offlineState}>
          <Text style={styles.offlineTitle}>Requires connection</Text>
          <Text style={styles.offlineSubtext}>
            Note history is only available when online.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>History</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {notePath}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading versions...</Text>
        </View>
      ) : (
        <FlatList
          style={styles.scroll}
          contentContainerStyle={styles.content}
          data={versions}
          keyExtractor={(item) => String(item.timestamp)}
          ListHeaderComponent={
            versions.length > 0 ? (
              <Text style={styles.sectionLabel}>
                {versions.length} version{versions.length !== 1 ? "s" : ""}
              </Text>
            ) : null
          }
          renderItem={({ item: version }) => (
            <VersionRow
              version={version}
              onPreview={handlePreview}
              onRestore={handleRestore}
              formatSize={formatSize}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.rowSeparator} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No version history</Text>
              <Text style={styles.emptySubtext}>
                Versions are saved automatically as you edit.
              </Text>
            </View>
          }
        />
      )}

      <Modal
        visible={modalVisible}
        animationType="slide"
        onRequestClose={() => {
          setModalVisible(false);
          setPreviewVersion(null);
        }}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Version Preview</Text>
            <TouchableOpacity
              onPress={() => {
                setModalVisible(false);
                setPreviewVersion(null);
              }}
              style={styles.modalClose}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
          {previewLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>Loading content...</Text>
            </View>
          ) : previewVersion ? (
            <ScrollView style={styles.previewScroll} contentContainerStyle={styles.previewContent}>
              <Text style={styles.previewDate}>{previewVersion.date}</Text>
              <View style={styles.previewBox}>
                <Text style={styles.previewBody}>{previewVersion.content}</Text>
              </View>
            </ScrollView>
          ) : null}
        </SafeAreaView>
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
  rowSeparator: {
    height: spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: "700",
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  offlineState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  offlineTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  offlineSubtext: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: "center",
  },
  loadingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
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
    textAlign: "center",
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
  versionRow: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  versionInfo: {
    gap: spacing.xs,
  },
  versionTime: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
  versionDate: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  versionSize: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  versionActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  previewButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  restoreButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primary,
  },
  restoreText: {
    color: "#fff",
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  modalClose: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  modalCloseText: {
    color: colors.primary,
    fontSize: fontSize.md,
  },
  previewScroll: {
    flex: 1,
  },
  previewContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  previewDate: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  previewBox: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewBody: {
    color: colors.text,
    fontSize: fontSize.md,
    lineHeight: 22,
    fontFamily: "monospace",
  },
});
