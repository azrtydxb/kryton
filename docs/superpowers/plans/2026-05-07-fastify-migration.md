# Fastify Migration Implementation Plan

**Status**: Implemented

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Express 5 with Fastify in `packages/server` and restructure into 7 vertical feature modules.

**Architecture:** Single Fastify process serving HTTP + WebSocket (Yjs) + MCP. Cross-cutting concerns (Prisma, Better Auth, Cedar, config, logger) exposed via `app.decorate()`. Each module is an encapsulated Fastify plugin owning its routes, services, schemas, repos, and tests.

**Tech Stack:** Fastify 5, `fastify-type-provider-zod`, `@fastify/swagger`, `@fastify/swagger-ui`, `@fastify/websocket`, `@fastify/multipart`, `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit`, Pino, Zod 4, Prisma 7 + better-sqlite3, Better Auth 1.5, Cedar (wasm), MCP SDK.

**Branch:** `feat/fastify-migration`

**Spec:** [docs/superpowers/specs/2026-05-07-fastify-migration-design.md](../specs/2026-05-07-fastify-migration-design.md)

---

## Phase A — Foundation (sequential, blocks Phase B)

Owner: lead implementer. Files owned: everything outside `modules/*`.

### Task A1: Dependency swap

**Files:**
- Modify: `packages/server/package.json`

- [ ] Remove deps: `express`, `cors`, `helmet`, `multer`, `express-rate-limit`, `swagger-jsdoc`, `swagger-ui-express`, `@types/cors`, `@types/express`, `@types/multer`, `@types/swagger-jsdoc`, `@types/swagger-ui-express`.
- [ ] Add deps: `fastify@^5`, `@fastify/cors@^10`, `@fastify/helmet@^13`, `@fastify/rate-limit@^10`, `@fastify/swagger@^9`, `@fastify/swagger-ui@^5`, `@fastify/websocket@^11`, `@fastify/multipart@^9`, `fastify-type-provider-zod@^4`.
- [ ] `npm install` from repo root.
- [ ] Commit: `chore(server): swap express deps for fastify`.

### Task A2: Folder skeleton

**Files (create empty dirs only — no scaffolding files):**
```
packages/server/src/
  config/
  plugins/
  modules/identity/{routes,services,schemas,repos,__tests__}/
  modules/notes/{routes,services,schemas,repos,__tests__}/
  modules/knowledge/{routes,services,schemas,repos,__tests__}/
  modules/collab/{routes,services,schemas,repos,ws,__tests__}/
  modules/agents/{routes,services,schemas,repos,__tests__}/
  modules/plugins/{routes,services,schemas,repos,__tests__}/
  modules/platform/{routes,services,schemas,__tests__}/
```

- [ ] Create directory structure with `.gitkeep` files where empty.
- [ ] Commit: `chore(server): folder skeleton for module layout`.

### Task A3: Config (typed env)

**Files:**
- Create: `packages/server/src/config/env.ts`
- Create: `packages/server/src/config/index.ts`
- Move: existing `lib/env.ts` content into new files, expand schema.

- [ ] Define Zod schema for all env vars (extending current `lib/env.ts`). Add: `LOG_LEVEL` (default `info`), `NODE_ENV` (default `development`), `CORS_ORIGINS` (comma list, default `http://localhost:5173`), `RATE_LIMIT_MAX` (default 1000), `RATE_LIMIT_WINDOW` (default `1 minute`).
- [ ] Export `loadConfig()` returning frozen typed object. Fail fast on invalid env.
- [ ] Test: `__tests__/config.test.ts` — invalid env throws; valid env returns typed object.
- [ ] Commit: `feat(server): typed config from zod schema`.

### Task A4: Plugin — Zod type provider

**Files:**
- Create: `packages/server/src/plugins/zod.ts`

