import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { TreeNode } from "../hooks/useNotes";
import { colors, spacing, fontSize } from "../lib/theme";

interface FileTreeProps {
  nodes: TreeNode[];
  depth?: number;
}

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
}

function TreeNodeItem({ node, depth }: TreeNodeItemProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const indent = depth * 16;

  if (node.type === "folder") {
    return (
      <View>
        <TouchableOpacity
          style={[styles.row, { paddingLeft: spacing.lg + indent }]}
          onPress={() => setExpanded((prev) => !prev)}
          activeOpacity={0.7}
        >
          <Text style={styles.folderIcon}>{expanded ? "▾" : "▸"}</Text>
          <Text style={styles.folderIcon}>📁</Text>
          <Text style={styles.folderName} numberOfLines={1}>
            {node.name}
          </Text>
        </TouchableOpacity>
        {expanded && node.children && node.children.length > 0 && (
          <FileTree nodes={node.children} depth={depth + 1} />
        )}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.row, { paddingLeft: spacing.lg + indent }]}
      onPress={() =>
        router.push(
          `/(app)/note/${encodeURIComponent(node.path)}` as `/${string}`
        )
      }
      activeOpacity={0.7}
    >
      <Text style={styles.fileIcon}>📄</Text>
      <Text style={styles.fileName} numberOfLines={1}>
        {node.name.replace(/\.md$/, "")}
      </Text>
    </TouchableOpacity>
  );
}

export function FileTree({ nodes, depth = 0 }: FileTreeProps) {
  if (nodes.length === 0) {
    if (depth === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No notes yet</Text>
          <Text style={styles.emptySubtext}>Tap + to create your first note</Text>
        </View>
      );
    }
    return null;
  }

  return (
    <View>
      {nodes.map((node) => (
        <TreeNodeItem
          key={node.path}
          node={node}
          depth={depth}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingRight: spacing.lg,
    gap: spacing.xs,
  },
  folderIcon: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  folderName: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "500",
    flex: 1,
  },
  fileIcon: {
    fontSize: fontSize.md,
  },
  fileName: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    flex: 1,
  },
  emptyContainer: {
    alignItems: "center",
    paddingTop: spacing.xxl * 2,
    paddingHorizontal: spacing.lg,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSize.lg,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },
  emptySubtext: {
    color: colors.textMuted,
    fontSize: fontSize.md,
  },
});
