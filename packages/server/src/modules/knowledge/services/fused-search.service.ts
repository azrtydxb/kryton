/**
 * Fused search service — NovaMem-style 3-layer Reciprocal Rank Fusion.
 *
 * Combines three signal sources in a single SQL pass:
 *   - Lexical: Postgres FTS `ts_rank` over `SearchIndex.tsv`
 *   - Semantic: pgvector cosine distance over `NoteEmbeddingChunk`, with
 *     the best-scoring chunk per note picked via correlated `ARRAY_AGG`
 *   - Graph: 1-hop neighbours (in either direction) of the union of the
 *     top lexical + semantic hits, drawn from `GraphEdge`
 *
 * RRF formula: score = Σ wᵢ / (k + rankᵢ) with k=60. Weights default to
 * 0.4 / 0.4 / 0.2 (lex / sem / graph) but are per-user adjustable via the
 * `Settings` table (key: "fusion_weights") — see fusion-weights.service.ts.
 *
 * Snippet selection:
 *   - If semantic contributed (sem_rank IS NOT NULL): use the best chunk
 *     text from the semantic layer, trimmed to ~200 chars.
 *   - Else: a lexical prefix of the `content` field.
 *
 * Caller is responsible for the embedder-ready check — this function
 * assumes `app.embedderState.embedder` is available. The route falls
 * back to lexical-only when the embedder isn't ready.
 */

import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";

import { parseTags } from "./search-helpers.js";
import type { SearchResult } from "./search-query.js";
import { getFusionWeights } from "./fusion-weights.service.js";

interface FusedRow {
  note_path: string;
  title: string;
  tags: string;
  modifiedAt: Date | string;
  content: string;
  score: number;
  lex_rank: number | null;
  sem_rank: number | null;
  graph_rank: number | null;
  best_chunk_text: string | null;
}

function snippetFrom(row: FusedRow, query: string): string {
  if (row.sem_rank !== null && row.best_chunk_text) {
    return row.best_chunk_text.slice(0, 200);
  }
  // Lexical fallback: trimmed prefix. We avoid `ts_headline` here to stay
  // consistent with the lexical-only path which also uses a content prefix
  // for snippets — keeps the response shape uniform.
  const c = row.content ?? "";
  void query;
  return c.length > 200 ? c.slice(0, 200) + "..." : c;
}

export async function searchFused(
  app: FastifyInstance,
  query: string,
  userId: string,
  limit = 20,
): Promise<SearchResult[]> {
  const { embedderState, db } = app;
  if (!embedderState?.embedder) {
    // Defensive — route should have already fallen back to lexical when
    // the embedder isn't ready. Returning [] here is safer than throwing
    // because the user-visible contract is "search never 5xx's".
    return [];
  }

  const qv = await embedderState.embedder.embedQuery(query);
  const qvLiteral = `[${Array.from(qv).join(",")}]`;
  const trimmed = query.trim();

  // Per-user fusion weights (already normalised so lex+sem+graph = 1).
  const weights = await getFusionWeights(app, userId);
  const wLex = weights.lex;
  const wSem = weights.sem;
  const wGraph = weights.graph;

  // Single statement, all CTEs. Column-name caveats:
  //   - "SearchIndex": camelCase quoted ("notePath", "userId", "modifiedAt")
  //   - "NoteEmbeddingChunk": snake_case unquoted (user_id, note_path, ...)
  //   - "GraphEdge": camelCase quoted ("userId", "fromPath", "toPath")
  // Inside the CTE pipeline we project everything to `note_path` so the
  // FULL OUTER JOIN USING (note_path) works.
  const result = (await db.execute(sql`
    WITH q AS (
      SELECT websearch_to_tsquery('english', ${trimmed}::text) AS tsq
    ),
    lexical AS (
      SELECT "notePath" AS note_path,
             ts_rank(tsv, (SELECT tsq FROM q)) AS lex_score,
             ROW_NUMBER() OVER (ORDER BY ts_rank(tsv, (SELECT tsq FROM q)) DESC) AS lex_rank
      FROM "SearchIndex"
      WHERE "userId" = ${userId}
        AND tsv @@ (SELECT tsq FROM q)
      ORDER BY lex_score DESC
      LIMIT 50
    ),
    semantic AS (
      SELECT note_path,
             (ARRAY_AGG(chunk_text ORDER BY (embedding <=> ${qvLiteral}::vector) ASC))[1] AS best_chunk_text,
             MAX(1 - (embedding <=> ${qvLiteral}::vector)) AS sem_score
      FROM "NoteEmbeddingChunk"
      WHERE user_id = ${userId}
      GROUP BY note_path
      ORDER BY sem_score DESC
      LIMIT 50
    ),
    semantic_ranked AS (
      SELECT note_path, best_chunk_text, sem_score,
             ROW_NUMBER() OVER (ORDER BY sem_score DESC) AS sem_rank
      FROM semantic
    ),
    candidates AS (
      SELECT note_path FROM lexical
      UNION
      SELECT note_path FROM semantic_ranked
    ),
    graph_neighbors AS (
      SELECT DISTINCT ge."toPath" AS note_path
      FROM "GraphEdge" ge
      JOIN candidates c ON c.note_path = ge."fromPath"
      WHERE ge."userId" = ${userId}
        AND ge."toPath" NOT IN (SELECT note_path FROM candidates)
      UNION
      SELECT DISTINCT ge."fromPath" AS note_path
      FROM "GraphEdge" ge
      JOIN candidates c ON c.note_path = ge."toPath"
      WHERE ge."userId" = ${userId}
        AND ge."fromPath" NOT IN (SELECT note_path FROM candidates)
    ),
    graph_ranked AS (
      SELECT note_path,
             ROW_NUMBER() OVER () AS graph_rank
      FROM graph_neighbors
      LIMIT 50
    ),
    fused AS (
      SELECT
        COALESCE(l.note_path, sr.note_path, gr.note_path) AS note_path,
        l.lex_rank,
        sr.sem_rank,
        sr.best_chunk_text,
        gr.graph_rank,
        (
          COALESCE(${wLex}::float / (60 + l.lex_rank), 0) +
          COALESCE(${wSem}::float / (60 + sr.sem_rank), 0) +
          COALESCE(${wGraph}::float / (60 + gr.graph_rank), 0)
        ) AS score
      FROM lexical l
      FULL OUTER JOIN semantic_ranked sr USING (note_path)
      FULL OUTER JOIN graph_ranked gr USING (note_path)
    )
    SELECT f.note_path,
           si.title,
           si.tags,
           si."modifiedAt" AS "modifiedAt",
           si.content,
           f.score,
           f.lex_rank,
           f.sem_rank,
           f.graph_rank,
           f.best_chunk_text
    FROM fused f
    JOIN "SearchIndex" si
      ON si."userId" = ${userId} AND si."notePath" = f.note_path
    WHERE f.score > 0
    ORDER BY f.score DESC
    LIMIT ${limit}
  `)) as unknown as { rows: FusedRow[] };

  return result.rows.map((r) => ({
    path: r.note_path,
    title: r.title,
    snippet: snippetFrom(r, trimmed),
    tags: parseTags(r.tags ?? ""),
    modifiedAt: r.modifiedAt instanceof Date ? r.modifiedAt : new Date(r.modifiedAt),
    score: Number(r.score),
  }));
}
