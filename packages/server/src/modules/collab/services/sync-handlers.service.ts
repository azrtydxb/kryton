import * as fsPromises from "fs/promises";
import * as pathModule from "path";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../../db/client.js";
import {
  folder,
  graphEdge,
  noteRevision,
  noteTag,
  noteVersion,
  searchIndex,
  tag,
  trashItem,
} from "../../../db/schema/notes.js";
import { noteShare } from "../../../db/schema/sharing.js";
import { settings, installedPlugin } from "../../../db/schema/settings.js";
import { syncCursor } from "../../../db/schema/sync.js";

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

/** Drizzle Postgres transaction type. */
export type TxClient = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Handler = (userId: string, ops: EntityOp[], tx: TxClient) => Promise<HandlerResult>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Increment the per-user sync cursor and return its new value. Uses a single
 * INSERT … ON CONFLICT DO UPDATE so concurrent writers don't lose updates.
 */
export async function incrementCursorIn(tx: TxClient, userId: string): Promise<bigint> {
  const [row] = await tx
    .insert(syncCursor)
    .values({ userId, cursor: 1n })
    .onConflictDoUpdate({
      target: syncCursor.userId,
      set: { cursor: sql`${syncCursor.cursor} + 1` },
    })
    .returning({ cursor: syncCursor.cursor });
  return row.cursor;
}

