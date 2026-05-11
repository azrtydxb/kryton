# Postgres + Drizzle Migration Implementation Plan

**Status**: Implemented (2026-05-11). All ten phases complete; PR #109. See the spec's "Implementation Notes" section for deviations.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec**: [`2026-05-11-postgres-drizzle-migration-design.md`](../specs/2026-05-11-postgres-drizzle-migration-design.md)

**Goal**: Replace Prisma + SQLite with Drizzle + Postgres in one feature branch. Delete the MiniSearch lexical-search path along the way and replace it with Postgres `tsvector`. Nothing in production — no data migration, no compatibility shims.

**Architecture**: Single long-lived feature branch `feat/postgres-drizzle`. Ten sequenced phases, each one its own commit (or small group of commits), each leaving the branch in a state where the relevant subset of tests pass. Final phase deletes Prisma entirely.

**Tech Stack**: Postgres 16+, `drizzle-orm` v0.45+, `drizzle-kit` for migrations, `pgvector` extension (installed at init for the semantic-search work that follows), `better-auth` Drizzle adapter, `@testcontainers/postgresql` for DB-backed tests.

---

## File Structure (post-migration)

```
packages/server/src/db/
├── schema/
│   ├── index.ts          # re-exports + Drizzle relations
│   ├── auth.ts           # User, Session, Account, Verification, Passkey, TwoFactor, ApiKey
│   ├── settings.ts       # Settings, InstalledPlugin, PluginStorage
│   ├── notes.ts          # SearchIndex (with tsvector), GraphEdge, NoteVersion,
│   │                     #   NoteRevision, Attachment, Folder, Tag, NoteTag, TrashItem
│   ├── sharing.ts        # NoteShare, AccessRequest, InviteCode
│   ├── sync.ts           # SyncDeletion, SyncCursor, YjsDocument, YjsUpdate
│   └── agents.ts         # Agent, AgentToken
├── types.ts              # tsvector customType, plus any other Drizzle helpers
├── client.ts             # createDbClient() — drizzle wrapping pg.Pool
├── migrations/           # drizzle-kit output (.sql files, sequentially numbered)
│   ├── 0000_init.sql
│   └── meta/             # drizzle-kit journal
└── seed/                 # optional dev seed scripts

packages/server/docker/
└── postgres-init/
    └── 01-extensions.sql  # CREATE EXTENSION vector; (for semantic search later)

packages/server/src/plugins/
└── db.ts                 # Fastify plugin: decorates app.db, registers onClose hook

DELETED:
  packages/server/prisma/                              # entire directory
  packages/server/src/generated/prisma/                # entire directory
  packages/server/src/modules/knowledge/services/search-index.ts
  packages/server/src/modules/notes/services/backfill/search-index-reconcile.ts
```

---

## Worktree Setup

- [x] **Step 0.1: Use the `using-git-worktrees` skill** to create an isolated workspace for the `feat/postgres-drizzle` branch off `master`.

- [x] **Step 0.2: Verify clean baseline.**

Run: `pnpm test`
Expected: all tests pass on master (the state immediately after PR 107 + PR 92 merged).

If any tests fail, stop and investigate before proceeding — we need a green baseline to detect regressions.

---

## Phase 1: Add Postgres + Drizzle dependencies and infrastructure

The goal of Phase 1 is to get Postgres running locally and Drizzle wired up, without yet touching any app code or schema. After this phase, the server still uses Prisma + SQLite; `app.db` (Drizzle) exists alongside `app.prisma` but is empty.

**Files:**
- Modify: `packages/server/package.json`
- Create: `packages/server/drizzle.config.ts`
- Create: `packages/server/src/db/client.ts`
- Create: `packages/server/src/db/schema/index.ts` (empty exports for now)
- Create: `packages/server/src/plugins/db.ts`
- Modify: `packages/server/src/app.ts` (register the new plugin)
- Modify: `docker-compose.yml`
- Create: `packages/server/docker/postgres-init/01-extensions.sql`

