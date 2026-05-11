# Fastify Migration & Server Re-Architecture — Design

**Status**: Implemented

- **Date:** 2026-05-07
- **Status:** Approved (design phase)
- **Scope:** `packages/server` only. `core`, `core-react`, `ui`, `client` not touched beyond keeping them building.
- **Pre-production:** No live users. Breaking changes acceptable.

## 1. Goals

Replace Express 5 with Fastify and restructure the server into a vertical-feature-module layout that fully exploits Fastify's plugin model.

### Success criteria

1. Single Fastify process serves HTTP + WebSocket (Yjs) + MCP.
2. Each of the 7 modules is a self-contained Fastify plugin with its own routes, services, schemas, repos, and tests. No cross-module imports except via shared `@azrtydxb/core` package or via decorated services on the Fastify instance.
3. All HTTP I/O validated by Zod schemas; OpenAPI 3.1 spec generated automatically from the same schemas (`swagger-jsdoc` removed).
4. Shared services (Prisma, Better Auth, config, logger, Yjs doc store, Cedar, MCP) exposed via `app.decorate()`, typed via module augmentation.
5. Pino logging with request-scoped context; OpenTelemetry hooks preserved.
6. `app.inject()` covers route tests; existing Yjs convergence/stress tests preserved.
7. Old Express server deleted at merge — no dual-stack period.

### Explicit non-goals

- No DB engine change. Prisma 7 + better-sqlite3 stays.
- No Better Auth replacement. Mounted as a Fastify plugin via catch-all.
- No client API contract changes beyond what is forced by validation tightening. Client-side updates are out of scope.
- No new features.
- No `core` / `ui` / `core-react` refactors beyond what is required to keep them building.
- Sync v1 routes and code: **deleted**. v2 is the only sync.

## 2. Module Decomposition

Seven vertical feature modules. Each registers as a Fastify plugin with its own URL prefix and is fully encapsulated.

| Module      | Owns                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------ |
| `identity`  | auth (Better Auth integration), users, api-keys, authz helpers (Cedar)                     |
| `notes`     | notes, folders, daily, templates, tags, trash, attachments, backlinks, history, canvas     |
| `knowledge` | graph, search                                                                              |
| `collab`    | shares, sync (v2 only), Yjs WebSocket + persistence                                        |
| `agents`    | agents, MCP server, Cedar agent identity                                                   |
| `plugins`   | plugin registry, plugin storage                                                            |
| `platform`  | admin, settings, version, health, OpenAPI viewer                                           |

### Encapsulation rule

Modules MUST NOT import from sibling modules' `services/` or `repos/`. Cross-module needs go through:

- A decorated service on the root Fastify instance (e.g. `fastify.auth.requireUser()`), or
- The shared `@azrtydxb/core` package for domain types/utilities, or
- A module's published HTTP/WS contract (rare; usually means the boundary is wrong).

### File-size discipline

If any single file in `routes/` or `services/` exceeds ~250 lines, split by sub-feature. The current 535-line `index.ts` is the antipattern we are replacing.

## 3. Folder Layout

```
packages/server/src/
  app.ts                  # buildApp() — composes plugins, returns FastifyInstance
  server.ts               # entrypoint: load config, build app, listen, graceful shutdown
  config/
    env.ts                # zod-validated env schema
    index.ts              # typed config object
  plugins/                # framework-level plugins (cross-cutting)
    zod.ts                # fastify-type-provider-zod setup (must register first)
    telemetry.ts          # OpenTelemetry hooks
    security.ts           # @fastify/helmet + @fastify/cors
    rate-limit.ts         # @fastify/rate-limit defaults
    prisma.ts             # decorates fastify.prisma
    cedar.ts              # decorates fastify.cedar
    auth.ts               # Better Auth integration; decorates fastify.auth
    errors.ts             # setErrorHandler + AppError hierarchy
    multipart.ts          # @fastify/multipart for uploads
    websocket.ts          # @fastify/websocket registration
    openapi.ts            # @fastify/swagger + swagger-ui registration
  modules/
    identity/
      index.ts            # Fastify plugin entrypoint
      routes/
      services/
      schemas/            # zod schemas; domain types via z.infer
      repos/              # Prisma query helpers (only when non-trivial)
      __tests__/
    notes/        ...
    knowledge/    ...
    collab/       ...
    agents/       ...
    plugins/      ...
    platform/     ...
  lib/                    # tiny pure utilities only — no business logic, no state
  __tests__/              # cross-module integration tests only
```

