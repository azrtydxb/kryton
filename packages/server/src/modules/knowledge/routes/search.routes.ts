import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  searchQuerySchema,
  searchResponseSchema,
  semanticReadyResponseSchema,
  semanticReindexQuerySchema,
  semanticReindexResponseSchema,
} from "../schemas/search.schemas.js";

const notImplementedResponseSchema = z.object({ message: z.string() });
import type { SearchService } from "../services/search.service.js";
import { semanticSearch } from "../services/semantic-search.service.js";
import { searchIndex } from "../../../db/schema/notes.js";
import { embedJob } from "../../../db/schema/embeddings.js";
import { ForbiddenError } from "../../../lib/errors.js";

export interface SearchRoutesOptions {
  searchService: SearchService;
}

/**
 * Search routes — mounted under `/api/search`. The search service is passed in
 * so the handlers don't depend on the (optional, parallel-migration) decorator
 * shape of `app.knowledge`.
 *
 * Phase 5: `mode=semantic` dispatches to pgvector KNN, `mode=hybrid` returns
 * 501 (Phase C), default `mode=lexical` preserves the previous FTS behavior.
 */
export const searchRoutes: FastifyPluginAsync<SearchRoutesOptions> = async (
  app,
  opts,
) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/",
    {
      schema: {
        tags: ["knowledge"],
        summary: "Search notes (lexical | semantic | hybrid)",
        querystring: searchQuerySchema,
        response: {
          200: searchResponseSchema,
          501: notImplementedResponseSchema,
        },
      },
      preHandler: async (req) => {
        await app.auth.requireUser(req);
      },
    },
    async (req, reply) => {
      const user = await app.auth.requireUser(req);
      const { q, mode, limit } = req.query;

      if (mode === "hybrid") {
        return reply
          .code(501)
          .send({ message: "Hybrid search is Phase C" });
      }

      if (mode === "semantic") {
        return semanticSearch(app, q.trim(), user.id, limit);
      }

      return opts.searchService.search(q.trim(), user.id);
    },
  );

  typed.get(
    "/semantic/ready",
    {
      schema: {
        tags: ["knowledge"],
        summary: "Semantic search readiness + pending-job count",
        response: { 200: semanticReadyResponseSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireUser(req);
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      const state = app.embedderState;
      const pendingJobs = state?.worker
        ? await state.worker.pendingCount(user.id)
        : 0;
      return {
        ready: state?.ready ?? false,
        provider: state?.provider ?? "off",
        model: state?.model,
        dimensions: state?.dimensions ?? 0,
        pendingJobs,
      };
    },
  );

  typed.post(
    "/semantic/reindex",
    {
      schema: {
        tags: ["knowledge"],
        summary: "Re-enqueue semantic embedding jobs for the calling user",
        querystring: semanticReindexQuerySchema,
        response: { 200: semanticReindexResponseSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireUser(req);
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      const { scope } = req.query;

      if (scope === "all" && user.role !== "admin") {
        throw new ForbiddenError("Admin access required for scope=all");
      }

      const rows =
        scope === "all"
          ? await app.db
              .select({
                userId: searchIndex.userId,
                notePath: searchIndex.notePath,
              })
              .from(searchIndex)
          : await app.db
              .select({
                userId: searchIndex.userId,
                notePath: searchIndex.notePath,
              })
              .from(searchIndex)
              .where(eq(searchIndex.userId, user.id));

      if (rows.length === 0) return { enqueued: 0 };

      await app.db
        .insert(embedJob)
        .values(
          rows.map((r) => ({
            userId: r.userId,
            notePath: r.notePath,
            op: "upsert" as const,
            attempts: 0,
          })),
        )
        .onConflictDoUpdate({
          target: [embedJob.userId, embedJob.notePath],
          set: {
            op: "upsert",
            enqueuedAt: sql`NOW()`,
            attempts: 0,
            error: null,
          },
        });

      return { enqueued: rows.length };
    },
  );
};

