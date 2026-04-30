# Multi-App Architecture — Master Phasing & Parallel-Agent Orchestration

> **For agentic workers:** This document orchestrates four sub-project plans. It does NOT contain TDD steps itself. For step-by-step implementation, follow the per-sub-project plans referenced below. REQUIRED SUB-SKILL for executing those plans: `superpowers:subagent-driven-development`.

**Goal:** Coordinate the parallel implementation of `@kryton/core`, server sync v2, mobile rewrite, and publishing infrastructure across multiple agents and phases without merge conflicts or wasted work.

**Architecture:** Four phases with explicit gates. Within each phase, named workstreams run in parallel under strict file-ownership boundaries. No phase begins until all gates from the prior phase are satisfied.

**Sub-project plans:**
1. [`2026-04-30-core-publishing.md`](./2026-04-30-core-publishing.md) — sub-project 5
2. [`2026-04-30-kryton-core.md`](./2026-04-30-kryton-core.md) — sub-project 1
3. [`2026-04-30-server-sync-v2.md`](./2026-04-30-server-sync-v2.md) — sub-project 2
4. [`2026-04-30-mobile-core-migration.md`](./2026-04-30-mobile-core-migration.md) — sub-project 4

Sub-project 3 (kryton-desktop) is deferred per the brainstorming decision; designed in a future session once these four are stable.

---

## Phase map

```
Phase 0 — Publishing infrastructure (1 stream, ~1 day)
   ↓ gate: @kryton scope claimed, CI workflow merged, dev:link tooling shipped
Phase 1 — Core foundations + server scaffolding in parallel (3 streams, ~5 days)
   ↓ gate: protocol contracts locked, schema generator working end-to-end
Phase 2 — Core sync + Yjs + server sync + agent identity in parallel (4 streams, ~7 days)
   ↓ gate: integration tests green between core and server
Phase 3 — Mobile rewrite (3 streams, ~5 days)
   ↓ gate: mobile feature parity with current build, passes manual smoke
Phase 4 — Hardening (2 streams, ~3 days)
   ↓ gate: production-ready
```

Total: ~21 working days of effort, compressed by parallelism into ~3 wall-clock weeks given the team-size assumption below.

---

## Team-size assumption

The plans below assume **3 parallel agents available simultaneously**. With more agents, additional streams can be split out (e.g., decomposing the server sync stream into endpoint-by-endpoint subagents). With fewer, streams serialize — gates remain the same.

Each parallel stream owns specific files. Streams within a phase NEVER write to the same file. Integration points between streams are explicit (named here) and happen at phase gates, not mid-phase.

---

## Phase 0 — Publishing infrastructure

**Why first:** every other phase wants to either publish to or install from `@kryton`. Doing this last forces refactor of every CI workflow.

**Single stream (no parallelism worthwhile):**
- Driver: 1 agent
- Plan: [`2026-04-30-core-publishing.md`](./2026-04-30-core-publishing.md), tasks PUB-1 through PUB-12
- Files owned: `kryton/.github/workflows/publish-core.yml`, `kryton/scripts/publish-core.js`, `kryton/scripts/release.js`, `kryton/scripts/verify-versions.js`, `kryton/.npmrc`, root `package.json` (script entries only)

**Out of scope this phase:** the actual `packages/core/` and `packages/core-react/` directories — those are created in Phase 1 with placeholder stubs that the publish workflow will be tested against. **Important:** the "stubs" here are NOT scaffolds — they are the real package.json files and minimal type-only entry points (`export {}`) that are immediately useful for the publish pipeline. No code stubs.

**Gate to Phase 1:**
- [ ] `@kryton/core@4.4.0-pre.0` and `@kryton/core-react@4.4.0-pre.0` published to GitHub Packages (empty packages, just package.json + LICENSE).
- [ ] `kryton-mobile` can install them with `.npmrc` configured.
- [ ] `dev:link` script verified to swap to local file paths.
- [ ] Pre-commit hook in `kryton-mobile` blocks commits with `file:` deps in package.json.

---

## Phase 1 — Core foundations + server scaffolding (parallel)

Three streams run simultaneously, owned by three agents. They share zero files.