- [x] **Step 1.1: Install dependencies.**

```bash
cd packages/server
pnpm add drizzle-orm pg
pnpm add -D drizzle-kit @types/pg @testcontainers/postgresql
```

- [x] **Step 1.2: Create `drizzle.config.ts`.**

```ts
// packages/server/drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://kryton:kryton@localhost:5432/kryton",
  },
  strict: true,
  verbose: true,
});
```

- [x] **Step 1.3: Create `db/client.ts`.**

```ts
// packages/server/src/db/client.ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDbClient>;

export function createDbClient(databaseUrl: string, poolSize = 10) {
  const pool = new Pool({ connectionString: databaseUrl, max: poolSize });
  return { db: drizzle(pool, { schema }), pool };
}
```

- [x] **Step 1.4: Create empty `db/schema/index.ts`.**

```ts
// packages/server/src/db/schema/index.ts
// Schema modules re-export here. Filled in across Phase 2.
export {};
```

- [x] **Step 1.5: Create Fastify plugin `plugins/db.ts`.**

```ts
// packages/server/src/plugins/db.ts
import fp from "fastify-plugin";
import { createDbClient, type Db } from "../db/client.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db["db"];
  }
}

export default fp(async (app) => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const { db, pool } = createDbClient(databaseUrl, Number(process.env.DATABASE_POOL_SIZE ?? 10));
  app.decorate("db", db);

  app.addHook("onClose", async () => {
    await pool.end();
  });
});
```

- [x] **Step 1.6: Register the plugin in `app.ts`.** Add `await app.register(dbPlugin)` before the Prisma plugin registration so Drizzle is available first.

- [x] **Step 1.7: Add Postgres service to `docker-compose.yml`.**

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: kryton
      POSTGRES_PASSWORD: kryton
      POSTGRES_DB: kryton
    volumes:
      - kryton-pgdata:/var/lib/postgresql/data
      - ./packages/server/docker/postgres-init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kryton"]
      interval: 5s
    ports:
      - "5432:5432"

  # Update the existing kryton service:
  kryton:
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://kryton:kryton@postgres:5432/kryton

volumes:
  kryton-pgdata:
```

- [x] **Step 1.8: Create the init script for `pgvector`.**

```sql
-- packages/server/docker/postgres-init/01-extensions.sql
CREATE EXTENSION IF NOT EXISTS vector;
```

- [x] **Step 1.9: Add `db:*` scripts to `packages/server/package.json`.**

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "db:check": "drizzle-kit check"
  }
}
```

- [x] **Step 1.10: Boot the Postgres container and verify connectivity.**

```bash
docker compose up -d postgres
docker compose exec postgres psql -U kryton -d kryton -c "SELECT extname FROM pg_extension;"
```

Expected: `vector` listed alongside `plpgsql`.

- [x] **Step 1.11: Run the test suite to confirm no regressions.**

Run: `pnpm test`
Expected: all existing tests still pass (Prisma is still the active ORM; nothing app-level changed yet).

- [x] **Step 1.12: Commit.**

```bash
git add packages/server/package.json packages/server/drizzle.config.ts \
        packages/server/src/db/ packages/server/src/plugins/db.ts \
        packages/server/src/app.ts docker-compose.yml \
        packages/server/docker/postgres-init/
git commit -m "feat(server): scaffold drizzle + postgres infrastructure

Adds drizzle-orm, drizzle-kit, pg, and testcontainers; wires a Db
plugin onto Fastify alongside the existing Prisma plugin. Empty schema.
docker-compose ships pgvector/pgvector:pg16 with the pgvector extension
pre-installed via the postgres-init script."
```

---

## Phase 2: Translate all 28 Prisma models to Drizzle schema

Translate the Prisma schema model-by-model into Drizzle table definitions. Group by domain to match the file structure declared above. Each file is its own commit so a bisect can locate any translation error.

**Reference**: `packages/server/prisma/schema.prisma` is the source of truth for what each table needs.

