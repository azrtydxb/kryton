# ADR-002: Server-Monotonic Cursor + Per-Row Version Columns for Delta Sync

**Date:** 2026-04-30
**Status:** Accepted
**Sub-project:** Server Sync v2 (spec 2 of 5)

## Context

The original `/api/sync` endpoint tracked changes via `updatedAt` timestamps. Timestamp-based sync has three well-known failure modes: clock skew between client and server producing missed updates, multiple rows updated within the same millisecond appearing identical to the cursor, and no reliable conflict detection when two clients update the same row at nearly the same time.

Three alternatives were evaluated:

1. **Timestamp-based deltas** (current) — simple, but unreliable under clock skew and sub-millisecond batches.
2. **Operation log / event sourcing** — reliable ordering, but unbounded storage growth and complex compaction; justified only when full history replay is required.
3. **Server-monotonic cursor + per-row `version` integer** — a single auto-incrementing counter on the server, stamped onto every write; clients track the last-seen cursor value and receive only rows with a higher cursor on the next pull.

## Decision

All tier 1 entities (Folder, Tag, Note, NoteTag, Settings, GraphEdge, NoteShare, TrashItem, InstalledPlugin) carry two new columns:

- `version INT DEFAULT 0` — incremented on every server-side write; used as the LWW (last-write-wins) tie-breaker.
- `updatedCursor BIGINT DEFAULT 0` — the server's global monotonic counter value at the time of the write; used by pull to filter `WHERE updatedCursor > :cursor`.

The global cursor is a single SQLite sequence row. On each write transaction, the server atomically increments the cursor and stamps it onto every row modified in that transaction.

Push requests include the client's `base_version` for each row. If `server.version > base_version`, the server returns a conflict response rather than overwriting silently.

## Consequences

**Gains:**
- Pull deltas are deterministic and complete regardless of clock skew.
- Conflict detection is exact: version integers are unambiguous, unlike timestamps.
- Storage overhead is two integers per row — negligible.
- The cursor doubles as a cheap "nothing new" check: if `maxCursor == clientCursor`, skip the full query.

**Costs:**
- All existing rows need a backfill migration to set `version = 0` and `updatedCursor = 0` (handled in the sync v2 Prisma migration).
- The global cursor becomes a hot row under high write concurrency; acceptable for SQLite's single-writer model but worth revisiting if the backend moves to PostgreSQL.
- Clients must persist the cursor value across sessions (stored in the secure settings table).

## References

- `docs/superpowers/specs/2026-04-30-server-sync-v2-design.md`
- `docs/superpowers/specs/2026-04-30-kryton-core-design.md`
- ADR-005: Prisma annotation schema generation
