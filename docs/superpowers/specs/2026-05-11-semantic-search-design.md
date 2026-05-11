# Semantic Search Design

**Date**: 2026-05-11
**Status**: **Provisional — must be rewritten after the Postgres + Drizzle migration lands.**
**Prerequisite**: [Postgres + Drizzle Migration](2026-05-11-postgres-drizzle-migration-design.md) ships first.

> ## ⚠️ Rewrite required after the migration
>
> This spec was drafted before Kryton's Postgres + Drizzle migration. The pgvector-based design below is the **intended direction**, but every concrete detail — table definitions, query shapes, Drizzle helpers available (e.g., the `vector` import path), Fastify plugin wiring, test setup — is based on assumptions about what the post-migration codebase will look like.
>
> **Do not use this spec to drive a plan.** Once the migration is merged to `master`, revisit this document end-to-end against the real code, update every code snippet to match what's actually there, re-verify the schema decisions against the real Drizzle setup, and flip the status to `Decisions resolved — ready for plan` before writing the implementation plan.
>
> Decisions Q1–Q6 captured here are still valid; the implementation specifics are not.

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
// packages/server/src/db/schema/embeddings.ts (Drizzle)
import { pgTable, text, integer, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core";   // pgvector helper, drizzle-orm v0.31+

export const noteEmbeddingChunk = pgTable("NoteEmbeddingChunk", {
  userId:     text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  notePath:   text("note_path").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  chunkText:  text("chunk_text").notNull(),
  embedding:  vector("embedding", { dimensions: 384 }).notNull(),
  modifiedAt: timestamp("modified_at", { withTimezone: true }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.notePath, t.chunkIndex] }),
  hnsw: index("note_embedding_hnsw_idx")
    .using("hnsw", t.embedding.op("vector_cosine_ops")),
  userPath: index("note_embedding_user_path_idx").on(t.userId, t.notePath),
}));
```

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

#### Indexing pipeline

Reuses the patterns already proven by `SearchIndexManager` and `notes-watcher`:

1. **Write path** — `notes.writeContent()` triggers `embedQueue.enqueue({ op: "upsert", userId, notePath })`.
2. **Rename** — emits `delete(oldPath)` + `upsert(newPath)`.
3. **Delete** — emits `delete(notePath)`.
4. **Watcher reconcile** — chokidar already reconciles `SearchIndex` against the filesystem (see `search-index-reconcile.ts`); the same pass touches `NoteEmbeddingChunk` so out-of-band edits trigger re-embedding.
5. **Backfill** — first-run script walks each user's notes dir and embeds anything missing. Reuses the existing per-user backfill harness.

Queue properties:
- Single-process, in-memory, durable across crashes via a small `EmbedJob` Prisma table (path + op + enqueuedAt). On boot, drain pending jobs before accepting new ones.
- Concurrency = 1 by default (CPU embed model on shared Node loop); configurable.
- Coalescing: if a note is queued for `upsert` multiple times before processing, only the latest version embeds.

#### API surface

New routes under `/api/knowledge/`:

```
POST /api/knowledge/semantic-search
  body  { q: string, limit?: number }
  resp  { hits: Array<{ notePath, title, snippet, score, chunkIndex }> }

GET  /api/knowledge/semantic-ready
  resp  { ready: boolean, provider: string, model?: string, dimensions: number }

POST /api/knowledge/reindex             (admin / per-user)
  body  { scope: "self" | "all" }
```

The existing `/api/knowledge/search` route stays untouched (lexical only). The UI picks which one to hit based on the search mode toggle.

#### Boot behavior — pre-warm, not block (Q2: B)

On server start the embedder kicks off a non-blocking background job:

1. Fastify boots and accepts traffic immediately (lexical search works from second 0).
2. Background job: dynamic-import Transformers.js → load MiniLM ONNX → embed a single warm-up sentence to populate the runtime caches.
3. While loading, `/api/knowledge/semantic-ready` returns `{ ready: false, eta?: number }`. Semantic search routes return 503 with the same payload.
4. When done, `semantic-ready` flips to `{ ready: true, provider: "sqlite-vec-local", model: "Xenova/all-MiniLM-L6-v2", dimensions: 384 }`.
5. UI polls `semantic-ready` once on app load + on demand when the user flips the search mode to semantic; shows a "warming up…" pill while not ready.

This avoids the "server feels stuck on every restart" experience during dev iteration while keeping search latency predictable once the model is hot.

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

- Provider chosen during install: `SEMANTIC_PROVIDER=sqlite-vec-local` (default) or `SEMANTIC_PROVIDER=novamem`.
- Never auto-detected, never the default. A self-hoster who hasn't already deployed NovaMem doesn't get prompted to install it.
- The web UI does **not** expose runtime provider switching — changing providers requires a re-index, which is an install/migration operation, not a per-session toggle.

**Postgres co-tenancy (separate decision):** Phase B is *also* the natural moment to migrate Kryton from SQLite to Postgres, because (a) NovaMem already runs on Postgres + drizzle + pgvector, (b) shared identity via better-auth lets Kryton's `userId` IS NovaMem's `userId`, (c) pgvector solves the multi-tenant scan-cost problem from Q3 natively. **This migration is out of scope for this spec and will get its own design doc when Phase B is on the table.**

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

1. **Lexical** — MiniSearch BM25-style score from `SearchIndex`.
2. **Semantic** — cosine similarity from `sqlite-vec` (or NovaMem if Phase B active).
3. **Graph** — proximity in the wikilink graph (`GraphEdge`). A note that's 1 hop from a strongly-matching note gets a small boost; 2 hops, smaller. Beyond 3 hops, no signal.

Fusion via weighted reciprocal rank fusion:

```
score = w_l / (k + rank_lexical)
      + w_s / (k + rank_semantic)
      + w_g / (k + rank_graph)