- [x] **Step 2.1: Create the `tsvector` custom type.**

```ts
// packages/server/src/db/types.ts
import { customType } from "drizzle-orm/pg-core";

export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() { return "tsvector"; },
});
```

- [x] **Step 2.2: Translate auth tables into `schema/auth.ts`.**

This is the most rule-bound file: better-auth has opinionated column names. Generate the schema using better-auth's CLI if available (`pnpm exec better-auth generate --adapter drizzle`); otherwise hand-translate following `packages/server/prisma/schema.prisma`'s `User`, `Session`, `Account`, `Verification`, `Passkey`, `TwoFactor`, `ApiKey` models.

Expose all tables + create a Drizzle `relations()` block defining the foreign-key relationships (`user.sessions`, `user.accounts`, etc.).

Re-export from `schema/index.ts`.

- [x] **Step 2.3: Translate `schema/settings.ts`** — `Settings`, `InstalledPlugin`, `PluginStorage`. Re-export.

- [x] **Step 2.4: Translate `schema/notes.ts`.**

Includes `SearchIndex` (now with the `tsvector` generated column for lexical search — see spec), `GraphEdge`, `NoteVersion`, `NoteRevision`, `Attachment`, `Folder`, `Tag`, `NoteTag`, `TrashItem`.

The `SearchIndex` table definition gains the generated column:

```ts
import { tsvector } from "../types";

export const searchIndex = pgTable("SearchIndex", {
  notePath:   text("note_path").notNull(),
  userId:     text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  title:      text("title").notNull(),
  content:    text("content").notNull(),
  tags:       text("tags").notNull(),
  modifiedAt: timestamp("modified_at", { withTimezone: true }).notNull(),
  tsv:        tsvector("tsv").generatedAlwaysAs(
    sql`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '') || ' ' || coalesce(tags, ''))`,
    { stored: true },
  ),
}, (t) => ({
  pk:     primaryKey({ columns: [t.userId, t.notePath] }),
  tsvIdx: index("search_index_tsv_idx").using("gin", t.tsv),
}));
```

Re-export from `schema/index.ts`.

- [x] **Step 2.5: Translate `schema/sharing.ts`** — `NoteShare`, `AccessRequest`, `InviteCode`. Re-export.

- [x] **Step 2.6: Translate `schema/sync.ts`** — `SyncDeletion`, `SyncCursor`, `YjsDocument`, `YjsUpdate`. The two Yjs tables use `bytea` columns (Drizzle `bytea` helper) for binary CRDT payloads. Re-export.

- [x] **Step 2.7: Translate `schema/agents.ts`** — `Agent`, `AgentToken`. Re-export.

- [x] **Step 2.8: Declare relations in `schema/index.ts`.**

Drizzle's relational query API requires a `relations()` declaration per table that participates in joins. Walk the Prisma schema's relations and declare equivalents. Keep declarations next to the tables (each `schema/*.ts` file declares relations for its tables; `index.ts` re-exports).

- [x] **Step 2.9: Generate the initial migration.**

```bash
cd packages/server
pnpm db:generate
```

Expected: `src/db/migrations/0000_init.sql` is created containing `CREATE TABLE` for all 28 tables, indexes, and the `tsvector` generated columns.

Eyeball the generated SQL. Common issues to fix at the schema level (not the SQL file):
- Missing `ON DELETE CASCADE` where Prisma had it.
- Index names colliding (Drizzle generates them from column names; override with `.using("btree", ...).name(...)` if needed).
- Generated `tsvector` column missing the `STORED` modifier — confirm it's present.

If the SQL is wrong, fix the schema and re-run `db:generate`. Never edit `0000_init.sql` by hand.

- [x] **Step 2.10: Apply the migration against the local Postgres.**

```bash
DATABASE_URL=postgres://kryton:kryton@localhost:5432/kryton pnpm db:migrate
```

Then verify the table list:

```bash
docker compose exec postgres psql -U kryton -d kryton -c "\dt"
```

Expected: 28 tables present.

