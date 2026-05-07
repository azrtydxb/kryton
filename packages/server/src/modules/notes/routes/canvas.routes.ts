import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { ConflictError, NotFoundError, ValidationError } from "../../../lib/errors.js";





function ensureExtension(filePath: string, ext: string): string {
  return filePath.endsWith(ext) ? filePath : `${filePath}${ext}`;
}

function validatePathWithinBase(fullPath: string, baseDir: string): void {
  const resolvedPath = path.resolve(fullPath);
  const resolvedBase = path.resolve(baseDir);
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    throw new ValidationError("Invalid path: outside allowed directory");
  }
}

async function ensureCanvasDir(canvasDir: string): Promise<void> {
  await fs.mkdir(canvasDir, { recursive: true });
}

const canvasContentSchema = z
  .object({
    nodes: z.array(z.unknown()).optional(),
    edges: z.array(z.unknown()).optional(),
  })
  .passthrough();

const createCanvasBodySchema = z.object({
  name: z.string().min(1).max(200),
  content: canvasContentSchema.optional(),
});

const nameParamSchema = z.object({ name: z.string().min(1) });

/**
 * Canvas routes — list/create/read/update/delete .canvas files in
 * `<userNotesDir>/Canvas/`.
 * Mounted under `/api/canvas`.
 */
export const canvasRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // GET /api/canvas — list canvas files (without extension)
  typed.get(
    "/",
    {
      preHandler: [async (req) => { await app.auth.requireUser(req); }],
      schema: {
        tags: ["notes"],
        summary: "List canvas files",
        response: { 200: z.array(z.string()) },
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      const userDir = await app.notes.getUserNotesDir(user.id);
      const canvasDir = path.join(userDir, "Canvas");
      await ensureCanvasDir(canvasDir);
      const entries = await fs.readdir(canvasDir);
      return entries
        .filter((f) => f.endsWith(".canvas"))
        .map((f) => f.replace(/\.canvas$/, ""));
    },
  );

  // GET /api/canvas/:name — read a canvas file
  typed.get(
    "/:name",
    {
      preHandler: [async (req) => { await app.auth.requireUser(req); }],
      schema: {
        tags: ["notes"],
        summary: "Read a canvas file",
        params: nameParamSchema,
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      const userDir = await app.notes.getUserNotesDir(user.id);
      const canvasDir = path.join(userDir, "Canvas");
      const { name } = req.params as { name: string };

      const fileName = ensureExtension(name, ".canvas");
      const filePath = path.resolve(canvasDir, fileName);
      validatePathWithinBase(filePath, canvasDir);

      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch {
        throw new NotFoundError("Canvas file not found");
      }
      return JSON.parse(content);
    },
  );

  // POST /api/canvas — create a new canvas file
  typed.post(
    "/",
    {
      preHandler: [async (req) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
      }],
      schema: {
        tags: ["notes"],
        summary: "Create a canvas file",
        body: createCanvasBodySchema,
        response: {
          201: z.object({ name: z.string(), message: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const user = await app.auth.requireUser(req);
      const userDir = await app.notes.getUserNotesDir(user.id);
      const canvasDir = path.join(userDir, "Canvas");

      const { name, content } = req.body as z.infer<typeof createCanvasBodySchema>;

      const fileName = ensureExtension(name, ".canvas");
      const filePath = path.resolve(canvasDir, fileName);
      validatePathWithinBase(filePath, canvasDir);

      await ensureCanvasDir(canvasDir);

      try {
        await fs.stat(filePath);
        throw new ConflictError("Canvas file already exists");
      } catch (err) {
        if (err instanceof ConflictError) throw err;
        // ENOENT — proceed
      }

      const data = content ?? { nodes: [], edges: [] };
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
      reply.status(201);
      return { name: fileName, message: "Canvas file created" };
    },
  );

  // PUT /api/canvas/:name — update a canvas file
  typed.put(
    "/:name",
    {
      preHandler: [async (req) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
      }],
      schema: {
        tags: ["notes"],
        summary: "Update a canvas file",
        params: nameParamSchema,
        body: canvasContentSchema,
        response: {
          200: z.object({ name: z.string(), message: z.string() }),
        },
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      const userDir = await app.notes.getUserNotesDir(user.id);
      const canvasDir = path.join(userDir, "Canvas");
      const { name } = req.params as { name: string };

      const body = req.body as Record<string, unknown>;
      if (!body || Object.keys(body).length === 0) {
        throw new ValidationError("Content is required");
      }

      const fileName = ensureExtension(name, ".canvas");
      const filePath = path.resolve(canvasDir, fileName);
      validatePathWithinBase(filePath, canvasDir);

      await ensureCanvasDir(canvasDir);
      await fs.writeFile(filePath, JSON.stringify(body, null, 2), "utf-8");
      return { name: fileName, message: "Canvas file updated" };
    },
  );

  // DELETE /api/canvas/:name — delete a canvas file
  typed.delete(
    "/:name",
    {
      preHandler: [async (req) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
      }],
      schema: {
        tags: ["notes"],
        summary: "Delete a canvas file",
        params: nameParamSchema,
        response: { 200: z.object({ message: z.string() }) },
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      const userDir = await app.notes.getUserNotesDir(user.id);
      const canvasDir = path.join(userDir, "Canvas");
      const { name } = req.params as { name: string };

      const fileName = ensureExtension(name, ".canvas");
      const filePath = path.resolve(canvasDir, fileName);
      validatePathWithinBase(filePath, canvasDir);

      try {
        await fs.unlink(filePath);
      } catch {
        throw new NotFoundError("Canvas file not found");
      }
      return { message: "Canvas file deleted" };
    },
  );
};
