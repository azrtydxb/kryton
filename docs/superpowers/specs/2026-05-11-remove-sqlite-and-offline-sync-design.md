# Remove SQLite + Offline Sync (keep collab) Design

**Date**: 2026-05-11
**Status**: Implemented (2026-05-11)
**Prerequisite**: [Postgres + Drizzle Migration](2026-05-11-postgres-drizzle-migration-design.md) merged to master first.

## Problem

Kryton's architecture is split between two storage models:

1. **Server-side, authoritative** — Postgres (just migrated from Prisma+SQLite in PR #109). This is the source of truth.
2. **Client-side, offline-first** — `@azrtydxb/core` ships SQLite adapters (`better-sqlite3` for desktop, `expo-sqlite` for mobile, in-memory for web) plus a sync-v2 protocol (deltas + cursors + deletions) that keeps clients in step with the server when they reconnect.

The offline-first second layer is heavy: it requires a SQLite adapter per platform, a multi-package adapter abstraction (`@azrtydxb/core`), an editor state machine that can replay edits when the network returns, and a server-side sync protocol (`modules/sync/` + `SyncDeletion`/`SyncCursor` tables). Multiple specs and plans depend on it (`server-sync-v2-design.md`, `kryton-desktop-*`, `mobile-core-migration-design.md`, `editor-state-core.md`, `editor-yjs-binding.md`).

**Decision**: mobile and desktop will be online-only. Real-time collab via Yjs WebSocket stays (multi-user editing remains a first-class feature). Offline support, SQLite adapters, the `@azrtydxb/core` abstraction stack, and the sync-v2 protocol all go.

## What stays vs what goes

### Stays (untouched)

- **Yjs real-time collab.** WebSocket-driven CRDT for multi-user simultaneous editing. `modules/collab/ws/*`, `YjsDocument`, `YjsUpdate` tables — all remain.
- **Server-side note storage.** Filesystem of markdown files + `SearchIndex` mirror — unchanged.
- **Note sharing.** Access-grant model (NoteShare, AccessRequest). Sharees see the shared note via the API in real time *if and only if* they have an open WebSocket connection (i.e., collab is active). Async background visibility goes; live shared editing remains.
- **All auth, MCP agents, search (tsvector), graph (GraphEdge), versions, attachments, tags, folders, trash, plugins.** No change.
- **Postgres + Drizzle + pgvector.** Unchanged.

### Goes (deleted)

**Server** — sync v2 lives inside `modules/collab/`, not a separate `modules/sync/` (confirmed via audit). Surgical removal inside the collab module:

- `packages/server/src/modules/collab/routes/sync.routes.ts`
- `packages/server/src/modules/collab/services/sync.service.ts`
- `packages/server/src/modules/collab/services/sync-handlers.service.ts`
- `packages/server/src/modules/collab/schemas/sync.schemas.ts`
- Sync-related entries in `packages/server/src/modules/collab/index.ts` (the `/api/sync/v2/*` route registration, the `SyncService` instantiation, the `notesRoot` parameter wiring)
- Sync schema tables: `SyncDeletion`, `SyncCursor` (drizzle migration drops both)
- Sync-specific tests under `modules/collab/__tests__/`
- Sync entries from the OpenAPI snapshot
- Sync types from `packages/sdk/src/types.gen.ts` (regenerated automatically)

**What stays in `modules/collab/`**:
- `routes/shares.routes.ts`, `services/share.service.ts`, `schemas/share.schemas.ts` — sharing
- `ws/persistence.ts`, `ws/yjs.handler.ts`, `schemas/yjs.schemas.ts` — Yjs WebSocket collab
- The `CollabApi` decorator (`app.collab`) and its `getDoc`/`broadcast`/`hasAccess` surface

Also: `modules/collab/index.ts:38` has a stale comment saying "flushes all dirty Y.Docs to SQLite" — should now read "Postgres" (Phase-5 migration drift). Fix as part of this work.

**Core (`packages/core/`)**:

- `src/adapters/better-sqlite3.ts` + tests
- `src/adapters/expo-sqlite.ts` + tests
- `src/adapters/in-memory.ts` + tests
- `src/adapter.ts` — the storage adapter interface
- `src/storage.ts` — the storage abstraction
- `src/bootstrap.ts` — the core wiring entry point
- `src/kryton.ts` — the `Kryton` class wrapping storage + Yjs + sync
- `src/__tests__/adapter-conformance.ts` — adapter conformance test suite
- `src/yjs/storage.ts`, `src/yjs/manager.ts`, `src/yjs/read-content.ts` — Yjs client-side storage helpers (Yjs collab itself lives in the editor + server, not in core)
- The `Kryton` class's whole sync orchestration

  **What's left of `@azrtydxb/core`?** Only generated types (`src/generated/{schema.sql,types.ts,entities.ts}`) and the query helpers (`src/query/*`). These have no remaining client (server doesn't depend on core; mobile/desktop will hit the API directly via the SDK). Options:

  - **Delete the whole package.** Move `query/*` graph-edge helpers into the server (they only operate on server data anyway).
  - **Shrink to type-only re-exports.** Keep as a versioned type contract for client SDKs.

  Recommendation: **delete entirely.** Server can absorb the graph helpers; clients use the auto-generated SDK at `packages/sdk/`. Decision deferred until the implementation plan, after auditing what `core-react` and `ui` actually import.