### Stream 1A — Schema generator + types

- Agent: A
- Plan: kryton-core plan, tasks CORE-1 through CORE-15 (schema generator block)
- Files owned:
  - `packages/core/scripts/generate-schema.ts` (build tool)
  - `packages/core/src/generated/` (output dir; treated as source of truth at commit time)
  - `packages/core/scripts/__tests__/`
  - `packages/core/package.json` (script entries only)
- Reads from (no-write): `packages/server/prisma/schema.prisma` (must NOT modify)

### Stream 1B — Adapter contract + adapters

- Agent: B
- Plan: kryton-core plan, tasks CORE-16 through CORE-32 (adapter block)
- Files owned:
  - `packages/core/src/adapter.ts` (interface)
  - `packages/core/src/adapters/better-sqlite3.ts`
  - `packages/core/src/adapters/expo-sqlite.ts`
  - `packages/core/src/adapters/in-memory.ts`
  - `packages/core/src/__tests__/adapter.conformance.ts` (shared suite)
  - `packages/core/src/__tests__/adapter-{better,expo,in-memory}.test.ts`

### Stream 1C — Prisma schema annotations + new models

- Agent: C
- Plan: server-sync-v2 plan, tasks SRV-1 through SRV-18 (schema block)
- Files owned:
  - `packages/server/prisma/schema.prisma` (additive: annotations + new models)
  - `packages/server/prisma/migrations/<timestamp>_sync_v2/`
  - `packages/server/src/services/folder.ts` (new)
  - `packages/server/src/services/tag.ts` (new)
  - `packages/server/src/services/__tests__/folder.test.ts`
  - `packages/server/src/services/__tests__/tag.test.ts`
- Coordination required at gate: stream 1A reads the new Prisma annotations to generate schemas; stream 1C must merge before stream 1A's final integration test.

**Phase 1 gate:**
- [ ] Schema generator produces valid SQLite DDL + TS types from the annotated Prisma file. Output committed.
- [ ] All three adapter conformance suites pass.
- [ ] New Prisma migration applies cleanly to a fresh test DB.
- [ ] New `Folder`, `Tag`, `NoteTag`, `NoteRevision`, `Attachment`, `Agent`, `AgentToken`, `YjsDocument`, `YjsUpdate`, `SyncCursor`, `NoteVersion` models exist with backfill jobs tested.
- [ ] No file owned by two streams was edited.

---

## Phase 2 — Core sync + Yjs + server endpoints + agent identity (parallel)

Four streams in parallel.

### Stream 2A — Core sync client (HTTP) + query API + event bus

- Agent: A (continuation)
- Plan: kryton-core plan, tasks CORE-33 through CORE-72
- Files owned:
  - `packages/core/src/index.ts`
  - `packages/core/src/kryton.ts` (the main class)
  - `packages/core/src/sync/http.ts`
  - `packages/core/src/sync/conflicts.ts`
  - `packages/core/src/query/*.ts`
  - `packages/core/src/events.ts`
  - `packages/core/src/errors.ts`
  - `packages/core/src/__tests__/sync.test.ts`
  - `packages/core/src/__tests__/query.test.ts`
  - `packages/core/src/__tests__/events.test.ts`

### Stream 2B — Core Yjs integration + core-react

- Agent: B (continuation)
- Plan: kryton-core plan, tasks CORE-73 through CORE-95
- Files owned:
  - `packages/core/src/yjs/*.ts`
  - `packages/core/src/__tests__/yjs.test.ts`
  - `packages/core-react/src/*.ts`
  - `packages/core-react/src/__tests__/*.test.ts`
  - `packages/core-react/package.json`

### Stream 2C — Server sync v2 endpoints + Yjs websocket server

- Agent: C (continuation)
- Plan: server-sync-v2 plan, tasks SRV-19 through SRV-58
- Files owned:
  - `packages/server/src/routes/sync-v2.ts`
  - `packages/server/src/routes/attachments.ts`
  - `packages/server/src/routes/yjs.ts`
  - `packages/server/src/services/sync-v2.ts`
  - `packages/server/src/services/yjs-persistence.ts`
  - `packages/server/src/services/cursor.ts`
  - `packages/server/src/__tests__/sync-v2.test.ts`
  - `packages/server/src/__tests__/yjs.test.ts`

