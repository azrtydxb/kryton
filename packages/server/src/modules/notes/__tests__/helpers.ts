import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import { zodPlugin } from "../../../plugins/zod.js";
import { errorsPlugin } from "../../../plugins/errors.js";
import { notesModule } from "../index.js";
import type { AuthApi, AuthContext, AuthUser } from "../../../plugins/auth.js";

export interface NotesTestAppOptions {
  user?: AuthUser | null;
  apiKey?: { id: string; scope: string } | null;
  /** Inline prisma stub — provide just the methods used by routes under test. */
  prisma?: unknown;
  /** Optional NOTES_DIR override; default = a fresh tmp dir. */
  notesDir?: string;
}

export interface NotesTestApp {
  app: FastifyInstance;
  notesDir: string;
  cleanup: () => Promise<void>;
}

/** Build a Fastify app with the notes module wired up against stubs. */
export async function buildNotesTestApp(
  opts: NotesTestAppOptions = {},
): Promise<NotesTestApp> {
  const notesDir =
    opts.notesDir ??
    (await fs.mkdtemp(path.join(os.tmpdir(), "kryton-notes-test-")));

  const app = Fastify({ logger: false });

  // Minimal config decorator — only NOTES_DIR is read by the notes module.
  app.decorate("config", { NOTES_DIR: notesDir } as never);

  await app.register(zodPlugin);

  // Stub prisma — default to a no-op stub good enough for unauth tests.
  const prismaStub = opts.prisma ?? {
    folder: { findUnique: async () => null, findMany: async () => [], create: async () => ({}) },
    tag: { upsert: async () => ({ id: "t-1" }) },
    noteTag: { findUnique: async () => null, create: async () => ({}), findMany: async () => [] },
    searchIndex: { findMany: async () => [] },
    syncCursor: { upsert: async () => ({ cursor: 1n }) },
    settings: { findUnique: async () => null },
    trashItem: {
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => ({}),
      delete: async () => ({}),
      deleteMany: async () => ({}),
    },
    syncDeletion: { create: async () => ({}), createMany: async () => ({}) },
    noteShare: { deleteMany: async () => ({}), updateMany: async () => ({}) },
  };
  app.decorate("prisma", prismaStub as never);

  // Stub auth — same shape as identity helpers.
  const user = opts.user ?? null;
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
