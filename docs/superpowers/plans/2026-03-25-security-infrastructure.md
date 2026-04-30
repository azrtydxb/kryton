# Security & Infrastructure Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical and high security vulnerabilities (GH issues #2-#24) and harden infrastructure configuration.

**Architecture:** Add rehype-sanitize to the markdown pipeline, create shared server utilities for path validation and error handling, add helmet for security headers, fix WebSocket auth, harden Docker and env config.

**Tech Stack:** TypeScript, Express 5, rehype-sanitize, helmet, ws, Docker, GitHub Actions

**Closes:** #2, #3, #4, #5, #6, #7, #8, #9, #10, #11, #12, #13, #14, #15, #16, #17, #18, #19, #20, #21, #22, #24

---

## File Structure

### New Files
- `packages/server/src/lib/pathUtils.ts` — Shared path validation, param decoding, extension normalization
- `packages/server/src/lib/errors.ts` — Custom error classes + Express error middleware
- `packages/server/src/lib/env.ts` — Zod-based environment validation with fail-fast
- `.dockerignore` — Exclude .env, .git, node_modules from Docker context
- `.editorconfig` — Consistent formatting across editors

### Modified Files
- `packages/client/src/components/Preview/Preview.tsx` — Add rehype-sanitize, fix embed XSS
- `packages/client/package.json` — Add rehype-sanitize dependency
- `packages/server/src/index.ts` — Add helmet, error middleware, env validation, remove notesDir from health
- `packages/server/src/plugins/PluginWebSocket.ts` — Add session auth on WebSocket upgrade
- `packages/server/src/plugins/PluginApiFactory.ts` — Add path traversal checks
- `packages/server/src/routes/plugins.ts` — Add plugin ID validation
- `packages/server/src/routes/templates.ts` — Fix path.sep in startsWith check
- `packages/server/src/routes/shares.ts` — Validate ownerUserId in access requests
- `packages/server/src/routes/admin.ts` — Validate role enum
- `packages/server/src/auth.ts` — Fix invite code marking, fix password reset logging, add BETTER_AUTH_SECRET
- `packages/server/src/middleware/auth.ts` — Export requireUser helper
- `packages/server/src/lib/validation.ts` — Add schemas for admin, shares, canvas, folders
- `packages/server/src/services/pluginRegistryService.ts` — Add URL validation, async fs
- `packages/server/package.json` — Add helmet dependency
- `Dockerfile` — Add non-root user, prisma generate, .dockerignore
- `docker-compose.prod.yml` — Add placeholder env vars, remove hardcoded passwords
- `.env.example` — Update with all used env vars
- `.github/workflows/ci.yml` — Pin actions to SHA

---

### Task 1: Add rehype-sanitize to fix stored XSS (#2, #3, #13)

**Files:**
- Modify: `packages/client/package.json`
- Modify: `packages/client/src/components/Preview/Preview.tsx`

- [ ] **Step 1: Install rehype-sanitize**

```bash
cd /Users/pascal/Development/kryton
npm install rehype-sanitize --workspace=packages/client
```

- [ ] **Step 2: Read Preview.tsx to understand current state**

Read `packages/client/src/components/Preview/Preview.tsx` fully.

- [ ] **Step 3: Add rehype-sanitize to the rehype pipeline**

In `Preview.tsx`, add the import and configure sanitization. The sanitizer must run AFTER `rehypeRaw` in the plugin chain:

```typescript
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

// Custom schema that allows safe elements but blocks scripts/event handlers
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // Allow class on div/span for styling (embeds, code blocks)
    div: [...(defaultSchema.attributes?.div || []), "className", "class"],
    span: [...(defaultSchema.attributes?.span || []), "className", "class"],
    // Allow data attributes for wiki links
    a: [...(defaultSchema.attributes?.a || []), "className", "class", ["dataWikiTarget", "data-wiki-target"]],
    // Allow src/alt on img (already filtered by our embed logic)
    img: [...(defaultSchema.attributes?.img || []), "src", "alt", "className", "class"],
    // Allow code highlighting classes
    code: [...(defaultSchema.attributes?.code || []), "className", "class"],
    pre: [...(defaultSchema.attributes?.pre || []), "className", "class"],
  },
  tagNames: [
    ...(defaultSchema.tagNames || []),
    // Keep standard HTML elements but NOT script, iframe, object, embed
    "div", "span", "details", "summary",
  ],
};
```

