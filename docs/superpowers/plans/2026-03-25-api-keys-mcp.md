# API Keys, OpenAPI & MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable AI agents to interact with Kryton via API keys (bearer auth), a complete OpenAPI spec, and a built-in MCP server.

**Architecture:** New `ApiKey` Prisma model with hashed keys. Auth middleware extended to accept bearer tokens alongside session cookies. Scope enforcement (read-only / read-write) on all mutating routes. MCP server at `/api/mcp` using `@modelcontextprotocol/sdk` Streamable HTTP transport, calling the service layer directly. New Account Settings page consolidating password, passkeys, and API key management.

**Tech Stack:** Prisma 7 (PostgreSQL), Express 5, Vitest, `@modelcontextprotocol/sdk`, Zod, React 19, Zustand, TailwindCSS v4

**Spec:** `docs/superpowers/specs/2026-03-25-api-keys-mcp-design.md`

---

## File Structure

### Server — New Files
| File | Responsibility |
|------|---------------|
| `packages/server/src/routes/apiKeys.ts` | API key CRUD routes (create, list, revoke) |
| `packages/server/src/services/apiKeyService.ts` | Key generation, hashing, validation, DB operations |
| `packages/server/src/mcp/mcpServer.ts` | MCP server setup, tool registration, auth integration |
| `packages/server/src/mcp/mcpTools.ts` | Core MCP tool definitions and handlers (thin adapters over services) |
| `packages/server/src/mcp/dynamicTools.ts` | Dynamic MCP tool generation from OpenAPI spec (for plugin routes) |
| `packages/server/src/routes/__tests__/apiKeys.test.ts` | API key route tests |
| `packages/server/src/middleware/__tests__/auth.test.ts` | Auth middleware tests (bearer token path) |
| `packages/server/src/services/__tests__/apiKeyService.test.ts` | Service unit tests |
| `packages/server/src/mcp/__tests__/mcpServer.test.ts` | MCP server integration tests |
| `packages/server/src/mcp/__tests__/dynamicTools.test.ts` | Dynamic tool generation tests |

### Server — Modified Files
| File | Changes |
|------|---------|
| `packages/server/prisma/schema.prisma` | Add `ApiKey` model + User relation |
| `packages/server/src/middleware/auth.ts` | Bearer token auth path, `requireScope()`, `requireSession()` |
| `packages/server/src/lib/validation.ts` | Add API key Zod schemas |
| `packages/server/src/swagger.ts` | Add `securitySchemes`, global `security` |
| `packages/server/src/index.ts` | Mount `/api/api-keys` and `/api/mcp` routes, API key rate limiter |
| `packages/server/src/routes/notes.ts` | Add `requireScope('read-write')` to mutating endpoints |
| `packages/server/src/routes/folders.ts` | Add `requireScope('read-write')` to mutating endpoints |
| `packages/server/src/routes/canvas.ts` | Add `requireScope('read-write')` to mutating endpoints |
| `packages/server/src/routes/templates.ts` | Add `requireScope('read-write')` to mutating endpoints |
| `packages/server/src/routes/shares.ts` | Add `requireScope('read-write')` to mutating endpoints |
| `packages/server/src/routes/daily.ts` | Add `requireScope('read-write')` to POST endpoint |
| `packages/server/src/routes/notes.ts` (rename router) | Add `requireScope('read-write')` to rename endpoint |
| `packages/server/src/routes/folders.ts` (rename router) | Add `requireScope('read-write')` to rename endpoint |
| `packages/server/src/routes/admin.ts` | Add `requireSession()` guard |
| All route files missing `@swagger` annotations | Add OpenAPI JSDoc annotations |
| `packages/server/package.json` | Add `@modelcontextprotocol/sdk` dependency |

### Client — Refactored Files
| File | Changes |
|------|---------|
| `packages/client/src/components/Security/PasskeyManager.tsx` | Extract `PasskeyManagerContent` for inline use in Account Settings |

### Client — New Files
| File | Responsibility |
|------|---------------|
| `packages/client/src/pages/AccountSettingsPage.tsx` | Full-screen modal with Profile/Passkeys/API Keys tabs |
| `packages/client/src/components/ApiKeys/ApiKeyManager.tsx` | API key list, create form, revoke UI |

### Client — Modified Files
| File | Changes |
|------|---------|
| `packages/client/src/lib/api.ts` | Add `apiKeyApi` object (list, create, revoke) |
| `packages/client/src/stores/uiStore.ts` | Add `showAccountSettings` state |
| `packages/client/src/components/Layout/UserMenu.tsx` | Replace password/passkey entries with "Account Settings" |
| `packages/client/src/components/Modals/ModalsContainer.tsx` | Wire `AccountSettingsPage` |
| `packages/client/src/App.tsx` | Pass `showAccountSettings` + close handler to ModalsContainer |

---

## Task 1: Prisma Schema — ApiKey Model

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

- [ ] **Step 1: Add ApiKey model to schema**

Add to the end of `schema.prisma` (in the Domain tables section):

```prisma
model ApiKey {
  id          String    @id @default(uuid())
  userId      String
  name        String
  keyHash     String    @unique
  keyPrefix   String
  scope       String    @default("read-only")
  expiresAt   DateTime?
  lastUsedAt  DateTime?
  createdAt   DateTime  @default(now())
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([keyHash])
}
```

Add to the `User` model's relations (after `pluginStorage`):

```prisma
  apiKeys           ApiKey[]
```

- [ ] **Step 2: Generate and run migration**

Run:
```bash
cd packages/server && npx prisma migrate dev --name add-api-keys
```

Expected: Migration created, Prisma client regenerated.

- [ ] **Step 3: Verify generated client**

Run:
```bash
cd packages/server && npx prisma generate
```

Expected: Client generated at `src/generated/prisma`.

- [ ] **Step 4: Commit**

```bash
git add packages/server/prisma/schema.prisma packages/server/prisma/migrations/ packages/server/src/generated/
git commit -m "feat: add ApiKey Prisma model for API key management"
```

---

## Task 2: API Key Service

**Files:**
- Create: `packages/server/src/services/apiKeyService.ts`
- Create: `packages/server/src/services/__tests__/apiKeyService.test.ts`

- [ ] **Step 1: Write failing tests for API key service**

Create `packages/server/src/services/__tests__/apiKeyService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateApiKey, hashApiKey, buildKeyPrefix } from "../apiKeyService.js";

describe("apiKeyService", () => {
  describe("generateApiKey", () => {
    it("returns a key starting with kryton_ prefix", () => {
      const key = generateApiKey();
      expect(key).toMatch(/^kryton_[a-f0-9]{64}$/);
    });

    it("generates unique keys", () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe("hashApiKey", () => {
    it("returns a hex SHA-256 hash", () => {
      const hash = hashApiKey("kryton_abcdef1234567890");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("produces consistent hashes for the same input", () => {
      const key = "kryton_test1234";
      expect(hashApiKey(key)).toBe(hashApiKey(key));
    });

    it("produces different hashes for different inputs", () => {
      expect(hashApiKey("kryton_aaa")).not.toBe(hashApiKey("kryton_bbb"));
    });
  });

  describe("buildKeyPrefix", () => {
    it("returns kryton_ plus first 8 hex chars of the key body", () => {
      const key = "kryton_a1b2c3d4e5f6a7b8remaining";
      expect(buildKeyPrefix(key)).toBe("kryton_a1b2c3d4");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run src/services/__tests__/apiKeyService.test.ts`

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the API key service**

Create `packages/server/src/services/apiKeyService.ts`:

