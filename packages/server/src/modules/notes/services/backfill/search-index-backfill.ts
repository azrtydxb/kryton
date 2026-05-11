/**
 * Walk a user's notes dir on first authenticated request and ensure every
 * `.md` file is reflected in `SearchIndex` + `GraphEdge`. Idempotent.
 *
 * This replaces the file-by-file initial scan that the deleted MiniSearch
 * reconcile module used to do (see PR #109's Phase 6, which removed the
 * MiniSearch index manager but left the boot-time index population gap
 * behind). The chokidar watcher in `notes-watcher.ts` runs with
 * `ignoreInitial: true`, so without this backfill the SearchIndex (and the
 * tsvector column) stays empty until each note is touched again.
 *
 * For performance, we read `SearchIndex.modifiedAt` for the user up front
 * and only re-index files whose disk mtime exceeds the indexed mtime (or
 * have no index row yet).
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { searchIndex } from "../../../../db/schema/notes.js";

/** Recursively list every .md file under `userRoot`, skipping dot-dirs. */
async function listMarkdownFiles(userRoot: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      const sub = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(full, sub);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        out.push(sub);
      }
    }
  }
  await walk(userRoot, "");
  return out;
}

export async function backfillSearchIndex(
  app: FastifyInstance,
  notesRoot: string,
  userId: string,
): Promise<number> {
  const userRoot = path.join(notesRoot, userId);
  let stats;
  try {
    stats = await fs.stat(userRoot);
  } catch {
    return 0;
  }
  if (!stats.isDirectory()) return 0;

  const knowledge = app.knowledge;
  if (!knowledge) return 0;

  // Existing index: notePath → modifiedAt. We re-index files whose disk
  // mtime is newer than the indexed mtime, plus any file not in the index.
  const rows = await app.db
    .select({ notePath: searchIndex.notePath, modifiedAt: searchIndex.modifiedAt })
    .from(searchIndex)
    .where(eq(searchIndex.userId, userId));
  const indexed = new Map(rows.map((r) => [r.notePath, r.modifiedAt.getTime()]));

  const paths = await listMarkdownFiles(userRoot);
  let touched = 0;
  for (const rel of paths) {
    const full = path.join(userRoot, rel);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    const existing = indexed.get(rel);
    if (existing !== undefined && existing >= stat.mtimeMs) continue;
    try {
      const content = await fs.readFile(full, "utf-8");
      await knowledge.indexNote(rel, content, userId);
      await knowledge.updateGraph(rel, content, userId);
      touched++;
    } catch (err) {
      app.log.warn({ err, userId, path: rel }, "search-index-backfill: skip");
    }
  }
  return touched;
}
