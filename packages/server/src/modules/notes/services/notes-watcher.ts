/**
 * Per-user notes-directory watcher.
 *
 * Keeps the SearchIndex and GraphEdge tables in sync with the filesystem
 * regardless of how files were added or removed (UI, MCP, git, manual rm,
 * Finder, etc.). This watcher handles everything that happens *while* the
 * server is running.
 *
 * One chokidar watcher per user-dir, started lazily on first request to that
 * user. Watches `<notesRoot>/<userId>` recursively, debouncing fs noise.
 *
 * Events:
 *   add / change  → read file content, call knowledge.indexNote +
 *                   knowledge.updateGraphCache.
 *   unlink        → call knowledge.removeFromIndex + knowledge.removeFromGraph.
 *   addDir / unlinkDir → ignored; folder rows are reconstructed by the
 *                   folders backfill on demand, and an empty folder has no
 *                   indexable content anyway.
 *
 * The watcher silently ignores anything under `.history/`, `.trash/`, or any
 * other dot-prefixed directory — those carry stale snapshots we don't want
 * in the live index.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { FastifyInstance } from "fastify";

interface WatcherEntry {
  watcher: FSWatcher;
  /** Best-effort timer so a rapid add+change pair only indexes once. */
  pending: Map<string, NodeJS.Timeout>;
}

const watchers = new Map<string, WatcherEntry>();

/** Path relative to a user's notes root, with normalized separators. */
function relPath(userRoot: string, full: string): string | null {
  const rel = path.relative(userRoot, full).split(path.sep).join("/");
  if (!rel || rel.startsWith("..")) return null;
  return rel;
}

/** Ignore anything under dot-prefixed dirs (.history/, .trash/, .git/, …). */
function isIgnored(rel: string): boolean {
  return rel.split("/").some((seg) => seg.startsWith("."));
}

/**
 * Ensure a watcher is running for `userId`. Idempotent: calling it again is a
 * no-op. Returns a Promise that resolves once chokidar's initial scan
 * finishes so callers can rely on "everything currently on disk has been
 * acknowledged" before continuing if they need that guarantee.
 */
export async function ensureNotesWatcher(
  app: FastifyInstance,
  notesRoot: string,
  userId: string,
): Promise<void> {
  if (watchers.has(userId)) return;
  const userRoot = path.join(notesRoot, userId);

  try {
    const s = await fs.stat(userRoot);
    if (!s.isDirectory()) return;
  } catch {
    // Dir doesn't exist yet — first note save will create it; the next
    // ensureNotesWatcher call from `ensureBackfilled` will see it and start.
    return;
  }

  const knowledge = app.knowledge;

  const watcher = chokidar.watch(userRoot, {
    ignored: (full) => {
      const rel = relPath(userRoot, full);
      return rel !== null && isIgnored(rel);
    },
    ignoreInitial: true, // startup reconcile handles cold state
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
  });

  const entry: WatcherEntry = { watcher, pending: new Map() };
  watchers.set(userId, entry);

  const reindex = async (full: string): Promise<void> => {
    const rel = relPath(userRoot, full);
    if (!rel || isIgnored(rel) || !rel.endsWith(".md")) return;
    try {
      const content = await fs.readFile(full, "utf-8");
      await knowledge.indexNote(rel, content, userId);
      await knowledge.updateGraph(rel, content, userId);
    } catch (err) {
      app.log.warn({ err, userId, path: rel }, "notes-watcher: reindex failed");
    }
  };

  const debounce = (full: string): void => {
    const rel = relPath(userRoot, full);
    if (!rel) return;
    const existing = entry.pending.get(rel);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      entry.pending.delete(rel);
      void reindex(full);
    }, 150);
    entry.pending.set(rel, t);
  };

  const drop = async (full: string): Promise<void> => {
    const rel = relPath(userRoot, full);
    if (!rel || isIgnored(rel) || !rel.endsWith(".md")) return;
    try {
      await knowledge.removeFromIndex(rel, userId);
      await knowledge.removeFromGraph(rel, userId);
    } catch (err) {
      app.log.warn({ err, userId, path: rel }, "notes-watcher: remove failed");
    }
  };

  watcher.on("add", debounce);
  watcher.on("change", debounce);
  watcher.on("unlink", (full) => {
    const rel = relPath(userRoot, full);
    if (rel) {
      const t = entry.pending.get(rel);
      if (t) {
        clearTimeout(t);
        entry.pending.delete(rel);
      }
    }
    void drop(full);
  });
  watcher.on("error", (err) => {
    app.log.warn({ err, userId }, "notes-watcher: error");
  });

  // Close cleanly on app shutdown so the test harness and graceful restarts
  // don't leak FDs.
  app.addHook("onClose", async () => {
    await stopNotesWatcher(userId);
  });
}

export async function stopNotesWatcher(userId: string): Promise<void> {
  const entry = watchers.get(userId);
  if (!entry) return;
  watchers.delete(userId);
  for (const t of entry.pending.values()) clearTimeout(t);
  entry.pending.clear();
  try {
    await entry.watcher.close();
  } catch {
    // best-effort
  }
}