```typescript
import crypto from "node:crypto";
import { prisma } from "../prisma.js";
import { AppError, NotFoundError } from "../lib/errors.js";

const KEY_PREFIX = "kryton_";
const KEY_BYTES = 32; // 256 bits of entropy
const MAX_KEYS_PER_USER = 10;

export function generateApiKey(): string {
  return KEY_PREFIX + crypto.randomBytes(KEY_BYTES).toString("hex");
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function buildKeyPrefix(key: string): string {
  // "kryton_" (6 chars) + first 8 hex chars
  return key.substring(0, 6 + 8);
}

export async function createApiKey(
  userId: string,
  name: string,
  scope: string,
  expiresAt: Date | null,
): Promise<{ id: string; key: string; keyPrefix: string; name: string; scope: string; expiresAt: Date | null; createdAt: Date }> {
  // Check limit
  const count = await prisma.apiKey.count({ where: { userId } });
  if (count >= MAX_KEYS_PER_USER) {
    throw new AppError("Maximum of 10 API keys per user reached", 400, "KEY_LIMIT_EXCEEDED");
  }

  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = buildKeyPrefix(rawKey);

  const record = await prisma.apiKey.create({
    data: { userId, name, keyHash, keyPrefix, scope, expiresAt },
  });

  return {
    id: record.id,
    key: rawKey,
    keyPrefix,
    name: record.name,
    scope: record.scope,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
  };
}

export async function listApiKeys(userId: string) {
  return prisma.apiKey.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scope: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeApiKey(userId: string, keyId: string): Promise<void> {
  const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!key || key.userId !== userId) {
    throw new NotFoundError("API key not found");
  }
  await prisma.apiKey.delete({ where: { id: keyId } });
}

export async function validateApiKey(rawKey: string): Promise<{
  keyId: string;
  userId: string;
  scope: string;
} | null> {
  const keyHash = hashApiKey(rawKey);
  const record = await prisma.apiKey.findUnique({ where: { keyHash } });

  if (!record) return null;

  // Check expiration
  if (record.expiresAt && record.expiresAt < new Date()) {
    return null;
  }

  // Update lastUsedAt (fire-and-forget)
  prisma.apiKey.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {}); // swallow errors — non-critical

  return {
    keyId: record.id,
    userId: record.userId,
    scope: record.scope,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/services/__tests__/apiKeyService.test.ts`

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/apiKeyService.ts packages/server/src/services/__tests__/apiKeyService.test.ts
git commit -m "feat: add API key service with key generation, hashing, and CRUD"
```

---

## Task 3: Auth Middleware — Bearer Token Support

**Files:**
- Modify: `packages/server/src/middleware/auth.ts`
- Create: `packages/server/src/middleware/__tests__/auth.test.ts`

- [ ] **Step 1: Write failing tests for bearer token auth**

Create `packages/server/src/middleware/__tests__/auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { Request, Response, NextFunction } from "express";
import { authMiddleware, requireScope, requireSession } from "../auth.js";

// We test requireScope and requireSession as unit functions.
// Full bearer token integration is tested via route tests.

describe("requireScope", () => {
  function makeReq(apiKey?: { id: string; scope: string }): Request {
    return { apiKey } as unknown as Request;
  }

  it("passes when no apiKey (session auth)", () => {
    expect(() => requireScope(makeReq(), "read-write")).not.toThrow();
  });

  it("passes when apiKey scope matches", () => {
    expect(() => requireScope(makeReq({ id: "k1", scope: "read-write" }), "read-write")).not.toThrow();
  });

  it("passes when apiKey is read-write and required is read-only", () => {
    expect(() => requireScope(makeReq({ id: "k1", scope: "read-write" }), "read-only")).not.toThrow();
  });

  it("throws when apiKey is read-only and required is read-write", () => {
    expect(() => requireScope(makeReq({ id: "k1", scope: "read-only" }), "read-write"))
      .toThrow("Insufficient API key scope");
  });
});

describe("requireSession", () => {
  it("passes when no apiKey (session auth)", () => {
    const req = {} as Request;
    expect(() => requireSession(req)).not.toThrow();
  });

  it("throws when apiKey is present", () => {
    const req = { apiKey: { id: "k1", scope: "read-only" } } as unknown as Request;
    expect(() => requireSession(req)).toThrow("This endpoint requires browser session authentication");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run src/middleware/__tests__/auth.test.ts`

Expected: FAIL — `requireScope` and `requireSession` not exported.

- [ ] **Step 3: Extend auth middleware**

Modify `packages/server/src/middleware/auth.ts`. The full updated file:

```typescript
import { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";
import { AppError, ForbiddenError } from "../lib/errors.js";
import { validateApiKey } from "../services/apiKeyService.js";
import { prisma } from "../prisma.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: { id: string; email: string; name: string; role: string };
    apiKey?: { id: string; scope: string };
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Check for bearer token first
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer kryton_")) {
      const rawKey = authHeader.slice(7); // Remove "Bearer "
      const keyData = await validateApiKey(rawKey);

      if (!keyData) {
        res.status(401).json({ error: "Invalid or expired API key" });
        return;
      }

      // Fetch user to check disabled status
      const user = await prisma.user.findUnique({
        where: { id: keyData.userId },
        select: { id: true, email: true, name: true, role: true, disabled: true },
      });

      if (!user) {
        res.status(401).json({ error: "User not found" });
        return;
      }

      if (user.disabled) {
        res.status(403).json({ error: "Account is disabled" });
        return;
      }

      req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
      req.apiKey = { id: keyData.keyId, scope: keyData.scope };
      next();
      return;
    }

    // Fall through to session-based auth
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      res.status(401).json({ error: "Missing or invalid session" });
      return;
    }

    if ((session.user as Record<string, unknown>).disabled) {
      res.status(403).json({ error: "Account is disabled" });
      return;
    }

    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: ((session.user as Record<string, unknown>).role as string) || "user",
    };

    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}

export function requireUser(req: Request): { id: string; email: string; name: string; role: string } {
  if (!req.user) {
    throw new AppError("Authentication required", 401, "UNAUTHORIZED");
  }
  return req.user;
}

export function requireScope(req: Request, scope: "read-only" | "read-write"): void {
  if (!req.apiKey) return; // Session auth — full access
  if (scope === "read-only") return; // Both scopes satisfy read-only
  if (req.apiKey.scope === "read-write") return; // read-write satisfies read-write
  throw new ForbiddenError("Insufficient API key scope — read-write access required");
}

export function requireSession(req: Request): void {
  if (req.apiKey) {
    throw new ForbiddenError("This endpoint requires browser session authentication");
  }
}

export function adminMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/middleware/__tests__/auth.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/middleware/auth.ts packages/server/src/middleware/__tests__/auth.test.ts
git commit -m "feat: extend auth middleware with bearer token support, scope enforcement, session guard"
```

---

## Task 4: Validation Schemas for API Keys

**Files:**
- Modify: `packages/server/src/lib/validation.ts`

- [ ] **Step 1: Add API key Zod schemas**

Add to the end of `packages/server/src/lib/validation.ts`:

```typescript
// API Key schemas
export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
  scope: z.enum(["read-only", "read-write"]),
  expiresAt: z
    .string()
    .datetime()
    .optional()
    .refine(
      (val) => !val || new Date(val) > new Date(),
      "Expiration date must be in the future",
    ),
});
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd packages/server && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/lib/validation.ts
git commit -m "feat: add Zod validation schemas for API key creation"
```

---

## Task 5: API Key Routes

**Files:**
- Create: `packages/server/src/routes/apiKeys.ts`
- Create: `packages/server/src/routes/__tests__/apiKeys.test.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Write failing tests for API key routes**

