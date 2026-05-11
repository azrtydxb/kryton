# `@azrtydxb/core` and `@azrtydxb/core-react` — Design Spec

**Status:** Approved for implementation planning.
**Sub-project:** 1 of 5 in the multi-app architecture.
**Related specs:**
- `2026-04-30-server-sync-v2-design.md` (server contract this depends on)
- `2026-04-30-mobile-core-migration-design.md` (first consumer)
- `2026-04-30-core-publishing-design.md` (distribution)
- Desktop spec (sub-project 3) — to be designed later, also a consumer.

## Purpose

A platform-agnostic, offline-first data layer for Kryton clients. Mobile and desktop both consume it; the server's web client (`packages/client`) does not (stays online-only).

Provides:
- Local SQLite storage with a schema generated from the server's Prisma source of truth.
- Bidirectional sync to the server: relational entities via versioned LWW table-bucketed deltas; note bodies via Yjs.
- A typed CRUD API + change event bus.
- Tier 1 (always synced) and tier 2 (lazy, fetch-and-cache) entity classes.

## Packages

Two npm packages published from the kryton monorepo:

| Package | Path in monorepo | Depends on |
|---|---|---|
| `@azrtydxb/core` | `packages/core/` | yjs, y-protocols, ws (peer) |
| `@azrtydxb/core-react` | `packages/core-react/` | `@azrtydxb/core`, react (peer) |

Adapter sub-modules ship as deep imports so consumers only pull what they need:
- `@azrtydxb/core/adapters/expo-sqlite` (depends on `expo-sqlite` peer)
- `@azrtydxb/core/adapters/better-sqlite3` (depends on `better-sqlite3` peer)

## `@azrtydxb/core` — Public API

### Initialization

```ts
import { Kryton } from "@azrtydxb/core";
import { ExpoSqliteAdapter } from "@azrtydxb/core/adapters/expo-sqlite";

const core = await Kryton.init({
  adapter: new ExpoSqliteAdapter("kryton.db"),
  serverUrl: "https://kryton.example.com",
  authToken: () => secureStorage.getToken(),
  agentToken: () => null, // optional, see agent identity
});

await core.sync.pull();
```

`Kryton.init()` opens the DB, runs the bundled migrations, validates server compatibility (semver against `serverUrl/api/version`), and returns the singleton.

### Query API

Per-entity namespaces with a uniform shape:

```ts
core.notes.findById(id: string): Note | null
core.notes.findByPath(path: string): Note | null
core.notes.list(filter: NoteFilter): Note[]
core.notes.create(input: NoteCreateInput): Note
core.notes.update(id: string, patch: Partial<Note>): Note
core.notes.delete(id: string): void

core.folders.* / core.tags.* / core.settings.* / core.noteShares.* / ...
```

All methods are synchronous (sync-only adapter contract). Writes go directly to local SQLite, set `_local_status = 'created' | 'updated' | 'deleted'`, increment `_local_seq`, and emit a change event. Sync push converts these to the wire format.

### Yjs documents

Note bodies are Yjs documents, not plain text columns. The `notes` table stores metadata only; content lives in `yjs_documents`.

```ts
const yDoc = await core.notes.openDocument(noteId);
// yDoc is a real Y.Doc. Mutate via the standard Yjs API.
const yText = yDoc.getText("body");
yText.insert(0, "hello");
// Edits are applied locally, persisted to yjs_documents on idle, and
// pushed via the open websocket if connected.

await core.notes.closeDocument(noteId); // releases the websocket subscription
```

A document opened by `openDocument` stays connected until `closeDocument`. Multiple call sites can open the same doc; core ref-counts and only opens one websocket per doc.

For read-only access (search indexing, exports), `core.notes.readContent(noteId): string` returns the current text snapshot without opening a websocket.

### Tier 2 access

Tier 2 entities are exposed via separate namespaces with explicit fetch semantics:

```ts
core.history.list(noteId: string): NoteRevision[] // returns cached, fires fetch in background if stale
core.history.fetch(noteId: string): Promise<NoteRevision[]> // forces refetch
core.attachments.fetch(attachmentId: string): Promise<Blob>
core.pluginData.get(pluginId: string, key: string): unknown | null
```

TTLs (configurable via `Kryton.init({ tier2: { history: { ttlMs: 3600_000 } } })`):
- history: 1 hour
- attachments: until evicted (LRU cap 200 MB by default)
- pluginData: 5 minutes

Stale data is returned immediately; a background fetch updates the cache and emits a change event.

### Event bus

```ts
core.on("change", (event: { entityType: string; ids: string[]; source: "local" | "sync" | "yjs" }) => { ... });
core.on("sync:start" | "sync:complete" | "sync:error", handler);
core.on("yjs:connect" | "yjs:disconnect", handler);
```

Used internally by `@azrtydxb/core-react`; consumers can also subscribe directly.

### Sync orchestration

