// packages/core/src/sync/sync.ts
import type { SqliteAdapter } from "../adapter";
import type { EventBus } from "../events";
import type { LocalStorage } from "../storage";
import type { HttpSyncClient } from "./http";
import type { BaseRepository } from "../query/base";
import type { PullResponse } from "./protocol";

interface RepoMap { [entityType: string]: BaseRepository<any> | { applyPulledChanges: (...args: any[]) => void; collectPendingChanges: () => any; markSynced: (...args: any[]) => void } }

export interface SyncOrchestratorOpts {
  db: SqliteAdapter;
  bus: EventBus<any>;
  storage: LocalStorage;
  httpClient: { pull: HttpSyncClient["pull"]; push: HttpSyncClient["push"] };
  repositories: RepoMap;
}

export class SyncOrchestrator {
  private mutex = Promise.resolve();
  private autoTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private opts: SyncOrchestratorOpts) {}

  async pull(): Promise<{ entitiesChanged: number }> {
    return this.serialize(async () => {
      const cursor = this.opts.storage.get("server_cursor", "0");
      const resp = await this.opts.httpClient.pull(cursor);
      this.applyPullResponse(resp);
      this.opts.storage.set("server_cursor", resp.cursor);
      // count changed entities
      let count = 0;
      for (const v of Object.values(resp.changes)) {
        count += v.created.length + v.updated.length + v.deleted.length;
      }
      this.opts.bus.emit("sync:complete", undefined);
      return { entitiesChanged: count };
    });
  }

  private applyPullResponse(resp: PullResponse): void {
    for (const [entityType, changes] of Object.entries(resp.changes)) {
      const repo = this.opts.repositories[entityType];
      if (!repo) {
        console.warn(`[SyncOrchestrator] no repository for entity "${entityType}"; ignoring ${changes.created.length + changes.updated.length + changes.deleted.length} changes`);
        continue;
      }
      repo.applyPulledChanges(changes.created, changes.updated, changes.deleted);
    }
  }

  async push(): Promise<{ pushed: number; conflicts: number }> {
    return this.serialize(async () => {
      const changes: Record<string, any[]> = {};
      let pushed = 0;
      for (const [entityType, repo] of Object.entries(this.opts.repositories)) {
        const pending = repo.collectPendingChanges();
        const ops: any[] = [];
        for (const row of pending.created) {
          ops.push({ op: "create", id: row.id, fields: row });
        }
        for (const u of pending.updated) {
          ops.push({ op: "update", id: u.row.id, base_version: u.baseVersion, fields: u.row });
        }
        for (const id of pending.deleted) {
          ops.push({ op: "delete", id });
        }
        if (ops.length > 0) {
          changes[entityType] = ops;
          pushed += ops.length;
        }
      }

      if (pushed === 0) return { pushed: 0, conflicts: 0 };

      const resp = await this.opts.httpClient.push({ changes });

      // Mark accepted as synced
      for (const [entityType, accepted] of Object.entries(resp.accepted)) {
        const repo = this.opts.repositories[entityType];
        if (!repo) continue;
        const versionMap: Record<string, number> = {};
        for (const a of accepted) versionMap[a.id] = a.version;
        repo.markSynced(accepted.map((a: any) => a.id), versionMap);
      }

      // Emit conflicts
      for (const c of resp.conflicts) {
        this.opts.bus.emit("sync:conflict", c);
      }

      return { pushed, conflicts: resp.conflicts.length };
    });
  }

  async full(): Promise<void> {
    await this.pull();
    await this.push();
  }

  startAuto(opts: { intervalMs: number }): void {
    this.stopAuto();
    this.autoTimer = setInterval(() => {
      this.full().catch(e => console.warn("[SyncOrchestrator] auto-sync failed", e));
    }, opts.intervalMs);
  }

  stopAuto(): void {
    if (this.autoTimer) {
      clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutex.then(fn, fn);
    this.mutex = next.then(() => undefined, () => undefined);
    return next;
  }
}
