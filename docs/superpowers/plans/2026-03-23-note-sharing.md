# Note Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to share notes/folders with other users (read or read-write), with shared notes visible in sidebar, search, and graph, plus an access request system.

**Architecture:** New NoteShare and AccessRequest entities. A shareService for permission checks. New share/access-request API routes + user search. Shared note read/write via `/api/notes/shared/{ownerUserId}/{path}`. Search and graph extended to include shared notes with access filtering. Frontend: share dialog, sidebar "Shared" section, orange graph nodes, access request flow.

**Tech Stack:** TypeORM (entities), Express 5 (routes), React 19 (components), Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-03-23-note-sharing-design.md`

**Working directory:** All paths relative to `/Users/pascal/Development/mnemo`.

**Critical security notes:**
- Shared note routes validate ownerUserId as UUID, check NoteShare permission BEFORE filesystem access, and verify path traversal against owner's directory
- Search with folder shares escapes SQL wildcards (`%`, `_`) in LIKE patterns
- Graph node IDs use `{ownerUserId}:{notePath}` namespace for shared nodes to avoid collisions
- Backlinks only show if viewer has access to the linking note
- Prevent self-sharing (`sharedWithUserId != req.user.id`)
- Mount shared note routes at `/api/notes/shared` as a SEPARATE mount BEFORE the general `/api/notes` wildcard router to avoid route conflicts
- Access request routes are mounted at `/api/access-requests` (separate from `/api/shares`)
- Folder share permission check uses `POSITION(path IN :requestedPath) = 1` (not LIKE on column) to avoid SQL wildcard issues in stored paths
- Update client-side `GraphData` and `SearchResult` TypeScript interfaces with new shared fields

---

## Task 1: Create NoteShare and AccessRequest entities

**Files:**
- Create: `packages/server/src/entities/NoteShare.ts`
- Create: `packages/server/src/entities/AccessRequest.ts`
- Modify: `packages/server/src/data-source.ts`

- [ ] **Step 1: Create NoteShare entity**

Create `packages/server/src/entities/NoteShare.ts` with:
- `@PrimaryGeneratedColumn("uuid") id`
- `@ManyToOne(() => User, { onDelete: "CASCADE" })` + `@Column("text") ownerUserId`
- `@Column("text") path` — file or folder path relative to owner's dir
- `@Column("boolean") isFolder`
- `@ManyToOne(() => User, { onDelete: "CASCADE" })` + `@Column("text") sharedWithUserId`
- `@Column("text") permission` — "read" or "readwrite"
- `@CreateDateColumn() createdAt`, `@UpdateDateColumn() updatedAt`
- `@Unique(["ownerUserId", "path", "sharedWithUserId"])`

Follow existing entity patterns (explicit column types like `@Column("text")`).

- [ ] **Step 2: Create AccessRequest entity**

Create `packages/server/src/entities/AccessRequest.ts`:
- `@PrimaryGeneratedColumn("uuid") id`
- `@ManyToOne(() => User, { onDelete: "CASCADE" })` + `@Column("text") requesterUserId`
- `@ManyToOne(() => User, { onDelete: "CASCADE" })` + `@Column("text") ownerUserId`
- `@Column("text") notePath`
- `@Column("text", { default: "pending" }) status` — pending/approved/denied
- `@CreateDateColumn() createdAt`
- `@Unique(["requesterUserId", "ownerUserId", "notePath"])`

- [ ] **Step 3: Register entities in data-source.ts**

Add NoteShare and AccessRequest to the entities array.

- [ ] **Step 4: Verify and commit**

```bash
cd /Users/pascal/Development/mnemo && npm run typecheck && npm run build
git add -A && git commit -m "feat: add NoteShare and AccessRequest entities"
```

---

## Task 2: Create shareService

**Files:**
- Create: `packages/server/src/services/shareService.ts`

- [ ] **Step 1: Create shareService**

Create `packages/server/src/services/shareService.ts` with:

**`hasAccess(ownerUserId, path, requestingUserId)`** → `{ canRead, canWrite }`:
1. Query NoteShare where `ownerUserId`, `sharedWithUserId = requestingUserId`
2. Check exact path match (`path = :path AND isFolder = false`)
3. Check folder shares — use `POSITION` instead of LIKE to avoid SQL wildcard issues: `isFolder = true AND POSITION(path IN :requestedPath) = 1` (checks if the requested path starts with the shared folder path). This is safe regardless of wildcards in stored paths.
4. No LIKE escaping needed with the POSITION approach
5. Return highest permission found

**`getSharedNotesForUser(userId)`** → array of shares with owner info:
- Query NoteShare where `sharedWithUserId = userId`
- Join with User to get owner name
- Return `{ id, ownerUserId, ownerName, path, isFolder, permission }`

**`getAccessibleSharedPaths(userId)`** → for graph filtering:
- Get all NoteShare for this user
- For file shares: return the exact path with ownerUserId
- For folder shares: query owner's SearchIndex to expand folder into individual note paths

- [ ] **Step 2: Verify and commit**

```bash
cd /Users/pascal/Development/mnemo && npm run typecheck && npm run build
git add -A && git commit -m "feat: add shareService with permission checks"
```

---

## Task 3: Create share and access-request API routes + user search

**Files:**
- Create: `packages/server/src/routes/shares.ts`
- Create: `packages/server/src/routes/users.ts`

- [ ] **Step 1: Create shares.ts**

Create `packages/server/src/routes/shares.ts` exporting `createSharesRouter()` AND `createAccessRequestsRouter()` (two separate routers in one file):

**Share endpoints (mounted at `/api/shares`):**
- `POST /` — create share. Validate: ownerUserId = req.user.id, **sharedWithUserId != req.user.id** (no self-sharing). Body: `{ path, isFolder, sharedWithUserId, permission }`.
- `GET /` — list shares created by me.
- `GET /with-me` — list shares with me. Call `getSharedNotesForUser(req.user.id)`.
- `PUT /:id` — update permission. Verify ownerUserId = req.user.id.
- `DELETE /:id` — revoke. Verify ownerUserId = req.user.id.

**Access request endpoints (mounted at `/api/access-requests` — separate router):**
- `POST /` — create request. Body: `{ ownerUserId, notePath }`. If denied request exists for same combo, update status to `pending`.
- `GET /` — list pending requests where `ownerUserId = req.user.id`.
- `GET /mine` — list my outgoing requests.
- `PUT /:id` — approve/deny. Verify ownerUserId = req.user.id. Body: `{ action, permission? }`. On approve, create NoteShare.

Add `@swagger` annotations to all endpoints.

- [ ] **Step 2: Create users.ts**

Create `packages/server/src/routes/users.ts` exporting `createUsersRouter()`:
- `GET /search?email=...` — exact email match. Returns `{ id, name, email }` or 404. Requires auth.

- [ ] **Step 3: Verify and commit**

```bash
cd /Users/pascal/Development/mnemo && npm run typecheck && npm run build
git add -A && git commit -m "feat: add share, access-request, and user search routes"
```

---

## Task 4: Add shared note read/write routes + mount everything

**Files:**
- Modify: `packages/server/src/routes/notes.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Add shared note routes to notes.ts**

