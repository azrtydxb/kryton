import * as fs from "fs/promises";
import * as path from "path";

export const HISTORY_DIR = ".history";
export const MAX_VERSIONS = 50;

/**
 * Return the history directory for a given note path within a user notes dir.
 * e.g. notesDir/.history/folder/note.md/
 */
export function getNoteHistoryDir(userNotesDir: string, notePath: string): string {
  return path.join(userNotesDir, HISTORY_DIR, notePath);
}

/**
 * Delete the oldest version files, keeping at most MAX_VERSIONS.
 */
async function pruneHistory(historyDir: string): Promise<void> {
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(historyDir, { withFileTypes: true });
  } catch {
    return;
  }

  const versionFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort(); // lexicographic sort = chronological for timestamp filenames

  if (versionFiles.length > MAX_VERSIONS) {
    const toDelete = versionFiles.slice(0, versionFiles.length - MAX_VERSIONS);
    for (const filename of toDelete) {
      try {
        await fs.unlink(path.join(historyDir, filename));
      } catch {
        // Best-effort
      }
    }
  }
}

/**
 * Save the current content of a note as a versioned snapshot in .history/.
 * Called by writeNote before overwriting the file.
 * Prunes oldest versions when MAX_VERSIONS is exceeded.
 */
export async function saveHistorySnapshot(
  userNotesDir: string,
  notePath: string,
  currentContent: string
): Promise<void> {
  const historyDir = getNoteHistoryDir(userNotesDir, notePath);
  await fs.mkdir(historyDir, { recursive: true });

  const timestamp = Date.now();
  const versionFile = path.join(historyDir, `${timestamp}.md`);
  await fs.writeFile(versionFile, currentContent, "utf-8");

  // Prune oldest versions if we exceed MAX_VERSIONS
  await pruneHistory(historyDir);
}
