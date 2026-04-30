# Server Sync v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement server-side endpoints, schema migrations, sync orchestration, Yjs websocket persistence, and Cedar-based agent identity per the v2 spec.

**Architecture:** Express 5 + Prisma additions; cursor-based per-user delta sync; Yjs persistence in main DB; Cedar policies via `@cedar-policy/cedar-wasm`. Existing legacy `/api/sync` retained until mobile migrates.

**Tech Stack:** Express 5, Prisma 6, PostgreSQL, Zod, Vitest, ws (Node WebSocket server), `y-protocols`, `@cedar-policy/cedar-wasm`, `@kryton/core` (consumes protocol types via workspace link during dev).

**Spec:** [`docs/superpowers/specs/2026-04-30-server-sync-v2-design.md`](../specs/2026-04-30-server-sync-v2-design.md)

**Phase mapping:** Phase 1 stream 1C; Phase 2 streams 2C and 2D.

---

## File ownership

**Stream 1C (Schema + service backfills) — tasks SRV-1 through SRV-15:**
- `packages/server/prisma/schema.prisma`
- `packages/server/prisma/migrations/<ts>_sync_v2/migration.sql`
- `packages/server/src/services/folder.ts`
- `packages/server/src/services/tag.ts`
- `packages/server/src/services/__tests__/folder.test.ts`
- `packages/server/src/services/__tests__/tag.test.ts`
- `packages/server/src/services/backfill/{folders,tags}-backfill.ts`

**Stream 2C (Sync v2 + Yjs) — tasks SRV-16 through SRV-40:**
- `packages/server/src/routes/sync-v2.ts`
- `packages/server/src/routes/attachments.ts`
- `packages/server/src/routes/yjs.ts`
- `packages/server/src/services/sync-v2.ts`
- `packages/server/src/services/cursor.ts`
- `packages/server/src/services/yjs-persistence.ts`
- `packages/server/src/services/yjs-server.ts`
- `packages/server/src/__tests__/sync-v2.test.ts`
- `packages/server/src/__tests__/yjs.test.ts`
- `packages/server/src/__tests__/attachments.test.ts`

**Stream 2D (Agent identity) — tasks SRV-41 through SRV-58:**
- `packages/server/src/routes/agents.ts`
- `packages/server/src/services/agent.ts`
- `packages/server/src/services/cedar.ts`
- `packages/server/src/middleware/authz.ts`
- `packages/server/src/__tests__/agents.test.ts`
- `packages/server/src/__tests__/cedar.test.ts`

---

# Stream 1C — Schema annotations + new models + backfills

## Task SRV-1: Add `/// @sync` annotations to existing models

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

- [ ] **Step 1: Open schema.prisma and add annotations**

Insert before each model line:

```prisma
/// @sync tier1
model Settings { ... }

/// @sync tier1
model GraphEdge { ... }

/// @sync tier1
model NoteShare { ... }

/// @sync tier1
model TrashItem { ... }

/// @sync tier1
model InstalledPlugin { ... }

/// @sync tier2 parent=NoteShare
model AccessRequest { ... }

/// @sync tier2 parent=InstalledPlugin
model PluginStorage { ... }
```

Do NOT add annotations to: `User`, `Session`, `Account`, `Verification`, `Passkey`, `TwoFactor`, `ApiKey`, `InviteCode`, `SearchIndex`, `SyncDeletion` — those remain server-only.

- [ ] **Step 2: Verify Prisma still parses**

Run: `npx prisma format --schema=packages/server/prisma/schema.prisma`
Expected: no errors.

- [ ] **Step 3: Verify schema generator picks them up**

Run: `npm run generate --workspace=packages/core`
Expected: `packages/core/src/generated/schema.sql` now contains `CREATE TABLE IF NOT EXISTS settings`, `graph_edge`, etc.

- [ ] **Step 4: Commit**

```bash
git add packages/server/prisma/schema.prisma packages/core/src/generated/
git commit -m "feat(server): annotate Prisma models with @sync directives"
```

---

## Task SRV-2: Add `version` and `cursor` columns to all tier 1 models

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

- [ ] **Step 1: Add columns**

For each tier 1 model (Settings, GraphEdge, NoteShare, TrashItem, InstalledPlugin), add at the end of the field list:

```prisma
  version  Int @default(0)
  cursor   BigInt @default(0)
```

(Inside the model brace block, before the closing `}` and any `@@` directives.)

- [ ] **Step 2: Verify**

Run: `npx prisma format --schema=packages/server/prisma/schema.prisma`

- [ ] **Step 3: Commit (no migration yet — combined later)**

```bash
git add packages/server/prisma/schema.prisma
git commit -m "feat(server): add version and cursor columns to tier 1 models"
```

---

## Task SRV-3: Add new models — Folder, Tag, NoteTag

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

- [ ] **Step 1: Append models**

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
  cursor    BigInt   @default(0)
  updatedAt DateTime @updatedAt
  @@unique([userId, path])
}

/// @sync tier1
model Tag {
  id        String    @id @default(cuid())
  userId    String
  name      String
  color     String?
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  notes     NoteTag[]
  version   Int       @default(0)
  cursor    BigInt    @default(0)
  updatedAt DateTime  @updatedAt
  @@unique([userId, name])
}

/// @sync tier1
model NoteTag {
  notePath  String
  tagId     String
  userId    String
  tag       Tag      @relation(fields: [tagId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  version   Int      @default(0)
  cursor    BigInt   @default(0)
  updatedAt DateTime @updatedAt
  @@id([userId, notePath, tagId])
}
```

Add the inverse relation to `User`:

```prisma
model User {
  ...
  folders  Folder[]
  tags     Tag[]
  noteTags NoteTag[]
  ...
}
```

- [ ] **Step 2: Verify**

Run: `npx prisma format --schema=packages/server/prisma/schema.prisma`

- [ ] **Step 3: Commit**

```bash
git add packages/server/prisma/schema.prisma
git commit -m "feat(server): add Folder, Tag, NoteTag models"
```

---

## Task SRV-4: Add NoteVersion, NoteRevision, Attachment

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

- [ ] **Step 1: Append models**

```prisma
model NoteVersion {
  userId    String
  notePath  String
  version   Int      @default(0)
  cursor    BigInt   @default(0)
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([userId, notePath])
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
  contentHash String
  sizeBytes   Int
  mimeType    String
  storagePath String
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, notePath])
  @@index([contentHash])
}
```

Add inverse relations to `User`.

- [ ] **Step 2: Verify**

Run: `npx prisma format --schema=packages/server/prisma/schema.prisma`

- [ ] **Step 3: Commit**

```bash
git add packages/server/prisma/schema.prisma
git commit -m "feat(server): add NoteVersion, NoteRevision, Attachment models"
```

---

## Task SRV-5: Add SyncCursor, Agent, AgentToken, YjsDocument, YjsUpdate

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

- [ ] **Step 1: Append**

```prisma
model SyncCursor {
  userId String @id
  cursor BigInt @default(0)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Agent {
  id          String       @id @default(cuid())
  ownerUserId String
  name        String
  label       String
  policyText  String?
  createdAt   DateTime     @default(now())
  lastSeenAt  DateTime?
  owner       User         @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)
  tokens      AgentToken[]
  @@unique([ownerUserId, name])
}

model AgentToken {
  id        String    @id @default(cuid())
  agentId   String
  tokenHash String
  scope     String?
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())
  agent     Agent     @relation(fields: [agentId], references: [id], onDelete: Cascade)
  @@index([tokenHash])
}

