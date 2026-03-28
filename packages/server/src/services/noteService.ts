import * as fs from "fs/promises";
import * as path from "path";
import { prisma } from "../prisma.js";
import { createLogger } from "../lib/logger.js";
import { indexNote, removeFromIndex, renameInIndex, extractTitle } from "./searchService.js";
import { updateGraphCache, removeFromGraph, renameInGraph } from "./graphService.js";
import { moveToTrash } from "./trashService.js";
import { saveHistorySnapshot } from "./historyService.js";
import type { PluginWebSocket } from "../plugins/PluginWebSocket.js";

// Optional WebSocket instance for broadcasting graph updates
let pluginWs: PluginWebSocket | null = null;

/**
 * Register the WebSocket instance to broadcast graph update events.
 * Call this once from index.ts after creating PluginWebSocket.
 */
export function setGraphWebSocket(ws: PluginWebSocket): void {
  pluginWs = ws;
}

const log = createLogger("note-service");

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileTreeNode[];
}

export interface NoteData {
  path: string;
  content: string;
  title: string;
  modifiedAt: Date;
}

/**
 * Recursively scan a directory for .md files and return a tree structure.
 */
export async function scanDirectory(dir: string, basePath = ""): Promise<FileTreeNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: FileTreeNode[] = [];

  // Sort entries: folders first, then files, both alphabetically
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip hidden directories (includes .trash)
      if (entry.name.startsWith(".")) continue;

      const children = await scanDirectory(fullPath, relativePath);
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: "folder",
        children,
      });
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: "file",
      });
    }
  }

  return nodes;
}

/**
 * Read a note from disk and return its content and metadata.
 */
export async function readNote(notesDir: string, notePath: string): Promise<NoteData> {
  const fullPath = path.join(notesDir, notePath);

  // Security: ensure resolved path is within notesDir
  const resolvedPath = path.resolve(fullPath);
  const resolvedBase = path.resolve(notesDir);
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    throw new Error("Invalid path: outside notes directory");
  }

  const content = await fs.readFile(fullPath, "utf-8");
  const stat = await fs.stat(fullPath);
  const title = extractTitle(content, notePath);

  return {
    path: notePath,
    content,
    title,
    modifiedAt: stat.mtime,
  };
}

/**
 * Write a note to disk and update search/graph indexes.
 */
export async function writeNote(
  notesDir: string,
  notePath: string,
  content: string,
  userId: string
): Promise<void> {
  const fullPath = path.join(notesDir, notePath);

  // Security check
  const resolvedPath = path.resolve(fullPath);
  const resolvedBase = path.resolve(notesDir);
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    throw new Error("Invalid path: outside notes directory");
  }

  // Ensure parent directory exists
  const dir = path.dirname(fullPath);
  await fs.mkdir(dir, { recursive: true });

  // Save the current content as a history snapshot before overwriting
  try {
    const existing = await fs.readFile(fullPath, "utf-8");
    await saveHistorySnapshot(notesDir, notePath, existing);
  } catch {
    // File doesn't exist yet (new note) — no history to save
  }

  // Ensure path ends with .md
  await fs.writeFile(fullPath, content, "utf-8");

  // Update indexes
  await Promise.all([
    indexNote(notePath, content, userId),
    updateGraphCache(notePath, content, userId),
  ]);

  // Notify connected clients that the graph has changed
  pluginWs?.broadcast("graph:updated", { notePath, userId });
}

/**
 * Move a note to trash (soft delete) and clean up indexes.
 * The file is moved to .trash/{notePath} inside the user's notes directory.
 */
export async function deleteNote(notesDir: string, notePath: string, userId: string): Promise<void> {
  const fullPath = path.join(notesDir, notePath);

  // Security check
  const resolvedPath = path.resolve(fullPath);
  const resolvedBase = path.resolve(notesDir);
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    throw new Error("Invalid path: outside notes directory");
  }

  // Move to trash instead of permanently deleting
  await moveToTrash(notesDir, notePath);

  // Record for sync
  await prisma.trashItem.create({
    data: { originalPath: notePath, userId },
  });
  await prisma.syncDeletion.create({
    data: { tableName: "notes", recordId: notePath, userId },
  });

  // Clean up indexes
  await Promise.all([
    removeFromIndex(notePath, userId),
    removeFromGraph(notePath, userId),
  ]);

  // Clean up NoteShare rows for this exact file
  await prisma.noteShare.deleteMany({
    where: { ownerUserId: userId, path: notePath, isFolder: false },
  });
}

/**
 * Rename/move a note on disk and update all references.
 */
export async function renameNote(
  notesDir: string,
  oldPath: string,
  newPath: string,
  userId: string
): Promise<void> {
  const oldFullPath = path.join(notesDir, oldPath);
  const newFullPath = path.join(notesDir, newPath);

  // Security checks
  const resolvedOld = path.resolve(oldFullPath);
  const resolvedNew = path.resolve(newFullPath);
  const resolvedBase = path.resolve(notesDir);
  if (
    (!resolvedOld.startsWith(resolvedBase + path.sep) && resolvedOld !== resolvedBase) ||
    (!resolvedNew.startsWith(resolvedBase + path.sep) && resolvedNew !== resolvedBase)
  ) {
    throw new Error("Invalid path: outside notes directory");
  }

  // Ensure target directory exists
  const dir = path.dirname(newFullPath);
  await fs.mkdir(dir, { recursive: true });

  // Move the file
  await fs.rename(oldFullPath, newFullPath);

  // Update indexes
  await Promise.all([
    renameInIndex(oldPath, newPath, userId),
    renameInGraph(oldPath, newPath, userId),
  ]);

  // Update NoteShare rows for this exact file
  await prisma.noteShare.updateMany({
    where: { ownerUserId: userId, path: oldPath, isFolder: false },
    data: { path: newPath },
  });
}

/**
 * Index all existing notes in a user's notes directory.
 * Called on startup or provisioning to populate search and graph caches.
 */
export async function indexUserNotes(userNotesDir: string, userId: string): Promise<void> {
  const tree = await scanDirectory(userNotesDir);

  // Flatten tree to list of file nodes
  function collectFiles(nodes: FileTreeNode[]): FileTreeNode[] {
    const files: FileTreeNode[] = [];
    for (const node of nodes) {
      if (node.type === "file") {
        files.push(node);
      } else if (node.children) {
        files.push(...collectFiles(node.children));
      }
    }
    return files;
  }

  const files = collectFiles(tree);

  // Process in batches of 10 for bounded concurrency
  const BATCH_SIZE = 10;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (node) => {
        try {
          const fullPath = path.join(userNotesDir, node.path);
          const content = await fs.readFile(fullPath, "utf-8");
          await indexNote(node.path, content, userId);
          await updateGraphCache(node.path, content, userId);
        } catch (err) {
          log.error(`Failed to index ${node.path}:`, err);
        }
      })
    );
  }
}
