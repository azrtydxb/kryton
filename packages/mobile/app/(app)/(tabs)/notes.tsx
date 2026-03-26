import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  StyleSheet,
  Alert,
  SafeAreaView,
} from "react-native";
import { useNotes } from "../../../src/hooks/useNotes";
import { useSync } from "../../../src/hooks/useSync";
import { OfflineBanner } from "../../../src/components/OfflineBanner";
import { FavoritesSection } from "../../../src/components/FavoritesSection";
import { FileTree } from "../../../src/components/FileTree";
import { colors, spacing, fontSize, borderRadius } from "../../../src/lib/theme";

export default function NotesScreen() {
  const { tree, createNote } = useNotes();
  const { syncing, sync } = useSync();
  const [fabOpen, setFabOpen] = useState(false);
  const [newNoteModalVisible, setNewNoteModalVisible] = useState(false);
  const [newNotePath, setNewNotePath] = useState("");

  async function handleNewNote() {
    setFabOpen(false);
    setNewNoteModalVisible(true);
  }

  async function handleDailyNote() {
    setFabOpen(false);
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const path = `Daily/${yyyy}-${mm}-${dd}.md`;
    try {
      await createNote(path);
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Could not create daily note"
      );
    }
  }

  async function handleCreateNote() {
    const path = newNotePath.trim();
    if (!path) return;
    const normalizedPath = path.endsWith(".md") ? path : `${path}.md`;
    try {
      await createNote(normalizedPath);
      setNewNoteModalVisible(false);
      setNewNotePath("");
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Could not create note"
      );
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <OfflineBanner />

      <View style={styles.titleBar}>
        <Text style={styles.screenTitle}>Notes</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={sync}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <FavoritesSection />
        <FileTree nodes={tree} />
        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* FAB */}
      <View style={styles.fabContainer}>
        {fabOpen && (
          <View style={styles.fabMenu}>
            <TouchableOpacity
              style={styles.fabMenuItem}
              onPress={handleDailyNote}
              activeOpacity={0.8}
            >
              <Text style={styles.fabMenuIcon}>📅</Text>
              <Text style={styles.fabMenuText}>Daily Note</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fabMenuItem}
              onPress={handleNewNote}
              activeOpacity={0.8}
            >
              <Text style={styles.fabMenuIcon}>📝</Text>
              <Text style={styles.fabMenuText}>New Note</Text>
            </TouchableOpacity>
          </View>
        )}
        <TouchableOpacity
          style={[styles.fab, fabOpen && styles.fabActive]}
          onPress={() => setFabOpen((prev) => !prev)}
          activeOpacity={0.8}
        >
          <Text style={styles.fabIcon}>{fabOpen ? "✕" : "+"}</Text>
        </TouchableOpacity>
      </View>

      {/* FAB backdrop */}
      {fabOpen && (
        <TouchableOpacity
          style={styles.backdrop}
          onPress={() => setFabOpen(false)}
          activeOpacity={1}
        />
      )}

      {/* New note modal */}
      <Modal
        visible={newNoteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNewNoteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Note</Text>
            <TextInput
              style={styles.modalInput}
              value={newNotePath}
              onChangeText={setNewNotePath}
              placeholder="e.g. Folder/Note Name"
              placeholderTextColor={colors.textMuted}
              autoFocus
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={handleCreateNote}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setNewNoteModalVisible(false);
                  setNewNotePath("");
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalCreateButton}
                onPress={handleCreateNote}
              >
                <Text style={styles.modalCreateText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  titleBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  screenTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: "700",
  },
  scrollView: {
    flex: 1,
  },
  bottomPadding: {
    height: 100,
  },
  fabContainer: {
    position: "absolute",
    bottom: spacing.xl,
    right: spacing.lg,
    alignItems: "flex-end",
    zIndex: 10,
  },
  fabMenu: {
    marginBottom: spacing.md,
    gap: spacing.sm,
    alignItems: "flex-end",
  },
  fabMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  fabMenuIcon: {
    fontSize: fontSize.md,
  },
  fabMenuText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "500",
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fabActive: {
    backgroundColor: colors.primaryHover,
  },
  fabIcon: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "300",
    lineHeight: 28,
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
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
  },
  modalTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: "700",
    marginBottom: spacing.lg,
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
    marginBottom: spacing.lg,
  },
  modalButtons: {
    flexDirection: "row",
    gap: spacing.md,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalCancelText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
  modalCreateButton: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
  },
  modalCreateText: {
    color: "#fff",
    fontSize: fontSize.md,
    fontWeight: "700",
  },
});