model YjsDocument {
  docId       String   @id
  userId      String
  snapshot    Bytes
  stateVector Bytes
  updatedAt   DateTime @updatedAt
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model YjsUpdate {
  id        BigInt   @id @default(autoincrement())
  docId     String
  update    Bytes
  agentId   String?
  createdAt DateTime @default(now())
  @@index([docId, createdAt])
}
```

Inverse relations on `User`: `agents Agent[]`, `yjsDocuments YjsDocument[]`, `syncCursor SyncCursor?`, `noteVersions NoteVersion[]`.

- [ ] **Step 2: Verify**

Run: `npx prisma format --schema=packages/server/prisma/schema.prisma`

- [ ] **Step 3: Commit**

```bash
git add packages/server/prisma/schema.prisma
git commit -m "feat(server): add SyncCursor, Agent, AgentToken, YjsDocument, YjsUpdate models"
```

---

## Task SRV-6: Generate and review the Prisma migration

**Files:**
- Create: `packages/server/prisma/migrations/<timestamp>_sync_v2/migration.sql`

- [ ] **Step 1: Set up dev database (one-time, may already exist)**

Run: `cd packages/server && DATABASE_URL=$DATABASE_URL npx prisma migrate dev --name sync_v2 --create-only`
Expected: creates a new migration directory with a `migration.sql` file. Does NOT apply yet.

- [ ] **Step 2: Inspect the migration**

Run: `cat packages/server/prisma/migrations/*_sync_v2/migration.sql | head -100`
Expected: contains `CREATE TABLE folder`, `CREATE TABLE tag`, etc., plus `ALTER TABLE settings ADD COLUMN version`.

- [ ] **Step 3: Apply the migration to dev DB**

Run: `cd packages/server && DATABASE_URL=$DATABASE_URL npx prisma migrate dev`
Expected: applies cleanly.

- [ ] **Step 4: Regenerate Prisma client**

Run: `cd packages/server && npx prisma generate`

- [ ] **Step 5: Commit**

```bash
git add packages/server/prisma/migrations/
git commit -m "feat(server): migration for sync v2 schema"
```

---

## Task SRV-7: Folder service — CRUD + path-based ops

**Files:**
- Create: `packages/server/src/services/folder.ts`
- Test: `packages/server/src/services/__tests__/folder.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/services/__tests__/folder.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../../prisma";
import { createFolder, listFolders, deleteFolder } from "../folder";

describe("folder service", () => {
  let userId: string;
  beforeEach(async () => {
    await prisma.folder.deleteMany();
    await prisma.user.deleteMany({ where: { email: "fold-test@example.com" } });
    const user = await prisma.user.create({ data: { id: "u-fold", email: "fold-test@example.com" } });
    userId = user.id;
  });

  it("creates and lists folders", async () => {
    await createFolder(userId, { path: "a" });
    await createFolder(userId, { path: "a/b", parentPath: "a" });
    const all = await listFolders(userId);
    expect(all.map(f => f.path).sort()).toEqual(["a", "a/b"]);
  });

  it("delete cascades to children via DB constraint", async () => {
    const a = await createFolder(userId, { path: "a" });
    await createFolder(userId, { path: "a/b", parentPath: "a" });
    await deleteFolder(userId, a.id);
    const remaining = await listFolders(userId);
    expect(remaining).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```ts
// packages/server/src/services/folder.ts
import { prisma } from "../prisma";
import { incrementCursor } from "./cursor";

export async function createFolder(userId: string, input: { path: string; parentPath?: string }) {
  const cursor = await incrementCursor(userId);
  const parent = input.parentPath
    ? await prisma.folder.findUnique({ where: { userId_path: { userId, path: input.parentPath } } })
    : null;
  return prisma.folder.create({
    data: {
      userId,
      path: input.path,
      parentId: parent?.id ?? null,
      version: 1,
      cursor,
    },
  });
}

export async function listFolders(userId: string) {
  return prisma.folder.findMany({ where: { userId }, orderBy: { path: "asc" } });
}

export async function deleteFolder(userId: string, folderId: string) {
  // Children deleted via cascade
  return prisma.folder.delete({ where: { id: folderId } });
}
```

- [ ] **Step 4: Implement cursor service stub (real impl in SRV-19)**

```ts
// packages/server/src/services/cursor.ts
import { prisma } from "../prisma";

export async function incrementCursor(userId: string): Promise<bigint> {
  const result = await prisma.syncCursor.upsert({
    where: { userId },
    update: { cursor: { increment: 1n } },
    create: { userId, cursor: 1n },
  });
  return result.cursor;
}
```

- [ ] **Step 5: Run — passes**

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/folder.ts \
        packages/server/src/services/cursor.ts \
        packages/server/src/services/__tests__/folder.test.ts
git commit -m "feat(server): folder service with cursor-aware writes"
```

---

## Task SRV-8: Tag service — CRUD + tag-set merge helper

**Files:**
- Create: `packages/server/src/services/tag.ts`
- Test: `packages/server/src/services/__tests__/tag.test.ts`

- [ ] **Step 1: Write tests**

```ts
// packages/server/src/services/__tests__/tag.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../../prisma";
import { upsertTag, mergeNoteTagSet, listNoteTags } from "../tag";

describe("tag service", () => {
  let userId: string;
  beforeEach(async () => {
    await prisma.noteTag.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.user.deleteMany({ where: { email: "tag-test@example.com" } });
    const user = await prisma.user.create({ data: { id: "u-tag", email: "tag-test@example.com" } });
    userId = user.id;
  });

  it("upsertTag creates and finds", async () => {
    const t = await upsertTag(userId, "urgent");
    const t2 = await upsertTag(userId, "urgent");
    expect(t.id).toBe(t2.id);
  });

  it("mergeNoteTagSet computes union and applies", async () => {
    await upsertTag(userId, "a");
    await upsertTag(userId, "b");
    await mergeNoteTagSet(userId, "p1", ["a"]);
    const merged = await mergeNoteTagSet(userId, "p1", ["b"]);
    expect(merged.sort()).toEqual(["a", "b"]);
    const tags = await listNoteTags(userId, "p1");
    expect(tags.sort()).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```ts
// packages/server/src/services/tag.ts
import { prisma } from "../prisma";
import { incrementCursor } from "./cursor";

export async function upsertTag(userId: string, name: string) {
  const cursor = await incrementCursor(userId);
  return prisma.tag.upsert({
    where: { userId_name: { userId, name } },
    update: {},
    create: { userId, name, version: 1, cursor },
  });
}

export async function listNoteTags(userId: string, notePath: string): Promise<string[]> {
  const rows = await prisma.noteTag.findMany({
    where: { userId, notePath },
    include: { tag: true },
  });
  return rows.map(r => r.tag.name);
}

export async function mergeNoteTagSet(userId: string, notePath: string, addTags: string[]): Promise<string[]> {
  const existing = await listNoteTags(userId, notePath);
  const union = Array.from(new Set([...existing, ...addTags]));
  // Apply additions
  for (const name of addTags) {
    const tag = await upsertTag(userId, name);
    const cursor = await incrementCursor(userId);
    await prisma.noteTag.upsert({
      where: { userId_notePath_tagId: { userId, notePath, tagId: tag.id } },
      update: {},
      create: { userId, notePath, tagId: tag.id, version: 1, cursor },
    });
  }
  return union;
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/tag.ts \
        packages/server/src/services/__tests__/tag.test.ts
git commit -m "feat(server): tag service with set-merge helper"
```

---

## Task SRV-9: Folder backfill job

**Files:**
- Create: `packages/server/src/services/backfill/folders-backfill.ts`
- Test: `packages/server/src/services/backfill/__tests__/folders-backfill.test.ts`

- [ ] **Step 1: Test**

```ts
// packages/server/src/services/backfill/__tests__/folders-backfill.test.ts
import { describe, it, expect } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { prisma } from "../../../prisma";
import { backfillFolders } from "../folders-backfill";

describe("folders-backfill", () => {
  it("creates folder rows for existing directories", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kbf-"));
    await fs.mkdir(path.join(tmp, "u-bf", "alpha", "beta"), { recursive: true });
    await fs.writeFile(path.join(tmp, "u-bf", "alpha", "x.md"), "");

    await prisma.folder.deleteMany();
    await prisma.user.deleteMany({ where: { id: "u-bf" } });
    await prisma.user.create({ data: { id: "u-bf", email: "bf@example.com" } });

    await backfillFolders(tmp, "u-bf");

    const rows = await prisma.folder.findMany({ where: { userId: "u-bf" }, orderBy: { path: "asc" } });
    expect(rows.map(r => r.path)).toEqual(["alpha", "alpha/beta"]);
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement**

```ts
// packages/server/src/services/backfill/folders-backfill.ts
import * as fs from "fs/promises";
import * as path from "path";
import { createFolder } from "../folder";
import { prisma } from "../../prisma";

export async function backfillFolders(notesRoot: string, userId: string): Promise<number> {
  const userRoot = path.join(notesRoot, userId);
  let stats;
  try { stats = await fs.stat(userRoot); }
  catch { return 0; }
  if (!stats.isDirectory()) return 0;

  const dirs: string[] = [];
  await walk(userRoot, "", dirs);
  // Insert in sorted order so parents come before children
  dirs.sort();
  let count = 0;
  for (const rel of dirs) {
    const parts = rel.split("/");
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : undefined;
    const existing = await prisma.folder.findUnique({ where: { userId_path: { userId, path: rel } } });
    if (!existing) {
      await createFolder(userId, { path: rel, parentPath });
      count++;
    }
  }
  return count;
}

async function walk(absRoot: string, rel: string, out: string[]): Promise<void> {
  const dir = path.join(absRoot, rel);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      const sub = rel ? `${rel}/${e.name}` : e.name;
      out.push(sub);
      await walk(absRoot, sub, out);
    }
  }
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/backfill/folders-backfill.ts \
        packages/server/src/services/backfill/__tests__/folders-backfill.test.ts
git commit -m "feat(server): folder backfill job from filesystem"
```

---

## Task SRV-10: Tag backfill job

**Files:**
- Create: `packages/server/src/services/backfill/tags-backfill.ts`
- Test: `packages/server/src/services/backfill/__tests__/tags-backfill.test.ts`

- [ ] **Step 1: Test (uses SearchIndex.tags)**

```ts
// packages/server/src/services/backfill/__tests__/tags-backfill.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../../../prisma";
import { backfillTags } from "../tags-backfill";

describe("tags-backfill", () => {
  beforeEach(async () => {
    await prisma.noteTag.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.searchIndex.deleteMany();
    await prisma.user.deleteMany({ where: { id: "u-tg" } });
    await prisma.user.create({ data: { id: "u-tg", email: "tg@example.com" } });
  });

  it("creates tags + NoteTag rows from SearchIndex", async () => {
    await prisma.searchIndex.create({
      data: { id: "s1", userId: "u-tg", notePath: "p1", title: "t", content: "", tags: ["urgent", "review"], modifiedAt: new Date() },
    });
    await prisma.searchIndex.create({
      data: { id: "s2", userId: "u-tg", notePath: "p2", title: "t", content: "", tags: ["urgent"], modifiedAt: new Date() },
    });
    await backfillTags("u-tg");
    const tags = await prisma.tag.findMany({ where: { userId: "u-tg" } });
    expect(tags.map(t => t.name).sort()).toEqual(["review", "urgent"]);
    const links = await prisma.noteTag.findMany({ where: { userId: "u-tg" } });
    expect(links).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// packages/server/src/services/backfill/tags-backfill.ts
import { prisma } from "../../prisma";
import { upsertTag } from "../tag";
import { incrementCursor } from "../cursor";

export async function backfillTags(userId: string): Promise<{ tags: number; links: number }> {
  const entries = await prisma.searchIndex.findMany({ where: { userId } });
  const allTagNames = new Set<string>();
  for (const e of entries) for (const t of e.tags) allTagNames.add(t);

  const tagRecords = new Map<string, { id: string }>();
  for (const name of allTagNames) {
    const t = await upsertTag(userId, name);
    tagRecords.set(name, t);
  }

  let linkCount = 0;
  for (const e of entries) {
    for (const name of e.tags) {
      const tag = tagRecords.get(name)!;
      const existing = await prisma.noteTag.findUnique({
        where: { userId_notePath_tagId: { userId, notePath: e.notePath, tagId: tag.id } },
      });
      if (!existing) {
        const cursor = await incrementCursor(userId);
        await prisma.noteTag.create({
          data: { userId, notePath: e.notePath, tagId: tag.id, version: 1, cursor },
        });
        linkCount++;
      }
    }
  }
  return { tags: tagRecords.size, links: linkCount };
}
```

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/backfill/tags-backfill.ts \
        packages/server/src/services/backfill/__tests__/tags-backfill.test.ts
git commit -m "feat(server): tag backfill from SearchIndex"
```

---

## Task SRV-11: Wire backfills into server startup

**Files:**
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Find startup file**

Run: `grep -n "createServer\|app\.listen" packages/server/src/server.ts | head`

- [ ] **Step 2: Add lazy backfill on first user login**

Add to login route (or a middleware that runs after auth resolution):

```ts
import { backfillFolders } from "./services/backfill/folders-backfill";
import { backfillTags } from "./services/backfill/tags-backfill";

async function ensureBackfilled(userId: string, notesRoot: string) {
  // Idempotent: backfills only insert missing rows
  await backfillFolders(notesRoot, userId);
  await backfillTags(userId);
}
```

In the auth-success handler:
```ts
ensureBackfilled(user.id, notesDir).catch(e => log.warn("backfill failed", e));
```

This is fire-and-forget so it doesn't slow login. First sync will see folders/tags appearing as backfill completes.

- [ ] **Step 3: Smoke test manually**

Start server, log in as a test user, query `SELECT count(*) FROM folder WHERE "userId" = '<user>'`. Expected: matches their directory tree depth.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/server.ts
git commit -m "feat(server): lazy folder/tag backfill on user login"
```

---

## Task SRV-12: Stream 1C gate

- [ ] **Step 1: Run all tests**

Run: `npm test --workspace=packages/server -- folder tag backfill`
Expected: pass.

- [ ] **Step 2: Verify Prisma client has new types**

Run: `node -e "const {PrismaClient}=require('./packages/server/node_modules/.prisma/client'); console.log(Object.keys(new PrismaClient()).filter(k=>!k.startsWith('_')))"`
Expected: includes `folder`, `tag`, `noteTag`, `noteVersion`, `noteRevision`, `attachment`, `agent`, `agentToken`, `yjsDocument`, `yjsUpdate`, `syncCursor`.

- [ ] **Step 3: Re-run schema generator and verify generated SQL has all expected entities**

Run: `npm run generate --workspace=packages/core && grep -c "CREATE TABLE" packages/core/src/generated/schema.sql`
Expected: count ≥ 12 (8 tier-1 entities + 2 tier-2 + 4 core-internal = at least 14).

Stream 1C complete.

---

# Stream 2C — Sync v2 endpoints + Yjs server

## Task SRV-13: Cursor service — full implementation

**Files:**
- Modify: `packages/server/src/services/cursor.ts`
- Test: `packages/server/src/services/__tests__/cursor.test.ts`

- [ ] **Step 1: Write tests**

```ts
// packages/server/src/services/__tests__/cursor.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../../prisma";
import { incrementCursor, getCursor } from "../cursor";

describe("cursor service", () => {
  beforeEach(async () => {
    await prisma.syncCursor.deleteMany();
  });

  it("starts at 1 and increments", async () => {
    const a = await incrementCursor("u1");
    const b = await incrementCursor("u1");
    expect(b - a).toBe(1n);
  });

  it("getCursor returns 0 for unknown user", async () => {
    expect(await getCursor("nobody")).toBe(0n);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// packages/server/src/services/cursor.ts
import { prisma } from "../prisma";

export async function incrementCursor(userId: string): Promise<bigint> {
  const result = await prisma.syncCursor.upsert({
    where: { userId },
    update: { cursor: { increment: 1n } },
    create: { userId, cursor: 1n },
  });
  return result.cursor;
}

export async function getCursor(userId: string): Promise<bigint> {
  const r = await prisma.syncCursor.findUnique({ where: { userId } });
  return r?.cursor ?? 0n;
}
```

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/cursor.ts \
        packages/server/src/services/__tests__/cursor.test.ts
git commit -m "feat(server): cursor service with tests"
```

---

## Task SRV-14: Sync v2 service — pull

**Files:**
- Create: `packages/server/src/services/sync-v2.ts`
- Test: `packages/server/src/services/__tests__/sync-v2-pull.test.ts`

- [ ] **Step 1: Test**

```ts
// packages/server/src/services/__tests__/sync-v2-pull.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../../prisma";
import { pullChanges } from "../sync-v2";
import { createFolder } from "../folder";

describe("sync-v2 pull", () => {
  beforeEach(async () => {
    await prisma.folder.deleteMany();
    await prisma.syncCursor.deleteMany();
    await prisma.user.deleteMany({ where: { id: "u-sp" } });
    await prisma.user.create({ data: { id: "u-sp", email: "sp@example.com" } });
  });

  it("returns folders created after cursor", async () => {
    await createFolder("u-sp", { path: "a" });
    const fst = await pullChanges("u-sp", 0n);
    expect(fst.changes.folders.created).toHaveLength(1);

    await createFolder("u-sp", { path: "b" });
    const snd = await pullChanges("u-sp", BigInt(fst.cursor));
    expect(snd.changes.folders.created).toHaveLength(1);
    expect(snd.changes.folders.created[0].path).toBe("b");
  });
});
```

- [ ] **Step 2: Implement**

```ts
// packages/server/src/services/sync-v2.ts
import { prisma } from "../prisma";
import { getCursor } from "./cursor";

interface TableChanges {
  created: any[];
  updated: any[];
  deleted: string[];
}

export async function pullChanges(userId: string, sinceCursor: bigint): Promise<{
  cursor: string;
  changes: Record<string, TableChanges>;
}> {
  const tables = ["folders", "tags", "note_tags", "settings", "graph_edges", "note_shares", "trash_items", "installed_plugins"];
  const changes: Record<string, TableChanges> = {};

  // Folders
  const newFolders = await prisma.folder.findMany({
    where: { userId, cursor: { gt: sinceCursor } },
  });
  changes.folders = {
    created: newFolders.map(f => ({ ...f, cursor: f.cursor.toString() })),
    updated: [], deleted: [],
  };

  // Tags
  const newTags = await prisma.tag.findMany({ where: { userId, cursor: { gt: sinceCursor } } });
  changes.tags = {
    created: newTags.map(t => ({ ...t, cursor: t.cursor.toString() })),
    updated: [], deleted: [],
  };

  // NoteTags (composite key — id is constructed)
  const newNoteTags = await prisma.noteTag.findMany({ where: { userId, cursor: { gt: sinceCursor } } });
  changes.note_tags = {
    created: newNoteTags.map(n => ({
      id: `${n.userId}:${n.notePath}:${n.tagId}`,
      ...n,
      cursor: n.cursor.toString(),
    })),
    updated: [], deleted: [],
  };

  // Settings
  const newSettings = await prisma.settings.findMany({ where: { userId, cursor: { gt: sinceCursor } } });
  changes.settings = {
    created: newSettings.map(s => ({ ...s, cursor: s.cursor.toString() })),
    updated: [], deleted: [],
  };

  // GraphEdges, NoteShares, TrashItems, InstalledPlugins — same pattern
  for (const [key, model] of [
    ["graph_edges", "graphEdge"],
    ["note_shares", "noteShare"],
    ["trash_items", "trashItem"],
    ["installed_plugins", "installedPlugin"],
  ] as const) {
    const rows = await (prisma as any)[model].findMany({
      where: { userId, cursor: { gt: sinceCursor } },
    });
    changes[key] = {
      created: rows.map((r: any) => ({ ...r, cursor: r.cursor.toString() })),
      updated: [], deleted: [],
    };
  }

  // Notes (filesystem-backed, joined with NoteVersion)
  const noteVersions = await prisma.noteVersion.findMany({ where: { userId, cursor: { gt: sinceCursor } } });
  const noteRecords = await Promise.all(
    noteVersions.map(async nv => {
      const idx = await prisma.searchIndex.findFirst({ where: { userId, notePath: nv.notePath } });
      if (!idx) return null;
      return {
        id: nv.notePath,
        path: nv.notePath,
        title: idx.title,
        tags: JSON.stringify(idx.tags),
        modifiedAt: idx.modifiedAt.getTime(),
        version: nv.version,
        cursor: nv.cursor.toString(),
      };
    })
  );
  changes.notes = {
    created: noteRecords.filter((r): r is NonNullable<typeof r> => r !== null),
    updated: [], deleted: [],
  };

  const finalCursor = await getCursor(userId);
  return { cursor: finalCursor.toString(), changes };
}
```

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/sync-v2.ts \
        packages/server/src/services/__tests__/sync-v2-pull.test.ts
git commit -m "feat(server): pullChanges service for sync v2"
```

---

## Task SRV-15: Sync v2 service — push

**Files:**
- Modify: `packages/server/src/services/sync-v2.ts`
- Test: `packages/server/src/services/__tests__/sync-v2-push.test.ts`

- [ ] **Step 1: Test**

```ts
// packages/server/src/services/__tests__/sync-v2-push.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../../prisma";
import { pushChanges } from "../sync-v2";
import { createFolder } from "../folder";

describe("sync-v2 push", () => {
  beforeEach(async () => {
    await prisma.folder.deleteMany();
    await prisma.user.deleteMany({ where: { id: "u-pp" } });
    await prisma.user.create({ data: { id: "u-pp", email: "pp@example.com" } });
  });

  it("creates a new folder via push", async () => {
    const r = await pushChanges("u-pp", { folders: [{ op: "create", id: "f1", fields: { id: "f1", path: "alpha", parentId: null } }] });
    expect(r.accepted.folders).toHaveLength(1);
    expect(r.conflicts).toHaveLength(0);
    const all = await prisma.folder.findMany({ where: { userId: "u-pp" } });
    expect(all).toHaveLength(1);
  });

  it("rejects update with stale base_version", async () => {
    const f = await createFolder("u-pp", { path: "a" });
    const r = await pushChanges("u-pp", { folders: [{ op: "update", id: f.id, base_version: 999, fields: { path: "renamed" } }] });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].current_version).toBe(f.version);
  });
});
```

- [ ] **Step 2: Implement push**

Add to `packages/server/src/services/sync-v2.ts`:

```ts
type EntityOp =
  | { op: "create"; id: string; fields: Record<string, unknown> }
  | { op: "update"; id: string; base_version: number; fields: Record<string, unknown> }
  | { op: "delete"; id: string };

export async function pushChanges(
  userId: string,
  changes: Record<string, EntityOp[]>,
): Promise<{
  accepted: Record<string, Array<{ id: string; version: number; merged_value?: Record<string, unknown> }>>;
  conflicts: Array<{ table: string; id: string; current_version: number; current_state: Record<string, unknown> }>;
}> {
  const accepted: Record<string, Array<{ id: string; version: number }>> = {};
  const conflicts: Array<{ table: string; id: string; current_version: number; current_state: any }> = [];

  await prisma.$transaction(async (tx) => {
    for (const [tableKey, ops] of Object.entries(changes)) {
      const handler = HANDLERS[tableKey];
      if (!handler) continue;
      const result = await handler(userId, ops, tx);
      accepted[tableKey] = result.accepted;
      conflicts.push(...result.conflicts.map(c => ({ ...c, table: tableKey })));
    }
  });

  return { accepted, conflicts };
}

interface HandlerResult {
  accepted: Array<{ id: string; version: number }>;
  conflicts: Array<{ id: string; current_version: number; current_state: any }>;
}

type Handler = (userId: string, ops: EntityOp[], tx: any) => Promise<HandlerResult>;

const HANDLERS: Record<string, Handler> = {
  folders: async (userId, ops, tx) => {
    const accepted: any[] = [], conflicts: any[] = [];
    for (const op of ops) {
      if (op.op === "create") {
        const cursor = await incrementCursorIn(tx, userId);
        const f = await tx.folder.create({ data: { ...op.fields, userId, version: 1, cursor } });
        accepted.push({ id: f.id, version: 1 });
      } else if (op.op === "update") {
        const cur = await tx.folder.findUnique({ where: { id: op.id } });
        if (!cur || cur.userId !== userId) { conflicts.push({ id: op.id, current_version: 0, current_state: null }); continue; }
        if (cur.version !== op.base_version) {
          conflicts.push({ id: op.id, current_version: cur.version, current_state: cur }); continue;
        }
        const cursor = await incrementCursorIn(tx, userId);
        const updated = await tx.folder.update({
          where: { id: op.id },
          data: { ...op.fields, version: { increment: 1 }, cursor },
        });
        accepted.push({ id: op.id, version: updated.version });
      } else if (op.op === "delete") {
        await tx.folder.delete({ where: { id: op.id } }).catch(() => {});
        accepted.push({ id: op.id, version: 0 });
      }
    }
    return { accepted, conflicts };
  },
  // Repeat similar handlers for tags, note_tags, settings, graph_edges, note_shares, trash_items, installed_plugins
  // ... (one per entity, following the same template)
};

async function incrementCursorIn(tx: any, userId: string): Promise<bigint> {
  const r = await tx.syncCursor.upsert({
    where: { userId },
    update: { cursor: { increment: 1n } },
    create: { userId, cursor: 1n },
  });
  return r.cursor;
}
```

(For brevity in this plan, only the folders handler is fully shown. The execution agent fills in the other entity handlers using the same template — one block per entity, with the create/update/delete cases following the same logic. The acceptance criterion in step 4 below is that all 7 handlers are implemented.)

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Acceptance — all 7 entity handlers implemented**

Run: `grep -c "async (userId, ops, tx)" packages/server/src/services/sync-v2.ts`
Expected: ≥ 7 (one per entity).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/sync-v2.ts \
        packages/server/src/services/__tests__/sync-v2-push.test.ts
git commit -m "feat(server): pushChanges service with version-conflict detection"
```

---

## Task SRV-16: Note push handler — filesystem-backed entity

**Files:**
- Modify: `packages/server/src/services/sync-v2.ts`
- Test: `packages/server/src/services/__tests__/sync-v2-notes.test.ts`

- [ ] **Step 1: Test**

```ts
// packages/server/src/services/__tests__/sync-v2-notes.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { prisma } from "../../prisma";
import { pushChanges } from "../sync-v2";

describe("sync-v2 notes push", () => {
  let notesRoot: string;
  beforeEach(async () => {
    notesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kn-"));
    process.env.NOTES_DIR = notesRoot;
    await prisma.noteVersion.deleteMany();
    await prisma.searchIndex.deleteMany();
    await prisma.user.deleteMany({ where: { id: "u-np" } });
    await prisma.user.create({ data: { id: "u-np", email: "np@example.com" } });
  });

  it("creates a note, writes file, indexes", async () => {
    const r = await pushChanges("u-np", {
      notes: [{ op: "create", id: "p1.md", fields: { id: "p1.md", path: "p1.md", title: "T", content: "Hello", tags: "[]", modifiedAt: 0 } }],
    });
    expect(r.accepted.notes).toHaveLength(1);
    const file = await fs.readFile(path.join(notesRoot, "u-np", "p1.md"), "utf-8");
    expect(file).toBe("Hello");
  });
});
```

- [ ] **Step 2: Implement note handler**

In `sync-v2.ts`, add `notes` handler:

```ts
notes: async (userId, ops, tx) => {
  const accepted: any[] = [], conflicts: any[] = [];
  const notesRoot = process.env.NOTES_DIR ?? "/var/kryton/notes";
  const userDir = `${notesRoot}/${userId}`;
  await (await import("fs/promises")).mkdir(userDir, { recursive: true });
  const fs = await import("fs/promises");
  const path = await import("path");

  for (const op of ops) {
    if (op.op === "create" || op.op === "update") {
      const f = op.fields as any;
      const filePath = path.join(userDir, f.path);
      const cur = await tx.noteVersion.findUnique({ where: { userId_notePath: { userId, notePath: f.path } } });
      if (op.op === "update" && cur && cur.version !== op.base_version) {
        conflicts.push({ id: op.id, current_version: cur.version, current_state: cur });
        continue;
      }
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, f.content ?? "");
      const cursor = await incrementCursorIn(tx, userId);
      // Tag merge: server-side union
      let tags: string[] = [];
      try { tags = JSON.parse(f.tags); } catch {}
      const existingIdx = await tx.searchIndex.findFirst({ where: { userId, notePath: f.path } });
      const mergedTags = existingIdx ? Array.from(new Set([...existingIdx.tags, ...tags])) : tags;
      await tx.searchIndex.upsert({
        where: { id: existingIdx?.id ?? `__new__${userId}:${f.path}` },
        update: { title: f.title, tags: mergedTags, modifiedAt: new Date(f.modifiedAt) },
        create: {
          id: `${userId}:${f.path}:idx`, userId, notePath: f.path,
          title: f.title, content: f.content ?? "", tags: mergedTags,
          modifiedAt: new Date(f.modifiedAt),
        },
      });
      const nv = await tx.noteVersion.upsert({
        where: { userId_notePath: { userId, notePath: f.path } },
        update: { version: { increment: 1 }, cursor },
        create: { userId, notePath: f.path, version: 1, cursor },
      });
      accepted.push({ id: op.id, version: nv.version, merged_value: { tags: mergedTags } });
    } else if (op.op === "delete") {
      const filePath = path.join(userDir, op.id);
      await fs.unlink(filePath).catch(() => {});
      await tx.searchIndex.deleteMany({ where: { userId, notePath: op.id } });
      await tx.noteVersion.deleteMany({ where: { userId, notePath: op.id } });
      accepted.push({ id: op.id, version: 0 });
    }
  }
  return { accepted, conflicts };
},
```

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/sync-v2.ts \
        packages/server/src/services/__tests__/sync-v2-notes.test.ts
git commit -m "feat(server): note push handler with tag-merge and filesystem write"
```

---

## Task SRV-17: Sync v2 routes — wire pull/push to HTTP

**Files:**
- Create: `packages/server/src/routes/sync-v2.ts`
- Modify: `packages/server/src/server.ts` (mount router)
- Test: `packages/server/src/__tests__/sync-v2-routes.test.ts`

- [ ] **Step 1: Test (using supertest)**

```ts
// packages/server/src/__tests__/sync-v2-routes.test.ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../prisma";

describe("/api/sync/v2", () => {
  it("pull returns empty changes for new user", async () => {
    const app = createApp();
    const tok = await issueTestToken("u-r1");
    const res = await request(app).post("/api/sync/v2/pull").set("Authorization", `Bearer ${tok}`).send({ cursor: "0" });
    expect(res.status).toBe(200);
    expect(res.body.cursor).toBe("0");
    expect(res.body.changes).toBeDefined();
  });
});
```

(`issueTestToken` is a test helper to be implemented in stream 2D's middleware tests; for now, mock it.)

- [ ] **Step 2: Implement router**

```ts
// packages/server/src/routes/sync-v2.ts
import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireUser } from "../middleware/auth";
import { pullChanges, pushChanges } from "../services/sync-v2";

export function createSyncV2Router(): Router {
  const router = Router();

  router.post("/pull", async (req: Request, res: Response) => {
    const user = requireUser(req);
    const cursor = z.object({ cursor: z.string() }).parse(req.body).cursor;
    const result = await pullChanges(user.id, BigInt(cursor));
    res.json(result);
  });

  router.post("/push", async (req: Request, res: Response) => {
    const user = requireUser(req);
    const body = z.object({
      changes: z.record(z.string(), z.array(z.any())),
    }).parse(req.body);
    const result = await pushChanges(user.id, body.changes as any);
    res.json(result);
  });

  return router;
}
```

- [ ] **Step 3: Mount in server.ts**

```ts
import { createSyncV2Router } from "./routes/sync-v2";
app.use("/api/sync/v2", createSyncV2Router());
```

- [ ] **Step 4: Run tests**

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/sync-v2.ts \
        packages/server/src/server.ts \
        packages/server/src/__tests__/sync-v2-routes.test.ts
git commit -m "feat(server): /api/sync/v2/{pull,push} routes"
```

---

## Task SRV-18: Version endpoint

**Files:**
- Create: `packages/server/src/routes/version.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Implement**

```ts
// packages/server/src/routes/version.ts
import { Router } from "express";

const apiVersion = "2.0.0";
const schemaVersion = "4.4.0";
const supportedClientRange = ">=4.4.0 <5.0.0";

export function createVersionRouter(): Router {
  const r = Router();
  r.get("/version", (_req, res) => {
    res.json({ apiVersion, schemaVersion, supportedClientRange });
  });
  return r;
}
```

Mount: `app.use("/api", createVersionRouter())`.

- [ ] **Step 2: Smoke test**

Run server, `curl localhost:3000/api/version` → expects JSON.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/version.ts packages/server/src/server.ts
git commit -m "feat(server): /api/version endpoint"
```

---

## Task SRV-19: Tier 2 fetch endpoint

**Files:**
- Modify: `packages/server/src/routes/sync-v2.ts`

- [ ] **Step 1: Test**

```ts
it("tier2 fetch returns history for a note", async () => {
  // setup user, note, revisions
  await prisma.noteRevision.create({ data: { id: "r1", userId: "u-r1", notePath: "p", content: "v1" } });
  const res = await request(app).get("/api/sync/v2/tier2/history/p").set("Authorization", `Bearer ${tok}`);
  expect(res.status).toBe(200);
  expect(res.body.entities).toHaveLength(1);
});
```

- [ ] **Step 2: Implement**

```ts
router.get("/tier2/:entityType/:parentId", async (req, res) => {
  const user = requireUser(req);
  const { entityType, parentId } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  if (entityType === "history") {
    const rows = await prisma.noteRevision.findMany({
      where: { userId: user.id, notePath: parentId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return res.json({ entities: rows });
  }
  if (entityType === "access_requests") {
    const rows = await prisma.accessRequest.findMany({ where: { noteShareId: parentId }, take: limit });
    return res.json({ entities: rows });
  }
  if (entityType === "plugin_storage") {
    const rows = await prisma.pluginStorage.findMany({ where: { installedPluginId: parentId }, take: limit });
    return res.json({ entities: rows });
  }
  res.status(404).json({ error: "unknown entity type" });
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/sync-v2.ts
git commit -m "feat(server): tier 2 fetch endpoint"
```

---

## Task SRV-20: Attachments — upload and download

**Files:**
- Create: `packages/server/src/routes/attachments.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Test**

```ts
it("upload then download attachment", async () => {
  const upload = await request(app).post("/api/attachments")
    .set("Authorization", `Bearer ${tok}`)
    .field("notePath", "p1")
    .attach("file", Buffer.from("hello"), "test.txt");
  expect(upload.status).toBe(200);
  expect(upload.body.id).toBeDefined();
  const dl = await request(app).get(`/api/attachments/${upload.body.id}`).set("Authorization", `Bearer ${tok}`);
  expect(dl.status).toBe(200);
  expect(dl.text).toBe("hello");
});
```

- [ ] **Step 2: Install multer**

Run: `npm install multer @types/multer --workspace=packages/server`

- [ ] **Step 3: Implement**

```ts
// packages/server/src/routes/attachments.ts
import { Router } from "express";
import multer from "multer";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { requireUser } from "../middleware/auth";
import { prisma } from "../prisma";

const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } });

export function createAttachmentsRouter(storageRoot: string): Router {
  const router = Router();

  router.post("/", upload.single("file"), async (req, res) => {
    const user = requireUser(req);
    if (!req.file) return res.status(400).json({ error: "file required" });
    const notePath = String(req.body.notePath ?? "");
    const hash = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
    const userRoot = path.join(storageRoot, user.id);
    const targetPath = path.join(userRoot, "attachments", hash);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, req.file.buffer);
    const att = await prisma.attachment.create({
      data: {
        userId: user.id, notePath,
        filename: req.file.originalname,
        contentHash: `sha256:${hash}`,
        sizeBytes: req.file.size,
        mimeType: req.file.mimetype,
        storagePath: targetPath,
      },
    });
    res.json(att);
  });

  router.get("/:id", async (req, res) => {
    const user = requireUser(req);
    const att = await prisma.attachment.findUnique({ where: { id: req.params.id } });
    if (!att || att.userId !== user.id) return res.status(404).end();
    res.setHeader("Content-Type", att.mimeType);
    res.setHeader("ETag", `"${att.contentHash}"`);
    res.setHeader("Cache-Control", "max-age=31536000, immutable");
    const data = await fs.readFile(att.storagePath);
    res.send(data);
  });

  return router;
}
```

- [ ] **Step 4: Mount**

```ts
app.use("/api/attachments", createAttachmentsRouter(process.env.NOTES_DIR!));
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/attachments.ts \
        packages/server/src/server.ts \
        packages/server/package.json package-lock.json
git commit -m "feat(server): attachments upload + content-hashed download"
```

---

## Task SRV-21: Yjs persistence service

**Files:**
- Create: `packages/server/src/services/yjs-persistence.ts`
- Test: `packages/server/src/services/__tests__/yjs-persistence.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";
import { prisma } from "../../prisma";
import { loadYjsDoc, saveYjsSnapshot, appendYjsUpdate } from "../yjs-persistence";

describe("yjs-persistence", () => {
  beforeEach(async () => {
    await prisma.yjsUpdate.deleteMany();
    await prisma.yjsDocument.deleteMany();
    await prisma.user.deleteMany({ where: { id: "u-y" } });
    await prisma.user.create({ data: { id: "u-y", email: "y@example.com" } });
  });

  it("save snapshot and load round-trip", async () => {
    const doc = new Y.Doc();
    doc.getText("body").insert(0, "hi");
    await saveYjsSnapshot("d1", "u-y", doc);
    const loaded = await loadYjsDoc("d1", "u-y");
    expect(loaded?.getText("body").toString()).toBe("hi");
  });

  it("append updates, then snapshot compacts them", async () => {
    const doc = new Y.Doc();
    doc.getText("body").insert(0, "a");
    await saveYjsSnapshot("d1", "u-y", doc);
    const u = Y.encodeStateAsUpdate(doc);
    await appendYjsUpdate("d1", u, null);
    expect(await prisma.yjsUpdate.count({ where: { docId: "d1" } })).toBe(1);
    await saveYjsSnapshot("d1", "u-y", doc); // re-snapshot compacts
    expect(await prisma.yjsUpdate.count({ where: { docId: "d1" } })).toBe(0);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// packages/server/src/services/yjs-persistence.ts
import * as Y from "yjs";
import { prisma } from "../prisma";

export async function loadYjsDoc(docId: string, userId: string): Promise<Y.Doc | null> {
  const row = await prisma.yjsDocument.findUnique({ where: { docId } });
  if (!row || row.userId !== userId) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, row.snapshot);
  const updates = await prisma.yjsUpdate.findMany({ where: { docId }, orderBy: { id: "asc" } });
  for (const u of updates) Y.applyUpdate(doc, u.update);
  return doc;
}

export async function saveYjsSnapshot(docId: string, userId: string, doc: Y.Doc): Promise<void> {
  const snapshot = Y.encodeStateAsUpdate(doc);
  const stateVector = Y.encodeStateVector(doc);
  await prisma.$transaction([
    prisma.yjsDocument.upsert({
      where: { docId },
      update: { snapshot: Buffer.from(snapshot), stateVector: Buffer.from(stateVector) },
      create: { docId, userId, snapshot: Buffer.from(snapshot), stateVector: Buffer.from(stateVector) },
    }),
    prisma.yjsUpdate.deleteMany({ where: { docId } }),
  ]);
}

export async function appendYjsUpdate(docId: string, update: Uint8Array, agentId: string | null): Promise<void> {
  await prisma.yjsUpdate.create({
    data: { docId, update: Buffer.from(update), agentId },
  });
}
```

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/yjs-persistence.ts \
        packages/server/src/services/__tests__/yjs-persistence.test.ts
git commit -m "feat(server): yjs persistence service with snapshot+update log"
```

---

## Task SRV-22: Yjs WebSocket server

**Files:**
- Create: `packages/server/src/services/yjs-server.ts`
- Test: `packages/server/src/services/__tests__/yjs-server.test.ts`

- [ ] **Step 1: Install dependencies**

Run: `npm install ws @types/ws --workspace=packages/server`

- [ ] **Step 2: Test (in-process two-client convergence)**

```ts
// packages/server/src/services/__tests__/yjs-server.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as http from "http";
import { WebSocket, WebSocketServer } from "ws";
import * as Y from "yjs";
import { prisma } from "../../prisma";
import { setupYjsWss } from "../yjs-server";

describe("yjs server", () => {
  let server: http.Server, port: number;

  beforeEach(async () => {
    await prisma.yjsUpdate.deleteMany();
    await prisma.yjsDocument.deleteMany();
    await prisma.user.deleteMany({ where: { id: "u-yws" } });
    await prisma.user.create({ data: { id: "u-yws", email: "yws@example.com" } });
    server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });
    setupYjsWss(server, wss, { authenticate: async (token) => ({ userId: "u-yws", agentId: null }) });
    await new Promise<void>(r => server.listen(0, r));
    port = (server.address() as any).port;
  });

  afterEach(async () => {
    await new Promise<void>(r => server.close(() => r()));
  });

  it("two clients on same doc converge", async () => {
    // Two WebSocket clients connect, edit, observe each other's edits
    const c1 = new WebSocket(`ws://localhost:${port}/ws/yjs/d1?token=t`);
    const c2 = new WebSocket(`ws://localhost:${port}/ws/yjs/d1?token=t`);
    await Promise.all([
      new Promise<void>(r => c1.once("open", () => r())),
      new Promise<void>(r => c2.once("open", () => r())),
    ]);
    // ... full Yjs framing exchange — trimmed for brevity
    c1.close(); c2.close();
  }, 20_000);
});
```

- [ ] **Step 3: Implement**

```ts
// packages/server/src/services/yjs-server.ts
import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { loadYjsDoc, saveYjsSnapshot, appendYjsUpdate } from "./yjs-persistence";

interface AuthResult { userId: string; agentId: string | null }
interface YjsServerOpts {
  authenticate: (token: string) => Promise<AuthResult | null>;
}

const docs = new Map<string, { doc: Y.Doc; awareness: awarenessProtocol.Awareness; clients: Set<WebSocket>; updateCount: number; lastSnapshot: number }>();

export function setupYjsWss(http: HttpServer, wss: WebSocketServer, opts: YjsServerOpts): void {
  http.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    const m = url.pathname.match(/^\/ws\/yjs\/([^/?]+)$/);
    if (!m) { socket.destroy(); return; }
    const docId = decodeURIComponent(m[1]);
    const token = url.searchParams.get("token") ?? "";
    const auth = await opts.authenticate(token);
    if (!auth) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, docId, auth));
  });
}

async function onConnection(ws: WebSocket, docId: string, auth: AuthResult): Promise<void> {
  let entry = docs.get(docId);
  if (!entry) {
    const doc = (await loadYjsDoc(docId, auth.userId)) ?? new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    entry = { doc, awareness, clients: new Set(), updateCount: 0, lastSnapshot: Date.now() };
    docs.set(docId, entry);

    // Persist updates to log + broadcast
    doc.on("update", async (update: Uint8Array) => {
      await appendYjsUpdate(docId, update, auth.agentId).catch(() => {});
      entry!.updateCount++;
      // Broadcast
      const msg = makeSyncUpdateMessage(update);
      for (const c of entry!.clients) if (c.readyState === c.OPEN) c.send(msg);
      // Compact if needed
      if (entry!.updateCount >= 100 || (Date.now() - entry!.lastSnapshot > 60_000)) {
        await saveYjsSnapshot(docId, auth.userId, entry!.doc).catch(() => {});
        entry!.updateCount = 0;
        entry!.lastSnapshot = Date.now();
      }
    });
  }

  entry.clients.add(ws);

  // Sync step 1: send full state to new client
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 0); // MESSAGE_SYNC
  syncProtocol.writeSyncStep1(enc, entry.doc);
  ws.send(encoding.toUint8Array(enc));

  ws.on("message", (data: Buffer) => {
    const dec = decoding.createDecoder(new Uint8Array(data));
    const messageType = decoding.readVarUint(dec);
    if (messageType === 0) {
      const replyEnc = encoding.createEncoder();
      encoding.writeVarUint(replyEnc, 0);
      syncProtocol.readSyncMessage(dec, replyEnc, entry!.doc, ws);
      if (encoding.length(replyEnc) > 1) ws.send(encoding.toUint8Array(replyEnc));
    } else if (messageType === 1) {
      awarenessProtocol.applyAwarenessUpdate(entry!.awareness, decoding.readVarUint8Array(dec), ws);
    }
  });

  ws.on("close", () => {
    entry!.clients.delete(ws);
    awarenessProtocol.removeAwarenessStates(entry!.awareness, [ws], "close");
    if (entry!.clients.size === 0) {
      // Keep doc warm for 5 minutes; eviction handled by a timer (not shown for brevity, but can be added)
    }
  });
}

function makeSyncUpdateMessage(update: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 0);
  syncProtocol.writeUpdate(enc, update);
  return encoding.toUint8Array(enc);
}
```

- [ ] **Step 4: Mount in server.ts**

```ts
import * as http from "http";
import { WebSocketServer } from "ws";
import { setupYjsWss } from "./services/yjs-server";
import { authenticateWsToken } from "./middleware/auth";

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
setupYjsWss(httpServer, wss, { authenticate: authenticateWsToken });
```

- [ ] **Step 5: Run — passes**

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/yjs-server.ts \
        packages/server/src/services/__tests__/yjs-server.test.ts \
        packages/server/src/server.ts \
        packages/server/package.json package-lock.json
git commit -m "feat(server): Yjs websocket server with broadcast + persistence"
```

---

## Task SRV-23: Streams 2C gate

- [ ] **Step 1: Run server tests**

Run: `npm test --workspace=packages/server`
Expected: all pass.

- [ ] **Step 2: Smoke test against a `@kryton/core` instance**

Build core, instantiate it pointed at a running test server, run pull/push, observe expected behavior.

Stream 2C complete.

---

# Stream 2D — Agent identity + Cedar policies

## Task SRV-24: Cedar policy evaluator

**Files:**
- Create: `packages/server/src/services/cedar.ts`
- Test: `packages/server/src/services/__tests__/cedar.test.ts`

- [ ] **Step 1: Install Cedar**

Run: `npm install @cedar-policy/cedar-wasm --workspace=packages/server`

- [ ] **Step 2: Test**

```ts
// packages/server/src/services/__tests__/cedar.test.ts
import { describe, it, expect } from "vitest";
import { evaluatePolicy } from "../cedar";

const POLICY = `
permit (
  principal == Kryton::Agent::"a1",
  action == Kryton::Action::"read",
  resource is Kryton::Note
) when { resource.folder.startsWith("inbox/") };
`;

describe("cedar evaluator", () => {
  it("permits when condition matches", async () => {
    const r = await evaluatePolicy(POLICY, {
      principal: { type: "Kryton::Agent", id: "a1" },
      action: "Kryton::Action::\"read\"",
      resource: { type: "Kryton::Note", id: "p1", attrs: { folder: "inbox/2026" } },
    });
    expect(r.allowed).toBe(true);
  });

  it("denies when condition fails", async () => {
    const r = await evaluatePolicy(POLICY, {
      principal: { type: "Kryton::Agent", id: "a1" },
      action: "Kryton::Action::\"read\"",
      resource: { type: "Kryton::Note", id: "p1", attrs: { folder: "private/" } },
    });
    expect(r.allowed).toBe(false);
  });
});
```

- [ ] **Step 3: Implement**

```ts
// packages/server/src/services/cedar.ts
import { evaluate } from "@cedar-policy/cedar-wasm";

export interface AuthzInput {
  principal: { type: string; id: string };
  action: string;
  resource: { type: string; id: string; attrs?: Record<string, unknown> };
  context?: Record<string, unknown>;
}

export async function evaluatePolicy(policySource: string, input: AuthzInput): Promise<{ allowed: boolean; reasons?: string[] }> {
  const result = evaluate({
    policies: policySource,
    principal: `${input.principal.type}::"${input.principal.id}"`,
    action: input.action,
    resource: `${input.resource.type}::"${input.resource.id}"`,
    context: input.context ?? {},
    entities: input.resource.attrs ? [{
      uid: { type: input.resource.type, id: input.resource.id },
      attrs: input.resource.attrs,
      parents: [],
    }] : [],
    schema: undefined,
  });
  return {
    allowed: result.decision === "Allow",
    reasons: result.diagnostics?.errors ?? [],
  };
}
```

(Adjust Cedar wasm API per actual library export signature — Cedar's TypeScript bindings may use a slightly different shape.)

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/cedar.ts \
        packages/server/src/services/__tests__/cedar.test.ts \
        packages/server/package.json package-lock.json
git commit -m "feat(server): Cedar policy evaluator wrapper"
```

---

## Task SRV-25: Agent service — CRUD + token minting

**Files:**
- Create: `packages/server/src/services/agent.ts`
- Test: `packages/server/src/services/__tests__/agent.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../../prisma";
import { createAgent, mintToken, validateToken, revokeToken } from "../agent";

describe("agent service", () => {
  beforeEach(async () => {
    await prisma.agentToken.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.user.deleteMany({ where: { id: "u-ag" } });
    await prisma.user.create({ data: { id: "u-ag", email: "ag@example.com" } });
  });

  it("create agent and mint token, validate succeeds", async () => {
    const a = await createAgent("u-ag", { name: "claude", label: "Claude" });
    const t = await mintToken(a.id, { expiresInSeconds: 3600 });
    const r = await validateToken(t.token);
    expect(r?.agentId).toBe(a.id);
  });

  it("revoked token fails validation", async () => {
    const a = await createAgent("u-ag", { name: "claude", label: "Claude" });
    const t = await mintToken(a.id, { expiresInSeconds: 3600 });
    await revokeToken(t.tokenId);
    const r = await validateToken(t.token);
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// packages/server/src/services/agent.ts
import { prisma } from "../prisma";
import * as crypto from "crypto";

export async function createAgent(ownerUserId: string, input: { name: string; label: string; policyText?: string }) {
  return prisma.agent.create({
    data: { ownerUserId, name: input.name, label: input.label, policyText: input.policyText ?? null },
  });
}

export async function setAgentPolicy(agentId: string, policyText: string) {
  return prisma.agent.update({ where: { id: agentId }, data: { policyText } });
}

export async function mintToken(agentId: string, opts: { expiresInSeconds: number; scope?: string }): Promise<{ token: string; tokenId: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + opts.expiresInSeconds * 1000);
  const row = await prisma.agentToken.create({
    data: { agentId, tokenHash, scope: opts.scope ?? null, expiresAt },
  });
  return { token, tokenId: row.id, expiresAt };
}

export async function validateToken(token: string): Promise<{ agentId: string; ownerUserId: string; tokenId: string } | null> {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const t = await prisma.agentToken.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { agent: true },
  });
  if (!t) return null;
  return { agentId: t.agentId, ownerUserId: t.agent.ownerUserId, tokenId: t.id };
}

export async function revokeToken(tokenId: string): Promise<void> {
  await prisma.agentToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
}
```

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/agent.ts \
        packages/server/src/services/__tests__/agent.test.ts
git commit -m "feat(server): agent service with hashed token storage"
```

---

## Task SRV-26: Authorization middleware

**Files:**
- Create: `packages/server/src/middleware/authz.ts`
- Test: `packages/server/src/middleware/__tests__/authz.test.ts`

- [ ] **Step 1: Test (skeleton — full coverage in SRV-27)**

```ts
it("allows when no policy attached", async () => {
  // a user with no agent policies
  // ...
});
it("denies when policy denies", async () => {
  // an agent with restrictive policy
  // ...
});
```

- [ ] **Step 2: Implement**

```ts
// packages/server/src/middleware/authz.ts
import { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma";
import { evaluatePolicy } from "../services/cedar";

export interface AuthzResource {
  type: string;
  id: string;
  attrs?: Record<string, unknown>;
}

export function requirePermission(action: string, resourceFn: (req: Request) => AuthzResource | Promise<AuthzResource>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as any).auth as { userId: string; agentId: string | null } | undefined;
    if (!auth) return res.status(401).end();
    if (!auth.agentId) return next(); // human users always pass (for now)

    const agent = await prisma.agent.findUnique({ where: { id: auth.agentId } });
    if (!agent || !agent.policyText) {
      return res.status(403).json({ error: "no policy attached to agent" });
    }
    const resource = await resourceFn(req);
    const result = await evaluatePolicy(agent.policyText, {
      principal: { type: "Kryton::Agent", id: agent.id },
      action,
      resource,
    });
    if (!result.allowed) {
      return res.status(403).json({ error: "policy denied", reasons: result.reasons });
    }
    next();
  };
}
```

- [ ] **Step 3: Apply to sync-v2 routes**

In `routes/sync-v2.ts`, the pull endpoint becomes:

```ts
router.post("/pull", requirePermission("Kryton::Action::\"sync\"", async (req) => ({
  type: "Kryton::Sync", id: "*",
})), async (req, res) => { /* existing */ });
```

(For pull/push, the resource is the sync surface itself; for push, individual entity ops are also evaluated inside the service for fine-grained control.)

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/middleware/authz.ts \
        packages/server/src/middleware/__tests__/authz.test.ts \
        packages/server/src/routes/sync-v2.ts
git commit -m "feat(server): authz middleware with Cedar evaluation"
```