**Core consumers (`packages/core-react/`, `packages/ui/`)** — audit findings:

- **`packages/ui/`**: declares `@azrtydxb/core` and `@azrtydxb/core-react` in `package.json` but has **zero actual imports** of either (audited via `grep -rn @azrtydxb/core packages/ui/src` — empty). These are stale dependency entries left over from earlier architecture. Easy cleanup — just remove the two `package.json` entries.
- **`packages/core-react/`** is the only real `core` consumer: imports the `Kryton` class + hooks from `@azrtydxb/core`. With core deleted, `core-react` has nothing to wrap → also deleted. Audit confirms `ui` is the only consumer of `core-react`, and removing the `ui` dep entry handles that.
- **`packages/client/` is independent.** Already uses `@azrtydxb/sdk` (auto-generated from OpenAPI) via `createKrytonClient` in `packages/client/src/lib/kryton-client.ts`. Zero `@azrtydxb/core` imports. Nothing to migrate.

**Pre-flight audit completed** — no blockers for core deletion:

1. **Editor Yjs binding** lives at `packages/ui/src/editor/state/yjsBinding.ts` and imports `yjs` directly (verified `import * as Y from "yjs"`). Zero `@azrtydxb/core` involvement. The binding wires a `Y.Text` to the local `EditorState` via an observer — completely independent of the `Kryton` class. Awareness handling lives next door at `editor/state/awareness.ts`, same pattern.

2. **Data adapter chain**: `KrytonDataAdapter` is defined at `packages/ui/src/data/types.ts` (NOT in core). The React context provider sits at `packages/ui/src/data/KrytonDataProvider.tsx`. The web client implements it in `packages/client/src/data/HttpAdapter.ts`. Zero core involvement.

3. **`core-react` is the sole real consumer of `core`.** Once both are deleted in lockstep, nothing in `client` or `ui` is broken.

