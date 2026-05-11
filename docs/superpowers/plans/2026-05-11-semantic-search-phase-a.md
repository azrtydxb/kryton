# Semantic Search — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `[ ]` checkbox syntax for tracking.

**Spec**: [`2026-05-11-semantic-search-design.md`](../specs/2026-05-11-semantic-search-design.md)

**Goal**: Ship Phase A — `pgvector-local` provider — so users can run `GET /api/search/?q=...&mode=semantic` and get cosine-similarity hits over their own notes. Phase B (NovaMem provider) and Phase C (hybrid ranking) follow in separate plans.

**Architecture**: Single feature branch `feat/semantic-search-phase-a`. Six sequenced phases, each its own commit (or small group), each leaving the branch in a green state.

**Tech stack additions**: `@xenova/transformers@^2.17.2` (dynamic-imported), drizzle-orm's `vector` helper (already in 0.45.2 — verified), pgvector HNSW with `vector_cosine_ops` (extension already installed via the Postgres init script).

---

## File Structure (post-Phase A)

```
packages/server/src/
├── db/schema/
│   ├── embeddings.ts                # NEW — noteEmbeddingChunk + embedJob
│   └── index.ts                     # MODIFIED — re-exports embeddings
├── modules/knowledge/
│   ├── services/
│   │   ├── semantic-search.service.ts   # NEW — query embed + KNN search
│   │   ├── chunker.ts                   # NEW — paragraph → 256-token windows
│   │   ├── embedder.ts                  # NEW — Transformers.js wrapper
│   │   ├── embed-worker.ts              # NEW — EmbedJob drain loop
│   │   └── search.service.ts            # MODIFIED — enqueue on mutate
│   ├── routes/
│   │   └── search.routes.ts             # MODIFIED — add ?mode=semantic, /ready, /reindex
│   └── schemas/
│       └── search.schemas.ts            # MODIFIED — add mode + readiness shapes
├── plugins/
│   └── embedder.ts                  # NEW — fastify plugin: model warm-up + worker lifecycle
└── config/
    └── env.ts                       # MODIFIED — SEMANTIC_* env vars

packages/server/package.json         # MODIFIED — add @xenova/transformers
packages/client/src/
└── components/Search/SearchBar.tsx  # MODIFIED — mode toggle + readiness pill
```

---

## Worktree setup

- [ ] **Step 0.1: Use `superpowers:using-git-worktrees`** to create an isolated worktree on branch `worktree-feat-semantic-search-phase-a`.

- [ ] **Step 0.2: Baseline.** Boot Postgres + run server tests; confirm 80/2 baseline. The plan assumes a clean master state.

---

## Phase 1: Schema + migration

- [ ] **Step 1.1**: Create `packages/server/src/db/schema/embeddings.ts` with `noteEmbeddingChunk` and `embedJob` tables. Use the snippet from the spec verbatim:

```ts
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

- [ ] **Step 1.2**: Re-export from `db/schema/index.ts`. No new relations needed — both tables are simple keyed on `userId`.

- [ ] **Step 1.3**: Generate migration:

```bash
cd packages/server
POSTGRES_URL=postgres://kryton:kryton@localhost:5432/kryton npx drizzle-kit generate
```

Inspect the generated SQL — should contain:
- `CREATE TABLE "NoteEmbeddingChunk"` with `embedding vector(384)` column
- `CREATE INDEX note_embedding_hnsw_idx ON "NoteEmbeddingChunk" USING hnsw (embedding vector_cosine_ops);`
- `CREATE TABLE "EmbedJob"`

Should NOT touch any existing tables.

- [ ] **Step 1.4**: Apply migration:

```bash
POSTGRES_URL=postgres://kryton:kryton@localhost:5432/kryton npx drizzle-kit migrate
```

Verify with `\dt` — 28 tables (was 26).

- [ ] **Step 1.5**: Run server tests. Baseline 80/2; should still be 80/2 (no app code yet uses these tables).

- [ ] **Step 1.6**: Commit `feat(server/db): schema + migration for semantic embeddings (phase 1/6)`.

---

## Phase 2: Embedder + chunker

- [ ] **Step 2.1**: Add `@xenova/transformers@^2.17.2` to `packages/server/package.json` (dev — it's heavy enough that we want to be intentional). Run `npm install`.

- [ ] **Step 2.2**: Create `packages/server/src/modules/knowledge/services/chunker.ts`:

```ts
const CHUNK_TOKENS = 256;
const CHUNK_OVERLAP = 32;
const MAX_CHUNKS = 64;

