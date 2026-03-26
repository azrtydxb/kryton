import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  SafeAreaView,
} from "react-native";
import { useRouter } from "expo-router";
import { database } from "../../src/db";
import Note from "../../src/db/models/Note";
import { colors, fontSize, spacing, borderRadius } from "../../src/lib/theme";
import { timeAgo } from "../../src/lib/utils";

interface TemplateRecord {
  id: string;
  path: string;
  title: string;
  content: string;
  modifiedAt: Date;
}

export default function TemplatesScreen() {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [selectedTemplate, setSelectedTemplate] =
    useState<TemplateRecord | null>(null);
  const [newNoteName, setNewNoteName] = useState("");
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    const collection = database.get<Note>("notes");
    const subscription = collection
      .query()
      .observe()
      .subscribe((records) => {
        const filtered = records
          .filter((n) => n.path.startsWith("Templates/"))
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((n) => ({
            id: n.id,
            path: n.path,
            title: n.title,
            content: n.content,
            modifiedAt: n.modifiedAt,
          }));
        setTemplates(filtered);
      });
    return () => subscription.unsubscribe();
  }, []);

  function handleTapTemplate(template: TemplateRecord) {
    setSelectedTemplate(template);
    setNewNoteName("");
    setModalVisible(true);
  }

  async function handleCreateFromTemplate() {
    if (!selectedTemplate) return;
    const name = newNoteName.trim();
    if (!name) {
      Alert.alert("Error", "Please enter a note name.");
      return;
    }

    const path = name.endsWith(".md") ? name : `${name}.md`;
    const collection = database.get<Note>("notes");
    const title = path.split("/").pop()?.replace(/\.md$/, "") ?? path;

    try {
      await database.write(async () => {
        await collection.create((note) => {
          note.path = path;
          note.title = title;
          note.content = selectedTemplate.content;
          note.tags = "[]";
        });
      });
      setModalVisible(false);
      setSelectedTemplate(null);
      setNewNoteName("");
      router.push(`/note/${path}`);
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Could not create note"
      );
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Templates</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {templates.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No templates yet</Text>
            <Text style={styles.emptySubtext}>
              Create notes inside the Templates/ folder to use them here.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            <Text style={styles.sectionLabel}>
              {templates.length} template{templates.length !== 1 ? "s" : ""}
            </Text>
            {templates.map((template) => (
              <TouchableOpacity
                key={template.id}
                style={styles.templateRow}
                onPress={() => handleTapTemplate(template)}
                activeOpacity={0.7}
              >
                <View style={styles.templateInfo}>
                  <Text style={styles.templateTitle}>{template.title}</Text>
                  <Text style={styles.templatePath}>{template.path}</Text>
                </View>
                <Text style={styles.templateTime}>
                  {timeAgo(template.modifiedAt.getTime())}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Note from Template</Text>
            {selectedTemplate && (
              <Text style={styles.modalSubtitle}>
                Template: {selectedTemplate.title}
              </Text>
            )}
            <TextInput
              style={styles.modalInput}
              value={newNoteName}
              onChangeText={setNewNoteName}
              placeholder="e.g. Folder/Note Name"
              placeholderTextColor={colors.textMuted}
              autoFocus
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={handleCreateFromTemplate}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setModalVisible(false);
                  setSelectedTemplate(null);
                  setNewNoteName("");
                }}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.createButton}
                onPress={handleCreateFromTemplate}
              >
                <Text style={styles.createText}>Create</Text>
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
    paddingHorizontal: spacing.xl,
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
  templateRow: {
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
  templateInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  templateTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
  templatePath: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  templateTime: {
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
  createButton: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
  },
  createText: {
    color: "#fff",
    fontSize: fontSize.md,
    fontWeight: "700",
  },
});
