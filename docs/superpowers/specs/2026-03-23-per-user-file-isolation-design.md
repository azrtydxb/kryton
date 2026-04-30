# Per-User File Isolation — Multi-User Sub-Project 2 of 3

**Date:** 2026-03-23
**Scope:** Restructure note storage so each user has an isolated directory and all DB queries are scoped by userId. No sharing yet (sub-project 3).

## Goals

- Each user's notes live in `notes/{userId}/`
- All API routes scope file operations and DB queries to the authenticated user
- Search index, graph edges, and settings are per-user
- New users get fresh sample notes on registration
- Clean break from v1.0.0 shared storage (no migration, clean slate)

## Non-Goals

- Note sharing between users (sub-project 3)
- Changing the client (API shapes stay the same)
- Changing auth flows (sub-project 1 is complete)

---

## File Storage

### Directory Structure

```
notes/
  {userId-1}/          # UUID directory per user
    Welcome.md
    Projects/
      Kryton Roadmap.md
    Daily/
      2026-03-23.md
  {userId-2}/
    Welcome.md
    Ideas/
      My Ideas.md
```

### User Directory Lifecycle

**On registration:** Create `notes/{userId}/` directory and populate with fresh sample notes (same Welcome, Roadmap, Ideas, Templates, Daily note content as the current `SAMPLE_NOTES` in index.ts).

**On user deletion (soft):** Delete the user's SearchIndex, GraphEdge, and Settings rows from DB. Keep `notes/{userId}/` on disk — admin can manually clean up the filesystem.

### Helper

New file `packages/server/src/services/userNotesDir.ts`:

```ts
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getUserNotesDir(baseDir: string, userId: string): Promise<string> {
  // Defense in depth: validate UUID format even though userId comes from JWT
  if (!UUID_REGEX.test(userId)) throw new Error("Invalid userId format");
  const dir = path.join(baseDir, userId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
```

**Security:** `userId` must always come from `req.user.id` (the validated JWT payload), never from request parameters. The UUID validation is an extra safety layer.

All route handlers call this instead of using `NOTES_DIR` directly.

---

## Database Schema Changes

### SearchIndex — add userId

| Column | Type | Notes |
|--------|------|-------|
| userId | TEXT | Not null, added column, `@Index()` |

**Primary key change:** Current PK is `notePath` alone. Change to compound PK `(notePath, userId)` — multiple users will have identical paths (e.g., `Welcome.md` from sample notes).

All existing SearchIndex queries add `WHERE userId = :userId`.

### GraphEdge — add userId

| Column | Type | Notes |
|--------|------|-------|
| userId | TEXT | Not null, added column, `@Index()` |

All existing GraphEdge queries add `WHERE userId = :userId`.

### Settings — add userId

| Column | Type | Notes |
|--------|------|-------|
| userId | TEXT | **Nullable** — null = global setting |

- Per-user settings (starred, preferences): `userId = req.user.id`
- Global settings (registration_mode): `userId IS NULL`
- The Settings primary key changes from `key` alone to `(key, userId)` compound — because the same key (e.g., "starred") exists per user

### Migration Strategy

TypeORM `synchronize: true` handles column additions. On first server start after deploy:

1. Old-style notes (files directly in `notes/` root, not in UUID subdirectories) are moved to `notes/.backup-pre-multiuser/` with a console warning — not deleted, in case operator has important data
2. Orphaned SearchIndex/GraphEdge/Settings rows (without valid userId) are deleted on startup
3. The compound PK change on SearchIndex and Settings may require TypeORM to recreate the tables — the startup cleanup in step 2 ensures no data loss since old rows are deleted anyway
4. Re-create the `registration_mode = open` global setting if it was lost during table recreation

---

## Route Changes

### Notes, Folders, Daily, Templates — file-based routes

All routes that take `NOTES_DIR` currently use it directly for file operations. Change to resolve per-user:

```ts
// Before
const fullPath = path.join(NOTES_DIR, notePath);

// After
const userDir = await getUserNotesDir(NOTES_DIR, req.user!.id);
const fullPath = path.join(userDir, notePath);
```

**Affected route files:**
- `routes/notes.ts` — GET list, GET by path, POST create, PUT update, DELETE, and the rename router
- `routes/folders.ts` — POST create, DELETE, and the rename router
- `routes/daily.ts` — POST create/get daily note. Also update `getDailyTemplate()` to query Settings with userId, falling back to global (userId IS NULL)
- `routes/templates.ts` — GET list, GET by name (templates are per-user)
- `routes/canvas.ts` — GET list, POST create, GET/PUT/DELETE by name. Canvas files are stored in a `Canvas/` subdir under the user's notes dir
- `index.ts` — inline `/api/files/{path}` route. **The path traversal check must validate against the per-user directory (`userDir`), not the global `NOTES_DIR`**

Each route already has `req.user` from authMiddleware (sub-project 1). The `NOTES_DIR` parameter to router factories stays — it's the base directory. The per-user resolution happens inside each handler.

### Search — add userId filter

