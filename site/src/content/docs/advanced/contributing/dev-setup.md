---
title: Dev setup
description: Run Kryton locally from source — prerequisites, Postgres via docker compose, env vars, and the dev servers.
---

## Prerequisites

- Node.js 24 (matches the version pinned in `.github/workflows/release.yml`)
- Docker (used to bring up Postgres 16 + `pgvector`)
- `git`, `openssl`

The repo does not pin a Node version via `.nvmrc` or `volta`. CI containers run `node:24`, so use 24 locally to stay in sync.

## Clone and install

```sh
git clone https://github.com/azrtydxb/kryton.git
cd kryton
cp .env.example .env
npm install
```

Then open `.env` and set, at minimum:

```sh
POSTGRES_URL=postgres://kryton:kryton@localhost:5432/kryton
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
```

`BETTER_AUTH_SECRET` is validated at startup and must be at least 32 characters (see `packages/server/src/config/env.ts`).

## Start Postgres

The bundled `docker-compose.yml` runs `pgvector/pgvector:pg16` and an init script that enables the `vector` extension:

```sh
docker compose up -d postgres
```

Postgres listens on `localhost:5432` with database `kryton`, user `kryton`, password `kryton`.

## Run migrations

```sh
npm run db:migrate --workspace=packages/server
```

## Start the dev servers

```sh
npm run dev
```

This runs the server and client in parallel (see the `dev` script in `package.json`):

- Client (Vite): http://localhost:5173
- Server (Fastify): http://localhost:3001
- OpenAPI UI: http://localhost:3001/docs (`OPENAPI_ENABLED` defaults to `true`)

## First user

There is no seed user. Register through the web UI; the server assigns the `admin` role to the user whose registration brings the user count from 0 to 1 (see `packages/server/src/modules/identity/auth-config.ts`). Subsequent registrations get the `user` role.

## Useful scripts

From `package.json`:

| Command | What it does |
|---|---|
| `npm run dev` | Server + client dev servers in parallel |
| `npm run build` | Production build of server then client |
| `npm run typecheck` | TypeScript check across server + client |
| `npm run lint` | ESLint across server + client |
| `npm run lint:fix` | ESLint with `--fix` |
| `npm test` | Vitest across server + client |
| `npm run test:server` | Server tests only |
| `npm run test:client` | Client tests only |
| `npm run build:shared` | Build the `packages/ui` and `packages/sdk` workspaces |
| `npm run sync:check` | Verifies compose/helm/operator stay in lockstep |

## Git hooks

`npm install` runs `husky` via the `prepare` script. The `.husky/` directory configures:

- `commit-msg` — runs `npx --no -- commitlint --edit $1`
- `pre-commit` — runs `npx lint-staged` (ESLint `--fix` on staged `.ts`/`.tsx` under `packages/client` and `packages/server`)
