import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { eq, sql } from "drizzle-orm";

import {
  fusionWeightsSchema,
  searchQuerySchema,
  searchResponseSchema,
  semanticReadyResponseSchema,
  semanticReindexQuerySchema,
  semanticReindexResponseSchema,
} from "../schemas/search.schemas.js";
import type { SearchService } from "../services/search.service.js";
import { searchFused } from "../services/fused-search.service.js";
import {
  getFusionWeights,
  setFusionWeights,
} from "../services/fusion-weights.service.js";
import { searchIndex } from "../../../db/schema/notes.js";
import { embedJob } from "../../../db/schema/embeddings.js";
import { ForbiddenError } from "../../../lib/errors.js";

export interface SearchRoutesOptions {
  searchService: SearchService;
}

/**
 * Search routes — mounted under `/api/search`.
 *
 * `GET /` is a single fused-search endpoint: it combines lexical + semantic +
 * graph signals NovaMem-style via Reciprocal Rank Fusion. When the embedder
 * isn't ready (provider=off or warming up), the handler falls back to
 * lexical-only with the same response shape. There is no `mode` query
 * parameter — the fusion is the search.
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
        summary: "Search notes (3-layer RRF fusion with lexical fallback)",
        querystring: searchQuerySchema,
        response: { 200: searchResponseSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireUser(req);
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      const { q, limit } = req.query;
      const trimmed = q.trim();

      if (!trimmed) {
        return opts.searchService.search("", user.id);
      }

      const state = app.embedderState;
      if (state?.ready && state.provider !== "off" && state.embedder) {
        return searchFused(app, trimmed, user.id, limit);
      }

      // Lexical-only fallback when the embedder is off or still warming up.
      return opts.searchService.search(trimmed, user.id);
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

  typed.get(
    "/weights",
    {
      schema: {
        tags: ["knowledge"],
        summary: "Get the current user's fusion weights (lex/sem/graph)",
        response: { 200: fusionWeightsSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireUser(req);
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      return getFusionWeights(app, user.id);
    },
  );

  typed.put(
    "/weights",
    {
      schema: {
        tags: ["knowledge"],
        summary: "Update the current user's fusion weights (normalised to sum=1)",
        body: fusionWeightsSchema,
        response: { 200: fusionWeightsSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireUser(req);
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      return setFusionWeights(app, user.id, req.body);
    },
  );
};