### Plugin registration order in `buildApp`

```
plugins/zod              # first — sets type provider
plugins/telemetry        # early — wraps everything
plugins/security
plugins/rate-limit
plugins/prisma
plugins/cedar
plugins/auth             # depends on prisma
plugins/errors
plugins/multipart
plugins/websocket
plugins/openapi          # before routes for spec collection
modules/*                # registered with prefix; each is encapsulated
```

`lib/` is for pure utilities only. Anything stateful must be a Fastify plugin.

## 4. Cross-Cutting Concerns

### 4.1 Validation & Types

- Zod 4 throughout. Every route declares `schema: { body, querystring, params, response }` using Zod schemas.
- Type provider: `fastify-type-provider-zod`. Handlers get fully-typed `request.body` etc. — no manual `z.infer` in handlers.
- Response validation enabled in dev/test, disabled in prod. Mismatched responses fail tests; never reach users.
- Schemas live in `modules/<m>/schemas/`. Schemas are the source of truth — domain types derived via `z.infer`, not declared separately.

### 4.2 OpenAPI

- `@fastify/swagger` collects route schemas → emits OpenAPI 3.1 at `/docs/openapi.json`.
- `@fastify/swagger-ui` serves interactive docs at `/docs`.
- Zod → JSON Schema via the Zod type provider's serializer.
- `swagger-jsdoc` and all hand-written swagger annotations are deleted.

### 4.3 Error Handling

Single `AppError` hierarchy in `plugins/errors.ts`:

- `AppError` (base) → `ValidationError`, `AuthError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `RateLimitError`, `InternalError`.
- Each carries `statusCode`, machine-readable `code`, optional `details`.

`setErrorHandler` maps:

| Source                                    | Response                            |
| ----------------------------------------- | ----------------------------------- |
| `ZodError`                                | 400 with field-level details        |
| `AppError`                                | its `statusCode` + structured body  |
| `Prisma.PrismaClientKnownRequestError`    | mapped (e.g. P2002 → 409)           |
| anything else                             | 500, logged with stack, opaque body |

Wire format: `{ error: { code, message, details? } }`. Single shape across the API.

### 4.4 Logging & Telemetry

- Pino as Fastify's logger. Structured JSON in prod, pretty in dev.
- Per-request log context: `requestId`, `userId` (when auth resolved), `route`. Available as `request.log` in handlers.
- `plugins/telemetry.ts` wires `onRequest` / `onResponse` / `onError` hooks to the existing OpenTelemetry SDK. Spans cover HTTP routes, Prisma queries (via Prisma OTel), Yjs ops.
- Sensitive fields (passwords, tokens, secrets) redacted via Pino `redact` config.

### 4.5 Security & Limits

- `@fastify/helmet` — sane defaults; tightened CSP for `/docs` only.
- `@fastify/cors` — allowlist from config.
- `@fastify/rate-limit` — global default + per-route overrides; identity routes (login, signup, password reset) get tighter limits.
- `@fastify/multipart` — replaces multer; size/MIME limits enforced via plugin config.

### 4.6 Authentication & Authorization

- Better Auth mounted via catch-all in `plugins/auth.ts`: `app.all('/api/auth/*', betterAuth.handler)`. Same plugin decorates `fastify.auth` with helpers (`requireUser`, `requireSession`, `getOptionalUser`).
- Protected routes opt in via per-route `preHandler` calling `fastify.auth.requireUser(request)`. Public routes need no annotation.
- Cedar authorization in `plugins/cedar.ts`: decorates `fastify.cedar.check({ principal, action, resource })`. Module services call it for resource-level checks.
- API keys (existing PAT/MCP flow) handled inside the `identity` module; resolves to a synthetic session that flows through `fastify.auth` and Cedar paths.

### 4.7 Configuration

- `config/env.ts` — single Zod schema for all env vars. App fails fast at startup if invalid.
- `config/index.ts` — exports a frozen, typed config object. Modules read from `fastify.config` (decorator), never `process.env` directly.
- Secrets never logged. Test config from `.env.test`.

### 4.8 Database Access

- One Prisma client, decorated as `fastify.prisma`.
- Services receive Prisma via decorator, not module-level imports.
- Repositories optional — introduced only when a module has non-trivial cross-table queries or query reuse (likely: notes, search, graph, history). Trivial CRUD calls Prisma directly inside services.
- Prisma OTel integration enabled. Slow query log threshold configurable.

## 5. Realtime (Yjs) Module Detail

```
modules/collab/
  index.ts              # registers HTTP routes + WS plugin under same module
  routes/
    shares.routes.ts    # share CRUD (HTTP)
    sync.routes.ts      # snapshot fetch/push, doc list (HTTP)
  ws/
    yjs.handler.ts      # @fastify/websocket route handler
    doc-registry.ts     # in-memory map: docId → { ydoc, clients, persistence }
    awareness.ts        # awareness protocol wrapping
  services/
    share.service.ts
    sync.service.ts     # snapshot/push semantics
    yjs-persistence.service.ts  # Y.Doc ↔ SQLite bridge
  schemas/
  __tests__/            # convergence + reconnect-storm + rate-ceiling tests
