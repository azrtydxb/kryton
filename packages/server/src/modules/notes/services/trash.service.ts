import * as fs from "node:fs/promises";
import * as path from "node:path";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { NotFoundError, ValidationError } from "../../../lib/errors.js";
import { trashItem } from "../../../db/schema/notes.js";
import { getUserNotesDir } from "./user-notes-dir.service.js";

const TRASH_DIR = ".trash";

/**
 * Return the trash directory path for a given user notes dir.
 */
export function getTrashDir(userNotesDir: string): string {
  return path.join(userNotesDir, TRASH_DIR);
}

/**
 * Move a note to the trash directory, preserving its relative path structure.
 */
export async function moveToTrash(userNotesDir: string, notePath: string): Promise<void> {
  const trashDir = getTrashDir(userNotesDir);
  const sourcePath = path.join(userNotesDir, notePath);
  const destPath = path.join(trashDir, notePath);

  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.rename(sourcePath, destPath);
}

/**
 * Recursively remove empty directories up to (but not including) stopDir.
 */
export async function removeEmptyDirs(dir: string, stopDir: string): Promise<void> {
  if (dir === stopDir || !dir.startsWith(stopDir)) return;
  try {
    const entries = await fs.readdir(dir);
    if (entries.length === 0) {
      await fs.rmdir(dir);
      await removeEmptyDirs(path.dirname(dir), stopDir);
    }
  } catch {
    // Ignore errors
  }
}

export interface TrashItem {
  path: string;
  originalPath: string;
  trashedAt: Date;
}

/**
 * Recursively scan a directory and return all .md file paths relative to basePath.
 */
export async function scanTrash(dir: string, basePath = ""): Promise<TrashItem[]> {
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const items: TrashItem[] = [];
  for (const entry of entries) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const children = await scanTrash(fullPath, relativePath);
      items.push(...children);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const stat = await fs.stat(fullPath);
      items.push({
        path: relativePath,
        originalPath: relativePath,
        trashedAt: stat.mtime,
      });
    }
  }
  return items;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * In-process trash API consumed by:
 *   - `/api/trash*` route handlers (delegate so the validation + DB
 *     cleanup live in one place);
 *   - MCP tool executors (list_trash / restore_from_trash / empty_trash).
 *
 * Per-request preHandlers in the routes still enforce auth + backfill;
 * this service trusts that whoever calls it has already authorised the
 * userId. It owns the filesystem moves, path-safety checks, and the
 * trash_item DB row cleanup.
 */
export class TrashApi {
  constructor(
    private readonly app: FastifyInstance,
    private readonly notesDir: string,
  ) {}

  /** List trashed notes for a user. */
  async list(userId: string): Promise<TrashItem[]> {
    const userDir = await getUserNotesDir(this.notesDir, userId);
    return scanTrash(getTrashDir(userDir));
  }

  /** Restore a note from trash back to its original location. */
  async restore(userId: string, notePath: string): Promise<{ path: string }> {
    if (!notePath) throw new ValidationError("Path is required");
    const userDir = await getUserNotesDir(this.notesDir, userId);
    const trashDir = getTrashDir(userDir);
    const fullNotePath = notePath.endsWith(".md") ? notePath : `${notePath}.md`;

    const trashFilePath = path.join(trashDir, fullNotePath);
    const restorePath = path.join(userDir, fullNotePath);
    this.assertWithin(trashFilePath, trashDir);
    this.assertWithin(restorePath, userDir);

    try {
      await fs.stat(trashFilePath);
    } catch {
      throw new NotFoundError("Note not found in trash");
    }

    await fs.mkdir(path.dirname(restorePath), { recursive: true });
    await fs.rename(trashFilePath, restorePath);
    await removeEmptyDirs(path.dirname(trashFilePath), trashDir);

    const record = await this.app.db.query.trashItem.findFirst({
      where: and(eq(trashItem.originalPath, fullNotePath), eq(trashItem.userId, userId)),
    });
    if (record) {
      await this.app.db.delete(trashItem).where(eq(trashItem.id, record.id));
    }
    return { path: fullNotePath };
  }

  /** Permanently delete a single note from trash. */
  async permanentlyDelete(userId: string, notePath: string): Promise<void> {
    if (!notePath) throw new ValidationError("Path is required");
    const userDir = await getUserNotesDir(this.notesDir, userId);
    const trashDir = getTrashDir(userDir);
    const fullNotePath = notePath.endsWith(".md") ? notePath : `${notePath}.md`;
    const trashFilePath = path.join(trashDir, fullNotePath);
    this.assertWithin(trashFilePath, trashDir);

    try {
      await fs.unlink(trashFilePath);
    } catch {
      throw new NotFoundError("Note not found in trash");
    }
    await removeEmptyDirs(path.dirname(trashFilePath), trashDir);

    const record = await this.app.db.query.trashItem.findFirst({
      where: and(eq(trashItem.originalPath, fullNotePath), eq(trashItem.userId, userId)),
    });
    if (record) {
      await this.app.db.delete(trashItem).where(eq(trashItem.id, record.id));
    }
  }

  /** Empty the entire trash for a user. */
  async emptyAll(userId: string): Promise<void> {
    const userDir = await getUserNotesDir(this.notesDir, userId);
    const trashDir = getTrashDir(userDir);
    try {
      await fs.rm(trashDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    const records = await this.app.db.query.trashItem.findMany({
      where: eq(trashItem.userId, userId),
    });
    if (records.length > 0) {
      await this.app.db.delete(trashItem).where(eq(trashItem.userId, userId));
    }
  }

  /** Refuse symlink / `..` escapes out of the trash or user dirs. */
  private assertWithin(target: string, base: string): void {
    const resolvedTarget = path.resolve(target);
    const resolvedBase = path.resolve(base);
    if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
      throw new ValidationError("Invalid path");
    }
  }
}

/**
 * Auto-purge trash items older than 30 days for a user.
 */
export async function purgeOldTrash(userNotesDir: string): Promise<void> {
  const trashDir = getTrashDir(userNotesDir);
  const items = await scanTrash(trashDir);
  const cutoff = Date.now() - THIRTY_DAYS_MS;

  for (const item of items) {
    if (item.trashedAt.getTime() < cutoff) {
      const fullPath = path.join(trashDir, item.path);
      try {
        await fs.unlink(fullPath);
        await removeEmptyDirs(path.dirname(fullPath), trashDir);
      } catch {
        // Best-effort
      }
    }
  }
}
