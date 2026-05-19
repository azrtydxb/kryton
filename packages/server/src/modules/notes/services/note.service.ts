import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { moveToTrash } from "./trash.service.js";
import { saveHistorySnapshot } from "./history.service.js";
import { trashItem } from "../../../db/schema/notes.js";
import { noteShare } from "../../../db/schema/sharing.js";
import { NotFoundError } from "../../../lib/errors.js";
import type { VaultEventOrigin } from "../../vault-events/types.js";

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * Self-write dedupe cache. Every server-initiated disk write records
 * `(absolutePath, sha256, ts)` here. The disk watcher (Phase 1.5) checks
 * this on every fs event to skip self-write echoes — a sha match proves
 * the watcher is seeing OUR write rather than an external one that happens
 * to have arrived within the TTL window. Bounded by both TTL and entry
 * count so a bulk import can't grow the map without limit.
 */
const SELF_WRITE_TTL_MS = 10_000;
const SELF_WRITE_MAX_ENTRIES = 1024;
const selfWriteCache = new Map<string, { sha: string; ts: number }>();

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function recordSelfWrite(absPath: string, content: string): void {
  if (selfWriteCache.size >= SELF_WRITE_MAX_ENTRIES) {
    const oldest = selfWriteCache.keys().next().value;
    if (oldest !== undefined) selfWriteCache.delete(oldest);
  }
  // Delete + set moves the key to the end of insertion order on overwrite,
  // preserving LRU semantics for frequently-edited notes.
  selfWriteCache.delete(absPath);
  selfWriteCache.set(absPath, { sha: sha256Hex(content), ts: Date.now() });
}