export function serializeBigInt<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generic CRUD handler factory (single-table, integer-version optimistic
// concurrency, keyed by `id` column).
// ---------------------------------------------------------------------------

interface TableConfig {
  /** Build the create row given userId, op fields, new cursor. */
  buildCreate: (userId: string, fields: Record<string, unknown>, cursor: bigint) => Record<string, unknown>;
  /** Build the update row given op fields, new cursor. */
  buildUpdate: (fields: Record<string, unknown>, cursor: bigint) => Record<string, unknown>;
}

function makeCrudHandler<T extends { id: unknown; version: unknown }>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  cfg: TableConfig,
): Handler {
  return async (userId, ops, tx): Promise<HandlerResult> => {
    const accepted: HandlerResult["accepted"] = [];
    const conflicts: HandlerResult["conflicts"] = [];

    for (const op of ops) {
      const id = op.id;
      if (op.op === "create") {
        const cursor = await incrementCursorIn(tx, userId);
        const data = cfg.buildCreate(userId, op.fields, cursor);
        const [created] = await tx
          .insert(table)
          .values(data)
          .returning() as T[];
        accepted.push({ id, version: (created.version as number | undefined) ?? 1 });
      } else if (op.op === "update") {
        const cur = await tx
          .select()
          .from(table)
          .where(eq(table.id, id))
          .limit(1)
          .then((rows: T[]) => rows[0] ?? null);
        if (!cur) {
          conflicts.push({ id, current_version: 0, current_state: null });
          continue;
        }
        const curVersion = cur.version as number;
        if (curVersion !== op.base_version) {
          conflicts.push({
            id,
            current_version: curVersion,
            current_state: serializeBigInt(cur as unknown as Record<string, unknown>),
          });
          continue;
        }
        const cursor = await incrementCursorIn(tx, userId);
        const data = cfg.buildUpdate(op.fields, cursor);
        const [updated] = await tx
          .update(table)
          .set({ ...data, version: sql`${table.version} + 1` })
          .where(eq(table.id, id))
          .returning() as T[];
        accepted.push({ id, version: updated.version as number });
      } else if (op.op === "delete") {
        await tx.delete(table).where(eq(table.id, id));
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
    folders: makeCrudHandler(folder, {
      buildCreate: (userId, fields, cursor) => ({ ...fields, userId, version: 1, cursor }),
      buildUpdate: (fields, cursor) => ({ ...fields, cursor }),
    }),

    tags: makeCrudHandler(tag, {
      buildCreate: (userId, fields, cursor) => ({ ...fields, userId, version: 1, cursor }),
      buildUpdate: (fields, cursor) => ({ ...fields, cursor }),
    }),

    note_tags: async (userId, ops, tx) => {
      const accepted: HandlerResult["accepted"] = [];
      const conflicts: HandlerResult["conflicts"] = [];
      for (const op of ops) {
        if (op.op === "create") {
          const f = op.fields as { notePath: string; tagId: string };
          const cursor = await incrementCursorIn(tx, userId);
          await tx
            .insert(noteTag)
            .values({
              userId,
              notePath: f.notePath,
              tagId: f.tagId,
              version: 1,
              cursor,
            })
            .onConflictDoNothing({
              target: [noteTag.userId, noteTag.notePath, noteTag.tagId],
            });
          accepted.push({ id: op.id, version: 1 });
        } else if (op.op === "delete") {
          const parts = op.id.split(":");
          if (parts.length === 3) {
            const [, notePath, tagId] = parts;
            await tx
              .delete(noteTag)
              .where(
                and(
                  eq(noteTag.userId, userId),
                  eq(noteTag.notePath, notePath),
                  eq(noteTag.tagId, tagId),
                ),
              );
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
            const cur = await tx
              .select()
              .from(settings)
              .where(and(eq(settings.key, f.key), eq(settings.userId, userId)))
              .limit(1)
              .then((rows) => rows[0] ?? null);
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
          const [row] = await tx
            .insert(settings)
            .values({ key: f.key, userId, value: f.value, version: 1, cursor })
            .onConflictDoUpdate({
              target: [settings.key, settings.userId],
              set: {
                value: f.value,
                version: sql`${settings.version} + 1`,
                cursor,
                updatedAt: new Date(),
              },
            })
            .returning();
          accepted.push({ id: op.id, version: row.version });
        } else if (op.op === "delete") {
          const parts = op.id.split(":");
          const key = parts.slice(1).join(":");
          await tx
            .delete(settings)
            .where(and(eq(settings.key, key), eq(settings.userId, userId)));
          accepted.push({ id: op.id, version: 0 });
        }
      }
      return { accepted, conflicts };
    },

    graph_edges: makeCrudHandler(graphEdge, {
      buildCreate: (userId, fields, cursor) => ({ ...fields, userId, version: 1, cursor }),
      buildUpdate: (fields, cursor) => ({ ...fields, cursor }),
    }),

    note_shares: makeCrudHandler(noteShare, {
      buildCreate: (userId, fields, cursor) => ({
        ...fields,
        ownerUserId: userId,
        version: 1,
        cursor,
      }),
      buildUpdate: (fields, cursor) => ({ ...fields, cursor }),
    }),

    trash_items: makeCrudHandler(trashItem, {
      buildCreate: (_userId, fields, cursor) => ({ ...fields, version: 1, cursor }),
      buildUpdate: (fields, cursor) => ({ ...fields, cursor }),
    }),

    installed_plugins: async (userId, ops, tx) => {
      // InstalledPlugin has no `version` column (uses `schemaVersion`) and the
      // primary key is `id` (provided by caller), so we can't reuse the generic
      // CRUD handler. Optimistic concurrency is not modelled for this table.
      const accepted: HandlerResult["accepted"] = [];
      const conflicts: HandlerResult["conflicts"] = [];
      for (const op of ops) {
        const id = op.id;
        if (op.op === "create") {
          const cursor = await incrementCursorIn(tx, userId);
          await tx.insert(installedPlugin).values({
            ...(op.fields as Record<string, unknown>),
            cursor,
          } as typeof installedPlugin.$inferInsert);
          accepted.push({ id, version: 0 });
        } else if (op.op === "update") {
          const cursor = await incrementCursorIn(tx, userId);
          await tx
            .update(installedPlugin)
            .set({ ...(op.fields as Record<string, unknown>), cursor })
            .where(eq(installedPlugin.id, id));
          accepted.push({ id, version: 0 });
        } else if (op.op === "delete") {
          await tx.delete(installedPlugin).where(eq(installedPlugin.id, id));
          accepted.push({ id, version: 0 });
        }
      }
      return { accepted, conflicts };
    },

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
          const cur = await tx
            .select()
            .from(noteVersion)
            .where(
              and(eq(noteVersion.userId, userId), eq(noteVersion.notePath, f.path)),
            )
            .limit(1)
            .then((rows) => rows[0] ?? null);
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
          const existingIdx = await tx
            .select()
            .from(searchIndex)
            .where(
              and(eq(searchIndex.userId, userId), eq(searchIndex.notePath, f.path)),
            )
            .limit(1)
            .then((rows) => rows[0] ?? null);
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

          await tx
            .insert(searchIndex)
            .values({
              notePath: f.path,
              userId,
              title: f.title ?? f.path,
              content: f.content ?? "",
              tags: JSON.stringify(mergedTags),
              modifiedAt:
                f.modifiedAt !== null && f.modifiedAt !== undefined
                  ? new Date(f.modifiedAt)
                  : new Date(),
            })
            .onConflictDoUpdate({
              target: [searchIndex.notePath, searchIndex.userId],
              set: {
                title: f.title ?? existingIdx?.title ?? f.path,
                tags: JSON.stringify(mergedTags),
                modifiedAt:
                  f.modifiedAt !== null && f.modifiedAt !== undefined
                    ? new Date(f.modifiedAt)
                    : new Date(),
                content: f.content ?? existingIdx?.content ?? "",
              },
            });

          const [nv] = await tx
            .insert(noteVersion)
            .values({ userId, notePath: f.path, version: 1, cursor })
            .onConflictDoUpdate({
              target: [noteVersion.userId, noteVersion.notePath],
              set: {
                version: sql`${noteVersion.version} + 1`,
                cursor,
                updatedAt: new Date(),
              },
            })
            .returning();

          if (f.content !== null && f.content !== undefined) {
            await tx
              .insert(noteRevision)
              .values({ userId, notePath: f.path, content: String(f.content) });
          }

          accepted.push({ id: op.id, version: nv.version, merged_value: { tags: mergedTags } });
        } else if (op.op === "delete") {
          const filePath = pathModule.join(userDir, op.id);
          await fsPromises.unlink(filePath).catch(() => {});
          await tx
            .delete(searchIndex)
            .where(
              and(eq(searchIndex.userId, userId), eq(searchIndex.notePath, op.id)),
            );
          await tx
            .delete(noteVersion)
            .where(
              and(eq(noteVersion.userId, userId), eq(noteVersion.notePath, op.id)),
            );
          accepted.push({ id: op.id, version: 0 });
        }
      }
      return { accepted, conflicts };
    },
  };
}
