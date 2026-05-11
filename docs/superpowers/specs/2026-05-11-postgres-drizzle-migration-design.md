# Postgres + Drizzle Migration Design

**Date**: 2026-05-11
**Status**: Implemented (2026-05-11)
**Mode**: Big-bang. No backwards compatibility. No data migration. Dev-only — nothing running in production.

## Problem

Kryton's data layer is **Prisma + SQLite**. This was the right call in early development but holds back nearly every adjacent piece of work:

- **Semantic search** (`docs/superpowers/specs/2026-05-11-semantic-search-design.md`) — sqlite-vec doesn't support per-tenant WHERE filtering inside KNN; pgvector does.
- **Hybrid search** — Postgres `tsvector` gives full-text natively in the same query as semantic; SQLite needs an in-memory MiniSearch index alongside the DB.
- **NovaMem co-tenancy** — NovaMem is Postgres + Drizzle + pgvector. Sharing infrastructure is trivial inside one Postgres cluster, painful across two different databases.
- **Concurrent writes** — SQLite serializes writers; Postgres handles real concurrency for sync v2, Yjs persistence, and the embed-job queue.
- **Foreign key enforcement** — Prisma's SQLite `ON DELETE CASCADE` is honored, but other constraint patterns Postgres makes trivial are awkward today.
- **Identity sharing** — better-auth tables become the single source of truth for both Kryton and (future) NovaMem when both run against the same Postgres.

Since nothing is in production and there are no real users with data to preserve, we do this as a single atomic swap on a feature branch and don't carry a SQLite escape hatch forward.

## Design

### Scope

A single feature branch (`feat/postgres-drizzle`) replaces:

- Prisma → Drizzle (ORM + migration tool + query layer)
- SQLite → Postgres 16+
- Better-auth's Prisma adapter → its Drizzle adapter
- MiniSearch in-memory index → Postgres `tsvector` columns + GIN indexes (lexical search rewrite, in scope for this migration since it's coupled)

Not in scope:

- Migrating existing self-hoster data. There is none we care about.
- Keeping Prisma running in parallel. The branch deletes Prisma in one shot.
- Semantic search. That's the next spec; this migration unblocks it.
- Yjs CRDT format changes. The `YjsDocument` / `YjsUpdate` tables get translated 1:1.

### Stack

| Layer                    | Before                                              | After                                                  |
|--------------------------|-----------------------------------------------------|--------------------------------------------------------|
| Database                 | SQLite (`packages/server/data/kryton.db`)           | Postgres 16+ (docker-compose service or BYOPG)         |
| ORM                      | `@prisma/client` v7                                  | `drizzle-orm` v0.45+                                   |
| Migration tool           | `prisma migrate`                                     | `drizzle-kit`                                          |
| Auth adapter             | `better-auth`'s Prisma adapter                       | `better-auth`'s Drizzle adapter                        |
| Lexical search           | `MiniSearch` (in-memory, mirrored from `SearchIndex`)| Postgres `tsvector` + GIN index on `notes.tsv`         |
| Vector search            | n/a (deferred)                                       | n/a (still deferred; `pgvector` extension installed now, used by semantic spec) |
| Test DB                  | SQLite file per test                                 | Real Postgres via `@testcontainers/postgresql`         |
| Dev DB                   | SQLite file                                          | `pgvector/pgvector:pg16` in docker-compose                 |
| CI DB                    | SQLite file                                          | GitHub Actions `services.postgres`                     |

### Schema Translation

All 28 Prisma models become Drizzle table definitions in `packages/server/src/db/schema/`. One file per logical domain, re-exported from `schema/index.ts`:

```
packages/server/src/db/
├── schema/
│   ├── index.ts          # re-exports
│   ├── auth.ts           # User, Session, Account, Verification, Passkey, TwoFactor, ApiKey
│   ├── settings.ts       # Settings, InstalledPlugin, PluginStorage
│   ├── notes.ts          # SearchIndex (renamed), GraphEdge, NoteVersion, NoteRevision,
│   │                     #   Attachment, Folder, Tag, NoteTag, TrashItem
│   ├── sharing.ts        # NoteShare, AccessRequest, InviteCode
│   ├── sync.ts           # SyncDeletion, SyncCursor, YjsDocument, YjsUpdate
│   └── agents.ts         # Agent, AgentToken
├── client.ts             # createDbClient() — drizzle wrapping pg.Pool
├── migrations/           # drizzle-kit output (.sql files, sequentially numbered)
└── seed/                 # dev seed scripts (optional)
```

Naming conventions: snake_case columns in SQL (`created_at`, `note_path`), camelCase in TS (`createdAt`, `notePath`), via Drizzle's column aliasing. Table names stay PascalCase to match existing API responses and reduce churn (`User`, `NoteShare`).

#### `tsvector` for lexical search

The current `SearchIndex` model becomes the canonical "notes table for indexing." It gains:

```ts
// drizzle schema fragment
export const searchIndex = pgTable("SearchIndex", {
  notePath: text("note_path").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: text("tags").notNull(),
  modifiedAt: timestamp("modified_at", { withTimezone: true }).notNull(),
  // Generated stored column — Postgres maintains it for us:
  tsv: tsvector("tsv").generatedAlwaysAs(
    sql`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '') || ' ' || coalesce(tags, ''))`,
    { stored: true },
  ),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.notePath] }),
  tsvIdx: index("search_index_tsv_idx").using("gin", t.tsv),
}));
```

