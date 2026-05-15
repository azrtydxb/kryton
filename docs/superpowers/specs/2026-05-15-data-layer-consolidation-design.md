# Client data-layer consolidation — design

**Status:** Draft
**Date:** 2026-05-15
**Owner:** TBD
**Audit context:** Codebase audit flagged three competing client-side data-access layers, with overlapping caches and divergent invalidation models.

---

## 1. Goal

Pick a single client-side authority for server-derived state and bound the other two as adapters or selectors, so cache invalidation and UI freshness have one consistent mental model.

---

## 2. Why now

The audit surfaced that the same logical entity (a note, the file tree, the starred set, the shared-with-me list) can simultaneously live in up to three places on the client:

1. **`useNotes` local React state** — `packages/client/src/hooks/useNotes.ts:5`
2. **TanStack Query cache** — wired up in `packages/client/src/App.tsx:11` and consumed via `packages/client/src/hooks/useAppState.ts:64`, `packages/client/src/hooks/useNotesQuery.ts`, and the `Sidebar`/`AppStatusBar` query hooks.
3. **`HttpAdapter` in-memory cache** — `packages/client/src/data/HttpAdapter.ts:84`, plus its subscribe/notify model consumed by `useUiNotes` / `useUiFolders` in `packages/ui/src/data/hooks.ts:18`.

These three layers do not share an invalidation contract. Concretely:

- When `useNotes.updateContent` (`useNotes.ts:70`) writes via `api.updateNote` it never tells React Query that `['notes', 'note', path]` (declared in `useNotesQuery.ts:16`) or `['graph', userId, treeKey]` (`useNotesQuery.ts:25`) is now stale.
- When the same write happens, `HttpAdapter`'s `_notes` array (`HttpAdapter.ts:89`) is also not patched — its `fire("notes")` (`HttpAdapter.ts:129`) never runs, so any `useUiNotes` consumer keeps showing stale data until the next `refresh("notes")` call.
- Conversely, `HttpAdapter.notes.update` (`HttpAdapter.ts:343`) calls `fire("notes")` but never invalidates React Query keys, so the `Sidebar` backlinks / shared list and `App.tsx`'s `AppStatusBar` backlinks query (`App.tsx:75`) can also drift.
- The `useNotes.tree` size is currently used as `treeKey` for the React Query graph fetch (`useAppState.ts:65`) — a fragile cross-layer signal that re-fetches the graph only when the count changes (not when contents change).

The net effect: features that mix two layers — e.g. the FileTree (legacy `useNotes`) plus the Sidebar's `useSharedNotes(user?.id)` (React Query) — can disagree about reality at any moment.

---

## 3. Current state inventory

### 3.1 `useNotes` — legacy local-state hook

**File:** `packages/client/src/hooks/useNotes.ts:5`

**Manages:**
- `tree: FileNode[]` — the full file/folder tree (`useNotes.ts:6`).
- `activeNote: NoteData | null` — currently open note, including its full content (`useNotes.ts:7`).
- `loading`, `saving`, `error` — flat top-level UI state for the App shell (`useNotes.ts:8-10`).
- A debounced auto-save (`useDebouncedCallback`, 500ms) for the active note (`useNotes.ts:59`).

**How writes invalidate reads:**
- Every mutating helper (`createNote`, `deleteNote`, `renameNote`, `createFolder`, `deleteFolder`, `renameFolder`) calls `await refreshTree()` (`useNotes.ts:88`, `:102`, `:115`, `:125`, `:135`, `:145`), which re-fetches `GET /api/notes` and replaces `tree` wholesale.
- `updateContent` (`useNotes.ts:70`) writes through `debouncedSave` but **does not refresh** the tree, the active note, the graph, or any React Query key. It mutates `activeNote.content` in place via `setActiveNote`.
- `openNote` and `openSharedNote` (`useNotes.ts:21`, `:37`) re-fetch a single note (`api.getNote` / `sharedNoteApi.read`) and replace `activeNote`.

**Who subscribes:**
- `useAppState` (`useAppState.ts:15`) exposes the whole hook return as `notes` on `AppState`.
- `useAppCallbacks` reads `notes.tree`, `notes.activeNote`, `notes.updateContent`, etc. (`useAppCallbacks.ts:34-126`).
- `App.tsx`'s render passes `notes.tree`, `notes.activeNote`, `notes.error` and the CRUD callbacks into `SidebarLayout`, `EditModeView`, `PreviewModeView`, `AllNotesView`, `AppModals` (`App.tsx:343-487`).
- `AppStatusBar` reads `notes.activeNote?.content` for word/outgoing/tag counts (`App.tsx:441`).

