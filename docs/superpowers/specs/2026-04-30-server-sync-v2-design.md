# Server Sync Surface v2 — Design Spec

**Status:** Approved for implementation planning.
**Sub-project:** 2 of 5.
**Companion:** `2026-04-30-kryton-core-design.md` (defines the wire contract from the client side).

## Purpose

Expand the Kryton server to support full feature parity for offline clients (mobile, desktop). The current `/api/sync` endpoint covers four entity types via timestamp-based deltas; the new `/api/sync/v2` covers the full tier 1 / tier 2 entity set with a server-monotonic cursor, per-row versioning, conflict detection, Yjs websocket persistence, and first-class agent identity.

## Scope

This spec covers server changes only. Clients are designed in `2026-04-30-kryton-core-design.md`.

## Endpoint summary

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/version` | Returns `{ apiVersion, schemaVersion, supportedClientRange }` for compatibility checks. |
| POST | `/api/sync/v2/pull` | Pull tier 1 deltas since cursor. |
| POST | `/api/sync/v2/push` | Push tier 1 local changes; receive accept/conflict response. |
| GET | `/api/sync/v2/tier2/:entityType/:parentId` | Fetch tier 2 entities for a parent. |
| GET | `/api/attachments/:id` | Stream attachment binary. |
| POST | `/api/attachments` | Upload attachment (single-request, max 50 MB v1). |
| WS | `/ws/yjs/:docId` | Yjs websocket transport. |
| POST | `/api/agents` | Create an agent for the authenticated user. |
| GET | `/api/agents` | List the user's agents. |
| DELETE | `/api/agents/:id` | Delete an agent and revoke all tokens. |
| POST | `/api/agents/:id/policies` | Set agent's Cedar policy. |
| POST | `/api/agents/:id/tokens` | Mint a short-lived agent token. |
| POST | `/api/agents/tokens/:tokenId/revoke` | Revoke a specific token. |

The legacy `/api/sync/pull` and `/api/sync/push` are kept until mobile fully migrates, then deprecated.

## Prisma schema changes

### Annotations on existing models

```prisma
/// @sync tier1
model Settings { ... existing ... }

/// @sync tier1
model GraphEdge { ... existing ... }

/// @sync tier1
model NoteShare { ... existing ... }

/// @sync tier1
model TrashItem { ... existing ... }

/// @sync tier1
model InstalledPlugin { ... existing ... }

/// @sync tier2 parent=NoteShare
model AccessRequest { ... existing ... }

/// @sync tier2 parent=InstalledPlugin
model PluginStorage { ... existing ... }

// No annotation: User, Session, Account, Verification, Passkey, TwoFactor,
//                ApiKey, InviteCode, SearchIndex, SyncDeletion
```

### New models

```prisma
/// @sync tier1
model Folder {
  id        String   @id @default(cuid())
  userId    String
  path      String
  parentId  String?
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  parent    Folder?  @relation("FolderHierarchy", fields: [parentId], references: [id])
  children  Folder[] @relation("FolderHierarchy")
  version   Int      @default(0)
  updatedAt DateTime @updatedAt
  @@unique([userId, path])
}

/// @sync tier1
model Tag {
  id        String   @id @default(cuid())
  userId    String
  name      String
  color     String?
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  notes     NoteTag[]
  version   Int      @default(0)
  updatedAt DateTime @updatedAt
  @@unique([userId, name])
}

/// @sync tier1
model NoteTag {
  notePath String
  tagId    String
  userId   String
  tag      Tag    @relation(fields: [tagId], references: [id], onDelete: Cascade)
  user     User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  version  Int    @default(0)
  updatedAt DateTime @updatedAt
  @@id([userId, notePath, tagId])
}

/// @sync tier2 parent=Note
model NoteRevision {
  id        String   @id @default(cuid())
  userId    String
  notePath  String
  content   String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, notePath, createdAt])
}

/// @sync tier2 parent=Note
model Attachment {
  id          String   @id @default(cuid())
  userId      String
  notePath    String
  filename    String
  contentHash String   // sha256 of file bytes; client uses for cache key
  sizeBytes   Int
  mimeType    String
  storagePath String   // server-side path or S3 key
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, notePath])
  @@index([contentHash])
}