The `tsvector` helper isn't in core Drizzle yet; we declare it as a `customType` in `packages/server/src/db/types.ts`. Same approach NovaMem uses (see `warm-store/index.ts:195`).

Lexical search query becomes a single SQL call:

```sql
SELECT note_path, title, ts_rank(tsv, query) AS score
FROM "SearchIndex", websearch_to_tsquery('english', $1) query
WHERE user_id = $2 AND tsv @@ query
ORDER BY score DESC
LIMIT $3;
```

This deletes `packages/server/src/modules/knowledge/services/search-index.ts` (the MiniSearch manager) and most of `search-query.ts`. `SearchIndexManager.getOrCreateIndex(userId)` and its LRU cache go away. Net code reduction is significant.

#### Auth tables

`better-auth` generates its own schema for the Drizzle adapter — we run their generator once and commit the output, then never edit by hand. Tables stay in the same logical place (`schema/auth.ts`).

#### Yjs persistence

`YjsDocument` and `YjsUpdate` become regular tables with `bytea` columns for the binary CRDT payloads. Existing query patterns translate 1:1 to Drizzle's query builder.

### Query Layer Migration

Every `app.prisma.X.method(...)` call site must move to Drizzle. Two strategies considered:

- **Type-aliased shim** (`app.db` exports a Drizzle instance, then services migrate file-by-file).
- **Single-PR coordinated swap** (all services migrate in lockstep).

Going with the **second**. Drizzle and Prisma have different query shapes (`findMany({ where })` vs `select().from().where()`), and trying to make services agnostic to which one is active would add a translation layer that we'd then delete. Cleaner to rewrite each service's queries against Drizzle and remove `app.prisma` entirely.

Approximate file count for queries that need migration (audit pass during implementation):

```bash
grep -rl "app\.prisma\." packages/server/src | wc -l
# ~40-60 files, each containing a handful of calls
```

Per-file conversion is mechanical. Patterns:

| Prisma                                              | Drizzle                                                           |
|-----------------------------------------------------|-------------------------------------------------------------------|
| `prisma.user.findUnique({ where: { id } })`         | `db.select().from(user).where(eq(user.id, id)).limit(1)`          |
| `prisma.notes.findMany({ where: { userId } })`      | `db.select().from(notes).where(eq(notes.userId, userId))`         |
| `prisma.note.create({ data })`                      | `db.insert(notes).values(data).returning()`                       |
| `prisma.note.update({ where, data })`               | `db.update(notes).set(data).where(eq(notes.id, id)).returning()`  |
| `prisma.$transaction(async (tx) => ...)`            | `db.transaction(async (tx) => ...)`                               |
| `prisma.$queryRaw\`SELECT ...\``                    | `db.execute(sql\`SELECT ...\`)`                                   |

