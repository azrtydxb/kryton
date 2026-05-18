/**
 * Filesystem primitives — atomic writes, backups, hashing, existence
 * checks. Every config mutation in the installer goes through these so
 * the dry-run + backup + hash-record invariants hold in one place.
 */

import { promises as fs, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, basename } from "node:path";

/** Read a file as utf-8, or null if it doesn't exist. */
export async function readFileMaybe(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** True if any kind of entry exists at `path`. */
export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomically write `content` to `path` (utf-8) by writing to a sibling
 * tmpfile and renaming. Creates parent directories as needed.
 */
export async function atomicWrite(path: string, content: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, path);
}

/**
 * Back up the file at `path` (if it exists) to
 * `<path>.kryton-init.bak.<timestamp>`. Returns the backup path, or null
 * if `path` didn't exist. Old `*.kryton-init.bak.*` siblings are
 * removed first so only the most recent backup is kept (matches the
 * spec).
 */
export async function backup(path: string): Promise<string | null> {
  if (!(await exists(path))) return null;
  const dir = dirname(path);
  const base = basename(path);
  // Sweep prior backups for this file.
  try {
    const entries = await fs.readdir(dir);
    for (const e of entries) {
      if (e.startsWith(`${base}.kryton-init.bak.`)) {
        await fs.unlink(join(dir, e)).catch(() => undefined);
      }
    }
  } catch {
    /* dir might not be listable; ignore */
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = `${path}.kryton-init.bak.${stamp}`;
  await fs.copyFile(path, bak);
  return bak;
}

/**
 * SHA-256 hash of file content (utf-8 bytes). Returns
 * `"sha256:<hex>"` or null if the file doesn't exist.
 */
export async function hash(path: string): Promise<string | null> {
  if (!(await exists(path))) return null;
  return await new Promise((resolve, reject) => {
    const h = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => h.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(`sha256:${h.digest("hex")}`));
  });
}

/** SHA-256 of a string ("sha256:<hex>"). */
export function hashString(s: string): string {
  return `sha256:${createHash("sha256").update(s, "utf8").digest("hex")}`;
}

/** Recursively remove a file (no-op if missing). */
export async function removeIfPresent(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
