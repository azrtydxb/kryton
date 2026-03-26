import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Share,
  ScrollView,
  ActionSheetIOS,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { database } from "../../../src/db";
import Note from "../../../src/db/models/Note";
import { Q } from "@nozbe/watermelondb";
import { colors, fontSize, spacing, borderRadius } from "../../../src/lib/theme";
import { parseFrontmatter } from "../../../src/lib/frontmatter";
import Breadcrumbs from "../../../src/components/Breadcrumbs";
import FrontmatterBlock from "../../../src/components/FrontmatterBlock";
import EditorBridge from "../../../src/webview/EditorBridge";
import PreviewBridge from "../../../src/webview/PreviewBridge";

type Mode = "preview" | "edit";

export default function NoteScreen() {
  const params = useLocalSearchParams<{ path: string | string[] }>();
  const router = useRouter();

  // path param can be a string or array (catch-all route)
  const rawPath = Array.isArray(params.path)
    ? params.path.join("/")
    : params.path ?? "";
  const notePath = decodeURIComponent(rawPath);

  const [note, setNote] = useState<Note | null>(null);
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<Mode>("preview");
  const [isDirty, setIsDirty] = useState(false);
  const pendingContentRef = useRef("");

  // Load note from WatermelonDB
  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;
    const col = database.get<Note>("notes");
    const obs = col.query(Q.where("path", notePath)).observe();
    subscription = obs.subscribe((notes) => {
      if (notes.length > 0) {
        setNote(notes[0]);
        setContent(notes[0].content ?? "");
        pendingContentRef.current = notes[0].content ?? "";
      }
    });
    return () => subscription?.unsubscribe();
  }, [notePath]);

  const handleContentChange = useCallback((newContent: string) => {
    pendingContentRef.current = newContent;
    setIsDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!note || !isDirty) return;
    try {
      await database.write(async () => {
        await note.update((n) => {
          n.content = pendingContentRef.current;
        });
      });
      setIsDirty(false);
    } catch (err) {
      console.error("Failed to save note:", err);
    }
  }, [note, isDirty]);

  const toggleMode = useCallback(() => {
    if (mode === "edit" && isDirty) {
      handleSave();
    }
    setMode((prev) => (prev === "preview" ? "edit" : "preview"));
  }, [mode, isDirty, handleSave]);

  const handleShare = useCallback(async () => {
    try {
      await Share.share({
        title: note?.title ?? notePath,
        message: note?.content ?? "",
      });
    } catch {
      // ignore
    }
  }, [note, notePath]);

  const handleOverflowMenu = useCallback(() => {
    const options = ["Star", "Share", "History", "Move to Trash", "Export", "Cancel"];
    const destructiveIndex = 3;
    const cancelIndex = 5;

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex: destructiveIndex,
          cancelButtonIndex: cancelIndex,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) handleShare();
          // Other actions are stubs for v1
        }
      );
    } else {
      Alert.alert("Note Options", undefined, [
        { text: "Star", onPress: () => {} },
        { text: "Share", onPress: handleShare },
        { text: "History", onPress: () => {} },
        {
          text: "Move to Trash",
          style: "destructive",
          onPress: () => {},
        },
        { text: "Export", onPress: () => {} },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  }, [handleShare]);

  const title = note?.title ?? notePath.split("/").pop() ?? "Note";

  const { frontmatter, body } = parseFrontmatter(content);
  const hasFrontmatter = Object.keys(frontmatter).length > 0;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>

        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>

        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={toggleMode}
            style={styles.headerButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={mode === "preview" ? "create-outline" : "eye-outline"}
              size={22}
              color={colors.text}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleOverflowMenu}
            style={styles.headerButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Breadcrumbs */}
      <Breadcrumbs path={notePath} />

      {/* Frontmatter (preview mode only) */}
      {mode === "preview" && hasFrontmatter && (
        <FrontmatterBlock frontmatter={frontmatter} />
      )}

      {/* Body */}
      {mode === "preview" ? (
        <PreviewBridge
          content={hasFrontmatter ? body : content}
          darkMode={true}
        />
      ) : (
        <EditorBridge
          content={content}
          darkMode={true}
          onContentChange={handleContentChange}
          onSave={handleSave}
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl + spacing.md, // safe area approximation
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerButton: {
    padding: spacing.xs,
  },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.text,
    textAlign: "center",
    marginHorizontal: spacing.sm,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
});
