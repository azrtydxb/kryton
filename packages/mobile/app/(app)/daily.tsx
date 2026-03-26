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
import Note from "../../src/db/models/Note";
import { colors, fontSize, spacing, borderRadius } from "../../src/lib/theme";
import { timeAgo } from "../../src/lib/utils";

function getTodayPath(): string {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `Daily/${yyyy}-${mm}-${dd}.md`;
}

function formatTodayDisplay(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

interface DailyNoteRecord {
  id: string;
  path: string;
  title: string;
  modifiedAt: Date;
}

export default function DailyScreen() {
  const router = useRouter();
  const [dailyNotes, setDailyNotes] = useState<DailyNoteRecord[]>([]);

  useEffect(() => {
    const collection = database.get<Note>("notes");
    const subscription = collection
      .query()
      .observe()
      .subscribe((records) => {
        const filtered = records
          .filter((n) => n.path.startsWith("Daily/"))
          .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
          .map((n) => ({
            id: n.id,
            path: n.path,
            title: n.title,
            modifiedAt: n.modifiedAt,
          }));
        setDailyNotes(filtered);
      });
    return () => subscription.unsubscribe();
  }, []);

  async function handleOpenToday() {
    const todayPath = getTodayPath();
    const collection = database.get<Note>("notes");
    const existing = await collection.query().fetch();
    const found = existing.find((n) => n.path === todayPath);

    if (!found) {
      try {
        const title = todayPath.split("/").pop()?.replace(/\.md$/, "") ?? todayPath;
        await database.write(async () => {
          await collection.create((note) => {
            note.path = todayPath;
            note.title = title;
            note.content = "";
            note.tags = "[]";
          });
        });
      } catch (err) {
        Alert.alert(
          "Error",
          err instanceof Error ? err.message : "Could not create daily note"
        );
        return;
      }
    }

    router.push(`/note/${todayPath}`);
  }

  function handleOpenNote(path: string) {
    router.push(`/note/${path}`);
  }

  const todayPath = getTodayPath();
  const todayExists = dailyNotes.some((n) => n.path === todayPath);
  const recentNotes = dailyNotes.filter((n) => n.path !== todayPath);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Daily Notes</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.todayCard}>
          <Text style={styles.dateLabel}>{formatTodayDisplay()}</Text>
          {todayExists && (
            <Text style={styles.existsLabel}>Today's note exists</Text>
          )}
          <TouchableOpacity
            style={styles.openTodayButton}
            onPress={handleOpenToday}
            activeOpacity={0.8}
          >
            <Text style={styles.openTodayText}>
              {todayExists ? "Open Today's Note" : "Create Today's Note"}
            </Text>
          </TouchableOpacity>
        </View>

        {recentNotes.length > 0 && (
          <View style={styles.recentSection}>
            <Text style={styles.sectionLabel}>Recent Daily Notes</Text>
            {recentNotes.map((note) => (
              <TouchableOpacity
                key={note.id}
                style={styles.noteRow}
                onPress={() => handleOpenNote(note.path)}
                activeOpacity={0.7}
              >
                <Text style={styles.noteTitle}>{note.title}</Text>
                <Text style={styles.noteTime}>
                  {timeAgo(note.modifiedAt.getTime())}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {dailyNotes.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No daily notes yet.</Text>
            <Text style={styles.emptySubtext}>
              Create your first daily note above.
            </Text>
          </View>
        )}
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
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.xl,
  },
  todayCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.primary,
    gap: spacing.md,
  },
  dateLabel: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  existsLabel: {
    color: colors.success,
    fontSize: fontSize.sm,
  },
  openTodayButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  openTodayText: {
    color: "#fff",
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  recentSection: {
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
  noteRow: {
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
  noteTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "500",
    flex: 1,
  },
  noteTime: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  emptyState: {
    alignItems: "center",
    paddingTop: spacing.xxl,
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
});