---

## Task SRV-27: Agent management routes

**Files:**
- Create: `packages/server/src/routes/agents.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Implement**

```ts
// packages/server/src/routes/agents.ts
import { Router } from "express";
import { z } from "zod";
import { requireUser } from "../middleware/auth";
import { createAgent, mintToken, revokeToken, setAgentPolicy } from "../services/agent";
import { prisma } from "../prisma";

export function createAgentsRouter(): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const user = requireUser(req);
    const body = z.object({ name: z.string(), label: z.string() }).parse(req.body);
    const a = await createAgent(user.id, body);
    res.json(a);
  });

  router.get("/", async (req, res) => {
    const user = requireUser(req);
    const agents = await prisma.agent.findMany({ where: { ownerUserId: user.id } });
    res.json({ agents });
  });

  router.delete("/:id", async (req, res) => {
    const user = requireUser(req);
    const a = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!a || a.ownerUserId !== user.id) return res.status(404).end();
    await prisma.agent.delete({ where: { id: a.id } });
    res.status(204).end();
  });

  router.post("/:id/policies", async (req, res) => {
    const user = requireUser(req);
    const a = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!a || a.ownerUserId !== user.id) return res.status(404).end();
    const body = z.object({ policyText: z.string() }).parse(req.body);
    await setAgentPolicy(a.id, body.policyText);
    res.status(204).end();
  });

  router.post("/:id/tokens", async (req, res) => {
    const user = requireUser(req);
    const a = await prisma.agent.findUnique({ where: { id: req.params.id } });
    if (!a || a.ownerUserId !== user.id) return res.status(404).end();
    const body = z.object({ expiresInSeconds: z.number().int().positive(), scope: z.string().optional() }).parse(req.body);
    const r = await mintToken(a.id, body);
    res.json(r);
  });

  router.post("/tokens/:tokenId/revoke", async (req, res) => {
    const user = requireUser(req);
    const t = await prisma.agentToken.findUnique({ where: { id: req.params.tokenId }, include: { agent: true } });
    if (!t || t.agent.ownerUserId !== user.id) return res.status(404).end();
    await revokeToken(t.id);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 2: Mount**

```ts
app.use("/api/agents", createAgentsRouter());
```

- [ ] **Step 3: Smoke test**

```bash
curl -X POST -H "Authorization: Bearer $UTOK" -H "Content-Type: application/json" \
  -d '{"name":"claude","label":"Claude"}' http://localhost:3000/api/agents
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/agents.ts \
        packages/server/src/server.ts
git commit -m "feat(server): agent management routes"
```

---

## Task SRV-28: Wire agent token validation into request auth

**Files:**
- Modify: `packages/server/src/middleware/auth.ts`

- [ ] **Step 1: Augment requireUser to handle agent tokens**

The existing `requireUser` validates user sessions. Add a path for agent tokens:

```ts
// in auth.ts
import { validateToken as validateAgentToken } from "../services/agent";

export async function authenticate(req: Request): Promise<{ userId: string; agentId: string | null } | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length);
  // Try user session first
  const userSession = await tryUserSession(token); // existing logic
  if (userSession) return { userId: userSession.userId, agentId: null };
  // Fall back to agent token
  const agentValidation = await validateAgentToken(token);
  if (agentValidation) return { userId: agentValidation.ownerUserId, agentId: agentValidation.agentId };
  return null;
}
```

Update `requireUser` middleware to call `authenticate` and store `req.auth`.

- [ ] **Step 2: Smoke test**

Mint a user session token, hit /api/sync/v2/pull → 200.
Mint an agent token (with a permissive policy), hit /api/sync/v2/pull → 200 (or 403 depending on policy).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/middleware/auth.ts
git commit -m "feat(server): auth middleware accepts agent tokens"
```

---

## Task SRV-29: Yjs auth — wire agent token to ws connections

**Files:**
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Implement authenticateWsToken**

```ts
// in middleware/auth.ts
export async function authenticateWsToken(token: string): Promise<{ userId: string; agentId: string | null } | null> {
  // Same as authenticate() but token-only path
  const userSession = await tryUserSessionToken(token);
  if (userSession) return { userId: userSession.userId, agentId: null };
  const agent = await validateAgentToken(token);
  if (agent) return { userId: agent.ownerUserId, agentId: agent.agentId };
  return null;
}
```

Wire into `setupYjsWss(httpServer, wss, { authenticate: authenticateWsToken })`.

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/middleware/auth.ts packages/server/src/server.ts
git commit -m "feat(server): Yjs ws upgrade accepts user or agent tokens"
```

---

## Task SRV-30: Stream 2D gate

- [ ] **Step 1: Run all stream 2D tests**

Run: `npm test --workspace=packages/server -- agent cedar authz`

- [ ] **Step 2: Integration smoke**

Run an end-to-end scenario: user creates agent, sets policy, mints token, agent token can pull but only matching folder.

Stream 2D complete.

---

## Self-review

- [ ] Every step has actual code or actual command.
- [ ] All Prisma model relations are bidirectional where required.
- [ ] Cursor service is used by every write path (folder, tag, sync push handlers, yjs).
- [ ] Wire protocol from `@kryton/core/sync/protocol` is honored exactly.
- [ ] Tag-merge semantics implemented in note push handler.
- [ ] Yjs persistence: snapshot + update log, compacting on snapshot.
- [ ] Cedar evaluator wraps wasm; auth middleware applies it; routes opt in via `requirePermission`.

## Open implementation questions deferred to execution

1. Cedar wasm API may differ slightly from the sketch — adjust at implementation time.
2. Push handlers for `tags`, `note_tags`, `settings`, `graph_edges`, `note_shares`, `trash_items`, `installed_plugins` are templated but each needs its own concrete code. Treat each as one TDD task.
3. Yjs broadcast back-pressure (50 ops/s rate limit) is not yet implemented; deferred to Phase 4 hardening.
4. The legacy `/api/sync` endpoints stay live; remove in Phase 4 once mobile cuts over.
