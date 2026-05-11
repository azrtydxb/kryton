# Kryton Tunnel Client + Admin UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tunnel module to Kryton's existing repo so the server dials `tunnel.kryton.ai`, holds a persistent yamux session, and pipes inbound public traffic into Fastify via loopback HTTP. Add a "Tunnel" tab to the existing AdminPage.

**Architecture:** New module `packages/server/src/modules/tunnel/` registered alongside existing modules. `TunnelClient` singleton (state machine, reconnect loop), `LoopbackInjector` (per-request TCP splice to `127.0.0.1:<port>`), `TunnelStats` (counters + daily aggregates). New tab `TunnelTab.tsx` next to PluginsTab. Five admin REST endpoints under `/api/admin/tunnel/*`.

**Tech Stack:** Existing Kryton stack — Node 24+, TypeScript 5.9, Fastify 5, Drizzle 0.45+, Postgres, React 19, Vite 8, Zod, Vitest. New deps: `@chainsafe/libp2p-yamux` (or fallback in-repo impl).

**Reference:** [Spec 4c](../specs/2026-05-12-kryton-tunnel-client-design.md); [Umbrella](../specs/2026-05-12-reverse-tunnel-architecture-design.md).

**Conventions:**
- TDD where logic branches (state machine, sanity checks, stats math).
- Pragmatic integration tests for I/O boundaries (yamux ↔ h2, loopback splice).
- Frequent commits. Match existing module conventions (vertical Fastify plugins).

---

## Phase 1 — Module scaffolding + Settings + DB

### Task 1: Module skeleton

**Files:** `packages/server/src/modules/tunnel/index.ts`, `packages/server/src/app.ts` (modify), `packages/server/src/modules/tunnel/__tests__/smoke.test.ts`.

- [ ] Create `tunnelModule: FastifyPluginAsync` that registers no routes yet but logs "tunnel module loaded" at INFO.
- [ ] Wire into `app.ts` alongside the other modules.
- [ ] Smoke test: app boots with tunnel module loaded; no errors.
- [ ] Commit `feat(tunnel): module skeleton`.

### Task 2: Drizzle schema for `tunnel_traffic_daily`

**Files:** `packages/server/src/db/schema/tunnel.ts`, `packages/server/src/db/schema.ts` (add export), `packages/server/drizzle/<next>_tunnel_traffic_daily.sql` (drizzle-kit generate).

- [ ] Drizzle table per spec §1.5: `day date PK, requests bigint, bytes_in bigint, bytes_out bigint, updated_at timestamp`.
- [ ] Run `drizzle-kit generate` to emit migration.
- [ ] Verify migration applies cleanly via testcontainer Postgres.
- [ ] Commit.

### Task 3: TunnelStateRepo (settings-backed)

**Files:** `packages/server/src/modules/tunnel/services/tunnel-state.service.ts`, plus test.

- [ ] Methods backed by existing `Settings` table:
  - `getJwt(): Promise<string|null>` / `setJwt(jwt: string): Promise<void>` / `clearJwt(): Promise<void>`
  - `getInstanceId(): Promise<string>` — read or generate UUID once and persist as `tunnel.instance_id`
  - `getCachedClaims(): Promise<TunnelClaims|null>` — reads `tunnel.jti`, `tunnel.subdomain`, `tunnel.exp` and assembles
  - `setCachedClaims(claims): Promise<void>` — persists each piece
  - `setLastConnectedAt(when)` / `setLastError(err)`
- [ ] Tests against testcontainer Postgres.

---

## Phase 2 — JWT sanity helpers

### Task 4: Local JWT decoder + sanity check

**Files:** `packages/server/src/modules/tunnel/utils/jwt.ts`, plus unit test.

- [ ] `decodeJwtUnverified(token): {header, payload, signature}` — pure b64url decode + JSON parse.
- [ ] `sanityCheck(token): {ok: true, claims} | {ok: false, code: 'jwt_malformed'|'jwt_wrong_alg'|'jwt_wrong_issuer'|'jwt_expired'|'jwt_missing_claim'|'jwt_invalid_subdomain', message}` — matches spec §4.3.
- [ ] TDD each failure path.

### Task 5: TunnelClaims + zod schema

**Files:** `packages/server/src/modules/tunnel/types.ts`.

- [ ] Export `TunnelClaims` interface mirroring umbrella §5.1 JWT payload.
- [ ] `TunnelStatusSchema` z.discriminatedUnion mirroring spec §2.7 / §4.2.

---

## Phase 3 — TunnelClient state machine + reconnect

### Task 6: State machine skeleton

**Files:** `packages/server/src/modules/tunnel/services/tunnel-client.service.ts`, plus tests.

