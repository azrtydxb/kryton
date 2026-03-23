# Note Sharing — Multi-User Sub-Project 3 of 3

**Date:** 2026-03-23
**Scope:** Allow users to share individual notes or entire folders with other users, with read or read-write permissions. Shared notes appear in sidebar, search, and graph with visual distinction. Access request system for inaccessible links.

## Goals

- Share individual notes or folders with specific users (read or read-write)
- Owner can revoke access or change permissions at any time
- Shared notes appear in recipient's sidebar under a "Shared" virtual folder
- Shared notes appear in search results with a shared indicator
- Shared notes appear as orange nodes in the graph
- Graph only shows links to notes the viewer has access to
- Clicking an inaccessible link shows "no access" with option to request access
- Note owner can approve/deny access requests

## Non-Goals

- Public link sharing (share with anyone via URL)
- Real-time collaborative editing (two users editing simultaneously)
- Sharing with groups/teams
- Notification system beyond the access request list

---

## Database Schema

### NoteShare

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| ownerUserId | UUID | FK → User, CASCADE delete |
| path | TEXT | File or folder path relative to owner's dir |
| isFolder | BOOLEAN | true = all files in folder, false = single file |
| sharedWithUserId | UUID | FK → User, CASCADE delete |
| permission | TEXT | `read` or `readwrite` |
| createdAt | TIMESTAMP | Auto-set |
| updatedAt | TIMESTAMP | Auto-set |

Unique constraint on `(ownerUserId, path, sharedWithUserId)`.

**Cascade cleanup:** NoteShare uses `@ManyToOne(() => User, { onDelete: 'CASCADE' })` for both FKs. However, following the existing pattern (admin.ts uses explicit deletes), the admin user-delete handler must also explicitly delete NoteShare rows where `ownerUserId = deletedId OR sharedWithUserId = deletedId`, and AccessRequest rows where `requesterUserId = deletedId OR ownerUserId = deletedId`.

### AccessRequest

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| requesterUserId | UUID | FK → User, CASCADE delete |
| ownerUserId | UUID | FK → User, CASCADE delete |
| notePath | TEXT | The note being requested |
| status | TEXT | `pending`, `approved`, `denied` |
| createdAt | TIMESTAMP | Auto-set |

Unique constraint on `(requesterUserId, ownerUserId, notePath)` — one request per note per user. If a request was previously denied and the user requests again, update the existing row's status back to `pending`.

---

## Share Service

New file: `packages/server/src/services/shareService.ts`

### hasAccess(ownerUserId, path, requestingUserId)

Returns `{ canRead: boolean, canWrite: boolean }`. Checks:
1. Direct NoteShare for this exact path
2. Folder shares covering this path — walk up parent directories (e.g., if `Projects/` is shared, `Projects/Roadmap.md` is accessible)
3. Return highest permission found (readwrite > read)
4. If no share found, return `{ canRead: false, canWrite: false }`

### getSharedNotesForUser(userId)

Returns all notes/folders shared with this user. Joins NoteShare with User (owner) to include owner name. Used by sidebar and graph.

### getAccessiblePaths(userId)

Returns a set of all paths this user can access (own notes + shared notes). Used by graph link filtering.

---

## API Endpoints

### Share Routes — `packages/server/src/routes/shares.ts`

All require `authMiddleware`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/shares` | Create share. Body: `{ path, isFolder, sharedWithUserId, permission }`. Only the file/folder owner can share. |
| GET | `/api/shares` | List shares I've created (as owner) |
| GET | `/api/shares/with-me` | List notes/folders shared with me. Returns `{ shares: [...], owners: { userId: name } }` |
| PUT | `/api/shares/:id` | Update permission. Only the owner can update. |
| DELETE | `/api/shares/:id` | Revoke share. Only the owner can delete. |

### Access Request Routes — in `packages/server/src/routes/shares.ts`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/access-requests` | Request access. Body: `{ ownerUserId, notePath }`. Creates pending request. |
| GET | `/api/access-requests` | List pending requests where I'm the owner. |
| GET | `/api/access-requests/mine` | List my outgoing requests (and their status). |
| PUT | `/api/access-requests/:id` | Approve or deny. Body: `{ action: "approve" | "deny", permission?: "read" | "readwrite" }`. On approve, creates NoteShare. Only the owner can action. |

