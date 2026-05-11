/**
 * Semantic search service — Phase 5 of Semantic Search Phase A.
 *
 * Embeds the user's query via the live embedder (decorated on
 * `app.embedderState.embedder` by `plugins/embedder.ts`), then runs a
 * pgvector cosine-distance KNN against `NoteEmbeddingChunk` joined back to
 * `SearchIndex` for the human-readable title/tags/modifiedAt fields.
 *
 * The route over-fetches `limit * 4` chunks and dedups by `notePath`,
 * keeping the highest-scoring chunk per note. That way the UI can render
 * one row per note even when several chunks of the same note are nearest
 * neighbours.
 *
 * When the embedder isn't warm yet — provider=off, ready=false, or the
 * embedder wasn't constructed for any reason — the function throws
 * `ServiceUnavailableError` (HTTP 503). The route surfaces this directly
 * so the UI can fall back to lexical search without ambiguity.
 */

import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";

import { ServiceUnavailableError } from "../../../lib/errors.js";
import { parseTags } from "./search-helpers.js";
import type { SearchResult } from "./search-query.js";

interface SemanticRow {
  note_path: string;
  chunk_index: number;
  chunk_text: string;
  title: string;
  tags: string;
  modifiedAt: Date | string;
  score: number;
}

export async function semanticSearch(
  app: FastifyInstance,
  query: string,
  userId: string,
  limit = 20,
): Promise<SearchResult[]> {
  const { embedderState, db } = app;
  if (
    !embedderState ||
    embedderState.provider === "off" ||
    !embedderState.ready ||
    !embedderState.embedder
  ) {
    throw new ServiceUnavailableError("Semantic search not ready", {
      provider: embedderState?.provider ?? "off",
      ready: embedderState?.ready ?? false,
    });
  }

  const qv = await embedderState.embedder.embedQuery(query);
  const qvLiteral = `[${Array.from(qv).join(",")}]`;
  const overFetch = limit * 4;

  const result = (await db.execute(sql`
    SELECT ec.note_path,
           ec.chunk_index,
           ec.chunk_text,
           si.title,
           si.tags,
           si."modifiedAt" AS "modifiedAt",
           1 - (ec.embedding <=> ${qvLiteral}::vector) AS score
    FROM "NoteEmbeddingChunk" ec
    JOIN "SearchIndex" si
      ON si."userId" = ec.user_id AND si."notePath" = ec.note_path
    WHERE ec.user_id = ${userId}
    ORDER BY ec.embedding <=> ${qvLiteral}::vector
    LIMIT ${overFetch}
  `)) as unknown as { rows: SemanticRow[] };

  // Dedup by notePath, keep highest-scoring chunk. Insertion order is the
  // SQL order (which is already ascending cosine distance ≡ descending
  // similarity), so the first occurrence of each notePath is naturally the
  // best. We still compare scores defensively in case a future revision
  // changes the ordering.
  const seen = new Map<string, SearchResult>();
  for (const r of result.rows) {
    const existing = seen.get(r.note_path);
    const score = Number(r.score);
    if (existing && (existing.score ?? 0) >= score) continue;
    seen.set(r.note_path, {
      path: r.note_path,
      title: r.title,
      snippet: r.chunk_text.slice(0, 200),
      tags: parseTags(r.tags ?? ""),
      modifiedAt: r.modifiedAt instanceof Date ? r.modifiedAt : new Date(r.modifiedAt),
      score,
      chunkIndex: r.chunk_index,
    });
  }
  return [...seen.values()].slice(0, limit);
}