- [ ] `TunnelClient` class with `state: 'idle'|'connecting'|'open'|'backoff'|'fatal'|'closing'`, `start(jwt)`, `stop({timeoutMs})`, `restart(jwt)`, `getStatus()`, and a typed event emitter for `state-change`.
- [ ] TDD: initial state idle; `start` → connecting; `stop` → idle.

### Task 7: yamux library spike + decision

- [ ] Try `@chainsafe/libp2p-yamux` against a test hashicorp/yamux Go server (spin one up in a test). Interoperability test: open stream, send/receive bytes, close. If interop fails, implement minimal yamux protocol in-repo (~500 LOC) against the documented spec.
- [ ] Commit decision + rationale in a `docs/yamux-decision.md`.

### Task 8: connectOnce — full handshake

**Files:** `services/tunnel-client.service.ts` continued, integration test using `node:http2.createServer`.

- [ ] Implement `connectOnce(jwt, signal)` per spec §2.3: h2 connect, CONNECT request with auth + version + instance-id headers, await 200, wrap CONNECT body in yamux server role, register inbound-stream callback.
- [ ] Custom error classes: `TunnelHandshakeError{status, xReason}`.
- [ ] Integration test against a fake h2 server that accepts CONNECT and runs yamux client.

### Task 9: connectLoop with backoff

- [ ] Loop per spec §2.4: try connect, on success wait until close, on close go to backoff; on fatal `xReason` set state fatal and break; otherwise exp backoff `1s, 2s, 4s, ..., cap 60s, ±20% jitter`.
- [ ] TDD with a fake server that closes after N seconds, asserts backoff timing using a fake clock.

### Task 10: h2 PING heartbeat

- [ ] Use `session.ping()` every 5s; close session after 3 missed.
- [ ] Test: stop responding to pings on fake server, assert client closes within 15s and reconnects.

---

## Phase 4 — LoopbackInjector

### Task 11: Injector with bidirectional splice

**Files:** `services/loopback-injector.service.ts`, plus test.

- [ ] `LoopbackInjector.handle(yamuxStream)`: net.connect to `127.0.0.1:<port>`, bidirectional `pipe` + cleanup hooks on either-side end/error.
- [ ] TDD with paired Duplex + tcp server echoing the request.

### Task 12: ECONNREFUSED handling

- [ ] When dial fails, destroy yamux stream with the error (so tunnel server returns 502 to public client).
- [ ] Test verifies stream destroy was called.

### Task 13: Boot-time race gating

**Files:** `tunnel/index.ts` (modify).

- [ ] In the plugin, defer `tunnelClient.start()` until `app.ready()` AND `app.server.once('listening')`. Capture port via `server.address()`, pass to `loopback.setLocalPort()`.

### Task 14: trustProxy additive merge

**Files:** `packages/server/src/app.ts` (or wherever Fastify is constructed).

- [ ] On Fastify construction, ensure `trustProxy` includes `127.0.0.1/8` and `::1/128`. If already a list, append. If a boolean, override to the array.
- [ ] Integration test: send request through loopback with `X-Forwarded-For: 1.2.3.4` and assert `request.ip === '1.2.3.4'` in a probe route.

---

## Phase 5 — Stats service

### Task 15: In-memory counters + daily flush

**Files:** `services/tunnel-stats.service.ts`, plus test.

- [ ] `TunnelStats.onRequest(bytesIn, bytesOut)` updates atomically.
- [ ] Daily flush timer (60s) UPSERTs to `tunnel_traffic_daily` keyed on `day = current UTC date`.
- [ ] Day rollover at midnight UTC: counters reset, today's row updated.
- [ ] `getStats(window: '24h'|'7d'|'30d')` returns `{window, requests, bytes_in, bytes_out, daily[], since}` per spec §4.2.

### Task 16: Wire stats into request lifecycle

- [ ] Wrap the loopback injector's request pipe with byte counters so totals flow into TunnelStats.

---

## Phase 6 — Admin REST endpoints

### Task 17: requireAdmin middleware

**Files:** `services/auth.ts` or reuse existing.

- [ ] Verify there's an existing `requireAdmin` decorator; if not, add one mirroring `adminUsersRoutes` pattern.

### Task 18: GET /api/admin/tunnel/status

**Files:** `routes/admin-tunnel.routes.ts`, schema in `schemas/admin-tunnel.schemas.ts`.

- [ ] Route reads `app.tunnelClient.getStatus()` and returns shaped JSON.

### Task 19: POST /api/admin/tunnel/token

- [ ] Body validated against `setTokenSchema`. Server-side sanity check via `sanityCheck`. On fail → 400 with the error code. On pass → `tunnelState.setJwt(...)`, `tunnelState.setCachedClaims(...)`, `tunnelClient.restart(token)`. Returns updated status.

### Task 20: DELETE /api/admin/tunnel/token

- [ ] `tunnelClient.stop({timeoutMs: 5000})`, `tunnelState.clearJwt()`.