Relations: Prisma's `include`/`select` becomes Drizzle's `with` (via `drizzle-orm`'s relational queries, which require a `relations` declaration). For the few places that use deep `include`, those relations get declared once in `schema/index.ts`.

### Migration Tool (drizzle-kit)

- Generate initial migration from the new Drizzle schema. This produces `packages/server/src/db/migrations/0000_init.sql`.
- The migration creates **every** Kryton table from scratch — no incremental story, no preserving existing data.
- `drizzle-kit migrate` runs at server startup if `MIGRATE_ON_BOOT=true` (default in dev), or via an explicit `pnpm db:migrate` command in CI/prod.
- Schema drift check: `drizzle-kit check` runs in CI to catch schema/migration mismatches.

Prisma's `migrations/` directory is **deleted** in this branch. No history is preserved.

### Connection Pool

Single `pg.Pool` per process, created once at app boot via `createDbClient()` and decorated onto the Fastify instance as `app.db`. Pool sizing: default 10 connections, configurable via `DATABASE_POOL_SIZE`. Same pattern NovaMem uses.

```ts
// packages/server/src/db/client.ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export function createDbClient(databaseUrl: string, poolSize = 10) {
  const pool = new Pool({ connectionString: databaseUrl, max: poolSize });
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDbClient>;
```

Fastify plugin (`packages/server/src/plugins/db.ts`) wires this in and registers a shutdown hook to call `pool.end()`.

### better-auth Integration

Switch from `betterAuth({ database: prismaAdapter(prisma, { provider: "sqlite" }) })` to `betterAuth({ database: drizzleAdapter(db, { provider: "pg", schema }) })`. The hand-off is mechanical; auth flow contracts don't change.

Note: better-auth's Drizzle adapter expects specific table/column names. We may need to alias our `User` columns (`emailVerified`, etc.) to match its expectations — done in the schema file, not at query sites.

### Docker Compose

`docker-compose.yml` gains a `postgres` service by default. Self-hosters running `docker compose up` see no operational complexity increase — Postgres comes for free, mounted on a volume.

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
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kryton"]
      interval: 5s

  kryton:
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://kryton:kryton@postgres:5432/kryton

volumes:
  kryton-pgdata:
```

BYOPG: a user pointing `DATABASE_URL` at their own Postgres simply ignores the bundled service (we'd document this; the bundled service is still defined but unused).

The bundled image will install `pgvector` via an init script so semantic search Phase A can use it without further setup:

```sql
-- packages/server/docker/postgres-init/01-extensions.sql
CREATE EXTENSION IF NOT EXISTS vector;
```

This runs once at first boot of the Postgres container.

### Test Infrastructure

Existing tests use a SQLite file per test. New strategy:

- **Unit tests** that don't touch the DB: unchanged.
- **DB-touching tests**: spin up a real Postgres via `@testcontainers/postgresql`. Each test file gets a fresh container; `drizzle-kit migrate` runs against it; the test runs; the container tears down. Slower than SQLite-per-test but accurate.
- **Optimization**: `vitest`'s `globalSetup` spins up one shared container per test process, with each test running inside a transaction that's rolled back at teardown. Same pattern NovaMem uses in its server tests.

CI: GitHub Actions `services.pgvector/pgvector:pg16` is the simpler alternative for end-to-end tests where transaction-per-test isn't viable. Both approaches coexist; the integration test runner picks one.

### CI Pipeline Updates

The `build` job in `.github/workflows/ci.yml` needs:

```yaml
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
```

Plus a step before tests:

```yaml
- name: Run migrations
  run: pnpm db:migrate
  env:
    DATABASE_URL: postgres://kryton:kryton@localhost:5432/kryton_test
```

The "Prepare test database" step (currently `mkdir + prisma db push`) is replaced.

### Module Removals

Wholesale deletions from this branch:

- `packages/server/prisma/` (entire directory)
- `packages/server/src/generated/prisma/` (Prisma client output)
- `packages/server/src/modules/knowledge/services/search-index.ts` (MiniSearch manager)
- Most of `packages/server/src/modules/knowledge/services/search-query.ts` (replaced by a tsvector query)
- `packages/server/src/modules/notes/services/backfill/search-index-reconcile.ts` (no in-memory index to reconcile; the `tsv` generated column is always up-to-date)
- Any "warm the MiniSearch index" boot hooks in `app.ts`

Approximate code line reduction: 3000+ lines deleted; ~2000 lines added for the new schema + query rewrites. Net reduction.

### Config / Env Vars

```
DATABASE_URL=postgres://kryton:kryton@postgres:5432/kryton   # required
DATABASE_POOL_SIZE=10                                         # optional, default 10
MIGRATE_ON_BOOT=true                                          # dev default; CI/prod runs via pnpm db:migrate
```

Removed: `DATABASE_URL` pointing at a SQLite file (e.g., `file:./data/kryton.db`).

## Branch Strategy

Single long-lived feature branch: `feat/postgres-drizzle`. All work happens there. Merges to master only when the entire migration is complete and tests pass.

Recommended sub-task ordering inside the branch (each is its own commit, not its own PR):

1. **Drizzle schema** — define all 28 tables, generate initial migration, no app code uses them yet.
2. **DB client + Fastify plugin** — `createDbClient`, `app.db` decorator, shutdown hook.
3. **Auth migration** — switch better-auth to Drizzle adapter, verify auth flows.
4. **Module-by-module query migration** — auth, settings, notes, sharing, sync, agents. Each commit is one module passing its own tests.
5. **Lexical search rewrite** — replace MiniSearch + `SearchIndex` mirror with the `tsvector` generated column. Delete the MiniSearch code path.
6. **Yjs persistence cutover** — verify bytea round-trips.
7. **Test infrastructure** — testcontainers integration, transaction-per-test wrapper.
8. **CI pipeline** — Postgres service, `db:migrate` step.
9. **Docker Compose** — `postgres` service, init script for `pgvector`.
10. **Prisma deletion** — final commit removes `packages/server/prisma/`, `src/generated/prisma/`, the `@prisma/client` dep, and updates `package.json` scripts.

This sequencing keeps tests green at every commit and surfaces problems incrementally.

## Risks

1. **Drizzle's relational query layer is younger than Prisma's `include`.** Complex deep relations (e.g., user → installed plugins → plugin storage) might need raw joins. Mitigation: audit the call sites that use Prisma `include` during step 4 and decide per-case (relational query vs hand-written join).

2. **better-auth Drizzle adapter quirks.** Its schema is opinionated — column names like `emailVerified` (boolean), `accessTokenExpiresAt` (date). We adapt our schema to its expectations rather than the other way around.

3. **`tsvector` for non-English content.** Current MiniSearch is language-agnostic. `to_tsvector('english', ...)` stems English words; non-English users get worse lexical search. Mitigation: `simple` configuration as fallback, or per-user language preference stored in `Settings` later. Acceptable trade for Phase A.

4. **Test parallelism + transaction rollback semantics.** If we go the "one container, transaction-per-test" route, tests that explicitly commit (e.g., testing transaction behavior itself) will surprise us. Mitigation: those specific tests use a dedicated container.

5. **First-time Postgres setup on Windows dev machines.** Less smooth than SQLite. Mitigated by Docker Compose; native installs are user's problem.

## Out of Scope (separate specs / future work)

- **Semantic search** — covered by `2026-05-11-semantic-search-design.md` (this migration is its prerequisite).
- **Shared Postgres with NovaMem + shared `users` via better-auth** — needs its own design once we know Kryton runs on Postgres. Likely 1-2 weeks after this lands.
- **Multi-region Postgres / read replicas / connection pooler (PgBouncer).** Not needed at current scale.
- **Per-row security via Postgres RLS.** Kryton already enforces tenant isolation at the application layer; RLS is overkill until shared multi-tenant hosting becomes a concern.
- **Database backup tooling.** Out of scope; users use their own Postgres backup tools.

---

## Implementation Notes (2026-05-11)

The migration landed in ten phases on `feat/postgres-drizzle` (PR #109). A few intentional deviations from the original design are worth recording:

- **Postgres image**: The plan called for `postgres:16-alpine` with pgvector preinstalled. That combination doesn't exist in a single official image, so the compose stack uses `pgvector/pgvector:pg16` instead. The init script under `packages/server/docker/postgres-init/` runs `CREATE EXTENSION IF NOT EXISTS vector;` on first boot.
- **Env var name**: We chose `POSTGRES_URL` rather than reusing `DATABASE_URL`. Phase 8 dropped `DATABASE_URL` entirely (it was SQLite-shaped — `file:./data/kryton.db`) so a clean new name avoided every stale config carrying the wrong value forward.
- **Testcontainers / CI reuse**: The vitest global-setup honours `TEST_DATABASE_URL`. When set (CI provides a Postgres service container), the global-setup skips booting its own testcontainer and reuses the externally-provisioned database. This avoids the ~6s container boot per CI run and the corresponding redundant pgvector install.
- **Phase reordering**: Phase 7 (test infrastructure — testcontainers, transaction-per-test) was pulled forward to between original Phases 2 and 3 so that auth-adapter and module-rewrite phases could land with real DB-backed tests already in place. Phase 10 (Prisma deletion) was pulled forward to before the CI swap, so Phase 9 could land a CI pipeline that targets only Postgres rather than a transitional dual-stack one.
- **Generated artifacts**: `packages/core/src/generated/{schema.sql,types.ts,entities.ts}` were originally produced by `packages/core/scripts/generate-schema.ts` reading `prisma/schema.prisma`. Prisma is gone, but those files are still consumed by `@azrtydxb/core` consumers, so they are now frozen committed artifacts. The codegen scripts (`generate-schema.ts`, `verify-generated.ts`, the entire `scripts/lib/` walker) and the SQLite-era `packages/server/scripts/migrate.mjs`/`migration-verify.ts` have been deleted.
