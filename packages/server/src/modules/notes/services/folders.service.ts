import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ValidationError } from "../../../lib/errors.js";
import type { NoteService } from "./note.service.js";
import { getUserNotesDir } from "./user-notes-dir.service.js";

/**
 * In-process folder API consumed by:
 *   - `/api/folders*` route handlers
 *   - MCP tool executors (create_folder / rename_folder / delete_folder)
 *
 * Filesystem operations + path-safety checks live here, so the two
 * call sites can't drift. Auth + backfill stay in the route preHandlers.
 */
export class FoldersApi {
  constructor(
    private readonly notesDir: string,
    private readonly noteService: NoteService,
  ) {}

  /** Create a folder relative to the user's notes dir. */
  async create(userId: string, folderPath: string): Promise<{ path: string }> {
    if (!folderPath) throw new ValidationError("Path is required");
    const userDir = await getUserNotesDir(this.notesDir, userId);
    const fullPath = path.join(userDir, folderPath);
    this.assertWithin(fullPath, userDir);
    await fs.mkdir(fullPath, { recursive: true });
    return { path: folderPath };
  }

  /**
   * Delete a folder. Every `.md` file inside is sent through the
   * NoteService delete pipeline first so it lands in trash and the
   * indexes update. Non-md files (rare) get dropped.
   */
  async delete(userId: string, folderPath: string): Promise<void> {
    if (!folderPath) throw new ValidationError("Path is required");
    const userDir = await getUserNotesDir(this.notesDir, userId);
    const fullPath = path.join(userDir, folderPath);
    this.assertWithin(fullPath, userDir);

    const markdownFiles = await collectMarkdownFiles(userDir, folderPath);
    for (const relPath of markdownFiles) {
      await this.noteService.deleteNote(userDir, relPath, userId);
    }
    await fs.rm(fullPath, { recursive: true, force: true });
  }

  /** Rename or move a folder. */
  async rename(
    userId: string,
    oldPath: string,
    newPath: string,
  ): Promise<{ oldPath: string; newPath: string }> {
    if (!oldPath || !newPath) {
      throw new ValidationError("oldPath and newPath are required");
    }
    const userDir = await getUserNotesDir(this.notesDir, userId);
    const oldFull = path.join(userDir, oldPath);
    const newFull = path.join(userDir, newPath);
    this.assertWithin(oldFull, userDir);
    this.assertWithin(newFull, userDir);

    await fs.mkdir(path.dirname(newFull), { recursive: true });
    await fs.rename(oldFull, newFull);
    return { oldPath, newPath };
  }

  private assertWithin(target: string, base: string): void {
    const resolvedTarget = path.resolve(target);
    const resolvedBase = path.resolve(base);
    if (
      !resolvedTarget.startsWith(resolvedBase + path.sep) &&
      resolvedTarget !== resolvedBase
    ) {
      throw new ValidationError("Invalid path: outside allowed directory");
    }
  }
}

/** Walk a directory and return every .md file path relative to baseDir. */
async function collectMarkdownFiles(
  baseDir: string,
  relPath: string,
): Promise<string[]> {
  const out: string[] = [];
  const fullPath = path.join(baseDir, relPath);
  let entries: Array<{
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }>;
  try {
    entries = await fs.readdir(fullPath, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await collectMarkdownFiles(baseDir, childRel)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(childRel);
    }
  }
  return out;
}