```ts
await core.sync.pull(): Promise<{ entitiesChanged: number }>
await core.sync.push(): Promise<{ pushed: number; conflicts: Conflict[] }>
await core.sync.full(): Promise<void> // pull then push
core.sync.startAuto({ intervalMs: 60_000 }) // periodic background sync when online
core.sync.stopAuto()
```

Pull and push are idempotent and safe to call concurrently (mutex-serialized internally).

## Schema generation

A build-time script (`packages/core/scripts/generate-schema.ts`) reads `packages/server/prisma/schema.prisma` and emits:

- `packages/core/src/generated/schema.sql` — SQLite DDL
- `packages/core/src/generated/types.ts` — TS interfaces, branded ID types
- `packages/core/src/generated/entities.ts` — entity metadata (tier, parent relationships, syncable field list)

### Annotation syntax

Server's Prisma file gains triple-slash annotations:

```prisma
/// @sync tier1
/// @sync.fields exclude=passwordHash,internalNotes
model Settings {
  id        String   @id @default(cuid())
  userId    String
  key       String
  value     String
  updatedAt DateTime @updatedAt
}

/// @sync tier2 parent=Note
model NoteRevision {
  id        String   @id @default(cuid())
  noteId    String
  content   String
  createdAt DateTime
}
```

Models with no `@sync` annotation are server-only (User, Session, Passkey, ApiKey, etc.) and never appear in core's schema.

### Type mapping

| Prisma | SQLite | TS |
|---|---|---|
| `String` | `TEXT NOT NULL` | `string` |
| `String?` | `TEXT` | `string \| null` |
| `Int` | `INTEGER NOT NULL` | `number` |
| `Boolean` | `INTEGER NOT NULL` (0/1) | `boolean` |
| `DateTime` | `INTEGER NOT NULL` (epoch ms) | `number` |
| `Json` | `TEXT NOT NULL` (stringified) | `unknown` |
| `String[]` | `TEXT NOT NULL` (JSON-stringified) | `string[]` |

### Entity inventory (initial cut, refined during implementation)

**Tier 1** (always synced):
- `Note` (synthetic — not a Prisma model; sourced from `SearchIndex` + filesystem on server, see server spec)
- `Settings`
- `GraphEdge`
- `NoteShare`
- `TrashItem`
- `InstalledPlugin` (small per-user list)
- `Folder` (synthetic — currently inferred from filesystem; needs server-side promotion to a real entity, see server spec)
- `Tag` (synthetic — currently denormalized into Note.tags JSON; promoted to a relation, see server spec)

**Tier 2** (lazy):
- `NoteRevision` (parent: Note) — to be added to Prisma
- `AccessRequest` (parent: NoteShare)
- `PluginStorage` (parent: InstalledPlugin)
- `Attachment` (parent: Note) — to be added to Prisma

**Server-only** (never in core):
- `User`, `Session`, `Account`, `Verification`, `Passkey`, `TwoFactor`, `ApiKey`, `InviteCode`, `SearchIndex`, `SyncDeletion`

## Local schema details

Every tier 1 table includes:

```sql
_local_status   TEXT NOT NULL DEFAULT 'synced'  -- 'synced' | 'created' | 'updated' | 'deleted'
_local_seq      INTEGER NOT NULL DEFAULT 0       -- monotonic per-row write counter
version         INTEGER NOT NULL DEFAULT 0       -- server-assigned version, 0 until first sync
```

Bookkeeping tables:

```sql
CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- rows: server_cursor, last_pull_at, last_push_at, schema_version, agent_token

CREATE TABLE yjs_documents (
  doc_id TEXT PRIMARY KEY,
  snapshot BLOB NOT NULL,
  state_vector BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE yjs_pending_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  update BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
-- offline edits accumulated; flushed when websocket reconnects

CREATE TABLE tier2_cache_meta (
  entity_type TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  PRIMARY KEY (entity_type, parent_id)
);
```

## Sync protocol (client side)

### Pull

1. Read `sync_state.server_cursor` (default 0).
2. POST `{cursor}` to `/api/sync/v2/pull`.
3. Response: `{changes: {tableName: {created, updated, deleted}}, cursor: nextCursor}`.
4. Apply in a transaction: `INSERT OR REPLACE` for created/updated (only if local row is `synced` — never overwrite local pending changes), `DELETE` for deleted (only if local row is `synced`).
5. Set rows to `_local_status='synced'`, `version=<from server>`.
6. Update `sync_state.server_cursor = nextCursor`.
7. Emit `change` events grouped by entity type.

### Push

1. Collect rows where `_local_status != 'synced'` per table.
2. Send `{table: [{id, base_version, fields...}, ...]}` to `/api/sync/v2/push`.
3. Server returns `{accepted: [ids], conflicts: [{id, current_version, current_state}]}`.
4. For accepted: set `_local_status='synced'`, update `version` to server's response.
5. For conflicts: emit `sync:conflict` event with conflict details. Default behavior: server state wins, local change is overwritten (LWW). Caller can override per-entity via `Kryton.init({ conflictPolicy: { notes: 'manual', tags: 'merge', ... } })`.
6. **Tag-set merge exception:** for `notes.tags`, server-side merger handles the union; client always accepts the merged result.

