import * as fsPromises from "fs/promises";
import * as pathModule from "path";
import type { PrismaClient } from "../../../generated/prisma/client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityOp =
  | { op: "create"; id: string; fields: Record<string, unknown> }
  | { op: "update"; id: string; base_version: number; fields: Record<string, unknown> }
  | { op: "delete"; id: string };

export interface HandlerResult {
  accepted: Array<{ id: string; version: number; merged_value?: Record<string, unknown> }>;
  conflicts: Array<{ id: string; current_version: number; current_state: unknown }>;
}

export type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export type Handler = (userId: string, ops: EntityOp[], tx: TxClient) => Promise<HandlerResult>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function incrementCursorIn(tx: TxClient, userId: string): Promise<bigint> {
  const r = await tx.syncCursor.upsert({
    where: { userId },
    update: { cursor: { increment: 1n } },
    create: { userId, cursor: 1n },
  });
  return r.cursor;
}

export function serializeBigInt<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return out;
}

function makeCrudHandler(
  model: string,
  getId: (op: EntityOp) => string,
  buildCreateData: (
    userId: string,
    op: Extract<EntityOp, { op: "create" }>,
    cursor: bigint,
  ) => Record<string, unknown>,
  buildUpdateData: (
    op: Extract<EntityOp, { op: "update" }>,
    cursor: bigint,
  ) => Record<string, unknown>,
  findWhere: (userId: string, id: string) => Record<string, unknown>,
  deleteWhere: (userId: string, id: string) => Record<string, unknown>,
): Handler {
  return async (userId, ops, tx): Promise<HandlerResult> => {
    const accepted: HandlerResult["accepted"] = [];
    const conflicts: HandlerResult["conflicts"] = [];
    const repo = (tx as unknown as Record<string, unknown>)[model] as {
      findUnique: (args: unknown) => Promise<{ version: number } | null>;
      create: (args: unknown) => Promise<{ id?: string; version: number }>;
      update: (args: unknown) => Promise<{ version: number }>;
      delete: (args: unknown) => Promise<unknown>;
    };

    for (const op of ops) {
      const id = getId(op);
      if (op.op === "create") {
        const cursor = await incrementCursorIn(tx, userId);
        const data = buildCreateData(userId, op, cursor);
        const created = await repo.create({ data });
        accepted.push({ id, version: created.version ?? 1 });
      } else if (op.op === "update") {
        const cur = await repo.findUnique({ where: findWhere(userId, id) });
        if (!cur) {
          conflicts.push({ id, current_version: 0, current_state: null });
          continue;
        }
        if (cur.version !== op.base_version) {
          conflicts.push({
            id,
            current_version: cur.version,
            current_state: serializeBigInt(cur as unknown as Record<string, unknown>),
          });
          continue;
        }
        const cursor = await incrementCursorIn(tx, userId);
        const updated = await repo.update({
          where: findWhere(userId, id),
          data: buildUpdateData(op, cursor),
        });
        accepted.push({ id, version: updated.version });
      } else if (op.op === "delete") {
        await repo.delete({ where: deleteWhere(userId, id) }).catch(() => {});
        accepted.push({ id, version: 0 });
      }
    }
    return { accepted, conflicts };
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function buildHandlers(notesRoot: string): Record<string, Handler> {
  return {
    folders: makeCrudHandler(
      "folder",
      (op) => op.id,
      (userId, op, cursor) => ({ ...op.fields, userId, version: 1, cursor }),
      (op, cursor) => ({ ...op.fields, version: { increment: 1 }, cursor }),
      (_userId, id) => ({ id }),
      (_userId, id) => ({ id }),
    ),

    tags: makeCrudHandler(
      "tag",
      (op) => op.id,
      (userId, op, cursor) => ({ ...op.fields, userId, version: 1, cursor }),
      (op, cursor) => ({ ...op.fields, version: { increment: 1 }, cursor }),
      (_userId, id) => ({ id }),
      (_userId, id) => ({ id }),
    ),

    note_tags: async (userId, ops, tx) => {
      const accepted: HandlerResult["accepted"] = [];
      const conflicts: HandlerResult["conflicts"] = [];
      for (const op of ops) {
        if (op.op === "create") {
          const f = op.fields as { notePath: string; tagId: string };
          const cursor = await incrementCursorIn(tx, userId);
          await tx.noteTag.upsert({
            where: { userId_notePath_tagId: { userId, notePath: f.notePath, tagId: f.tagId } },
            update: {},
            create: { userId, notePath: f.notePath, tagId: f.tagId, version: 1, cursor },
          });
          accepted.push({ id: op.id, version: 1 });
        } else if (op.op === "delete") {
          const parts = op.id.split(":");
          if (parts.length === 3) {
            const [, notePath, tagId] = parts;
            await tx.noteTag
              .delete({ where: { userId_notePath_tagId: { userId, notePath, tagId } } })
              .catch(() => {});
          }
          accepted.push({ id: op.id, version: 0 });
        }
      }
      return { accepted, conflicts };
    },

    settings: async (userId, ops, tx) => {
      const accepted: HandlerResult["accepted"] = [];
      const conflicts: HandlerResult["conflicts"] = [];
      for (const op of ops) {
        if (op.op === "create" || op.op === "update") {
          const f = op.fields as { key: string; value: string };
          if (op.op === "update") {
            const cur = await tx.settings.findUnique({
              where: { key_userId: { key: f.key, userId } },
            });
            if (cur && cur.version !== op.base_version) {
              conflicts.push({
                id: op.id,
                current_version: cur.version,
                current_state: serializeBigInt(cur as unknown as Record<string, unknown>),
              });
              continue;
            }
          }
          const cursor = await incrementCursorIn(tx, userId);
          const row = await tx.settings.upsert({
            where: { key_userId: { key: f.key, userId } },
            update: { value: f.value, version: { increment: 1 }, cursor },
            create: { key: f.key, userId, value: f.value, version: 1, cursor },
          });
          accepted.push({ id: op.id, version: row.version });
        } else if (op.op === "delete") {
          const parts = op.id.split(":");
          const key = parts.slice(1).join(":");
          await tx.settings.delete({ where: { key_userId: { key, userId } } }).catch(() => {});
          accepted.push({ id: op.id, version: 0 });
        }
      }
      return { accepted, conflicts };
    },

    graph_edges: makeCrudHandler(
      "graphEdge",
      (op) => op.id,
      (userId, op, cursor) => ({ ...op.fields, userId, version: 1, cursor }),
      (op, cursor) => ({ ...op.fields, version: { increment: 1 }, cursor }),
      (_userId, id) => ({ id }),
      (_userId, id) => ({ id }),
    ),

    note_shares: makeCrudHandler(
      "noteShare",
      (op) => op.id,
      (userId, op, cursor) => ({ ...op.fields, ownerUserId: userId, version: 1, cursor }),
      (op, cursor) => ({ ...op.fields, version: { increment: 1 }, cursor }),
      (_userId, id) => ({ id }),
      (_userId, id) => ({ id }),
    ),

    trash_items: makeCrudHandler(
      "trashItem",
      (op) => op.id,
      (_userId, op, cursor) => ({ ...op.fields, version: 1, cursor }),
      (op, cursor) => ({ ...op.fields, version: { increment: 1 }, cursor }),
      (_userId, id) => ({ id }),
      (_userId, id) => ({ id }),
    ),

    installed_plugins: makeCrudHandler(
      "installedPlugin",
      (op) => op.id,
      (_userId, op, cursor) => ({ ...op.fields, cursor }),
      (op, cursor) => ({ ...op.fields, version: { increment: 1 }, cursor }),
      (_userId, id) => ({ id }),
      (_userId, id) => ({ id }),
    ),

    notes: async (userId, ops, tx) => {
      const accepted: HandlerResult["accepted"] = [];
      const conflicts: HandlerResult["conflicts"] = [];
      const userDir = pathModule.join(notesRoot, userId);
      await fsPromises.mkdir(userDir, { recursive: true });

      for (const op of ops) {
        if (op.op === "create" || op.op === "update") {
          const f = op.fields as {
            path: string;
            title?: string;
            content?: string;
            tags?: string;
            modifiedAt?: number;
          };
          const filePath = pathModule.join(userDir, f.path);
          const cur = await tx.noteVersion.findUnique({
            where: { userId_notePath: { userId, notePath: f.path } },
          });
          if (op.op === "update" && cur && cur.version !== op.base_version) {
            conflicts.push({
              id: op.id,
              current_version: cur.version,
              current_state: serializeBigInt(cur as unknown as Record<string, unknown>),
            });
            continue;
          }
          await fsPromises.mkdir(pathModule.dirname(filePath), { recursive: true });
          await fsPromises.writeFile(filePath, f.content ?? "");
          const cursor = await incrementCursorIn(tx, userId);

          let tags: string[] = [];
          try {
            tags = JSON.parse(f.tags ?? "[]");
          } catch {
            /* empty */
          }
          const existingIdx = await tx.searchIndex.findFirst({
            where: { userId, notePath: f.path },
          });
          const existingTags: string[] = existingIdx
            ? (() => {
                try {
                  return JSON.parse(existingIdx.tags);
                } catch {
                  return [];
                }
              })()
            : [];
          const mergedTags = Array.from(new Set([...existingTags, ...tags]));

          await tx.searchIndex.upsert({
            where: { notePath_userId: { notePath: f.path, userId } },
            update: {
              title: f.title ?? existingIdx?.title ?? f.path,
              tags: JSON.stringify(mergedTags),
              modifiedAt: f.modifiedAt !== null ? new Date(f.modifiedAt) : new Date(),
              content: f.content ?? existingIdx?.content ?? "",
            },
            create: {
              notePath: f.path,
              userId,
              title: f.title ?? f.path,
              content: f.content ?? "",
              tags: JSON.stringify(mergedTags),
              modifiedAt: f.modifiedAt !== null ? new Date(f.modifiedAt) : new Date(),
            },
          });

          const nv = await tx.noteVersion.upsert({
            where: { userId_notePath: { userId, notePath: f.path } },
            update: { version: { increment: 1 }, cursor },
            create: { userId, notePath: f.path, version: 1, cursor },
          });

          if (f.content !== null) {
            await tx.noteRevision.create({
              data: { userId, notePath: f.path, content: String(f.content) },
            });
          }

          accepted.push({ id: op.id, version: nv.version, merged_value: { tags: mergedTags } });
        } else if (op.op === "delete") {
          const filePath = pathModule.join(userDir, op.id);
          await fsPromises.unlink(filePath).catch(() => {});
          await tx.searchIndex.deleteMany({ where: { userId, notePath: op.id } });
          await tx.noteVersion.deleteMany({ where: { userId, notePath: op.id } });
          accepted.push({ id: op.id, version: 0 });
        }
      }
      return { accepted, conflicts };
    },
  };
}