### User Search — for Share Dialog

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/search?email=...` | Search users by exact email match. Returns `{ id, name, email }`. Requires auth. Only exact match for privacy — no prefix/fuzzy search. |

This endpoint is needed for the ShareDialog to find users to share with.

---

## Security

### Path Traversal on Shared Routes

The shared note route `/api/notes/shared/{ownerUserId}/{path}` takes `ownerUserId` from the URL (untrusted). Security requirements:
1. **UUID validation** on `ownerUserId` — reuse `getUserNotesDir()` which validates UUID format
2. **Path traversal check** — resolved path must stay within `notes/{ownerUserId}/` (same defense as regular note routes)
3. **Permission check BEFORE filesystem access** — verify NoteShare exists before reading/writing any file
4. Order of operations: validate UUID → check NoteShare permission → resolve path → verify no traversal → access file

### SQL Wildcard Escaping for Folder Shares

When searching shared notes via folder shares, the LIKE pattern for folder path prefix matching must escape `%` and `_` wildcards in the folder path to prevent malicious share paths from matching unintended rows:
```ts
const escapedPath = folderPath.replace(/%/g, '\\%').replace(/_/g, '\\_');
// Use: s.notePath LIKE :prefix with prefix = `${escapedPath}%`
```

### Backlink Access Filtering

Backlinks from shared notes should only be shown if the viewer has access to the linking note. If user A's note links to user B's note, user B only sees the backlink if A's note is shared with B.

---

## Route Changes for Shared Note Access

### notes.ts

When a user opens a note, the route needs to check:
1. Is this the user's own note? → read from `notes/{userId}/`
2. Is this a shared note? → check NoteShare, read from `notes/{ownerUserId}/`

**Implementation:** Add a query parameter or path prefix to distinguish. Simplest approach: shared notes are accessed via `/api/notes/shared/{ownerUserId}/{path}` — a new route group that:
- Checks NoteShare for `{ ownerUserId, path, sharedWithUserId: req.user.id }`
- If read permission: serve the file from owner's directory
- If readwrite + PUT request: write to owner's directory, re-index under owner's userId
- No permission: 403

The existing `/api/notes/{path}` routes remain unchanged (user's own notes).

### search.ts / searchService.ts

`search(query, userId)` changes to also search shared notes:
1. Query own SearchIndex rows (`WHERE userId = :userId`)
2. Query SearchIndex rows for shared notes: join NoteShare where `sharedWithUserId = :userId`, match notePath
3. For folder shares: match SearchIndex notePath starting with the shared folder path
4. Return combined results with an `isShared` flag and `ownerUserId` on shared results

### graph.ts / graphService.ts

`getFullGraph(userId)` changes:
1. Get own nodes and edges (current behavior)
2. Get shared notes (from NoteShare) and their edges from the owner's GraphEdge rows
3. **Filter links:** Only include edges where BOTH source and target are accessible to the viewer (own note or shared note). Remove edges where one end is inaccessible.
4. Return nodes with a `shared` flag and `ownerUserId` so the client renders them differently

**Node ID namespacing:** Shared nodes use `{ownerUserId}:{notePath}` as their ID to avoid collision with the viewer's own notes at the same path. Own nodes keep the current `notePath` format. The client must handle both formats in click handlers.

**Write-through clarification:** Search and graph for shared notes always query the **owner's** SearchIndex/GraphEdge rows. No duplicate index entries are created for recipients. When a readwrite recipient edits a shared note, the re-indexing updates the owner's rows.

### backlinks.ts

When showing backlinks for a note, include backlinks from shared notes (where the shared note links to the current note).

---

## Note Rename/Delete Cascade

When the owner renames or deletes a shared note:

**Rename:** Update the `path` column in all NoteShare rows matching the old path. For folder shares, update the folder path. For individual shares of files within a renamed folder, update the path prefix.

**Delete:** Delete NoteShare rows for that exact path. For folder shares that covered the deleted file, the share remains (it still covers other files in the folder).

This logic belongs in `noteService.ts` `renameNote()` and `deleteNote()` functions — they already handle SearchIndex and GraphEdge updates.

---

## Frontend Changes

### Sidebar — "Shared" Virtual Folder

In `packages/client/src/components/Sidebar/Sidebar.tsx`:

- Add a "Shared" section below the file tree (similar to "Starred" section)
- Fetch from `GET /api/shares/with-me`
- Group by owner: "Shared / {owner name} / {path}"
- Show a share icon (lucide `Share2`) next to shared items
- Clicking opens the shared note via the shared route

### Share Dialog

New component: `packages/client/src/components/Sharing/ShareDialog.tsx`

- Modal triggered from:
  - Right-click context menu in sidebar → "Share..."
  - Share button in note toolbar
- Content:
  - Search field to find users by email
  - Permission picker (read / read-write)
  - "Share" button
  - List of current shares with permission display and revoke button
  - For folders: checkbox "Share entire folder"

### Graph — Shared Nodes

In `packages/client/src/components/Graph/GraphView.tsx`:

- Shared nodes render in **orange** (`#f97316` / orange-500)
- Own nodes: purple (current)
- Starred: yellow star (current)
- Active: green (current)
- Links only rendered between accessible nodes