```

Defaults: `w_l = 0.4`, `w_s = 0.4`, `w_g = 0.2`, `k = 60` (standard RRF). Per-user override stored in `Settings`.

A new route `POST /api/knowledge/hybrid-search` orchestrates the three calls in parallel and fuses. UI mode toggle becomes `lexical | semantic | hybrid`, and `hybrid` becomes the new default.

When the NovaMem provider is active in Phase B, the hybrid call short-circuits — NovaMem already does all three fusions natively, so we just proxy `memory_search` and skip Kryton's local fusion math.

### Multi-platform: server-only embedding, vectors as sync v2 payload (Q5)

**Hard rule across all platforms and phases:** clients (web, mobile, desktop) never run an embedder. Only the server embeds notes, only the server embeds queries.

This produces three concrete behaviors:

| Scenario       | Lexical search                  | Semantic search                                                 |
|----------------|---------------------------------|-----------------------------------------------------------------|
| **Online**     | Local MiniSearch on the client  | API call to `/api/knowledge/semantic-search` (server embeds query + runs KNN) |
| **Offline**    | Local MiniSearch on the client  | Returns "semantic search needs connection" — falls back to lexical |
| **Reconnect**  | (no change)                     | Resumes immediately; nothing to re-sync from the user's side    |

**Vector-table sync** rides on Sync v2 (`docs/superpowers/specs/2026-04-30-server-sync-v2-design.md`). When a client comes online it receives the user's `NoteEmbeddingChunk` rows and the matching rows from `note_embeddings_vec` (vector blobs) as part of the normal sync delta. The client persists them in its local SQLite + sqlite-vec extension.

In Phase A these synced vectors are **storage redundancy** — they're there for sync robustness and offline cache, not for client-side search (which is impossible without a client embedder).

Forward path: if offline-first semantic search ever becomes a hard requirement, the spec for that day adds **only a query-only client embedder** (≤6 MB quantized MiniLM is feasible; or platform-native fallbacks like `NaturalLanguage`). Existing vectors don't need to change because the document-side embedder stays server-only.

This also sidesteps the cross-platform vector-incompatibility issue entirely: there's only one embedder on the planet for any given Kryton deployment — the server's.

#### Per-platform notes

- **Web client (current):** consumes the API directly. Does not need sqlite-vec.
- **Mobile (`kryton-mobile` React Native):** consumes the API directly. Sync v2 brings vectors down for storage; in Phase A they're inert.
- **Desktop (Tauri, planned):** bundles the server in the same binary. The server-bundled-with-client model means desktop gets local embedding "for free" without violating the rule — the embedder still runs in the server process, just one that happens to be hosted inside the desktop app.

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
| Q1 | Dependency footprint                       | **A — always bundle.** `@xenova/transformers` + `sqlite-vec` ship with the server image.          |
| Q2 | First-run model load                       | **B — pre-warm in background.** Server boots immediately; semantic routes return 503 + readiness payload until ready; UI polls `/semantic-ready`. |
| Q3 | Multi-tenant scan cost                     | **Resolved natively by pgvector.** HNSW with `WHERE user_id = $1` filtering happens inside the index scan — no candidate over-fetching. The Phase A switch from sqlite-vec to pgvector (now that the Postgres migration ships first) closes this for free. |
| Q4 | Chunk-vs-note dedup                        | **A — dedup by notePath.** Top-N results show one row per note (highest-scoring chunk).           |
| Q5 | Multi-platform embedding                   | **Server-only, hard rule across all phases.** Clients never embed (neither documents nor queries). Vectors sync to clients as storage payload only. Offline = lexical search only; semantic search returns "needs connection" until reconnect. |
| Q6 | NovaMem coupling                           | **Install-time choice only.** `sqlite-vec-local` is the default; `novamem` is opt-in via `SEMANTIC_PROVIDER=novamem` at deployment. Never auto-detected, never the default, no runtime UI switch. |

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