Then in the `ReactMarkdown` component, update rehypePlugins:

```typescript
rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema], [rehypeWikiLinks, { ... }], rehypeHighlight]}
```

- [ ] **Step 4: Fix note embed content injection**

In the embed processing code (~line 263), HTML-escape `noteName` before inserting into attributes:

```typescript
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
```

Update the embed replacement to use escapeHtml:

```typescript
return `<div class="embed-note"><div class="embed-note-header"><a class="wiki-link" data-wiki-target="${escapeHtml(noteName)}" href="#">${escapeHtml(noteName)}</a></div>\n\n${strippedContent}\n\n</div>`;
```

- [ ] **Step 5: Fix image embed alt attribute injection**

Update the image embed replacement (~line 258):

```typescript
.replace(
  /!\[\[([^\]]+\.(png|jpg|jpeg|gif|svg|webp|bmp))\]\]/gi,
  (_match, fileName: string) =>
    `<div class="embed-image"><img src="/api/files/${encodeURIComponent(fileName)}" alt="${escapeHtml(fileName)}" /></div>`
)
```

- [ ] **Step 6: Verify the app builds**

```bash
npm run build --workspace=packages/client
```
Expected: Build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/client/
git commit -m "fix(client): add rehype-sanitize to prevent stored XSS via shared notes

Closes #2, #3, #13"
```

---

### Task 2: Create shared path utilities (#7 from security, prep for #31 code quality)

**Files:**
- Create: `packages/server/src/lib/pathUtils.ts`

- [ ] **Step 1: Create the shared path utilities file**

```typescript
import path from "path";

/**
 * Validate that a resolved path is within the expected base directory.
 * Throws if path traversal is detected.
 */
export function validatePathWithinBase(fullPath: string, baseDir: string): void {
  const resolvedPath = path.resolve(fullPath);
  const resolvedBase = path.resolve(baseDir);
  if (
    !resolvedPath.startsWith(resolvedBase + path.sep) &&
    resolvedPath !== resolvedBase
  ) {
    throw new Error("Invalid path: outside allowed directory");
  }
}

/**
 * Decode a URL path parameter, handling Express 5's string | string[] params.
 */
export function decodePathParam(param: string | string[]): string {
  const raw = Array.isArray(param) ? param.join("/") : param;
  return decodeURIComponent(raw);
}

/**
 * Ensure a file path has the given extension.
 */
export function ensureExtension(filePath: string, ext: string): string {
  return filePath.endsWith(ext) ? filePath : `${filePath}${ext}`;
}

/**
 * Validate a plugin ID contains only safe characters.
 */
export function validatePluginId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Invalid plugin ID: must contain only alphanumeric, dash, or underscore");
  }
}

/**
 * The global user sentinel for global settings.
 */
export const GLOBAL_USER_ID = "__global__";
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/lib/pathUtils.ts
git commit -m "feat(server): add shared path utilities for validation, decoding, and extension handling"
```

---

### Task 3: Create error classes and Express error middleware (#34 from code quality, prep for #30)

**Files:**
- Create: `packages/server/src/lib/errors.ts`

- [ ] **Step 1: Create error classes and middleware**

```typescript
import type { Request, Response, NextFunction } from "express";

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid input") {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Access denied") {
    super(message, 403, "FORBIDDEN");
  }
}

/**
 * Classify filesystem errors into appropriate HTTP errors.
 */
export function classifyError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    if (
      err.message.includes("ENOENT") ||
      err.message.includes("no such file")
    ) {
      return new NotFoundError(err.message);
    }
    if (err.message.includes("Invalid path")) {
      return new ValidationError(err.message);
    }
  }
  return new AppError("Internal server error", 500, "INTERNAL_ERROR");
}

