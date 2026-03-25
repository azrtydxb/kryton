# Server Code Quality Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix server-side code quality issues: eliminate code duplication, add consistent validation, fix N+1 queries, add structured logging, fix sync I/O, and improve architecture.

**Architecture:** Refactor routes to use shared utilities (from security plan), add Zod validation to all routes, extract business logic from routes into services, replace console.* with structured approach, fix performance issues.

**Tech Stack:** TypeScript, Express 5, Zod, Prisma

**Closes:** #27, #29, #30, #31, #36, #37, #38, #39, #46 (partial)

**Depends on:** Plan 1 (security-infrastructure) must complete first — it creates the shared utilities this plan uses.

---

## File Structure

### New Files
- `packages/server/src/services/adminService.ts` — Business logic extracted from admin routes
- `packages/server/src/services/settingsService.ts` — Settings CRUD extracted from settings routes

### Modified Files (all route files for duplication fixes)
- `packages/server/src/routes/notes.ts` — Use shared utils, requireUser, consistent validation
- `packages/server/src/routes/folders.ts` — Use shared utils, remove local validatePath
- `packages/server/src/routes/canvas.ts` — Use shared utils, remove local safePath
- `packages/server/src/routes/templates.ts` — Use shared utils
- `packages/server/src/routes/backlinks.ts` — Use shared utils
- `packages/server/src/routes/daily.ts` — Use shared utils
- `packages/server/src/routes/tags.ts` — Use shared utils
- `packages/server/src/routes/search.ts` — Use shared utils
- `packages/server/src/routes/graph.ts` — Use shared utils
- `packages/server/src/routes/settings.ts` — Use shared utils, extract to service
- `packages/server/src/routes/admin.ts` — Extract to service, add Zod validation
- `packages/server/src/routes/shares.ts` — Use centralized validation schemas
- `packages/server/src/routes/users.ts` — Use shared utils
- `packages/server/src/routes/plugins.ts` — Use shared utils
- `packages/server/src/lib/validation.ts` — Add missing schemas, remove stale ones
- `packages/server/src/services/searchService.ts` — Fix N+1, add select clauses, fix ReDoS
- `packages/server/src/services/graphService.ts` — Fix N+1, resolve circular deps
- `packages/server/src/services/noteService.ts` — Use shared pathUtils
- `packages/server/src/plugins/PluginManager.ts` — Async fs operations

---

### Task 1: Add missing Zod schemas to validation.ts (#36)

**Files:**
- Modify: `packages/server/src/lib/validation.ts`

- [ ] **Step 1: Read validation.ts**

Read `packages/server/src/lib/validation.ts` fully.

- [ ] **Step 2: Add schemas for all unvalidated endpoints**

Remove the stale `createShareSchema` and add complete schemas:

```typescript
import { z } from "zod";

// Notes
export const createNoteSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(1_000_000),
});

export const updateNoteSchema = z.object({
  content: z.string().max(1_000_000),
});

export const renameNoteSchema = z.object({
  newPath: z.string().min(1).max(500),
});

// Folders
export const createFolderSchema = z.object({
  name: z.string().min(1).max(200),
});

export const renameFolderSchema = z.object({
  newPath: z.string().min(1).max(500),
});

// Shares
export const createShareSchema = z.object({
  path: z.string().min(1),
  sharedWithUserId: z.string().min(1),
  permission: z.enum(["read", "readwrite"]),
  isFolder: z.boolean().optional(),
});

export const updateShareSchema = z.object({
  permission: z.enum(["read", "readwrite"]),
});

export const createAccessRequestSchema = z.object({
  ownerUserId: z.string().min(1),
  notePath: z.string().min(1),
  message: z.string().max(500).optional(),
});

export const updateAccessRequestSchema = z.object({
  status: z.enum(["approved", "denied"]),
  permission: z.enum(["read", "readwrite"]).optional(),
});

// Admin
export const updateUserSchema = z.object({
  disabled: z.boolean().optional(),
  role: z.enum(["user", "admin"]).optional(),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(8).max(72),
});

export const createInviteSchema = z.object({
  expiresAt: z.string().datetime().optional(),
});

export const registrationModeSchema = z.object({
  mode: z.enum(["open", "invite-only"]),
});

// Settings
export const updateSettingSchema = z.object({
  value: z.string(),
});

// Canvas
export const createCanvasSchema = z.object({
  name: z.string().min(1).max(200),
  content: z.unknown().optional(),
});

// Validate helper
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (!result.success) {
    const messages = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    return { success: false, error: messages };
  }
  return { success: true, data: result.data };
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build --workspace=packages/server
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/lib/validation.ts
git commit -m "feat(server): add Zod schemas for all route endpoints, remove stale schemas

Closes #36"
```

---

### Task 2: Refactor notes.ts to use shared utilities (#30, #31)

**Files:**
- Modify: `packages/server/src/routes/notes.ts`

- [ ] **Step 1: Read notes.ts**