- [ ] Register `fastify-type-provider-zod` validator + serializer compilers.
- [ ] Export as `fastify-plugin` so it's available app-wide.
- [ ] Commit: `feat(server): zod type provider plugin`.

### Task A5: Plugin — Pino logger config

**Files:**
- Create: `packages/server/src/plugins/logger.ts` (config helper, not a plugin — passed to Fastify constructor)

- [ ] Export `loggerOptions(config)` returning Pino options: pretty in dev, JSON in prod, redact `[req.headers.authorization, req.headers.cookie, *.password, *.token, *.secret]`, level from config.
- [ ] Commit: `feat(server): pino logger config`.

### Task A6: Plugin — Errors

**Files:**
- Create: `packages/server/src/plugins/errors.ts`
- Modify: `packages/server/src/lib/errors.ts` — extract `AppError` hierarchy (no Express imports), add `ConflictError`, `RateLimitError`, `InternalError`, `AuthError`.

- [ ] Move `AppError`, `NotFoundError`, `ValidationError`, `ForbiddenError` to `lib/errors.ts` with no framework imports.
- [ ] In `plugins/errors.ts`: register `setErrorHandler` that maps `ZodError` (400 + field details), `AppError` (statusCode + structured body), `Prisma.PrismaClientKnownRequestError` (P2002→409, P2025→404), default → 500.
- [ ] Wire format: `{ error: { code, message, details? } }`.
- [ ] Tests: each error type produces the right status + shape via `app.inject()`.
- [ ] Commit: `feat(server): unified error plugin and AppError hierarchy`.

### Task A7: Plugin — Prisma decorator

**Files:**
- Create: `packages/server/src/plugins/prisma.ts`

- [ ] Plugin registers Prisma client as `fastify.prisma`. Connect on `onReady`, disconnect on `onClose`.
- [ ] Type-augment `FastifyInstance` with `prisma: PrismaClient`.
- [ ] Commit: `feat(server): prisma decorator plugin`.

### Task A8: Plugin — Cedar decorator

**Files:**
- Create: `packages/server/src/plugins/cedar.ts`
- Move: `services/cedar.ts` content into the plugin (engine init) + a thin service kept in `modules/identity/services/cedar.service.ts` if needed.

- [ ] Plugin instantiates Cedar engine (existing wasm), exposes `fastify.cedar.check({ principal, action, resource, context? })`.
- [ ] Throws `ForbiddenError` on deny.
- [ ] Tests cover allow + deny paths.
- [ ] Commit: `feat(server): cedar decorator plugin`.

### Task A9: Plugin — Better Auth integration

**Files:**
- Create: `packages/server/src/plugins/auth.ts`
- Move: `auth.ts` (root) → `modules/identity/auth-config.ts` (config only).

