# Semantic Search Design

**Date**: 2026-05-11
**Status**: **Decisions resolved — ready for plan.**
**Prerequisite**: ✅ [Postgres + Drizzle Migration](2026-05-11-postgres-drizzle-migration-design.md) shipped (PR #109).

> ## Spec status
>
> Postgres + Drizzle + pgvector are live on master (PR #109 + #110 + audit fixes). MiniSearch is gone; lexical search runs through Postgres `tsvector` already. This spec has been refreshed against the real codebase: Drizzle v0.45.2 `vector` helper, real schema-file layout, real Fastify plugin patterns, real `SearchService.indexNote()` integration point.
>
> Q1–Q6 decisions stand. Three additional implementation decisions locked in (see "Implementation Decisions" below): API namespace, async-with-durable-queue write path, readiness payload shape.

## Problem

Kryton's current search is purely lexical: MiniSearch for own notes (fuzzy + prefix + BM25-style scoring), Prisma `contains` for shared notes. This finds documents that share *tokens* with the query, but misses documents that share *meaning*. A search for "how do I deploy a container" doesn't find a note titled "kubernetes rollout strategy."

Adding semantic search closes this gap. The design must:

1. Run **self-hosted by default** — no API key, no third-party data leakage. Kryton's identity is "your notes, on your hardware."
2. **Reuse the existing SQLite database** — no new infrastructure for self-hosters to operate.
3. Be **pluggable** so later iterations can swap in a remote embedder (Ollama, OpenAI) or a richer semantic backend (NovaMem) without touching consumers.
4. Stay **single-binary friendly** — the dev/prod story stays `pnpm dev` and `docker compose up`, no extra services.
5. Compose with existing lexical search rather than replace it — hybrid ranking should be the long-term goal.

## Design

### Provider Abstraction

A single interface hides both the embedder and the vector store. Consumers (routes, indexing pipeline, UI) never know which backend is running.

```ts
export interface SemanticProvider {
  /** Insert or update embeddings for one note (handles chunking internally). */
  upsert(input: { userId: string; notePath: string; title: string; content: string }): Promise<void>;

  /** Remove all embeddings for a note (called on delete or rename-source). */
  delete(input: { userId: string; notePath: string }): Promise<void>;

  /** Semantic KNN search. Returns up to `limit` hits ranked by similarity. */
  search(input: { userId: string; query: string; limit: number }): Promise<SemanticHit[]>;

  /** Health/readiness — used by the API to advertise capability. */
  ready(): Promise<{ provider: string; dimensions: number; model?: string }>;
}

export interface SemanticHit {
  notePath: string;
  chunkIndex: number;
  score: number;          // cosine similarity, 0..1
  snippet: string;        // the matched chunk text, trimmed
}
```

**Providers:**

| ID            | Embedder                                | Store                       | Notes                                              |
|---------------|-----------------------------------------|-----------------------------|----------------------------------------------------|
| `pgvector-local` | `@xenova/transformers` MiniLM-L6 (384d) | `pgvector` extension on the same Postgres | **Default.** Zero external deps, fully local CPU. Always bundled (Q1: A). |
| `novamem`     | (delegated to NovaMem)                  | (delegated)                 | **Phase B, opt-in only.** Chosen at install time, never auto-detected, never default (Q6). Inherits hybrid keyword+vector+graph + decay. |

No third-party / OpenAI-compatible provider. Kryton stays self-hosted-first; if a user wants to embed via Ollama or OpenAI they can run NovaMem in the middle (NovaMem already has that escape hatch).

### Phase A — pgvector + Transformers.js (default backend)

#### Embedder

Mirrors NovaMem's `local-transformers` provider exactly:

- Library: `@xenova/transformers` v2 (already a peer dep pattern NovaMem uses).
- Model: `Xenova/all-MiniLM-L6-v2` (384-dim, sentence-transformers MiniLM).
- Task: `feature-extraction` pipeline, mean-pooled, L2-normalised.
- Lazy dynamic import so the heavy dep only loads when semantic search is enabled.
- First-run model download (~23 MB ONNX) goes to a cache dir; later runs are offline.

#### Vector store

A single Drizzle-managed table on the same Postgres instance Kryton already runs on. The `pgvector` extension is installed once at first boot (via the Postgres init script declared in the migration spec); no per-request extension loading is needed.

```ts
// packages/server/src/db/schema/embeddings.ts (Drizzle v0.45.2)
import { sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp, primaryKey, index, vector } from "drizzle-orm/pg-core";
import { user } from "./auth.js";

export const noteEmbeddingChunk = pgTable(
  "NoteEmbeddingChunk",
  {
    userId:     text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    notePath:   text("note_path").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    chunkText:  text("chunk_text").notNull(),
    embedding:  vector("embedding", { dimensions: 384 }).notNull(),
    modifiedAt: timestamp("modified_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk:       primaryKey({ columns: [t.userId, t.notePath, t.chunkIndex] }),
    hnswIdx:  index("note_embedding_hnsw_idx")
                .using("hnsw", t.embedding.op("vector_cosine_ops")),
    userPath: index("note_embedding_user_path_idx").on(t.userId, t.notePath),
  }),
);

// Durable queue for async embedding work. The notes-watcher writes a row
// when a file changes, the embed worker drains it. Survives crashes /
// docker restarts.
export const embedJob = pgTable(
  "EmbedJob",
  {
    userId:     text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    notePath:   text("note_path").notNull(),
    op:         text("op").notNull(), // "upsert" | "delete"
    enqueuedAt: timestamp("enqueued_at", { withTimezone: true }).notNull().defaultNow(),
    attempts:   integer("attempts").notNull().default(0),
    error:      text("error"),
  },
  (t) => ({
    pk:    primaryKey({ columns: [t.userId, t.notePath] }),
    queue: index("embed_job_queue_idx").on(t.enqueuedAt),
  }),
);
```

The embed-job table is keyed on `(userId, notePath)` so repeat writes to the same note coalesce into one queued row — the watcher just runs `INSERT ... ON CONFLICT DO UPDATE SET op = excluded.op, enqueuedAt = NOW(), attempts = 0`. The worker pops the oldest row, embeds it, deletes the job (or bumps `attempts` + sets `error` on failure).

Both tables get registered in `db/schema/index.ts` alongside the existing seven schema files.

Vector and metadata in **one row** — no rowid hashing, no two-table join inside KNN, no extension-load dance. The HNSW index gives sub-50ms KNN at hundreds of thousands of vectors with pre-filtering on `userId` baked into the query plan.

Search query (Drizzle):

```ts
const hits = await db.select({
    notePath:   noteEmbeddingChunk.notePath,
    chunkIndex: noteEmbeddingChunk.chunkIndex,
    chunkText:  noteEmbeddingChunk.chunkText,
    score:      sql<number>`1 - (${noteEmbeddingChunk.embedding} <=> ${queryVec})`,
  })
  .from(noteEmbeddingChunk)
  .where(eq(noteEmbeddingChunk.userId, userId))
  .orderBy(sql`${noteEmbeddingChunk.embedding} <=> ${queryVec}`)
  .limit(limit);
```

Postgres applies the `WHERE user_id = $1` filter inside the HNSW search via the `hnsw.iterative_scan` setting, so we get true per-tenant KNN with no candidate over-fetching. This is the Q3 win that pgvector unlocks.

#### Chunking strategy

A single embedding per note loses too much resolution for long-form notes. Chunking:

- **Unit:** paragraphs, recombined into ~256-token windows with ~32-token overlap.
- **Frontmatter:** YAML frontmatter is parsed, the title + tags get concatenated into chunk 0 along with the first paragraph. Tag-only notes still get one chunk.
- **Code fences:** preserved whole (don't split mid-block). A code fence longer than the window becomes its own chunk.
- **Embedding window:** chunks are prefixed with the note title before embedding, so the title's semantic signal propagates to every chunk. This is a cheap quality boost.

Concrete defaults (tunable in config):

```ts
const CHUNK_TOKENS = 256;
const CHUNK_OVERLAP = 32;
const MAX_CHUNKS_PER_NOTE = 64;  // safety bound for pathological notes
```

#### Indexing pipeline — slots into the existing watcher

The real codebase has no MiniSearch reconcile module any more (deleted in Phase 6 of #109). Instead:

- `SearchService.indexNote(notePath, content, userId)` writes the `SearchIndex` row, including the `tsv` generated column (lexical FTS).
- `SearchService.removeFromIndex(notePath, userId)` deletes the row.
- `SearchService.renameInIndex(oldPath, newPath, userId)` re-keys the row.
- These three methods are called by `notes-watcher.ts` (chokidar) and by `services/backfill/search-index-backfill.ts` (cold-start reconcile on first authed request).

The embedder follows the **same** call sites — every place that calls `SearchService.indexNote/removeFromIndex/renameInIndex` also enqueues an embed job. Concretely:

1. **Write / Rename / Delete** — at each `SearchService` mutation point, also `INSERT INTO "EmbedJob" ... ON CONFLICT (userId, notePath) DO UPDATE SET op = excluded.op, enqueuedAt = NOW(), attempts = 0`. Coalesces repeat writes.
2. **Watcher reconcile** — chokidar's `add`/`change`/`unlink` events flow through the same `SearchService` mutation methods → same job enqueue. No separate code path.
3. **Backfill** — `search-index-backfill.ts` (the file added by PR #111) already walks the user dir on first authed request and calls `indexNote` for any file not yet indexed. Adding embed enqueues here is one line per call site.

**Worker loop:**

A single in-process loop (Fastify plugin `plugins/embedder.ts`) drains `EmbedJob`:

- Pop the row with the oldest `enqueuedAt`, take a row-level advisory lock (`pg_try_advisory_xact_lock(hashtext(userId || notePath))`) so multi-process safe.
- For `upsert`: read the file from disk → chunk → embed each chunk → `INSERT INTO "NoteEmbeddingChunk" ... ON CONFLICT (userId, notePath, chunkIndex) DO UPDATE`.
- For `delete`: `DELETE FROM "NoteEmbeddingChunk" WHERE user_id = $1 AND note_path = $2`.
- On success: `DELETE FROM "EmbedJob" WHERE (userId, notePath) = ($1, $2)`.
- On failure: `UPDATE "EmbedJob" SET attempts = attempts + 1, error = $err`. After `attempts >= 3`, leave the row but stop retrying (admin can re-enqueue by writing the note again).

Concurrency: 1 worker per server process by default. The advisory lock means horizontal scale-out is safe; the default-1 ceiling is a CPU-bound-embedding consideration, not a correctness one.

**Boot drain:** on `app.ready`, the embedder plugin warms the model in the background (see "Boot behavior" below). Once the model is hot, the worker starts polling. The `EmbedJob` table is drained gradually; a pending row count is exposed via the readiness endpoint so the UI can show progress.

#### API surface

Kryton's lexical search lives at `GET /api/search/?q=...`. Rather than spawning a new namespace, semantic and (later) hybrid become **modes on the same route**:

```
GET /api/search/?q=...&mode=lexical          (default — current behavior)
GET /api/search/?q=...&mode=semantic         (Phase A)
GET /api/search/?q=...&mode=hybrid           (Phase C)
  resp  { hits: Array<{ path, title, snippet, score, mode, chunkIndex? }> }

GET /api/search/semantic/ready
  resp  {
    ready:        boolean,
    provider:     "pgvector-local" | "novamem" | "off",
    model?:       string,
    dimensions:   number,
    pendingJobs:  number,   // EmbedJob rows queued for the calling user
  }

POST /api/search/semantic/reindex            (per-user; admin can scope: "all")
  body  { scope?: "self" | "all" }
  resp  { enqueued: number }
```

If `mode=semantic` is requested while `provider === "off"` (env-disabled) or `ready === false`, the route returns 503 with the readiness payload — UI falls back to a lexical retry. Reindex enqueues `op: "upsert"` rows for every `SearchIndex` row owned by the calling user; the worker drains them.

#### Boot behavior — pre-warm, not block (Q2: B)

The embedder Fastify plugin (`packages/server/src/plugins/embedder.ts`) wires:

1. **Boot:** Fastify accepts traffic immediately (lexical search works from second 0).
2. **Background warm-up:** dynamic-import `@xenova/transformers` → load `Xenova/all-MiniLM-L6-v2` ONNX → embed a single warm-up sentence to populate the runtime caches. ~5–15 s on a cold CPU. While loading, `embedderState.ready === false`.
3. **Readiness endpoint:** `GET /api/search/semantic/ready` returns `{ ready, provider, model, dimensions, pendingJobs }`. Semantic-mode search returns 503 with the same payload until `ready === true`.
4. **Worker start:** once ready, the worker loop polls the `EmbedJob` table on a 200 ms interval (poll-and-sleep — postgres `LISTEN/NOTIFY` is a future optimisation).
5. **UI behavior:** polls `semantic-ready` once on app load + when the user toggles to semantic; shows a "warming up…" pill until ready, then a small `N notes indexing` pill while `pendingJobs > 0`.

The embedder plugin is the **sole** consumer of `@xenova/transformers` — kept behind a dynamic import so the heavy dep only loads when `SEMANTIC_PROVIDER !== "off"`.

#### UI integration

The existing `SearchBar` gains a mode toggle: `lexical | semantic`. Default stays `lexical` for parity.

- Pre-warm state: while `semantic-ready.ready === false` and the user has toggled to semantic, show a small "warming up…" pill instead of results.
- Hits show the chunk snippet with `… score 0.82` in the meta line, mono font, fg-3 — same vibe as existing search hits.
- **Dedup by notePath (Q4: A):** a single note returns at most one row in the results — the highest-scoring chunk. Other matching chunks within that note are silently dropped from the top-N. (If a "show all chunks" affordance is wanted later it can be added without schema change — `chunkIndex` is already returned.)

Hybrid mode is explicitly deferred to Phase C.

### Phase B — NovaMem provider (opt-in at install time)

Once Phase A is stable, add `SemanticProvider` implementation `novamem` that:

- Treats each Kryton tenant as a NovaMem project (`project-create` once, then `project-activate`).
- On `upsert`: calls `memory_remember` per chunk with `sourceType: "note"`, `sourceId: notePath`.
- On `delete`: calls `memory_forget` filtered by `sourceId`.
- On `search`: calls `memory_search` (hybrid by default) and maps results back to `SemanticHit`.
- Inherits NovaMem's hybrid (keyword + vector + graph), worthiness gate, time-windowed recall, and decay for free.
- Kryton's `GraphEdge` records are mirrored into NovaMem's graph layer as a one-time backfill, so wikilink edges show up in `memory_neighbors`.

**Selection rules (Q6):**

- Provider chosen during install: `SEMANTIC_PROVIDER=pgvector-local` (default), `SEMANTIC_PROVIDER=novamem`, or `SEMANTIC_PROVIDER=off`.
- Never auto-detected, never the default. A self-hoster who hasn't already deployed NovaMem doesn't get prompted to install it.
- The web UI does **not** expose runtime provider switching — changing providers requires a re-index, which is an install/migration operation, not a per-session toggle.

**Postgres co-tenancy (separate decision):** Kryton is already on Postgres + Drizzle + pgvector (PR #109). Sharing a Postgres cluster with NovaMem is now a config decision rather than a migration — both speak the same dialect. Identity sharing via better-auth (Kryton's `userId` = NovaMem's `userId`) is still a separate piece of work and gets its own design doc when Phase B is on the table.

### Phase C — Hybrid search across all layers (matches NovaMem's model)

With Postgres as the substrate, hybrid fusion happens in **one SQL statement** instead of three orchestrated parallel calls. The `tsvector` column (defined in the migration spec) sits next to the `embedding` column, so the join is local.

```sql
WITH semantic AS (
  SELECT note_path, chunk_index, chunk_text,
         1 - (embedding <=> $query_vec) AS sem_score,
         row_number() OVER (ORDER BY embedding <=> $query_vec) AS sem_rank
  FROM "NoteEmbeddingChunk"
  WHERE user_id = $user_id
  ORDER BY embedding <=> $query_vec
  LIMIT 100
),
lexical AS (
  SELECT note_path,
         ts_rank(tsv, query) AS lex_score,
         row_number() OVER (ORDER BY ts_rank(tsv, query) DESC) AS lex_rank
  FROM "SearchIndex", websearch_to_tsquery('english', $query) query
  WHERE user_id = $user_id AND tsv @@ query
  LIMIT 100
)
-- graph CTE: hops from any note in the lexical+semantic candidate set, via GraphEdge
...
SELECT note_path,
       $w_l / (60 + COALESCE(lex_rank, 100)) +
       $w_s / (60 + COALESCE(sem_rank, 100)) +
       $w_g / (60 + COALESCE(graph_rank, 100)) AS score
FROM unified
ORDER BY score DESC
LIMIT $limit;
```



Phase C fuses **three** signal sources, not two, mirroring how NovaMem's `memory_search` ranks (Q5/hybrid intent):

1. **Lexical** — Postgres `tsvector` rank from `SearchIndex.tsv` (already in place — see `search-query.ts`).
2. **Semantic** — cosine similarity from `NoteEmbeddingChunk.embedding` via pgvector's `<=>` operator.
3. **Graph** — proximity in the wikilink graph (`GraphEdge`). A note that's 1 hop from a strongly-matching note gets a small boost; 2 hops, smaller. Beyond 3 hops, no signal.

Fusion via weighted reciprocal rank fusion:

```
score = w_l / (k + rank_lexical)
      + w_s / (k + rank_semantic)
      + w_g / (k + rank_graph)
```

Defaults: `w_l = 0.4`, `w_s = 0.4`, `w_g = 0.2`, `k = 60` (standard RRF). Per-user override stored in `Settings`.

Surface: `GET /api/search/?q=...&mode=hybrid`. UI mode toggle becomes `lexical | semantic | hybrid`, and `hybrid` becomes the new default once Phase C lands.

When the NovaMem provider is active in Phase B, hybrid mode short-circuits — NovaMem already does all three fusions natively, so we just proxy `memory_search` and skip Kryton's local fusion math.

### Multi-platform: server-only, online-only

**Hard rule across all platforms:** clients (web, mobile, desktop) never run an embedder, never store vectors locally. Only the server embeds notes, only the server embeds queries, only the server stores vectors. All clients are online-only consumers of the semantic-search API — consistent with the post-sync-removal architecture (see `2026-05-11-remove-sqlite-and-offline-sync-design.md`).

| Scenario       | Lexical search                   | Semantic search                                                 |
|----------------|----------------------------------|-----------------------------------------------------------------|
| **Online**     | `GET /api/search/?q=...`         | `GET /api/search/?q=...&mode=semantic` (server embeds query + runs KNN) |
| **Offline**    | Returns connection error          | Returns connection error                                       |

There is no offline mode for either search type — the entire app requires a connection (online-only architecture).

#### Per-platform notes

- **Web client:** consumes the API directly.
- **Mobile (React Native, planned):** consumes the API directly.
- **Desktop (Tauri, planned):** bundles the server in the same binary. The embedder runs in the server process inside the desktop app — clients still don't embed.

## Schema Changes Summary

Two new Drizzle tables (full schema in `packages/server/src/db/schema/embeddings.ts`):

```ts
noteEmbeddingChunk    // (userId, notePath, chunkIndex) → chunkText + embedding(vector(384))
                      // HNSW index on embedding with vector_cosine_ops
                      // B-tree index on (userId, notePath) for cascade-delete lookups

embedJob              // durable queue: (userId, notePath, op) UNIQUE
                      // op ∈ {"upsert", "delete"}
                      // enqueuedAt timestamptz default now()
```

Plus the `pgvector` extension created once at Postgres init (`CREATE EXTENSION IF NOT EXISTS vector;` — runs as part of the migration spec's init script).

## Config / Env Vars

```
SEMANTIC_PROVIDER=pgvector-local        # | novamem | off
SEMANTIC_MODEL=Xenova/all-MiniLM-L6-v2  # only used by pgvector-local
SEMANTIC_DIMENSIONS=384                  # must match the vector(384) column type
SEMANTIC_CHUNK_TOKENS=256
SEMANTIC_CHUNK_OVERLAP=32

# Phase B (NovaMem provider only — ignored when pgvector-local):
NOVAMEM_ENDPOINT=
NOVAMEM_PROJECT_PREFIX=kryton-          # tenant projects become "kryton-<userId>"
NOVAMEM_AUTH_MODE=better-auth-shared    # | api-key
```

Provider can be `off` to disable the feature entirely (skips extension loading, hides UI toggle, returns 503 on semantic routes).

Provider is set **at install/deployment time only** — there is no runtime UI for switching providers because changing providers means re-indexing every note.

## Decisions (resolved during spec review)

| #  | Question                                  | Decision                                                                                          |
|----|-------------------------------------------|---------------------------------------------------------------------------------------------------|
| Q1 | Dependency footprint                       | **A — always bundle.** `@xenova/transformers` ships with the server image (dynamic-imported so it only loads when `SEMANTIC_PROVIDER !== "off"`). pgvector ships in the Postgres image (already there). |
| Q2 | First-run model load                       | **B — pre-warm in background.** Server boots immediately; semantic routes return 503 + readiness payload until ready; UI polls `/api/search/semantic/ready`. |
| Q3 | Multi-tenant scan cost                     | **Resolved natively by pgvector.** HNSW with `WHERE user_id = $1` filtering happens inside the index scan — no candidate over-fetching. |
| Q4 | Chunk-vs-note dedup                        | **A — dedup by notePath.** Top-N results show one row per note (highest-scoring chunk).           |
| Q5 | Multi-platform embedding                   | **Server-only, hard rule.** Clients never embed and never store vectors. Online-only architecture (sync v2 + offline support removed in PR #110). |
| Q6 | NovaMem coupling                           | **Install-time choice only.** `pgvector-local` is the default; `novamem` is opt-in via `SEMANTIC_PROVIDER=novamem` at deployment. Never auto-detected, never the default, no runtime UI switch. |

### Implementation decisions (post-migration spec refresh)

| #  | Question                                  | Decision                                                                                          |
|----|-------------------------------------------|---------------------------------------------------------------------------------------------------|
| I1 | API namespace                              | **Mode parameter on `/api/search/`.** `?mode=lexical|semantic|hybrid` on the existing route. Single endpoint covers all three modes; consistent with how the lexical FTS is already served. Readiness + reindex are sub-routes (`/api/search/semantic/ready`, `/api/search/semantic/reindex`). |
| I2 | Write-time embedding                        | **Durable queue (B).** `INSERT INTO "EmbedJob" ... ON CONFLICT DO UPDATE` from each `SearchService` mutation site → in-process worker drains. File-save POST returns immediately; embedding catches up async; survives crashes. |
| I3 | Readiness payload                            | `{ ready, provider, model?, dimensions, pendingJobs }`. Client uses `ready` to gate semantic queries and `pendingJobs > 0` to show a small "N notes indexing" pill in the SearchBar. |

## Deferred — separate design docs

- **Kryton SQLite → Postgres migration** to enable shared infrastructure with NovaMem (shared Postgres + shared identity via better-auth). Discussed verbally; full design doc to be written when Phase B is on the table.
- **Offline-first client-side query embedding** for true offline semantic search. Not blocking; the architecture allows adding a query-only client embedder later without changing the server side.

## Phasing

- **Phase A** (this spec): `sqlite-vec-local` + `openai-compatible` providers, server routes, SearchBar mode toggle, indexing pipeline + backfill, chokidar reconcile.
- **Phase B**: `novamem` provider; tenant ↔ project mapping; graph backfill.
- **Phase C**: hybrid RRF ranking; per-user weight override; `hybrid` becomes default.
- **Phase D** (deferred): offline-first mobile / native embedders.

Implementation order within Phase A and exact task breakdown come from the **plan**, not this spec.

## Out of Scope

- LLM-driven Q&A over notes (RAG, summarisation). The vector store is built such that RAG can sit on top later, but no answer-generation is part of this design.
- Re-ranking with a cross-encoder. The default top-N from MiniLM is the result; no second-pass re-ranker.
- Cross-user semantic search. Per-user isolation is preserved exactly as `SearchIndex` does today.
- Per-folder or per-tag scoping. Useful future iteration; not in Phase A.