**Overlap with the others:**
- The tree fetched by `useNotes.refreshTree` is the same `GET /api/notes` that `useNotesTree(userId)` (`useNotesQuery.ts:6`) and `HttpAdapter._refreshNotes` (`HttpAdapter.ts:184`) call. Three caches, one endpoint.
- `notes.tree.length` is used as the `treeKey` for `useGraphQuery` (`useAppState.ts:65-66`), creating a back-channel cache key.
- Starred state is tracked in React Query (`['settings','starred',userId]`, `useNotesQuery.ts:49`), but consumed alongside `notes.activeNote.tabId ?? notes.activeNote.path` (`useAppState.ts:94`).
- Shared-with-me list is in React Query (`useSharedNotes`, `useNotesQuery.ts:69`); but the *act of opening* a shared note flows back into `useNotes.openSharedNote` and mutates `useNotes.activeNote`.

### 3.2 TanStack Query

**Setup:** `packages/client/src/App.tsx:11` (`QueryClient` with `refetchOnWindowFocus:false`, `retry:1`).

**Consumed via:**
- `packages/client/src/hooks/useNotesQuery.ts` — declares the canonical query hooks: `useNotesTree`, `useNoteQuery`, `useGraphQuery`, `useGraphRealtimeUpdates`, `useStarredNotes`, `useSharedNotes`.
- `useAppState.ts:64-89` — uses `useGraphQuery`, `useStarredNotes`, `useSharedNotes`, and bridges `setStarredPaths` back into the cache via `queryClient.setQueryData` (`useAppState.ts:78-86`).
- `App.tsx:75` — `AppStatusBar` runs its own `useQuery({ queryKey: ['backlinks-count', notePath], ... })`.
- `Sidebar.tsx` — calls `useQuery` for MCP health/agents-online (`Sidebar.tsx:191`, `:197`).

**Query keys in use today:**

| Key | Where declared | Where read |
|---|---|---|
| `['notes', 'tree', userId]` | `useNotesQuery.ts:8` | currently **not** consumed by `useAppState` (it uses `useNotes` instead). Declared but orphaned in the hot path. |
| `['notes', 'note', path]` | `useNotesQuery.ts:18` | also unused by `useAppState` — `useNotes.openNote` calls the raw `api.getNote` instead. |
| `['graph', userId, treeKey]` | `useNotesQuery.ts:26` | `useAppState.ts:66` |
| `['settings', 'starred', userId]` | `useNotesQuery.ts:51` and `useAppState.ts:80` | `useAppState.ts:73`, mutated optimistically from `useAppCallbacks.toggleStar` (`useAppCallbacks.ts:23`) |
| `['shares', 'withMe', userId]` | `useNotesQuery.ts:71` | `useAppState.ts:88` |
| `['backlinks-count', notePath]` | `App.tsx:76` | `App.tsx` (`AppStatusBar`) |
| `['mcp-health']`, `['agents-online']` | `Sidebar.tsx:191`, `:197` | `Sidebar.tsx` |

**How writes invalidate reads:**
- Star toggle uses optimistic write via `setStarredPaths` → `queryClient.setQueryData` (`useAppState.ts:83`). No `invalidateQueries`.
- Graph refresh is event-driven: `useGraphRealtimeUpdates` (`useNotesQuery.ts:35`) listens to `pluginManager.onGraphUpdated` and calls `queryClient.invalidateQueries({ queryKey: ['graph', userId] })`.
- Everything else relies on `staleTime` defaults plus the manual `treeKey` trick for the graph.

**Overlap with the others:**
- `useNotesTree` / `useNoteQuery` are declared but **the App.tsx flow goes through `useNotes` instead**, so two parallel ways to read the same data exist, only one is used in the hot path.
- `useSharedNotes` in React Query feeds Sidebar's shared section while the FileTree (rendered from `useNotes.tree`) is the surface where users click into a shared note. The click handler then writes back into `useNotes.activeNote`, never into the RQ cache.
- `useStarredNotes` lives in RQ but the only consumer (`useAppState.ts:74`) immediately wraps it back into `starredPaths: Set<string>` and threads it through props — RQ acts here as a global store, not a query.