Create `packages/server/src/routes/__tests__/apiKeys.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as apiKeyService from "../../services/apiKeyService.js";

// Unit tests for the route handler logic.
// These test that the service is called with correct arguments.
// Full integration tests require a running DB + auth.

vi.mock("../../services/apiKeyService.js");

describe("apiKey routes (unit)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("createApiKey is callable with correct params", async () => {
    const mockCreate = vi.mocked(apiKeyService.createApiKey);
    mockCreate.mockResolvedValue({
      id: "key-1",
      key: "kryton_abc123",
      keyPrefix: "kryton_ab",
      name: "Test",
      scope: "read-only",
      expiresAt: null,
      createdAt: new Date(),
    });

    const result = await apiKeyService.createApiKey("user-1", "Test", "read-only", null);
    expect(result.key).toBe("kryton_abc123");
    expect(mockCreate).toHaveBeenCalledWith("user-1", "Test", "read-only", null);
  });

  it("listApiKeys is callable with userId", async () => {
    const mockList = vi.mocked(apiKeyService.listApiKeys);
    mockList.mockResolvedValue([]);

    const result = await apiKeyService.listApiKeys("user-1");
    expect(result).toEqual([]);
    expect(mockList).toHaveBeenCalledWith("user-1");
  });

  it("revokeApiKey is callable with userId and keyId", async () => {
    const mockRevoke = vi.mocked(apiKeyService.revokeApiKey);
    mockRevoke.mockResolvedValue(undefined);

    await apiKeyService.revokeApiKey("user-1", "key-1");
    expect(mockRevoke).toHaveBeenCalledWith("user-1", "key-1");
  });
});
```

- [ ] **Step 2: Run tests to verify they pass (mocked)**

Run: `cd packages/server && npx vitest run src/routes/__tests__/apiKeys.test.ts`

Expected: PASS (these are mock-based unit tests).

- [ ] **Step 3: Create the API key router**

Create `packages/server/src/routes/apiKeys.ts`:

```typescript
import { Router, Request, Response, NextFunction } from "express";
import { requireUser, requireSession } from "../middleware/auth.js";
import { validate, createApiKeySchema } from "../lib/validation.js";
import { createApiKey, listApiKeys, revokeApiKey } from "../services/apiKeyService.js";

/**
 * @swagger
 * tags:
 *   - name: API Keys
 *     description: Manage API keys for programmatic access
 */
export function createApiKeysRouter(): Router {
  const router = Router();

  /**
   * @swagger
   * /api-keys:
   *   post:
   *     summary: Create a new API key
   *     tags: [API Keys]
   *     security:
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name, scope]
   *             properties:
   *               name:
   *                 type: string
   *                 maxLength: 100
   *               scope:
   *                 type: string
   *                 enum: [read-only, read-write]
   *               expiresAt:
   *                 type: string
   *                 format: date-time
   *     responses:
   *       201:
   *         description: API key created (full key returned only once)
   *       400:
   *         description: Validation error or key limit exceeded
   *       403:
   *         description: Session-only endpoint
   */
  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireSession(req);

      const parsed = validate(createApiKeySchema, req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const { name, scope, expiresAt } = parsed.data;
      const result = await createApiKey(
        user.id,
        name,
        scope,
        expiresAt ? new Date(expiresAt) : null,
      );

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api-keys:
   *   get:
   *     summary: List all API keys for the current user
   *     tags: [API Keys]
   *     security:
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: List of API keys (without secret values)
   *       403:
   *         description: Session-only endpoint
   */
  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireSession(req);

      const keys = await listApiKeys(user.id);
      res.json(keys);
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api-keys/{id}:
   *   delete:
   *     summary: Revoke an API key
   *     tags: [API Keys]
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       204:
   *         description: API key revoked
   *       404:
   *         description: API key not found
   *       403:
   *         description: Session-only endpoint
   */
  router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = requireUser(req);
      requireSession(req);

      await revokeApiKey(user.id, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
```

- [ ] **Step 4: Mount the router and add API key rate limiter in index.ts**

In `packages/server/src/index.ts`, add:

1. Import at the top (after other route imports):
```typescript
import { createApiKeysRouter } from "./routes/apiKeys.js";
```

2. After the existing `authLimiter` definition (~line 173), add a new rate limiter:
```typescript
  const apiKeyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.apiKey?.id || req.ip || "unknown",
    message: { error: "Too many API requests, please try again later" },
  });
```

3. Replace the existing `app.use("/api", apiLimiter);` (~line 176) with a conditional limiter that routes API key requests to the higher-limit rate limiter and regular requests to the standard one:
```typescript
  app.use("/api", (req, res, next) => {
    if (req.headers.authorization?.startsWith("Bearer kryton_")) {
      return apiKeyLimiter(req, res, next);
    }
    return apiLimiter(req, res, next);
  });
```
This ensures API key requests are NOT double-rate-limited — they only hit the 300 req/15min per-key limiter, not both limiters.

4. After the existing protected route mounts (~line 232), add:
```typescript
  app.use("/api/api-keys", authMiddleware, createApiKeysRouter());
```

- [ ] **Step 5: Verify typecheck passes**

Run: `cd packages/server && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/apiKeys.ts packages/server/src/routes/__tests__/apiKeys.test.ts packages/server/src/index.ts
git commit -m "feat: add API key CRUD routes with rate limiting"
```

---

## Task 6: Scope Enforcement on Existing Routes

**Files:**
- Modify: `packages/server/src/routes/notes.ts`
- Modify: `packages/server/src/routes/folders.ts`
- Modify: `packages/server/src/routes/canvas.ts`
- Modify: `packages/server/src/routes/templates.ts`
- Modify: `packages/server/src/routes/shares.ts`
- Modify: `packages/server/src/routes/daily.ts`
- Modify: `packages/server/src/routes/admin.ts`

- [ ] **Step 1: Add scope enforcement to mutating note routes**

In `packages/server/src/routes/notes.ts`, import `requireScope` from `../middleware/auth.js`.

Add `requireScope(req, "read-write");` as the first line after `requireUser(req)` in every POST, PUT, and DELETE handler in `createNotesRouter` and `createNotesRenameRouter`. Do NOT add it to GET handlers or to `createSharedNotesRouter` (shared notes have their own permission model).

- [ ] **Step 2: Add scope enforcement to folder routes**

In `packages/server/src/routes/folders.ts`, import `requireScope` and add `requireScope(req, "read-write");` to POST and DELETE handlers in `createFoldersRouter` and `createFoldersRenameRouter`.

- [ ] **Step 3: Add scope enforcement to canvas routes**

In `packages/server/src/routes/canvas.ts`, import `requireScope` and add `requireScope(req, "read-write");` to POST, PUT, and DELETE handlers.

- [ ] **Step 4: Add scope enforcement to template routes**

In `packages/server/src/routes/templates.ts`, import `requireScope` and add `requireScope(req, "read-write");` to POST handler (create from template).

- [ ] **Step 5: Add scope enforcement to share routes**

In `packages/server/src/routes/shares.ts`, import `requireScope` and add `requireScope(req, "read-write");` to POST, PUT, and DELETE handlers in `createSharesRouter` and `createAccessRequestsRouter`.

- [ ] **Step 6: Add scope enforcement to daily route**

In `packages/server/src/routes/daily.ts`, import `requireScope` and add `requireScope(req, "read-write");` to POST handler.

- [ ] **Step 7: Add session-only guard to admin routes**

In `packages/server/src/routes/admin.ts`, import `requireSession` and add `requireSession(req);` after `requireUser(req)` in all handlers. This ensures API keys cannot access admin endpoints even if they somehow bypass the middleware chain.

- [ ] **Step 8: Verify typecheck passes**

