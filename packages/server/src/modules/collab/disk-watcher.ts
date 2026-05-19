import * as fs from "node:fs/promises";
import * as path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { FastifyBaseLogger } from "fastify";
import { wasRecentSelfWrite } from "../notes/services/note.service.js";
import type { YjsRegistry } from "./ws/yjs.handler.js";

/**
 * Per-user chokidar watcher tracking external `.md` changes (git pull,
 * Finder, vim, etc.) and propagating them into the matching live Y.Doc.
 *
 * Lifecycle: started by `YjsRegistry.setLifecycleHandlers.onUserActive`
 * on the first live doc for a user, stopped by `onUserIdle` on last
 * eviction. We never watch users who aren't actively editing.
 *
 * Loop prevention: every server-initiated write (including the flushes
 * THIS watcher's `applyDiskUpdate` triggers downstream) records the
 * `(absPath, sha)` in `selfWriteCache` via `recordSelfWrite` BEFORE
 * yielding to the event loop. The watcher checks `wasRecentSelfWrite`
 * on every fs change event and skips matches — that's how we avoid the
 * disk→Y→flush→disk→watcher echo loop.
 */
export interface DiskWatcherDeps {
  log: FastifyBaseLogger;
  registry: YjsRegistry;
}

interface UserWatcher {
  watcher: FSWatcher;
  notesDir: string;
}

export class DiskWatcherManager {
  private readonly watchers = new Map<string, UserWatcher>();
  private readonly starting = new Map<string, Promise<void>>();

  constructor(private readonly deps: DiskWatcherDeps) {}

  /**
   * Start watching the given user's notes directory. Idempotent — a
   * second call while already running is a no-op. Concurrent calls
   * coalesce on a single chokidar boot.
   */
  start(userId: string, notesDir: string): Promise<void> {
    if (this.watchers.has(userId)) return Promise.resolve();
    const inflight = this.starting.get(userId);
    if (inflight) return inflight;

    const p = (async () => {
      const watcher = chokidar.watch(notesDir, {
        ignoreInitial: true,
        // Wait until writes settle before firing — avoids partial reads
        // mid-save from external editors.
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
        ignored: (p) => path.basename(p).startsWith("."),
      });
      this.watchers.set(userId, { watcher, notesDir });

      const onFsEvent = async (absPath: string): Promise<void> => {
        if (!absPath.endsWith(".md")) return;
        const rel = path.relative(notesDir, absPath);
        if (rel.startsWith("..") || path.isAbsolute(rel)) return;
        // chokidar paths use the platform separator; docId is forward-slash.
        const docId = rel.split(path.sep).join("/");

        // Cheap filter: skip if there's no live doc for this path+user.
        // Saves the disk read + sha for the vast majority of events when
        // the user has only one or two notes open.
        if (!this.deps.registry.hasLiveDoc(docId, userId)) return;

        let diskContent: string;
        try {
          diskContent = await fs.readFile(absPath, "utf-8");
        } catch (err) {
          this.deps.log.debug(
            { err, absPath },
            "disk-watcher: read failed (file may have been removed mid-event)",
          );
          return;
        }

        // Self-write dedupe: if the on-disk content matches what we just
        // wrote, the event is our own echo. Skip.
        if (wasRecentSelfWrite(absPath, diskContent)) return;

        try {
          await this.deps.registry.applyDiskUpdate(docId, userId, diskContent);
        } catch (err) {
          this.deps.log.warn(
            { err, docId, userId },
            "disk-watcher: applyDiskUpdate failed",
          );
        }
      };

      watcher.on("change", (p) => void onFsEvent(p));
      watcher.on("add", (p) => void onFsEvent(p));
      watcher.on("error", (err) => {
        this.deps.log.warn({ err, userId }, "disk-watcher: chokidar error");
      });

      await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
    })().finally(() => {
      this.starting.delete(userId);
    });

    this.starting.set(userId, p);
    return p;
  }

  /** Stop watching the given user's notes directory. */
  async stop(userId: string): Promise<void> {
    const entry = this.watchers.get(userId);
    if (!entry) return;
    this.watchers.delete(userId);
    try {
      await entry.watcher.close();
    } catch (err) {
      this.deps.log.warn({ err, userId }, "disk-watcher: close failed");
    }
  }

  async stopAll(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const userId of [...this.watchers.keys()]) {
      tasks.push(this.stop(userId));
    }
    await Promise.allSettled(tasks);
  }
}