Add a new router factory `createSharedNotesRouter(notesDir)` in notes.ts (or a separate file). Routes:

- `GET /shared/{ownerUserId}/{*path}` — read a shared note:
  1. Validate ownerUserId UUID via `getUserNotesDir`
  2. Check permission: `hasAccess(ownerUserId, path, req.user.id)` → canRead required
  3. Resolve path in owner's dir, path traversal check against ownerDir
  4. Read and return file content

- `PUT /shared/{ownerUserId}/{*path}` — write a shared note:
  1. Same validation + permission check (canWrite required)
  2. Write to owner's file
  3. Re-index under **owner's** userId
  4. Rebuild owner's graph cache

- `GET /shared/{ownerUserId}` (no path) — list files in a shared folder (if folder share)

- [ ] **Step 2: Mount routes in index.ts**

Add to index.ts. **IMPORTANT: mount shared note routes BEFORE the general `/api/notes` wildcard router to avoid route conflicts:**
```ts
import { createSharesRouter, createAccessRequestsRouter } from "./routes/shares";
import { createUsersRouter } from "./routes/users";

// Mount BEFORE the general /api/notes router:
app.use("/api/notes/shared", authMiddleware, createSharedNotesRouter(NOTES_DIR));

// Then the existing notes router (with wildcard {*path}):
// app.use("/api/notes", authMiddleware, createNotesRouter(NOTES_DIR)); // already exists

app.use("/api/shares", authMiddleware, createSharesRouter());
app.use("/api/access-requests", authMiddleware, createAccessRequestsRouter());
app.use("/api/users", authMiddleware, createUsersRouter());
```