- [ ] Plugin imports `auth` from identity module's config, mounts via catch-all: `app.all('/api/auth/*', toFastifyHandler(auth.handler))`. Use Better Auth's `toNodeHandler` adapted to Fastify (await raw req/res passthrough).
- [ ] Decorate `fastify.auth` with: `requireUser(req)`, `requireSession(req)`, `getOptionalUser(req)`. These read the session via Better Auth's API using the request headers.
- [ ] Tests: unauthenticated request throws `AuthError`; authenticated returns user.
- [ ] Commit: `feat(server): better-auth fastify plugin with session helpers`.

### Task A10: Plugin — Security (helmet + cors)

**Files:**
- Create: `packages/server/src/plugins/security.ts`

- [ ] Register `@fastify/helmet` with sane defaults (CSP loose for `/docs` only).
- [ ] Register `@fastify/cors` with origins from `config.CORS_ORIGINS`. Credentials true.
- [ ] Commit: `feat(server): helmet + cors plugin`.

### Task A11: Plugin — Rate limit

**Files:**
- Create: `packages/server/src/plugins/rate-limit.ts`

- [ ] Register `@fastify/rate-limit` with global defaults from config. Custom key generator using `request.ip` (preserve current behaviour).
- [ ] Export tighter presets for identity routes (`identityLimit = { max: 10, timeWindow: '1 minute' }`).
- [ ] Commit: `feat(server): rate-limit plugin with presets`.

### Task A12: Plugin — Multipart

**Files:**
- Create: `packages/server/src/plugins/multipart.ts`

- [ ] Register `@fastify/multipart` with limits matching current multer config (50MB, single file).
- [ ] Commit: `feat(server): multipart plugin`.

### Task A13: Plugin — WebSocket

**Files:**
- Create: `packages/server/src/plugins/websocket.ts`

- [ ] Register `@fastify/websocket`. No routes here — modules register their own WS routes.
- [ ] Commit: `feat(server): websocket plugin`.

### Task A14: Plugin — OpenAPI

**Files:**
- Create: `packages/server/src/plugins/openapi.ts`

- [ ] Register `@fastify/swagger` with OpenAPI 3.1 mode, info from package.json, tags one per module.
- [ ] Register `@fastify/swagger-ui` at `/docs`. Hide spec route from prod if config flag off.
- [ ] Use Zod transform from `fastify-type-provider-zod` for schema serialization.
- [ ] Commit: `feat(server): openapi plugin (swagger + ui)`.

### Task A15: Plugin — Telemetry

**Files:**
- Create: `packages/server/src/plugins/telemetry.ts`

- [ ] Register `onRequest`/`onResponse`/`onError` hooks that create OpenTelemetry spans matching current `@opentelemetry/api` usage.
- [ ] Inject traceId/spanId into request log context.
- [ ] Commit: `feat(server): telemetry plugin with otel hooks`.

### Task A16: app.ts (composition root)

**Files:**
- Create: `packages/server/src/app.ts`

- [ ] Export `buildApp(config): Promise<FastifyInstance>`. Registration order matches design spec §3.
- [ ] No top-level side effects; pure function of config.
- [ ] Commit: `feat(server): buildApp composition root`.

### Task A17: server.ts (entrypoint)

**Files:**
- Create: `packages/server/src/server.ts`
- Modify: `packages/server/package.json` — `main`/`scripts.start`/`scripts.dev` point to `server.ts`.

- [ ] Load env, build app, listen, graceful shutdown (SIGINT/SIGTERM): close server (drains HTTP + WS), flush Yjs, disconnect Prisma, exit.
- [ ] Commit: `feat(server): entrypoint with graceful shutdown`.

### Task A18: Smoke route — version

**Files:**
- Create: `packages/server/src/modules/platform/routes/version.routes.ts`
- Create: `packages/server/src/modules/platform/index.ts`
- Modify: `packages/server/src/app.ts` — register platform module.

- [ ] Plugin entry registers child route under `/version` returning `{ version, commit, major }` from `lib/version.ts`.
- [ ] Test: `app.inject({ method: 'GET', url: '/version' })` returns 200 with expected shape.
- [ ] Commit: `feat(server): smoke version route end-to-end (Phase A complete)`.

**Phase A acceptance:** `npm run dev` boots, `GET /version` returns 200, `GET /docs` shows Swagger UI, `GET /healthz` returns 200, all Phase-A tests green.

---

## Phase B — Module ports (parallel)

Each module section below is a self-contained spec for one parallel agent. File ownership: `modules/<m>/**` only.

**Cross-module rule:** if a route in module X needs data from module Y, expose a method on `fastify.<y>.<helper>` and call it. No direct service imports across modules.

### Task B1: Module `platform`

Owner: agent-platform. Files owned: `modules/platform/**`.

**Routes ported (HTTP):**
- `GET /version` (already in A18)
- `GET /healthz` — returns `{ status: 'ok' }`.
- `GET /readyz` — checks `prisma.$queryRaw\`SELECT 1\``, Yjs registry available, MCP transport (if configured). Returns 200 or 503 with reason map.
- `GET /api/admin/*` — port `routes/admin.ts` (639 lines). All admin endpoints. Requires admin user (Cedar check).
- `GET/PUT /api/settings/*` — port `routes/settings.ts`. Per-user settings.

**Schemas:** Zod for each request/response in `schemas/`.

**Acceptance:**
- All ported endpoints respond with same shape as Express version (verify by diffing handler logic).
- Routes use `fastify.auth.requireUser` + `fastify.cedar.check` for admin gates.
- Tests: at least one passing test per route via `app.inject()`.

### Task B2: Module `identity`

Owner: agent-identity. Files owned: `modules/identity/**`.

**Routes ported:**
- `routes/users.ts` → `users.routes.ts`. CRUD/me endpoints.
- `routes/apiKeys.ts` → `api-keys.routes.ts`. PAT CRUD.
- Better Auth catch-all already wired in `plugins/auth.ts` (Phase A).

**Services ported:**
- `services/apiKeyService.ts` → `services/api-key.service.ts`. Receives Prisma via Fastify decorator (constructor or factory).
- `auth.ts` better-auth config → `auth-config.ts` (already moved in A9).

**Schemas:** Zod for each request/response.

**Authz:** every protected route opt-in via `preHandler: [fastify.auth.requireUser]`.

**Acceptance:**
- `/api/users/me` returns current user; 401 unauthenticated.
- API key create returns one-time secret + masked record; subsequent calls only see masked record.
- Tests for create/list/revoke/use API key.

### Task B3: Module `notes` (subdivided into B3a + B3b)

#### B3a — note core

Owner: agent-notes-core. Files owned: `modules/notes/routes/notes.routes.ts`, `modules/notes/routes/folders.routes.ts`, `modules/notes/routes/daily.routes.ts`, `modules/notes/routes/templates.routes.ts`, `modules/notes/routes/tags.routes.ts`, `modules/notes/routes/trash.routes.ts`, plus the corresponding services + schemas + repos under `modules/notes/`. Subfolder `modules/notes/services/{note,folder,tag,trash,user-notes-dir}.service.ts`.

**Routes ported:**
- `routes/notes.ts` → `notes.routes.ts` (437 lines)
- `routes/folders.ts` → `folders.routes.ts` (231 lines)
- `routes/daily.ts` → `daily.routes.ts`
- `routes/templates.ts` → `templates.routes.ts`
- `routes/tags.ts` → `tags.routes.ts`
- `routes/trash.ts` → `trash.routes.ts` (285 lines)

**Services ported:**
- `services/noteService.ts` → `services/note.service.ts` (266 lines)
- `services/folder.ts` → `services/folder.service.ts`
- `services/tag.ts` → `services/tag.service.ts`
- `services/trashService.ts` → `services/trash.service.ts`
- `services/userNotesDir.ts` → `services/user-notes-dir.service.ts` (230 lines)
- `services/backfill/*` → `services/backfill/*` (move as-is, update imports)

**Decorator:** `fastify.notes.getUserNotesDir(userId)` — used by other modules (collab persistence, search index).

**Acceptance:**
- All CRUD/listing endpoints work with same response shapes.
- Backfill triggers on first authenticated call (preserve current behaviour).
- Tests: smoke test per route.

#### B3b — note attachments + canvas + history + backlinks

Owner: agent-notes-aux. Files owned: `modules/notes/routes/{attachments,canvas,history,backlinks}.routes.ts` + corresponding services.

**Routes ported:**
- `routes/attachments.ts` → `attachments.routes.ts`. Uses `@fastify/multipart`.
- `routes/canvas.ts` → `canvas.routes.ts` (331 lines)
- `routes/history.ts` → `history.routes.ts`
- `routes/backlinks.ts` → `backlinks.routes.ts`

**Services ported:**
- `services/historyService.ts` → `services/history.service.ts`

**Acceptance:** uploads work via multipart; canvas CRUD round-trips; history snapshots/restore; backlinks query returns same shape.

### Task B4: Module `knowledge`

Owner: agent-knowledge. Files owned: `modules/knowledge/**`.

**Routes ported:**
- `routes/search.ts` → `search.routes.ts`
- `routes/graph.ts` → `graph.routes.ts`

**Services ported:**
- `services/searchService.ts` → `services/search.service.ts` (559 lines — biggest service, careful split if exceeds 250 lines after move).
- `services/graphService.ts` → `services/graph.service.ts` (343 lines).
- `services/cursor.ts` → `services/cursor.service.ts` (15 lines, helper).

**Decorator:** `fastify.knowledge.indexNote(userId, noteId, content)` — called by notes module on save.

**Acceptance:** search returns same hits; graph traversal preserved; full-text index rebuilds.

### Task B5: Module `collab`

Owner: agent-collab. Files owned: `modules/collab/**`. Sequential within module: shares routes → sync routes → ws handler.

**Routes ported:**
- `routes/shares.ts` → `shares.routes.ts` (502 lines).
- `routes/sync-v2.ts` → `sync.routes.ts` (83 lines).
- `routes/sync.ts` (v1) → **DELETE**.

**Services ported:**
- `services/shareService.ts` → `services/share.service.ts`.
- `services/sync-v2.ts` → `services/sync.service.ts` (439 lines).

**WS handler:**
- `services/yjs-server.ts` (256 lines) → `ws/yjs.handler.ts`. Use `@fastify/websocket` route `'/ws/yjs/:docId'`.
- `services/yjs-persistence.ts` → `ws/persistence.ts`.
- New: `ws/doc-registry.ts` — extracted from current setup.

**Decorator:** `fastify.collab.getDoc(docId)`, `fastify.collab.broadcast(docId, msg)`.

**Sequential discipline within module:**
1. Port shares routes + share.service.ts. Verify with tests.
2. Port sync routes + sync.service.ts. Verify with tests.
3. Port WS handler + persistence + registry. Run existing `stress:yjs:converge` and `stress:yjs:reconnect` against new server.
4. Delete v1 sync paths.

**Acceptance:**
- Share CRUD works.
- Sync v2 snapshot/push round-trip.
- Two clients converge a Y.Doc through the new server.
- `stress:yjs:reconnect` passes.

### Task B6: Module `agents`

Owner: agent-agents. Files owned: `modules/agents/**`.

**Routes ported:**
- `routes/agents.ts` → `agents.routes.ts`.

**Services ported:**
- `services/agent.ts` → `services/agent.service.ts`.

**MCP server:** port `mcp/mcpServer.ts` to `modules/agents/mcp/`. Mount its HTTP transport via Fastify.

**Acceptance:** agent CRUD works; MCP transport responds to a basic ping.

### Task B7: Module `plugins` (Kryton plugin system, not framework plugins)

Owner: agent-plugins. Files owned: `modules/plugins/**`.

**Routes ported:**
- `routes/plugins.ts` → `plugins.routes.ts` (329 lines).

**Services ported (the whole plugin runtime — preserve interfaces):**
- `plugins/PluginEventBus.ts` → `services/event-bus.ts`.
- `plugins/PluginHealthMonitor.ts` → `services/health-monitor.ts`.
- `plugins/PluginRouter.ts` → `services/plugin-router.ts`. Note: this is plugin-internal HTTP routing, not Fastify plugin routing. Adapt to mount on a Fastify scope.
- `plugins/PluginApiFactory.ts` → `services/api-factory.ts`.
- `plugins/PluginManager.ts` → `services/manager.ts`.
- `plugins/PluginWebSocket.ts` → `services/plugin-websocket.ts`.
- `plugins/types.ts` → `services/types.ts`.
- `services/pluginRegistryService.ts` → `services/registry.service.ts`.
- `services/pluginStorageService.ts` → `services/storage.service.ts`.

**Module entry:** initialise PluginManager and PluginEventBus, register plugin scope under `/api/plugins`. The PluginRouter must accept a Fastify scope and register routes there instead of an Express router.

**Acceptance:** plugin install/list/enable/disable works; plugin-defined routes mount correctly; plugin WebSocket connections work.

---

## Phase C — Cleanup (sequential, after all Phase B merged)

### Task C1: Delete old Express files

- [ ] Delete: `packages/server/src/index.ts` (old entry).
- [ ] Delete: `packages/server/src/auth.ts` (moved to identity).
- [ ] Delete: `packages/server/src/swagger.ts`.
- [ ] Delete: `packages/server/src/routes/*` and `packages/server/src/services/*` (all moved).
- [ ] Delete: `packages/server/src/middleware/*` (auth.ts moved to plugins/auth, authz.ts merged into cedar plugin).
- [ ] Delete: `packages/server/src/plugins/Plugin*.ts` (moved to modules/plugins/services).
- [ ] Delete: `packages/server/src/mcp/*` (moved to modules/agents/mcp).
- [ ] Update: `packages/server/src/__tests__/` — port any cross-module tests; delete obsolete ones.
- [ ] Verify: `npm run typecheck` clean, `npm run test` green.
- [ ] Commit: `chore(server): remove old express server`.

### Task C2: Update package.json scripts

- [ ] Bench scripts: update paths if any moved.
- [ ] Stress scripts: ensure they target the new server (port, URL).
- [ ] `dev` and `start` already point to `server.ts` (Task A17).
- [ ] Commit: `chore(server): update scripts for new layout`.

### Task C3: Documentation

- [ ] Update `packages/server/README.md` with new module layout.
- [ ] Update root `README.md` if it mentions Express.
- [ ] Update `docs/superpowers/adrs/` — write `ADR-007-fastify-migration.md`.
- [ ] Commit: `docs: fastify migration ADR + README updates`.

### Task C4: Performance & stress acceptance

- [ ] Run `npm run bench:pull` and `bench:push`. Record numbers.
- [ ] Run `npm run stress:yjs:converge`, `:reconnect`, `:rate`. Record results.
- [ ] If any bench regresses >20%, investigate; otherwise record and proceed.
- [ ] Commit results to `docs/superpowers/plans/2026-05-07-fastify-migration-results.md`.

### Task C5: OpenAPI snapshot

- [ ] Generate openapi.json from new server. Save to `packages/server/openapi.snapshot.json`.
- [ ] Add CI check: build → dump openapi → diff against snapshot.
- [ ] Commit: `feat(server): openapi snapshot + drift check`.

---

## Phase D — Sign-off

- [ ] Full `npm run test` green.
- [ ] `npm run typecheck` green for all packages (client must still build against any shared types).
- [ ] `npm run lint` green.
- [ ] `npm run build` green for all workspaces.
- [ ] Manual: start server, hit `/docs`, exercise core flows (signup, create note, sync via WS).
- [ ] Open PR to merge `feat/fastify-migration` → `main`.

---

## Self-review notes

- Spec §1–§10 fully covered: §1 (goals) → A1+entire plan; §2 (modules) → B1–B7; §3 (folder layout) → A2; §4 (cross-cutting) → A3–A15; §5 (Yjs) → B5; §6 (lifecycle) → A16–A17; §7 (testing) → embedded in each task; §8 (migration plan) → Phase A/B/C/D mapping; §9 (risks) → mitigations baked into ordering (Phase A smoke route, Phase B sequential collab, Phase C bench gate); §10 (locked decisions) → reflected in tech stack and ordering.
- No placeholders. Each task names exact files and exact actions.
- Type/method consistency: `fastify.auth.requireUser`, `fastify.notes.getUserNotesDir`, `fastify.knowledge.indexNote`, `fastify.collab.getDoc/broadcast`, `fastify.cedar.check` — used consistently across tasks.
