import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, eq } from "drizzle-orm";
import { NotFoundError, ValidationError } from "../../../lib/errors.js";
import { trashItem } from "../../../db/schema/notes.js";
import { syncDeletion } from "../../../db/schema/sync.js";
import {
  trashDeleteResponseSchema,
  trashEmptyResponseSchema,
  trashListResponseSchema,
  trashRestoreResponseSchema,
  trashWildcardParamsSchema,
} from "../schemas/trash.schemas.js";
import {
  getTrashDir,
  removeEmptyDirs,
  scanTrash,
} from "../services/trash.service.js";
import { getUserNotesDir } from "../services/user-notes-dir.service.js";

function decodePathParam(raw: string): string {
  return decodeURIComponent(raw);
}
function ensureExtension(filePath: string, ext: string): string {
  return filePath.endsWith(ext) ? filePath : `${filePath}${ext}`;
}

export interface TrashRoutesDeps {
  notesDir: string;
  ensureBackfilled: (userId: string) => Promise<void>;
}

/**
 * Trash routes — mounted at `/api/trash`.
 *
 * URL summary:
 *   GET    /api/trash                       list trashed notes
 *   POST   /api/trash/restore/:path*        restore a note from trash
 *   DELETE /api/trash/:path*                permanently delete one note
 */
export function trashRoutes(deps: TrashRoutesDeps): FastifyPluginAsync {
  const { notesDir, ensureBackfilled } = deps;

  return async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get(
      "/",
      {
        schema: {
          tags: ["notes"],
          summary: "List all trashed notes",
          response: { 200: trashListResponseSchema },
        },
        preHandler: async (req) => {
          const user = await app.auth.requireUser(req);
          await ensureBackfilled(user.id);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const userDir = await getUserNotesDir(notesDir, user.id);
        const trashDir = getTrashDir(userDir);
        return scanTrash(trashDir);
      },
    );

    typed.post(
      "/restore/*",
      {
        schema: {
          tags: ["notes"],
          summary: "Restore a note from trash",
          params: trashWildcardParamsSchema,
          response: { 200: trashRestoreResponseSchema },
        },
        preHandler: async (req) => {
          const user = await app.auth.requireUser(req);
          await ensureBackfilled(user.id);
        },
      },
      async (req) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
        const userDir = await getUserNotesDir(notesDir, ctx.user.id);
        const trashDir = getTrashDir(userDir);

        const notePath = decodePathParam(req.params["*"]);
        if (!notePath) throw new ValidationError("Path is required");

        const fullNotePath = ensureExtension(notePath, ".md");
        const trashFilePath = path.join(trashDir, fullNotePath);
        const restorePath = path.join(userDir, fullNotePath);

        const resolvedTrash = path.resolve(trashFilePath);
        const resolvedTrashDir = path.resolve(trashDir);
        if (!resolvedTrash.startsWith(resolvedTrashDir + path.sep)) {
          throw new ValidationError("Invalid path");
        }
        const resolvedRestore = path.resolve(restorePath);
        const resolvedUserDir = path.resolve(userDir);
        if (!resolvedRestore.startsWith(resolvedUserDir + path.sep)) {
          throw new ValidationError("Invalid path");
        }

        try {
          await fs.stat(trashFilePath);
        } catch {
          throw new NotFoundError("Note not found in trash");
        }

        await fs.mkdir(path.dirname(restorePath), { recursive: true });
        await fs.rename(trashFilePath, restorePath);
        await removeEmptyDirs(path.dirname(trashFilePath), trashDir);

        const trashRecord = await app.db.query.trashItem.findFirst({
          where: and(
            eq(trashItem.originalPath, fullNotePath),
            eq(trashItem.userId, ctx.user.id),
          ),
        });
        if (trashRecord) {
          await app.db.insert(syncDeletion).values({
            tableName: "trash_items",
            recordId: trashRecord.id,
            userId: ctx.user.id,
          });
          await app.db.delete(trashItem).where(eq(trashItem.id, trashRecord.id));
        }

        return { message: "Note restored", path: fullNotePath };
      },
    );

    typed.delete(
      "/*",
      {
        schema: {
          tags: ["notes"],
          summary: "Permanently delete a note from trash",
          params: trashWildcardParamsSchema,
          response: { 200: trashDeleteResponseSchema },
        },
        preHandler: async (req) => {
          const user = await app.auth.requireUser(req);
          await ensureBackfilled(user.id);
        },
      },
      async (req) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
        const userDir = await getUserNotesDir(notesDir, ctx.user.id);
        const trashDir = getTrashDir(userDir);

        const notePath = decodePathParam(req.params["*"]);
        if (!notePath) throw new ValidationError("Path is required");

        const fullNotePath = ensureExtension(notePath, ".md");
        const trashFilePath = path.join(trashDir, fullNotePath);

        const resolvedTrash = path.resolve(trashFilePath);
        const resolvedTrashDir = path.resolve(trashDir);
        if (!resolvedTrash.startsWith(resolvedTrashDir + path.sep)) {
          throw new ValidationError("Invalid path");
        }

        try {
          await fs.unlink(trashFilePath);
        } catch {
          throw new NotFoundError("Note not found in trash");
        }
        await removeEmptyDirs(path.dirname(trashFilePath), trashDir);

        const trashRecord = await app.db.query.trashItem.findFirst({
          where: and(
            eq(trashItem.originalPath, fullNotePath),
            eq(trashItem.userId, ctx.user.id),
          ),
        });
        if (trashRecord) {
          await app.db.insert(syncDeletion).values({
            tableName: "trash_items",
            recordId: trashRecord.id,
            userId: ctx.user.id,
          });
          await app.db.delete(trashItem).where(eq(trashItem.id, trashRecord.id));
        }
        await app.db.insert(syncDeletion).values({
          tableName: "notes",
          recordId: fullNotePath,
          userId: ctx.user.id,
        });

        return { message: "Note permanently deleted" };
      },
    );
  };
}

/**
 * Trash-empty routes — mounted at `/api/trash-empty`, separate from the main
 * trash router so the wildcard DELETE route doesn't shadow it.
 *
 * URL summary:
 *   DELETE /api/trash-empty    empty entire trash
 */
export function trashEmptyRoutes(deps: TrashRoutesDeps): FastifyPluginAsync {
  const { notesDir, ensureBackfilled } = deps;

  return async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.delete(
      "/",
      {
        schema: {
          tags: ["notes"],
          summary: "Empty the entire trash",
          response: { 200: trashEmptyResponseSchema },
        },
        preHandler: async (req) => {
          const user = await app.auth.requireUser(req);
          await ensureBackfilled(user.id);
        },
      },
      async (req) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
        const userDir = await getUserNotesDir(notesDir, ctx.user.id);
        const trashDir = getTrashDir(userDir);

        const trashItemRecords = await app.db.query.trashItem.findMany({
          where: eq(trashItem.userId, ctx.user.id),
        });

        try {
          await fs.rm(trashDir, { recursive: true, force: true });
        } catch {
          // Best-effort
        }

        if (trashItemRecords.length > 0) {
          await app.db.insert(syncDeletion).values([
            ...trashItemRecords.map((item) => ({
              tableName: "trash_items",
              recordId: item.id,
              userId: ctx.user.id,
            })),
            ...trashItemRecords.map((item) => ({
              tableName: "notes",
              recordId: item.originalPath,
              userId: ctx.user.id,
            })),
          ]);
          await app.db.delete(trashItem).where(eq(trashItem.userId, ctx.user.id));
        }

        return { message: "Trash emptied" };
      },
    );
  };
}