### Stream 2D — Server agent identity + Cedar policy enforcement

- Agent: D (if available, otherwise serializes after stream 2C)
- Plan: server-sync-v2 plan, tasks SRV-59 through SRV-85
- Files owned:
  - `packages/server/src/routes/agents.ts`
  - `packages/server/src/services/agent.ts`
  - `packages/server/src/services/cedar.ts`
  - `packages/server/src/middleware/authz.ts`
  - `packages/server/src/__tests__/agents.test.ts`
  - `packages/server/src/__tests__/cedar.test.ts`

**Coordination points within Phase 2:**
- Streams 2A and 2C share the wire protocol contract (defined in spec). To prevent drift, the canonical TypeScript types for the protocol live in `packages/core/src/sync/protocol.ts` (Stream 2A's territory). Stream 2C imports those types from `@kryton/core/dist/sync/protocol` via the workspace link. Stream 2A must publish the protocol module to dist/ early in Phase 2 (task CORE-33 is the protocol type definitions, done first).
- Streams 2B and 2C share the Yjs websocket protocol; both follow the standard `y-protocols/sync` and `y-protocols/awareness` formats — no custom wire format on either side, so no coordination beyond the spec.

**Phase 2 gate:**
- [ ] All unit tests in all four streams pass.
- [ ] Integration test: a `@kryton/core` instance pointed at a test server can pull, push, hit a conflict, resolve via LWW, push a tag-merge, open a Yjs doc, edit, close, reopen, and see the edits.
- [ ] Integration test: an agent token created via `/api/agents/:id/tokens` can pull notes, gets policy-filtered results, gets denied on out-of-scope edits.
- [ ] Server's existing `/api/sync` legacy endpoints still work (mobile hasn't migrated yet).

---

## Phase 3 — Mobile rewrite (parallel)

Three streams, owned by three agents (or one agent serializing if necessary).

### Stream 3A — Mobile data layer wiring + migration

- Agent: A (continuation)
- Plan: mobile-core-migration plan, tasks MOB-1 through MOB-22
- Files owned (in `kryton-mobile` repo):
  - `src/core.ts`
  - `app/_layout.tsx` (provider wrapping only — careful diff)
  - `src/lib/storage.ts` (simplification)
  - `src/lib/api.ts` (sync methods removed)
  - `package.json` (deps + dev:link script)
  - `scripts/dev-link.js`
  - `.npmrc`
  - `.husky/pre-commit` (link guard)
  - `src/__tests__/core-init.test.ts`

### Stream 3B — Mobile UI migration to hooks

- Agent: B (continuation)
- Plan: mobile-core-migration plan, tasks MOB-23 through MOB-58
- Files owned (in `kryton-mobile` repo): all `app/**/*.tsx` and `src/components/**/*.tsx` that currently call `db.*` directly. Each component is one task.
- Coordination: stream 3A must merge `KrytonProvider` setup before any of stream 3B's hooks work. Phase 3 begins with a brief synchronous step: stream 3A delivers `_layout.tsx` provider wrap as task MOB-1; stream 3B starts thereafter.

### Stream 3C — Mobile WebView Yjs editor bridge