`routes/search.ts` and `services/searchService.ts`:
- `search(query, userId)` — add `WHERE userId = :userId` to the query builder
- `indexNote(notePath, content, userId)` — set userId on the SearchIndex entry
- `removeFromIndex(notePath, userId)` — filter by userId when deleting
- `renameInIndex(oldPath, newPath, userId)` — filter by userId
- `indexAllNotes(baseDir)` → `indexUserNotes(baseDir, userId)` — index one user's notes

### Graph — add userId filter

`routes/graph.ts` and `services/graphService.ts`:
- `buildGraph(notesDir, userId)` — scan user's directory, create GraphEdge rows with userId
- `getGraph(userId)` — filter edges by userId
- Graph rebuild on note create/update/delete scopes to the user

### Settings — scope by userId

`routes/settings.ts`:
- GET `/api/settings` — returns settings `WHERE userId = req.user.id OR userId IS NULL`. User-specific values take precedence over global ones for the same key.
- PUT `/api/settings/:key` — upserts with `userId = req.user.id` (deny-list for admin-only keys still applies)
- Admin-only keys (`registration_mode`) remain `userId = null` and are managed via admin routes

### Backlinks — add userId filter

`routes/backlinks.ts`:
- Query GraphEdge with `WHERE userId = :userId` when finding backlinks

### Tags — add userId filter

`routes/tags.ts`:
- `getAllTags(userId)` — filter SearchIndex by userId
- `getNotesByTag(tag, userId)` — filter by userId

---

## Startup Changes

In `index.ts`, the current `main()` function:

1. ~~Creates sample notes in global `notes/`~~ → Remove this. Sample notes are created per-user on registration.
2. ~~Indexes all notes globally~~ → Remove global indexing. Notes are indexed per-user when created or on first login.
3. Clean up old shared notes on startup (if `notes/` contains files directly, not in UUID subdirectories)

### Per-user indexing on registration

When a new user is created (email registration in `routes/auth.ts` POST `/register` AND OAuth new-user creation in `routes/auth.ts` OAuth callbacks — after `resolveOAuthUser` returns a newly created user):
1. Create `notes/{userId}/`
2. Write sample notes to the directory
3. Index all notes for that user (SearchIndex + GraphEdge)

**Implementation:** Extract provisioning into a shared function (e.g., `provisionUserNotes(baseDir, userId)` in `services/userNotesDir.ts`). Call it from both the register endpoint and the OAuth callback handlers. `resolveOAuthUser` should return a flag indicating whether the user was newly created so the callback knows to provision.

### Re-indexing

Add an endpoint or startup hook for re-indexing a user's notes. For now, indexing happens:
- On registration (full index of sample notes)
- On note create/update/delete (incremental)

---

## Admin Route Changes

`routes/admin.ts`:
- `DELETE /admin/users/:id` — in addition to deleting auth records, also delete SearchIndex, GraphEdge, and Settings rows for that userId. Keep filesystem directory.

---

## Files Modified

- `packages/server/src/entities/SearchIndex.ts` — add userId column + `@Index()`, change PK to compound `(notePath, userId)`
- `packages/server/src/entities/GraphEdge.ts` — add userId column + `@Index()`
- `packages/server/src/entities/Settings.ts` — add userId column (nullable) + `@Index()`, change PK to compound `(key, userId)`
- `packages/server/src/services/noteService.ts` — per-user indexing
- `packages/server/src/services/searchService.ts` — userId filtering on all functions
- `packages/server/src/services/graphService.ts` — userId filtering
- `packages/server/src/services/oauthService.ts` — `resolveOAuthUser` returns flag for newly-created user
- `packages/server/src/routes/notes.ts` — resolve user notes dir (both main and rename routers)
- `packages/server/src/routes/folders.ts` — resolve user notes dir (both main and rename routers)
- `packages/server/src/routes/search.ts` — pass userId to service
- `packages/server/src/routes/graph.ts` — pass userId to service
- `packages/server/src/routes/settings.ts` — scope by userId, compound key handling, GET returns user + global settings
- `packages/server/src/routes/backlinks.ts` — userId filtering
- `packages/server/src/routes/tags.ts` — userId filtering
- `packages/server/src/routes/daily.ts` — resolve user notes dir, update getDailyTemplate() for userId
- `packages/server/src/routes/templates.ts` — resolve user notes dir
- `packages/server/src/routes/canvas.ts` — resolve user notes dir for canvas file storage
- `packages/server/src/routes/auth.ts` — provision user dir + sample notes on registration and OAuth new-user creation
- `packages/server/src/routes/admin.ts` — delete user's DB records on user deletion
- `packages/server/src/index.ts` — remove global sample notes creation, remove global indexing, update file serving route (path traversal check against userDir), add startup cleanup + backup

## Files Created

- `packages/server/src/services/userNotesDir.ts` — helper to resolve and ensure per-user directory

## Files NOT Modified

- All client files — API shapes unchanged
- Auth entities (User, AuthProvider, RefreshToken, InviteCode) — unchanged
- Auth middleware, token service — unchanged