Read `packages/server/src/routes/notes.ts` fully.

- [ ] **Step 2: Replace duplicated patterns**

Add imports:

```typescript
import { decodePathParam, ensureExtension } from "../lib/pathUtils.js";
import { requireUser } from "../middleware/auth.js";
import { renameNoteSchema } from "../lib/validation.js";
```

In each handler:
1. Replace `req.user!.id` with `const user = requireUser(req); user.id`
2. Replace `decodeURIComponent(Array.isArray(req.params.path) ? req.params.path.join("/") : req.params.path as string)` with `decodePathParam(req.params.path)`
3. Replace `notePath.endsWith(".md") ? notePath : \`${notePath}.md\`` with `ensureExtension(notePath, ".md")`
4. Remove inline try/catch blocks — let errors propagate to the error middleware. For cases needing custom responses, use `throw new NotFoundError(...)` etc.
5. Use `validate(renameNoteSchema, req.body)` for the rename endpoint.

- [ ] **Step 3: Verify build**

```bash
npm run build --workspace=packages/server
```

- [ ] **Step 4: Run existing tests**

```bash
npm run test --workspace=packages/server
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/notes.ts
git commit -m "refactor(server): notes routes use shared utilities, remove duplication

Closes #30 (partial), #31 (partial)"
```

---

### Task 3: Refactor folders.ts, canvas.ts, templates.ts, backlinks.ts (#30, #31)

**Files:**
- Modify: `packages/server/src/routes/folders.ts`
- Modify: `packages/server/src/routes/canvas.ts`
- Modify: `packages/server/src/routes/templates.ts`
- Modify: `packages/server/src/routes/backlinks.ts`

- [ ] **Step 1: Read all four files**

Read each file fully.

- [ ] **Step 2: Refactor each file**

For each file:
1. Replace local path validation functions (`validatePath`, `safePath`, inline checks) with `validatePathWithinBase` from `pathUtils.ts`
2. Replace `req.user!` with `requireUser(req)`
3. Replace duplicated `decodeURIComponent(...)` with `decodePathParam()`
4. Replace extension normalization with `ensureExtension()`
5. Replace inline try/catch with error propagation to middleware
6. Use Zod validation for request bodies (`renameFolderSchema`, `createCanvasSchema`)

- [ ] **Step 3: Verify build**

```bash
npm run build --workspace=packages/server
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/folders.ts packages/server/src/routes/canvas.ts packages/server/src/routes/templates.ts packages/server/src/routes/backlinks.ts
git commit -m "refactor(server): folders/canvas/templates/backlinks use shared utilities

Closes #30 (partial), #31 (partial)"
```

---

### Task 4: Refactor remaining route files (#30, #31)

**Files:**
- Modify: `packages/server/src/routes/daily.ts`
- Modify: `packages/server/src/routes/tags.ts`
- Modify: `packages/server/src/routes/search.ts`
- Modify: `packages/server/src/routes/graph.ts`
- Modify: `packages/server/src/routes/settings.ts`
- Modify: `packages/server/src/routes/users.ts`

- [ ] **Step 1: Read and refactor each file**

Apply the same pattern:
1. `requireUser(req)` instead of `req.user!`
2. `decodePathParam()` where applicable
3. Remove inline try/catch
4. Zod validation for settings updates

- [ ] **Step 2: Verify build**

```bash
npm run build --workspace=packages/server
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/
git commit -m "refactor(server): remaining routes use shared utilities and error middleware

Closes #30, #31, #37"
```

---

### Task 5: Refactor shares.ts and admin.ts with Zod validation (#27, #36)

**Files:**
- Modify: `packages/server/src/routes/shares.ts`
- Modify: `packages/server/src/routes/admin.ts`

- [ ] **Step 1: Read both files**

Read `packages/server/src/routes/shares.ts` and `packages/server/src/routes/admin.ts` fully.

- [ ] **Step 2: Refactor shares.ts**

1. Replace inline Zod schemas with imports from `validation.ts`
2. Use `validate()` helper for access request endpoints
3. Replace `req.user!` with `requireUser(req)`
4. Replace inline Prisma error detection with Prisma error codes:

```typescript
import { Prisma } from "../generated/prisma/client.js";

// In catch blocks:
if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
  res.status(409).json({ error: "Share already exists" });
  return;
}
```

- [ ] **Step 3: Refactor admin.ts**

1. Replace all `req.body as { ... }` with `validate()` + imported schemas
2. Replace `req.user!` with `requireUser(req)`
3. Remove inline try/catch, use error middleware
4. Replace magic string `"__global__"` with `GLOBAL_USER_ID` from pathUtils

- [ ] **Step 4: Verify build**

```bash
npm run build --workspace=packages/server
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/shares.ts packages/server/src/routes/admin.ts
git commit -m "refactor(server): shares and admin routes use Zod validation, remove as-casts

Closes #27 (partial), #36 (partial)"
```

---

### Task 6: Fix N+1 queries in searchService and graphService (#29)