Conclusion: Phase 2 can delete `core` and `core-react` together with no replacement wiring required. The 4 `@azrtydxb/core*` package.json entries (2 in `ui`, 2 in `core-react`'s own internals) are the only cleanup needed.

**Web client (`packages/client/`)**:

- Any sync-status UI ("syncing…" indicators, offline pills, conflict resolution dialogs)
- Any client-side sync state-machine code (likely none — the web client is online-only today)
- The editor's local-storage offline buffer, if any

**Mobile / desktop**:

- The kryton-mobile and kryton-desktop repos (separate from this monorepo) are unaffected by this change — they don't exist yet. The specs that planned them on a local-first model are retired (see below). New specs will plan them as online-only API consumers.

**Specs / plans retired** (move to `docs/superpowers/specs/archived/`):

- `2026-04-30-server-sync-v2-design.md`
- `2026-04-30-mobile-core-migration-design.md`
- `2026-04-30-kryton-core-design.md`
- `2026-04-30-kryton-desktop-core-design.md`
- `2026-04-30-kryton-desktop-complete-design.md`
- `2026-04-30-webview-codemirror-bundle-design.md`
- `2026-05-08-editor-cross-platform.md`
- `2026-05-08-editor-state-core.md`
- `2026-05-08-editor-yjs-binding.md` — wait: this is the *editor* binding for Yjs collab. Collab stays. Keep this one or revise.
- `2026-05-08-editor-native-ios-view.md`, `2026-05-08-editor-native-android-view.md`, `2026-05-08-editor-web-view.md`, `2026-05-08-editor-plugin-migration.md` — editor cross-platform plans, all assumed offline-first. Revisit when mobile/desktop are spec'd.
- `2026-05-08-graph-cross-platform-renderer.md` — graph view planned as a cross-platform renderer for local rendering. Keep — graph rendering happens in the client regardless of offline-vs-online.

Plus all the corresponding plans in `docs/superpowers/plans/`.

**Dependencies removed**:

- `better-sqlite3`, `@types/better-sqlite3` from `core` package
- `expo-sqlite` (was a peer dep)
- Any sync-protocol deps

## Design

### Schema changes

```diff
- packages/server/src/db/schema/sync.ts
+ packages/server/src/db/schema/collab.ts   # contains only YjsDocument, YjsUpdate
```

Drop tables:
- `SyncDeletion`
- `SyncCursor`

Keep tables (rename file but not tables themselves):
- `YjsDocument` (Yjs collab state)
- `YjsUpdate` (Yjs incremental updates)

drizzle-kit produces a migration `0001_drop_sync_tables.sql` that does:

```sql
DROP TABLE "SyncCursor";
DROP TABLE "SyncDeletion";
```

The migration is forward-only — no rollback (consistent with the big-bang style of the Postgres migration).

### Server changes

- Edit `modules/collab/index.ts` to remove sync v2: drop the `SyncService` import + instantiation, drop the `/api/sync/v2` route registration, drop the `notesRoot` parameter. Also fix the stale "SQLite" comment to "Postgres."
- Delete `modules/collab/routes/sync.routes.ts`, `services/sync.service.ts`, `services/sync-handlers.service.ts`, `schemas/sync.schemas.ts`.
- Delete any `modules/collab/__tests__/sync*.test.ts`.
- Regenerate `packages/server/openapi.snapshot.json` — sync routes gone, OpenAPI surface shrinks. CI's `openapi:check` will fail until regenerated.
- Regenerate `packages/sdk/src/types.gen.ts` (auto from OpenAPI) — removes sync types.
- Generate a drizzle migration that drops `SyncDeletion` + `SyncCursor` tables. Update `packages/server/src/db/schema/sync.ts` → rename to `collab.ts`, keep only `YjsDocument` + `YjsUpdate`. Update the `schema/index.ts` re-exports.

### Client changes

- Audit `packages/client/src/` for sync/offline UI. Remove.
- Editor: keep the Yjs binding for collab. Remove any local-storage offline buffer.
- Status bar / header indicators: remove "syncing…", "offline", "X pending changes" pills if they exist.

### Core deletion

If we go with "delete the whole package":

- `git rm -r packages/core packages/core-react`
- Remove from root `package.json` workspaces if listed individually
- Audit `packages/ui/` for `@azrtydxb/core` imports — replace with whatever's appropriate (likely `@azrtydxb/sdk` types or local re-implementation)
- Move `packages/core/src/query/graph-edges.ts` → `packages/server/src/modules/knowledge/services/graph-edges.ts` if it's actually used server-side (Phase 5.5 already migrated `GraphEdge` queries in `services/graph.service.ts`; double-check whether `query/graph-edges.ts` is dead code or live).

### Test strategy

- Server: delete sync tests. Delete bytea round-trip tests **wait — those are for collab Yjs, stay**. Re-confirm during implementation.
- Core: delete the whole package, so all of its tests go.
- Client: delete sync-UI tests if they exist; collab tests stay.

Baseline target after this change: roughly **80 server tests** (current 83 minus the ~3 sync tests). Collab + bytea tests remain.

### CI / Docker / docs

- CI: remove any sync-specific steps (probably none today).
- Docker: nothing changes — the Postgres image already serves both sync and non-sync deployments.
- Docs: update `README.md` to remove any "offline-first" or "sync" language. Replace with "online-only client, real-time collab via WebSocket."

## Phasing

**Three sequenced phases**, each in its own branch + PR.

### Phase 1 — Server-side sync v2 removal (inside collab module)

Smallest blast radius, easiest to verify in isolation:

- Edit `modules/collab/index.ts` to drop sync v2 registrations (keep sharing + Yjs)
- Delete `modules/collab/routes/sync.routes.ts`, `services/sync.service.ts`, `services/sync-handlers.service.ts`, `schemas/sync.schemas.ts`
- Delete sync-specific tests in `modules/collab/__tests__/`
- Drop `SyncDeletion`, `SyncCursor` tables (drizzle migration `0001_drop_sync_tables.sql`)
- Rename `db/schema/sync.ts` → `db/schema/collab.ts` (keep only YjsDocument + YjsUpdate); update re-exports
- Regenerate OpenAPI snapshot + SDK types
- Fix the stale "SQLite" comment in `collab/index.ts`
- Run tests; baseline target ~79-81 (current 83 minus 2-4 sync tests)
- Commit, PR, merge

### Phase 2 — `@azrtydxb/core` + `@azrtydxb/core-react` deletion

Audit done in this spec; concrete plan:

- Pre-flight audit was completed during spec authoring — no replacement wiring needed. Editor Yjs binding (`packages/ui/src/editor/state/yjsBinding.ts`) and the data adapter chain (`KrytonDataAdapter` interface + `KrytonDataProvider`) live in `ui` and `client` only, with zero core dependencies.
- Drop `@azrtydxb/core` + `@azrtydxb/core-react` from `packages/ui/package.json` (stale entries, no imports)
- `git rm -r packages/core packages/core-react`
- Remove from root `package.json` workspaces if listed explicitly
- Remove all peer-deps + transitive deps that came with core (`better-sqlite3`, `@types/better-sqlite3`, `expo-sqlite`, `yjs` if it's only in core)
- Update build / test / typecheck root commands (the workspace patterns will auto-handle, but root scripts may iterate explicit packages)
- Run full repo tests
- Verify CI passes
- Commit, PR, merge

### Phase 3 — Specs / plans retirement + docs cleanup

Documentation-only:

- Move retired specs to `docs/superpowers/specs/archived/`
- Move corresponding plans to `docs/superpowers/plans/archived/`
- Update `README.md`, `docs/install/manual.md`, anywhere "offline" or "sync" is mentioned
- Commit, PR, merge

## Decisions / Open Questions

1. **Real-time visibility on shares without offline cache.** Today, opening a shared note shows the latest content because the sharer might be editing it via Yjs. With offline gone, this still works (the WebSocket fetches the current Yjs state on connect). No change.

2. **First-load latency.** Today, the web client (if it had sync) could open a cached note instantly while fetching updates in the background. After removal, every note open is a network round-trip. Acceptable trade given the simplification.

3. **`core` deletion vs shrink.** Recommended deletion. Final call deferred to the audit in Phase 2.

4. **Web service workers / PWA cache.** Out of scope. If the web client had a service worker for offline page caching, that's separate from data sync — it can stay.

5. **Plugin offline storage.** Plugins store data in `PluginStorage` server-side (already Postgres). No client-side plugin storage was planned. Confirmed nothing to remove here.

## Out of scope

- Mobile / desktop client implementations themselves (separate repos, future work)
- Re-architecting the offline-first specs into online-only specs (future work; archive the originals for now)
- Service worker / PWA changes
- Auth / MCP / search changes
- Anything in the Postgres + Drizzle migration PR (#109)

## Acceptance Criteria

After all three phases land:

- `grep -rin "sqlite\\|better-sqlite\\|expo-sqlite" --include="*.ts" --include="*.json" packages` returns 0 (excluding `node_modules`, lockfiles)
- `grep -rn "modules/sync" packages/server/src` returns 0
- `packages/core/` and `packages/core-react/` no longer exist
- All tests pass on master
- `docker compose up` brings up a working stack (sign up → log in → create note → edit collaboratively → search → graph)
- The PR-#109 acceptance criteria (no Prisma, no MiniSearch) still hold
- Docs / specs reflect the online-only architecture

---

## Implementation Notes

Landed in three commits on `worktree-feat-remove-sqlite-and-sync`:

- **Phase 1 — `1e7160a`**: `refactor(server): remove sync v2 + drop sync tables + cursor columns`. Stripped the entire `/api/sync/v2/*` surface from the server, dropped the `SyncCursor` / `SyncDeletion` tables and the `version` / `updatedCursor` columns from every tier-1 entity, and removed the cursor-increment infrastructure. Scope ended up larger than this design originally anticipated because the cursor columns leaked into nearly every write path; cleaning them out was a single coherent change rather than the staged removal the spec sketched.
- **Phase 2 — `f384bbd`**: `refactor: delete @azrtydxb/core + @azrtydxb/core-react (phase 2/3)`. Deleted both packages, removed them from the workspace, and cleaned out remaining references in `packages/ui/`.
- **Phase 3 (this commit set)**: Stale SQLite-era bench scripts deleted (`bench/tier2-history.ts`, `bench/pull-throughput.ts`, `bench/push-throughput.ts`, plus the dead sync-v2 seed helpers in `bench-utils.ts`); offline-first specs and plans moved to `docs/superpowers/{specs,plans}/archived/` (keeping the Yjs binding and graph cross-platform renderer specs in place); root `README.md` rewritten for the online-only architecture; `docs/perf/README.md` marked historical (its numbers reflect the deleted SQLite + sync v2 stack — a fresh Postgres baseline is a follow-up); spec marked Implemented.

### Follow-ups

- **`set-state-in-effect` lint errors (13 across 11 files).** Surfaced when the workspace's `eslint-plugin-react-hooks` was upgraded during this work; they were pre-existing in master once the plugin became strict enough to flag them. To keep this PR scoped to the SQLite + sync removal, the plugin is pinned to `7.0.1` (matching master) via `ed0f398`. Bumping the plugin and fixing the 13 occurrences should be a separate PR.
- **Fresh Postgres perf baseline** to replace the archived SQLite numbers in `docs/perf/README.md`.
