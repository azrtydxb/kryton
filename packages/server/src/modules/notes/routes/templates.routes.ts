import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { ValidationError } from "../../../lib/errors.js";
import {
  templateContentResponseSchema,
  templateNameParamsSchema,
  templatesListResponseSchema,
} from "../schemas/templates.schemas.js";
import { getUserNotesDir } from "../services/user-notes-dir.service.js";

function validatePathWithinBase(fullPath: string, baseDir: string): void {
  const resolvedPath = path.resolve(fullPath);
  const resolvedBase = path.resolve(baseDir);
  if (
    !resolvedPath.startsWith(resolvedBase + path.sep) &&
    resolvedPath !== resolvedBase
  ) {
    throw new ValidationError("Invalid path: outside allowed directory");
  }
}

export interface TemplatesRoutesDeps {
  notesDir: string;
  ensureBackfilled: (userId: string) => Promise<void>;
}

/**
 * Templates routes — mounted at `/api/templates`.
 *
 * URL summary:
 *   GET /api/templates           list templates from the user's Templates dir
 *   GET /api/templates/:name     read a template's content
 */
export function templatesRoutes(deps: TemplatesRoutesDeps): FastifyPluginAsync {
  const { notesDir, ensureBackfilled } = deps;

  return async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get(
      "/",
      {
        schema: {
          tags: ["notes"],
          summary: "List all templates",
          response: { 200: templatesListResponseSchema },
        },
        preHandler: async (req) => {
          const user = await app.auth.requireUser(req);
          await ensureBackfilled(user.id);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const userDir = await getUserNotesDir(notesDir, user.id);
        const templatesDir = path.join(userDir, "Templates");
        await fs.mkdir(templatesDir, { recursive: true });

        const entries = await fs.readdir(templatesDir, { withFileTypes: true });
        return entries
          .filter((e) => e.isFile() && e.name.endsWith(".md"))
          .map((e) => ({
            name: e.name.replace(/\.md$/, ""),
            path: `Templates/${e.name}`,
          }));
      },
    );

    typed.get(
      "/:name",
      {
        schema: {
          tags: ["notes"],
          summary: "Get template content",
          params: templateNameParamsSchema,
          response: { 200: templateContentResponseSchema },
        },
        preHandler: async (req) => {
          const user = await app.auth.requireUser(req);
          await ensureBackfilled(user.id);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const userDir = await getUserNotesDir(notesDir, user.id);
        const templatesDir = path.join(userDir, "Templates");
        const { name } = req.params;
        const filePath = path.join(templatesDir, `${name}.md`);
        validatePathWithinBase(filePath, templatesDir);

        const content = await fs.readFile(filePath, "utf-8");
        return { name, content };
      },
    );
  };
}
