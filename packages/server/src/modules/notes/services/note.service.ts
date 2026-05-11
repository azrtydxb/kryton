import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { moveToTrash } from "./trash.service.js";
import { saveHistorySnapshot } from "./history.service.js";
import { trashItem } from "../../../db/schema/notes.js";
import { syncDeletion } from "../../../db/schema/sync.js";
import { noteShare } from "../../../db/schema/sharing.js";

/**
 * Cross-module decorator surfaces that the notes module relies on:
 *   - `app.knowledge` (search, graph, tag queries) — declared in
 *     `modules/knowledge/index.ts`.
 *   - `app.collab` (share access checks) — declared in
 *     `modules/collab/index.ts`.
 *
 * Both decorators are typed as optional (`?`) to match the parallel migration
 * contract: this module accesses them via optional chaining and falls back to
 * a no-op when the helper is absent.
 */

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

/** Local fallback title extractor used when knowledge module is not available. */
function fallbackExtractTitle(content: string, filePath: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  const base = path.basename(filePath, ".md");
  return base;
}

function ensureWithinBase(fullPath: string, baseDir: string): void {
  const resolvedPath = path.resolve(fullPath);
  const resolvedBase = path.resolve(baseDir);
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    throw new Error("Invalid path: outside notes directory");
  }
}

export class NoteService {
  constructor(private readonly app: FastifyInstance) {}

  private extractTitle(content: string, filePath: string): string {
    return this.app.knowledge?.extractTitle?.(content, filePath) ??
      fallbackExtractTitle(content, filePath);
  }

  /** Recursively scan a directory for .md files and return a tree structure. */
  async scanDirectory(dir: string, basePath = ""): Promise<FileTreeNode[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nodes: FileTreeNode[] = [];

    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        const children = await this.scanDirectory(fullPath, relativePath);
        nodes.push({ name: entry.name, path: relativePath, type: "folder", children });
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        nodes.push({ name: entry.name, path: relativePath, type: "file" });
      }
    }
    return nodes;
  }

  /** Read a note from disk and return its content and metadata. */
  async readNote(notesDir: string, notePath: string): Promise<NoteData> {
    const fullPath = path.join(notesDir, notePath);
    ensureWithinBase(fullPath, notesDir);

    const content = await fs.readFile(fullPath, "utf-8");
    const stat = await fs.stat(fullPath);
    const title = this.extractTitle(content, notePath);

    return { path: notePath, content, title, modifiedAt: stat.mtime };
  }

  /** Write a note to disk and update search/graph indexes. */
  async writeNote(
    notesDir: string,
    notePath: string,
    content: string,
    userId: string,
  ): Promise<void> {
    const fullPath = path.join(notesDir, notePath);
    ensureWithinBase(fullPath, notesDir);

    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });

    // Save existing content as a history snapshot before overwriting
    try {
      const existing = await fs.readFile(fullPath, "utf-8");
      await saveHistorySnapshot(notesDir, notePath, existing);
    } catch {
      // New file — no history to save
    }

    await fs.writeFile(fullPath, content, "utf-8");

    const knowledge = this.app.knowledge;
    if (knowledge) {
      await Promise.all([
        knowledge.indexNote(notePath, content, userId),
        knowledge.updateGraph(notePath, content, userId),
      ]);
    }
  }

  /** Move a note to trash (soft delete) and clean up indexes. */
  async deleteNote(notesDir: string, notePath: string, userId: string): Promise<void> {
    const fullPath = path.join(notesDir, notePath);
    ensureWithinBase(fullPath, notesDir);

    await moveToTrash(notesDir, notePath);

    await this.app.db.insert(trashItem).values({ originalPath: notePath, userId });
    await this.app.db.insert(syncDeletion).values({
      tableName: "notes",
      recordId: notePath,
      userId,
    });

    const knowledge = this.app.knowledge;
    if (knowledge) {
      await Promise.all([
        knowledge.removeFromIndex(notePath, userId),
        knowledge.removeFromGraph(notePath, userId),
      ]);
    }

    await this.app.db
      .delete(noteShare)
      .where(
        and(
          eq(noteShare.ownerUserId, userId),
          eq(noteShare.path, notePath),
          eq(noteShare.isFolder, false),
        ),
      );
  }

  /** Rename/move a note on disk and update all references. */
  async renameNote(
    notesDir: string,
    oldPath: string,
    newPath: string,
    userId: string,
  ): Promise<void> {
    const oldFullPath = path.join(notesDir, oldPath);
    const newFullPath = path.join(notesDir, newPath);
    ensureWithinBase(oldFullPath, notesDir);
    ensureWithinBase(newFullPath, notesDir);

    const dir = path.dirname(newFullPath);
    await fs.mkdir(dir, { recursive: true });

    await fs.rename(oldFullPath, newFullPath);

    const knowledge = this.app.knowledge;
    if (knowledge) {
      await Promise.all([
        knowledge.renameInIndex(oldPath, newPath, userId),
        knowledge.renameInGraph(oldPath, newPath, userId),
      ]);
    }

    await this.app.db
      .update(noteShare)
      .set({ path: newPath })
      .where(
        and(
          eq(noteShare.ownerUserId, userId),
          eq(noteShare.path, oldPath),
          eq(noteShare.isFolder, false),
        ),
      );
  }

  /** Index all existing notes in a user's notes directory. */
  async indexUserNotes(userNotesDir: string, userId: string): Promise<void> {
    const knowledge = this.app.knowledge;
    if (!knowledge) return;

    const tree = await this.scanDirectory(userNotesDir);
    const collectFiles = (nodes: FileTreeNode[]): FileTreeNode[] => {
      const files: FileTreeNode[] = [];
      for (const node of nodes) {
        if (node.type === "file") files.push(node);
        else if (node.children) files.push(...collectFiles(node.children));
      }
      return files;
    };
    const files = collectFiles(tree);

    const BATCH_SIZE = 10;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (node) => {
          try {
            const fullPath = path.join(userNotesDir, node.path);
            const content = await fs.readFile(fullPath, "utf-8");
            await knowledge.indexNote(node.path, content, userId);
            await knowledge.updateGraph(node.path, content, userId);
          } catch (err) {
            this.app.log.error({ err, notePath: node.path }, "Failed to index note");
          }
        }),
      );
    }
  }
}
