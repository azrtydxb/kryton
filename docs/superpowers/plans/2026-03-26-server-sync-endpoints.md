# Server Sync Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pull/push sync endpoints to the Kryton server so the mobile app can synchronize notes, settings, shares, and trash bidirectionally using WatermelonDB.

**Architecture:** Two POST endpoints (`/api/sync/pull` and `/api/sync/push`) that return/accept changes in WatermelonDB's required format (created/updated/deleted arrays per table). Server tracks modifications via timestamps and deletions via a new SyncDeletion table. Only 4 tables are synced: notes, settings, note_shares, trash_items. Graph edges, tags, and folders are computed client-side from note content.

**Tech Stack:** TypeScript, Express, Prisma (SQLite), vitest

**Spec:** `docs/superpowers/specs/2026-03-26-mobile-app-design.md`

---

## File Structure

```
packages/server/
├── prisma/schema.prisma                          # Add TrashItem, SyncDeletion models; add updatedAt to Settings
├── src/
│   ├── routes/sync.ts                            # New — pull/push sync endpoints
│   ├── routes/__tests__/sync.test.ts             # New — sync endpoint tests
│   ├── services/noteService.ts                   # Modify — record deletions in SyncDeletion
│   ├── routes/trash.ts                           # Modify — record trash operations in TrashItem model
│   └── index.ts                                  # Modify — mount sync routes
```

---

### Task 1: Schema Migration — Add TrashItem, SyncDeletion, Settings.updatedAt

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

- [ ] **Step 1: Add new models and field to schema**

Add these to the end of `schema.prisma`:

```prisma
model TrashItem {
  id           String   @id @default(uuid())
  originalPath String
  userId       String
  trashedAt    DateTime @default(now())

  @@index([userId, trashedAt])
}

model SyncDeletion {
  id        String   @id @default(uuid())
  tableName String
  recordId  String
  userId    String
  deletedAt DateTime @default(now())

  @@index([userId, deletedAt])
}
```

Also modify the existing `Settings` model to add `updatedAt`:

```prisma
model Settings {
  key       String
  userId    String
  value     String
  updatedAt DateTime @default(now()) @updatedAt

  @@id([key, userId])
}
```

- [ ] **Step 2: Push schema to database**

```bash
DATABASE_URL="file:./data/kryton.db" npx prisma db push
```
Expected: Schema synced successfully

- [ ] **Step 3: Regenerate Prisma client**

```bash
npx prisma generate
```
Expected: Generated Prisma Client

- [ ] **Step 4: Commit**

```bash
git add packages/server/prisma/schema.prisma packages/server/src/generated/
git commit -m "feat(sync): add TrashItem, SyncDeletion models and Settings.updatedAt"
```

---

### Task 2: Record Deletions in SyncDeletion

**Files:**
- Modify: `packages/server/src/services/noteService.ts`
- Modify: `packages/server/src/routes/trash.ts`

- [ ] **Step 1: Record note deletion in SyncDeletion**

In `packages/server/src/services/noteService.ts`, add to the `deleteNote` function after the `moveToTrash` call:

```typescript
// Record deletion for sync
await prisma.syncDeletion.create({
  data: {
    tableName: "notes",
    recordId: notePath,
    userId,
  },
});

// Record trash creation for sync
await prisma.trashItem.create({
  data: {
    originalPath: notePath,
    userId,
  },
});
```

Import `prisma` at the top if not already imported.

- [ ] **Step 2: Record trash restore/permanent delete in SyncDeletion**

In `packages/server/src/routes/trash.ts`, in the restore handler, add:

```typescript
// Record trash item removal for sync
await prisma.syncDeletion.create({
  data: { tableName: "trash_items", recordId: trashItem.id, userId: user.id },
});
await prisma.trashItem.deleteMany({
  where: { originalPath: notePath, userId: user.id },
});
```

In the permanent delete handler, add the same SyncDeletion record.

In the empty trash handler, record all items being emptied.

- [ ] **Step 3: Record note share deletion in SyncDeletion**