**Files:**
- Modify: `packages/server/src/services/searchService.ts`
- Modify: `packages/server/src/services/graphService.ts`

- [ ] **Step 1: Read searchService.ts**

Read `packages/server/src/services/searchService.ts` fully.

- [ ] **Step 2: Fix search() N+1 pattern**

Replace the per-share loop query with a single batched query:

```typescript
// Instead of looping over shares and querying each:
const sharedPaths = shares.map(s => s.path);
const sharedResults = await prisma.searchIndex.findMany({
  where: {
    userId: { in: shares.map(s => s.ownerUserId) },
    notePath: { in: sharedPaths },
    OR: [
      { title: { contains: query, mode: "insensitive" } },
      { content: { contains: query, mode: "insensitive" } },
      { tags: { contains: query, mode: "insensitive" } },
    ],
  },
  select: { notePath: true, title: true, tags: true, modifiedAt: true, content: true, userId: true },
});
```

- [ ] **Step 3: Fix getAllTags/getNotesByTag to use select**

```typescript
// Only fetch tags field, not full content
const rows = await prisma.searchIndex.findMany({
  where: { userId },
  select: { notePath: true, title: true, tags: true },
});
```

- [ ] **Step 4: Fix ReDoS regexes in stripMarkdown**

Replace backtracking-prone regexes:

```typescript
// Before (vulnerable):
.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
.replace(/_{1,3}([^_]+)_{1,3}/g, "$1")

// After (safe):
.replace(/\*{1,3}(.*?)\*{1,3}/g, "$1")
.replace(/_{1,3}(.*?)\_{1,3}/g, "$1")
```

Or use a non-regex approach.

- [ ] **Step 5: Read and fix graphService.ts**

Read `packages/server/src/services/graphService.ts` fully.

Fix N+1 in `getBacklinks()` — batch the `hasAccess` calls by pre-fetching all relevant shares:

```typescript
// Pre-fetch all shares for the requesting user
const shares = await prisma.noteShare.findMany({
  where: { sharedWithUserId: userId },
});

// Build a Set of accessible paths for O(1) lookup
const accessiblePaths = new Set<string>();
for (const share of shares) {
  accessiblePaths.add(share.path);
}
```

Fix circular dependency by extracting the shared access-checking logic into a new utility or passing it as a parameter.

Replace dynamic `await import(...)` with a static import of the extracted utility.

- [ ] **Step 6: Verify build**

```bash
npm run build --workspace=packages/server
```

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/searchService.ts packages/server/src/services/graphService.ts
git commit -m "perf(server): fix N+1 queries in search/graph, add select clauses, fix ReDoS

Closes #29"
```

---

### Task 7: Fix sync fs in PluginManager (#39)

**Files:**
- Modify: `packages/server/src/plugins/PluginManager.ts`

- [ ] **Step 1: Read PluginManager.ts**

Read `packages/server/src/plugins/PluginManager.ts` fully.

- [ ] **Step 2: Replace sync fs calls**

Replace:
- `fs.readFileSync(...)` -> `await fs.promises.readFile(...)`
- `fs.readdirSync(...)` -> `await fs.promises.readdir(...)`
- `fs.existsSync(...)` -> use try/catch with `fs.promises.access(...)` or `fs.promises.stat(...)`

Since these methods are already in async functions, this is straightforward.

- [ ] **Step 3: Verify build and tests**

```bash
npm run build --workspace=packages/server && npm run test --workspace=packages/server
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/plugins/PluginManager.ts
git commit -m "refactor(server): replace sync fs calls with async in PluginManager

Closes #39"
```

---

### Task 8: Use noteService in PluginApiFactory (#27 partial, #46 partial)

**Files:**
- Modify: `packages/server/src/plugins/PluginApiFactory.ts`

- [ ] **Step 1: Read PluginApiFactory.ts (should already be modified from security plan)**

Read `packages/server/src/plugins/PluginApiFactory.ts` fully.

- [ ] **Step 2: Route plugin note operations through noteService**

Replace direct `fs.promises.readFile/writeFile/unlink` calls with calls to `noteService` functions (`readNote`, `writeNote`, `deleteNote`, `scanDirectory`). This ensures path validation, search index updates, and graph cache updates happen consistently.

```typescript
import { readNote, writeNote, deleteNote, scanDirectory } from "../services/noteService.js";

// In createNotesApi:
async get(userId: string, notePath: string) {
  return readNote(notesDir, ensureExtension(notePath, ".md"), userId);
},
async create(userId: string, notePath: string, content: string) {
  await writeNote(notesDir, ensureExtension(notePath, ".md"), content, userId);
},
// etc.
```

- [ ] **Step 3: Verify build and tests**

```bash
npm run build --workspace=packages/server && npm run test --workspace=packages/server
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/plugins/PluginApiFactory.ts
git commit -m "refactor(server): plugin API routes note operations through noteService

Closes #27 (partial)"
```