```

### WebSocket lifecycle

1. Client connects to `/ws/yjs/:docId` with auth token (cookie or `Sec-WebSocket-Protocol`).
2. `preValidation` hook resolves session via `fastify.auth`; reject if unauthorized.
3. `preHandler` runs Cedar check `{ principal: user, action: "sync", resource: doc }`; reject if forbidden.
4. Handler looks up or creates the `DocEntry` in `doc-registry`. First connection for a doc loads state from `yjs-persistence.service`; subsequent connections attach to the live `Y.Doc`.
5. Bidirectional Yjs sync; awareness messages broadcast to peers.
6. Persistence: debounced writeback to SQLite (config-driven, e.g. 2 s idle / 30 s max). Runs out-of-band on a worker queue inside the module so the client message loop never blocks on disk.
7. On last client disconnect, doc is held in memory for a grace period (e.g. 60 s) then evicted after final flush.

### Decorator surface

- `fastify.collab.getDoc(docId)` — for HTTP routes that need a snapshot.
- `fastify.collab.broadcast(docId, msg)` — cross-channel notifications (rare; e.g. share revoked → kick clients).

### Failure model

- Persistence write failure → log + retry with exponential backoff; clients keep syncing in-memory.
- Repeated failure beyond threshold → mark doc read-only, push protocol error to clients, alert via telemetry.
- Process shutdown → graceful: stop accepting new connections, flush all dirty docs, close.

`@azrtydxb/core` continues to own Yjs protocol primitives and the storage adapter interface. The server module *consumes* core; it does not re-implement protocol logic.

## 6. Application Lifecycle

`server.ts` (entrypoint):

1. Load + validate env (Zod) → typed config.
2. Initialize OTel SDK (must precede Prisma + Fastify).
3. `buildApp(config)` → `FastifyInstance`.
4. `app.listen({ host, port })`.
5. Register signal handlers (SIGINT, SIGTERM):
   - Stop accepting new connections (HTTP + WS).
   - Drain in-flight requests with timeout.
   - Flush Yjs dirty docs.
   - Close Prisma.
   - Exit.

`buildApp(config)` is pure and deterministic — same config in, equivalent app out. Tests use it via `app.inject()`. No top-level side effects in any module file.

### Health endpoints (`platform` module)

- `/healthz` — liveness; 200 if process is up.
- `/readyz` — readiness; checks Prisma, Yjs registry, MCP transport. 503 with reason if any dep is down.
- `/version` — build SHA, package version, schema version.

## 7. Testing Strategy

- **Unit tests** (services, repos, pure utils): vitest, no Fastify, fast.
- **Route tests:** `app.inject()` against an app built with `config-test`. In-memory SQLite (Prisma + `:memory:` better-sqlite3) seeded per test. No HTTP listener.
- **WS / Yjs tests:** real listener on ephemeral port, real `ws` clients. Existing `scripts/yjs-stress/` ported to run against the Fastify app — same scenarios, same assertions.
- **Contract tests:** OpenAPI spec dumped and compared against checked-in snapshot. Spec drift fails CI; intentional changes update the snapshot.
- **Coverage gate:** keep current vitest config + thresholds. Migration must not regress coverage.

## 8. Migration Plan (high level)

Detailed phases, file ownership, and parallel-agent decomposition go in the implementation plan doc.

### Phase A — Foundation (sequential, blocks everything)

- Add Fastify + plugin deps; remove Express, `express-rate-limit`, helmet (Express version), multer, `swagger-jsdoc`, `swagger-ui-express`.
- Build `app.ts`, `server.ts`, `config/`, all framework `plugins/*`.
- Decorators wired: `prisma`, `auth` (Better Auth), `cedar`, `config`.
- One trivial smoke route end-to-end (`platform/version`) to prove the spine.

### Phase B — Module ports (parallel, file-ownership-bounded)

Each module is one parallel work stream. Owner: an implementer agent. Files owned: `modules/<m>/**` only. Integration via Fastify decorators only — no shared-file edits across modules during this phase.

Streams:

- `identity` (depends on auth plugin from A)
- `notes` (largest; subdivided across two agents along route boundaries)
- `knowledge`
- `collab` (most complex; sequential within module: shares routes → sync routes → ws handler)
- `agents`
- `plugins`
- `platform`

### Phase C — Cleanup

- Delete old Express server files (`auth.ts`, `swagger.ts`, all old `routes/*.ts`, `services/*.ts` that have been moved, `index.ts`).
- Delete sync v1 code paths.
- Run `bench:*` and `stress:yjs:*` against the new server; record numbers in the plan doc as acceptance evidence.
- Update `README.md` and `CONTRIBUTING.md`.

### Phase D — Sign-off

- Full test suite green, OpenAPI snapshot stable, perf within agreed bands of the old Express version (or better).
- Merge to `main`.

## 9. Risks & Mitigations

| Risk                                                              | Mitigation                                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Better Auth Fastify integration is rougher than expected          | Catch-all mount via Web/Node handler is well-supported; prove this in Phase A on the smoke spine    |
| Prisma + Fastify + Pino + OTel composition has subtle conflicts   | Build Phase A end-to-end (with one real route) before any module work begins                        |
| Yjs persistence handoff regresses convergence under load          | Port `stress:yjs:*` early in collab module work; gate Phase D on stress-test parity                 |
| `notes` module too big for one agent                              | Pre-split into two ownership zones along route boundaries before Phase B                            |
| Hidden coupling between `routes/*` and `services/*` in old code   | Phase A produces a coupling map; surfaces forced cross-module imports before they become integration pain |

## 10. Decisions Locked by This Spec

| Decision                                  | Choice                                                  |
| ----------------------------------------- | ------------------------------------------------------- |
| Migration scope                           | Full architectural restructure                          |
| Yjs sync topology                         | Same process, separate plugin (`collab` module)         |
| Module organization                       | Vertical feature modules                                |
| DI strategy                               | Fastify decorators                                      |
| Migration approach                        | Big-bang on a feature branch                            |
| Live status                               | Pre-production — break freely                           |
| Sync v1                                   | Deleted                                                 |
| Validation library                        | Zod 4 via `fastify-type-provider-zod`                   |
| OpenAPI                                   | `@fastify/swagger` schema-driven; swagger-jsdoc removed |
| Logger                                    | Pino                                                    |
| Auth integration                          | Better Auth via catch-all mount                         |
| Module count                              | 7 (identity, notes, knowledge, collab, agents, plugins, platform) |
| Repository layer                          | Optional per-module (only when non-trivial)             |
