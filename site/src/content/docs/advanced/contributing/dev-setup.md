---
title: Dev setup
description: Local development setup — clone, Postgres in Docker, dev servers, and a quick path through the auth wall.
---

## Prerequisites

- **Node.js 24+** (the server depends on Node 24's native APIs; nvm or fnm is the easiest path).
- **PostgreSQL 16+** with the `pgvector` extension. Docker is the path of least resistance.
- **npm 10+** ships with Node 24.

## Bootstrap

```bash
# 1. Clone
git clone https://github.com/azrtydxb/kryton.git && cd kryton

# 2. Env
cp .env.example .env
#    Edit .env — at minimum, set POSTGRES_URL and BETTER_AUTH_SECRET.
#    Generate the secret: openssl rand -hex 32

# 3. Dependencies (monorepo — installs every workspace)
npm install

# 4. Postgres in Docker (with pgvector)
docker compose up -d postgres

# 5. Migrate the schema
npm run db:migrate --workspace=packages/server

# 6. Start both dev servers
npm run dev
```

Frontend at `http://localhost:5173`, backend at `http://localhost:3001`. The Vite dev server proxies `/api`, `/ws`, and `/health*` to the backend.

## Useful scripts

| Command | What |
|---|---|
| `npm run dev` | Frontend + backend dev servers (concurrent). |
| `npm run build` | Production build of the whole monorepo. |
| `npm run test` | All workspaces' tests (vitest). |
| `npm run lint` | ESLint across every workspace. |
| `npm run typecheck` | `tsc --noEmit` across every workspace. |
| `npm run db:migrate --workspace=packages/server` | Apply Drizzle migrations against `POSTGRES_URL`. |
| `npm run db:studio --workspace=packages/server` | Open Drizzle Studio against the local DB. |
| `npm run openapi:dump --workspace=packages/server` | Emit the OpenAPI spec to `packages/server/openapi.json`. |

## Skipping the auth wall during dev

For local feature work it's tedious to keep registering and re-authenticating. Two patterns:

### Dev seed user

A first run with `REGISTRATION_MODE=open` (the default until a first user lands) lets you register an admin via the UI in seconds. Use a memorable email (`dev@local`) and a password you'll reuse. Subsequent `npm run dev` sessions reuse the same Postgres volume, so the user persists.

If you reset the DB (`docker compose down -v`), reseed the same way.

### Smoke-user pattern

For one-off test scripts that hit the API, mint an API key from the UI once and stash it in `.env.local`:

```env
KRYTON_TEST_TOKEN=kryton_a1b2c3...
```

Source it in your test runner. The key persists across server restarts and respects the same auth model as in production, so the test exercises the real surface.

## Workspace layout

| Workspace | Role |
|---|---|
| `packages/server` | Express + Drizzle + Yjs server. The TypeScript backend. |
| `packages/client` | React + Vite client. The TypeScript frontend. |
| `packages/shared` | Types and Zod schemas shared between client and server. |
| `plugins/*` | Bundled plugins shipped with the host. |
| `charts/kryton` | Helm chart. |
| `operator` | Kubernetes Operator (Go). |
| `site` | This documentation site (Astro + Starlight). |
| `cli` | `@azrtydxb/kryton-init` + `@azrtydxb/kryton-mcp`. |

## Hot reload

Vite handles client hot reload. The server uses `tsx watch` and restarts on any change under `packages/server/src/`. Database connections drop and reconnect automatically — drizzle's pool is short-lived in dev.

## Submitting a change

1. Branch from `master` with a descriptive name (`feat/add-board-undo`, `fix/yjs-reconnect`).
2. Make your changes. Add tests where the change affects behaviour.
3. Run the full local gate:

   ```bash
   npm run lint && npm run typecheck && npm run test && npm run build
   ```
4. Commit using [Conventional Commits](/kryton/advanced/contributing/commit-conventions/).
5. Open a PR against `master`. CI re-runs the gate plus the deployment sync check.

## See also

- [Commit conventions](/kryton/advanced/contributing/commit-conventions/) — what CI enforces.
- [Release process](/kryton/advanced/contributing/release-process/) — what happens after merge.
- [`CONTRIBUTING.md`](https://github.com/azrtydxb/kryton/blob/master/CONTRIBUTING.md) — the canonical document this page wraps.