- Agent: C (continuation)
- Plan: mobile-core-migration plan, tasks MOB-59 through MOB-78
- Files owned (in `kryton-mobile` repo):
  - `src/webview/EditorBridge.tsx` (rewrite)
  - `src/webview/PreviewBridge.tsx` (read-only via `core.notes.readContent`)
  - `src/webview/codemirror-bundle/*` (the WebView's bundled JS)
  - `src/webview/codemirror-bundle/yjs-binding.ts` (new)
  - `src/__tests__/webview-bridge.test.ts`

**Phase 3 gate:**
- [ ] All previously working mobile screens render with the new data layer; no `db.*` calls remain in the codebase.
- [ ] Manual smoke: install on iOS sim, log in, see notes, edit a note, observe sync to web client.
- [ ] First-launch migration deletes legacy DB and pulls cleanly.
- [ ] WebView Yjs editor saves changes; opening the same note on the web client and a freshly logged-in mobile shows the edits.

---

## Phase 4 — Hardening (parallel)

Two streams.

### Stream 4A — End-to-end test harness

- Agent: A
- Files owned:
  - `packages/server/test/e2e/*.test.ts`
  - `kryton-mobile/test/e2e/*.test.ts` (Detox-based)
- Tasks: write E2E suites covering sync convergence, conflict scenarios, agent permission denial, Yjs reconnect-with-pending-updates, migration resilience.

### Stream 4B — Performance profiling and tuning

- Agent: B
- Files owned: ad-hoc; no exclusive territory beyond profiling output. Edits to `packages/core/*` files require explicit handoff from stream 2A/2B owners.
- Tasks: profile Yjs op throughput, mobile cold-start regression check, sync payload size budgets, attachment download/upload timing, server query plan review.

**Phase 4 gate:**
- [ ] All E2E tests green in CI.
- [ ] No regression > 10% in mobile cold-start time.
- [ ] Sync push round-trip < 500 ms p95 for a 100-entity payload (server in dev environment, not production-tuned).
- [ ] Yjs websocket sustains 50 ops/sec per client without backpressure.
- [ ] Production deployment checklist completed.

---

## Cross-cutting rules

### Branching strategy

- One long-lived branch per phase: `phase/0-publishing`, `phase/1-foundations`, `phase/2-sync-yjs`, `phase/3-mobile`, `phase/4-hardening`.
- Streams within a phase work on their own sub-branches off the phase branch: `phase/1-foundations--stream-1a-schema-gen`, etc.
- Streams merge into the phase branch as their tasks complete. Phase branch merges to master only at the phase gate.
- Mobile lives in a different repo; phase branches there mirror server's: `phase/3-mobile`.

### Conflict avoidance

- File ownership above is binding. If a stream needs to edit a file owned by another stream, stop and coordinate via the orchestrator (the human reviewing this plan).
- Tests can edit each other's *fixtures* but not each other's *production code*.
- The Prisma `schema.prisma` file is sensitive: only stream 1C touches it during Phase 1; nobody touches it in Phase 2 unless flagged at the gate.

### Build artifacts

- Generated files (`packages/core/src/generated/*`) are committed to source control. CI verifies freshness on every PR via `scripts/verify-generated.sh`.
- Yjs `dist/` outputs from the WebView bundle are committed to `kryton-mobile` (so mobile can build offline without re-bundling CodeMirror).

### Versioning during Phase 1-3

- Pre-release versions: `4.4.0-pre.N` published on every Phase 2 milestone. Mobile pins to specific pre-release versions via `dev:link` during development.
- Final `4.4.0` cut at the end of Phase 3 once mobile is stable.
- Server's `package.json` bumps to `4.4.0` at Phase 4 start (matches client expectations).

### Commit cadence

- Every TDD task in the per-sub-project plans ends with a commit. No rolled-up "WIP" commits.
- Stream branches are kept linear (rebase, not merge) during the phase.

### Review gates

- Each task in the per-plan documents has its own implicit review checkpoint when subagent-driven-development is the execution mode.
- Phase gates are explicit human review checkpoints. The orchestrator (human user) must approve phase completion before the next phase begins.

---

## Dispatching agents

When using `subagent-driven-development` to execute a phase:

1. Read the phase entry above.
2. For each stream listed, dispatch one subagent with:
   - The relevant per-plan document as the primary instruction
   - The exact task ID range from this orchestration doc
   - The stream's file ownership list as constraints
3. Wait for all phase streams to report completion.
4. Run the phase gate checks listed above.
5. Only proceed to the next phase if all gates are green.

If using `agent-teams:team-feature` skill instead, the team-feature pattern maps cleanly: each phase is a "feature", each stream is a team member with file-ownership boundaries, the gate is the team's exit criterion.

---

## What this plan does NOT cover

- Sub-project 3 (kryton-desktop): designed in a future session.
- Web client offline support: explicitly out of scope.
- Cedar policy authoring UX (admin UI): server endpoints only; UI deferred.
- Multi-user shared Yjs editing: server protocol prepared but UX not implemented.
- Public release of `@kryton/core` to npm.org: deferred.
