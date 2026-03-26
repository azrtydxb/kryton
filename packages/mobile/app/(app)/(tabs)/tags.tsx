import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { database } from "../../../src/db";
import Note from "../../../src/db/models/Note";
import {
  colors,
  fontSize,
  spacing,
  borderRadius,
} from "../../../src/lib/theme";

interface TagEntry {
  tag: string;
  count: number;
}

interface TaggedNote {
  id: string;
  title: string;
  path: string;
}

function extractTagsFromContent(content: string): string[] {
  const matches = content.match(/#[a-zA-Z0-9_/-]+/g) ?? [];
  return matches.map((t) => t.slice(1).toLowerCase());
}

function parseTagsField(tagsJson: string): string[] {
  if (!tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson);
    if (Array.isArray(parsed)) {
      return parsed.map((t: unknown) => String(t).toLowerCase());
    }
  } catch {
    // fallback: comma-separated
    return tagsJson.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

function computeTags(notes: Note[]): TagEntry[] {
  const tagMap = new Map<string, number>();

  for (const note of notes) {
    const fieldTags = parseTagsField(note.tags ?? "");
    const contentTags = extractTagsFromContent(note.content ?? "");
    const allTags = new Set([...fieldTags, ...contentTags]);
    for (const tag of allTags) {
      tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(tagMap.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function getNotesForTag(notes: Note[], tag: string): TaggedNote[] {
  return notes
    .filter((note) => {
      const fieldTags = parseTagsField(note.tags ?? "");
      const contentTags = extractTagsFromContent(note.content ?? "");
      const allTags = new Set([...fieldTags, ...contentTags]);
      return allTags.has(tag.toLowerCase());
    })
    .map((note) => ({
      id: note.id,
      title: note.title ?? note.path,
      path: note.path,
    }));
}

export default function TagsScreen() {
  const router = useRouter();
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [tags, setTags] = useState<TagEntry[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [filteredNotes, setFilteredNotes] = useState<TaggedNote[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const col = database.get<Note>("notes");
    const subscription = col.query().observe().subscribe((notes) => {
      setAllNotes(notes);
      setTags(computeTags(notes));
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (selectedTag) {
      setFilteredNotes(getNotesForTag(allNotes, selectedTag));
    }
  }, [selectedTag, allNotes]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    // Re-compute is reactive; just reset the selected tag to force re-render
    setTags(computeTags(allNotes));
    setRefreshing(false);
  }, [allNotes]);

  const handleTagPress = useCallback((tag: string) => {
    setSelectedTag(tag);
  }, []);

  const handleNotePress = useCallback(
    (path: string) => {
      const encoded = encodeURIComponent(path);
      router.push(`/(app)/note/${encoded}` as never);
    },
    [router]
  );

  const handleBack = useCallback(() => {
    setSelectedTag(null);
  }, []);

  if (selectedTag) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Text style={styles.backText}>Tags</Text>
          </TouchableOpacity>
          <View style={styles.tagBadge}>
            <Text style={styles.tagBadgeText}>#{selectedTag}</Text>
          </View>
        </View>

        <FlatList
          data={filteredNotes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.noteItem}
              onPress={() => handleNotePress(item.path)}
              activeOpacity={0.7}
            >
              <Text style={styles.noteTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.notePath} numberOfLines={1}>
                {item.path}
              </Text>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No notes with this tag</Text>
            </View>
          }
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Tags</Text>
      </View>

      <FlatList
        data={tags}
        keyExtractor={(item) => item.tag}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.tagRow}
            onPress={() => handleTagPress(item.tag)}
            activeOpacity={0.7}
          >
            <View style={styles.tagBadgeSmall}>
              <Text style={styles.tagBadgeSmallText}>#{item.tag}</Text>
            </View>
            <Text style={styles.tagCount}>{item.count}</Text>
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No tags found</Text>
            <Text style={styles.emptySubtext}>
              Add #hashtags to your notes or use frontmatter tags
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: spacing.xl + spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: "700",
    color: colors.text,
  },
  backButton: {
    paddingVertical: spacing.xs,
  },
  backText: {
    fontSize: fontSize.md,
    color: colors.primary,
  },
  tagBadge: {
    backgroundColor: "rgba(124, 58, 237, 0.15)",
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  tagBadgeText: {
    fontSize: fontSize.md,
    color: colors.primary,
    fontWeight: "600",
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
  },
  tagBadgeSmall: {
    backgroundColor: "rgba(124, 58, 237, 0.12)",
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tagBadgeSmallText: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: "500",
  },
  tagCount: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
  noteItem: {
    paddingVertical: spacing.md,
  },
  noteTitle: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 2,
  },
  notePath: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    paddingTop: spacing.xxl * 2,
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.lg,
    color: colors.textSecondary,
  },
  emptySubtext: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
});