The graph API response includes a `shared` flag per node. GraphView checks this in the draw function.

### Note Toolbar

- Add share button (Share2 icon) next to edit/star/export
- When viewing a shared note: show "Shared by {owner}" label + permission badge (read-only / read-write)
- If read-only shared note: hide edit button

### Access Request Flow

- When clicking an inaccessible `[[wiki-link]]` in preview:
  - Show toast: "You don't have access to '{note name}'"
  - Toast includes "Request Access" button
  - Clicking sends `POST /api/access-requests`
  - Toast updates: "Access requested"

- For note owners to manage requests:
  - Add to UserMenu dropdown: "Access Requests" (with count badge if pending > 0)
  - Clicking opens a simple modal listing pending requests with Approve/Deny buttons
  - Approve prompts for permission level (read / read-write)

### Search Results

- Shared note results show a share icon
- Clicking navigates via the shared route

---

## Files Created

### Server
- `packages/server/src/entities/NoteShare.ts`
- `packages/server/src/entities/AccessRequest.ts`
- `packages/server/src/services/shareService.ts`
- `packages/server/src/routes/shares.ts`
- `packages/server/src/routes/users.ts` — user search endpoint

### Client
- `packages/client/src/components/Sharing/ShareDialog.tsx`
- `packages/client/src/components/Sharing/AccessRequestsModal.tsx`

## Files Modified

### Server
- `packages/server/src/data-source.ts` — register NoteShare, AccessRequest entities
- `packages/server/src/routes/notes.ts` — add shared note read/write routes
- `packages/server/src/services/searchService.ts` — include shared notes in search
- `packages/server/src/services/graphService.ts` — include shared nodes, filter links by access
- `packages/server/src/routes/backlinks.ts` — include shared note backlinks
- `packages/server/src/routes/graph.ts` — pass share context
- `packages/server/src/index.ts` — mount shares and users routes
- `packages/server/src/services/noteService.ts` — cascade NoteShare on rename/delete
- `packages/server/src/routes/admin.ts` — clean up NoteShare/AccessRequest on user delete

### Client
- `packages/client/src/components/Sidebar/Sidebar.tsx` — "Shared" section
- `packages/client/src/components/Graph/GraphView.tsx` — orange shared nodes, link filtering
- `packages/client/src/components/Graph/GraphPanel.tsx` — pass shared data
- `packages/client/src/components/Search/SearchBar.tsx` — share icon on results
- `packages/client/src/components/Preview/Preview.tsx` — access request on inaccessible links
- `packages/client/src/components/Layout/UserMenu.tsx` — access requests link with badge
- `packages/client/src/App.tsx` — share dialog state, access requests modal, toolbar share button
- `packages/client/src/lib/api.ts` — share and access-request API methods

## Files NOT Modified

- Auth system (entities, middleware, token service) — unchanged
- Editor component — unchanged (edits go through existing note routes)
- Theme, resize handles, outline pane — unchanged
