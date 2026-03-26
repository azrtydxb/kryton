# Mass Upload Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a server+client plugin that lets users bulk-import `.md` files via a modal with validation, duplicate detection, and per-file action choices.

**Architecture:** Two-phase server flow — Phase 1 uploads files via multipart, validates them, stores temporarily, and returns a report. Phase 2 confirms which files to create/overwrite. Client presents a 3-step modal (select files, review validation, confirm results). Uses multer for multipart parsing, the existing plugin API for note creation, and filesystem for temp session storage.

**Tech Stack:** TypeScript, Express (via plugin routes), multer, vitest, React (via plugin client API)

**Spec:** `docs/superpowers/specs/2026-03-26-mass-upload-plugin-design.md`

---

## File Structure

```
packages/server/plugins/mass-upload/
├── manifest.json                    # Plugin manifest
├── server/
│   ├── index.ts                     # Plugin entry — activate/deactivate, route registration
│   ├── validation.ts                # File validation pipeline (extension, size, binary, UTF-8, path safety, heading, duplicates)
│   └── sessionStore.ts              # Session lifecycle — create, get, cleanup, expiry timer
└── client/
    └── index.ts                     # Client entry — toolbar button, modal UI (3-step workflow)
```

**Test files:**
```
packages/server/plugins/mass-upload/server/__tests__/
├── validation.test.ts               # Unit tests for validation pipeline
├── sessionStore.test.ts             # Unit tests for session lifecycle
└── routes.test.ts                   # Integration tests for HTTP endpoints
```

---

### Task 1: Manifest and Plugin Skeleton

**Files:**
- Create: `packages/server/plugins/mass-upload/manifest.json`
- Create: `packages/server/plugins/mass-upload/server/index.ts`
- Create: `packages/server/plugins/mass-upload/client/index.ts`

- [ ] **Step 1: Create manifest.json**

```json
{
  "id": "mass-upload",
  "name": "Mass Upload",
  "version": "1.0.0",
  "description": "Bulk import .md files with validation and duplicate detection",
  "author": "Mnemo",
  "minMnemoVersion": "3.0.0",
  "server": "server/index.js",
  "client": "client/index.js",
  "settings": [
    {
      "key": "maxFileSize",
      "type": "number",
      "default": 1048576,
      "label": "Max file size (bytes)",
      "perUser": false
    }
  ]
}
```

- [ ] **Step 2: Create server/index.ts skeleton**

```typescript
import type { PluginAPI } from "../../../src/plugins/types.js";

let pluginApi: PluginAPI;

export function activate(api: PluginAPI): void {
  pluginApi = api;
  api.log.info("Mass Upload plugin activated");
}

export function deactivate(): void {
  pluginApi.log.info("Mass Upload plugin deactivated");
}
```

- [ ] **Step 3: Create client/index.ts skeleton**

```typescript
export function activate(api: any): void {
  // Will register toolbar button in later tasks
}

export function deactivate(): void {}
```

- [ ] **Step 4: Verify plugin loads**

Run the dev server and check logs for "Mass Upload plugin activated":
```bash
npm run dev --workspace=packages/server 2>&1 | grep -i "mass.upload"
```
Expected: `[plugin:mass-upload] Mass Upload plugin activated`

- [ ] **Step 5: Commit**

```bash
git add packages/server/plugins/mass-upload/
git commit -m "feat(mass-upload): add plugin skeleton with manifest"
```

---

### Task 2: Session Store

**Files:**
- Create: `packages/server/plugins/mass-upload/server/sessionStore.ts`
- Create: `packages/server/plugins/mass-upload/server/__tests__/sessionStore.test.ts`

- [ ] **Step 1: Write failing tests for session store**

```typescript
// packages/server/plugins/mass-upload/server/__tests__/sessionStore.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SessionStore } from "../sessionStore.js";

describe("SessionStore", () => {
  let store: SessionStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mass-upload-test-"));
    store = new SessionStore(tmpDir, { maxPerUser: 5, expiryMs: 30 * 60 * 1000 });
  });

  afterEach(async () => {
    store.dispose();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a session with unique ID", async () => {
    const session = await store.create("user1");
    expect(session.id).toBeTruthy();
    expect(session.userId).toBe("user1");
    expect(session.files).toEqual([]);
  });

  it("stores session scoped to userId", async () => {
    const session = await store.create("user1");
    const retrieved = store.get(session.id, "user1");
    expect(retrieved).toBeTruthy();
    expect(store.get(session.id, "user2")).toBeNull();
  });

  it("rejects when max sessions exceeded", async () => {
    for (let i = 0; i < 5; i++) {
      await store.create("user1");
    }
    await expect(store.create("user1")).rejects.toThrow("concurrent session");
  });

  it("deletes a session and cleans up files", async () => {
    const session = await store.create("user1");
    await fs.writeFile(path.join(session.dir, "test.md"), "hello");
    await store.delete(session.id, "user1");
    expect(store.get(session.id, "user1")).toBeNull();
    await expect(fs.access(session.dir)).rejects.toThrow();
  });

  it("returns session directory path under userId/sessionId", async () => {
    const session = await store.create("user1");
    expect(session.dir).toContain("user1");
    expect(session.dir).toContain(session.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/server/plugins/mass-upload/server/__tests__/sessionStore.test.ts
```
Expected: FAIL — `SessionStore` not found

- [ ] **Step 3: Implement SessionStore**

