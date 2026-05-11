import { and, eq, gt } from "drizzle-orm";
import type { Db } from "../../../db/client.js";
import {
  folder,
  graphEdge,
  noteTag,
  noteVersion,
  searchIndex,
  tag,
  trashItem,
} from "../../../db/schema/notes.js";
import { noteShare } from "../../../db/schema/sharing.js";
import { installedPlugin, settings } from "../../../db/schema/settings.js";
import { syncCursor } from "../../../db/schema/sync.js";
import {
  buildHandlers,
  serializeBigInt,
  type EntityOp,
  type HandlerResult,
} from "./sync-handlers.service.js";

interface TableChanges {
  created: unknown[];
  updated: unknown[];
  deleted: string[];
}

export class SyncService {
  private readonly handlers: ReturnType<typeof buildHandlers>;

  constructor(
    private readonly db: Db,
    notesRoot: string,
  ) {
    this.handlers = buildHandlers(notesRoot);
  }

  async getCursor(userId: string): Promise<bigint> {
    const row = await this.db.query.syncCursor.findFirst({
      where: eq(syncCursor.userId, userId),
    });
    return row?.cursor ?? 0n;
  }

  async pullChanges(
    userId: string,
    sinceCursor: bigint,
  ): Promise<{ cursor: string; changes: Record<string, TableChanges> }> {
    const changes: Record<string, TableChanges> = {};

    const newFolders = await this.db.query.folder.findMany({
      where: and(eq(folder.userId, userId), gt(folder.cursor, sinceCursor)),
    });
    changes.folders = {
      created: newFolders.map((f) => serializeBigInt(f as unknown as Record<string, unknown>)),
      updated: [],
      deleted: [],
    };

    const newTags = await this.db.query.tag.findMany({
      where: and(eq(tag.userId, userId), gt(tag.cursor, sinceCursor)),
    });
    changes.tags = {
      created: newTags.map((t) => serializeBigInt(t as unknown as Record<string, unknown>)),
      updated: [],
      deleted: [],
    };

    const newNoteTags = await this.db.query.noteTag.findMany({
      where: and(eq(noteTag.userId, userId), gt(noteTag.cursor, sinceCursor)),
    });
    changes.note_tags = {
      created: newNoteTags.map((n) => ({
        id: `${n.userId}:${n.notePath}:${n.tagId}`,
        ...serializeBigInt(n as unknown as Record<string, unknown>),
      })),
      updated: [],
      deleted: [],
    };

    const newSettings = await this.db.query.settings.findMany({
      where: and(eq(settings.userId, userId), gt(settings.cursor, sinceCursor)),
    });
    changes.settings = {
      created: newSettings.map((s) => serializeBigInt(s as unknown as Record<string, unknown>)),
      updated: [],
      deleted: [],
    };

    const newEdges = await this.db.query.graphEdge.findMany({
      where: and(eq(graphEdge.userId, userId), gt(graphEdge.cursor, sinceCursor)),
    });
    changes.graph_edges = {
      created: newEdges.map((e) => serializeBigInt(e as unknown as Record<string, unknown>)),
      updated: [],
      deleted: [],
    };

    const newShares = await this.db.query.noteShare.findMany({
      where: and(eq(noteShare.ownerUserId, userId), gt(noteShare.cursor, sinceCursor)),
    });
    changes.note_shares = {
      created: newShares.map((s) => serializeBigInt(s as unknown as Record<string, unknown>)),
      updated: [],
      deleted: [],
    };

    const newTrash = await this.db.query.trashItem.findMany({
      where: and(eq(trashItem.userId, userId), gt(trashItem.cursor, sinceCursor)),
    });
    changes.trash_items = {
      created: newTrash.map((t) => serializeBigInt(t as unknown as Record<string, unknown>)),
      updated: [],
      deleted: [],
    };

    const newPlugins = await this.db.query.installedPlugin.findMany({
      where: gt(installedPlugin.cursor, sinceCursor),
    });
    changes.installed_plugins = {
      created: newPlugins.map((p) => serializeBigInt(p as unknown as Record<string, unknown>)),
      updated: [],
      deleted: [],
    };

    const noteVersions = await this.db.query.noteVersion.findMany({
      where: and(eq(noteVersion.userId, userId), gt(noteVersion.cursor, sinceCursor)),
    });
    const noteRecords = await Promise.all(
      noteVersions.map(async (nv) => {
        const idx = await this.db.query.searchIndex.findFirst({
          where: and(
            eq(searchIndex.userId, userId),
            eq(searchIndex.notePath, nv.notePath),
          ),
        });
        if (!idx) return null;
        return {
          id: nv.notePath,
          path: nv.notePath,
          title: idx.title,
          tags: idx.tags,
          modifiedAt: idx.modifiedAt.getTime(),
          version: nv.version,
          cursor: nv.cursor.toString(),
        };
      }),
    );
    changes.notes = {
      created: noteRecords.filter((r): r is NonNullable<typeof r> => r !== null),
      updated: [],
      deleted: [],
    };

    const finalCursor = await this.getCursor(userId);
    return { cursor: finalCursor.toString(), changes };
  }

  async pushChanges(
    userId: string,
    changes: Record<string, EntityOp[]>,
  ): Promise<{
    accepted: Record<string, HandlerResult["accepted"]>;
    conflicts: Array<{
      table: string;
      id: string;
      current_version: number;
      current_state: unknown;
    }>;
  }> {
    const accepted: Record<string, HandlerResult["accepted"]> = {};
    const conflicts: Array<{
      table: string;
      id: string;
      current_version: number;
      current_state: unknown;
    }> = [];

    // notes handler touches fs, run outside transaction for compat.
    // It still receives a Drizzle "tx" — here we pass the non-tx db, which
    // exposes the same insert/update/delete/select API; cursor increments
    // remain atomic per call thanks to ON CONFLICT DO UPDATE.
    const notesOps = changes.notes;
    if (notesOps) {
      const notesResult = await this.handlers.notes(
        userId,
        notesOps,
        this.db as unknown as Parameters<typeof this.handlers.notes>[2],
      );
      accepted.notes = notesResult.accepted;
      for (const c of notesResult.conflicts) conflicts.push({ ...c, table: "notes" });
    }

    const dbChanges = { ...changes };
    delete dbChanges.notes;

    await this.db.transaction(async (tx) => {
      for (const [tableKey, ops] of Object.entries(dbChanges)) {
        const handler = this.handlers[tableKey];
        if (!handler) continue;
        const result = await handler(userId, ops as EntityOp[], tx);
        accepted[tableKey] = result.accepted;
        for (const c of result.conflicts) conflicts.push({ ...c, table: tableKey });
      }
    });

    return { accepted, conflicts };
  }
}