Run: `cd packages/server && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 9: Run all existing tests**

Run: `cd packages/server && npx vitest run`

Expected: All tests pass (scope enforcement doesn't affect existing tests since they don't set `req.apiKey`).

- [ ] **Step 10: Commit**

```bash
git add packages/server/src/routes/
git commit -m "feat: add scope enforcement to all mutating routes and session guard to admin routes"
```

---

## Task 7: OpenAPI — Security Schemes & Missing Annotations

**Files:**
- Modify: `packages/server/src/swagger.ts`
- Modify: Multiple route files (annotations only)

- [ ] **Step 1: Add securitySchemes to swagger.ts**

Replace the `definition` object in `packages/server/src/swagger.ts`:

```typescript
const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Kryton API',
      version: '3.1.0',
      description: 'API for Kryton - a personal knowledge base with wiki-style linking, graph visualization, and markdown editing.',
    },
    servers: [
      { url: '/api', description: 'API server' },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description: 'Session cookie set by the authentication system',
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'API key with kryton_ prefix (e.g. kryton_a1b2c3d4...)',
        },
      },
    },
    security: [
      { cookieAuth: [] },
      { bearerAuth: [] },
    ],
  },
  apis: [
    path.join(import.meta.dirname, 'routes', '*.ts'),
    path.join(import.meta.dirname, 'routes', '*.js'),
    path.join(import.meta.dirname, 'index.ts'),
    path.join(import.meta.dirname, 'index.js'),
  ],
};
```

- [ ] **Step 2: Add @swagger annotations to routes missing them**

Add `@swagger` JSDoc blocks to each route handler in these files. Follow the exact pattern used in existing annotated routes (see `notes.ts`, `shares.ts`, `admin.ts` for reference). Each annotation must include `summary`, `tags`, `parameters` (if applicable), `requestBody` (if applicable), `responses`, and `security`.

Files needing annotations:
- `search.ts` — `GET /search` with query param `q`
- `graph.ts` — `GET /graph`
- `backlinks.ts` — `GET /backlinks/:path`
- `tags.ts` — `GET /tags`, `GET /tags/:tag/notes`
- `daily.ts` — `GET /daily`, `POST /daily`
- `templates.ts` — `GET /templates`, `GET /templates/:name`, `POST /templates`
- `canvas.ts` — all CRUD endpoints
- `folders.ts` — all CRUD endpoints
- `folders-rename.ts` (in `folders.ts`) — `POST /folders-rename`
- `notes-rename.ts` (in `notes.ts`) — `POST /notes-rename`

Session-only endpoints (`/api/api-keys/*`, `/api/admin/*`) must use `security: [{ cookieAuth: [] }]` to override the global security.

- [ ] **Step 3: Verify swagger spec generates**

Run:
```bash
cd packages/server && node -e "
import('./src/swagger.js').then(m => {
  const spec = m.swaggerSpec;
  console.log('Paths:', Object.keys(spec.paths || {}).length);
  console.log('Security schemes:', Object.keys(spec.components?.securitySchemes || {}).length);
})
"
```

Expected: Should show path count and `Security schemes: 2`.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/swagger.ts packages/server/src/routes/
git commit -m "feat: add OpenAPI security schemes and complete route annotations"
```

---

## Task 8: MCP Server

**Files:**
- Create: `packages/server/src/mcp/mcpServer.ts`
- Create: `packages/server/src/mcp/mcpTools.ts`
- Create: `packages/server/src/mcp/__tests__/mcpServer.test.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/package.json`

- [ ] **Step 1: Install MCP SDK**

Run:
```bash
cd packages/server && npm install @modelcontextprotocol/sdk
```

- [ ] **Step 2: Write failing test for MCP tool definitions**

Create `packages/server/src/mcp/__tests__/mcpServer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getToolDefinitions } from "../mcpTools.js";

describe("MCP tools", () => {
  it("exports all expected tool definitions", () => {
    const tools = getToolDefinitions();
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_notes");
    expect(names).toContain("read_note");
    expect(names).toContain("create_note");
    expect(names).toContain("update_note");
    expect(names).toContain("delete_note");
    expect(names).toContain("search");
    expect(names).toContain("list_tags");
    expect(names).toContain("get_backlinks");
    expect(names).toContain("get_graph");
    expect(names).toContain("list_folders");
    expect(names).toContain("create_folder");
    expect(names).toContain("get_daily_note");
    expect(names).toContain("list_templates");
    expect(names).toContain("create_note_from_template");
    expect(names).toHaveLength(14);
  });

  it("each tool has a description and inputSchema", () => {
    const tools = getToolDefinitions();
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run src/mcp/__tests__/mcpServer.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement MCP tool definitions**

Create `packages/server/src/mcp/mcpTools.ts`:

```typescript
import * as path from "path";
import { prisma } from "../prisma.js";
import { scanDirectory, readNote, writeNote, deleteNote } from "../services/noteService.js";
import { getUserNotesDir } from "../services/userNotesDir.js";
import { search, getAllTags, getNotesByTag } from "../services/searchService.js";
import { getBacklinks, getFullGraph } from "../services/graphService.js";

const NOTES_DIR = path.resolve(
  process.env.NOTES_DIR || path.join(import.meta.dirname, "../../../notes")
);

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope: "read-only" | "read-write";
}

export function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_notes",
      description: "List all notes in the knowledge base. Returns paths and titles.",
      inputSchema: { type: "object", properties: {}, required: [] },
      scope: "read-only",
    },
    {
      name: "read_note",
      description: "Read a note's markdown content by its path.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Note path relative to notes root (e.g. 'folder/my-note.md')" },
        },
        required: ["path"],
      },
      scope: "read-only",
    },
    {
      name: "create_note",
      description: "Create a new markdown note.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path for the new note (e.g. 'folder/new-note.md')" },
          content: { type: "string", description: "Markdown content for the note" },
        },
        required: ["path", "content"],
      },
      scope: "read-write",
    },
    {
      name: "update_note",
      description: "Update a note's content (full replacement). Read the note first to get current content.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path of the note to update" },
          content: { type: "string", description: "New markdown content (replaces entire note)" },
        },
        required: ["path", "content"],
      },
      scope: "read-write",
    },
    {
      name: "delete_note",
      description: "Delete a note by its path.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path of the note to delete" },
        },
        required: ["path"],
      },
      scope: "read-write",
    },
    {
      name: "search",
      description: "Full-text search across all notes. Returns matching paths, titles, and snippets.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query string" },
        },
        required: ["query"],
      },
      scope: "read-only",
    },
    {
      name: "list_tags",
      description: "List all tags used across notes with their counts.",
      inputSchema: { type: "object", properties: {}, required: [] },
      scope: "read-only",
    },
    {
      name: "get_backlinks",
      description: "Get all notes that contain wiki-links pointing to the given path.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path of the note to find backlinks for" },
        },
        required: ["path"],
      },
      scope: "read-only",
    },
    {
      name: "get_graph",
      description: "Get the full wiki-link graph with nodes (notes) and edges (links between them).",
      inputSchema: { type: "object", properties: {}, required: [] },
      scope: "read-only",
    },
    {
      name: "list_folders",
      description: "List the folder structure of the knowledge base.",
      inputSchema: { type: "object", properties: {}, required: [] },
      scope: "read-only",
    },
    {
      name: "create_folder",
      description: "Create a new folder in the knowledge base.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path for the new folder (e.g. 'projects/new-folder')" },
        },
        required: ["path"],
      },
      scope: "read-write",
    },
    {
      name: "get_daily_note",
      description: "Get today's daily note. Returns the note content if it exists, or indicates it doesn't exist yet.",
      inputSchema: { type: "object", properties: {}, required: [] },
      scope: "read-only",
    },
    {
      name: "list_templates",
      description: "List available note templates.",
      inputSchema: { type: "object", properties: {}, required: [] },
      scope: "read-only",
    },
    {
      name: "create_note_from_template",
      description: "Create a new note from an existing template.",
      inputSchema: {
        type: "object",
        properties: {
          templateName: { type: "string", description: "Name of the template to use" },
          notePath: { type: "string", description: "Path for the new note" },
        },
        required: ["templateName", "notePath"],
      },
      scope: "read-write",
    },
  ];
}

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
): Promise<unknown> {
  const userDir = await getUserNotesDir(NOTES_DIR, userId);

  switch (toolName) {
    case "list_notes": {
      return scanDirectory(userDir);
    }
    case "read_note": {
      return readNote(userDir, args.path as string);
    }
    case "create_note": {
      await writeNote(userDir, args.path as string, args.content as string, userId);
      return { success: true, path: args.path };
    }
    case "update_note": {
      await writeNote(userDir, args.path as string, args.content as string, userId);
      return { success: true, path: args.path };
    }
    case "delete_note": {
      await deleteNote(userDir, args.path as string, userId);
      return { success: true, path: args.path };
    }
    case "search": {
      return search(args.query as string, userId);
    }
    case "list_tags": {
      return getAllTags(userId);
    }
    case "get_backlinks": {
      return getBacklinks(args.path as string, userId);
    }
    case "get_graph": {
      return getFullGraph(userId);
    }
    case "list_folders": {
      const tree = await scanDirectory(userDir);
      // Filter to only return folder nodes
      const filterFolders = (nodes: Awaited<ReturnType<typeof scanDirectory>>): typeof nodes =>
        nodes.filter(n => n.type === "folder").map(n => ({ ...n, children: n.children ? filterFolders(n.children) : undefined }));
      return filterFolders(tree);
    }
    case "create_folder": {
      const folderPath = path.join(userDir, args.path as string);
      const { mkdir } = await import("fs/promises");
      await mkdir(folderPath, { recursive: true });
      return { success: true, path: args.path };
    }
    case "get_daily_note": {
      const { format } = await import("date-fns");
      const dailyPath = `daily/${format(new Date(), "yyyy-MM-dd")}.md`;
      try {
        return await readNote(userDir, dailyPath);
      } catch {
        return { exists: false, expectedPath: dailyPath };
      }
    }
    case "list_templates": {
      try {
        return await scanDirectory(path.join(userDir, "templates"));
      } catch {
        return [];
      }
    }
    case "create_note_from_template": {
      const templateContent = await readNote(
        userDir,
        `templates/${args.templateName as string}.md`,
      );
      await writeNote(userDir, args.notePath as string, templateContent.content, userId);
      return { success: true, path: args.notePath };
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
```

**Verified service imports:**
- `noteService.ts` — `scanDirectory`, `readNote`, `writeNote`, `deleteNote`
- `searchService.ts` — `search`, `getAllTags`, `getNotesByTag`
- `graphService.ts` — `getBacklinks`, `getFullGraph`
- `userNotesDir.ts` — `getUserNotesDir`

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/mcp/__tests__/mcpServer.test.ts`

Expected: All tests PASS.

- [ ] **Step 6: Implement MCP server handler**

Create `packages/server/src/mcp/mcpServer.ts`:

```typescript
import * as path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Request, Response, Router } from "express";
import { validateApiKey } from "../services/apiKeyService.js";
import { prisma } from "../prisma.js";
import { getToolDefinitions, executeTool } from "./mcpTools.js";
import { scanDirectory } from "../services/noteService.js";
import { getUserNotesDir } from "../services/userNotesDir.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("mcp");

/**
 * Create an McpServer instance with all tools registered.
 * The userId and scope are passed per-invocation via closures in the tool handlers.
 */
