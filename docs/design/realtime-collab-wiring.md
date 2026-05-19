# Wire Real-Time Collaboration Through the Editor

## Status

Draft — awaiting approval before implementation.

## Problem

Y.js infrastructure exists end-to-end but is **not connected** to the editor:

- Server: `/ws/yjs/:docId` speaks framed sync + awareness, persists snapshots + update log to Postgres (`packages/server/src/modules/collab/ws/yjs.handler.ts`, `persistence.ts`).
- Client: `HttpAdapter.openDocument` / `closeDocument` / `getAwareness` exist (after the prior protocol-fix patch).
- UI: `packages/ui/src/editor/state/yjsBinding.ts` and `awareness.ts` exist as ready-to-use bindings.
- **Nothing in the client UI calls `openDocument`.** The editor saves via debounced `PUT /api/notes/...` only.

Two-tab edits to the same note do not converge live. Awareness is dead.

Additionally, the server-side Y.Doc lifecycle has a content-seeding gap: when no DB snapshot exists for a `docId`, the handler falls back to `new Y.Doc()` — **the `.md` file on disk is never read into `Y.Text("content")`**. Wiring the editor without fixing this would blank every note on first collab open.

## Architectural decision: `.md` stays canonical

The existing system treats `.md` files as source of truth — search index, git history, MCP tools, and the file tree all read from disk. Y.Doc snapshots in the DB are an editing-session cache, not the system of record.

Therefore:

- **Server**: when a Y.Doc is opened for a `docId` that has no live in-memory entry, load order is (1) DB snapshot if present and consistent with disk, otherwise (2) read `.md` from disk and seed `Y.Text("content")`. On debounced flush, write `Y.Text("content")` back to `.md` via the existing `noteService.writeNote()` (so search/graph indexing fires as today), in addition to saving the Y snapshot.
- **Client**: when a note opens, the editor uses the Y-bound state. The HTTP `PUT /api/notes/...` debounced save path is **removed** for the active note while collab is connected — the server persists via the Y flush instead.
- **Fallback**: if the WS fails to connect (network, server down), fall back to today's HTTP-only behavior. Don't block editing.

This is option (2) from my analysis — `.md` canonical, Y.Doc ephemeral. The alternative ("Y.Doc canonical, .md is an export") was rejected because it breaks every consumer that reads `.md` directly.

## AI agents as first-class collaborators

AI agents (today: MCP tools at `packages/server/src/modules/agents/mcp/tools.ts`, future: any agent that authenticates via `authenticateWsToken`) participate in collab on equal footing with humans. The WS handler already carries `agentId` alongside `userId` in `AuthInfo` and threads it into `appendYjsUpdate` for attribution.

**Write routing**: `app.notes.writeNote(path, content, userId)` becomes Y-aware. If the `YjsRegistry` has a live entry for `docId=path` belonging to `userId`, the write is performed as a `Y.Text("content")` replace inside that doc (transaction origin tagged with `agentId` so it gets logged for attribution and broadcast to connected clients). If no live entry exists, the write falls through to disk as today. This means:

- **MCP `update_note` / `append_to_note` / `create_note_from_template` while a human has the note open in the editor** → the human sees the AI's edit appear character-by-character (or as a single replace) in real time, and the human's in-flight edits aren't clobbered (Y merges them).
- **MCP write with no human session open** → unchanged: direct disk write, search/graph indexers fire as today.
- **AI agents that want to type interactively** (future): they open a WS as themselves (bearer token route, `agentId` populated), edit `Y.Text("content")` directly with their own cursor, appear in the awareness presence list with an "AI" badge.

**Presence for agents**: agents in awareness state get `kind: "agent"`, an agent-specific color palette (warm tones to distinguish from human cool-tones), and a `name` from `agents.displayName`. No cursor for one-shot MCP tools — just a transient presence dot that fades after the write completes.

## Disk-edits-while-Y-live (the git-pull / external-editor case)

Now in scope per user's call.

`packages/server/src/modules/notes/services/note.service.ts` already centralises all server-initiated writes. The remaining ways `.md` changes while a Y session is live:

- `git pull` in the notes dir
- Direct edits via Finder, vim, etc.
- Any external process

**Solution**: per-user `fs.watch` on the notes directory (chokidar — already a transitive dep, or native `fs.watch` with our own debounce). When the watcher fires for path `P` and a live Y entry exists for `P`:

1. Read the file from disk.
2. Compare against `Y.Text("content").toString()`. If equal → ignore (self-write echo).
3. If different → enter a coordinated update: `doc.transact(() => { ytext.delete(0, ytext.length); ytext.insert(0, diskContent); }, ORIGIN_DISK)`.
4. The Y update broadcasts to connected clients; humans see the new content (their in-flight local edits are merged or rejected per Y CRDT semantics — at minimum, never silently lost).

**Loop prevention**: every server-initiated disk write goes through a helper that records `(path, sha256(content), timestamp)` in a short-TTL `Map`. The watcher checks this map first and skips events that match a recent self-write within the last few seconds.

**Out of scope** even with this: cross-user disk edits via `sudo` or filesystem-level changes that don't fire watch events (network filesystems, certain editors that rewrite via temp + rename — `chokidar` handles the common rename pattern but not all of them). Document as a known limitation.

## Other non-goals (this PR)

- Real-time collab on **shared notes**. Today shares are HTTP-only; routing collab through them needs a separate cross-user docId convention and permission story. Shared notes keep the existing HTTP path.
- Persistent presence color preferences per user. We hash userId → color deterministically; a settings UI can come later.
- Reconnection / resume after WS drop mid-session. We open one socket per open; reconnect is out of scope for this PR. UI surfaces "Disconnected, refresh to reconnect" if dropped.

## Vault events (tree-level live updates)

In-doc collab (Y.Doc) only covers the **content of an open note**. The sidebar, file tree, tags list, graph, and search index reflect a snapshot fetched at page load. Today: when an AI (or the user in another tab) creates / updates / deletes / renames / moves a note, **the change is invisible to other clients until they refresh**. Same problem for tag changes and folder operations.

This needs a per-user server→client push channel. Scope: every vault-mutating operation broadcasts a small event to all of that user's connected clients; the clients patch their local cache and re-render.

**Design**:

- New WS endpoint `/ws/vault` on the server, authenticated identically to `/ws/yjs/*` (cookie/session or bearer token, with `agentId` support so MCP-initiated changes are attributed).
- Per-user broadcast registry (similar shape to `YjsRegistry.broadcast`) holding the set of open vault sockets per `userId`.
- Event shape: `{ kind, path, ... }` where kind is one of `note.created`, `note.updated`, `note.deleted`, `note.renamed` (carries `from` + `to`), `note.moved`, `folder.created`, `folder.deleted`, `folder.renamed`, `tag.added`, `tag.removed`. Updates carry `{ updatedAt, size }` so the client patches its tree without a roundtrip. `agentId` and `agentName` included when the source is an AI, for an optional toast like "Claude added _ideas/refactor.md_".
- Emitter: a single chokepoint in `noteService` (and equivalents for folders/tags) that fires after the disk write succeeds. Already touched in Phase 1.5 to add the self-write dedupe cache — the same chokepoint emits the event.
- Client: a new `useVaultEvents()` hook opens the WS on mount; on each event, dispatches to the relevant cache (file tree, tags store, etc.). Tree updates patch the existing `FileNode[]` in place rather than refetching.

**Interaction with Y.Doc edits**: when an edit goes through Y for an open note, the server's Y `flushToDisk` is also the chokepoint that fires `note.updated`. So other clients (different browser tab, different user with the file shared, etc.) see the file-tree `updatedAt` bump without needing to read the doc content.

This subsumes question #1 (HTTP cache coherence) more completely — instead of the client patching `_notes` on Y update, every vault change (including create/delete/rename) flows through one channel. Y `doc.on("update")` becomes purely about doc content.

## Phases

Six phases. Phase 0 + Phase 0.5 are independent and can run in parallel; everything from Phase 1 onward is sequential and depends on Phase 0. Each phase ends with a runnable + verifiable checkpoint.

### Phase 0 — Vault events channel

Files:
- New: `packages/server/src/modules/vault-events/index.ts` — per-user broadcast registry + WS route at `/ws/vault`.
- New: `packages/server/src/modules/vault-events/types.ts` — `VaultEvent` discriminated union.
- `packages/server/src/modules/notes/services/note.service.ts` — emit `note.*` after every disk-write / delete / rename.
- `packages/server/src/modules/notes/services/folders.service.ts` — emit `folder.*` after folder ops.
- `packages/server/src/modules/notes/index.ts` — wire the emitter into the `app.notes` decorator.
- New client hook: `packages/client/src/hooks/useVaultEvents.ts` — opens WS, dispatches events into stores.
- `packages/client/src/data/HttpAdapter.ts` — methods to patch the tree / tags cache in place from events (instead of refetching).
- `packages/client/src/App.tsx` — mount the hook once per session.