export function wasRecentSelfWrite(absPath: string, diskContent: string): boolean {
  const hit = selfWriteCache.get(absPath);
  if (!hit) return false;
  if (Date.now() - hit.ts > SELF_WRITE_TTL_MS) {
    selfWriteCache.delete(absPath);
    return false;
  }
  return hit.sha === sha256Hex(diskContent);
}

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
  /** ISO mtime for files; omitted on folders. */
  updatedAt?: string;
  /** Size in bytes for files; omitted on folders. */
  size?: number;
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
        const stat = await fs.stat(fullPath);
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: "file",
          updatedAt: stat.mtime.toISOString(),
          size: stat.size,
        });
      }
    }
    return nodes;
  }

  /** Read a note from disk and return its content and metadata. */
  async readNote(notesDir: string, notePath: string): Promise<NoteData> {
    const fullPath = path.join(notesDir, notePath);
    ensureWithinBase(fullPath, notesDir);

    let content: string;
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      content = await fs.readFile(fullPath, "utf-8");
      stat = await fs.stat(fullPath);
    } catch (err) {
      // ENOENT (file gone) and ENOTDIR (parent component isn't a directory
      // because the caller tacked extra segments onto a leaf path) both mean
      // "no note here." Map to 404 instead of letting the global error
      // handler surface them as 500.
      if (
        isEnoent(err) ||
        (typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code?: unknown }).code === "ENOTDIR")
      ) {
        throw new NotFoundError(`Note not found: ${notePath}`);
      }
      throw err;
    }
    const title = this.extractTitle(content, notePath);

    return { path: notePath, content, title, modifiedAt: stat.mtime };
  }

  /**
   * Write a note to disk and update search/graph indexes.
   *
   * Y-routing invariant: if `app.collab?.hasLiveDoc(notePath, userId)`
   * returns true, the write is routed INTO the live Y.Doc instead of
   * touching disk directly. The Y flush pipeline is then the single
   * chokepoint for disk persistence, search/graph indexing, and
   * `vaultEvents.emit(note.updated)`. This keeps server-initiated edits
   * (MCP `update_note`, etc.) and human typing on the same merge path
   * so neither side clobbers the other.
   *
   * The flush itself calls writeNote with `opts.bypassCollabRouting`
   * set so it doesn't recurse back into Y.
   */
  async writeNote(
    notesDir: string,
    notePath: string,
    content: string,
    userId: string,
    origin?: VaultEventOrigin,
    opts?: { bypassCollabRouting?: boolean },
  ): Promise<void> {
    if (!opts?.bypassCollabRouting) {
      const collab = this.app.collab;
      if (collab && collab.hasLiveDoc(notePath, userId)) {
        await collab.applyServerEdit(
          notePath,
          userId,
          origin ?? { clientId: null, agentId: null, agentName: null },
          content,
        );
        return;
      }
    }
    const fullPath = path.join(notesDir, notePath);
    ensureWithinBase(fullPath, notesDir);

    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });

    // Save existing content as a history snapshot before overwriting.
    // Tracking `existed` here lets us emit `note.created` vs `note.updated`
    // afterwards without a second `stat` round-trip.
    let existed = true;
    try {
      const existing = await fs.readFile(fullPath, "utf-8");
      await saveHistorySnapshot(notesDir, notePath, existing);
    } catch {
      existed = false;
    }

    await fs.writeFile(fullPath, content, "utf-8");
    // Record before any awaited work yields so the watcher always finds
    // the entry if it fires while indexing is still pending.
    recordSelfWrite(fullPath, content);

    const knowledge = this.app.knowledge;
    if (knowledge) {
      await Promise.all([
        knowledge.indexNote(notePath, content, userId),
        knowledge.updateGraph(notePath, content, userId),
      ]);
    }

    const events = this.app.vaultEvents;
    if (events) {
      let updatedAt: string;
      let size: number;
      try {
        const stat = await fs.stat(fullPath);
        updatedAt = stat.mtime.toISOString();
        size = stat.size;
      } catch {
        updatedAt = new Date().toISOString();
        size = Buffer.byteLength(content, "utf-8");
      }
      events.emit(userId, {
        kind: existed ? "note.updated" : "note.created",
        path: notePath,
        updatedAt,
        size,
        clientId: origin?.clientId ?? null,
        agentId: origin?.agentId ?? null,
        agentName: origin?.agentName ?? null,
      });
    }
  }

  /** Move a note to trash (soft delete) and clean up indexes. */
  async deleteNote(
    notesDir: string,
    notePath: string,
    userId: string,
    origin?: VaultEventOrigin,
  ): Promise<void> {
    const fullPath = path.join(notesDir, notePath);
    ensureWithinBase(fullPath, notesDir);

    await moveToTrash(notesDir, notePath);

    await this.app.db.insert(trashItem).values({ originalPath: notePath, userId });

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

    this.app.vaultEvents?.emit(userId, {
      kind: "note.deleted",
      path: notePath,
      clientId: origin?.clientId ?? null,
      agentId: origin?.agentId ?? null,
      agentName: origin?.agentName ?? null,
    });
  }

  /** Rename/move a note on disk and update all references. */
  async renameNote(
    notesDir: string,
    oldPath: string,
    newPath: string,
    userId: string,
    origin?: VaultEventOrigin,
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

    const events = this.app.vaultEvents;
    if (events) {
      let updatedAt: string;
      let size: number;
      try {
        const stat = await fs.stat(newFullPath);
        updatedAt = stat.mtime.toISOString();
        size = stat.size;
      } catch {
        updatedAt = new Date().toISOString();
        size = 0;
      }
      // A pure rename keeps the parent directory; a move changes it. The
      // client treats them identically (drop from old path, insert at new)
      // but the kind discriminator lets a notification surface either
      // "renamed" or "moved" copy.
      const sameDir = path.dirname(oldPath) === path.dirname(newPath);
      events.emit(userId, {
        kind: sameDir ? "note.renamed" : "note.moved",
        from: oldPath,
        to: newPath,
        updatedAt,
        size,
        clientId: origin?.clientId ?? null,
        agentId: origin?.agentId ?? null,
        agentName: origin?.agentName ?? null,
      });
    }
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