/**
 * Express error-handling middleware. Must be registered LAST.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const appError = classifyError(err);

  if (appError.statusCode >= 500) {
    console.error("[error]", err);
  }

  res.status(appError.statusCode).json({
    error: appError.message,
    ...(appError.code ? { code: appError.code } : {}),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/lib/errors.ts
git commit -m "feat(server): add error classes and Express error-handling middleware"
```

---

### Task 4: Create environment validation (#33, #10)

**Files:**
- Create: `packages/server/src/lib/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Create Zod-based env validation**

```typescript
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  APP_URL: z.string().url().default("http://localhost:5173"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3001"),
  PORT: z.coerce.number().default(3001),
  NOTES_DIR: z.string().default("../../notes"),
  WEBAUTHN_RP_ID: z.string().default("localhost"),
  // Optional OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  // Optional SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Environment validation failed:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}
```

- [ ] **Step 2: Update .env.example**

Read `.env.example` first, then replace with:

```env
# Required
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kryton
BETTER_AUTH_SECRET=change-me-to-a-random-64-char-string-use-openssl-rand-hex-32
APP_URL=http://localhost:5173
BETTER_AUTH_URL=http://localhost:3001

# Server
PORT=3001
NOTES_DIR=../../notes
WEBAUTHN_RP_ID=localhost

# OAuth (optional — enables social login when set)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# SMTP (optional — enables password reset emails when set)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/lib/env.ts .env.example
git commit -m "feat(server): add Zod-based env validation with fail-fast startup

Closes #33"
```

---

### Task 5: Add helmet + error middleware + env validation to server entry (#9, #18, #34)

**Files:**
- Modify: `packages/server/package.json` (add helmet)
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Install helmet**

```bash
npm install helmet --workspace=packages/server
```

- [ ] **Step 2: Read and modify index.ts**

Read `packages/server/src/index.ts` fully.

Add imports at top:

```typescript
import helmet from "helmet";
import { validateEnv } from "./lib/env.js";
import { errorHandler } from "./lib/errors.js";
```

Add env validation BEFORE any other initialization (after imports):

```typescript
const env = validateEnv();
```

Replace hardcoded env access with validated env values throughout.

Add helmet AFTER cors middleware:

```typescript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
```

Remove `notesDir` from health endpoint:

```typescript
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});
```

Add error-handling middleware as the LAST middleware:

```typescript
// Must be last
app.use(errorHandler);
```

- [ ] **Step 3: Verify build**

```bash
npm run build --workspace=packages/server
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/
git commit -m "feat(server): add helmet security headers, error middleware, env validation

Closes #9, #18, #34"
```

---

### Task 6: Fix WebSocket authentication (#8, #22)

**Files:**
- Modify: `packages/server/src/plugins/PluginWebSocket.ts`

- [ ] **Step 1: Read PluginWebSocket.ts**

Read `packages/server/src/plugins/PluginWebSocket.ts` fully.

- [ ] **Step 2: Add session verification on WebSocket upgrade**

Replace the constructor to verify auth during the upgrade handshake:

```typescript
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { auth } from "../auth.js";

export class PluginWebSocket {
  private wss: WebSocketServer;

  constructor(server: Server) {
    this.wss = new WebSocketServer({
      server,
      path: "/ws/plugins",
      maxPayload: 64 * 1024, // 64KB max message size
      verifyClient: async (
        info: { origin: string; secure: boolean; req: IncomingMessage },
        callback: (result: boolean, code?: number, message?: string) => void
      ) => {
        try {
          // Parse cookies from upgrade request
          const session = await auth.api.getSession({
            headers: new Headers({
              cookie: info.req.headers.cookie || "",
            }),
          });
          if (!session?.user) {
            callback(false, 401, "Unauthorized");
            return;
          }
          // Attach user to request for later use
          (info.req as any).__user = session.user;
          callback(true);
        } catch {
          callback(false, 401, "Unauthorized");
        }
      },
    });

    this.wss.on("connection", (ws) => {
      ws.on("error", (err) => {
        console.error("[ws] client error:", err.message);
      });
    });
  }

  broadcast(event: string, data: object): void {
    const payload = JSON.stringify({ event, data });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build --workspace=packages/server
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/plugins/PluginWebSocket.ts
git commit -m "fix(server): add WebSocket authentication and message size limits

Closes #8, #22"
```

---

### Task 7: Fix Plugin API path traversal (#5)

**Files:**
- Modify: `packages/server/src/plugins/PluginApiFactory.ts`

- [ ] **Step 1: Read PluginApiFactory.ts**

Read `packages/server/src/plugins/PluginApiFactory.ts` fully.

- [ ] **Step 2: Add path traversal validation to all notes API methods**

Import the shared utility and add checks to every method in `createNotesApi`:

```typescript
import { validatePathWithinBase } from "../lib/pathUtils.js";
```

In each method (`get`, `create`, `update`, `delete`, `list`), add after building `fullPath`:

```typescript
const userDir = path.join(notesDir, userId);
validatePathWithinBase(fullPath, userDir);
```

For the `list` method, validate the folder path similarly.

- [ ] **Step 3: Verify build**

```bash
npm run build --workspace=packages/server
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/plugins/PluginApiFactory.ts
git commit -m "fix(server): add path traversal protection to Plugin Notes API

Closes #5"
```

---

### Task 8: Fix plugin ID validation and plugin download security (#6, #7)

**Files:**
- Modify: `packages/server/src/routes/plugins.ts`
- Modify: `packages/server/src/services/pluginRegistryService.ts`

- [ ] **Step 1: Read plugins.ts route**

Read `packages/server/src/routes/plugins.ts` fully.

- [ ] **Step 2: Add plugin ID validation to all route handlers**

Import the shared utility:

```typescript
import { validatePluginId } from "../lib/pathUtils.js";
```

At the start of every handler that uses `req.params.id`, add:

```typescript
const id = req.params.id as string;
validatePluginId(id);
```

- [ ] **Step 3: Read and fix pluginRegistryService.ts**

Read `packages/server/src/services/pluginRegistryService.ts` fully.

Add URL validation for download URLs (must be from github.com):

```typescript
function validateDownloadUrl(url: string): void {
  const parsed = new URL(url);
  if (!parsed.hostname.endsWith("github.com") && !parsed.hostname.endsWith("githubusercontent.com")) {
    throw new Error(`Untrusted download URL: ${url}`);
  }
}
```

Call before each `downloadFileBytes()` invocation.

Also replace sync fs calls (`mkdirSync`, `writeFileSync`, `existsSync`, `rmSync`) with async equivalents from `fs/promises`.

- [ ] **Step 4: Verify build**

```bash
npm run build --workspace=packages/server
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/plugins.ts packages/server/src/services/pluginRegistryService.ts
git commit -m "fix(server): validate plugin IDs and download URLs, use async fs

Closes #6, #7"
```

---

### Task 9: Fix invite code reuse (#8 security)

**Files:**
- Modify: `packages/server/src/auth.ts`

- [ ] **Step 1: Read auth.ts**

Read `packages/server/src/auth.ts` fully.

- [ ] **Step 2: Fix the user.create.after hook to mark invite codes as used**

In the `after` hook for user creation, after directory provisioning, add:

```typescript
// Mark invite code as used
if (user?.id) {
  try {
    // Find the most recent unused invite code (the one that was just validated in the before hook)
    const unusedInvite = await prisma.inviteCode.findFirst({
      where: {
        usedById: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    if (unusedInvite) {
      await prisma.inviteCode.update({
        where: { id: unusedInvite.id },
        data: { usedById: user.id },
      });
    }
  } catch (err) {
    console.error("[auth] Failed to mark invite code as used:", err);
  }
}
```

Note: This is an approximation. Ideally the invite code value should be passed through from the `before` hook. Check if `better-auth` provides a way to pass context from `before` to `after` hooks. If not, store it in a module-level variable keyed by user email during the before hook and consume it in the after hook.

- [ ] **Step 3: Fix password reset URL logging**

Change the console.log that exposes the reset URL to only log that a reset was requested without the token:

```typescript
console.log(`[auth] Password reset requested for ${user.email} but SMTP not configured. Reset URL not sent.`);
```

- [ ] **Step 4: Verify build**

```bash
npm run build --workspace=packages/server
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth.ts
git commit -m "fix(server): mark invite codes as used, redact password reset URLs from logs

Closes #8 (invite), #20"
```

---

### Task 10: Fix template path traversal, admin role validation, access request validation (#14, #15, #16)

**Files:**
- Modify: `packages/server/src/routes/templates.ts`
- Modify: `packages/server/src/routes/admin.ts`
- Modify: `packages/server/src/routes/shares.ts`

- [ ] **Step 1: Read and fix templates.ts**

Read `packages/server/src/routes/templates.ts`. Fix the `startsWith` check to include `path.sep`:

```typescript
if (!resolved.startsWith(path.resolve(templatesDir) + path.sep)) {
```

- [ ] **Step 2: Read and fix admin.ts role validation**

Read `packages/server/src/routes/admin.ts`. In the PUT handler for user updates, validate role:

```typescript
const validRoles = ["user", "admin"];
if (role !== undefined && (typeof role !== "string" || !validRoles.includes(role))) {
  res.status(400).json({ error: "Invalid role. Must be 'user' or 'admin'" });
  return;
}
```

- [ ] **Step 3: Read and fix shares.ts access request validation**

Read `packages/server/src/routes/shares.ts`. In the POST access-requests handler, validate ownerUserId exists:

```typescript
const ownerExists = await prisma.user.findUnique({ where: { id: ownerUserId } });
if (!ownerExists) {
  res.status(400).json({ error: "Invalid owner user ID" });
  return;
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build --workspace=packages/server
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/templates.ts packages/server/src/routes/admin.ts packages/server/src/routes/shares.ts
git commit -m "fix(server): fix template path check, validate admin role values, validate access request ownerUserId

Closes #14, #15, #16"
```

---

### Task 11: Fix plugin list endpoint auth + Swagger/health info leaks (#17, #18)

**Files:**
- Modify: `packages/server/src/routes/plugins.ts`

- [ ] **Step 1: Add adminMiddleware to plugin list endpoints**

In `plugins.ts`, add `adminMiddleware` to the GET `/active` and GET `/all` handlers. Import `adminMiddleware` from the middleware module.

Note: If non-admin users need to know which plugins are active for client-side loading, create a minimal endpoint that returns only plugin IDs and client bundle paths.

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/routes/plugins.ts
git commit -m "fix(server): require admin auth for plugin list endpoints

Closes #17"
```

---

### Task 12: Harden Docker configuration (#11, #12, #19)

**Files:**
- Modify: `Dockerfile`
- Create: `.dockerignore`
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: Create .dockerignore**

```
.git
.env
.env.*
node_modules
*.md
docs/
logos/
.github/
.vscode/
.editorconfig
```

- [ ] **Step 2: Read and fix Dockerfile**

Read `Dockerfile`. Add non-root user and prisma generate:

After the build stage's `npm run build`, add:

```dockerfile
RUN npx prisma generate --schema=packages/server/prisma/schema.prisma
```

In the production stage, add before CMD:

```dockerfile
RUN addgroup -S app && adduser -S app -G app
RUN chown -R app:app /app
USER app
```

- [ ] **Step 3: Read and fix docker-compose.prod.yml**

Read `docker-compose.prod.yml`. Replace hardcoded passwords with environment variable references:

```yaml
services:
  kryton:
    environment:
      - DATABASE_URL=postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-kryton}
      - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:?Set BETTER_AUTH_SECRET}
      - APP_URL=${APP_URL:-http://localhost:3100}
      - NOTES_DIR=/notes
  db:
    environment:
      - POSTGRES_DB=${POSTGRES_DB:-kryton}
      - POSTGRES_USER=${POSTGRES_USER:-postgres}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}
```

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.prod.yml
git commit -m "fix: harden Docker — non-root user, .dockerignore, no hardcoded passwords

Closes #11, #12, #19"
```

---

### Task 13: Pin CI actions to SHA + add DoS limits (#24 minor collection items)

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `packages/server/src/lib/validation.ts`

- [ ] **Step 1: Read ci.yml**

Read `.github/workflows/ci.yml`.

- [ ] **Step 2: Pin all actions to SHA hashes**

Look up the current SHA for each action's version tag and replace. For example:

```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
- uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
```

Do this for all `uses:` entries.

- [ ] **Step 3: Add max length to Zod content schemas**

Read `packages/server/src/lib/validation.ts`. Add `.max()` to string fields:

```typescript
export const createNoteSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(1_000_000), // 1MB max
});

export const updateNoteSchema = z.object({
  content: z.string().max(1_000_000),
});
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml packages/server/src/lib/validation.ts
git commit -m "fix: pin CI actions to SHA, add content size limits to validation schemas

Closes #24 (partial)"
```

---

### Task 14: Fix open registration race + add requireUser helper (#19 security, #37)

**Files:**
- Modify: `packages/server/src/middleware/auth.ts`

- [ ] **Step 1: Read middleware/auth.ts**

Read `packages/server/src/middleware/auth.ts` fully.

- [ ] **Step 2: Add requireUser helper**

Add after the existing middleware exports:

```typescript
/**
 * Extract authenticated user from request, throwing 401 if not present.
 * Eliminates the need for req.user! non-null assertions.
 */
export function requireUser(req: Request): { id: string; email: string; name: string; role: string } {
  if (!req.user) {
    throw new AppError("Authentication required", 401, "UNAUTHORIZED");
  }
  return req.user;
}
```

Import `AppError` from `../lib/errors.js`.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/middleware/auth.ts
git commit -m "feat(server): add requireUser helper to eliminate non-null assertions"
```