### 3.3 `HttpAdapter`

**File:** `packages/client/src/data/HttpAdapter.ts:84`

**Manages (all in memory, all on the class instance):**
- `_notes: NoteData[]` (flattened tree) — `:89`
- `_folders: FolderData[]` (derived) — `:90`
- `_tags: TagData[]` — `:91`
- `_settings: Map<string, string>` — `:92`
- `_noteShares: NoteShareData[]` — `:93`
- `_trashItems: TrashItemData[]` — `:94`
- `_currentUser: CurrentUser | null` — `:95`
- `_syncStatus: SyncStatus` — `:98`
- `_docs: Map<string, Y.Doc>` and `_sockets: Map<string, WebSocket>` for live Yjs editing — `:109-110`

**How writes invalidate reads:**
- Subscribe/notify pattern: `subscribe(entityType, ids, cb)` → `fire(entityType)` (`HttpAdapter.ts:119`, `:129`).
- Every mutating method patches the in-memory array and calls `fire("<entity>")`. e.g. `notes.update` mutates `_notes` and fires `"notes"` (`HttpAdapter.ts:354-357`).
- `triggerSync()` does a parallel refresh of all entities (`HttpAdapter.ts:552-558`).
- Yjs document updates flow through WebSocket → `Y.applyUpdate(doc, data)` (`HttpAdapter.ts:495-501`). **They do not fire any subscription on the adapter**, so RQ / `useNotes` never hears about them.

**Who subscribes:**
- `useUiNotes`, `useUiFolders`, `useUiTags`, `useUiSettings`, `useUiNoteShares`, `useUiTrashItems`, `useUiNote`, `useUiSyncStatus` in `packages/ui/src/data/hooks.ts:18-60`.
- The `HttpDataProvider` mounted at the top of `App.tsx:51` makes the adapter available via `useKrytonData()`.

**Overlap with the others:**
- `_notes` is the same data as `useNotes.tree` (flattened) and `['notes','tree',userId]`. Three caches.
- `_settings` overlaps with `['settings','starred',userId]` for the starred key specifically; today nothing writes to it from the client flow because starred goes via `api.updateSetting` directly (`useAppCallbacks.ts:28`), not via `adapter.settings.set`.
- `_noteShares` overlaps with `['shares','withMe',userId]` but represents the **owner-side** view (`GET /api/shares`) whereas `useSharedNotes` is the **shared-with-me** view (`GET /api/shares/with-me`). They're not the same entity but the audit conflated them; we should keep both, just inside one cache.
- The Yjs document layer has no peer in `useNotes` or React Query — it's the only place live collaboration is wired. This is why `HttpAdapter` cannot simply be deleted.

---

## 4. The case for each as the single authority

### 4.1 `useNotes` only

**Pros**
- Smallest, in-repo, no extra dependency.
- One file to reason about (`useNotes.ts`).
- Auto-save debouncing already lives here.

**Cons**
- No cross-route or cross-component cache — every consumer must receive data via props (which is exactly what `App.tsx:343-487` does today, painfully).
- No background refetch, no `staleTime`, no devtools.
- Can't express granular invalidation: it's "refresh the whole tree" or nothing. The audit's "the same data lives in three caches" gets *worse*, not better, if we make `useNotes` the authority and re-implement what RQ already gives us.
- No standard way to express the Yjs subscription — would have to invent one.

Verdict: not viable as the sole authority.

### 4.2 React Query (TanStack Query) only

**Pros**
- Already installed, already wired up (`App.tsx:11`).
- Mature: per-key invalidation, optimistic updates, devtools, suspense support, request deduplication, background refetch.
- Most candidate hooks already exist in `useNotesQuery.ts` — they're just bypassed.
- Selectors and `queryClient.setQueryData` give us a clean optimistic-write story.

**Cons**
- Yjs live data is not a "fetch" — it's a stream. RQ can host it (via `useQuery` with `subscribe` or `useSyncExternalStore`-style helpers), but it needs an adapter at the boundary.
- `@azrtydxb/ui`'s adapter-based hooks (`useUiNotes`, etc.) are designed to be platform-agnostic; making them depend on RQ would couple the UI package to a host-app concern.
- React Query Provider is web-only at the moment; native/electron hosts would need their own provider but that's true regardless.

Verdict: viable. With `HttpAdapter` reduced to a transport, RQ becomes the natural client cache.