export interface NoteChunk {
  index: number;
  text: string;
}

/**
 * Split a markdown body into ~256-token windows with ~32-token overlap.
 * Preserves code fences as whole chunks. Prepends the note title to every
 * chunk so the title's semantic signal propagates.
 */
export function chunkNote(title: string, body: string): NoteChunk[] {
  // Implementation:
  // - Strip frontmatter (already done upstream by SearchService.indexNote)
  // - Tokenize on whitespace as a rough proxy for tokens (the embedder
  //   tokenizes properly itself; we just need a stable size signal here)
  // - Code fences: scan for ```...``` blocks; emit them whole even if oversize
  // - Sliding window over paragraphs, target 256 tokens, 32-token overlap
  // - Cap at MAX_CHUNKS
  // - Each chunk's `text` starts with `title + "\n\n"` for semantic signal
  // - Returns at least one chunk even for tiny notes
}
```

Tests: unit test for the chunker with three cases: tiny note (one chunk), long note (multiple chunks with overlap), note with code fence (fence intact).

- [ ] **Step 2.3**: Create `packages/server/src/modules/knowledge/services/embedder.ts`:

```ts
import type { FastifyBaseLogger } from "fastify";

export interface Embedder {
  /** Embed a batch of strings; returns [batchSize][dimensions] floats. */
  embed(texts: string[]): Promise<Float32Array[]>;
  /** Embed a single query string. */
  embedQuery(text: string): Promise<Float32Array>;
  readonly model: string;
  readonly dimensions: number;
}

export interface EmbedderConfig {
  model: string;       // "Xenova/all-MiniLM-L6-v2"
  dimensions: number;  // 384
}

/**
 * Build a Transformers.js embedder. Dynamic-imports @xenova/transformers
 * so the heavy dep only loads when the embedder is actually constructed.
 */
export async function createEmbedder(
  config: EmbedderConfig,
  log: FastifyBaseLogger,
): Promise<Embedder> {
  log.info({ model: config.model }, "embedder: loading model");
  const start = Date.now();
  const { pipeline } = await import("@xenova/transformers");
  const extract = await pipeline("feature-extraction", config.model);
  log.info({ ms: Date.now() - start }, "embedder: model ready");

  // Warm-up: embed once to populate ONNX runtime caches
  await extract("warm-up", { pooling: "mean", normalize: true });

  return {
    model: config.model,
    dimensions: config.dimensions,
    async embed(texts) {
      const out: Float32Array[] = [];
      for (const t of texts) {
        const r = await extract(t, { pooling: "mean", normalize: true });
        out.push(new Float32Array(r.data));
      }
      return out;
    },
    async embedQuery(text) {
      const r = await extract(text, { pooling: "mean", normalize: true });
      return new Float32Array(r.data);
    },
  };
}
```

- [ ] **Step 2.4**: Run server tests. Should still be 80/2 plus your new chunker tests (likely 83/2).

- [ ] **Step 2.5**: Commit `feat(server/knowledge): chunker + embedder (phase 2/6)`.

---

## Phase 3: Embedder Fastify plugin + worker

- [ ] **Step 3.1**: Add env vars to `packages/server/src/config/env.ts`:

```ts
SEMANTIC_PROVIDER:    z.enum(["pgvector-local", "novamem", "off"]).default("pgvector-local"),
SEMANTIC_MODEL:       z.string().default("Xenova/all-MiniLM-L6-v2"),
SEMANTIC_DIMENSIONS:  z.coerce.number().int().positive().default(384),
SEMANTIC_CHUNK_TOKENS:  z.coerce.number().int().positive().default(256),
SEMANTIC_CHUNK_OVERLAP: z.coerce.number().int().positive().default(32),
```

- [ ] **Step 3.2**: Create `packages/server/src/modules/knowledge/services/embed-worker.ts`:

The worker loop. Poll `EmbedJob` for the oldest row, take an advisory lock, embed, write `NoteEmbeddingChunk` (or delete), remove the job row. On failure, bump `attempts`; cap at 3.

Sketch (full implementation handled by the implementer subagent):

```ts
export class EmbedWorker {
  constructor(
    private deps: {
      db: Db;
      log: FastifyBaseLogger;
      embedder: Embedder;
      notesDir: string;
    },
  ) {}