- [x] **Step 2.11: Commit.**

```bash
git add packages/server/src/db/schema/ packages/server/src/db/types.ts \
        packages/server/src/db/migrations/
git commit -m "feat(server): drizzle schema for all 28 tables + initial migration

Translates every Prisma model into a Drizzle pgTable definition,
grouped by domain (auth, settings, notes, sharing, sync, agents).
SearchIndex gains a tsvector generated column + GIN index, replacing
the in-memory MiniSearch index that comes out in phase 5. Initial
migration generated by drizzle-kit, applied cleanly against postgres:16
with pgvector pre-installed."
```

---

## Phase 3: Migrate better-auth to the Drizzle adapter

**Files:**
- Modify: `packages/server/src/auth/index.ts` (or wherever `betterAuth({...})` is configured)
- Modify: `packages/server/src/plugins/auth.ts` (or equivalent)

- [x] **Step 3.1: Swap the adapter in the better-auth config.**

```ts
// packages/server/src/auth/index.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { user, session, account, verification, passkey, twoFactor, apiKey } from "../db/schema/auth";

export function createAuth(db: Db) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification, passkey, twoFactor, apiKey },
    }),
    // … the rest of the existing config unchanged
  });
}
```

- [x] **Step 3.2: Update the auth plugin to construct the auth instance with `app.db` instead of `app.prisma`.**

- [x] **Step 3.3: Run the auth test suite.**