model SyncCursor {
  userId    String   @id
  cursor    BigInt   @default(0)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Agent {
  id          String         @id @default(cuid())
  ownerUserId String
  name        String
  label       String         // displayed in awareness, e.g. "Claude (analysis)"
  policyText  String?        // Cedar policy doc
  createdAt   DateTime       @default(now())
  lastSeenAt  DateTime?
  owner       User           @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)
  tokens      AgentToken[]
  @@unique([ownerUserId, name])
}

model AgentToken {
  id          String   @id @default(cuid())
  agentId     String
  tokenHash   String   // sha256 of bearer token
  scope       String?  // optional Cedar context override
  expiresAt   DateTime
  revokedAt   DateTime?
  createdAt   DateTime @default(now())
  agent       Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  @@index([tokenHash])
}

model YjsDocument {
  docId        String   @id  // currently note path; keep generic for future doc types
  userId       String
  snapshot     Bytes
  stateVector  Bytes
  updatedAt    DateTime @updatedAt
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model YjsUpdate {
  id        BigInt   @id @default(autoincrement())
  docId     String
  update    Bytes
  agentId   String?  // null for human edits, set for agent edits
  createdAt DateTime @default(now())
  @@index([docId, createdAt])
}
```

### Versioning columns on tier 1 models

Every tier 1 model gets a `version Int @default(0)` column added. Existing models migrate with the column initialized to `0`; first sync push will set it.

### Migration strategy

A single Prisma migration introduces all new models + columns. Deployed before the new sync endpoints are enabled. Existing data is unaffected; new columns default to safe values.

### Note + Folder filesystem reconciliation

Notes remain filesystem-stored. The new `Folder` and `Tag` models are server-managed metadata layered on top:

- **Folders:** on first request after deployment, the server walks each user's notes directory and creates `Folder` rows for every directory. Subsequent file operations (create note, move note, rename folder) update both filesystem and `Folder` table in a single service-layer call.
- **Tags:** existing `SearchIndex.tags` JSON is migrated into `Tag` + `NoteTag` rows by a one-time job. Going forward, note write operations parse frontmatter tags and update `NoteTag` join table atomically.

The `Note` "entity" exposed via sync is synthesized at request time from `SearchIndex` (metadata) + filesystem (content), but the protocol treats it as a row with an `id` (= notePath) and a `version` (stored in a new `NoteVersion` table keyed by `(userId, notePath)` to avoid touching every write path with a column change to filesystem-backed entities).

```prisma
model NoteVersion {
  userId    String
  notePath  String
  version   Int      @default(0)
  updatedAt DateTime @updatedAt
  @@id([userId, notePath])
}
```

## Wire protocol

### Cursor

`SyncCursor.cursor` is a per-user `BigInt` incremented atomically on every server-side change to any tier 1 entity belonging to that user. The cursor is the authoritative ordering — clients never look at timestamps.

Implementation: a Postgres sequence per user is overkill; a single `UPDATE SyncCursor SET cursor = cursor + 1 WHERE userId = ?` inside the same transaction as the entity write is sufficient. Each tier 1 row also carries a `cursor` column for delta queries:

```sql
ALTER TABLE Notes ADD COLUMN cursor INTEGER NOT NULL DEFAULT 0;
-- (and for every tier 1 model)
```

This trades a small denormalization for fast `WHERE cursor > ?` queries on pull.

**Note entity exception:** because notes are filesystem-stored and not a Prisma model, the `cursor` column for notes lives in the `NoteVersion` table (added above). The cursor is updated atomically with the note's filesystem write inside the same DB transaction. Pull queries against notes join `SearchIndex` (for metadata) with `NoteVersion` (for cursor + version) on `(userId, notePath)`.

### Pull

```http
POST /api/sync/v2/pull
Authorization: Bearer <user_or_agent_token>
Content-Type: application/json

{ "cursor": "1234567" }
```

Response:

```json
{
  "cursor": "1234890",
  "changes": {
    "notes": {
      "created": [{ "id": "...", "path": "...", "title": "...", "version": 7, ... }],
      "updated": [...],
      "deleted": ["path1", "path2"]
    },
    "folders": { ... },
    "tags": { ... },
    ...
  }
}
```

Filtered by user via auth context. Agents see only what their Cedar policy permits.

### Push

```http
POST /api/sync/v2/push
Authorization: Bearer <user_or_agent_token>
Content-Type: application/json

{
  "changes": {
    "notes": [
      { "op": "create", "id": "...", "fields": { ... } },
      { "op": "update", "id": "...", "base_version": 7, "fields": { "title": "..." } },
      { "op": "delete", "id": "..." }
    ],
    "tags": [...]
  }
}
```

Response:

```json
{
  "accepted": {
    "notes": [{ "id": "...", "version": 8 }],
    "tags": [{ "id": "...", "version": 3, "merged_value": ["urgent","review"] }]
  },
  "conflicts": [
    {
      "table": "notes",
      "id": "...",
      "current_version": 9,
      "current_state": { ... }
    }
  ]
}
```

Server-side processing:

1. For each entity in the request, look up current version.
2. If `op == 'update'` and `base_version != current.version`: append to conflicts.
3. Otherwise apply: filesystem write for notes, DB row write for others. Increment global cursor and row's cursor + version.
4. **Tag merge exception:** if entity is `Note` and `fields.tags` is included, server merges `existing_tags ∪ pushed_tags` rather than replacing; returned in `accepted.merged_value`.
5. Return per-entity result.

All processing inside a single Prisma transaction per request.

### Tier 2 fetch

```http
GET /api/sync/v2/tier2/history/<noteId>?limit=50
GET /api/sync/v2/tier2/access_requests/<noteShareId>
GET /api/sync/v2/tier2/plugin_storage/<pluginInstanceId>
```

Pagination via `?cursor=` (opaque string) for entity types that can have many children (history especially).

### Attachments

```http
POST /api/attachments
Content-Type: multipart/form-data

[file under field "file", form field notePath]
```

Response:

```json
{
  "id": "...",
  "contentHash": "sha256:abc...",
  "filename": "image.png",
  "sizeBytes": 12345,
  "mimeType": "image/png"
}
```

```http
GET /api/attachments/:id
ETag: "<contentHash>"
Cache-Control: max-age=31536000, immutable
```

Content-addressed: clients cache by `contentHash`. If they request an attachment whose hash matches a cache entry, they can skip the request.

## Yjs websocket

### Endpoint

```
WS /ws/yjs/:docId?token=<bearer>
```

**Doc id scheme:** clients identify a doc by its `notePath` (the same value as the note's `id` in core's schema). The server resolves the path against the authenticated user's notes directory and stores Yjs state under the composite key `<userId>:<notePath>` in the `YjsDocument` table — but this composite key is an internal detail; the wire-level `:docId` URL parameter is just `notePath` (URL-encoded). Multi-user shared docs (post v1) will require a doc-id scheme that doesn't bake user identity into the storage key; deferred.

### Connection lifecycle

1. **Upgrade:** server validates token (user or agent). For agents, evaluates Cedar policy: agent must have `edit` permission on the doc. On failure, 4001 close code with reason.
2. **Sync:** server sends Yjs sync step 1 from current `YjsDocument.snapshot`. Client responds with sync step 2 (any local updates not in server's state vector). Server applies and broadcasts to other connected clients on the same doc.
3. **Steady state:** Yjs awareness messages relay between connected clients; updates are appended to `YjsUpdate` log immediately (durability) and applied to in-memory doc.
4. **Snapshot compaction:** every 100 updates OR every 60s while doc is dirty, server compacts the update log into a fresh `snapshot + state_vector` write to `YjsDocument`, then deletes compacted entries from `YjsUpdate`.
5. **Disconnect:** awareness state for that connection cleared; broadcast to other clients. If no clients remain, server keeps the in-memory doc for 5 minutes (warm cache) then evicts.

### Op rate limits

- Per-connection: 50 updates/sec sustained, burst 200. Excess returns close code 4029 with a backoff hint.
- Per-doc total: 200 updates/sec from all clients combined. Excess connections receive a "slow down" awareness message; further excess closes the connection.

These are starting numbers; instrumentation in production will refine.

### Agent edits in Yjs

Agent Yjs writes pass through the same WS endpoint. The agent token resolves to an `agentId`; updates from that connection are stamped with `agentId` in `YjsUpdate.agentId`. Awareness payload includes `{ kind: 'agent', label: '...', ownerUserId: '...' }` so other connected clients render "Claude is editing" indicators.

## Agent identity & authorization

### Cedar policy schema

Cedar policies are stored as Cedar source text in `Agent.policyText`. Server uses `@cedar-policy/cedar-wasm` to parse and evaluate.

Entity types in the Cedar schema:

- `Kryton::User`
- `Kryton::Agent`
- `Kryton::Note { path: String, tags: Set<String>, folder: String }`
- `Kryton::Folder { path: String }`
- `Kryton::NoteShare { ... }`

Actions:

- `Kryton::Action::"read"`
- `Kryton::Action::"write"`
- `Kryton::Action::"delete"`
- `Kryton::Action::"sync"` (covers pull/push of tier 1)

### Example policy

```cedar
permit (
  principal == Kryton::Agent::"agent_xyz",
  action in [Kryton::Action::"read", Kryton::Action::"write"],
  resource is Kryton::Note
) when {
  resource.folder.startsWith("inbox/")
};

forbid (
  principal == Kryton::Agent::"agent_xyz",
  action,
  resource is Kryton::Note
) when {
  resource.tags.contains("private")
};
```

### Enforcement points

- **HTTP:** middleware after auth resolution. For each request, resolve `(principal, action, resource)` and call Cedar. Reject with 403 if denied.
- **WS Yjs:** evaluated on connection upgrade for `read` + `write` on the doc. Re-evaluated on any incoming update if policy refers to mutable resource attributes (uncommon; for v1, policies referring only to immutable attributes are revalidated only on connect).
- **Sync push/pull:** filtering applied at the database query level when possible (e.g., agent with `folder.startsWith("inbox/")` policy gets a `WHERE notes.folderPath LIKE 'inbox/%'` filter on pull).

### Token minting

```http
POST /api/agents/:id/tokens
Content-Type: application/json

{ "expiresInSeconds": 3600, "label": "claude-session-2026-04-30" }
```

Response: `{ "token": "...", "expiresAt": "...", "tokenId": "..." }`. Token is a random 256-bit string; only the SHA-256 hash is stored. Tokens cannot be retrieved after creation.

## Performance considerations

- **Pull payload size:** capped at 1000 entities per response. If more changes pending, response includes `truncated: true` and client repeats pull.
- **Push payload size:** capped at 500 entities per request (matches existing limit in current sync code).
- **Yjs update log:** indexed on `(docId, createdAt)` for fast compaction queries; partitioned-by-time may be added later if `YjsUpdate` grows unboundedly in practice.
- **Cursor column:** indexed on every tier 1 table.

## Backward compatibility

- Legacy `/api/sync/pull` and `/api/sync/push` endpoints are preserved during mobile migration. Removed in the kryton release that follows mobile's full v2 cutover.
- `GET /api/version` is a new endpoint; legacy clients that don't probe it continue to work.

## Testing strategy

- **Unit:** sync handler functions tested with Prisma test DB and synthetic users.
- **Integration:** real Express server + real Postgres in CI; full pull/push/conflict scenarios driven from a `@kryton/core` test instance.
- **Yjs:** two simulated WS clients in-process, verify sync convergence + awareness propagation.
- **Cedar:** policy evaluation tests for the standard set of agent permission patterns (allowlist/denylist, tag-based, folder-based, owner-only).

## Out of scope for v1

- Multi-user collaborative editing of shared notes. Yjs supports it natively but the share/permission resolution for "user A's note shared with user B, both editing the same Yjs doc" needs separate design (sharing semantics already complex in Kryton).
- WebTransport / HTTP/3 transport.
- Real-time push of tier 1 changes via WS — clients pull on a timer or on demand.
- Server-side conflict resolution UI affordances (diff display, merge tool) — clients handle UX.
- Cedar policy templates UI — admins write Cedar source by hand for v1.

## Open implementation questions

1. Folder model retrofit: do we backfill `Folder` rows for all existing users at deploy time, or lazily per first request? Lazily per first user request keeps the deploy fast but adds first-pull latency on day 1.
2. `NoteVersion` table vs adding `version` directly to `SearchIndex`: separate table is cleaner but adds a join. To benchmark.
3. Cedar wasm bundle size on server (~1 MB) — acceptable, but worth measuring startup impact.
4. Awareness payload schema — needs a stable spec so all clients agree. Proposed: `{ kind: 'user'|'agent', label: string, ownerUserId: string, color?: string, cursor?: { from: number, to: number } }`. Locked during implementation of first client (mobile rewrite).