```typescript
// packages/server/plugins/mass-upload/server/sessionStore.ts
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";

export interface FileEntry {
  index: number;
  originalName: string;
  resolvedPath: string;
  size: number;
  status: "valid" | "duplicate" | "warning" | "invalid";
  errors: string[];
  existingNote?: boolean;
}

export interface Session {
  id: string;
  userId: string;
  dir: string;
  files: FileEntry[];
  targetFolder: string;
  preserveStructure: boolean;
  createdAt: number;
}

interface StoreOptions {
  maxPerUser: number;
  expiryMs: number;
}

export class SessionStore {
  private sessions = new Map<string, Session>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private baseDir: string,
    private options: StoreOptions
  ) {
    // Clean expired sessions every 5 minutes
    this.timer = setInterval(() => this.cleanExpired(), 5 * 60 * 1000);
  }

  async create(userId: string): Promise<Session> {
    const userSessions = [...this.sessions.values()].filter(
      (s) => s.userId === userId
    );
    if (userSessions.length >= this.options.maxPerUser) {
      throw new Error(
        `Max concurrent session limit (${this.options.maxPerUser}) reached`
      );
    }

    const id = crypto.randomUUID();
    const dir = path.join(this.baseDir, userId, id);
    await fs.mkdir(dir, { recursive: true });

    const session: Session = {
      id,
      userId,
      dir,
      files: [],
      targetFolder: "",
      preserveStructure: false,
      createdAt: Date.now(),
    };
    this.sessions.set(id, session);
    return session;
  }

  get(sessionId: string, userId: string): Session | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) return null;
    return session;
  }

  async delete(sessionId: string, userId: string): Promise<boolean> {
    const session = this.get(sessionId, userId);
    if (!session) return false;
    this.sessions.delete(sessionId);
    await fs.rm(session.dir, { recursive: true, force: true }).catch(() => {});
    return true;
  }

  private async cleanExpired(): Promise<void> {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > this.options.expiryMs) {
        this.sessions.delete(id);
        await fs
          .rm(session.dir, { recursive: true, force: true })
          .catch(() => {});
      }
    }
  }

  async cleanAll(): Promise<void> {
    for (const [id, session] of this.sessions) {
      this.sessions.delete(id);
      await fs.rm(session.dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run packages/server/plugins/mass-upload/server/__tests__/sessionStore.test.ts
```
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/plugins/mass-upload/server/sessionStore.ts packages/server/plugins/mass-upload/server/__tests__/sessionStore.test.ts
git commit -m "feat(mass-upload): add session store with create/get/delete and expiry"
```

---

### Task 3: Validation Pipeline

**Files:**
- Create: `packages/server/plugins/mass-upload/server/validation.ts`
- Create: `packages/server/plugins/mass-upload/server/__tests__/validation.test.ts`

- [ ] **Step 1: Write failing tests for validation**

```typescript
// packages/server/plugins/mass-upload/server/__tests__/validation.test.ts
import { describe, it, expect } from "vitest";
import { validateFile, sanitizePath, flattenNotePaths } from "../validation.js";

describe("sanitizePath", () => {
  it("strips path traversal", () => {
    expect(sanitizePath("../../etc/passwd")).toBe("etc/passwd");
  });

  it("strips leading slashes", () => {
    expect(sanitizePath("/absolute/path.md")).toBe("absolute/path.md");
  });

  it("strips control characters", () => {
    expect(sanitizePath("file\x00name.md")).toBe("filename.md");
  });

  it("rejects Windows reserved names", () => {
    expect(sanitizePath("CON.md")).toBe("_CON.md");
    expect(sanitizePath("folder/NUL.md")).toBe("folder/_NUL.md");
  });

  it("preserves valid relative paths", () => {
    expect(sanitizePath("Projects/todo.md")).toBe("Projects/todo.md");
  });
});

describe("flattenNotePaths", () => {
  it("flattens nested tree structure", () => {
    const tree = [
      { name: "root.md", path: "root.md", type: "file" as const },
      {
        name: "Projects", path: "Projects", type: "directory" as const,
        children: [
          { name: "todo.md", path: "Projects/todo.md", type: "file" as const },
        ],
      },
    ];
    const paths = flattenNotePaths(tree);
    expect(paths).toContain("root.md");
    expect(paths).toContain("Projects/todo.md");
    expect(paths).not.toContain("Projects");
  });
});