Run: `pnpm test -- auth`
Expected: every auth test still passes against Postgres (the existing tests touch the DB; they'll use the testcontainers harness once Phase 7 lands — for now, point them at the local docker compose Postgres).

- [x] **Step 3.4: Manual smoke test.**

Boot the server (`pnpm dev`), sign up a new user via the UI, log in, log out. Verify the rows landed in `User`, `Session`, `Account` tables (via `psql`).

- [x] **Step 3.5: Commit.**

```bash
git commit -m "feat(server): swap better-auth from prisma adapter to drizzle"
```

---

## Phase 4: Module-by-module query rewrite

Convert every `app.prisma.*` call site to Drizzle. One commit per module. Each module commit must leave its own tests passing.

**Audit:**

```bash
grep -rln "app\.prisma\." packages/server/src | sort -u
```

Group by directory and tackle one group per task.

### Task 4.A: `auth/` module residue

Most auth code already migrated in Phase 3, but check any direct Prisma calls in middleware, plugins, or session-handling utilities.

- [x] **Step 4.A.1:** `grep -rn "app\.prisma\." packages/server/src/auth/`. List call sites.
- [x] **Step 4.A.2:** Rewrite each using Drizzle's `db.select()` / `db.insert()` / `db.update()` / `db.delete()` builders. Use the schema imports.
- [x] **Step 4.A.3:** Run `pnpm test -- auth`. Expected pass.
- [x] **Step 4.A.4:** Commit `refactor(server/auth): migrate query layer to drizzle`.

### Task 4.B: `modules/settings/`

- [x] **Step 4.B.1–4:** Audit, rewrite, test, commit. Same shape as 4.A.

### Task 4.C: `modules/notes/` (largest)

This is the highest-touch module. Subdivide if needed:

- [x] **Step 4.C.1:** Audit `packages/server/src/modules/notes/`. Expect 10–15 files.
- [x] **Step 4.C.2:** Convert `services/notes-service.ts` (or equivalent main service). Test.
- [x] **Step 4.C.3:** Convert `services/folder-service.ts`. Test.
- [x] **Step 4.C.4:** Convert `services/version-service.ts` (note versions / revisions). Test.
- [x] **Step 4.C.5:** Convert `services/attachment-service.ts`. Test.
- [x] **Step 4.C.6:** Convert `services/tag-service.ts`. Test.
- [x] **Step 4.C.7:** Convert `services/trash-service.ts`. Test.
- [x] **Step 4.C.8:** Convert `routes/*` (route handlers that touch Prisma directly). Test.
- [x] **Step 4.C.9:** Run full `pnpm test -- notes`. Expected pass.
- [x] **Step 4.C.10:** Commit `refactor(server/notes): migrate query layer to drizzle`.

### Task 4.D: `modules/sharing/`

- [x] **Steps 4.D.1–4:** Audit, rewrite, test, commit.

### Task 4.E: `modules/sync/` (Yjs persistence + sync v2 cursors)

The Yjs binary payloads need verification — `bytea` round-trips correctly via `pg` only if the Drizzle column type matches (`customType` of `bytea` returning a `Buffer`).

- [x] **Step 4.E.1:** Audit `packages/server/src/modules/sync/` and `modules/collab/`.
- [x] **Step 4.E.2:** Rewrite query sites.
- [x] **Step 4.E.3:** Write or run a smoke test: save a 1 MB Yjs update, read it back, assert bytes match.
- [x] **Step 4.E.4:** Run `pnpm test -- sync collab`. Expected pass.
- [x] **Step 4.E.5:** Commit `refactor(server/sync,collab): migrate query layer to drizzle`.

### Task 4.F: `modules/agents/` (MCP)

- [x] **Steps 4.F.1–4:** Audit, rewrite, test, commit.

### Task 4.G: `modules/knowledge/` (search routes only; index manager comes out in Phase 5)

- [x] **Step 4.G.1:** Audit only the route handlers and helpers. Skip `services/search-index.ts` and `services/search-query.ts` — those die in Phase 5.
- [x] **Step 4.G.2:** Rewrite remaining call sites. Commit.

### Task 4.H: Plugins, middleware, miscellany

- [x] **Step 4.H.1:** Final audit. `grep -rn "app\.prisma\." packages/server/src` must return 0 results, **except** in `plugins/prisma.ts` (which stays until Phase 10).
- [x] **Step 4.H.2:** Run the entire server test suite.

Run: `pnpm test --workspace=packages/server`
Expected: all tests pass.

- [x] **Step 4.H.3:** Commit any straggler conversions.

---

## Phase 5: Replace MiniSearch with Postgres `tsvector`

**Files:**
- Modify: `packages/server/src/modules/knowledge/services/search-query.ts`
- Delete: `packages/server/src/modules/knowledge/services/search-index.ts`
- Delete: `packages/server/src/modules/notes/services/backfill/search-index-reconcile.ts`
- Modify: `packages/server/src/app.ts` (remove MiniSearch warm-up hooks)
- Modify: `packages/server/src/modules/knowledge/routes/search.routes.ts` (no change to public API contract)

- [x] **Step 5.1: Rewrite the search query.**

```ts
// packages/server/src/modules/knowledge/services/search-query.ts
import { sql, eq, and, desc } from "drizzle-orm";
import { searchIndex } from "../../../db/schema/notes";

export async function search(db: Db, query: string, userId: string, limit = 50): Promise<SearchResult[]> {
  if (!query.trim()) {
    const rows = await db
      .select({
        notePath:   searchIndex.notePath,
        title:      searchIndex.title,
        content:    searchIndex.content,
        tags:       searchIndex.tags,
        modifiedAt: searchIndex.modifiedAt,
      })
      .from(searchIndex)
      .where(eq(searchIndex.userId, userId))
      .orderBy(desc(searchIndex.modifiedAt))
      .limit(limit);
    return rows.map(rowToResult);
  }

  const rows = await db.execute(sql`
    SELECT
      note_path  AS "notePath",
      title,
      content,
      tags,
      modified_at AS "modifiedAt",
      ts_rank(tsv, query) AS score
    FROM "SearchIndex", websearch_to_tsquery('english', ${query}) query
    WHERE user_id = ${userId} AND tsv @@ query
    ORDER BY score DESC
    LIMIT ${limit}
  `);
  return rows.rows.map(rowToResult);
}
```

Then also add a snippet generator that uses `ts_headline` (Postgres's native snippet extractor) instead of the manual snippet helper.

- [x] **Step 5.2: Update `search-helpers.ts` to use `ts_headline` for snippet rendering.** Or compute snippets in JS still, if the existing test suite asserts a specific format — preserve test compatibility.

- [x] **Step 5.3: Delete `search-index.ts`.**

```bash
git rm packages/server/src/modules/knowledge/services/search-index.ts
```

- [x] **Step 5.4: Delete `search-index-reconcile.ts`.**

```bash
git rm packages/server/src/modules/notes/services/backfill/search-index-reconcile.ts
```

- [x] **Step 5.5: Remove MiniSearch warm-up hooks from `app.ts`** (the `SearchIndexManager` instantiation and any `buildIndex` calls during boot).

- [x] **Step 5.6: Remove the `minisearch` dependency.**

```bash
cd packages/server
pnpm remove minisearch
```

- [x] **Step 5.7: Run the search test suite.**

Run: `pnpm test -- search`
Expected: all tests pass. If tests asserted MiniSearch-specific behaviors (e.g., fuzzy matching tolerance), they need to be re-pointed at Postgres FTS semantics — adjust expectations to match `websearch_to_tsquery` behavior (handles `"phrases"`, `OR`, `-exclude`).

- [x] **Step 5.8: Commit.**

```bash
git commit -m "refactor(server/knowledge): replace MiniSearch with postgres tsvector

Deletes the in-memory MiniSearch index manager (search-index.ts) and
its reconcile backfill (search-index-reconcile.ts). The SearchIndex
table now carries a stored tsvector generated column with a GIN index;
search-query.ts hits postgres FTS directly.

Net code reduction: ~600 lines deleted, ~80 lines added."
```

---

## Phase 6: Yjs persistence cutover verification

**Files:** (no source changes — this is verification)

- [x] **Step 6.1: Write an end-to-end Yjs persistence integration test** if one doesn't exist.

```ts
// packages/server/src/modules/collab/__tests__/yjs-persistence.test.ts
it("round-trips Yjs updates through Postgres bytea", async () => {
  const doc = new Y.Doc();
  doc.getText("body").insert(0, "hello".repeat(100_000)); // 500KB+ payload
  const update = Y.encodeStateAsUpdate(doc);

  await app.db.insert(yjsUpdate).values({
    documentId: "test-doc",
    update: Buffer.from(update),
    createdAt: new Date(),
  });

  const [row] = await app.db.select().from(yjsUpdate).where(eq(yjsUpdate.documentId, "test-doc"));
  expect(row.update).toEqual(Buffer.from(update));
});
```

- [x] **Step 6.2: Run the test, observe pass.**

- [x] **Step 6.3: Run the full collab test suite.** Expected: pass.

- [x] **Step 6.4: Manual smoke test.**

Two clients connect to the same note via WebSocket → both edit → close → reopen → verify content is intact. Verify the `YjsDocument` and `YjsUpdate` rows look correct in `psql`.

- [x] **Step 6.5: Commit any test additions.**

```bash
git commit -m "test(server/collab): yjs bytea round-trip integration test"
```

---

## Phase 7: Test infrastructure — testcontainers + transaction-per-test

**Files:**
- Create: `packages/server/src/test/db-fixture.ts`
- Modify: `packages/server/vitest.config.ts`
- Create: `packages/server/src/test/global-setup.ts`

- [x] **Step 7.1: Add a global vitest setup that starts a shared Postgres container.**

```ts
// packages/server/src/test/global-setup.ts
import { PostgreSqlContainer } from "@testcontainers/postgresql";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;

export async function setup() {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
    .withDatabase("kryton_test")
    .withUsername("kryton")
    .withPassword("kryton")
    .start();

  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.TEST_DATABASE_URL = container.getConnectionUri();

  // Apply pgvector extension + run all migrations
  const { createDbClient } = await import("../db/client");
  const { db, pool } = createDbClient(container.getConnectionUri());
  await db.execute("CREATE EXTENSION IF NOT EXISTS vector");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  await pool.end();
}

export async function teardown() {
  await container?.stop();
}
```

Wire it into `vitest.config.ts`:

```ts
export default defineConfig({
  test: {
    globalSetup: "./src/test/global-setup.ts",
    fileParallelism: false,  // SQLite-era contention guard; re-enable when each test file uses its own savepoint
  },
});
```

- [x] **Step 7.2: Create a `withTransaction` helper for tests.**

```ts
// packages/server/src/test/db-fixture.ts
import { createDbClient } from "../db/client";

export function createTestDb() {
  const { db, pool } = createDbClient(process.env.TEST_DATABASE_URL!);

  // Each test gets a transaction that's always rolled back at teardown.
  // For tests that explicitly need committed state, use db directly.
  async function withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      const result = await fn(tx);
      throw new RollbackError(result);
    }).catch((e) => {
      if (e instanceof RollbackError) return e.result;
      throw e;
    });
  }

  return { db, pool, withTransaction };
}
```

- [x] **Step 7.3: Update test setup helpers to use the new fixture.** Convert any per-file `beforeAll` blocks that created SQLite files to use `createTestDb()`.

- [x] **Step 7.4: Run the full server test suite.**

Run: `pnpm test --workspace=packages/server`
Expected: all tests pass, slower than before but correct.

- [x] **Step 7.5: Re-enable file parallelism where safe.** If most tests use the transaction-per-test pattern, `fileParallelism: true` works. Tests that need committed state get a separate test container or run serially.

- [x] **Step 7.6: Commit.**

```bash
git commit -m "test(server): migrate test harness to postgres testcontainers"
```

---

## Phase 8: CI pipeline update

**Files:**
- Modify: `.github/workflows/ci.yml`

- [x] **Step 8.1: Replace the "Prepare test database" step.**

```yaml
jobs:
  build:
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: kryton
          POSTGRES_PASSWORD: kryton
          POSTGRES_DB: kryton_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U kryton"
          --health-interval 5s
          --health-retries 10

    steps:
      # … existing checkout/install steps …

      - name: Install pgvector extension
        run: |
          docker exec ${{ job.services.postgres.id }} \
            psql -U kryton -d kryton_test -c "CREATE EXTENSION IF NOT EXISTS vector"

      - name: Run migrations
        env:
          DATABASE_URL: postgres://kryton:kryton@localhost:5432/kryton_test
        run: pnpm --filter @azrtydxb/server db:migrate

      # Drop the old "mkdir packages/server/data + prisma db push" step
```

- [x] **Step 8.2: Verify CI runs green** by pushing the branch and watching `gh pr checks`.

- [x] **Step 8.3: Commit.**

```bash
git commit -m "ci: switch test database from sqlite to postgres + pgvector"
```

---

## Phase 9: Docker / Compose / docs polish

**Files:**
- Modify: `README.md` (or `docs/install/manual.md`)
- Modify: any references to `packages/server/data/*.db` in docs
- Modify: `docker-compose.yml` (final pass)
- Modify: `.env.example`

- [x] **Step 9.1: Update `.env.example`.**

```bash
DATABASE_URL=postgres://kryton:kryton@postgres:5432/kryton
DATABASE_POOL_SIZE=10
MIGRATE_ON_BOOT=true
```

Remove any `DATABASE_URL=file:./data/kryton.db` references.

- [x] **Step 9.2: Add `MIGRATE_ON_BOOT` handling to `app.ts`.**

```ts
if (process.env.MIGRATE_ON_BOOT === "true") {
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  await migrate(app.db, { migrationsFolder: "./src/db/migrations" });
  app.log.info("drizzle migrations applied");
}
```

- [x] **Step 9.3: Update install docs.** Single-line change in most cases: "Kryton requires Postgres 16+ with the pgvector extension. The bundled `docker-compose.yml` provides this out of the box; for BYOPG set `DATABASE_URL`."

- [x] **Step 9.4: Update `OPENAPI` env var docs if needed.** No semantic change, but the `.env` examples may show SQLite paths.

- [x] **Step 9.5: Test the full Docker stack.**

```bash
docker compose down -v
docker compose up --build
```

Open the app, sign up, create a note. Verify it landed in Postgres.

- [x] **Step 9.6: Commit.**

```bash
git commit -m "chore: docker compose + docs reflect postgres-only setup"
```

---

## Phase 10: Prisma deletion

**Files:**
- Delete: `packages/server/prisma/` (entire directory)
- Delete: `packages/server/src/generated/prisma/` (entire directory)
- Modify: `packages/server/package.json` (remove `@prisma/client`, `prisma`, and `prisma:*` scripts)
- Modify: `packages/server/src/plugins/prisma.ts` → delete
- Modify: `packages/server/src/app.ts` (remove prisma plugin registration)
- Modify: any test file still importing from Prisma types

- [x] **Step 10.1: Confirm no remaining references.**

```bash
grep -rln "@prisma/client\|app\.prisma\|generated/prisma" packages/server/src
```

Expected: 0 results.

- [x] **Step 10.2: Delete the directories.**

```bash
git rm -r packages/server/prisma packages/server/src/generated/prisma packages/server/src/plugins/prisma.ts
```

- [x] **Step 10.3: Remove Prisma from dependencies.**

```bash
cd packages/server
pnpm remove @prisma/client prisma
```

- [x] **Step 10.4: Update `packages/server/package.json`** to remove any `prisma:generate`, `prisma:migrate`, etc., scripts.

- [x] **Step 10.5: Run the full test suite.**

Run: `pnpm test --workspace=packages/server`
Expected: pass.

- [x] **Step 10.6: Run lint + typecheck across the workspace.**

```bash
pnpm run lint
pnpm --filter @azrtydxb/server typecheck
pnpm --filter @azrtydxb/client typecheck
```

Expected: zero warnings, zero errors.

- [x] **Step 10.7: Refresh the OpenAPI snapshot if any schema-derived response shapes drifted.**

```bash
pnpm --filter @azrtydxb/server openapi:dump
git diff packages/server/openapi.snapshot.json   # eyeball
```

- [x] **Step 10.8: Final smoke test against the running stack.**

`docker compose up`. Walk every major user flow: sign up, log in, create a note, edit it, save, restore an old version, share a note, search (lexical), view the graph, install a plugin, run an agent.

- [x] **Step 10.9: Commit.**

```bash
git commit -m "chore(server): delete prisma — drizzle migration complete

Removes packages/server/prisma/, src/generated/prisma/, the prisma
fastify plugin, and the @prisma/client + prisma dependencies. From
this commit forward, drizzle-orm is Kryton's sole data layer."
```

---

## Acceptance Criteria

Before merging the branch to master, all of the following must hold:

- [x] `grep -rln "prisma\|@prisma" packages/server/src` returns 0 results
- [x] `grep -rln "MiniSearch\|minisearch" packages/server/src` returns 0 results
- [x] `pnpm test --workspace=packages/server` passes 100%
- [x] `pnpm run lint` passes with 0 warnings
- [x] `pnpm --filter @azrtydxb/server typecheck` passes
- [x] `pnpm --filter @azrtydxb/client typecheck` passes
- [x] `pnpm --filter @azrtydxb/server openapi:check` passes (snapshot up to date)
- [x] CI is green on the feature branch
- [x] `docker compose up` from a fresh clone succeeds — sign-up → log in → create note → search → version restore all work end-to-end
- [x] `packages/server/data/` directory no longer exists in `.gitignore` (it was SQLite-only)
- [x] `.env.example` documents `DATABASE_URL` for Postgres
- [x] Spec `2026-05-11-semantic-search-design.md` can be revisited and re-finalized against the now-real Drizzle/pgvector setup

## Finishing

Use the `superpowers:finishing-a-development-branch` skill once acceptance criteria are met. The expected option is **2. Push and create a Pull Request** — this branch is too large for an admin-merge gate to be skipped without thorough review.