- [ ] **Step 3: Verify and commit**

```bash
cd /Users/pascal/Development/mnemo && npm run typecheck && npm run lint && npm run build
git add -A && git commit -m "feat: add shared note read/write routes, mount share routes"
```

---

## Task 5: Update search to include shared notes

**Files:**
- Modify: `packages/server/src/services/searchService.ts`

- [ ] **Step 1: Update search function**

The `search(query, userId)` function currently only searches own notes. Add a second query for shared notes:

1. Keep existing own-notes query (using Brackets)
2. Add shared notes query: join NoteShare → SearchIndex where `NoteShare.sharedWithUserId = userId` and SearchIndex matches the query
3. For folder shares: use escaped LIKE pattern for path prefix
4. Mark shared results with `isShared: true` and `ownerUserId`
5. Combine and deduplicate results

Update the `SearchResult` interface to include optional `isShared` and `ownerUserId` fields.

- [ ] **Step 2: Verify and commit**

```bash
cd /Users/pascal/Development/mnemo && npm run typecheck && npm run build
git add -A && git commit -m "feat: include shared notes in search results"
```

---

## Task 6: Update graph to include shared nodes with filtering

**Files:**
- Modify: `packages/server/src/services/graphService.ts`
- Modify: `packages/server/src/routes/graph.ts`

- [ ] **Step 1: Update graphService**

`getFullGraph(userId)` changes:
1. Get own nodes and edges (current)
2. Get shared notes via shareService → for each, get their SearchIndex entry (owner's) and GraphEdge entries (owner's)
3. Namespace shared node IDs: `{ownerUserId}:{notePath}`
4. Build accessible paths set: own notePaths + shared notePaths (namespaced)
5. Filter ALL edges: only include if both source and target are in the accessible set
6. Add `shared: boolean` and `ownerUserId?: string` flags to each node

- [ ] **Step 2: Update graph.ts route**

Pass the response with the new node format. The client already handles node rendering by checking properties.

- [ ] **Step 3: Verify and commit**

```bash
cd /Users/pascal/Development/mnemo && npm run typecheck && npm run build
git add -A && git commit -m "feat: include shared nodes in graph with access filtering"
```

---

## Task 7: Update backlinks and noteService cascade

**Files:**
- Modify: `packages/server/src/routes/backlinks.ts`
- Modify: `packages/server/src/services/noteService.ts`
- Modify: `packages/server/src/routes/admin.ts`

- [ ] **Step 1: Update backlinks**

`getBacklinks` should also check for backlinks from shared notes. Only include if the viewer has access to the linking note (call `hasAccess`).

- [ ] **Step 2: Update noteService rename/delete cascade**

In `renameNote()`: after renaming SearchIndex/GraphEdge, also update NoteShare path for matching rows.
In `deleteNote()`: delete NoteShare rows for the exact path.

- [ ] **Step 3: Update admin user delete**

In admin.ts DELETE handler, add cleanup:
```ts
await AppDataSource.getRepository(NoteShare).delete({ ownerUserId: deletedId });
await AppDataSource.getRepository(NoteShare).delete({ sharedWithUserId: deletedId });
await AppDataSource.getRepository(AccessRequest).delete({ requesterUserId: deletedId });
await AppDataSource.getRepository(AccessRequest).delete({ ownerUserId: deletedId });
```

