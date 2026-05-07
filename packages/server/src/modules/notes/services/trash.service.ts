import * as fs from "node:fs/promises";
import * as path from "node:path";

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