describe("validateFile", () => {
  const existingPaths = new Set(["existing.md"]);

  it("rejects non-.md extension", () => {
    const result = validateFile("test.txt", "test.txt", Buffer.from("# Hello"), 1048576, existingPaths);
    expect(result.status).toBe("invalid");
    expect(result.errors).toContain("File must have .md extension");
  });

  it("rejects empty files", () => {
    const result = validateFile("test.md", "test.md", Buffer.alloc(0), 1048576, existingPaths);
    expect(result.status).toBe("invalid");
    expect(result.errors).toContain("File is empty");
  });

  it("rejects files exceeding max size", () => {
    const bigBuffer = Buffer.alloc(100);
    const result = validateFile("test.md", "test.md", bigBuffer, 50, existingPaths);
    expect(result.status).toBe("invalid");
    expect(result.errors[0]).toMatch(/exceeds maximum/);
  });

  it("rejects binary files (null bytes)", () => {
    const buf = Buffer.from("hello\x00world");
    const result = validateFile("test.md", "test.md", buf, 1048576, existingPaths);
    expect(result.status).toBe("invalid");
    expect(result.errors).toContain("File contains binary data");
  });

  it("warns if missing title heading", () => {
    const result = validateFile("test.md", "test.md", Buffer.from("no heading here"), 1048576, existingPaths);
    expect(result.status).toBe("warning");
    expect(result.errors).toContain("File does not start with a # heading");
  });

  it("marks valid file", () => {
    const result = validateFile("test.md", "test.md", Buffer.from("# Hello\nContent"), 1048576, existingPaths);
    expect(result.status).toBe("valid");
    expect(result.errors).toEqual([]);
  });

  it("detects duplicates", () => {
    const result = validateFile("existing.md", "existing.md", Buffer.from("# Hello"), 1048576, existingPaths);
    expect(result.status).toBe("duplicate");
    expect(result.existingNote).toBe(true);
  });

  it("collects all errors without short-circuiting", () => {
    const result = validateFile("test.txt", "test.txt", Buffer.alloc(0), 1048576, existingPaths);
    expect(result.errors).toContain("File must have .md extension");
    expect(result.errors).toContain("File is empty");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/server/plugins/mass-upload/server/__tests__/validation.test.ts
```
Expected: FAIL — `validateFile` not found

- [ ] **Step 3: Implement validation pipeline**

```typescript
// packages/server/plugins/mass-upload/server/validation.ts

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i;

interface NoteEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: NoteEntry[];
}

/** Recursively flatten a NoteEntry tree into a Set of file paths. */
export function flattenNotePaths(tree: NoteEntry[]): Set<string> {
  const paths = new Set<string>();
  function walk(nodes: NoteEntry[]) {
    for (const node of nodes) {
      if (node.type === "file") paths.add(node.path);
      if (node.children) walk(node.children);
    }
  }
  walk(tree);
  return paths;
}

export function sanitizePath(filePath: string): string {
  let p = filePath;
  // Strip control characters
  p = p.replace(/[\x00-\x1f\x7f]/g, "");
  // Remove path traversal
  p = p.replace(/\.\.\//g, "").replace(/\.\.\\/g, "");
  // Remove leading slashes
  p = p.replace(/^[/\\]+/, "");
  // Sanitize Windows reserved names per segment
  p = p
    .split("/")
    .map((seg) => {
      const base = seg.replace(/\.[^.]*$/, "");
      if (WINDOWS_RESERVED.test(base)) return "_" + seg;
      return seg;
    })
    .join("/");
  return p;
}

export interface ValidationResult {
  originalName: string;
  resolvedPath: string;
  size: number;
  status: "valid" | "duplicate" | "warning" | "invalid";
  errors: string[];
  existingNote?: boolean;
}

/**
 * Validate a single uploaded file.
 * @param originalName - The original filename from the upload
 * @param resolvedPath - The target path (after applying targetFolder/structure)
 * @param content - File contents as Buffer
 * @param maxFileSize - Maximum allowed file size in bytes
 * @param existingPaths - Set of existing note paths (flattened) for duplicate detection
 */
export function validateFile(
  originalName: string,
  resolvedPath: string,
  content: Buffer,
  maxFileSize: number,
  existingPaths: Set<string>
): ValidationResult {
  const errors: string[] = [];
  let hasHardError = false;

  // 1. Extension check
  if (!originalName.toLowerCase().endsWith(".md")) {
    errors.push("File must have .md extension");
    hasHardError = true;
  }

  // 2. Size check
  if (content.length === 0) {
    errors.push("File is empty");
    hasHardError = true;
  } else if (content.length > maxFileSize) {
    errors.push(
      `File size (${content.length} bytes) exceeds maximum (${maxFileSize} bytes)`
    );
    hasHardError = true;
  }

  // 3. Binary detection
  if (content.length > 0 && content.includes(0)) {
    errors.push("File contains binary data");
    hasHardError = true;
  }

  // 4. UTF-8 encoding check
  if (content.length > 0 && !hasHardError) {
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(content);
      // 6. Title heading check (only if content is valid text)
      if (!decoded.trimStart().startsWith("# ")) {
        errors.push("File does not start with a # heading");
      }
    } catch {
      errors.push("File is not valid UTF-8");
      hasHardError = true;
    }
  }

  // 5. Path safety — sanitize the resolved path
  const safePath = sanitizePath(resolvedPath);

  // 7. Duplicate detection
  const isDuplicate = existingPaths.has(safePath);

  let status: ValidationResult["status"];
  if (hasHardError) {
    status = "invalid";
  } else if (isDuplicate) {
    status = "duplicate";
  } else if (errors.length > 0) {
    status = "warning";
  } else {
    status = "valid";
  }

  return {
    originalName,
    resolvedPath: safePath,
    size: content.length,
    status,
    errors,
    existingNote: isDuplicate || undefined,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run packages/server/plugins/mass-upload/server/__tests__/validation.test.ts
```
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/plugins/mass-upload/server/validation.ts packages/server/plugins/mass-upload/server/__tests__/validation.test.ts
git commit -m "feat(mass-upload): add file validation pipeline with sanitization"
```

---

### Task 4: Server Routes — Validate, Confirm, Delete

**Files:**
- Modify: `packages/server/plugins/mass-upload/server/index.ts`
- Create: `packages/server/plugins/mass-upload/server/__tests__/routes.test.ts`

**Prerequisite:** Install multer in the server package:

- [ ] **Step 1: Install multer**

```bash
cd packages/server && npm install multer && npm install -D @types/multer && cd ../..
```

- [ ] **Step 2: Write failing route tests**

```typescript
// packages/server/plugins/mass-upload/server/__tests__/routes.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { createRoutes } from "../index.js";

// Minimal mock of PluginAPI
function createMockApi(dataDir: string) {
  return {
    notes: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    },
    settings: {
      get: vi.fn().mockResolvedValue(1048576),
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    plugin: {
      id: "mass-upload",
      version: "1.0.0",
      dataDir,
    },
  };
}

describe("mass-upload routes", () => {
  let app: express.Express;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mass-upload-route-"));
    const mockApi = createMockApi(tmpDir);
    app = express();
    app.use((req: any, _res, next) => {
      req.user = { id: "test-user" };
      next();
    });
    const router = createRoutes(mockApi as any);
    app.use("/api/plugins/mass-upload", router);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("POST /validate returns validation report", async () => {
    const res = await request(app)
      .post("/api/plugins/mass-upload/validate")
      .attach("files", Buffer.from("# Test Note\nContent"), "test.md")
      .expect(200);

    expect(res.body.sessionId).toBeTruthy();
    expect(res.body.files).toHaveLength(1);
    expect(res.body.files[0].status).toBe("valid");
    expect(res.body.files[0].index).toBe(0);
  });

  it("POST /validate rejects non-.md files", async () => {
    const res = await request(app)
      .post("/api/plugins/mass-upload/validate")
      .attach("files", Buffer.from("not markdown"), "test.txt")
      .expect(200);

    expect(res.body.files[0].status).toBe("invalid");
  });

  it("POST /confirm creates notes for valid files", async () => {
    // Phase 1: validate
    const validateRes = await request(app)
      .post("/api/plugins/mass-upload/validate")
      .attach("files", Buffer.from("# Test\nContent"), "test.md")
      .expect(200);

    const { sessionId } = validateRes.body;

    // Phase 2: confirm
    const confirmRes = await request(app)
      .post("/api/plugins/mass-upload/confirm")
      .send({
        sessionId,
        files: [{ index: 0, action: "create" }],
      })
      .expect(200);

    expect(confirmRes.body.created).toBe(1);
  });

  it("POST /confirm rejects invalid session", async () => {
    await request(app)
      .post("/api/plugins/mass-upload/confirm")
      .send({ sessionId: "nonexistent", files: [] })
      .expect(410);
  });

  it("DELETE /session/:id deletes session", async () => {
    const validateRes = await request(app)
      .post("/api/plugins/mass-upload/validate")
      .attach("files", Buffer.from("# Test"), "test.md")
      .expect(200);

    await request(app)
      .delete(`/api/plugins/mass-upload/session/${validateRes.body.sessionId}`)
      .expect(200);
  });

  it("returns 401 without user", async () => {
    const noAuthApp = express();
    const mockApi = createMockApi(tmpDir);
    const router = createRoutes(mockApi as any);
    noAuthApp.use("/api/plugins/mass-upload", router);

    await request(noAuthApp)
      .post("/api/plugins/mass-upload/validate")
      .attach("files", Buffer.from("# Test"), "test.md")
      .expect(401);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run packages/server/plugins/mass-upload/server/__tests__/routes.test.ts
```
Expected: FAIL — `createRoutes` not found

- [ ] **Step 4: Implement server routes**

Rewrite `packages/server/plugins/mass-upload/server/index.ts`:

```typescript
import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import * as fs from "fs/promises";
import * as path from "path";
import type { PluginAPI } from "../../../src/plugins/types.js";
import { SessionStore } from "./sessionStore.js";
import { validateFile } from "./validation.js";

let sessionStore: SessionStore;

export function createRoutes(api: PluginAPI): Router {
  const router = Router();

  sessionStore = new SessionStore(path.join(api.plugin.dataDir, "sessions"), {
    maxPerUser: 5,
    expiryMs: 30 * 60 * 1000,
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: 500,
      fileSize: 1048576, // Will be overridden per-request from settings
    },
  });

  // Phase 1: Upload & Validate
  router.post(
    "/validate",
    upload.array("files", 500),
    async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        res.status(400).json({ error: "No files uploaded" });
        return;
      }

      const targetFolder = (req.query.targetFolder as string) || "";
      const preserveStructure = req.query.preserveStructure === "true";
      const maxFileSize =
        ((await api.settings.get("maxFileSize")) as number) || 1048576;

      let session;
      try {
        session = await sessionStore.create(userId);
      } catch (err: any) {
        res.status(409).json({ error: err.message });
        return;
      }

      session.targetFolder = targetFolder;
      session.preserveStructure = preserveStructure;

      // Get existing note paths for duplicate detection
      const existingNotes = await api.notes.list(userId);
      const existingPaths = new Set(
        existingNotes.map((n: { path: string }) => n.path)
      );

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const originalName = file.originalname;

        // Build resolved path
        let resolvedName = originalName;
        if (targetFolder) {
          resolvedName = preserveStructure
            ? `${targetFolder}/${originalName}`
            : `${targetFolder}/${path.basename(originalName)}`;
        } else if (!preserveStructure) {
          resolvedName = path.basename(originalName);
        }

        const result = validateFile(
          resolvedName,
          file.buffer,
          maxFileSize,
          existingPaths
        );

        // Save file to session directory for Phase 2
        const filePath = path.join(session.dir, `${i}.md`);
        await fs.writeFile(filePath, file.buffer);

        session.files.push({
          index: i,
          originalName,
          resolvedPath: result.resolvedPath,
          size: result.size,
          status: result.status,
          errors: result.errors,
          existingNote: result.existingNote,
        });
      }

      res.json({
        sessionId: session.id,
        targetFolder,
        preserveStructure,
        files: session.files,
      });
    }
  );

  // Phase 2: Confirm & Create
  router.post("/confirm", async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { sessionId, files: fileActions } = req.body;
    const session = sessionStore.get(sessionId, userId);
    if (!session) {
      res.status(410).json({ error: "Session expired or not found" });
      return;
    }

    let created = 0;
    let overwritten = 0;
    const errors: string[] = [];

    for (const action of fileActions) {
      const fileEntry = session.files.find(
        (f) => f.index === action.index
      );
      if (!fileEntry) {
        errors.push(`File index ${action.index} not found in session`);
        continue;
      }
      if (fileEntry.status === "invalid") {
        errors.push(
          `File "${fileEntry.originalName}" is invalid and cannot be imported`
        );
        continue;
      }

      try {
        const filePath = path.join(session.dir, `${action.index}.md`);
        const content = await fs.readFile(filePath, "utf-8");

        if (action.action === "overwrite") {
          await api.notes.update(userId, fileEntry.resolvedPath, content);
          overwritten++;
        } else {
          await api.notes.create(userId, fileEntry.resolvedPath, content);
          created++;
        }
      } catch (err: any) {
        errors.push(
          `Failed to import "${fileEntry.originalName}": ${err.message}`
        );
      }
    }

    // Clean up session
    await sessionStore.delete(sessionId, userId);

    res.json({ created, overwritten, errors });
  });

  // Session cleanup
  router.delete("/session/:sessionId", async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const deleted = await sessionStore.delete(req.params.sessionId, userId);
    if (!deleted) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}

export function activate(api: PluginAPI): void {
  const router = createRoutes(api);
  // Register each route with the plugin API
  const routes = router.stack
    .filter((layer: any) => layer.route)
    .map((layer: any) => ({
      method: Object.keys(layer.route.methods)[0],
      path: layer.route.path,
    }));

  for (const route of routes) {
    api.routes.register(route.method as any, route.path, router as any);
  }

  api.log.info("Mass Upload plugin activated");
}

export function deactivate(): void {
  if (sessionStore) {
    sessionStore.cleanAll().catch(() => {});
    sessionStore.dispose();
  }
}
```

Note: The `activate` function needs to register routes using the plugin API pattern. The `createRoutes` function returns an Express router for testability. Check `packages/server/plugins/templater/server/index.ts` for the exact registration pattern — routes may need to be registered individually via `api.routes.register()` rather than mounting a full router. Adjust the activate function accordingly.

- [ ] **Step 5: Install supertest for route testing**

```bash
cd packages/server && npm install -D supertest @types/supertest && cd ../..
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run packages/server/plugins/mass-upload/server/__tests__/routes.test.ts
```
Expected: All 6 tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/server/plugins/mass-upload/server/ packages/server/package.json packages/server/package-lock.json
git commit -m "feat(mass-upload): add validate/confirm/delete routes with multer"
```

---

### Task 5: Wire Server Routes via Plugin API

**Files:**
- Modify: `packages/server/plugins/mass-upload/server/index.ts`

The route tests in Task 4 use Express directly for testability. Now wire the routes through the actual plugin API so they're served at `/api/plugins/mass-upload/*`.

- [ ] **Step 1: Refactor activate to use api.routes.register**

Update the `activate` function in `server/index.ts`. Instead of mounting a full Express router, register each route handler individually:

```typescript
export function activate(api: PluginAPI): void {
  const router = createRoutes(api);

  // Register the Express router as middleware for all sub-paths.
  // The plugin system mounts at /api/plugins/mass-upload/
  api.routes.register("post", "/validate", router);
  api.routes.register("post", "/confirm", router);
  api.routes.register("delete", "/session/:sessionId", router);

  api.log.info("Mass Upload plugin activated");
}
```

If the plugin system doesn't support mounting a full Router as a handler, register individual route handlers extracted from the router. Check the templater plugin pattern for reference.

- [ ] **Step 2: Manually test with dev server**

```bash
npm run dev --workspace=packages/server
```

Then test with curl:
```bash
curl -X POST http://localhost:3000/api/plugins/mass-upload/validate \
  -F "files=@/tmp/test.md" \
  -H "Cookie: <session-cookie>"
```
Expected: 200 with validation report or 401 if not authenticated

- [ ] **Step 3: Commit**

```bash
git add packages/server/plugins/mass-upload/server/index.ts
git commit -m "feat(mass-upload): wire routes through plugin API"
```

---

### Task 6: Client — Toolbar Button and Modal Shell

**Files:**
- Modify: `packages/server/plugins/mass-upload/client/index.ts`

- [ ] **Step 1: Implement client plugin with toolbar button and 3-step modal**

```typescript
// packages/server/plugins/mass-upload/client/index.ts

const { React } = (window as any).__mnemoPluginDeps;
const { createElement: h, useState, useRef, useCallback } = React;

function UploadModal({ api, onClose }: { api: any; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [targetFolder, setTargetFolder] = useState("");
  const [preserveStructure, setPreserveStructure] = useState(true);
  const [validationResult, setValidationResult] = useState<any>(null);
  const [confirmResult, setConfirmResult] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileActions, setFileActions] = useState<Record<number, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilesSelected = useCallback((files: FileList | null) => {
    if (!files) return;
    const mdFiles = Array.from(files).filter((f) =>
      f.name.toLowerCase().endsWith(".md")
    );
    setSelectedFiles(mdFiles);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      handleFilesSelected(e.dataTransfer?.files ?? null);
    },
    [handleFilesSelected]
  );

  const handleValidate = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      selectedFiles.forEach((f) => formData.append("files", f));
      const params = new URLSearchParams();
      if (targetFolder) params.set("targetFolder", targetFolder);
      params.set("preserveStructure", String(preserveStructure));
      const res = await api.api.fetch(`/validate?${params}`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        api.notify.error(err.error || "Upload failed");
        return;
      }
      const data = await res.json();
      setValidationResult(data);
      // Initialize actions: valid=create, duplicate=skip, invalid excluded
      const actions: Record<number, string> = {};
      for (const f of data.files) {
        if (f.status === "valid" || f.status === "warning")
          actions[f.index] = "create";
        if (f.status === "duplicate") actions[f.index] = "skip";
      }
      setFileActions(actions);
      setStep(2);
    } catch (err: any) {
      api.notify.error("Upload failed: " + err.message);
    } finally {
      setUploading(false);
    }
  }, [selectedFiles, targetFolder, preserveStructure, api]);

  const handleConfirm = useCallback(async () => {
    if (!validationResult) return;
    setConfirming(true);
    try {
      const filesToConfirm = Object.entries(fileActions)
        .filter(([, action]) => action !== "skip")
        .map(([index, action]) => ({ index: Number(index), action }));

      const res = await api.api.fetch("/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: validationResult.sessionId,
          files: filesToConfirm,
        }),
      });
      const data = await res.json();
      setConfirmResult(data);
      setStep(3);
    } catch (err: any) {
      api.notify.error("Import failed: " + err.message);
    } finally {
      setConfirming(false);
    }
  }, [validationResult, fileActions, api]);

  const statusColor = (status: string) => {
    if (status === "valid") return "#22c55e";
    if (status === "warning" || status === "duplicate") return "#eab308";
    return "#ef4444";
  };

  // Step 1: File Selection
  if (step === 1) {
    return h(
      "div",
      {
        style: {
          position: "fixed",
          inset: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.6)",
        },
        onClick: (e: MouseEvent) => {
          if (e.target === e.currentTarget) onClose();
        },
      },
      h(
        "div",
        {
          style: {
            background: "var(--color-surface-900, #1a1a2e)",
            borderRadius: 12,
            padding: 24,
            width: "90%",
            maxWidth: 520,
            maxHeight: "80vh",
            overflow: "auto",
            color: "#e2e8f0",
          },
        },
        h("h2", { style: { margin: "0 0 16px", fontSize: 18 } }, "Mass Upload"),
        h(
          "div",
          {
            onDrop: handleDrop,
            onDragOver: (e: DragEvent) => e.preventDefault(),
            onClick: () => fileInputRef.current?.click(),
            style: {
              border: "2px dashed #4a5568",
              borderRadius: 8,
              padding: 32,
              textAlign: "center",
              cursor: "pointer",
              marginBottom: 16,
            },
          },
          h("p", null, "Drop .md files here or click to browse"),
          selectedFiles.length > 0 &&
            h(
              "p",
              { style: { color: "#a78bfa", marginTop: 8 } },
              `${selectedFiles.length} file(s) selected`
            )
        ),
        h("input", {
          ref: fileInputRef,
          type: "file",
          accept: ".md",
          multiple: true,
          style: { display: "none" },
          onChange: (e: any) => handleFilesSelected(e.target.files),
        }),
        h(
          "div",
          { style: { marginBottom: 12 } },
          h(
            "label",
            { style: { fontSize: 13, color: "#94a3b8" } },
            "Target folder"
          ),
          h("input", {
            type: "text",
            value: targetFolder,
            placeholder: "/ (root)",
            onChange: (e: any) => setTargetFolder(e.target.value),
            style: {
              width: "100%",
              padding: "6px 10px",
              marginTop: 4,
              background: "#2d2d44",
              border: "1px solid #4a5568",
              borderRadius: 6,
              color: "#e2e8f0",
            },
          })
        ),
        h(
          "label",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: "#94a3b8",
              marginBottom: 16,
            },
          },
          h("input", {
            type: "checkbox",
            checked: preserveStructure,
            onChange: (e: any) => setPreserveStructure(e.target.checked),
          }),
          "Preserve folder structure"
        ),
        h(
          "div",
          { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
          h(
            "button",
            {
              onClick: onClose,
              style: {
                padding: "6px 16px",
                borderRadius: 6,
                background: "transparent",
                color: "#94a3b8",
                border: "1px solid #4a5568",
                cursor: "pointer",
              },
            },
            "Cancel"
          ),
          h(
            "button",
            {
              onClick: handleValidate,
              disabled: selectedFiles.length === 0 || uploading,
              style: {
                padding: "6px 16px",
                borderRadius: 6,
                background: selectedFiles.length === 0 ? "#4a5568" : "#7c3aed",
                color: "#fff",
                border: "none",
                cursor:
                  selectedFiles.length === 0 ? "not-allowed" : "pointer",
              },
            },
            uploading ? "Uploading..." : "Upload & Validate"
          )
        )
      )
    );
  }

  // Step 2: Review
  if (step === 2 && validationResult) {
    const files = validationResult.files;
    const validCount = files.filter(
      (f: any) => f.status === "valid" || f.status === "warning"
    ).length;
    const dupCount = files.filter((f: any) => f.status === "duplicate").length;
    const invalidCount = files.filter(
      (f: any) => f.status === "invalid"
    ).length;
    const actionableCount = Object.values(fileActions).filter(
      (a) => a !== "skip"
    ).length;

    return h(
      "div",
      {
        style: {
          position: "fixed",
          inset: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.6)",
        },
      },
      h(
        "div",
        {
          style: {
            background: "var(--color-surface-900, #1a1a2e)",
            borderRadius: 12,
            padding: 24,
            width: "90%",
            maxWidth: 640,
            maxHeight: "80vh",
            overflow: "auto",
            color: "#e2e8f0",
          },
        },
        h(
          "h2",
          { style: { margin: "0 0 8px", fontSize: 18 } },
          "Review Files"
        ),
        h(
          "p",
          { style: { fontSize: 13, color: "#94a3b8", marginBottom: 16 } },
          `${validCount} valid, ${dupCount} duplicate(s), ${invalidCount} invalid`
        ),
        h(
          "div",
          { style: { marginBottom: 16 } },
          ...files.map((f: any) =>
            h(
              "div",
              {
                key: f.index,
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 0",
                  borderBottom: "1px solid #2d2d44",
                  opacity: f.status === "invalid" ? 0.5 : 1,
                },
              },
              h(
                "span",
                {
                  style: {
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: statusColor(f.status),
                    flexShrink: 0,
                  },
                },
                null
              ),
              h(
                "span",
                {
                  style: {
                    flex: 1,
                    fontSize: 13,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  },
                },
                f.resolvedPath
              ),
              f.status === "duplicate" &&
                h(
                  "select",
                  {
                    value: fileActions[f.index] || "skip",
                    onChange: (e: any) =>
                      setFileActions((prev: any) => ({
                        ...prev,
                        [f.index]: e.target.value,
                      })),
                    style: {
                      fontSize: 12,
                      background: "#2d2d44",
                      color: "#e2e8f0",
                      border: "1px solid #4a5568",
                      borderRadius: 4,
                      padding: "2px 4px",
                    },
                  },
                  h("option", { value: "skip" }, "Skip"),
                  h("option", { value: "overwrite" }, "Overwrite")
                ),
              f.errors.length > 0 &&
                h(
                  "span",
                  { style: { fontSize: 11, color: "#f87171" } },
                  f.errors[0]
                )
            )
          )
        ),
        h(
          "div",
          { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
          h(
            "button",
            {
              onClick: onClose,
              style: {
                padding: "6px 16px",
                borderRadius: 6,
                background: "transparent",
                color: "#94a3b8",
                border: "1px solid #4a5568",
                cursor: "pointer",
              },
            },
            "Cancel"
          ),
          h(
            "button",
            {
              onClick: handleConfirm,
              disabled: actionableCount === 0 || confirming,
              style: {
                padding: "6px 16px",
                borderRadius: 6,
                background: actionableCount === 0 ? "#4a5568" : "#7c3aed",
                color: "#fff",
                border: "none",
                cursor: actionableCount === 0 ? "not-allowed" : "pointer",
              },
            },
            confirming
              ? "Importing..."
              : `Import ${actionableCount} file(s)`
          )
        )
      )
    );
  }

  // Step 3: Results
  return h(
    "div",
    {
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
      },
    },
    h(
      "div",
      {
        style: {
          background: "var(--color-surface-900, #1a1a2e)",
          borderRadius: 12,
          padding: 24,
          width: "90%",
          maxWidth: 420,
          color: "#e2e8f0",
          textAlign: "center",
        },
      },
      h("h2", { style: { margin: "0 0 16px", fontSize: 18 } }, "Import Complete"),
      confirmResult &&
        h(
          "div",
          { style: { fontSize: 14, marginBottom: 16 } },
          confirmResult.created > 0 &&
            h("p", null, `Created: ${confirmResult.created}`),
          confirmResult.overwritten > 0 &&
            h("p", null, `Overwritten: ${confirmResult.overwritten}`),
          confirmResult.errors.length > 0 &&
            h(
              "div",
              { style: { color: "#f87171", fontSize: 12, marginTop: 8 } },
              ...confirmResult.errors.map((e: string, i: number) =>
                h("p", { key: i }, e)
              )
            )
        ),
      h(
        "button",
        {
          onClick: onClose,
          style: {
            padding: "8px 24px",
            borderRadius: 6,
            background: "#7c3aed",
            color: "#fff",
            border: "none",
            cursor: "pointer",
          },
        },
        "Done"
      )
    )
  );
}

// Toolbar button component
function UploadButton({ api }: { api: any }) {
  const [showModal, setShowModal] = useState(false);
  return h(
    React.Fragment,
    null,
    h(
      "button",
      {
        onClick: () => setShowModal(true),
        className: "btn-ghost p-1.5",
        title: "Mass Upload",
        style: { fontSize: 12, fontWeight: 600 },
      },
      "\u2B06 Upload"
    ),
    showModal &&
      h(UploadModal, {
        api,
        onClose: () => setShowModal(false),
      })
  );
}

let pluginApi: any;

export function activate(api: any): void {
  pluginApi = api;
  api.ui.registerEditorToolbarButton(
    () => h(UploadButton, { api }),
    { id: "mass-upload-btn", order: 100 }
  );
}

export function deactivate(): void {}
```

- [ ] **Step 2: Verify the toolbar button appears in the UI**

Start the dev server, open the app, and check for the Upload button in the editor toolbar.

- [ ] **Step 3: Commit**

```bash
git add packages/server/plugins/mass-upload/client/index.ts
git commit -m "feat(mass-upload): add client UI with 3-step modal workflow"
```

---

### Task 7: End-to-End Manual Test

- [ ] **Step 1: Create test markdown files**

```bash
mkdir -p /tmp/mass-upload-test/Projects
echo "# Test Note\nSome content" > /tmp/mass-upload-test/test.md
echo "# Project Ideas\n- Idea 1\n- Idea 2" > /tmp/mass-upload-test/Projects/ideas.md
echo "not a markdown" > /tmp/mass-upload-test/bad.txt
echo "" > /tmp/mass-upload-test/empty.md
```

- [ ] **Step 2: Test the full workflow in the browser**

1. Open mnemo in the browser
2. Click the "Upload" toolbar button
3. Select the test files from `/tmp/mass-upload-test/`
4. Set target folder to "Imported"
5. Check "Preserve folder structure"
6. Click "Upload & Validate"
7. Verify: `test.md` = valid, `ideas.md` = valid, `bad.txt` = invalid, `empty.md` = invalid
8. Click "Import"
9. Verify notes created in sidebar under "Imported/"

- [ ] **Step 3: Test duplicate detection**

1. Upload the same files again
2. Verify `test.md` and `ideas.md` show as "duplicate"
3. Set one to "Overwrite", one to "Skip"
4. Confirm and verify correct behavior

- [ ] **Step 4: Commit any fixes from manual testing**

```bash
git add -A packages/server/plugins/mass-upload/
git commit -m "fix(mass-upload): fixes from end-to-end testing"
```

---

---

## Review Fixes (apply during implementation)

These corrections were identified during spec review and MUST be applied when implementing Tasks 4-6:

### CRITICAL fixes

1. **Route registration (Task 4):** Do NOT use an Express Router object with `api.routes.register()`. Register each route handler individually via `api.routes.register('post', '/validate', handler)`. To use multer middleware, wrap it as a promise inside the handler:
   ```typescript
   api.routes.register("post", "/validate", async (req, res) => {
     const maxFileSize = ((await api.settings.get("maxFileSize")) as number) || 1048576;
     const upload = multer({ storage: multer.memoryStorage(), limits: { files: 500, fileSize: maxFileSize } });
     await new Promise<void>((resolve, reject) => {
       upload.array("files", 500)(req, res, (err) => err ? reject(err) : resolve());
     });
     // ... rest of validate handler
   });
   ```
   For route tests, assemble a standalone Express app in the test file using `express()` + `express.json()` + the handler functions directly.

2. **Duplicate detection tree flattening (Task 4):** `api.notes.list()` returns a tree (`NoteEntry[]` with `children`). Use `flattenNotePaths()` from `validation.ts` to recursively collect all file paths:
   ```typescript
   const existingNotes = await api.notes.list(userId);
   const existingPaths = flattenNotePaths(existingNotes);
   ```

3. **Dynamic multer fileSize (Task 4):** Create a new `multer()` instance per-request with the `maxFileSize` setting value as `limits.fileSize`. Do not hardcode the limit at initialization time.

### IMPORTANT fixes

4. **validateFile signature (Task 3-4):** The function takes `(originalName, resolvedPath, content, maxFileSize, existingPaths)` — two separate path arguments. The route handler builds `resolvedPath` from `targetFolder` + `preserveStructure` + `path.basename()`, then passes both the original filename and the computed resolved path.

5. **Client cancel cleanup (Task 6):** When `onClose` is called and `validationResult` exists, call `api.api.fetch(\`/session/${validationResult.sessionId}\`, { method: 'DELETE' })` to free server-side temp files and session slots.

6. **express.json() in route tests (Task 4):** Add `app.use(express.json())` in the test `beforeEach` before mounting route handlers, otherwise `req.body` will be `undefined` for the `/confirm` endpoint.

7. **In-flight tracking in deactivate (Task 4):** Add a `Set<Promise>` to track in-flight confirm operations. In `deactivate()`, await all pending promises before calling `sessionStore.cleanAll()`.

8. **Warning count in review summary (Task 6):** Show separate counts for valid, warning, duplicate, and invalid — don't lump warnings into valid count:
   ```typescript
   const validCount = files.filter((f) => f.status === "valid").length;
   const warnCount = files.filter((f) => f.status === "warning").length;
   const dupCount = files.filter((f) => f.status === "duplicate").length;
   const invalidCount = files.filter((f) => f.status === "invalid").length;
   // summary: `${validCount} valid, ${warnCount} warning(s), ${dupCount} duplicate(s), ${invalidCount} invalid`
   ```

---

### Task 8: Final Cleanup

- [ ] **Step 1: Run all plugin tests**

```bash
npx vitest run packages/server/plugins/mass-upload/
```
Expected: All tests PASS

- [ ] **Step 2: Run full project test suite**

```bash
npm test
```
Expected: No regressions

- [ ] **Step 3: Run lint**

```bash
npm run lint
```
Expected: No new lint errors

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(mass-upload): complete mass upload plugin with validation and bulk import"
```