### 4.3 `HttpAdapter` (`KrytonDataAdapter`) only

**Pros**
- Already abstracted behind the `KrytonDataAdapter` interface (`packages/ui/src/data/types.ts:28`), so native / electron / a hypothetical offline-first adapter could implement the same contract.
- The Yjs document and `subscribe` model live here naturally.
- One cache, one notify channel.

**Cons**
- The subscribe/notify model is hand-rolled and considerably less featureful than React Query: no `staleTime`, no per-id caching beyond what we hand-code, no devtools, no built-in request dedup, no optimistic mutation helpers.
- Currently web-only despite the abstraction (the WebSocket code in `HttpAdapter.ts:484-514` is `window.location`-bound).
- Forces every consumer through a single global instance — fine for the app, but harder to mock per-test than RQ.
- We'd have to re-implement what RQ already gives us.

Verdict: not viable as the *sole* client cache. Strong as a transport abstraction below RQ.

---

## 5. Recommended target architecture

> **One sentence:** `HttpAdapter` becomes a thin **transport adapter** (HTTP + WebSocket), React Query becomes the **single client cache and query/mutation layer** sitting on top of it, `useNotes` is decomposed into thin selector hooks, and `@azrtydxb/ui`'s data hooks stay on the adapter contract so they remain host-agnostic.

### 5.1 Layer responsibilities

```
                +-------------------------------------------+
                |  React components & feature hooks         |
                |  (Sidebar, App, EditModeView, …)          |
                +-------------------------------------------+
                            |
                            | useQuery / useMutation / selectors
                            v
                +-------------------------------------------+
                |  TanStack Query — the single client cache |
                |  Keys: ['notes','tree',userId] etc.       |
                |  + thin domain hooks in useNotesQuery.ts  |
                |  + thin selector hooks (useActiveNote)    |
                +-------------------------------------------+
                            |
                            | api.* helpers + adapter.openDocument
                            v
                +-------------------------------------------+
                |  Transport layer                          |
                |  - api.* (REST) in lib/api.ts             |
                |  - HttpAdapter (KrytonDataAdapter):       |
                |      * Yjs docs + WebSocket lifecycle     |
                |      * subscribe('notes', …) bridges to   |
                |        queryClient.invalidateQueries      |
                +-------------------------------------------+
                            |
                            v
                       Server (REST + /ws/yjs)
```

### 5.2 Concretely

- **`HttpAdapter` keeps:** `openDocument` / `closeDocument` / `getAwareness` / `readNoteContent` (`HttpAdapter.ts:476-540`), `getSyncStatus` / `triggerSync` (`:544-567`), `currentUser` (`:571`), and the `subscribe('<entity>', …)` channel.
- **`HttpAdapter` loses (eventually):** the in-memory `_notes`, `_folders`, `_tags`, `_settings`, `_noteShares`, `_trashItems` arrays as authoritative caches. These can either:
  - (a) be removed entirely once `@azrtydxb/ui` hooks are rewritten, or
  - (b) survive as a derived view-of-RQ if we choose the "UI hooks stay on the adapter" path (recommended — see 5.3).
