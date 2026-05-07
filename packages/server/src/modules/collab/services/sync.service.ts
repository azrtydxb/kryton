import type { PrismaClient } from "../../../generated/prisma/client.js";
import {
  buildHandlers,
  serializeBigInt,
  type EntityOp,
  type HandlerResult,
  type TxClient,
} from "./sync-handlers.service.js";

interface TableChanges {
  created: unknown[];
  updated: unknown[];
  deleted: string[];
}

export class SyncService {
  private readonly handlers: ReturnType<typeof buildHandlers>;

  constructor(
    private readonly prisma: PrismaClient,
    notesRoot: string,
  ) {
    this.handlers = buildHandlers(notesRoot);
  }

  async getCursor(userId: string): Promise<bigint> {
    const r = await this.prisma.syncCursor.findUnique({ where: { userId } });
    return r?.cursor ?? 0n;
  }

  async pullChanges(
    userId: string,
    sinceCursor: bigint,
  ): Promise<{ cursor: string; changes: Record<string, TableChanges> }> {
    const changes: Record<string, TableChanges> = {};
    const prisma = this.prisma;

    const newFolders = await prisma.folder.findMany({
      where: { userId, cursor: { gt: sinceCursor } },
    });
    changes.folders = {
      created: newFolders.map((f) => serializeBigInt(f as unknown as Record<string, unknown>)),
      updated: [],
      deleted: [],
    };

    const newTags = await prisma.tag.findMany({
      where: { userId, cursor: { gt: sinceCursor } },
    });
    changes.tags = {
      created: newTags.map((t) => serializeBigInt(t as unknown as Record<string, unknown>)),
      updated: [],
      deleted: [],
    };

    const newNoteTags = await prisma.noteTag.findMany({
      where: { userId, cursor: { gt: sinceCursor } },
    });
    changes.note_tags = {
      created: newNoteTags.map((n) => ({
        id: `${n.userId}:${n.notePath}:${n.tagId}`,
        ...serializeBigInt(n as unknown as Record<string, unknown>),
      })),
      updated: [],
      deleted: [],
    };

    const newSettings = await prisma.settings.findMany({
      where: { userId, cursor: { gt: sinceCursor } },
    });
    changes.settings = {
      created: newSettings.map((s) => serializeBigInt(s as unknown as Record<string, unknown>)),
      updated: [],
      deleted: [],
    };

    const newEdges = await prisma.graphEdge.findMany({
      where: { userId, cursor: { gt: sinceCursor } },
    });
    changes.graph_edges = {
      created: newEdges.map((e) => serializeBigInt(e as unknown as Record<string, unknown>)),
      updated: [],
      deleted: [],
    };

    const newShares = await prisma.noteShare.findMany({
      where: { ownerUserId: userId, cursor: { gt: sinceCursor } },
    });
    changes.note_shares = {
      created: newShares.map((s) => serializeBigInt(s as unknown as Record<string, unknown>)),
      updated: [],
      deleted: [],
    };

    const newTrash = await prisma.trashItem.findMany({
      where: { userId, cursor: { gt: sinceCursor } },
    });
    changes.trash_items = {
      created: newTrash.map((t) => serializeBigInt(t as unknown as Record<string, unknown>)),
      updated: [],
      deleted: [],
    };

    const newPlugins = await prisma.installedPlugin.findMany({
      where: { cursor: { gt: sinceCursor } },
    });
    changes.installed_plugins = {
      created: newPlugins.map((p) => serializeBigInt(p as unknown as Record<string, unknown>)),
      updated: [],
      deleted: [],
    };

    const noteVersions = await prisma.noteVersion.findMany({
      where: { userId, cursor: { gt: sinceCursor } },
    });
    const noteRecords = await Promise.all(
      noteVersions.map(async (nv) => {
        const idx = await prisma.searchIndex.findFirst({
          where: { userId, notePath: nv.notePath },
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

    // notes handler touches fs, run outside transaction for compat
    const notesOps = changes.notes;
    if (notesOps) {
      const notesResult = await this.handlers.notes(
        userId,
        notesOps,
        this.prisma as unknown as TxClient,
      );
      accepted.notes = notesResult.accepted;
      for (const c of notesResult.conflicts) conflicts.push({ ...c, table: "notes" });
    }

    const dbChanges = { ...changes };
    delete dbChanges.notes;

    await this.prisma.$transaction(async (tx) => {
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
