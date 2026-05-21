import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ensureExtension, validatePathWithinBase } from "../../../lib/pathUtils.js";
import { getUserNotesDir } from "../../notes/services/user-notes-dir.service.js";
import { ValidationError } from "../../../lib/errors.js";
import type { NotesOps } from "../services/types.js";
import type { PluginEventBus } from "../services/event-bus.js";
import { noteEntryListSchema } from "../schemas/index.js";

export interface BuiltinNotesRoutesDeps {
  notesDir: string;
  notesOps: NotesOps;
  eventBus: PluginEventBus;
}

const listQuerySchema = z.object({ folder: z.string().optional() });
const pathQuerySchema = z.object({ path: z.string().min(1) });
const writeBodySchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});
const openBodySchema = z.object({ path: z.string().min(1) });
const replaceBodySchema = z.object({
  path: z.string().min(1),
  range: z.object({
    startLine: z.number().int().min(0),
    endLine: z.number().int().min(0),
  }),
  newSource: z.string(),
});

const okResponse = z.object({ ok: z.literal(true) });

const noteResponse = z.object({
  path: z.string(),
  content: z.string(),
  title: z.string(),
  modifiedAt: z.date().or(z.string()),
});

/**
 * Built-in notes API surfaced to client plugins under
 * /api/plugin-builtin/notes/*. Mirrors the server-side `api.notes` namespace
 * but scoped to the calling user's session (no `userId` argument in the URL).
 */
export const builtinNotesRoutes = (
  deps: BuiltinNotesRoutesDeps,
): FastifyPluginAsync =>
  async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();
    const { notesDir, notesOps, eventBus } = deps;

    typed.get(
      "/list",
      {
        schema: {
          tags: ["plugin-builtin"],
          summary: "List notes for the current user (optionally under a folder)",
          querystring: listQuerySchema,
          response: { 200: noteEntryListSchema },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const userDir = await getUserNotesDir(notesDir, user.id);
        const folder = req.query.folder;
        const dir = folder ? path.join(userDir, folder) : userDir;
        validatePathWithinBase(dir, userDir);
        const tree = await notesOps.scanDirectory(dir, folder ?? "");
        function toEntries(
          nodes: Array<{ name: string; path: string; type: string; children?: unknown[] }>,
        ): Array<{ name: string; path: string; type: "file" | "directory"; children?: unknown[] }> {
          return nodes.map((n) => ({
            name: n.name,
            path: n.path,
            type: n.type === "folder" ? "directory" : "file",
            ...(n.children
              ? { children: toEntries(n.children as typeof nodes) }
              : {}),
          }));
        }
        return toEntries(tree);
      },
    );

    typed.get(
      "/get",
      {
        schema: {
          tags: ["plugin-builtin"],
          summary: "Read a single note",
          querystring: pathQuerySchema,
          response: { 200: noteResponse },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const userDir = await getUserNotesDir(notesDir, user.id);
        const notePath = ensureExtension(req.query.path, ".md");
        const note = await notesOps.readNote(userDir, notePath);
        return {
          path: req.query.path,
          content: note.content,
          title: note.title,
          modifiedAt: note.modifiedAt,
        };
      },
    );

    typed.post(
      "/create",
      {
        schema: {
          tags: ["plugin-builtin"],
          summary: "Create a note",
          body: writeBodySchema,
          response: { 200: okResponse },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const userDir = await getUserNotesDir(notesDir, user.id);
        const notePath = ensureExtension(req.body.path, ".md");
        await notesOps.writeNote(userDir, notePath, req.body.content, user.id);
        return { ok: true as const };
      },
    );

    typed.post(
      "/update",
      {
        schema: {
          tags: ["plugin-builtin"],
          summary: "Overwrite a note",
          body: writeBodySchema,
          response: { 200: okResponse },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const userDir = await getUserNotesDir(notesDir, user.id);
        const notePath = ensureExtension(req.body.path, ".md");
        await notesOps.writeNote(userDir, notePath, req.body.content, user.id);
        return { ok: true as const };
      },
    );

    typed.delete(
      "/delete",
      {
        schema: {
          tags: ["plugin-builtin"],
          summary: "Delete a note",
          querystring: pathQuerySchema,
          response: { 200: okResponse },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const userDir = await getUserNotesDir(notesDir, user.id);
        const notePath = ensureExtension(req.query.path, ".md");
        await notesOps.deleteNote(userDir, notePath, user.id);
        return { ok: true as const };
      },
    );

    typed.post(
      "/openByPath",
      {
        schema: {
          tags: ["plugin-builtin"],
          summary: "Request that the client UI open a note (emits note:open)",
          body: openBodySchema,
          response: { 200: okResponse },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        // Server-side this is a no-op + event emission. The client UI
        // listens for `note:open` over the plugin event bus / websocket
        // and switches the active tab.
        await eventBus.emit("note:open", {
          userId: user.id,
          path: req.body.path,
        });
        return { ok: true as const };
      },
    );

    typed.post(
      "/replaceFenceAtRange",
      {
        schema: {
          tags: ["plugin-builtin"],
          summary: "Splice a line range in a note with new source",
          body: replaceBodySchema,
          response: { 200: okResponse },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const userDir = await getUserNotesDir(notesDir, user.id);
        const notePath = ensureExtension(req.body.path, ".md");
        const { range, newSource } = req.body;
        if (range.endLine < range.startLine) {
          throw new ValidationError("range.endLine must be >= range.startLine");
        }
        const note = await notesOps.readNote(userDir, notePath);
        const lines = note.content.split("\n");
        if (range.startLine > lines.length) {
          throw new ValidationError("range.startLine out of bounds");
        }
        const before = lines.slice(0, range.startLine);
        const after = lines.slice(range.endLine + 1);
        const next = [...before, ...newSource.split("\n"), ...after].join("\n");
        await notesOps.writeNote(userDir, notePath, next, user.id);
        return { ok: true as const };
      },
    );
  };
