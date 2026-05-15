import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { zodPlugin } from "../../../plugins/zod.js";
import { errorsPlugin } from "../../../plugins/errors.js";
import { notesModule } from "../index.js";
import type { AuthApi, AuthContext, AuthUser } from "../../../plugins/auth.js";
import { createTestDb, type TestDbHandle } from "../../../test/db-fixture.js";
import { user as userTable } from "../../../db/schema/auth.js";

/**
 * Shared Drizzle handle for notes tests. Lazily created on first call and
 * reused across the file. Under fileParallelism: true the suite no longer
 * TRUNCATEs shared tables — each suite picks a per-suite unique userId
 * (see `createNotesTestUser` below) and only touches its own rows.
 */
let sharedHandle: TestDbHandle | null = null;
function getHandle(): TestDbHandle {
  if (!sharedHandle) sharedHandle = createTestDb();
  return sharedHandle;
}

/**
 * Build a per-suite unique test user. The id satisfies SAFE_USER_ID_REGEX in
 * services/user-notes-dir.service.ts (`/^[a-zA-Z0-9_-]{8,64}$/`), and the
 * random suffix + pid keeps two parallel suites from colliding on a single
 * shared Postgres database under fileParallelism: true.
 */
export function createNotesTestUser(tag: string = "notes"): AuthUser {
  const rand = Math.floor(Math.random() * 1e9);
  return {
    id: `u-${tag}-${rand}-${process.pid}`,
    email: `${tag}-${rand}-${process.pid}@test.local`,
    name: tag,
    role: "user",
  };
}

/**
 * Seed the User row for a suite. Call once from `beforeAll`. With per-suite
 * unique ids there's no expected conflict — we deliberately don't use
 * ON CONFLICT DO NOTHING so any genuine ID collision surfaces as a failure
 * instead of silently overlapping with another suite's data.
 */
export async function seedNotesTestUser(user: AuthUser): Promise<void> {
  const handle = getHandle();
  await handle.db.insert(userTable).values({
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: false,
    role: user.role,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/**
 * Delete a suite's user. FK cascade handles every dependent row this suite
 * touched (Folder, Tag, NoteTag, NoteShare, Settings, GraphEdge,
 * SearchIndex, Attachment, NoteVersion, NoteRevision, TrashItem, McpSession).
 * Call from `afterAll`.
 */
export async function cleanupNotesTestUser(userId: string): Promise<void> {
  const handle = getHandle();
  await handle.db.delete(userTable).where(eq(userTable.id, userId));
}

export interface NotesTestAppOptions {
  user?: AuthUser | null;
  apiKey?: { id: string; scope: string } | null;
  /** Optional NOTES_DIR override; default = a fresh tmp dir. */
  notesDir?: string;
}

export interface NotesTestApp {
  app: FastifyInstance;
  notesDir: string;
  cleanup: () => Promise<void>;
}

/** Build a Fastify app with the notes module wired up against the
 * testcontainers Postgres. The User row is NOT seeded by this helper —
 * call `seedNotesTestUser` once from `beforeAll` instead. */
export async function buildNotesTestApp(
  opts: NotesTestAppOptions = {},
): Promise<NotesTestApp> {
  const notesDir =
    opts.notesDir ??
    (await fs.mkdtemp(path.join(os.tmpdir(), "kryton-notes-test-")));

  const handle = getHandle();

  const user = opts.user ?? null;

  const app = Fastify({ logger: false });

  // Minimal config decorator — only NOTES_DIR is read by the notes module.
  app.decorate("config", { NOTES_DIR: notesDir } as never);

  await app.register(zodPlugin);

  app.decorate("db", handle.db);

  // Stub auth — same shape as identity helpers.
  const apiKey = opts.apiKey ?? null;
  const ctx: AuthContext | null = user ? { user, apiKey, agentId: null } : null;

  const authApi: AuthApi = {
    instance: {} as never,
    async resolve() {
      return ctx;
    },
    async requireUser() {
      if (!ctx) {
        const { AuthError } = await import("../../../lib/errors.js");
        throw new AuthError("Missing or invalid session");
      }
      return ctx.user;
    },
    async requireAuth() {
      if (!ctx) {
        const { AuthError } = await import("../../../lib/errors.js");
        throw new AuthError("Missing or invalid session");
      }
      return ctx;
    },
    async getOptionalUser() {
      return ctx?.user ?? null;
    },
    async requireAdmin() {
      if (!ctx) {
        const { AuthError } = await import("../../../lib/errors.js");
        throw new AuthError("Missing or invalid session");
      }
      if (ctx.user.role !== "admin") {
        const { ForbiddenError } = await import("../../../lib/errors.js");
        throw new ForbiddenError("Admin access required");
      }
      return ctx.user;
    },
    requireWriteScope(c) {
      if (!c.apiKey) return;
      if (c.apiKey.scope === "read-write") return;
      throw new Error("Insufficient API key scope");
    },
    requireSession(c) {
      if (c.apiKey) {
        const err = new Error("Session required") as Error & {
          statusCode: number;
          code: string;
        };
        err.statusCode = 403;
        err.code = "FORBIDDEN";
        throw err;
      }
    },
    async authenticateWsToken() {
      return null;
    },
  };
  app.decorate("auth", authApi);

  await app.register(errorsPlugin);
  await app.register(notesModule);
  await app.ready();

  return {
    app,
    notesDir,
    cleanup: async () => {
      await app.close();
      if (!opts.notesDir) {
        await fs.rm(notesDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}
