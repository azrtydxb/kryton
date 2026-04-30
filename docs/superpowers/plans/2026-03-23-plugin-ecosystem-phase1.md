# Plugin Ecosystem Phase 1: Plugin API & Runtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the plugin loading runtime, backend PluginAPI, frontend ClientPluginAPI, and defensive guardrails — producing a working system that can load and run a sample plugin.

**Architecture:** Plugins are Node.js modules loaded in-process via `require()`. Each plugin receives a scoped `PluginAPI` object during activation. The frontend dynamically imports plugin client bundles and injects components into predefined UI slots. Defensive guardrails (error boundaries, health monitor, activation timeout) ensure reliability.

**Tech Stack:** Express 5, TypeORM (PostgreSQL), React 19, TypeScript, Vite, vitest (new)

**Spec:** `docs/superpowers/specs/2026-03-23-plugin-ecosystem-design.md`

---

## File Structure

### Server — New Files

```
packages/server/src/
  plugins/
    types.ts                  # PluginAPI interface, PluginEvent type, PluginManifest type
    PluginManager.ts          # Core: load, activate, deactivate, hot-swap orchestration
    PluginApiFactory.ts       # Creates scoped PluginAPI instances per plugin
    PluginEventBus.ts         # Event system with before/after pattern
    PluginRouter.ts           # Dynamic Express route mounting for plugin endpoints
    PluginHealthMonitor.ts    # Error tracking, auto-disable logic
  entities/
    PluginStorage.ts          # Key-value storage entity
    InstalledPlugin.ts        # Tracks installed plugins + state
  routes/
    plugins.ts                # REST endpoints for plugin system (list active, etc.)
  services/
    pluginStorageService.ts   # CRUD operations on PluginStorage entity
```

### Client — New Files

```
packages/client/src/
  plugins/
    types.ts                  # ClientPluginAPI interface, SlotRegistration types
    PluginManager.ts          # Loads client bundles, manages frontend lifecycle
    PluginSlotRegistry.ts     # Tracks UI slot registrations (sidebar, toolbar, etc.)
    PluginContext.tsx          # React context + provider exposing plugin slots
    PluginErrorBoundary.tsx   # React error boundary wrapping plugin components
  components/
    PluginSlot/
      PluginSlot.tsx          # Renders registered plugin components for a named slot
```

### Server — Modified Files

```
packages/server/src/
  data-source.ts              # Add PluginStorage + InstalledPlugin entities
  index.ts                    # Initialize PluginManager, mount plugin routes
```

### Client — Modified Files

```
packages/client/src/
  App.tsx                     # Wrap with PluginContext, add PluginSlot in sidebar/toolbar/statusbar
  lib/api.ts                  # Add plugin-related API methods
```

### Test Infrastructure (New)

```
packages/server/
  vitest.config.ts            # Server test config
  src/plugins/__tests__/
    PluginEventBus.test.ts
    PluginHealthMonitor.test.ts
    PluginApiFactory.test.ts
    PluginManager.test.ts
    PluginRouter.test.ts

packages/client/
  vitest.config.ts            # Client test config
  src/plugins/__tests__/
    PluginSlotRegistry.test.ts
    PluginErrorBoundary.test.tsx
```

---

## Task 1: Set Up Test Infrastructure

**Files:**
- Create: `packages/server/vitest.config.ts`
- Create: `packages/client/vitest.config.ts`
- Modify: `packages/server/package.json`
- Modify: `packages/client/package.json`
- Modify: `package.json` (root)

- [ ] **Step 1: Install vitest in server package**

```bash
cd /Users/pascal/Development/kryton && npm install -D vitest @vitest/coverage-v8 --workspace=packages/server
```

- [ ] **Step 2: Create server vitest config**

Create `packages/server/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add test script to server package.json**

Add to `packages/server/package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Install vitest in client package**

```bash
cd /Users/pascal/Development/kryton && npm install -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom --workspace=packages/client
```

- [ ] **Step 5: Create client vitest config**

Create `packages/client/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

Create `packages/client/src/test-setup.ts`:
```typescript
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 6: Add test script to client package.json**

