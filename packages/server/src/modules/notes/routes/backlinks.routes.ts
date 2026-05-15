import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ValidationError } from "../../../lib/errors.js";
import { decodePathParam, ensureExtension } from "../../../lib/pathUtils.js";

// its decorator. The knowledge-agent's port lives in modules/knowledge/.

const backlinkSchema = z.object({
  path: z.string(),
  title: z.string(),
});

/**
 * Backlinks routes — returns notes that wiki-link TO a given note.
 * Mounted under `/api/backlinks`.
 */
export const backlinksRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // GET /api/backlinks/<note path>
  typed.get(
    "/*",
    {
      preHandler: [async (req) => { await app.auth.requireUser(req); }],
      schema: {
        tags: ["notes"],
        summary: "Get backlinks for a note",
        response: { 200: z.array(backlinkSchema) },
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      const wildcardParam = (req.params as Record<string, string>)["*"];
      const notePath = decodePathParam(wildcardParam);
      if (!notePath) throw new ValidationError("Path is required");

      const fullNotePath = ensureExtension(notePath, ".md");
      return app.knowledge.getBacklinks(fullNotePath, user.id);
    },
  );
};