Changes:
- Service-level emitter pattern: `noteService.writeNote(...)` returns the new mtime; the caller (or the service itself) calls `vaultEvents.emit(userId, { kind: 'note.updated', path, updatedAt, size, agentId })`.
- AI attribution: the existing `tools.ts` MCP handlers already have `userId` from auth and the request carries `agentId` via `app.auth.requireAuth`. Thread `agentId` through `writeNote` so the event carries it.
- Client patches the file tree in place; debounced re-renders if many events arrive at once (bulk operations).
- A subtle but important detail: when the same client *originated* the change (typing in the editor), the event also comes back over the channel — that's fine, the patch is idempotent. But we suppress optional toasts ("X created note") for own-origin events.

Verification:
1. Two browser tabs, same user. Create a note in tab A → appears in tab B's sidebar within a second, no refresh.
2. Trigger MCP `create_note` from a separate MCP client → both tabs see it appear with an "(via MCP)" or similar indicator on the file tree row (subtle).
3. MCP `delete_note` → removed from tree everywhere.
4. Open `Welcome.md` in two tabs (Phase 2+): typing in one updates the file-tree `updatedAt` in both (because the Y flush fires `note.updated`).

### Phase 0.5 — URL-based navigation state (refresh-survives)

Independent of the collab work and runnable in parallel with Phase 0.

**Problem**: every page reload drops you back to the default empty view (`Ready when you are.`). The URL stays at `/` regardless of which note(s) you have open, which view mode (`all` / `note` / `graph` / `tags`), or what's selected. Refresh = full state loss.

**Approach**: URL captures the shareable/bookmarkable nav state; existing zustand stores keep the rest.

Files:
- New: `packages/client/src/hooks/useUrlSync.ts` — read URL on mount, write URL on relevant state changes (debounced).
- `packages/client/src/App.tsx` — replace local `view` state + the ad-hoc navigation callbacks with reads from a router context; wire `useUrlSync`.
- `packages/client/src/stores/uiStore.ts` — `openTab`, `closeTab`, `setActiveTab`, `setView` actions trigger URL writes.
- `packages/client/src/lib/urlSchema.ts` — define the URL grammar and parsers.

**URL grammar**:
```
/                                  → default landing
/n/<encoded-path>                  → single note open + active
/n/<active>?tabs=p1,p2,p3          → multi-tab, comma-separated
/view/all                          → all-notes browser
/view/graph                        → graph view
/view/tags?tag=<tagname>           → tags view with optional preselected tag
/shared/<ownerUserId>/<encoded-path> → shared note (preserves the existing shared-note tabId scheme)
```

Encoding: `encodeURIComponent` on each path segment; folder slashes inside the path stay slashes (`/n/Projects/Kryton%20Roadmap`).

**State that goes in the URL** (refresh-survives, shareable):
- Active view (`all` / `graph` / `tags` / `note`)
- Open tabs (paths)
- Active tab
- Preselected tag (when in tags view)

**State that stays in localStorage / zustand** (preference-y, not shareable):
- Sidebar collapsed/expanded
- Density (compact/cozy/comfortable)
- Theme override
- Editor mode preference (edit/split/preview) — sticky per session
- Graph zoom/pan, etc.

**On mount**: parse URL → reconstruct view + open the listed tabs (single batched fetch). If a path no longer exists (deleted while you were away), drop it from tabs and toast "Note no longer exists".

**On navigation**: `history.pushState` for note changes / view changes (browser back button works); `replaceState` for tab list changes within the same active note (avoids polluting history).

