import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getDatabase } from "../../../src/db";
import {
  colors,
  fontSize,
  spacing,
  borderRadius,
} from "../../../src/lib/theme";

interface SearchResult {
  id: string;
  title: string;
  path: string;
  snippet: string;
}

interface SearchRow {
  id: string;
  title: string | null;
  path: string;
  content: string | null;
}

function rowToResult(row: SearchRow): SearchResult {
  const snippet = (row.content ?? "").slice(0, 100).replace(/\n/g, " ");
  return {
    id: row.id,
    title: row.title ?? row.path,
    path: row.path,
    snippet,
  };
}

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const term = `%${query.trim()}%`;
      const db = getDatabase();
      const rows = await db.getAllAsync<SearchRow>(
        "SELECT id, title, path, substr(content, 1, 200) as content FROM notes WHERE _status != 'deleted' AND (title LIKE ? OR content LIKE ?)",
        [term, term]
      );
      setResults(rows.map(rowToResult));
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handlePress = useCallback(
    (path: string) => {
      const encoded = encodeURIComponent(path);
      router.push(`/(app)/(tabs)/note/${encoded}` as never);
    },
    [router]
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons
          name="search"
          size={18}
          color={colors.textMuted}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search notes…"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
      </View>

      {/* Results / empty state */}
      {!query.trim() ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="search" size={48} color={colors.textMuted} />
          <Text style={styles.emptyText}>Search your notes</Text>
          <Text style={styles.emptySubtext}>
            Search by title or content
          </Text>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No results for "{query}"</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.resultItem}
              onPress={() => handlePress(item.path)}
              activeOpacity={0.7}
            >
              <Text style={styles.resultTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.resultPath} numberOfLines={1}>
                {item.path}
              </Text>
              {item.snippet ? (
                <Text style={styles.resultSnippet} numberOfLines={2}>
                  {item.snippet}
                </Text>
              ) : null}
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.text,
    paddingVertical: spacing.md,
    backgroundColor: "transparent",
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  resultItem: {
    paddingVertical: spacing.md,
  },
  resultTitle: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 2,
  },
  resultPath: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginBottom: 4,
  },
  resultSnippet: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.lg,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  emptySubtext: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
});
