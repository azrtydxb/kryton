import * as fs from "fs/promises";
import * as path from "path";
import { indexNote, removeFromIndex, renameInIndex, extractTitle } from "./searchService";
import { updateGraphCache, removeFromGraph, renameInGraph } from "./graphService";

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
      // Skip hidden directories
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
  content: string
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

  // Ensure path ends with .md
  await fs.writeFile(fullPath, content, "utf-8");

  // Update indexes
  await Promise.all([
    indexNote(notePath, content),
    updateGraphCache(notePath, content),
  ]);
}

/**
 * Delete a note from disk and clean up indexes.
 */
export async function deleteNote(notesDir: string, notePath: string): Promise<void> {
  const fullPath = path.join(notesDir, notePath);

  // Security check
  const resolvedPath = path.resolve(fullPath);
  const resolvedBase = path.resolve(notesDir);
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    throw new Error("Invalid path: outside notes directory");
  }

  await fs.unlink(fullPath);

  // Clean up indexes
  await Promise.all([
    removeFromIndex(notePath),
    removeFromGraph(notePath),
  ]);
}

/**
 * Rename/move a note on disk and update all references.
 */
export async function renameNote(
  notesDir: string,
  oldPath: string,
  newPath: string
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
    renameInIndex(oldPath, newPath),
    renameInGraph(oldPath, newPath),
  ]);
}

/**
 * Index all existing notes in the notes directory.
 * Called on startup to populate search and graph caches.
 */
export async function indexAllNotes(notesDir: string): Promise<void> {
  const tree = await scanDirectory(notesDir);

  async function processNodes(nodes: FileTreeNode[]): Promise<void> {
    for (const node of nodes) {
      if (node.type === "file") {
        try {
          const fullPath = path.join(notesDir, node.path);
          const content = await fs.readFile(fullPath, "utf-8");
          await indexNote(node.path, content);
          await updateGraphCache(node.path, content);
        } catch (err) {
          console.error(`Failed to index ${node.path}:`, err);
        }
      } else if (node.children) {
        await processNodes(node.children);
      }
    }
  }

  await processNodes(tree);
}