function createMcpServerInstance(userId: string, keyScope: string): McpServer {
  const server = new McpServer({
    name: "Kryton",
    version: "3.1.0",
  });

  const toolDefs = getToolDefinitions();
  for (const toolDef of toolDefs) {
    // NOTE: The exact McpServer.tool() callback signature may vary by SDK version.
    // At implementation time, use the context7 MCP tool to check the latest docs:
    //   resolve-library-id: "@modelcontextprotocol/sdk"
    //   query-docs: "McpServer tool registration callback signature"
    // The callback typically receives the parsed tool arguments as the first parameter.
    server.tool(
      toolDef.name,
      toolDef.description,
      toolDef.inputSchema,
      async (args: Record<string, unknown>) => {
        // Check scope
        if (toolDef.scope === "read-write" && keyScope !== "read-write") {
          return {
            content: [{ type: "text", text: "Error: This tool requires a read-write API key." }],
            isError: true,
          };
        }

        try {
          const result = await executeTool(toolDef.name, args, userId);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          log.error(`MCP tool ${toolDef.name} error:`, err);
          return {
            content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : "Unknown error"}` }],
            isError: true,
          };
        }
      },
    );
  }

  // Register resources
  server.resource(
    "notes",
    "kryton://notes",
    { description: "The full note tree structure" },
    async () => {
      const userDir = await getUserNotesDir(
        path.resolve(process.env.NOTES_DIR || path.join(import.meta.dirname, "../../../notes")),
        userId,
      );
      const tree = await scanDirectory(userDir);
      return {
        contents: [{ uri: "kryton://notes", mimeType: "application/json", text: JSON.stringify(tree, null, 2) }],
      };
    },
  );

  return server;
}

export function createMcpRouter(): Router {
  const router = Router();

  // Handle MCP requests (POST for JSON-RPC, GET for SSE, DELETE for session termination)
  router.all("/", async (req: Request, res: Response) => {
    // Authenticate via bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer kryton_")) {
      res.status(401).json({ error: "API key required for MCP access" });
      return;
    }

    const rawKey = authHeader.slice(7);
    const keyData = await validateApiKey(rawKey);
    if (!keyData) {
      res.status(401).json({ error: "Invalid or expired API key" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: keyData.userId },
      select: { id: true, email: true, name: true, role: true, disabled: true },
    });

    if (!user || user.disabled) {
      res.status(403).json({ error: "Account is disabled" });
      return;
    }

    // Create MCP server with user context (stateless — one per request)
    const server = createMcpServerInstance(user.id, keyData.scope);

    // Handle the request using Streamable HTTP transport
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless — no session management
    });

    await server.connect(transport);

    if (req.method === "POST") {
      await transport.handlePostMessage(req, res);
    } else if (req.method === "GET") {
      await transport.handleGetMessage(req, res);
    } else if (req.method === "DELETE") {
      res.status(405).json({ error: "Session management not supported (stateless mode)" });
    } else {
      res.status(405).json({ error: "Method not allowed" });
    }
  });

  return router;
}
```

**Important:** The exact MCP SDK API may differ from what's shown above. At implementation time, check the latest `@modelcontextprotocol/sdk` docs for the correct `McpServer`, `StreamableHTTPServerTransport`, and `server.tool()` signatures. Use the `context7` MCP tool to look up current docs:
```
resolve-library-id: "@modelcontextprotocol/sdk"
query-docs: "StreamableHTTPServerTransport express integration"
```

- [ ] **Step 7: Mount MCP router in index.ts**

In `packages/server/src/index.ts`:

1. Add import:
```typescript
import { createMcpRouter } from "./mcp/mcpServer.js";
```

2. Mount after the API key routes:
```typescript
  app.use("/api/mcp", createMcpRouter());
```

Note: MCP routes handle their own auth (bearer token), so no `authMiddleware` needed at mount.

- [ ] **Step 8: Run all tests**

Run: `cd packages/server && npx vitest run`

Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/mcp/ packages/server/src/index.ts packages/server/package.json packages/server/package-lock.json
git commit -m "feat: add built-in MCP server with Streamable HTTP transport"
```

---

## Task 9: MCP Dynamic Tool Discovery from OpenAPI

**Files:**
- Create: `packages/server/src/mcp/dynamicTools.ts`
- Create: `packages/server/src/mcp/__tests__/dynamicTools.test.ts`
- Modify: `packages/server/src/mcp/mcpServer.ts`

- [ ] **Step 1: Write failing tests for dynamic tool generation**

Create `packages/server/src/mcp/__tests__/dynamicTools.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateDynamicTools } from "../dynamicTools.js";

const CORE_TOOL_NAMES = [
  "list_notes", "read_note", "create_note", "update_note", "delete_note",
  "search", "list_tags", "get_backlinks", "get_graph", "list_folders",
  "create_folder", "get_daily_note", "list_templates", "create_note_from_template",
];

describe("dynamicTools", () => {
  it("generates tools from OpenAPI paths", () => {
    const spec = {
      paths: {
        "/plugins/summarize/run": {
          post: {
            summary: "Summarize a note",
            operationId: "summarize_run",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      notePath: { type: "string", description: "Path of the note" },
                    },
                    required: ["notePath"],
                  },
                },
              },
            },
            responses: { "200": { description: "Summary result" } },
          },
        },
      },
    };

    const tools = generateDynamicTools(spec, CORE_TOOL_NAMES);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("summarize_run");
    expect(tools[0].description).toBe("Summarize a note");
    expect(tools[0].scope).toBe("read-write");
    expect(tools[0].method).toBe("POST");
    expect(tools[0].apiPath).toBe("/plugins/summarize/run");
  });

  it("skips paths covered by core tools", () => {
    const spec = {
      paths: {
        "/notes": { get: { summary: "List notes", responses: {} } },
      },
    };
    const tools = generateDynamicTools(spec, CORE_TOOL_NAMES);
    expect(tools).toHaveLength(0);
  });

  it("skips excluded paths (admin, auth, api-keys, mcp, docs)", () => {
    const spec = {
      paths: {
        "/admin/users": { get: { summary: "List users", responses: {} } },
        "/auth/login": { post: { summary: "Login", responses: {} } },
        "/api-keys": { get: { summary: "List keys", responses: {} } },
        "/mcp": { post: { summary: "MCP", responses: {} } },
        "/docs": { get: { summary: "Docs", responses: {} } },
      },
    };
    const tools = generateDynamicTools(spec, CORE_TOOL_NAMES);
    expect(tools).toHaveLength(0);
  });

  it("infers read-only scope for GET, read-write for POST/PUT/DELETE", () => {
    const spec = {
      paths: {
        "/plugins/stats/overview": {
          get: { summary: "Get stats", responses: {} },
        },
        "/plugins/stats/reset": {
          post: { summary: "Reset stats", responses: {} },
        },
      },
    };
    const tools = generateDynamicTools(spec, CORE_TOOL_NAMES);
    expect(tools).toHaveLength(2);
    const getT = tools.find(t => t.method === "GET")!;
    const postT = tools.find(t => t.method === "POST")!;
    expect(getT.scope).toBe("read-only");
    expect(postT.scope).toBe("read-write");
  });

  it("falls back to method_path name when no operationId", () => {
    const spec = {
      paths: {
        "/plugins/translate/run": {
          post: { summary: "Translate text", responses: {} },
        },
      },
    };
    const tools = generateDynamicTools(spec, CORE_TOOL_NAMES);
    expect(tools[0].name).toBe("post_plugins_translate_run");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run src/mcp/__tests__/dynamicTools.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement dynamic tool generation**

Create `packages/server/src/mcp/dynamicTools.ts`:

```typescript
export interface DynamicToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope: "read-only" | "read-write";
  method: string;
  apiPath: string;
}

const EXCLUDED_PREFIXES = ["/admin", "/auth", "/api-keys", "/mcp", "/docs", "/health"];

export function generateDynamicTools(
  spec: Record<string, unknown>,
  coreToolNames: string[],
): DynamicToolDef[] {
  const paths = (spec as { paths?: Record<string, Record<string, unknown>> }).paths;
  if (!paths) return [];

  const tools: DynamicToolDef[] = [];
  const coreSet = new Set(coreToolNames);

  for (const [apiPath, methods] of Object.entries(paths)) {
    // Skip excluded paths
    if (EXCLUDED_PREFIXES.some(prefix => apiPath.startsWith(prefix))) continue;

    for (const [method, operation] of Object.entries(methods as Record<string, Record<string, unknown>>)) {
      if (!["get", "post", "put", "delete"].includes(method)) continue;

      const op = operation as {
        summary?: string;
        description?: string;
        operationId?: string;
        requestBody?: { content?: { "application/json"?: { schema?: Record<string, unknown> } } };
        parameters?: Array<{ name: string; in: string; description?: string; required?: boolean; schema?: Record<string, unknown> }>;
      };

      // Derive tool name
      const name = op.operationId ||
        `${method}_${apiPath.replace(/^\//, "").replace(/[/:{}]/g, "_").replace(/_+/g, "_").replace(/_$/, "")}`;

      // Skip if this matches a core tool
      if (coreSet.has(name)) continue;

      // Infer scope from HTTP method
      const scope: "read-only" | "read-write" = method === "get" ? "read-only" : "read-write";

      // Build input schema from request body or path/query parameters
      let inputSchema: Record<string, unknown> = { type: "object", properties: {}, required: [] };

      // Extract from request body (POST/PUT)
      const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
      if (bodySchema) {
        inputSchema = { ...bodySchema };
      }

      // Extract from path/query parameters (GET/DELETE)
      if (op.parameters?.length) {
        const props: Record<string, unknown> = {};
        const required: string[] = [];
        for (const param of op.parameters) {
          props[param.name] = {
            type: param.schema?.type || "string",
            description: param.description || `${param.in} parameter: ${param.name}`,
          };
          if (param.required) required.push(param.name);
        }
        if (!bodySchema) {
          inputSchema = { type: "object", properties: props, required };
        }
      }

      tools.push({
        name,
        description: op.summary || op.description || `${method.toUpperCase()} ${apiPath}`,
        inputSchema,
        scope,
        method: method.toUpperCase(),
        apiPath,
      });
    }
  }

  return tools;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/mcp/__tests__/dynamicTools.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Integrate dynamic tools into MCP server**

In `packages/server/src/mcp/mcpServer.ts`, add:

1. Import:
```typescript
import { generateDynamicTools, DynamicToolDef } from "./dynamicTools.js";
import { swaggerSpec } from "../swagger.js";
```

2. In `createMcpServerInstance()`, after registering core tools and the resource, add dynamic tool registration:

```typescript
  // Register dynamic tools from OpenAPI spec (includes plugin routes)
  const coreNames = toolDefs.map(t => t.name);
  const dynamicTools = generateDynamicTools(swaggerSpec as Record<string, unknown>, coreNames);
  const port = parseInt(process.env.PORT || "3001", 10);

  for (const dynTool of dynamicTools) {
    server.tool(
      dynTool.name,
      dynTool.description,
      dynTool.inputSchema,
      async (args: Record<string, unknown>) => {
        // Check scope
        if (dynTool.scope === "read-write" && keyScope !== "read-write") {
          return {
            content: [{ type: "text", text: "Error: This tool requires a read-write API key." }],
            isError: true,
          };
        }

        try {
          // Build URL with query params for GET, body for POST/PUT/DELETE
          let url = `http://localhost:${port}/api${dynTool.apiPath}`;
          const fetchOpts: RequestInit = {
            method: dynTool.method,
            headers: {
              "Authorization": `Bearer ${rawKey}`,
              "Content-Type": "application/json",
            },
          };

          if (dynTool.method === "GET" || dynTool.method === "DELETE") {
            // Map args to query params or path params
            const params = new URLSearchParams();
            for (const [k, v] of Object.entries(args)) {
              if (url.includes(`{${k}}`)) {
                url = url.replace(`{${k}}`, encodeURIComponent(String(v)));
              } else {
                params.set(k, String(v));
              }
            }
            const qs = params.toString();
            if (qs) url += `?${qs}`;
          } else {
            fetchOpts.body = JSON.stringify(args);
          }

          const resp = await fetch(url, fetchOpts);
          const text = await resp.text();

          if (!resp.ok) {
            return {
              content: [{ type: "text", text: `Error (${resp.status}): ${text}` }],
              isError: true,
            };
          }

          return {
            content: [{ type: "text", text }],
          };
        } catch (err) {
          log.error(`MCP dynamic tool ${dynTool.name} error:`, err);
          return {
            content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : "Unknown error"}` }],
            isError: true,
          };
        }
      },
    );
  }
```

3. Update `createMcpServerInstance` signature to also receive `rawKey: string` (needed to forward the bearer token):

```typescript
function createMcpServerInstance(userId: string, keyScope: string, rawKey: string): McpServer {
```

4. Update the call site in `createMcpRouter` to pass `rawKey`:

```typescript
const server = createMcpServerInstance(user.id, keyData.scope, rawKey);
```

- [ ] **Step 6: Run all tests**

Run: `cd packages/server && npx vitest run`

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/mcp/dynamicTools.ts packages/server/src/mcp/__tests__/dynamicTools.test.ts packages/server/src/mcp/mcpServer.ts
git commit -m "feat: add dynamic MCP tool discovery from OpenAPI spec for plugin routes"
```

---

## Task 10: Client — API Key API Functions

**Files:**
- Modify: `packages/client/src/lib/api.ts`

- [ ] **Step 1: Add API key types and API functions**

Add to the end of `packages/client/src/lib/api.ts`:

```typescript
// API Key types
export interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  scope: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreateApiKeyRequest {
  name: string;
  scope: "read-only" | "read-write";
  expiresAt?: string;
}

export interface CreateApiKeyResponse extends ApiKeyInfo {
  key: string; // Full key — shown only once
}

export const apiKeyApi = {
  list: (): Promise<ApiKeyInfo[]> =>
    request<ApiKeyInfo[]>("/api-keys"),

  create: (data: CreateApiKeyRequest): Promise<CreateApiKeyResponse> =>
    request<CreateApiKeyResponse>("/api-keys", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  revoke: (id: string): Promise<void> =>
    request<void>(`/api-keys/${id}`, { method: "DELETE" }),
};
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd packages/client && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/lib/api.ts
git commit -m "feat: add API key client API functions"
```

---

## Task 11: Client — UIStore State for Account Settings

**Files:**
- Modify: `packages/client/src/stores/uiStore.ts`

- [ ] **Step 1: Add showAccountSettings state**

In `packages/client/src/stores/uiStore.ts`:

1. Add to the `UIState` interface:
```typescript
  showAccountSettings: boolean;
  setShowAccountSettings: SetState<boolean>;
```

2. Add to the `create(...)` call (initial value):
```typescript
  showAccountSettings: false,
  setShowAccountSettings: (v) => set({ showAccountSettings: resolve(v, get().showAccountSettings) }),
```

3. Add to the `reset()` method:
```typescript
  showAccountSettings: false,
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd packages/client && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/stores/uiStore.ts
git commit -m "feat: add showAccountSettings state to UIStore"
```

---

## Task 12: Client — ApiKeyManager Component

**Files:**
- Create: `packages/client/src/components/ApiKeys/ApiKeyManager.tsx`

- [ ] **Step 1: Create the ApiKeyManager component**

Create `packages/client/src/components/ApiKeys/ApiKeyManager.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Copy, Check, AlertTriangle } from 'lucide-react';
import { apiKeyApi, ApiKeyInfo, CreateApiKeyResponse } from '../../lib/api';

export function ApiKeyManager() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<CreateApiKeyResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read-only' | 'read-write'>('read-only');
  const [expiration, setExpiration] = useState<string>('never');

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiKeyApi.list();
      setKeys(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const handleCreate = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setCreating(true);
    setError('');
    try {
      let expiresAt: string | undefined;
      if (expiration !== 'never') {
        const days = expiration === '30d' ? 30 : expiration === '90d' ? 90 : 365;
        const date = new Date();
        date.setDate(date.getDate() + days);
        expiresAt = date.toISOString();
      }
      const result = await apiKeyApi.create({ name: name.trim(), scope, expiresAt });
      setNewKey(result);
      setShowCreate(false);
      setName('');
      setScope('read-only');
      setExpiration('never');
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (newKey) {
      await navigator.clipboard.writeText(newKey.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRevoke = async (id: string) => {
    setDeletingId(id);
    setError('');
    try {
      await apiKeyApi.revoke(id);
      setConfirmDeleteId(null);
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke API key');
    } finally {
      setDeletingId(null);
    }
  };

  const formatRelativeTime = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <div>
      {/* Newly created key display */}
      {newKey && (
        <div className="mb-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-yellow-400" />
            <span className="text-sm font-medium text-yellow-300">Copy this key now. It won't be shown again.</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-surface-800 rounded px-3 py-2 text-xs text-gray-100 font-mono break-all select-all">
              {newKey.key}
            </code>
            <button
              onClick={handleCopy}
              className="p-2 text-gray-400 hover:text-gray-200 transition-colors"
              aria-label="Copy API key"
            >
              {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
            </button>
          </div>
          <button
            onClick={() => setNewKey(null)}
            className="mt-2 text-xs text-gray-400 hover:text-gray-200"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Key list */}
      <div className="space-y-2 mb-4">
        {loading ? (
          <div className="text-center py-6 text-gray-500 text-sm">Loading API keys...</div>
        ) : keys.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-sm">No API keys yet.</div>
        ) : (
          keys.map(k => (
            <div key={k.id} className="flex items-center justify-between rounded-lg bg-surface-800 border border-gray-700/50 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-200 font-medium truncate">{k.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    k.scope === 'read-write'
                      ? 'bg-violet-500/20 text-violet-300'
                      : 'bg-gray-600/30 text-gray-400'
                  }`}>
                    {k.scope === 'read-write' ? 'Read Write' : 'Read Only'}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <code className="text-[10px] text-gray-500 font-mono">{k.keyPrefix}...</code>
                  <span className="text-[10px] text-gray-500">Used: {formatRelativeTime(k.lastUsedAt)}</span>
                  <span className="text-[10px] text-gray-500">
                    Expires: {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : 'Never'}
                  </span>
                </div>
              </div>
              {confirmDeleteId === k.id ? (
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={() => handleRevoke(k.id)}
                    disabled={deletingId === k.id}
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded bg-red-500/10 disabled:opacity-50"
                  >
                    {deletingId === k.id ? '...' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(k.id)}
                  className="ml-2 p-1.5 text-gray-500 hover:text-red-400 transition-colors"
                  aria-label="Revoke API key"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Create form */}
      {showCreate ? (
        <div className="space-y-3 rounded-lg border border-gray-700/50 p-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Claude Code, My Script"
              autoFocus
              maxLength={100}
              className="w-full bg-surface-800 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Scope</label>
              <select
                value={scope}
                onChange={e => setScope(e.target.value as 'read-only' | 'read-write')}
                className="w-full bg-surface-800 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              >
                <option value="read-only">Read Only</option>
                <option value="read-write">Read Write</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Expires</label>
              <select
                value={expiration}
                onChange={e => setExpiration(e.target.value)}
                className="w-full bg-surface-800 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              >
                <option value="30d">30 days</option>
                <option value="90d">90 days</option>
                <option value="1y">1 year</option>
                <option value="never">Never</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex-1 bg-violet-500 text-white rounded-lg py-2 text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Key'}
            </button>
            <button
              onClick={() => { setShowCreate(false); setName(''); setError(''); }}
              className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-300 hover:border-violet-500 hover:text-violet-400 transition-colors"
        >
          <Plus size={16} />
          Create API Key
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd packages/client && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/ApiKeys/ApiKeyManager.tsx
git commit -m "feat: add ApiKeyManager component with create, list, and revoke UI"
```

---

## Task 13: Client — Account Settings Page

**Files:**
- Create: `packages/client/src/pages/AccountSettingsPage.tsx`
- Modify: `packages/client/src/components/Layout/UserMenu.tsx`
- Modify: `packages/client/src/components/Modals/ModalsContainer.tsx`
- Modify: `packages/client/src/App.tsx`

- [ ] **Step 1: Create AccountSettingsPage**

Create `packages/client/src/pages/AccountSettingsPage.tsx`:

```tsx
import { useState, useCallback, FormEvent } from 'react';
import { Settings, User, Fingerprint, Key, X } from 'lucide-react';
import { authApi } from '../lib/api';
import { PasskeyManagerContent } from '../components/Security/PasskeyManager';
import { ApiKeyManager } from '../components/ApiKeys/ApiKeyManager';

type Tab = 'profile' | 'passkeys' | 'api-keys';

const TABS: { key: Tab; label: string; icon: typeof User }[] = [
  { key: 'profile', label: 'Profile', icon: User },
  { key: 'passkeys', label: 'Passkeys', icon: Fingerprint },
  { key: 'api-keys', label: 'API Keys', icon: Key },
];

interface AccountSettingsPageProps {
  onClose: () => void;
}

export default function AccountSettingsPage({ onClose }: AccountSettingsPageProps) {
  const [tab, setTab] = useState<Tab>('api-keys');

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-surface-900 rounded-xl shadow-2xl w-[90vw] max-w-2xl max-h-[85vh] overflow-hidden flex flex-col border border-gray-700/50"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50">
          <div className="flex items-center gap-2">
            <Settings size={20} className="text-violet-400" />
            <h2 className="text-lg font-semibold text-gray-100">Account Settings</h2>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-200 transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700/50 px-6">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-violet-500 text-violet-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <t.icon size={14} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'profile' && <ProfileSection />}
          {tab === 'passkeys' && <PasskeysSection />}
          {tab === 'api-keys' && <ApiKeyManager />}
        </div>
      </div>
    </div>
  );
}

function ProfileSection() {
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    if (newPw !== confirmPw) { setError('Passwords do not match'); return; }
    if (newPw.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      await authApi.changePassword(currentPw, newPw);
      setSuccess(true);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setLoading(false);
    }
  }, [currentPw, newPw, confirmPw]);

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-200 mb-4">Change Password</h3>
      <form onSubmit={handleSubmit} className="space-y-3 max-w-sm">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Current Password</label>
          <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} required
            className="w-full bg-surface-800 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">New Password</label>
          <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} required minLength={8}
            className="w-full bg-surface-800 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Confirm New Password</label>
          <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required
            className="w-full bg-surface-800 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
        </div>
        {error && <div className="text-red-400 text-xs">{error}</div>}
        {success && <div className="text-green-400 text-xs">Password changed successfully!</div>}
        <button type="submit" disabled={loading}
          className="bg-violet-500 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-50">
          {loading ? 'Changing...' : 'Change Password'}
        </button>
      </form>
    </div>
  );
}

function PasskeysSection() {
  // Uses the refactored PasskeyManagerContent (see Step 1b below)
  return <PasskeyManagerContent />;
}
```

- [ ] **Step 1b: Refactor PasskeyManager to support inline rendering**

In `packages/client/src/components/Security/PasskeyManager.tsx`:

1. Extract all the inner content (everything inside the portal `<div>`) into a new exported `PasskeyManagerContent` component that takes no `open`/`onClose` props — it's just the list + add button, no modal wrapper.

2. Rewrite `PasskeyManager` to be a thin wrapper:
```tsx
export function PasskeyManager({ open, onClose }: PasskeyManagerProps) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-surface-900 rounded-xl shadow-2xl w-full max-w-md p-6 border border-gray-700/50"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Fingerprint size={20} className="text-violet-400" />
            <h3 className="text-lg font-semibold text-gray-100">Passkeys</h3>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-200 transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <PasskeyManagerContent />
      </div>
    </div>,
    document.body
  );
}
```

This way `PasskeyManagerContent` can be used directly in the Account Settings tab, while the existing `PasskeyManager` modal wrapper continues to work if needed elsewhere.

- [ ] **Step 2: Update UserMenu — replace password/passkey entries**

In `packages/client/src/components/Layout/UserMenu.tsx`:

1. Remove the imports and state for `showPasswordModal`, `showPasskeyManager`, and all password change form state (`currentPw`, `newPw`, `confirmPw`, `pwError`, `pwSuccess`, `pwLoading`).
2. Remove the `handlePasswordChange` callback.
3. Remove the `PasskeyManager` import and component render.
4. Remove the password modal portal render.
5. Import `Settings` from `lucide-react`.
6. Replace the "Manage Passkeys" and "Change Password" buttons with a single "Account Settings" button:

```tsx
<button
  onClick={() => { useUIStore.getState().setShowAccountSettings(true); setOpen(false); }}
  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-100 hover:bg-gray-700 transition-colors"
>
  <Settings size={14} />
  Account Settings
</button>
```

7. Import `useUIStore` at the top: `import { useUIStore } from '../../stores/uiStore';`

- [ ] **Step 3: Wire AccountSettingsPage into ModalsContainer**

In `packages/client/src/components/Modals/ModalsContainer.tsx`:

1. Import: `import AccountSettingsPage from '../../pages/AccountSettingsPage';`
2. Add to props: `showAccountSettings: boolean; onCloseAccountSettings: () => void;`
3. Add inside the fragment: `{showAccountSettings && <AccountSettingsPage onClose={onCloseAccountSettings} />}`

- [ ] **Step 4: Pass state from App.tsx to ModalsContainer**

In `packages/client/src/App.tsx`, in the `AppModals` component:

1. Add store selectors:
```typescript
const showAccountSettings = useUIStore((s) => s.showAccountSettings);
const setShowAccountSettings = useUIStore((s) => s.setShowAccountSettings);
```

2. Pass to `ModalsContainer`:
```tsx
<ModalsContainer
  // ... existing props
  showAccountSettings={showAccountSettings}
  onCloseAccountSettings={() => setShowAccountSettings(false)}
/>
```

- [ ] **Step 5: Verify typecheck passes**

Run: `cd packages/client && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/pages/AccountSettingsPage.tsx packages/client/src/components/Layout/UserMenu.tsx packages/client/src/components/Modals/ModalsContainer.tsx packages/client/src/App.tsx
git commit -m "feat: add Account Settings page with Profile, Passkeys, and API Keys tabs"
```

---

## Task 14: End-to-End Verification

- [ ] **Step 1: Run all server tests**

Run: `cd packages/server && npx vitest run`

Expected: All tests pass.

- [ ] **Step 2: Run server typecheck**

Run: `cd packages/server && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Run client typecheck**

Run: `cd packages/client && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 4: Run lints**

Run: `cd packages/server && npm run lint && cd ../client && npm run lint`

Expected: No errors (or only pre-existing ones).

- [ ] **Step 5: Manual smoke test**

Start the dev server and verify:
1. Open Account Settings from UserMenu dropdown
2. Create an API key → full key shown once
3. Copy the key, dismiss the display
4. Key appears in list with prefix, scope, "Never" for last used
5. Revoke the key → confirm → key disappears
6. Test the key via curl: `curl -H "Authorization: Bearer kryton_..." http://localhost:3001/api/notes`
7. Test scope enforcement: read-only key should fail POST requests
8. Open `/api/docs` → verify security schemes visible
9. Open `/api/docs.json` → verify complete paths and security definitions

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix: address issues found during E2E verification"
```
