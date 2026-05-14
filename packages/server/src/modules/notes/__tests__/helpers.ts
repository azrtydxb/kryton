import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { zodPlugin } from "../../../plugins/zod.js";
import { errorsPlugin } from "../../../plugins/errors.js";
import { notesModule } from "../index.js";
import type { AuthApi, AuthContext, AuthUser } from "../../../plugins/auth.js";
import { createTestDb, type TestDbHandle } from "../../../test/db-fixture.js";
import { user as userTable } from "../../../db/schema/auth.js";

/**
 * Shared Drizzle handle for notes tests. Lazily created on first call and
 * reused across the file. The notes test suite touches: SearchIndex, Folder,
 * Tag, NoteTag, TrashItem, Settings, NoteShare, Attachment, GraphEdge,
 * NoteVersion, NoteRevision — all truncated below.
 */
let sharedHandle: TestDbHandle | null = null;
function getHandle(): TestDbHandle {
  if (!sharedHandle) sharedHandle = createTestDb();
  return sharedHandle;
}

async function resetNotesTestDb(handle: TestDbHandle): Promise<void> {
  // Listing every table explicitly (including the newer McpSession that
  // FKs to User) keeps the planner from chasing the CASCADE chain on
  // each test reset — a small but measurable win on a slow runner.
  await handle.db.execute(sql`
    TRUNCATE TABLE
      "Attachment",
      "NoteRevision",
      "NoteVersion",
      "NoteTag",
      "Tag",
      "Folder",
      "TrashItem",
      "Settings",
      "NoteShare",
      "GraphEdge",
      "SearchIndex",
      "McpSession",
      "User"
    RESTART IDENTITY CASCADE
  `);
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
 * testcontainers Postgres. */
export async function buildNotesTestApp(
  opts: NotesTestAppOptions = {},
): Promise<NotesTestApp> {
  const notesDir =
    opts.notesDir ??
    (await fs.mkdtemp(path.join(os.tmpdir(), "kryton-notes-test-")));

  const handle = getHandle();
  await resetNotesTestDb(handle);

  const user = opts.user ?? null;
  // Seed the User row when an authenticated user is configured — every
  // table that references User via FK (Folder, Tag, NoteTag, NoteShare, …)
  // is cascade-deleted via the truncate above, so we must
  // re-insert the user row for each test that needs one.
  if (user) {
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