- [ ] **Step 4: Verify and commit**

```bash
cd /Users/pascal/Development/mnemo && npm run typecheck && npm run lint && npm run build
git add -A && git commit -m "feat: backlink access filtering, share cascade on rename/delete"
```

---

## Task 8: Client API methods for sharing

**Files:**
- Modify: `packages/client/src/lib/api.ts`

- [ ] **Step 1: Add share and access-request API methods**

Add to api.ts:
```ts
export const shareApi = {
  create: (data: { path: string; isFolder: boolean; sharedWithUserId: string; permission: string }) =>
    request('/shares', { method: 'POST', body: JSON.stringify(data) }),
  list: () => request('/shares'),
  withMe: () => request('/shares/with-me'),
  update: (id: string, permission: string) =>
    request(`/shares/${id}`, { method: 'PUT', body: JSON.stringify({ permission }) }),
  revoke: (id: string) =>
    request(`/shares/${id}`, { method: 'DELETE' }),
  requestAccess: (ownerUserId: string, notePath: string) =>
    request('/access-requests', { method: 'POST', body: JSON.stringify({ ownerUserId, notePath }) }),
  listRequests: () => request('/access-requests'),
  myRequests: () => request('/access-requests/mine'),
  respondToRequest: (id: string, action: string, permission?: string) =>
    request(`/access-requests/${id}`, { method: 'PUT', body: JSON.stringify({ action, permission }) }),
  searchUser: (email: string) => request(`/users/search?email=${encodeURIComponent(email)}`),
};
```

Add shared note read/write methods:
```ts
export const sharedNoteApi = {
  read: (ownerUserId: string, path: string) =>
    request(`/notes/shared/${ownerUserId}/${encodeURIComponent(path)}`),
  write: (ownerUserId: string, path: string, content: string) =>
    request(`/notes/shared/${ownerUserId}/${encodeURIComponent(path)}`, {
      method: 'PUT', body: JSON.stringify({ content })
    }),
};
```

- [ ] **Step 2: Update TypeScript interfaces**

Update the `GraphData` interface in api.ts to include shared fields on nodes:
```ts
// nodes: { id, title, path, shared?: boolean, ownerUserId?: string }[]
```

Update the `SearchResult` interface to include shared fields:
```ts
export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  tags: string[];
  isShared?: boolean;
  ownerUserId?: string;
}
```

- [ ] **Step 3: Verify and commit**

```bash
cd /Users/pascal/Development/mnemo && npm run typecheck && npm run build
git add -A && git commit -m "feat: add share and access-request client API methods"
```

---

## Task 9: ShareDialog component

**Files:**
- Create: `packages/client/src/components/Sharing/ShareDialog.tsx`

- [ ] **Step 1: Create ShareDialog**

Modal component with props: `{ notePath: string; isFolder: boolean; onClose: () => void }`

Content:
- Email search field → calls `shareApi.searchUser(email)` on submit
- Found user display (name, email) with permission picker (read / read-write)
- **"Share entire folder" checkbox** (when the target is a folder) — sets `isFolder: true`
- "Share" button → calls `shareApi.create(...)` with the appropriate `isFolder` flag
- Current shares list (fetch from `shareApi.list()`, filter by path) with revoke buttons
- Error/success messages

Use `createPortal` to body. Dark themed matching existing modals.

**Also in Task 11:** Add a "Share..." option to the right-click context menu in the Sidebar (alongside existing Rename/Delete). This opens the ShareDialog for the clicked file/folder.

- [ ] **Step 2: Verify and commit**

```bash
cd /Users/pascal/Development/mnemo && npm run typecheck && npm run build
git add -A && git commit -m "feat: add ShareDialog component"
```

---

## Task 10: AccessRequestsModal component

**Files:**
- Create: `packages/client/src/components/Sharing/AccessRequestsModal.tsx`

- [ ] **Step 1: Create AccessRequestsModal**

Modal showing pending access requests for the current user (as owner).