- **React Query becomes** the only place a feature hook reaches into for `notes`, `tree`, `graph`, `starred`, `sharedWithMe`, `backlinks`, `tags`, `trash`, `noteShares`. Each gets a typed hook in `useNotesQuery.ts` (or split into `useFoldersQuery.ts`, etc. once it grows). All mutations go through `useMutation` with explicit `onSuccess: () => queryClient.invalidateQueries({ queryKey: [...] })`.
- **`useNotes` is decomposed into:**
  - `useNotesTree(userId)` (already exists, `useNotesQuery.ts:6`) for the tree.
  - `useActiveNote()` — a thin selector that reads `useUIStore`'s active path/tabId and runs `useNoteQuery(path)` underneath. Replaces `useNotes.activeNote` + `useNotes.openNote` + `useNotes.openSharedNote`. The "shared:" tab-id routing logic moves into this hook.
  - `useUpdateNoteContent()` — a `useMutation` with a debounced wrapper that mirrors today's 500ms behaviour. **Crucially does not round-trip through the cache while the user is typing** (see Risks).
  - `useCreateNote`, `useDeleteNote`, `useRenameNote`, `useCreateFolder`, `useDeleteFolder`, `useRenameFolder` — each a `useMutation` with explicit `invalidateQueries({ queryKey: ['notes', 'tree', userId] })` (plus `['graph', userId]`, plus `['shares', 'withMe', userId]` where applicable).
  - The flat `loading` / `saving` / `error` fields collapse into the mutation/query objects RQ already returns. The `ErrorToast` (`App.tsx:471`) reads a global error from a new tiny error slice in `useUIStore` written by mutation `onError` handlers (or simply uses `useMutation`'s `error` state, hoisted with a context if needed).
- **Yjs → RQ bridge:** when the editor opens a document via `adapter.openDocument(noteId)`, we also wire `adapter.subscribe('notes', [noteId], () => queryClient.invalidateQueries({ queryKey: ['notes', 'note', noteId] }))` *but* with the carve-out that invalidation while the local Yjs doc is active is a no-op for the content field — the doc *is* the truth. The RQ cache for that note's `content` is refreshed only on doc close.

### 5.3 `@azrtydxb/ui` data hooks — stay on the adapter

The `useUiNotes` family (`packages/ui/src/data/hooks.ts:18-60`) lives in a package that may be consumed by native, electron, or third-party hosts that do not (and should not) ship TanStack Query. **Recommendation: keep them on the `KrytonDataAdapter` contract.**

What changes is the *host implementation* of `KrytonDataAdapter` in the web client:

- `HttpAdapter.notes.list()` etc. read from the React Query cache (via `queryClient.getQueryData(['notes','tree',userId])`) rather than from a private `_notes` array.
- `HttpAdapter.notes.update(...)` calls `queryClient.fetchQuery` or directly `setQueryData` + `invalidateQueries` instead of patching `_notes`.
- The adapter's `subscribe('notes', …)` subscriptions are notified by a single `QueryCache` listener that calls `fire(entityType)` whenever the relevant query keys change.

This preserves the abstraction (native hosts can ship a totally different adapter), but in the web app the adapter is a thin view over the RQ cache rather than a competing cache. Single source of truth, two interfaces onto it.

The alternative — making `useUiNotes` a re-export of an RQ hook in the host — leaks RQ into the UI package and breaks the platform abstraction. Reject.

---

## 6. Migration plan

Strictly incremental. No big-bang rewrite, no API freeze, each phase is mergeable on its own and leaves the app in a working state.

### Phase 1 — Route every read currently in `useNotes` through React Query

No user-visible change.

1. Replace `useNotes.refreshTree`'s usage with `useNotesTree(userId)` (`useNotesQuery.ts:6`). `useNotes` keeps existing return shape; internally it reads `data` from RQ instead of owning `tree` as `useState`.
2. Replace `useNotes.openNote` / `useNotes.openSharedNote` callers (only `useAppCallbacks.handleNoteSelect`, `:39`) so that "open a note" no longer means "fetch and put in `useState`" — it means "set active tab id in `useUIStore`". Add `useActiveNote()` that runs `useNoteQuery(activePath)` and returns `{ data, isLoading, error }`.
3. Audit the `notes.tree.length` "treeKey" trick (`useAppState.ts:65`) — replace with `useGraphQuery(userId)` keyed only on `userId`; rely on `useGraphRealtimeUpdates` plus explicit `invalidateQueries(['graph', userId])` from CRUD mutations.

Exit criteria: no `useState` for server-derived data remains in `useNotes`. `useNotes` is now a thin facade over RQ. All existing tests pass.

### Phase 2 — Invalidate the right query keys from existing write paths

Still no user-visible change beyond fewer stale reads.

1. Convert each CRUD helper in `useNotes` to a `useMutation` (or call one). On success, `queryClient.invalidateQueries` for:
   - `createNote` → `['notes','tree',userId]`, `['graph', userId]`
   - `deleteNote` → `['notes','tree',userId]`, `['graph', userId]`, `['notes','note', deletedPath]` (remove)
   - `renameNote` → `['notes','tree',userId]`, `['graph', userId]`, `['notes','note', oldPath]`, `['notes','note', newPath]`
   - `createFolder` / `deleteFolder` / `renameFolder` → `['notes','tree',userId]`
   - `updateNote` (the debounced save) → **does not invalidate `['notes','note', path]` for the local writer**; instead, optimistically `setQueryData(['notes','note', path], current => ({ ...current, content }))`. Invalidate `['graph', userId]` only if links changed (delegate to the server's `graph:updated` push via `useGraphRealtimeUpdates`).
2. Move `toggleStar` (`useAppCallbacks.ts:23`) to a `useMutation` so the optimistic write + server persist + rollback-on-error path is explicit. Today it persists in a `.catch(console.error)` (`useAppCallbacks.ts:28`) with no rollback.

Exit criteria: every server-state read updates within one tick of any server-state write, without page reload.

### Phase 3 — Wire `HttpAdapter.subscribe('notes', …)` to React Query

1. Introduce a single bootstrap effect (probably in `HttpDataProvider` or just below `QueryClientProvider`) that subscribes to `adapter.subscribe('*', '*', () => …)` and calls `queryClient.invalidateQueries` against the matching key. Map:
   - `"notes"` → `['notes', 'tree', userId]`, `['notes', 'note', *]` (selective by id when ids are provided)
   - `"folders"` → `['notes', 'tree', userId]` (folders are derived from the tree today)
   - `"tags"` → `['tags', userId]` (new key)
   - `"settings"` → `['settings', '*', userId]`
   - `"noteShares"` → `['shares', '*', userId]`
   - `"trashItems"` → `['trash', userId]` (new key)
   - `"sync"` → no invalidation; surface via a `useSyncStatus()` hook
2. Yjs WebSocket events: where today `Y.applyUpdate(doc, data)` (`HttpAdapter.ts:500`) silently mutates `Y.Doc`, also fire `subscribe` notifications scoped to that note id once the editor is closed (or on a debounce while open) so that anything depending on the *rendered* note content gets a refresh.
3. Rewrite `HttpAdapter.notes.list()`, `.findById()`, etc. (`HttpAdapter.ts:284-313`) to read from `queryClient.getQueryData(['notes','tree',userId])` rather than from `_notes`. The adapter still owns the Yjs doc map and the WebSocket lifecycle, but it stops owning the entity arrays. The `@azrtydxb/ui` hooks keep working unchanged.

Exit criteria: Yjs-driven note changes propagate to non-editor UI (sidebar, status bar, graph) without a manual `refreshTree`. The web adapter's in-memory entity arrays are gone.

### Phase 4 — Delete `useNotes`'s ad-hoc state, replace with selectors

1. Delete `useNotes.ts` entirely. Replace usage sites with:
   - `useNotesTree(user?.id)` for the tree.
   - `useActiveNote()` for the active note (reads `useUIStore`'s active tab id internally).
   - The per-operation `useCreateNote`, `useUpdateNoteContent`, etc. mutations.
2. Collapse `useAppState`'s `notes` aggregate: callers that today read `state.notes.tree` read `state.tree`; `state.notes.activeNote` becomes `state.activeNote`; etc. This is a mechanical rename across `App.tsx`, `useAppCallbacks.ts`, `Sidebar.tsx`, the View components.
3. `useAppCallbacks` becomes a much thinner module: it no longer threads `notes.openNote` / `notes.refreshTree` through, just calls the corresponding mutation hooks directly.

Exit criteria: `useNotes` no longer exists. Grep for `from '../hooks/useNotes'` returns zero results. The Sidebar shared section, the FileTree, and the editor all read from the same RQ keys.

---

## 7. Risk inventory

### 7.1 Editing path (Yjs collab) — round-trip risk

`useNotes.updateContent` today is the only path that **doesn't** refresh the cache, and that is actually correct: while a user is typing, the source of truth for content should be the local CodeMirror buffer (and, in collab sessions, the local `Y.Doc`). If we naively wire the `Yjs → RQ` invalidation bridge for `['notes','note', id]` while the editor is mounted, every keystroke triggers a remote re-fetch that races the local doc.

**Mitigation:** the bridge must be aware of "is this note currently being edited locally". Concretely:

- `useActiveNote()` registers the active note id in a small `editingRegistry` (could live in `useUIStore` or as a module-level `Set`).
- The Yjs → RQ invalidation handler checks `editingRegistry.has(id)` before invalidating `['notes','note', id]`. If true, it skips invalidation; the editor surfaces live updates via the `Y.Doc` directly.
- On editor close (`closeActiveNote` equivalent), the handler does a one-shot `invalidateQueries({ queryKey: ['notes','note', id] })` to reconcile.

This keeps the "live document" path orthogonal to the "cached read" path.

### 7.2 Auto-save debouncing

`useDebouncedCallback(..., 500)` (`useNotes.ts:59`) is the contract that prevents save-storms during typing. It must survive the move into `useUpdateNoteContent`.

**Mitigation:** the new mutation hook owns the same `useDebouncedCallback` internally. The hook returns a `save(content)` function that debounces. The underlying `useMutation` is fired only when the debounce flushes. Optimistic update via `setQueryData` happens *immediately* on each call (so `useNoteQuery` returns the latest local content), the network call lags by ≤ 500ms.

### 7.3 Optimistic updates for star / rename / move

React Query supports optimistic updates well, but the invalidation contract has to be explicit and the rollback path has to be wired or the UI flickers on error.

**Mitigation:** for every mutation that the audit flagged (star, rename, move, share/unshare), the mutation hook follows the standard RQ optimistic recipe:

```ts
onMutate: async (input) => {
  await queryClient.cancelQueries({ queryKey });
  const previous = queryClient.getQueryData(queryKey);
  queryClient.setQueryData(queryKey, next);
  return { previous };
},
onError: (_err, _input, ctx) => {
  if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous);
},
onSettled: () => queryClient.invalidateQueries({ queryKey }),
```

For rename specifically: two keys change (`['notes','note', oldPath]` and `['notes','note', newPath]`) plus the tree. The mutation must snapshot both, move the cached entry, and reconcile on settle. The current `useNotes.renameNote` (`useNotes.ts:108`) does a full `refreshTree` + `openNote(newPath)`, which is a brief flicker; the optimistic version removes the flicker.

### 7.4 Phase boundaries that touch shared `@azrtydxb/ui` consumers

If any external consumer of `@azrtydxb/ui`'s `useUiNotes` exists (today: only the web client, but the abstraction implies future hosts), Phase 3's rewrite of `HttpAdapter.notes.list()` to read from the RQ cache must keep the *return type* and *subscribe contract* identical. The change is intentionally invisible to `@azrtydxb/ui`.

**Mitigation:** a small set of contract tests against `KrytonDataAdapter` (one suite that any conforming adapter must pass) gates Phase 3.

### 7.5 `treeKey` removal

The `treeKey = notes.tree.length` hack (`useAppState.ts:65`) is the only reason the graph refreshes when the tree changes today. Replacing it with explicit `invalidateQueries(['graph', userId])` from each mutation (Phase 2) must cover every code path that mutates the tree — including the daily-note path (`useAppCallbacks.ts:120`) and template creation (`:131`). A miss here means the graph silently stops updating.

**Mitigation:** centralise the invalidation in the mutation hooks (Phase 2), not at call sites. If `createNote` always invalidates `['graph', userId]`, the daily-note path inherits it for free.

### 7.6 Error surface

Today `useNotes.error` is the single string that feeds `ErrorToast` (`App.tsx:471`). After Phase 4 there are N mutation hooks each with their own `error` field.

**Mitigation:** add a tiny `useGlobalError()` selector that aggregates the latest non-null mutation error across the relevant hooks (or a `mutationCache.subscribe` listener that pushes errors into a toast queue in `useUIStore`). Keeps the existing UX unchanged.

---

## 8. Out of scope

Deferred to follow-ups:

- **Server-driven cache hints.** Adding `Cache-Control`/`ETag` headers on `/api/*` responses and using them to tune `staleTime` per response. Sensible improvement, orthogonal to the consolidation.
- **Suspense rollout.** RQ supports suspense queries; the codebase currently uses the imperative `useQuery` style consistently. Switching is a separate, app-wide UX decision (boundary placement, fallbacks).
- **Persisted RQ cache** (e.g. `persistQueryClient` to `localStorage`/IndexedDB). Useful for offline reload, but the existing offline-sync design (`2026-05-11-remove-sqlite-and-offline-sync-design.md`) covers that surface and we shouldn't preempt it here.
- **Native / electron `KrytonDataAdapter` implementations.** This design *enables* them by keeping `@azrtydxb/ui` on the adapter contract, but does not write them.
- **Refactor of `useUIStore`.** The Zustand store is fine; this design only adds a small `activeTabId` slot if it doesn't already exist (`useAppCallbacks.ts:50` already calls `useUIStore.getState().openTab(path)`, so the slot is there) and an `editingRegistry` for the Yjs/RQ bridge.
- **Graph endpoint redesign.** `/api/graph` returning a full graph payload is fine for the current scale; pagination/streaming is a separate concern.
- **Awareness (`y-protocols/awareness`).** `HttpAdapter.getAwareness` returns `null` today (`HttpAdapter.ts:530`). Real awareness wiring is its own design; this consolidation neither helps nor hurts it.

---

## 9. Worked example — what changes for "rename a note"

To make the migration plan concrete, here's how a rename flows today vs. after each phase.

### Today

1. User triggers rename → `useNotes.renameNote(oldPath, newPath)` (`useNotes.ts:108`).
2. `api.renameNote` HTTP call (`lib/api.ts:197`).
3. If `activeNote.path === oldPath`, call `openNote(newPath)` which fires `api.getNote`.
4. `refreshTree()` re-fetches `GET /api/notes` and replaces `tree`.
5. **Nothing** invalidates `['graph', userId, treeKey]` directly — it refreshes only because `treeKey = notes.tree.length` happens to change when the rename affects file count… but a rename doesn't change file count, so the graph silently keeps stale link labels until the server's `graph:updated` push arrives or the user reloads.
6. **Nothing** invalidates `['shares','withMe',userId]` — if the renamed note was shared with the current user, the sidebar's shared list shows the old name until reload.
7. **Nothing** invalidates the `HttpAdapter._notes` cache — any `useUiNotes` consumer in a plugin's React surface keeps the old entry.

That's the audit finding in three lines.

### After Phase 2

1. Same trigger → `useRenameNote()` mutation hook.
2. `onMutate`: snapshot `['notes','tree',userId]`, `['notes','note', oldPath]`. Optimistically rewrite the tree entry and move `['notes','note', oldPath]` → `['notes','note', newPath]`.
3. Network call.
4. `onError`: rollback both snapshots.
5. `onSettled`: `invalidateQueries({ queryKey: ['notes','tree',userId] })`, `invalidateQueries({ queryKey: ['graph', userId] })`, `invalidateQueries({ queryKey: ['shares','withMe',userId] })`, `invalidateQueries({ queryKey: ['backlinks-count', oldPath] })`, `invalidateQueries({ queryKey: ['backlinks-count', newPath] })`.
6. Everything that reads from those keys re-renders within one tick.

### After Phase 3

Same as Phase 2 for the user-initiated path. **Additionally**, if a *collaborator* renames the note via Yjs metadata, the adapter's `subscribe('notes', [id], …)` fires; the central bridge invalidates the same set of keys. The local user's sidebar and status bar update in seconds without polling.

### After Phase 4

The `useRenameNote()` hook is the only renaming code in the client; `useNotes.ts` no longer exists. The hook is unit-testable in isolation with a `QueryClient` test harness — no `useNotes` facade to mock around.

---

## 10. Open questions

- Should we split `useNotesQuery.ts` once it has 8+ hooks (`useFoldersQuery.ts`, `useSharesQuery.ts`, `useTagsQuery.ts`)? Probably yes after Phase 2 — flagged here for the implementer.
- Do we keep the `tabId` vs `path` duality (`packages/client/src/lib/api.ts:24`) or fold the "shared:" prefix into the path itself? Recommend keeping it — it's the cleanest way to disambiguate shared vs owned notes that share a path, and `useActiveNote()` can encapsulate the parsing.
- The owner-side `_noteShares` (in `HttpAdapter`) vs `useSharedNotes` (RQ, shared-with-me) are two *different* server endpoints (`/api/shares` vs `/api/shares/with-me`); both should get their own RQ key (`['shares','mine',userId]` and `['shares','withMe',userId]`). The audit conflated them — surface this to the reviewer.

---

## 11. Done definition

- `useNotes.ts` does not exist.
- `HttpAdapter` retains only: Yjs/WebSocket lifecycle, `subscribe`, `getSyncStatus`/`triggerSync`, `currentUser`. Its entity arrays are gone or are derived views over RQ.
- Every server-derived read in `packages/client/src/**` goes through a `useQuery`-backed hook declared in `packages/client/src/hooks/useNotesQuery.ts` (or sibling files).
- Every mutation declares exactly which query keys it invalidates, in the hook itself.
- `@azrtydxb/ui`'s `useUiNotes` family is unchanged and continues to work against the `KrytonDataAdapter` contract.
- The Sidebar shared section, the FileTree, the editor, the graph, and the status bar all update consistently after any mutation, without a manual refresh.