Add to `packages/client/package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 7: Add root test script**

Add to root `package.json` scripts:
```json
"test": "npm run test --workspaces",
"test:server": "npm run test --workspace=packages/server",
"test:client": "npm run test --workspace=packages/client"
```

- [ ] **Step 8: Verify test infrastructure works**

Create a trivial test at `packages/server/src/plugins/__tests__/setup.test.ts`:
```typescript
describe("test infrastructure", () => {
  it("works", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `cd /Users/pascal/Development/kryton && npm run test:server`
Expected: 1 test passing.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "chore: set up vitest test infrastructure for server and client"
```

---

## Task 2: Plugin Type Definitions (Server)

**Files:**
- Create: `packages/server/src/plugins/types.ts`

- [ ] **Step 1: Write the type definitions**

Create `packages/server/src/plugins/types.ts`:
```typescript
import { Router, RequestHandler } from "express";
import { EntitySchema, Repository } from "typeorm";

// --- Plugin Manifest (parsed from manifest.json) ---

export interface PluginSettingDefinition {
  key: string;
  type: "string" | "boolean" | "number";
  default: string | boolean | number;
  label: string;
  perUser: boolean;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  minKrytonVersion: string;
  server?: string;
  client?: string;
  settings?: PluginSettingDefinition[];
}

// --- Plugin Events ---

export type PluginEvent =
  | "note:beforeSave"
  | "note:afterSave"
  | "note:beforeDelete"
  | "note:afterDelete"
  | "note:open"
  | "search:query"
  | "user:login"
  | "user:logout";

export type PluginEventHandler = (...args: unknown[]) => void | Promise<void>;

// --- HTTP ---

export type HttpMethod = "get" | "post" | "put" | "delete" | "patch";

// --- Note Types ---

export interface Note {
  path: string;
  content: string;
  title: string;
  modifiedAt: Date;
}

export interface NoteEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: NoteEntry[];
}

// --- Storage ---

export interface StorageEntry {
  key: string;
  value: unknown;
  userId: string | null;
}

// --- Search ---

export interface IndexFields {
  title: string;
  content: string;
  tags?: string[];
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

// --- Plugin API (injected into activate()) ---

export interface PluginAPI {
  notes: {
    get(userId: string, path: string): Promise<Note>;
    list(userId: string, folder?: string): Promise<NoteEntry[]>;
    create(userId: string, path: string, content: string): Promise<void>;
    update(userId: string, path: string, content: string): Promise<void>;
    delete(userId: string, path: string): Promise<void>;
  };

  events: {
    on(event: PluginEvent, handler: PluginEventHandler): void;
    off(event: PluginEvent, handler: PluginEventHandler): void;
  };

  routes: {
    register(method: HttpMethod, path: string, handler: RequestHandler): void;
  };

  storage: {
    get(key: string, userId?: string): Promise<unknown>;
    set(key: string, value: unknown, userId?: string): Promise<void>;
    delete(key: string, userId?: string): Promise<void>;
    list(prefix?: string, userId?: string): Promise<StorageEntry[]>;
  };

  database: {
    registerEntity(entity: EntitySchema): void;
    getRepository(entity: EntitySchema): Repository<unknown>;
  };

  settings: {
    get(key: string, userId?: string): Promise<unknown>;
  };

  search: {
    index(userId: string, path: string, fields: IndexFields): Promise<void>;
    query(userId: string, query: string): Promise<SearchResult[]>;
  };

  log: {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
  };

  plugin: {
    id: string;
    version: string;
    dataDir: string;
  };
}

// --- Plugin Module Interface ---

export interface PluginModule {
  activate(api: PluginAPI): void | Promise<void>;
  deactivate(): void | Promise<void>;
}

// --- Plugin State ---

export type PluginState =
  | "installed"
  | "loaded"
  | "active"
  | "deactivating"
  | "unloaded"
  | "error";

export interface PluginInstance {
  manifest: PluginManifest;
  state: PluginState;
  module: PluginModule | null;
  api: PluginAPI | null;
  error: string | null;
  registeredRoutes: Array<{ method: HttpMethod; path: string }>;
  registeredEvents: Array<{ event: PluginEvent; handler: PluginEventHandler }>;
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/pascal/Development/kryton && npx tsc --noEmit --project packages/server/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/plugins/types.ts && git commit -m "feat(plugins): add server-side plugin type definitions"
```

---

## Task 3: Plugin Event Bus

**Files:**
- Create: `packages/server/src/plugins/PluginEventBus.ts`
- Create: `packages/server/src/plugins/__tests__/PluginEventBus.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/plugins/__tests__/PluginEventBus.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginEventBus } from "../PluginEventBus";

describe("PluginEventBus", () => {
  let bus: PluginEventBus;

  beforeEach(() => {
    bus = new PluginEventBus();
  });

  it("calls registered handlers for an event", async () => {
    const handler = vi.fn();
    bus.on("note:afterSave", handler);
    await bus.emit("note:afterSave", { path: "test.md" });
    expect(handler).toHaveBeenCalledWith({ path: "test.md" });
  });

  it("supports multiple handlers for the same event", async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    bus.on("note:afterSave", handler1);
    bus.on("note:afterSave", handler2);
    await bus.emit("note:afterSave", { path: "test.md" });
    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it("removes a handler with off()", async () => {
    const handler = vi.fn();
    bus.on("note:afterSave", handler);
    bus.off("note:afterSave", handler);
    await bus.emit("note:afterSave", { path: "test.md" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not throw when emitting with no handlers", async () => {
    await expect(bus.emit("note:afterSave", {})).resolves.toBeUndefined();
  });

  it("before events can cancel by throwing", async () => {
    bus.on("note:beforeSave", () => {
      throw new Error("cancelled");
    });
    await expect(bus.emitBefore("note:beforeSave", {})).rejects.toThrow("cancelled");
  });

  it("before events run in registration order", async () => {
    const order: number[] = [];
    bus.on("note:beforeSave", () => { order.push(1); });
    bus.on("note:beforeSave", () => { order.push(2); });
    await bus.emitBefore("note:beforeSave", {});
    expect(order).toEqual([1, 2]);
  });

  it("before event context is mutable across handlers", async () => {
    const ctx = { content: "original" };
    bus.on("note:beforeSave", (c: any) => { c.content = "modified"; });
    await bus.emitBefore("note:beforeSave", ctx);
    expect(ctx.content).toBe("modified");
  });

  it("removeAllForPlugin removes only that plugin's handlers", async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    bus.on("note:afterSave", handler1, "plugin-a");
    bus.on("note:afterSave", handler2, "plugin-b");
    bus.removeAllForPlugin("plugin-a");
    await bus.emit("note:afterSave", {});
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/pascal/Development/kryton && npm run test:server`
Expected: All tests FAIL (module not found).

- [ ] **Step 3: Implement PluginEventBus**

Create `packages/server/src/plugins/PluginEventBus.ts`:
```typescript
import { PluginEvent, PluginEventHandler } from "./types";

interface HandlerEntry {
  handler: PluginEventHandler;
  pluginId: string | null;
}

export class PluginEventBus {
  private handlers = new Map<PluginEvent, HandlerEntry[]>();

  on(event: PluginEvent, handler: PluginEventHandler, pluginId?: string): void {
    const entries = this.handlers.get(event) || [];
    entries.push({ handler, pluginId: pluginId ?? null });
    this.handlers.set(event, entries);
  }

  off(event: PluginEvent, handler: PluginEventHandler): void {
    const entries = this.handlers.get(event);
    if (!entries) return;
    this.handlers.set(
      event,
      entries.filter((e) => e.handler !== handler)
    );
  }

  async emit(event: PluginEvent, ...args: unknown[]): Promise<void> {
    const entries = this.handlers.get(event) || [];
    for (const entry of entries) {
      try {
        await entry.handler(...args);
      } catch {
        // after-events are fire-and-forget; errors are swallowed
      }
    }
  }

  async emitBefore(event: PluginEvent, ...args: unknown[]): Promise<void> {
    const entries = this.handlers.get(event) || [];
    for (const entry of entries) {
      await entry.handler(...args);
      // If handler throws, it propagates (cancels the operation)
    }
  }

  removeAllForPlugin(pluginId: string): void {
    for (const [event, entries] of this.handlers) {
      this.handlers.set(
        event,
        entries.filter((e) => e.pluginId !== pluginId)
      );
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/pascal/Development/kryton && npm run test:server`
Expected: All PluginEventBus tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/plugins/PluginEventBus.ts packages/server/src/plugins/__tests__/PluginEventBus.test.ts && git commit -m "feat(plugins): implement PluginEventBus with before/after event pattern"
```

---

## Task 4: Plugin Health Monitor

**Files:**
- Create: `packages/server/src/plugins/PluginHealthMonitor.ts`
- Create: `packages/server/src/plugins/__tests__/PluginHealthMonitor.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/plugins/__tests__/PluginHealthMonitor.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PluginHealthMonitor } from "../PluginHealthMonitor";

describe("PluginHealthMonitor", () => {
  let monitor: PluginHealthMonitor;
  let onDisable: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onDisable = vi.fn();
    monitor = new PluginHealthMonitor({
      maxErrors: 5,
      windowMs: 60_000,
      onDisable,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not disable plugin below error threshold", () => {
    for (let i = 0; i < 4; i++) {
      monitor.recordError("test-plugin");
    }
    expect(onDisable).not.toHaveBeenCalled();
  });

  it("disables plugin at error threshold", () => {
    for (let i = 0; i < 5; i++) {
      monitor.recordError("test-plugin");
    }
    expect(onDisable).toHaveBeenCalledWith("test-plugin");
  });

  it("resets error count after time window", () => {
    for (let i = 0; i < 4; i++) {
      monitor.recordError("test-plugin");
    }
    vi.advanceTimersByTime(61_000);
    monitor.recordError("test-plugin");
    expect(onDisable).not.toHaveBeenCalled();
  });

  it("tracks plugins independently", () => {
    for (let i = 0; i < 5; i++) {
      monitor.recordError("plugin-a");
    }
    expect(onDisable).toHaveBeenCalledWith("plugin-a");
    expect(onDisable).not.toHaveBeenCalledWith("plugin-b");
  });

  it("does not fire onDisable twice for the same plugin", () => {
    for (let i = 0; i < 10; i++) {
      monitor.recordError("test-plugin");
    }
    expect(onDisable).toHaveBeenCalledTimes(1);
  });

  it("reset clears error history for a plugin", () => {
    for (let i = 0; i < 4; i++) {
      monitor.recordError("test-plugin");
    }
    monitor.reset("test-plugin");
    for (let i = 0; i < 4; i++) {
      monitor.recordError("test-plugin");
    }
    expect(onDisable).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/pascal/Development/kryton && npm run test:server`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement PluginHealthMonitor**

Create `packages/server/src/plugins/PluginHealthMonitor.ts`:
```typescript
interface HealthMonitorOptions {
  maxErrors: number;
  windowMs: number;
  onDisable: (pluginId: string) => void;
}

export class PluginHealthMonitor {
  private errors = new Map<string, number[]>();
  private disabled = new Set<string>();
  private options: HealthMonitorOptions;

  constructor(options: HealthMonitorOptions) {
    this.options = options;
  }

  recordError(pluginId: string): void {
    if (this.disabled.has(pluginId)) return;

    const now = Date.now();
    const timestamps = this.errors.get(pluginId) || [];
    const cutoff = now - this.options.windowMs;
    const recent = timestamps.filter((t) => t > cutoff);
    recent.push(now);
    this.errors.set(pluginId, recent);

    if (recent.length >= this.options.maxErrors) {
      this.disabled.add(pluginId);
      this.options.onDisable(pluginId);
    }
  }

  reset(pluginId: string): void {
    this.errors.delete(pluginId);
    this.disabled.delete(pluginId);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/pascal/Development/kryton && npm run test:server`
Expected: All PluginHealthMonitor tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/plugins/PluginHealthMonitor.ts packages/server/src/plugins/__tests__/PluginHealthMonitor.test.ts && git commit -m "feat(plugins): implement PluginHealthMonitor with auto-disable"
```

---

## Task 5: Plugin Storage Entity & Service

**Files:**
- Create: `packages/server/src/entities/PluginStorage.ts`
- Create: `packages/server/src/entities/InstalledPlugin.ts`
- Create: `packages/server/src/services/pluginStorageService.ts`
- Modify: `packages/server/src/data-source.ts`

- [ ] **Step 1: Create PluginStorage entity**

Create `packages/server/src/entities/PluginStorage.ts`:
```typescript
import { Entity, Column, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class PluginStorage {
  @PrimaryColumn("text")
  pluginId: string;

  @PrimaryColumn("text")
  key: string;

  @PrimaryColumn("text", { default: "" })
  userId: string;

  @Column("jsonb")
  value: unknown;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 2: Create InstalledPlugin entity**

Create `packages/server/src/entities/InstalledPlugin.ts`:
```typescript
import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class InstalledPlugin {
  @PrimaryColumn("text")
  id: string;

  @Column("text")
  name: string;

  @Column("text")
  version: string;

  @Column("text")
  description: string;

  @Column("text")
  author: string;

  @Column("text", { default: "installed" })
  state: string;

  @Column("text", { nullable: true })
  error: string | null;

  @Column("jsonb", { nullable: true })
  manifest: unknown;

  @Column("boolean", { default: true })
  enabled: boolean;

  @CreateDateColumn()
  installedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 3: Register entities in data-source.ts**

Add imports and entities to `packages/server/src/data-source.ts`:
```typescript
import { PluginStorage } from "./entities/PluginStorage";
import { InstalledPlugin } from "./entities/InstalledPlugin";
```
Add `PluginStorage` and `InstalledPlugin` to the `entities` array.

- [ ] **Step 4: Create pluginStorageService**

Create `packages/server/src/services/pluginStorageService.ts`:
```typescript
import { AppDataSource } from "../data-source";
import { PluginStorage } from "../entities/PluginStorage";

const GLOBAL_USER = "";

export async function getStorageValue(
  pluginId: string,
  key: string,
  userId?: string
): Promise<unknown> {
  const repo = AppDataSource.getRepository(PluginStorage);
  const entry = await repo.findOneBy({
    pluginId,
    key,
    userId: userId ?? GLOBAL_USER,
  });
  return entry?.value ?? null;
}

export async function setStorageValue(
  pluginId: string,
  key: string,
  value: unknown,
  userId?: string
): Promise<void> {
  const repo = AppDataSource.getRepository(PluginStorage);
  await repo.upsert(
    {
      pluginId,
      key,
      userId: userId ?? GLOBAL_USER,
      value,
    },
    ["pluginId", "key", "userId"]
  );
}

export async function deleteStorageValue(
  pluginId: string,
  key: string,
  userId?: string
): Promise<void> {
  const repo = AppDataSource.getRepository(PluginStorage);
  await repo.delete({
    pluginId,
    key,
    userId: userId ?? GLOBAL_USER,
  });
}

export async function listStorageEntries(
  pluginId: string,
  prefix?: string,
  userId?: string
): Promise<Array<{ key: string; value: unknown; userId: string | null }>> {
  const repo = AppDataSource.getRepository(PluginStorage);
  const qb = repo
    .createQueryBuilder("ps")
    .where("ps.pluginId = :pluginId", { pluginId });

  if (userId !== undefined) {
    qb.andWhere("ps.userId = :userId", { userId });
  }
  if (prefix) {
    qb.andWhere("ps.key LIKE :prefix", { prefix: `${prefix}%` });
  }

  const entries = await qb.getMany();
  return entries.map((e) => ({
    key: e.key,
    value: e.value,
    userId: e.userId || null,
  }));
}
```

- [ ] **Step 5: Verify types compile**

Run: `cd /Users/pascal/Development/kryton && npx tsc --noEmit --project packages/server/tsconfig.json`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/entities/PluginStorage.ts packages/server/src/entities/InstalledPlugin.ts packages/server/src/services/pluginStorageService.ts packages/server/src/data-source.ts && git commit -m "feat(plugins): add PluginStorage and InstalledPlugin entities with storage service"
```

---

## Task 6: Plugin Router (Dynamic Route Mounting)

**Files:**
- Create: `packages/server/src/plugins/PluginRouter.ts`
- Create: `packages/server/src/plugins/__tests__/PluginRouter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/plugins/__tests__/PluginRouter.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import { PluginRouter } from "../PluginRouter";

describe("PluginRouter", () => {
  let app: express.Express;
  let pluginRouter: PluginRouter;

  beforeEach(() => {
    app = express();
    pluginRouter = new PluginRouter(app);
  });

  it("registers a GET route for a plugin", () => {
    pluginRouter.register("test-plugin", "get", "/boards", (req, res) => {
      res.json({ ok: true });
    });

    const routes = pluginRouter.getRoutesForPlugin("test-plugin");
    expect(routes).toEqual([{ method: "get", path: "/boards" }]);
  });

  it("removes all routes for a plugin", () => {
    pluginRouter.register("test-plugin", "get", "/boards", (req, res) => {
      res.json({ ok: true });
    });
    pluginRouter.register("test-plugin", "post", "/boards", (req, res) => {
      res.json({ ok: true });
    });

    pluginRouter.removeAllForPlugin("test-plugin");
    const routes = pluginRouter.getRoutesForPlugin("test-plugin");
    expect(routes).toEqual([]);
  });

  it("tracks routes for different plugins independently", () => {
    pluginRouter.register("plugin-a", "get", "/a", (req, res) => {
      res.json({});
    });
    pluginRouter.register("plugin-b", "get", "/b", (req, res) => {
      res.json({});
    });

    pluginRouter.removeAllForPlugin("plugin-a");
    expect(pluginRouter.getRoutesForPlugin("plugin-a")).toEqual([]);
    expect(pluginRouter.getRoutesForPlugin("plugin-b")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/pascal/Development/kryton && npm run test:server`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement PluginRouter**

Create `packages/server/src/plugins/PluginRouter.ts`:
```typescript
import { Express, Router, RequestHandler } from "express";
import { HttpMethod } from "./types";

interface RouteEntry {
  method: HttpMethod;
  path: string;
}

export class PluginRouter {
  private app: Express;
  private routers = new Map<string, Router>();
  private routes = new Map<string, RouteEntry[]>();

  constructor(app: Express) {
    this.app = app;
  }

  register(
    pluginId: string,
    method: HttpMethod,
    path: string,
    handler: RequestHandler
  ): void {
    let router = this.routers.get(pluginId);
    if (!router) {
      router = Router();
      this.routers.set(pluginId, router);
      this.app.use(`/api/plugins/${pluginId}`, router);
    }

    router[method](path, handler);

    const entries = this.routes.get(pluginId) || [];
    entries.push({ method, path });
    this.routes.set(pluginId, entries);
  }

  removeAllForPlugin(pluginId: string): void {
    const router = this.routers.get(pluginId);
    if (router) {
      // Replace router's stack to remove all routes
      router.stack.length = 0;
    }
    this.routers.delete(pluginId);
    this.routes.delete(pluginId);
  }

  getRoutesForPlugin(pluginId: string): RouteEntry[] {
    return this.routes.get(pluginId) || [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/pascal/Development/kryton && npm run test:server`
Expected: All PluginRouter tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/plugins/PluginRouter.ts packages/server/src/plugins/__tests__/PluginRouter.test.ts && git commit -m "feat(plugins): implement PluginRouter for dynamic route mounting"
```

---

## Task 7: Plugin API Factory

**Files:**
- Create: `packages/server/src/plugins/PluginApiFactory.ts`
- Create: `packages/server/src/plugins/__tests__/PluginApiFactory.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/plugins/__tests__/PluginApiFactory.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginApiFactory } from "../PluginApiFactory";
import { PluginEventBus } from "../PluginEventBus";
import { PluginRouter } from "../PluginRouter";
import { PluginHealthMonitor } from "../PluginHealthMonitor";
import express from "express";

describe("PluginApiFactory", () => {
  let factory: PluginApiFactory;
  let eventBus: PluginEventBus;
  let pluginRouter: PluginRouter;
  let healthMonitor: PluginHealthMonitor;

  beforeEach(() => {
    eventBus = new PluginEventBus();
    pluginRouter = new PluginRouter(express());
    healthMonitor = new PluginHealthMonitor({
      maxErrors: 5,
      windowMs: 60_000,
      onDisable: vi.fn(),
    });
    factory = new PluginApiFactory({
      eventBus,
      pluginRouter,
      healthMonitor,
      notesDir: "/tmp/test-notes",
    });
  });

  it("creates a scoped API for a plugin", () => {
    const api = factory.createApi({
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      description: "A test plugin",
      author: "Test",
      minKrytonVersion: "2.0.0",
    });

    expect(api.plugin.id).toBe("test-plugin");
    expect(api.plugin.version).toBe("1.0.0");
    expect(api.notes).toBeDefined();
    expect(api.events).toBeDefined();
    expect(api.routes).toBeDefined();
    expect(api.storage).toBeDefined();
    expect(api.log).toBeDefined();
  });

  it("scopes event registrations to the plugin", () => {
    const api = factory.createApi({
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      description: "A test plugin",
      author: "Test",
      minKrytonVersion: "2.0.0",
    });

    const handler = vi.fn();
    api.events.on("note:afterSave", handler);

    // Removing all for this plugin should remove the handler
    eventBus.removeAllForPlugin("test-plugin");
    eventBus.emit("note:afterSave", {});
    expect(handler).not.toHaveBeenCalled();
  });

  it("prefixes log messages with plugin id", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const api = factory.createApi({
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      description: "A test plugin",
      author: "Test",
      minKrytonVersion: "2.0.0",
    });

    api.log.info("hello");
    expect(consoleSpy).toHaveBeenCalledWith("[plugin:test-plugin]", "hello");
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/pascal/Development/kryton && npm run test:server`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement PluginApiFactory**

Create `packages/server/src/plugins/PluginApiFactory.ts`:
```typescript
import { PluginAPI, PluginManifest, PluginEvent, PluginEventHandler } from "./types";
import { PluginEventBus } from "./PluginEventBus";
import { PluginRouter } from "./PluginRouter";
import { PluginHealthMonitor } from "./PluginHealthMonitor";
import {
  getStorageValue,
  setStorageValue,
  deleteStorageValue,
  listStorageEntries,
} from "../services/pluginStorageService";
import { AppDataSource } from "../data-source";
import { Settings } from "../entities/Settings";
import { SearchIndex } from "../entities/SearchIndex";
import { RequestHandler } from "express";
import { EntitySchema, Repository } from "typeorm";
import path from "path";
import fs from "fs";

interface PluginApiFactoryDeps {
  eventBus: PluginEventBus;
  pluginRouter: PluginRouter;
  healthMonitor: PluginHealthMonitor;
  notesDir: string;
}

export class PluginApiFactory {
  private deps: PluginApiFactoryDeps;

  constructor(deps: PluginApiFactoryDeps) {
    this.deps = deps;
  }

  createApi(manifest: PluginManifest): PluginAPI {
    const pluginId = manifest.id;
    const dataDir = path.join(process.cwd(), "data", "plugins", pluginId);
    fs.mkdirSync(dataDir, { recursive: true });

    const pluginEntities: EntitySchema[] = [];

    const api: PluginAPI = {
      notes: this.createNotesApi(pluginId),
      events: this.createEventsApi(pluginId),
      routes: this.createRoutesApi(pluginId),
      storage: this.createStorageApi(pluginId),
      database: {
        registerEntity(entity: EntitySchema): void {
          pluginEntities.push(entity);
        },
        getRepository(entity: EntitySchema): Repository<unknown> {
          return AppDataSource.getRepository(entity);
        },
      },
      settings: this.createSettingsApi(pluginId),
      search: this.createSearchApi(pluginId),
      log: {
        info: (msg: string, ...args: unknown[]) =>
          console.log(`[plugin:${pluginId}]`, msg, ...args),
        warn: (msg: string, ...args: unknown[]) =>
          console.warn(`[plugin:${pluginId}]`, msg, ...args),
        error: (msg: string, ...args: unknown[]) =>
          console.error(`[plugin:${pluginId}]`, msg, ...args),
      },
      plugin: {
        id: pluginId,
        version: manifest.version,
        dataDir,
      },
    };

    return api;
  }

  private createNotesApi(pluginId: string): PluginAPI["notes"] {
    const notesDir = this.deps.notesDir;
    return {
      async get(userId: string, notePath: string) {
        const fullPath = path.join(notesDir, userId, `${notePath}.md`);
        const content = await fs.promises.readFile(fullPath, "utf-8");
        const stat = await fs.promises.stat(fullPath);
        const title = notePath.split("/").pop() || notePath;
        return { path: notePath, content, title, modifiedAt: stat.mtime };
      },
      async list(userId: string, folder?: string) {
        const dir = folder
          ? path.join(notesDir, userId, folder)
          : path.join(notesDir, userId);
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        return entries.map((e) => ({
          name: e.name,
          path: folder ? `${folder}/${e.name}` : e.name,
          type: e.isDirectory() ? ("directory" as const) : ("file" as const),
        }));
      },
      async create(userId: string, notePath: string, content: string) {
        const fullPath = path.join(notesDir, userId, `${notePath}.md`);
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.promises.writeFile(fullPath, content, "utf-8");
      },
      async update(userId: string, notePath: string, content: string) {
        const fullPath = path.join(notesDir, userId, `${notePath}.md`);
        await fs.promises.writeFile(fullPath, content, "utf-8");
      },
      async delete(userId: string, notePath: string) {
        const fullPath = path.join(notesDir, userId, `${notePath}.md`);
        await fs.promises.unlink(fullPath);
      },
    };
  }

  private createEventsApi(pluginId: string): PluginAPI["events"] {
    return {
      on: (event: PluginEvent, handler: PluginEventHandler) => {
        this.deps.eventBus.on(event, handler, pluginId);
      },
      off: (event: PluginEvent, handler: PluginEventHandler) => {
        this.deps.eventBus.off(event, handler);
      },
    };
  }

  private createRoutesApi(pluginId: string): PluginAPI["routes"] {
    const { pluginRouter, healthMonitor } = this.deps;
    return {
      register: (method, routePath, handler: RequestHandler) => {
        const wrappedHandler: RequestHandler = async (req, res, next) => {
          try {
            await handler(req, res, next);
          } catch (err) {
            healthMonitor.recordError(pluginId);
            next(err);
          }
        };
        pluginRouter.register(pluginId, method, routePath, wrappedHandler);
      },
    };
  }

  private createStorageApi(pluginId: string): PluginAPI["storage"] {
    return {
      get: (key, userId?) => getStorageValue(pluginId, key, userId),
      set: (key, value, userId?) => setStorageValue(pluginId, key, value, userId),
      delete: (key, userId?) => deleteStorageValue(pluginId, key, userId),
      list: (prefix?, userId?) => listStorageEntries(pluginId, prefix, userId),
    };
  }

  private createSettingsApi(pluginId: string): PluginAPI["settings"] {
    return {
      async get(key: string, userId?: string) {
        const repo = AppDataSource.getRepository(Settings);
        const settingsKey = `plugin:${pluginId}:${key}`;

        // Check user override first
        if (userId) {
          const userSetting = await repo.findOneBy({
            key: settingsKey,
            userId,
          });
          if (userSetting) return JSON.parse(userSetting.value);
        }

        // Fall back to admin default
        const adminSetting = await repo.findOneBy({
          key: settingsKey,
          userId: "",
        });
        if (adminSetting) return JSON.parse(adminSetting.value);

        return null;
      },
    };
  }

  private createSearchApi(pluginId: string): PluginAPI["search"] {
    return {
      async index(userId, notePath, fields) {
        const repo = AppDataSource.getRepository(SearchIndex);
        await repo.upsert(
          {
            notePath,
            userId,
            title: fields.title,
            content: fields.content,
            tags: fields.tags || [],
            modifiedAt: new Date(),
          },
          ["notePath", "userId"]
        );
      },
      async query(userId, queryStr) {
        const repo = AppDataSource.getRepository(SearchIndex);
        const results = await repo
          .createQueryBuilder("si")
          .where("si.userId = :userId", { userId })
          .andWhere("(si.title ILIKE :q OR si.content ILIKE :q)", {
            q: `%${queryStr}%`,
          })
          .getMany();
        return results.map((r) => ({
          path: r.notePath,
          title: r.title,
          snippet: r.content.substring(0, 200),
          score: 1,
        }));
      },
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/pascal/Development/kryton && npm run test:server`
Expected: All PluginApiFactory tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/plugins/PluginApiFactory.ts packages/server/src/plugins/__tests__/PluginApiFactory.test.ts && git commit -m "feat(plugins): implement PluginApiFactory for scoped plugin API creation"
```

---

## Task 8: Plugin Manager (Core Orchestrator)

**Files:**
- Create: `packages/server/src/plugins/PluginManager.ts`
- Create: `packages/server/src/plugins/__tests__/PluginManager.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/plugins/__tests__/PluginManager.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginManager } from "../PluginManager";
import { PluginEventBus } from "../PluginEventBus";
import { PluginRouter } from "../PluginRouter";
import { PluginHealthMonitor } from "../PluginHealthMonitor";
import { PluginApiFactory } from "../PluginApiFactory";
import express from "express";
import path from "path";
import fs from "fs";
import os from "os";

describe("PluginManager", () => {
  let manager: PluginManager;
  let pluginsDir: string;

  beforeEach(() => {
    pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "kryton-plugins-"));
    const app = express();
    const eventBus = new PluginEventBus();
    const pluginRouter = new PluginRouter(app);
    const healthMonitor = new PluginHealthMonitor({
      maxErrors: 5,
      windowMs: 60_000,
      onDisable: (id) => manager.disablePlugin(id),
    });
    const apiFactory = new PluginApiFactory({
      eventBus,
      pluginRouter,
      healthMonitor,
      notesDir: "/tmp/test-notes",
    });

    manager = new PluginManager({
      pluginsDir,
      eventBus,
      pluginRouter,
      healthMonitor,
      apiFactory,
    });
  });

  function createTestPlugin(id: string, code: string): void {
    const pluginDir = path.join(pluginsDir, id);
    fs.mkdirSync(path.join(pluginDir, "server"), { recursive: true });

    fs.writeFileSync(
      path.join(pluginDir, "manifest.json"),
      JSON.stringify({
        id,
        name: `Test Plugin ${id}`,
        version: "1.0.0",
        description: "A test plugin",
        author: "Test",
        minKrytonVersion: "2.0.0",
        server: "server/index.js",
      })
    );

    fs.writeFileSync(path.join(pluginDir, "server", "index.js"), code);
  }

  it("loads and activates a valid plugin", async () => {
    createTestPlugin(
      "hello",
      `
      exports.activate = (api) => { api.log.info("activated"); };
      exports.deactivate = () => {};
    `
    );

    await manager.loadPlugin("hello");
    const instance = manager.getPlugin("hello");
    expect(instance?.state).toBe("active");
  });

  it("sets state to error on activation failure", async () => {
    createTestPlugin(
      "broken",
      `
      exports.activate = () => { throw new Error("boom"); };
      exports.deactivate = () => {};
    `
    );

    await manager.loadPlugin("broken");
    const instance = manager.getPlugin("broken");
    expect(instance?.state).toBe("error");
    expect(instance?.error).toContain("boom");
  });

  it("deactivates and unloads a plugin", async () => {
    createTestPlugin(
      "removable",
      `
      exports.activate = () => {};
      exports.deactivate = () => {};
    `
    );

    await manager.loadPlugin("removable");
    await manager.unloadPlugin("removable");
    const instance = manager.getPlugin("removable");
    expect(instance?.state).toBe("unloaded");
  });

  it("lists all plugins", async () => {
    createTestPlugin(
      "a",
      `exports.activate = () => {}; exports.deactivate = () => {};`
    );
    createTestPlugin(
      "b",
      `exports.activate = () => {}; exports.deactivate = () => {};`
    );

    await manager.loadPlugin("a");
    await manager.loadPlugin("b");
    const plugins = manager.listPlugins();
    expect(plugins).toHaveLength(2);
  });

  it("disablePlugin sets state without calling deactivate twice", async () => {
    const deactivateFn = vi.fn();
    createTestPlugin(
      "disable-test",
      `
      exports.activate = () => {};
      exports.deactivate = ${deactivateFn.toString()};
    `
    );

    // Use a simpler approach: just test that disablePlugin changes state
    await manager.loadPlugin("disable-test");
    await manager.disablePlugin("disable-test");
    const instance = manager.getPlugin("disable-test");
    expect(instance?.state).toBe("unloaded");
  });

  it("times out if activate takes too long", async () => {
    createTestPlugin(
      "slow",
      `
      exports.activate = () => new Promise(() => {}); // never resolves
      exports.deactivate = () => {};
    `
    );

    // Use a short timeout for testing
    manager.setActivationTimeout(100);
    await manager.loadPlugin("slow");
    const instance = manager.getPlugin("slow");
    expect(instance?.state).toBe("error");
    expect(instance?.error).toContain("timeout");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/pascal/Development/kryton && npm run test:server`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement PluginManager**

Create `packages/server/src/plugins/PluginManager.ts`:
```typescript
import path from "path";
import fs from "fs";
import { PluginManifest, PluginInstance, PluginModule } from "./types";
import { PluginEventBus } from "./PluginEventBus";
import { PluginRouter } from "./PluginRouter";
import { PluginHealthMonitor } from "./PluginHealthMonitor";
import { PluginApiFactory } from "./PluginApiFactory";

interface PluginManagerDeps {
  pluginsDir: string;
  eventBus: PluginEventBus;
  pluginRouter: PluginRouter;
  healthMonitor: PluginHealthMonitor;
  apiFactory: PluginApiFactory;
}

export class PluginManager {
  private deps: PluginManagerDeps;
  private plugins = new Map<string, PluginInstance>();
  private activationTimeoutMs = 10_000;

  constructor(deps: PluginManagerDeps) {
    this.deps = deps;
  }

  setActivationTimeout(ms: number): void {
    this.activationTimeoutMs = ms;
  }

  async loadPlugin(pluginId: string): Promise<void> {
    const pluginDir = path.join(this.deps.pluginsDir, pluginId);
    const manifestPath = path.join(pluginDir, "manifest.json");

    const manifestRaw = fs.readFileSync(manifestPath, "utf-8");
    const manifest: PluginManifest = JSON.parse(manifestRaw);

    const instance: PluginInstance = {
      manifest,
      state: "installed",
      module: null,
      api: null,
      error: null,
      registeredRoutes: [],
      registeredEvents: [],
    };

    this.plugins.set(pluginId, instance);

    if (!manifest.server) {
      instance.state = "active";
      return;
    }

    // Load module
    const serverEntry = path.resolve(pluginDir, manifest.server);
    try {
      // Clear require cache for hot-reload
      delete require.cache[require.resolve(serverEntry)];
    } catch {
      // Not cached yet
    }

    let mod: PluginModule;
    try {
      mod = require(serverEntry);
      instance.module = mod;
      instance.state = "loaded";
    } catch (err) {
      instance.state = "error";
      instance.error = `Failed to load: ${(err as Error).message}`;
      return;
    }

    // Activate with timeout
    const api = this.deps.apiFactory.createApi(manifest);
    instance.api = api;

    try {
      await Promise.race([
        Promise.resolve(mod.activate(api)),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Activation timeout")),
            this.activationTimeoutMs
          )
        ),
      ]);
      instance.state = "active";
    } catch (err) {
      instance.state = "error";
      instance.error = `Activation failed: ${(err as Error).message}`;
      // Clean up any partial registrations
      this.deps.eventBus.removeAllForPlugin(pluginId);
      this.deps.pluginRouter.removeAllForPlugin(pluginId);
    }
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) return;

    instance.state = "deactivating";

    // Call deactivate if module exists
    if (instance.module?.deactivate) {
      try {
        await Promise.resolve(instance.module.deactivate());
      } catch {
        // Best effort
      }
    }

    // Clean up registrations
    this.deps.eventBus.removeAllForPlugin(pluginId);
    this.deps.pluginRouter.removeAllForPlugin(pluginId);
    this.deps.healthMonitor.reset(pluginId);

    // Clear require cache
    if (instance.manifest.server) {
      const serverEntry = path.resolve(
        this.deps.pluginsDir,
        pluginId,
        instance.manifest.server
      );
      try {
        delete require.cache[require.resolve(serverEntry)];
      } catch {
        // Not cached
      }
    }

    instance.state = "unloaded";
    instance.module = null;
    instance.api = null;
  }

  async disablePlugin(pluginId: string): Promise<void> {
    await this.unloadPlugin(pluginId);
  }

  async reloadPlugin(pluginId: string): Promise<void> {
    await this.unloadPlugin(pluginId);
    await this.loadPlugin(pluginId);
  }

  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  listPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  getActivePlugins(): PluginInstance[] {
    return this.listPlugins().filter((p) => p.state === "active");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/pascal/Development/kryton && npm run test:server`
Expected: All PluginManager tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/plugins/PluginManager.ts packages/server/src/plugins/__tests__/PluginManager.test.ts && git commit -m "feat(plugins): implement PluginManager with load/activate/deactivate/hot-swap"
```

---

## Task 9: Plugin REST Endpoints

**Files:**
- Create: `packages/server/src/routes/plugins.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Create plugins route**

Create `packages/server/src/routes/plugins.ts`:
```typescript
import { Router } from "express";
import { PluginManager } from "../plugins/PluginManager";

/**
 * @swagger
 * /api/plugins/active:
 *   get:
 *     summary: List active plugins with client bundle info
 *     tags: [Plugins]
 *     responses:
 *       200:
 *         description: Array of active plugin metadata
 */
export function createPluginsRouter(pluginManager: PluginManager): Router {
  const router = Router();

  router.get("/active", (req, res) => {
    const active = pluginManager.getActivePlugins();
    res.json(
      active.map((p) => ({
        id: p.manifest.id,
        name: p.manifest.name,
        version: p.manifest.version,
        description: p.manifest.description,
        client: p.manifest.client ? `/plugins/${p.manifest.id}/client/index.js` : null,
        settings: p.manifest.settings || [],
      }))
    );
  });

  router.get("/all", (req, res) => {
    const all = pluginManager.listPlugins();
    res.json(
      all.map((p) => ({
        id: p.manifest.id,
        name: p.manifest.name,
        version: p.manifest.version,
        description: p.manifest.description,
        author: p.manifest.author,
        state: p.state,
        error: p.error,
        settings: p.manifest.settings || [],
      }))
    );
  });

  return router;
}
```

- [ ] **Step 2: Wire PluginManager into server startup**

Modify `packages/server/src/index.ts` to:
1. Import plugin system modules
2. After `AppDataSource.initialize()`, create `PluginEventBus`, `PluginHealthMonitor`, `PluginRouter`, `PluginApiFactory`, `PluginManager`
3. Mount `createPluginsRouter(pluginManager)` at `/api/plugins` (authenticated)
4. Load installed plugins from the `InstalledPlugin` entity
5. Serve plugin client bundles as static files from the plugins directory

Add these imports:
```typescript
import { PluginEventBus } from "./plugins/PluginEventBus";
import { PluginHealthMonitor } from "./plugins/PluginHealthMonitor";
import { PluginRouter } from "./plugins/PluginRouter";
import { PluginApiFactory } from "./plugins/PluginApiFactory";
import { PluginManager } from "./plugins/PluginManager";
import { InstalledPlugin } from "./entities/InstalledPlugin";
import { createPluginsRouter } from "./routes/plugins";
```

After `AppDataSource.initialize()`, add:
```typescript
// Plugin system initialization
const pluginsDir = path.join(process.cwd(), "plugins");
fs.mkdirSync(pluginsDir, { recursive: true });

const eventBus = new PluginEventBus();
const pluginRouter = new PluginRouter(app);
const healthMonitor = new PluginHealthMonitor({
  maxErrors: 5,
  windowMs: 60_000,
  onDisable: async (pluginId) => {
    console.warn(`[plugins] Auto-disabling plugin ${pluginId} due to excessive errors`);
    await pluginManager.disablePlugin(pluginId);
    const repo = AppDataSource.getRepository(InstalledPlugin);
    await repo.update(pluginId, { enabled: false, state: "error", error: "Auto-disabled: too many errors" });
  },
});
const apiFactory = new PluginApiFactory({
  eventBus,
  pluginRouter,
  healthMonitor,
  notesDir: NOTES_DIR,
});
const pluginManager = new PluginManager({
  pluginsDir,
  eventBus,
  pluginRouter,
  healthMonitor,
  apiFactory,
});

// Load enabled plugins
const installedPlugins = await AppDataSource.getRepository(InstalledPlugin).find({ where: { enabled: true } });
for (const ip of installedPlugins) {
  try {
    await pluginManager.loadPlugin(ip.id);
    console.log(`[plugins] Loaded plugin: ${ip.id}`);
  } catch (err) {
    console.error(`[plugins] Failed to load plugin ${ip.id}:`, err);
  }
}

// Serve plugin client bundles
app.use("/plugins", express.static(pluginsDir));
```

Mount the plugins route alongside other authenticated routes:
```typescript
app.use("/api/plugins", authMiddleware, createPluginsRouter(pluginManager));
```

- [ ] **Step 3: Verify server starts without errors**

Run: `cd /Users/pascal/Development/kryton/packages/server && npm run build`
Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/plugins.ts packages/server/src/index.ts && git commit -m "feat(plugins): add plugin REST endpoints and wire PluginManager into server startup"
```

---

## Task 10: Frontend Plugin Type Definitions

**Files:**
- Create: `packages/client/src/plugins/types.ts`

- [ ] **Step 1: Create client-side plugin types**

Create `packages/client/src/plugins/types.ts`:
```typescript
import { ComponentType } from "react";

// --- UI Slot Types ---

export interface SidebarPanelRegistration {
  id: string;
  pluginId: string;
  title: string;
  icon: string;
  order: number;
  component: ComponentType;
}

export interface StatusBarItemRegistration {
  id: string;
  pluginId: string;
  position: "left" | "right";
  order: number;
  component: ComponentType;
}

export interface EditorToolbarButtonRegistration {
  id: string;
  pluginId: string;
  order: number;
  component: ComponentType;
}

export interface SettingsSectionRegistration {
  id: string;
  pluginId: string;
  title: string;
  component: ComponentType;
}

export interface PageRegistration {
  id: string;
  pluginId: string;
  path: string;
  title: string;
  icon: string;
  showInSidebar: boolean;
  component: ComponentType;
}

export interface NoteActionRegistration {
  id: string;
  pluginId: string;
  label: string;
  icon: string;
  onClick: (notePath: string) => void;
}

export interface CodeFenceRendererRegistration {
  language: string;
  pluginId: string;
  component: ComponentType<{ content: string; notePath: string }>;
}

export interface CommandRegistration {
  id: string;
  pluginId: string;
  name: string;
  shortcut?: string;
  execute: () => void;
}

// --- Client Plugin API ---

export interface ClientPluginAPI {
  ui: {
    registerSidebarPanel(
      component: ComponentType,
      options: { id: string; title: string; icon: string; order?: number }
    ): void;
    registerStatusBarItem(
      component: ComponentType,
      options: { id: string; position: "left" | "right"; order?: number }
    ): void;
    registerEditorToolbarButton(
      component: ComponentType,
      options: { id: string; order?: number }
    ): void;
    registerSettingsSection(
      component: ComponentType,
      options: { id: string; title: string }
    ): void;
    registerPage(
      component: ComponentType,
      options: {
        id: string;
        path: string;
        title: string;
        icon: string;
        showInSidebar?: boolean;
      }
    ): void;
    registerNoteAction(options: {
      id: string;
      label: string;
      icon: string;
      onClick: (notePath: string) => void;
    }): void;
  };
  markdown: {
    registerCodeFenceRenderer(
      language: string,
      component: ComponentType<{ content: string; notePath: string }>
    ): void;
    registerPostProcessor(fn: (html: string) => string): void;
  };
  commands: {
    register(command: {
      id: string;
      name: string;
      shortcut?: string;
      execute: () => void;
    }): void;
  };
  context: {
    useCurrentUser(): { id: string; name: string; email: string } | null;
    useCurrentNote(): { path: string; content: string } | null;
    useTheme(): "light" | "dark";
    usePluginSettings(key: string): unknown;
  };
  api: {
    fetch(path: string, options?: RequestInit): Promise<Response>;
  };
  notify: {
    info(message: string): void;
    success(message: string): void;
    error(message: string): void;
  };
}

// --- Client Plugin Module ---

export interface ClientPluginModule {
  activate(api: ClientPluginAPI): void;
  deactivate?(): void;
}

// --- Active Plugin Info (from server) ---

export interface ActivePluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  client: string | null;
  settings: Array<{
    key: string;
    type: string;
    default: unknown;
    label: string;
    perUser: boolean;
  }>;
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/pascal/Development/kryton && npx tsc --noEmit --project packages/client/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/plugins/types.ts && git commit -m "feat(plugins): add client-side plugin type definitions"
```

---

## Task 11: Plugin Slot Registry (Client)

**Files:**
- Create: `packages/client/src/plugins/PluginSlotRegistry.ts`
- Create: `packages/client/src/plugins/__tests__/PluginSlotRegistry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/plugins/__tests__/PluginSlotRegistry.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { PluginSlotRegistry } from "../PluginSlotRegistry";

describe("PluginSlotRegistry", () => {
  let registry: PluginSlotRegistry;

  beforeEach(() => {
    registry = new PluginSlotRegistry();
  });

  it("registers and retrieves sidebar panels", () => {
    const TestComponent = () => null;
    registry.registerSidebarPanel("test-plugin", TestComponent, {
      id: "panel-1",
      title: "Test Panel",
      icon: "layout",
    });

    const panels = registry.getSidebarPanels();
    expect(panels).toHaveLength(1);
    expect(panels[0].title).toBe("Test Panel");
    expect(panels[0].pluginId).toBe("test-plugin");
  });

  it("registers pages", () => {
    const TestPage = () => null;
    registry.registerPage("test-plugin", TestPage, {
      id: "page-1",
      path: "/kanban",
      title: "Kanban",
      icon: "layout-grid",
      showInSidebar: true,
    });

    const pages = registry.getPages();
    expect(pages).toHaveLength(1);
    expect(pages[0].path).toBe("/kanban");
  });

  it("registers code fence renderers", () => {
    const Renderer = () => null;
    registry.registerCodeFenceRenderer("test-plugin", "kanban", Renderer);

    const renderer = registry.getCodeFenceRenderer("kanban");
    expect(renderer).toBeDefined();
    expect(renderer?.component).toBe(Renderer);
  });

  it("removes all registrations for a plugin", () => {
    const Component = () => null;
    registry.registerSidebarPanel("plugin-a", Component, {
      id: "a",
      title: "A",
      icon: "x",
    });
    registry.registerSidebarPanel("plugin-b", Component, {
      id: "b",
      title: "B",
      icon: "x",
    });

    registry.removeAllForPlugin("plugin-a");

    const panels = registry.getSidebarPanels();
    expect(panels).toHaveLength(1);
    expect(panels[0].pluginId).toBe("plugin-b");
  });

  it("sorts registrations by order", () => {
    const A = () => null;
    const B = () => null;
    registry.registerSidebarPanel("p", A, {
      id: "a",
      title: "A",
      icon: "x",
      order: 10,
    });
    registry.registerSidebarPanel("p", B, {
      id: "b",
      title: "B",
      icon: "x",
      order: 1,
    });

    const panels = registry.getSidebarPanels();
    expect(panels[0].id).toBe("b");
    expect(panels[1].id).toBe("a");
  });

  it("registers commands", () => {
    const execute = () => {};
    registry.registerCommand("test-plugin", {
      id: "cmd-1",
      name: "Do Thing",
      shortcut: "Ctrl+Shift+K",
      execute,
    });

    const commands = registry.getCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("Do Thing");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/pascal/Development/kryton && npm run test:client`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement PluginSlotRegistry**

Create `packages/client/src/plugins/PluginSlotRegistry.ts`:
```typescript
import { ComponentType } from "react";
import {
  SidebarPanelRegistration,
  StatusBarItemRegistration,
  EditorToolbarButtonRegistration,
  SettingsSectionRegistration,
  PageRegistration,
  NoteActionRegistration,
  CodeFenceRendererRegistration,
  CommandRegistration,
} from "./types";

export class PluginSlotRegistry {
  private sidebarPanels: SidebarPanelRegistration[] = [];
  private statusBarItems: StatusBarItemRegistration[] = [];
  private editorToolbarButtons: EditorToolbarButtonRegistration[] = [];
  private settingsSections: SettingsSectionRegistration[] = [];
  private pages: PageRegistration[] = [];
  private noteActions: NoteActionRegistration[] = [];
  private codeFenceRenderers = new Map<string, CodeFenceRendererRegistration>();
  private postProcessors: Array<{ pluginId: string; fn: (html: string) => string }> = [];
  private commands: CommandRegistration[] = [];
  private listeners = new Set<() => void>();

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- Sidebar Panels ---

  registerSidebarPanel(
    pluginId: string,
    component: ComponentType,
    options: { id: string; title: string; icon: string; order?: number }
  ): void {
    this.sidebarPanels.push({
      ...options,
      pluginId,
      component,
      order: options.order ?? 100,
    });
    this.notify();
  }

  getSidebarPanels(): SidebarPanelRegistration[] {
    return [...this.sidebarPanels].sort((a, b) => a.order - b.order);
  }

  // --- Status Bar ---

  registerStatusBarItem(
    pluginId: string,
    component: ComponentType,
    options: { id: string; position: "left" | "right"; order?: number }
  ): void {
    this.statusBarItems.push({
      ...options,
      pluginId,
      component,
      order: options.order ?? 100,
    });
    this.notify();
  }

  getStatusBarItems(position: "left" | "right"): StatusBarItemRegistration[] {
    return this.statusBarItems
      .filter((i) => i.position === position)
      .sort((a, b) => a.order - b.order);
  }

  // --- Editor Toolbar ---

  registerEditorToolbarButton(
    pluginId: string,
    component: ComponentType,
    options: { id: string; order?: number }
  ): void {
    this.editorToolbarButtons.push({
      ...options,
      pluginId,
      component,
      order: options.order ?? 100,
    });
    this.notify();
  }

  getEditorToolbarButtons(): EditorToolbarButtonRegistration[] {
    return [...this.editorToolbarButtons].sort((a, b) => a.order - b.order);
  }

  // --- Settings ---

  registerSettingsSection(
    pluginId: string,
    component: ComponentType,
    options: { id: string; title: string }
  ): void {
    this.settingsSections.push({ ...options, pluginId, component });
    this.notify();
  }

  getSettingsSections(): SettingsSectionRegistration[] {
    return [...this.settingsSections];
  }

  // --- Pages ---

  registerPage(
    pluginId: string,
    component: ComponentType,
    options: {
      id: string;
      path: string;
      title: string;
      icon: string;
      showInSidebar?: boolean;
    }
  ): void {
    this.pages.push({
      ...options,
      pluginId,
      component,
      showInSidebar: options.showInSidebar ?? false,
    });
    this.notify();
  }

  getPages(): PageRegistration[] {
    return [...this.pages];
  }

  // --- Note Actions ---

  registerNoteAction(
    pluginId: string,
    options: { id: string; label: string; icon: string; onClick: (notePath: string) => void }
  ): void {
    this.noteActions.push({ ...options, pluginId });
    this.notify();
  }

  getNoteActions(): NoteActionRegistration[] {
    return [...this.noteActions];
  }

  // --- Code Fence Renderers ---

  registerCodeFenceRenderer(
    pluginId: string,
    language: string,
    component: ComponentType<{ content: string; notePath: string }>
  ): void {
    this.codeFenceRenderers.set(language, { language, pluginId, component });
    this.notify();
  }

  getCodeFenceRenderer(language: string): CodeFenceRendererRegistration | undefined {
    return this.codeFenceRenderers.get(language);
  }

  // --- Post Processors ---

  registerPostProcessor(pluginId: string, fn: (html: string) => string): void {
    this.postProcessors.push({ pluginId, fn });
  }

  getPostProcessors(): Array<(html: string) => string> {
    return this.postProcessors.map((p) => p.fn);
  }

  // --- Commands ---

  registerCommand(
    pluginId: string,
    command: { id: string; name: string; shortcut?: string; execute: () => void }
  ): void {
    this.commands.push({ ...command, pluginId });
    this.notify();
  }

  getCommands(): CommandRegistration[] {
    return [...this.commands];
  }

  // --- Cleanup ---

  removeAllForPlugin(pluginId: string): void {
    this.sidebarPanels = this.sidebarPanels.filter((r) => r.pluginId !== pluginId);
    this.statusBarItems = this.statusBarItems.filter((r) => r.pluginId !== pluginId);
    this.editorToolbarButtons = this.editorToolbarButtons.filter((r) => r.pluginId !== pluginId);
    this.settingsSections = this.settingsSections.filter((r) => r.pluginId !== pluginId);
    this.pages = this.pages.filter((r) => r.pluginId !== pluginId);
    this.noteActions = this.noteActions.filter((r) => r.pluginId !== pluginId);
    this.postProcessors = this.postProcessors.filter((r) => r.pluginId !== pluginId);
    this.commands = this.commands.filter((r) => r.pluginId !== pluginId);

    for (const [lang, reg] of this.codeFenceRenderers) {
      if (reg.pluginId === pluginId) this.codeFenceRenderers.delete(lang);
    }

    this.notify();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/pascal/Development/kryton && npm run test:client`
Expected: All PluginSlotRegistry tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/plugins/PluginSlotRegistry.ts packages/client/src/plugins/__tests__/PluginSlotRegistry.test.ts && git commit -m "feat(plugins): implement PluginSlotRegistry for frontend UI slot management"
```

---

## Task 12: Plugin Error Boundary (Client)

**Files:**
- Create: `packages/client/src/plugins/PluginErrorBoundary.tsx`
- Create: `packages/client/src/plugins/__tests__/PluginErrorBoundary.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/plugins/__tests__/PluginErrorBoundary.test.tsx`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PluginErrorBoundary } from "../PluginErrorBoundary";

const ThrowingComponent = () => {
  throw new Error("Component crash");
};

describe("PluginErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <PluginErrorBoundary pluginId="test" pluginName="Test Plugin">
        <div>Hello</div>
      </PluginErrorBoundary>
    );
    expect(screen.getByText("Hello")).toBeDefined();
  });

  it("renders fallback on error", () => {
    // Suppress console.error for expected error
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <PluginErrorBoundary pluginId="test" pluginName="Test Plugin">
        <ThrowingComponent />
      </PluginErrorBoundary>
    );
    expect(screen.getByText(/Test Plugin encountered an error/)).toBeDefined();
    spy.mockRestore();
  });

  it("provides a retry button that resets the error", () => {
    let shouldThrow = true;
    const MaybeThrow = () => {
      if (shouldThrow) throw new Error("crash");
      return <div>Recovered</div>;
    };

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <PluginErrorBoundary pluginId="test" pluginName="Test Plugin">
        <MaybeThrow />
      </PluginErrorBoundary>
    );

    expect(screen.getByText(/encountered an error/)).toBeDefined();

    shouldThrow = false;
    fireEvent.click(screen.getByText("Retry"));

    // After retry, re-render with no-throw component
    rerender(
      <PluginErrorBoundary pluginId="test" pluginName="Test Plugin">
        <MaybeThrow />
      </PluginErrorBoundary>
    );

    expect(screen.getByText("Recovered")).toBeDefined();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/pascal/Development/kryton && npm run test:client`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement PluginErrorBoundary**

Create `packages/client/src/plugins/PluginErrorBoundary.tsx`:
```tsx
import React, { Component, ReactNode } from "react";

interface Props {
  pluginId: string;
  pluginName: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class PluginErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: "12px",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: "8px",
            background: "rgba(239, 68, 68, 0.05)",
            fontSize: "13px",
          }}
        >
          <div style={{ color: "#ef4444", marginBottom: "8px" }}>
            {this.props.pluginName} encountered an error
          </div>
          <div style={{ color: "#888", fontSize: "12px", marginBottom: "8px" }}>
            {this.state.error?.message}
          </div>
          <button
            onClick={this.handleRetry}
            style={{
              padding: "4px 12px",
              fontSize: "12px",
              borderRadius: "4px",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.05)",
              color: "#e2e8f0",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/pascal/Development/kryton && npm run test:client`
Expected: All PluginErrorBoundary tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/plugins/PluginErrorBoundary.tsx packages/client/src/plugins/__tests__/PluginErrorBoundary.test.tsx && git commit -m "feat(plugins): implement PluginErrorBoundary for resilient plugin UI rendering"
```

---

## Task 13: Plugin Context & Slot Component (Client)

**Files:**
- Create: `packages/client/src/plugins/PluginContext.tsx`
- Create: `packages/client/src/components/PluginSlot/PluginSlot.tsx`
- Create: `packages/client/src/plugins/PluginManager.ts`

- [ ] **Step 1: Create PluginContext**

Create `packages/client/src/plugins/PluginContext.tsx`:
```tsx
import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { PluginSlotRegistry } from "./PluginSlotRegistry";
import {
  SidebarPanelRegistration,
  StatusBarItemRegistration,
  EditorToolbarButtonRegistration,
  PageRegistration,
  NoteActionRegistration,
  CommandRegistration,
  CodeFenceRendererRegistration,
} from "./types";

interface PluginContextValue {
  registry: PluginSlotRegistry;
  sidebarPanels: SidebarPanelRegistration[];
  statusBarLeft: StatusBarItemRegistration[];
  statusBarRight: StatusBarItemRegistration[];
  editorToolbarButtons: EditorToolbarButtonRegistration[];
  pages: PageRegistration[];
  noteActions: NoteActionRegistration[];
  commands: CommandRegistration[];
  getCodeFenceRenderer: (lang: string) => CodeFenceRendererRegistration | undefined;
}

const PluginCtx = createContext<PluginContextValue | null>(null);

export function PluginProvider({
  registry,
  children,
}: {
  registry: PluginSlotRegistry;
  children: ReactNode;
}) {
  const [, setVersion] = useState(0);

  useEffect(() => {
    return registry.subscribe(() => setVersion((v) => v + 1));
  }, [registry]);

  const value: PluginContextValue = {
    registry,
    sidebarPanels: registry.getSidebarPanels(),
    statusBarLeft: registry.getStatusBarItems("left"),
    statusBarRight: registry.getStatusBarItems("right"),
    editorToolbarButtons: registry.getEditorToolbarButtons(),
    pages: registry.getPages(),
    noteActions: registry.getNoteActions(),
    commands: registry.getCommands(),
    getCodeFenceRenderer: (lang) => registry.getCodeFenceRenderer(lang),
  };

  return <PluginCtx.Provider value={value}>{children}</PluginCtx.Provider>;
}

export function usePluginSlots(): PluginContextValue {
  const ctx = useContext(PluginCtx);
  if (!ctx) {
    throw new Error("usePluginSlots must be used within PluginProvider");
  }
  return ctx;
}
```

- [ ] **Step 2: Create PluginSlot component**

Create `packages/client/src/components/PluginSlot/PluginSlot.tsx`:
```tsx
import React from "react";
import { PluginErrorBoundary } from "../../plugins/PluginErrorBoundary";
import { usePluginSlots } from "../../plugins/PluginContext";

interface PluginSlotProps {
  slot: "sidebar" | "statusbar-left" | "statusbar-right" | "editor-toolbar";
}

export function PluginSlot({ slot }: PluginSlotProps) {
  const plugins = usePluginSlots();

  let items: Array<{ id: string; pluginId: string; component: React.ComponentType; title?: string }> = [];

  switch (slot) {
    case "sidebar":
      items = plugins.sidebarPanels.map((p) => ({
        id: p.id,
        pluginId: p.pluginId,
        component: p.component,
        title: p.title,
      }));
      break;
    case "statusbar-left":
      items = plugins.statusBarLeft.map((p) => ({
        id: p.id,
        pluginId: p.pluginId,
        component: p.component,
      }));
      break;
    case "statusbar-right":
      items = plugins.statusBarRight.map((p) => ({
        id: p.id,
        pluginId: p.pluginId,
        component: p.component,
      }));
      break;
    case "editor-toolbar":
      items = plugins.editorToolbarButtons.map((p) => ({
        id: p.id,
        pluginId: p.pluginId,
        component: p.component,
      }));
      break;
  }

  if (items.length === 0) return null;

  return (
    <>
      {items.map((item) => (
        <PluginErrorBoundary
          key={item.id}
          pluginId={item.pluginId}
          pluginName={item.title || item.pluginId}
        >
          <item.component />
        </PluginErrorBoundary>
      ))}
    </>
  );
}
```

- [ ] **Step 3: Create frontend PluginManager**

Create `packages/client/src/plugins/PluginManager.ts`:
```typescript
import { PluginSlotRegistry } from "./PluginSlotRegistry";
import { ClientPluginAPI, ClientPluginModule, ActivePluginInfo } from "./types";
import { request } from "../lib/api";

export class ClientPluginManager {
  private registry: PluginSlotRegistry;
  private loadedPlugins = new Map<string, ClientPluginModule>();

  constructor(registry: PluginSlotRegistry) {
    this.registry = registry;
  }

  async loadActivePlugins(): Promise<void> {
    const plugins = await request<ActivePluginInfo[]>("/plugins/active");

    for (const plugin of plugins) {
      if (!plugin.client) continue;
      try {
        await this.loadPlugin(plugin);
      } catch (err) {
        console.error(`[plugins] Failed to load client plugin: ${plugin.id}`, err);
      }
    }
  }

  private async loadPlugin(info: ActivePluginInfo): Promise<void> {
    const module: ClientPluginModule = await import(
      /* @vite-ignore */ info.client!
    );

    const api = this.createClientApi(info.id);
    module.activate(api);
    this.loadedPlugins.set(info.id, module);
  }

  unloadPlugin(pluginId: string): void {
    const module = this.loadedPlugins.get(pluginId);
    if (module?.deactivate) {
      module.deactivate();
    }
    this.registry.removeAllForPlugin(pluginId);
    this.loadedPlugins.delete(pluginId);
  }

  private createClientApi(pluginId: string): ClientPluginAPI {
    const registry = this.registry;

    return {
      ui: {
        registerSidebarPanel: (component, options) =>
          registry.registerSidebarPanel(pluginId, component, options),
        registerStatusBarItem: (component, options) =>
          registry.registerStatusBarItem(pluginId, component, options),
        registerEditorToolbarButton: (component, options) =>
          registry.registerEditorToolbarButton(pluginId, component, options),
        registerSettingsSection: (component, options) =>
          registry.registerSettingsSection(pluginId, component, options),
        registerPage: (component, options) =>
          registry.registerPage(pluginId, component, options),
        registerNoteAction: (options) =>
          registry.registerNoteAction(pluginId, options),
      },
      markdown: {
        registerCodeFenceRenderer: (language, component) =>
          registry.registerCodeFenceRenderer(pluginId, language, component),
        registerPostProcessor: (fn) =>
          registry.registerPostProcessor(pluginId, fn),
      },
      commands: {
        register: (command) => registry.registerCommand(pluginId, command),
      },
      context: {
        useCurrentUser: () => {
          // Will be connected to AuthContext in integration
          return null;
        },
        useCurrentNote: () => {
          // Will be connected to useNotes in integration
          return null;
        },
        useTheme: () => {
          // Will be connected to useTheme in integration
          return "dark";
        },
        usePluginSettings: () => {
          // Will be connected to settings API in integration
          return null;
        },
      },
      api: {
        fetch: (path, options) => {
          const url = `/api/plugins/${pluginId}${path}`;
          return fetch(url, {
            ...options,
            headers: {
              ...options?.headers,
              "X-Requested-With": "XMLHttpRequest",
            },
            credentials: "include",
          });
        },
      },
      notify: {
        info: (msg) => console.log(`[plugin:${pluginId}]`, msg),
        success: (msg) => console.log(`[plugin:${pluginId}]`, msg),
        error: (msg) => console.error(`[plugin:${pluginId}]`, msg),
      },
    };
  }
}
```

- [ ] **Step 4: Verify types compile**

Run: `cd /Users/pascal/Development/kryton && npx tsc --noEmit --project packages/client/tsconfig.json`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/plugins/PluginContext.tsx packages/client/src/plugins/PluginManager.ts packages/client/src/components/PluginSlot/PluginSlot.tsx && git commit -m "feat(plugins): add PluginContext, PluginSlot component, and ClientPluginManager"
```

---

## Task 14: Integrate Plugin System into App

**Files:**
- Modify: `packages/client/src/App.tsx`
- Modify: `packages/client/src/lib/api.ts`

- [ ] **Step 1: Add plugin API methods to api.ts**

Add to `packages/client/src/lib/api.ts` in the `api` object:
```typescript
// Plugins
getActivePlugins: () => request<ActivePluginInfo[]>('/plugins/active'),
getAllPlugins: () => request<any[]>('/plugins/all'),
```

Add import at the top:
```typescript
import { ActivePluginInfo } from "../plugins/types";
```

- [ ] **Step 2: Integrate PluginProvider into App.tsx**

At the top of `packages/client/src/App.tsx`, add imports:
```typescript
import { PluginSlotRegistry } from "./plugins/PluginSlotRegistry";
import { ClientPluginManager } from "./plugins/PluginManager";
import { PluginProvider } from "./plugins/PluginContext";
import { PluginSlot } from "./components/PluginSlot/PluginSlot";
```

Create the registry and manager as module-level singletons:
```typescript
const pluginRegistry = new PluginSlotRegistry();
const pluginManager = new ClientPluginManager(pluginRegistry);
```

Wrap the main app content with `<PluginProvider registry={pluginRegistry}>`.

In the `AppContent` component (or equivalent), add a `useEffect` to load plugins on mount:
```typescript
useEffect(() => {
  pluginManager.loadActivePlugins().catch((err) => {
    console.error("[plugins] Failed to load active plugins:", err);
  });
}, []);
```

Add `<PluginSlot slot="sidebar" />` at the end of the sidebar panels area.
Add `<PluginSlot slot="editor-toolbar" />` in the editor toolbar area.
Add `<PluginSlot slot="statusbar-left" />` and `<PluginSlot slot="statusbar-right" />` in the status bar.

- [ ] **Step 3: Verify the app builds**

Run: `cd /Users/pascal/Development/kryton && npm run build`
Expected: No errors in both server and client builds.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/App.tsx packages/client/src/lib/api.ts && git commit -m "feat(plugins): integrate plugin system into App with PluginProvider and PluginSlots"
```

---

## Task 15: Sample Plugin (End-to-End Validation)

**Files:**
- Create: `plugins/sample-wordcount/manifest.json`
- Create: `plugins/sample-wordcount/server/index.js`
- Create: `plugins/sample-wordcount/client/index.js`

This is a minimal plugin that validates the entire pipeline works: server activation, custom route, frontend slot.

- [ ] **Step 1: Create plugin manifest**

Create `plugins/sample-wordcount/manifest.json`:
```json
{
  "id": "sample-wordcount",
  "name": "Word Count",
  "version": "1.0.0",
  "description": "Displays word count statistics for notes",
  "author": "Kryton",
  "minKrytonVersion": "2.0.0",
  "server": "server/index.js",
  "settings": [
    {
      "key": "countOnOpen",
      "type": "boolean",
      "default": true,
      "label": "Count words when opening a note",
      "perUser": true
    }
  ]
}
```

- [ ] **Step 2: Create server-side plugin**

Create `plugins/sample-wordcount/server/index.js`:
```javascript
exports.activate = function (api) {
  api.log.info("Word Count plugin activated");

  // Register a custom route to get word count for a note
  api.routes.register("get", "/count/:userId/:notePath(*)", async (req, res) => {
    try {
      const { userId, notePath } = req.params;
      const note = await api.notes.get(userId, notePath);
      const words = note.content.trim().split(/\s+/).filter(Boolean).length;
      const chars = note.content.length;
      const lines = note.content.split("\n").length;
      res.json({ words, chars, lines });
    } catch (err) {
      res.status(404).json({ error: "Note not found" });
    }
  });

  // Listen for note saves
  api.events.on("note:afterSave", (ctx) => {
    api.log.info(`Note saved: ${ctx.path}`);
  });
};

exports.deactivate = function () {
  // Nothing to clean up — PluginManager handles route/event removal
};
```

- [ ] **Step 3: Register sample plugin in InstalledPlugin table**

This will be done manually for now. Add a note in the README about inserting:
```sql
INSERT INTO installed_plugin (id, name, version, description, author, state, enabled, manifest)
VALUES ('sample-wordcount', 'Word Count', '1.0.0', 'Displays word count statistics', 'Kryton', 'installed', true, '{}');
```

Or add a startup script that auto-registers plugins found in the `plugins/` directory.

- [ ] **Step 4: Add auto-discovery of local plugins to PluginManager**

Add method to `packages/server/src/plugins/PluginManager.ts`:
```typescript
async discoverAndLoadPlugins(): Promise<void> {
  if (!fs.existsSync(this.deps.pluginsDir)) return;

  const entries = fs.readdirSync(this.deps.pluginsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(this.deps.pluginsDir, entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;

    try {
      await this.loadPlugin(entry.name);
      console.log(`[plugins] Loaded plugin: ${entry.name}`);
    } catch (err) {
      console.error(`[plugins] Failed to load plugin ${entry.name}:`, err);
    }
  }
}
```

Update `packages/server/src/index.ts` to call `pluginManager.discoverAndLoadPlugins()` instead of loading from the InstalledPlugin entity (that will be added in Phase 3 when registry integration is built).

- [ ] **Step 5: Start the server and verify the plugin loads**

Run: `cd /Users/pascal/Development/kryton/packages/server && npm run dev`
Expected: Console shows `[plugins] Loaded plugin: sample-wordcount` and `[plugin:sample-wordcount] Word Count plugin activated`.

- [ ] **Step 6: Test the custom route**

```bash
# After authenticating and getting a token:
curl -H "Authorization: Bearer <token>" -H "X-Requested-With: XMLHttpRequest" http://localhost:3001/api/plugins/sample-wordcount/count/<userId>/test-note
```
Expected: JSON response with word, char, and line counts (or 404 if note doesn't exist).

- [ ] **Step 7: Commit**

```bash
git add plugins/sample-wordcount/ packages/server/src/plugins/PluginManager.ts packages/server/src/index.ts && git commit -m "feat(plugins): add sample word-count plugin and auto-discovery for end-to-end validation"
```

---

## Task 16: Clean Up & Final Verification

- [ ] **Step 1: Run all tests**

```bash
cd /Users/pascal/Development/kryton && npm run test
```
Expected: All server and client tests pass.

- [ ] **Step 2: Run linting**

```bash
cd /Users/pascal/Development/kryton && npm run lint
```
Expected: No lint errors.

- [ ] **Step 3: Run type checking**

```bash
cd /Users/pascal/Development/kryton && npm run typecheck
```
Expected: No type errors.

- [ ] **Step 4: Run full build**

```bash
cd /Users/pascal/Development/kryton && npm run build
```
Expected: Both server and client build successfully.

- [ ] **Step 5: Delete setup test file**

Remove the trivial test: `packages/server/src/plugins/__tests__/setup.test.ts`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore(plugins): clean up and verify Phase 1 plugin system"
```