Find where NoteShare records are deleted (in `noteService.ts` and `routes/shares.ts`) and add a `syncDeletion.create` call.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/noteService.ts packages/server/src/routes/trash.ts
git commit -m "feat(sync): record deletions in SyncDeletion table for mobile sync"
```

---

### Task 3: Sync Pull Endpoint

**Files:**
- Create: `packages/server/src/routes/sync.ts`
- Create: `packages/server/src/routes/__tests__/sync.test.ts`

- [ ] **Step 1: Write failing tests for pull**

```typescript
// packages/server/src/routes/__tests__/sync.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("sync pull", () => {
  it("returns empty changes on first sync (lastPulledAt = 0)", async () => {
    // Test that pull with lastPulledAt=0 returns full data
  });

  it("returns only changes since lastPulledAt", async () => {
    // Test delta sync
  });

  it("includes deleted records from SyncDeletion", async () => {
    // Test that deleted note paths appear in notes.deleted
  });

  it("returns 401 without auth", async () => {
    // Test auth requirement
  });
});
```

- [ ] **Step 2: Implement sync pull endpoint**

Create `packages/server/src/routes/sync.ts`:

```typescript
import { Router, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { requireUser, requireScope } from "../middleware/auth.js";
import { getUserNotesDir } from "../services/userNotesDir.js";
import { readNote, scanDirectory } from "../services/noteService.js";
import * as path from "path";
import * as fs from "fs/promises";

export function createSyncRouter(notesDir: string): Router {
  const router = Router();

  // POST /api/sync/pull
  router.post("/pull", async (req: Request, res: Response) => {
    try {
      const user = requireUser(req);
      const lastPulledAt = req.body.last_pulled_at
        ? new Date(req.body.last_pulled_at)
        : new Date(0);
      const now = new Date();
      const userId = user.id;

      // 1. Notes — from SearchIndex (has modifiedAt)
      const changedNotes = await prisma.searchIndex.findMany({
        where: { userId, modifiedAt: { gt: lastPulledAt } },
      });

      const userDir = getUserNotesDir(notesDir, userId);
      const noteRecords = await Promise.all(
        changedNotes.map(async (n) => {
          let content = "";
          try {
            content = await fs.readFile(path.join(userDir, n.notePath), "utf-8");
          } catch { /* file may have been deleted */ }
          return {
            id: n.notePath,
            path: n.notePath,
            title: n.title,
            content,
            tags: n.tags, // JSON string
            modified_at: n.modifiedAt.getTime(),
          };
        })
      );

      // Determine created vs updated based on lastPulledAt
      // If lastPulledAt is epoch 0 (first sync), everything is "created"
      const isFirstSync = lastPulledAt.getTime() === 0;
      const notesCreated = isFirstSync ? noteRecords : [];
      const notesUpdated = isFirstSync ? [] : noteRecords;

      // 2. Settings
      const changedSettings = await prisma.settings.findMany({
        where: { userId, updatedAt: { gt: lastPulledAt } },
      });
      const settingRecords = changedSettings.map((s) => ({
        id: `${s.key}:${s.userId}`,
        key: s.key,
        value: s.value,
      }));

      // 3. NoteShares
      const changedShares = await prisma.noteShare.findMany({
        where: {
          OR: [
            { ownerUserId: userId, updatedAt: { gt: lastPulledAt } },
            { sharedWithUserId: userId, updatedAt: { gt: lastPulledAt } },
          ],
        },
      });
      const shareRecords = changedShares.map((s) => ({
        id: s.id,
        owner_user_id: s.ownerUserId,
        path: s.path,
        is_folder: s.isFolder,
        permission: s.permission,
        shared_with_user_id: s.sharedWithUserId,
      }));

      // 4. TrashItems
      const changedTrash = await prisma.trashItem.findMany({
        where: { userId, trashedAt: { gt: lastPulledAt } },
      });
      const trashRecords = changedTrash.map((t) => ({
        id: t.id,
        original_path: t.originalPath,
        trashed_at: t.trashedAt.getTime(),
      }));

      // 5. Deletions from SyncDeletion
      const deletions = await prisma.syncDeletion.findMany({
        where: { userId, deletedAt: { gt: lastPulledAt } },
      });

      const deletedByTable: Record<string, string[]> = {
        notes: [],
        settings: [],
        note_shares: [],
        trash_items: [],
      };
      for (const d of deletions) {
        if (deletedByTable[d.tableName]) {
          deletedByTable[d.tableName].push(d.recordId);
        }
      }

      res.json({
        changes: {
          notes: {
            created: isFirstSync ? noteRecords : [],
            updated: isFirstSync ? [] : noteRecords,
            deleted: deletedByTable.notes,
          },
          settings: {
            created: isFirstSync ? settingRecords : [],
            updated: isFirstSync ? [] : settingRecords,
            deleted: deletedByTable.settings,
          },
          note_shares: {
            created: isFirstSync ? shareRecords : [],
            updated: isFirstSync ? [] : shareRecords,
            deleted: deletedByTable.note_shares,
          },
          trash_items: {
            created: isFirstSync ? trashRecords : [],
            updated: isFirstSync ? [] : trashRecords,
            deleted: deletedByTable.trash_items,
          },
        },
        timestamp: now.getTime(),
      });
    } catch (err: any) {
      console.error("[sync] Pull error:", err);
      res.status(500).json({ error: "Sync pull failed" });
    }
  });

  return router;
}
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run packages/server/src/routes/__tests__/sync.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/sync.ts packages/server/src/routes/__tests__/sync.test.ts
git commit -m "feat(sync): add pull endpoint for WatermelonDB sync"
```

---

### Task 4: Sync Push Endpoint

**Files:**
- Modify: `packages/server/src/routes/sync.ts`

- [ ] **Step 1: Add push tests**

Add tests for push to the existing test file:
- Pushing a created note writes the file and indexes it
- Pushing an updated note overwrites the file
- Pushing a deleted note moves it to trash
- Pushing settings upserts them
- Push is idempotent (creating a note that exists upserts)

- [ ] **Step 2: Implement push endpoint**

Add to `sync.ts` inside the router:

```typescript
  // POST /api/sync/push
  router.post("/push", async (req: Request, res: Response) => {
    try {
      const user = requireUser(req);
      requireScope(req, "read-write");
      const userId = user.id;
      const userDir = getUserNotesDir(notesDir, userId);
      const changes = req.body.changes || {};

      // 1. Notes
      if (changes.notes) {
        const { created = [], updated = [] , deleted = [] } = changes.notes;

        for (const note of [...created, ...updated]) {
          const notePath = note.path;
          const content = note.content || "";
          await writeNote(userDir, notePath, content, userId);
        }

        for (const notePath of deleted) {
          try {
            await deleteNote(userDir, notePath, userId);
          } catch {
            // Already deleted — idempotent
          }
        }
      }

      // 2. Settings
      if (changes.settings) {
        const { created = [], updated = [] } = changes.settings;
        for (const setting of [...created, ...updated]) {
          await prisma.settings.upsert({
            where: { key_userId: { key: setting.key, userId } },
            create: { key: setting.key, userId, value: setting.value },
            update: { value: setting.value },
          });
        }
      }

      // Note: note_shares and trash_items are read-only on mobile
      // (sharing is managed via web UI, trash is managed via note deletion)

      res.json({});
    } catch (err: any) {
      console.error("[sync] Push error:", err);
      res.status(500).json({ error: "Sync push failed" });
    }
  });
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run packages/server/src/routes/__tests__/sync.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/sync.ts packages/server/src/routes/__tests__/sync.test.ts
git commit -m "feat(sync): add push endpoint for WatermelonDB sync"
```

---

### Task 5: Mount Sync Routes and Rate Limiting

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Import and mount sync router**

Add import:
```typescript
import { createSyncRouter } from "./routes/sync.js";
```

Add route mount (after other API routes, before error handler):
```typescript
// Sync endpoints — separate rate limit (20 syncs / 15 min)
const syncLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.apiKey?.id || req.user?.id || req.ip || "unknown",
  message: { error: "Sync rate limit exceeded" },
});
app.use("/api/sync", authMiddleware, syncLimiter, createSyncRouter(NOTES_DIR));
```

- [ ] **Step 2: Add kryton:// to trustedOrigins**

In `packages/server/src/auth.ts`, update the `trustedOrigins` array:
```typescript
trustedOrigins: [APP_URL, "kryton://"],
```

- [ ] **Step 3: Test manually**

```bash
npm run dev --workspace=packages/server
```

Then test with curl:
```bash
# Pull (first sync)
curl -X POST http://localhost:3001/api/sync/pull \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kryton_<your-api-key>" \
  -d '{"last_pulled_at": 0}'

# Push
curl -X POST http://localhost:3001/api/sync/push \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer kryton_<your-api-key>" \
  -d '{"changes":{"notes":{"created":[{"id":"test.md","path":"test.md","title":"Test","content":"# Test"}],"updated":[],"deleted":[]}}}'
```

- [ ] **Step 4: Run full test suite**

```bash
npm test --workspace=packages/server
```
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/auth.ts
git commit -m "feat(sync): mount sync routes with rate limiting, add kryton:// to trustedOrigins"
```

---

### Task 6: Cleanup old SyncDeletion records

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Add cleanup on server startup**

In the startup section of `index.ts` (near the trash purge), add:

```typescript
// Clean up old sync deletion records (older than 90 days)
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
await prisma.syncDeletion.deleteMany({
  where: { deletedAt: { lt: new Date(Date.now() - NINETY_DAYS_MS) } },
});
log.info("Sync deletion cleanup complete.");
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(sync): auto-cleanup SyncDeletion records older than 90 days"
```