  private running = false;
  private stopFlag = false;

  async start(): Promise<void> { /* schedule the loop */ }
  async stop(): Promise<void>  { /* set stopFlag + await loop drain */ }
  async pendingCount(userId?: string): Promise<number> { /* SELECT count(*) FROM embedJob [WHERE userId=$1] */ }

  private async loop(): Promise<void> {
    while (!this.stopFlag) {
      const job = await this.popOldestJob();
      if (!job) { await sleep(200); continue; }
      try { await this.processJob(job); }
      catch (err) { await this.recordFailure(job, err); }
    }
  }
}
```

- [ ] **Step 3.3**: Create `packages/server/src/plugins/embedder.ts`:

```ts
import fp from "fastify-plugin";
import { createEmbedder, type Embedder } from "../modules/knowledge/services/embedder.js";
import { EmbedWorker } from "../modules/knowledge/services/embed-worker.js";

export interface EmbedderState {
  ready: boolean;
  provider: "pgvector-local" | "novamem" | "off";
  model?: string;
  dimensions: number;
  embedder?: Embedder;
  worker?: EmbedWorker;
}

declare module "fastify" {
  interface FastifyInstance {
    embedderState: EmbedderState;
  }
}

export default fp(async (app) => {
  const provider = app.config.SEMANTIC_PROVIDER;
  const state: EmbedderState = {
    ready: false,
    provider,
    dimensions: app.config.SEMANTIC_DIMENSIONS,
  };
  app.decorate("embedderState", state);

  if (provider === "off") {
    app.log.info("semantic search disabled (SEMANTIC_PROVIDER=off)");
    return;
  }

  // Warm-up + worker start happen AFTER app.ready so request serving
  // begins immediately. Fire-and-forget.
  app.addHook("onReady", async () => {
    void (async () => {
      try {
        const embedder = await createEmbedder({
          model: app.config.SEMANTIC_MODEL,
          dimensions: app.config.SEMANTIC_DIMENSIONS,
        }, app.log);
        state.embedder = embedder;
        state.model = embedder.model;

        const worker = new EmbedWorker({
          db: app.db,
          log: app.log,
          embedder,
          notesDir: app.config.NOTES_DIR,
        });
        state.worker = worker;
        state.ready = true;
        void worker.start();
        app.log.info("semantic search ready");
      } catch (err) {
        app.log.error({ err }, "semantic search failed to initialise");
      }
    })();
  });

  app.addHook("onClose", async () => {
    await state.worker?.stop();
  });
}, { name: "embedder", dependencies: ["db"] });
```

Wire it in `app.ts` after `dbPlugin`.

- [ ] **Step 3.4**: Run tests. Tests boot the app via testcontainers; the embedder plugin should be `provider: "off"` in test env (set `SEMANTIC_PROVIDER=off` in the test harness so tests don't try to load a 23 MB model). Add that to `__tests__/helpers/build-test-app.ts`.

- [ ] **Step 3.5**: Commit `feat(server): embedder Fastify plugin + worker (phase 3/6)`.

---

## Phase 4: Enqueue from `SearchService` mutations

- [ ] **Step 4.1**: Modify `packages/server/src/modules/knowledge/services/search.service.ts`. Each of `indexNote`, `removeFromIndex`, `renameInIndex` gains an `await this.enqueueEmbedJob(...)` call after the SearchIndex write.

```ts
private async enqueueEmbedJob(userId: string, notePath: string, op: "upsert" | "delete") {
  // Skip when provider is off — saves a write.
  if (this.app.embedderState.provider === "off") return;
  await this.app.db.insert(embedJob)
    .values({ userId, notePath, op, attempts: 0 })
    .onConflictDoUpdate({
      target: [embedJob.userId, embedJob.notePath],
      set: { op, enqueuedAt: sql`NOW()`, attempts: 0, error: null },
    });
}
```

- For `indexNote(notePath, content, userId)` → enqueue `upsert`.
- For `removeFromIndex(notePath, userId)` → enqueue `delete`.
- For `renameInIndex(old, new, userId)` → enqueue `delete` for `old` + `upsert` for `new`. (No row coalescing across paths because the PK is `(userId, notePath)`.)

- [ ] **Step 4.2**: Modify `services/backfill/search-index-backfill.ts` to also enqueue an `upsert` job for each file it indexes during cold-start backfill. One additional line per call site.

- [ ] **Step 4.3**: Run server tests. Should still be 80/2 + chunker tests.

- [ ] **Step 4.4**: Add an integration test: write a note via the API, wait for embedder to drain (poll `pendingCount`), assert `NoteEmbeddingChunk` has rows. This test exercises the full pipeline. Tag it as slow (it actually loads the model — overrides `SEMANTIC_PROVIDER=pgvector-local` in that one test).

- [ ] **Step 4.5**: Commit `feat(server/knowledge): enqueue embed jobs from SearchService (phase 4/6)`.

---

## Phase 5: Routes — `?mode=semantic` + `/ready` + `/reindex`

- [ ] **Step 5.1**: Create `services/semantic-search.service.ts`:

```ts
export async function semanticSearch(
  app: FastifyInstance,
  query: string,
  userId: string,
  limit = 20,
): Promise<SearchResult[]> {
  const { embedderState, db } = app;
  if (!embedderState.ready || !embedderState.embedder) {
    throw new ServiceUnavailableError("Semantic search not ready", {
      ready: false,
      pendingJobs: 0,
    });
  }
  const qv = await embedderState.embedder.embedQuery(query);
  // pgvector: <=> is cosine distance (smaller is more similar; convert to similarity)
  const qvLiteral = `[${Array.from(qv).join(",")}]`;
  const rows = await db.execute(sql`
    SELECT note_path,
           chunk_index,
           chunk_text,
           1 - (embedding <=> ${qvLiteral}::vector) AS score
    FROM "NoteEmbeddingChunk"
    WHERE user_id = ${userId}
    ORDER BY embedding <=> ${qvLiteral}::vector
    LIMIT ${limit * 4}     -- over-fetch then dedup by notePath
  `);
  // Dedup by notePath, keep highest-scoring chunk per note
  const seen = new Map<string, SearchResult>();
  for (const row of rows.rows as Array<{...}>) {
    const existing = seen.get(row.note_path);
    if (!existing || row.score > existing.score) {
      seen.set(row.note_path, mapRow(row));
    }
  }
  return [...seen.values()].slice(0, limit);
}
```

- [ ] **Step 5.2**: Modify `routes/search.routes.ts`. The existing `GET /api/search/?q=...` gets a `mode?: "lexical" | "semantic" | "hybrid"` querystring param. `mode === "hybrid"` returns 501 for now (Phase C). `mode === "semantic"` dispatches to `semanticSearch()`.

Add new routes:
- `GET /api/search/semantic/ready` → `{ ready, provider, model, dimensions, pendingJobs }`. `pendingJobs` is per-user via `worker.pendingCount(userId)`.
- `POST /api/search/semantic/reindex` → enqueues an `upsert` job for every `SearchIndex` row owned by the caller (admin can pass `?scope=all`).

- [ ] **Step 5.3**: Update OpenAPI snapshot:

```bash
cd packages/server
POSTGRES_URL=postgres://kryton:kryton@localhost:5432/kryton npm run openapi:dump
```

Eyeball the diff. Then regenerate SDK types:

```bash
cd packages/sdk
npm run generate  # or whatever the codegen script is
```

- [ ] **Step 5.4**: Run server tests. Plus add three new test files:
- `__tests__/semantic-search-ready.routes.test.ts` — readiness payload shape
- `__tests__/semantic-search.routes.test.ts` — mode=semantic happy path + 503 when not ready
- `__tests__/semantic-search-reindex.routes.test.ts` — reindex enqueues jobs

These tests need `SEMANTIC_PROVIDER=pgvector-local` and a real model load — tag as `slow` if vitest supports it; otherwise accept a slower suite. Target: server suite goes from 80/2 to ~85/2.

- [ ] **Step 5.5**: Commit `feat(server/knowledge): /api/search routes for semantic mode + ready + reindex (phase 5/6)`.

---

## Phase 6: UI — SearchBar mode toggle + readiness pill

- [ ] **Step 6.1**: Locate the SearchBar component. Likely `packages/client/src/components/Search/SearchBar.tsx` or in `packages/ui/src/search/`.

- [ ] **Step 6.2**: Add a small mode toggle (pill style, matching the Account Settings dialog): `lexical` (default), `semantic`. Toggle persists in local state (no settings table write needed).

- [ ] **Step 6.3**: When the user toggles to `semantic`:
- Fetch `GET /api/search/semantic/ready`. If `ready === false`, show "warming up…" pill, poll every 2 s until ready, then run the query.
- Once ready, send `GET /api/search/?q=...&mode=semantic`.
- If `pendingJobs > 0`, show a small "N notes indexing" hint under the search box.

- [ ] **Step 6.4**: Hit results — render with the existing snippet display plus a `… score 0.82` badge in the meta line.

- [ ] **Step 6.5**: Client tests. Add coverage for the mode toggle + readiness gating. Baseline 17 client tests; target 19–20.

- [ ] **Step 6.6**: Manual UI smoke (server already running):
  1. Sign in
  2. Create a note "Kubernetes deployment guide"
  3. Wait ~5 s
  4. Toggle SearchBar to semantic
  5. Search "container orchestration" — should return the Kubernetes note even though the words don't overlap

- [ ] **Step 6.7**: Commit `feat(client): semantic search mode toggle + readiness pill (phase 6/6)`.

---

## Acceptance criteria

Before merging:

- [ ] `grep -rn "SemanticProvider\|noteEmbeddingChunk\|embedJob" packages/server/src` shows the new code paths wired in
- [ ] Server tests: ≥85 passed (was 80, plus ~5 new for semantic)
- [ ] Client tests: ≥19 passed (was 17, plus ~2 new for UI toggle)
- [ ] `typecheck` clean, `lint` clean (`--max-warnings 0`)
- [ ] `openapi:check` passes (snapshot up to date with the new routes)
- [ ] Manual smoke walk: sign up → create note → toggle to semantic → query for unrelated-but-semantically-close text → get a hit
- [ ] With `SEMANTIC_PROVIDER=off`, the server starts, `embedderState.ready === false`, semantic routes 503, **lexical search still works unchanged**

## Finishing

Use `superpowers:finishing-a-development-branch`. Default option: **2. Push and create a Pull Request** — substantial change, deserves review.

---

## Out of scope (Phase B / C / future)

- NovaMem provider (`SEMANTIC_PROVIDER=novamem`) — Phase B
- Hybrid lexical + semantic + graph fusion (`mode=hybrid`) — Phase C
- Tenant-scoped reindex (`POST /api/search/semantic/reindex?scope=all`) — admin-only, deferred until needed
- Real-time `LISTEN/NOTIFY` instead of polling on the embed-worker — fine for now, sub-200ms latency at idle
- Per-user provider override (UI runtime switch) — out of scope by Q6 decision
- Cross-user vector search for shared notes — Phase A is own-notes-only