### Task 21: GET /api/admin/tunnel/stats

- [ ] Returns `TunnelStats.getStats(window)`.

### Task 22: POST /api/admin/tunnel/reconnect

- [ ] If state is `fatal` or `backoff`, call `tunnelClient.restart(jwt)` with the current jwt. If `open`/`connecting`, no-op. 202 always.

### Task 23: Audit log writes

- [ ] Wire each state-mutating endpoint and each TunnelClient state change to the existing Kryton audit-log mechanism with codes per spec §4.5.

---

## Phase 7 — TunnelTab UI

### Task 24: Add `tunnel` to the Tab enum + tabs array

**Files:** `packages/client/src/pages/AdminPage.tsx` (modify).

- [ ] Type: `type Tab = 'users' | 'invites' | 'settings' | 'plugins' | 'tunnel'`.
- [ ] Add `{ key: 'tunnel', label: 'Tunnel', icon: Globe }` to `TABS`.
- [ ] Add `{tab === 'tunnel' && <TunnelTab />}` next to the existing renders.
- [ ] Import `Globe` from lucide-react.
- [ ] Smoke test renders.

### Task 25: TunnelTab.tsx — base layout + polling

**Files:** `packages/client/src/pages/TunnelTab.tsx`, plus test.

- [ ] Functional component. Polls `GET /api/admin/tunnel/status` every 2s (transient) or 5s (open). Pauses when tab is not active (parent guards with `{tab === 'tunnel' && ...}`).
- [ ] Layout: Section "Status" + Section "Tunnel token" + Section "Traffic" + Section "Setup help". Uses Section/Field from settings-kit.

### Task 26: Status badge variants

- [ ] Render each `TunnelStatus.state` variant with the copy from spec §5.2. Color + dot + label + tooltip with full reason. Wrapped in `aria-live="polite"`.

### Task 27: Token paste modal

- [ ] `<dialog>` with textarea, client-side sanity check mirroring server-side, Save disabled until checks pass. On submit, POST `/api/admin/tunnel/token`. On 400 surface server error.

### Task 28: Replace / Clear / Try-again buttons

- [ ] `[ Replace token ]` opens paste modal. `[ Clear token ]` confirm dialog → DELETE. `[ Try again ]` (visible in fatal/backoff) → POST `/reconnect`.

### Task 29: Traffic section with window pill + sparkline

- [ ] Window pill group switches between 24h/7d/30d, re-fetches stats. CSS bars sparkline (no chart lib).

### Task 30: Manage subscription deep-link

- [ ] Footer link `Manage subscription on kryton.ai ↗` opens new tab to `https://kryton.ai/tunnels/dashboard`.

---

## Phase 8 — Testing + polish

### Task 31: Integration: end-to-end loopback through Fastify

**Files:** `__tests__/integration/end-to-end-loopback.test.ts`.

- [ ] Spin up real Fastify with a tiny `/ping` route + tunnel module + a fake h2-server in-process. Wire a fake yamux stream pointing at `/ping`. Assert response body matches Fastify's output.

### Task 32: Integration: WebSocket through tunnel

- [ ] Same harness but `/echo` route using `@fastify/websocket`. Send 10 frames, get 10 back.

### Task 33: Integration: revocation drops connection

- [ ] Fake server sends GoAway with x-reason; assert state → `fatal:revoked-jwt`, no reconnect within 30s.

### Task 34: Integration: reconnect after disconnect

- [ ] Fake server closes session; assert backoff fires correctly, then reconnect succeeds.

### Task 35: UI tests for each TunnelTab state

**Files:** `packages/client/src/__tests__/TunnelTab.test.tsx`.

- [ ] One test per state variant; assert correct labels/buttons rendered.

---

## Phase 9 — Docs + CI

### Task 36: CLAUDE.md / README updates

- [ ] Brief section in repo README pointing to `docs/superpowers/specs/2026-05-12-kryton-tunnel-client-design.md`.
- [ ] If applicable, note in the operations docs how to test the tunnel locally (fake tunnel server + paste a JWT).

### Task 37: CI verification

- [ ] Confirm `pnpm test` passes (or whatever the repo uses). Confirm `pnpm typecheck` passes. Confirm CI green.

---

## Self-review

- **Spec coverage:** §1 module structure + boot (Phase 1, 4). §2 tunnel client (Phase 3). §3 loopback (Phase 4). §4 admin REST (Phase 6). §5 TunnelTab UI (Phase 7). §6 testing (Phase 8 + tests throughout). §7 open items (deferred to plan as appropriate).
- **Type consistency:** `TunnelStatus` discriminated union defined in `types.ts` (Phase 2 Task 5) and referenced consistently in `getStatus()`, in admin routes, and in TunnelTab props.
- **Placeholders:** none.
