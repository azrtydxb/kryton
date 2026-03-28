import * as fs from "fs/promises";
import * as path from "path";

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

  // Ensure trash parent directory exists
  await fs.mkdir(path.dirname(destPath), { recursive: true });

  // Use rename (same filesystem)
  await fs.rename(sourcePath, destPath);
}
