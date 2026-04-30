# ADR-003: Yjs for Note Content, Relational Sync for Everything Else

**Date:** 2026-04-30
**Status:** Accepted
**Sub-project:** Server Sync v2 (spec 2 of 5) + Core (spec 1 of 5)

## Context

Note bodies (markdown text) and relational metadata (folders, tags, settings, graph edges, shares) have fundamentally different conflict profiles.

Relational metadata rows are small, infrequently written, and have clear last-write-wins semantics. A per-row version integer (ADR-002) is sufficient.

Note bodies are large, frequently written by a single author across devices, and — for shared notes — potentially written by multiple authors concurrently. Naive last-write-wins on the full text body loses edits when two clients save at the same time. Operational transforms (OT) require a central server coordinating every operation. Diff-then-merge (git-style) fails on non-line-granularity edits and requires human conflict resolution.

CRDTs (Conflict-free Replicated Data Types) are the established solution: each client's edits are represented as operations that commute and merge automatically. Yjs is the leading CRDT library in the JavaScript/TypeScript ecosystem, has an active community, a compact binary encoding (Y.update), and explicit support for rich text (Y.Text with CodeMirror binding).

## Decision

Note content is stored and synced exclusively as Yjs documents:

- Server stores the latest Y.Doc state in the `Note.yjsState BLOB` column and broadcasts updates via a WebSocket endpoint (`/ws/yjs/:docId`).
- Clients maintain a local Y.Doc, apply incoming updates, and push their own updates over the same WebSocket.
- The CodeMirror editor binds directly to `Y.Text` via `y-codemirror.next`.
- For offline clients, pending Yjs updates queue in `yjs_pending_updates` and flush on reconnect.

Everything that is not note body content (folders, tags, settings, graph edges, shares, trash) continues to use the LWW relational sync (ADR-002). This keeps the relational layer simple and avoids forcing CRDT semantics onto entities that do not need them.

## Consequences

**Gains:**
- Concurrent edits from multiple clients or devices merge automatically with no data loss.
- Offline edits accumulate locally and reconcile correctly on reconnect.
- Yjs awareness protocol enables real-time cursor presence (future feature, no extra server code required).

**Costs:**
- Note content is now binary (Y.update), not plain-text columns — raw SQL inspection requires a decode step.
- Server must run a persistent WebSocket layer (`/ws/yjs`) in addition to the REST API.
- `@cedar-policy/cedar-wasm` bundle (~1 MB) and `yjs` together add startup weight; measured and accepted.
- Migration: existing `notes.content` text must be imported into a fresh Y.Doc on first sync.

## References

- `docs/superpowers/specs/2026-04-30-server-sync-v2-design.md`
- `docs/superpowers/specs/2026-04-30-kryton-core-design.md`
- ADR-002: Cursor versioning
- ADR-004: Cedar agent identity
