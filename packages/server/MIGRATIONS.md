# Database Migrations

Kryton uses [Drizzle Kit](https://orm.drizzle.team/kit-docs/overview) for Postgres schema versioning. Migrations live in `packages/server/src/db/migrations/` as plain `.sql` files alongside a `meta/` journal maintained by drizzle-kit.

## Requirements

- Postgres 16+
- The `pgvector` extension installed in the target database. The docker-compose stack uses `pgvector/pgvector:pg16` and runs `docker/postgres-init/01-extensions.sql` automatically on first boot.
- `POSTGRES_URL` set to a libpq-style connection string, e.g. `postgres://kryton:kryton@localhost:5432/kryton`.

## For developers

After editing any file under `packages/server/src/db/schema/`, generate a new migration:

```bash
cd packages/server
POSTGRES_URL=postgres://kryton:kryton@localhost:5432/kryton npm run db:generate
```

Drizzle Kit diffs the schema against the recorded snapshot and emits a new `NNNN_<name>.sql` file. Inspect it, rename if needed, and commit it alongside the schema change.

Apply pending migrations against a running Postgres:

```bash
POSTGRES_URL=postgres://kryton:kryton@localhost:5432/kryton npm run db:migrate
```

Open Drizzle Studio (local schema/data browser):

```bash
POSTGRES_URL=... npm run db:studio
```

## For production

Run `npm run db:migrate` against the target `POSTGRES_URL` before starting the server. The container entrypoint does this automatically on boot. The `pgvector` extension must already be installed in the target database — the dev compose stack does this automatically; bring-your-own-Postgres deployments must `CREATE EXTENSION IF NOT EXISTS vector;` once before the first migration.

## History

This repository previously used Prisma + SQLite. The 2026-05-11 Postgres + Drizzle migration replaced that stack wholesale — there is no SQLite codepath, no backup-and-migrate shell script, and no Prisma migration history to carry forward. See `docs/superpowers/specs/2026-05-11-postgres-drizzle-migration-design.md` for the design rationale.