**Browser back/forward**: `popstate` handler re-parses the URL and dispatches to stores. Editor scroll position is *not* preserved (deferred — that's a per-note state best kept in a small `Map<path, scrollTop>` in zustand, restored on tab re-activation).

Verification:
1. Open `Welcome.md`, hit refresh → land back on `Welcome.md` in the same view mode.
2. Open three tabs, focus the middle one, refresh → all three tabs restored, middle one active.
3. Switch to graph view, refresh → land on graph view.
4. Copy the URL to another browser, paste → opens the same note (assuming logged in).
5. Browser back button after switching notes → returns to previous note.
6. Refresh while in a note that was just deleted by an AI / another tab → toast + fallback to default view, no crash.

### Phase 1 — Server: seed Y.Doc from `.md` and flush back

Files:
- `packages/server/src/modules/collab/ws/yjs.handler.ts`
- `packages/server/src/modules/collab/ws/persistence.ts` (new method: `flushToDisk`)
- `packages/server/src/modules/collab/index.ts` (wire `noteService` dep into the registry construction)
- `packages/server/src/modules/notes/services/note.service.ts` (record self-writes in a small `(path, sha, ts)` cache for the watcher to dedupe — used in Phase 1.5)

Changes:
- In `ensureDoc`, when neither DB snapshot nor in-memory entry exists, call `noteService.readNote(notesDir, docId)`; if the file exists, insert its content into `Y.Text("content")` *before* binding the update listener (so the seeding update isn't persisted as an inbound delta).
- Extend `doFlush` to call a new `flushToDisk(docId, userId, doc)` alongside `saveYjsSnapshot`. `flushToDisk` reads `Y.Text("content")` and calls `noteService.writeNote(...)` — which already updates search/graph indexes — and records the self-write in the dedupe cache.
- Add a server unit test covering: empty DB + existing .md → Y.Text mirrors file content; edit → debounced flush rewrites .md.

Verification: existing `yjs-ws.test.ts` continues to pass; new test for seed + flush.

### Phase 1.5 — Server: AI write routing + disk watcher

Files:
- `packages/server/src/modules/notes/index.ts` (`writeNote` decorator becomes Y-aware: check registry, route to Y when live)
- `packages/server/src/modules/collab/index.ts` (expose `YjsRegistry.applyServerEdit(docId, userId, agentId, newContent)` for the note service to call)
- `packages/server/src/modules/collab/ws/yjs.handler.ts` (`YjsRegistry` gains `applyServerEdit`; `entry.doc.transact(...)` writes the replace with origin = `{kind:'agent', agentId}`)
- New: `packages/server/src/modules/notes/services/disk-watcher.ts` — per-user `chokidar` watcher started on first WS open under that user, stopped on user-eviction. On change, calls `YjsRegistry.applyDiskUpdate(docId, userId, diskContent)` which checks the dedupe cache and either skips (self-write echo) or applies a Y replace tagged `ORIGIN_DISK`.

Changes:
- `writeNote(userId, path, content)` checks `yjsRegistry.hasLive(docId=path, userId)`. If yes → `yjsRegistry.applyServerEdit(...)`; the Y broadcast + flush handles persistence. If no → existing direct disk write.
- The disk watcher is opt-in per user: started when `ensureDoc` first creates an entry for them, stopped when their last live doc evicts. Avoids watching the notes dir for users who aren't actively editing.
- AI agents that authenticate via WS bearer (the future "interactive AI coauthor" path) just open a WS like a human — no change needed; the existing `agentId` plumbing already attributes their updates.

Verification: integration test where (a) human opens note, (b) MCP `update_note` fires for the same path, (c) the Y broadcast contains the AI's edit, (d) the human's WS receives the change. Second test: human opens note, external `fs.writeFile` rewrites `.md`, the watcher fires, the Y broadcast contains the disk content, the human's WS receives it.

### Phase 2 — Client: open Y.Doc on note open, bind editor

Files:
- New: `packages/client/src/hooks/useYjsDocument.ts`
- `packages/client/src/components/Views/EditModeView.tsx` (consume the hook, wire `yjsBinding`)
- `packages/client/src/hooks/useAppCallbacks.ts` (call `adapter.closeDocument(path)` on tab close)
- `packages/client/src/hooks/useNotes.ts` (skip the debounced HTTP save when a live Y.Doc exists for the path)

Changes:
- `useYjsDocument(path)` calls `adapter.openDocument(path)`, returns `{ doc, ytext, status, awareness }`. Tears down on unmount or path change.
- `EditModeView` wires `createYjsBinding(ytext, getState, setState)`; the editor's onChange becomes `binding.applyLocal(transaction)`.
- `useNotes.updateContent` becomes a no-op for paths with an active Y.Doc — Y handles persistence via Phase 1 flush.
- HTTP fallback: if `openDocument` rejects or the socket closes before first sync, fall back to the existing HTTP save path and show a toast: "Live sync unavailable, edits will save normally."

Verification: open Welcome.md in two tabs (same user), type in one, see it in the other within a debounce-window; close one tab → server flushes to disk; reopen → content intact.

### Phase 3 — Awareness (presence cursors + identity), incl. AI agents

Files:
- New: `packages/client/src/lib/presenceColor.ts` (deterministic id → hsl color; separate palettes for `kind: 'user'` cool tones and `kind: 'agent'` warm tones)
- `packages/client/src/components/Editor/Editor.tsx` (consume `createCursorAwareness`, render remote cursors)
- `packages/ui/src/editor/view/EditorView.tsx` (if remote-cursor decoration support is missing — to be verified during Phase 2; extend the view to accept a `remoteCursors` prop)
- `packages/client/src/hooks/useYjsDocument.ts` (set local awareness state on mount + selection change)
- Server: `packages/server/src/modules/collab/ws/yjs.handler.ts` — when applying a server-initiated edit (Phase 1.5 `applyServerEdit`), briefly publish a synthetic awareness state for the agent (`{ kind: 'agent', agentId, name, color }`) with no cursor, then clear it a few seconds after the edit settles. This makes AI presence visible without needing the agent to maintain its own WS.

Changes:
- Awareness schema: `{ kind: 'user' | 'agent', id, name, color, cursor?: { anchor, head } }`. `kind: 'agent'` entries get an AI badge in the presence strip and warm-tone color.
- On mount, set `awareness.setLocalStateField('user', { kind: 'user', id, name, color })`.
- On editor selection change, update `awareness.setLocalStateField('cursor', { anchor, head })`.
- Render remote cursors as colored vertical bars + name label, including an "AI" pill for `kind: 'agent'`. Stale agents fade fast (3s); humans use the library default.
- Presence avatar strip in the editor toolbar showing active collaborators on this note, with kind-distinguishing icons.

Verification: 
1. Two browser contexts, two users (`pascal`, `wangchuk`). Both open `Welcome.md` (after pascal shares it OR in two contexts as the same user). Each sees the other's cursor + name; typing in one shows the other's character insertions in real time; closing one removes its presence within a few seconds.
2. Open `Welcome.md` as pascal; trigger an MCP `update_note` (or `append_to_note`) on the same path from a separate MCP client. The browser shows the AI presence pill, the edit appears live, presence fades.

## Resolved questions

1. **HTTP cache coherence**: ✅ replaced by Phase 0 vault-events channel — every vault mutation flows through one push channel; clients patch their caches from events.
2. **Disk edits while Y live**: ✅ in scope — handled by Phase 1.5 disk watcher with self-write dedupe; disk-watcher events also trigger Phase 0 vault events so the file tree stays in sync with external edits.
3. **AI agents as collaborators**: ✅ first-class on three axes — (a) Phase 0 routes MCP create/delete/rename through vault events with `agentId` attribution; (b) Phase 1.5 routes MCP content edits through Y when live; (c) Phase 3 includes agent awareness presence in the editor.
4. **Editor remote-cursor decorations**: to be verified during Phase 2 work. If `EditorView` doesn't support overlays, Phase 3 extends it (added to Phase 3 file list).

## Rollback plan

Each phase is a separate branch + PR:
- Phase 0 (vault events) is self-contained — the WS channel can be rolled back independently; rolling back loses live tree updates but everything else still works.
- Phase 0.5 (URL nav) is self-contained — rollback restores the current "refresh = lose state" behavior; no other phase depends on it.
- Phase 1 alone is harmless — if no client uses `openDocument`, the seeding path never runs.
- Phase 1.5 (AI routing + disk watcher) is additive on the server: if rolled back, MCP writes return to direct-disk; no client behavior changes. Disk watcher revert simply removes the live-reload-on-external-edit behavior.
- Phase 2 introduces the editor dependency; if rolled back, the editor falls back to HTTP save automatically (kept as the dormant fallback).
- Phase 3 is additive UI only — rolling back leaves Phase 2's sync working without cursor decorations.

## Test plan

- Server unit: `collab/__tests__/yjs-seed.test.ts` covering disk → Y seed and Y → disk flush.
- Server existing: `collab/__tests__/yjs-ws.test.ts` continues to pass.
- Client unit: `data/__tests__/HttpAdapter.test.ts` (already passes; add a test for the protocol-level round-trip with a mock WS).
- Manual: two-browser test on the deployed staging or local dev; both same user (basic sync) and two users on a shared note (Phase 3 stretch).
