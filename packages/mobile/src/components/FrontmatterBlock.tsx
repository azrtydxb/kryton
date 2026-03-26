import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, fontSize, spacing, borderRadius } from "../lib/theme";

interface FrontmatterBlockProps {
  frontmatter: Record<string, string>;
}

export default function FrontmatterBlock({ frontmatter }: FrontmatterBlockProps) {
  const entries = Object.entries(frontmatter);
  if (entries.length === 0) return null;

  return (
    <View style={styles.container}>
      {entries.map(([key, value]) => (
        <View key={key} style={styles.row}>
          <Text style={styles.key}>{key}</Text>
          <Text style={styles.value} numberOfLines={1}>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.xs,
  },
  key: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: "600",
    marginRight: spacing.sm,
    minWidth: 80,
    fontFamily: "monospace",
  },
  value: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    flex: 1,
  },
});