- Fetch from `shareApi.listRequests()` on mount
- List: requester name/email, note path, approve/deny buttons
- Approve opens permission picker (read / read-write), then calls `shareApi.respondToRequest(id, "approve", permission)`
- Deny calls `shareApi.respondToRequest(id, "deny")`

- [ ] **Step 2: Verify and commit**

```bash
cd /Users/pascal/Development/mnemo && npm run typecheck && npm run build
git add -A && git commit -m "feat: add AccessRequestsModal component"
```

---

## Task 11: Sidebar "Shared" section

**Files:**
- Modify: `packages/client/src/components/Sidebar/Sidebar.tsx`

- [ ] **Step 1: Add "Shared" section**

Below the file tree and above the Tags section, add a "Shared" section:
- Fetch `shareApi.withMe()` on mount (or receive as prop from App.tsx)
- Group shares by owner name
- Render as: `Share2 icon` + owner name + path
- Click navigates to the shared note (using sharedNoteApi read path)
- Style similar to the "Starred" section

- [ ] **Step 2: Verify and commit**

```bash
cd /Users/pascal/Development/mnemo && npm run typecheck && npm run build
git add -A && git commit -m "feat: add Shared section to sidebar"
```

---

## Task 12: Graph — orange shared nodes

**Files:**
- Modify: `packages/client/src/components/Graph/GraphView.tsx`
- Modify: `packages/client/src/components/Graph/GraphPanel.tsx`

- [ ] **Step 1: Update graph rendering**

The graph API now returns nodes with `shared: boolean` flag. Update the draw function:
- Shared nodes: orange fill (`#f97316`) with orange stroke (`#ea580c`)
- Same size as regular nodes (6px), slightly larger when hovered (8px)
- Active shared node: still green (active takes precedence)
- Starred shared node: still yellow star (starred takes precedence)

Priority: active (green) > starred (yellow star) > shared (orange) > normal (purple)

Update click handler: shared node IDs use `{ownerUserId}:{notePath}` format — parse this to navigate to the shared note route.

Also update `GraphPanel.tsx` to pass the shared data through to GraphView if the graph API response includes shared flags per node.

- [ ] **Step 2: Verify and commit**

```bash
cd /Users/pascal/Development/mnemo && npm run typecheck && npm run build
git add -A && git commit -m "feat: render shared nodes as orange in graph"
```

---

## Task 13: App.tsx integration — share dialog, toolbar, access requests

**Files:**
- Modify: `packages/client/src/App.tsx`
- Modify: `packages/client/src/components/Layout/UserMenu.tsx`
- Modify: `packages/client/src/components/Preview/Preview.tsx`
- Modify: `packages/client/src/components/Search/SearchBar.tsx`

- [ ] **Step 1: Add share button to note toolbar**

In App.tsx, in both preview mode and edit mode toolbars, add a Share2 icon button that opens the ShareDialog for the current note.

Add state: `showShareDialog`, `shareTarget` (path + isFolder).

When viewing a shared note: show "Shared by {owner}" label, hide edit button if read-only.

- [ ] **Step 2: Add access requests to UserMenu**

In UserMenu.tsx, add "Access Requests" item with a count badge. Fetch pending count on mount. Clicking sets a state that opens AccessRequestsModal.

- [ ] **Step 3: Update Preview for inaccessible links**

In Preview.tsx, when a wiki-link click fails with 403/404 and the note belongs to another user, show a toast with "Request Access" button that calls `shareApi.requestAccess()`.

- [ ] **Step 4: Update SearchBar for shared results**

In SearchBar.tsx, if a search result has `isShared: true`, show a Share2 icon next to the result. Navigate via the shared route on click.

- [ ] **Step 5: Verify full pipeline**

```bash
cd /Users/pascal/Development/mnemo && npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: integrate sharing into App — toolbar, menu, preview, search"
```

---

## Task 14: Final verification and push

- [ ] **Step 1: Full build**

```bash
cd /Users/pascal/Development/mnemo
npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 2: Push**

```bash
git push
```

- [ ] **Step 3: Verify CI**

```bash
gh run watch $(gh run list --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```