### Yjs

- Open: connect WS to `serverUrl/ws/yjs/:docId?token=...`. On `connect`, server sends Yjs sync step 1; client responds with sync step 2; full state vector exchange follows. Pending updates from `yjs_pending_updates` are flushed.
- During session: standard Yjs awareness + update propagation.
- Periodic snapshot: every 30s while doc is open and dirty, write current Yjs state to `yjs_documents.snapshot`.
- Disconnect: clear awareness, doc stays open in memory; new edits queue in `yjs_pending_updates`.

## Adapter contract

```ts
export interface SqliteAdapter {
  exec(sql: string): void;
  run(sql: string, params: readonly unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get<R = Row>(sql: string, params: readonly unknown[]): R | undefined;
  all<R = Row>(sql: string, params: readonly unknown[]): R[];
  transaction<T>(fn: () => T): T;
  close(): void;
}
```

Sync-only by design (see Q&A in `2026-04-30-architecture-decisions.md`). Async engines are out of scope for v1.

### Provided implementations

- `BetterSqlite3Adapter` — wraps `better-sqlite3` directly; transactions use `db.transaction()`.
- `ExpoSqliteAdapter` — wraps `expo-sqlite` sync API; transactions use `withTransactionSync`.
- `InMemoryAdapter` — `better-sqlite3` with `:memory:`; used in core's own tests.

Consumers can implement custom adapters (e.g., for a Tauri SQL plugin worker) by satisfying the interface.

## `@azrtydxb/core-react` — Public API

```tsx
<KrytonProvider core={core}>
  <App />
</KrytonProvider>
```

Hooks:

```ts
useNote(id: string): Note | null
useNoteByPath(path: string): Note | null
useNotes(filter: NoteFilter): Note[]
useFolderTree(): FolderTreeNode[]
useTags(): Tag[]
useSettings(): Settings
useYjsDoc(noteId: string): Y.Doc | null // null while loading
useSyncStatus(): { lastPullAt: number | null; lastPushAt: number | null; pending: number; online: boolean }
```

All hooks subscribe to the relevant change events via `useSyncExternalStore`. Deep equality is used for filter-based queries to avoid spurious re-renders.

Mutations remain on `core` directly (`core.notes.update(id, patch)`); hooks are read-only by design — write paths shouldn't go through React.

## Error handling

All errors thrown or emitted by core extend `KrytonError`:

- `KrytonStorageError` — adapter failure (DB locked, schema mismatch, IO error).
- `KrytonSyncError` — HTTP/network failure during sync. Includes `cause` (original error) and `retryable: boolean`.
- `KrytonConflictError` — version conflict not auto-resolved.
- `KrytonYjsError` — websocket error or Yjs protocol error.
- `KrytonAuthError` — 401/403; consumer should refresh token or re-login.

Sync errors with `retryable: true` are retried internally with exponential backoff (1s, 2s, 4s, ... capped at 5min). Non-retryable errors propagate to the caller and emit `sync:error`.

## Testing strategy

- **Unit:** every adapter passes a shared conformance suite (50+ tests covering CRUD, transactions, edge cases). Sync logic tested against a mock server (HTTP fixture replay). Yjs tested with two in-process Yjs clients.
- **Integration:** in-memory adapter + real Express test server (`packages/server` in test mode). Full pull/push/conflict scenarios.
- **Type tests:** `tsd` for the public API to catch breaking changes.

## Versioning

`@azrtydxb/core` and `@azrtydxb/core-react` versions track kryton monorepo's root version (currently `4.3.2`). Bumped together with kryton releases. Breaking schema changes require a major bump and a server-side compatibility window (server accepts both N and N-1 protocols for one minor cycle).

## Out of scope for v1

- Web client offline support (sub-project 3 future).
- Async adapters.
- Multi-user collaborative editing of *non-content* fields (folder names, tag lists). Tag merge is the only exception.
- Real-time push of tier 1 changes (push happens via sync.pull on a timer or on sync trigger; not via WS). Acceptable because tier 1 changes are rare and small.
- Attachment chunked upload — v1 assumes attachments fit in a single HTTP request (server enforces a max size, e.g., 50 MB).

## Open implementation questions

These are deferred to the implementation plan, not blocking the design:

1. Cedar policy file format for agents — single doc per agent or multi-policy bundle? (See server spec.)
2. Yjs op debounce/throttle thresholds (proposed: 100 ms client-side coalesce, 500 ms server-side flush). To be tuned during implementation.
3. Schema migration mechanism — initial install only for v1; first non-trivial migration designed when needed.
4. Cache eviction trigger — on every fetch, on idle, or on app background? Proposed: on idle + on app background.
