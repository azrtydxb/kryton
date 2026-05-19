import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { zodPlugin } from "../../../plugins/zod.js";
import { errorsPlugin } from "../../../plugins/errors.js";
import { notesModule } from "../../notes/index.js";
import { user as userTable } from "../../../db/schema/auth.js";
import { createTestDb, type TestDbHandle } from "../../../test/db-fixture.js";
import type { AuthApi, AuthContext, AuthUser } from "../../../plugins/auth.js";
import { PluginEventBus } from "../services/event-bus.js";
import { PluginStorageService } from "../services/storage.service.js";
import { builtinNotesRoutes } from "../routes/builtin-notes.routes.js";
import { builtinStorageRoutes } from "../routes/builtin-storage.routes.js";

let sharedHandle: TestDbHandle | null = null;
function getHandle(): TestDbHandle {
  if (!sharedHandle) sharedHandle = createTestDb();
  return sharedHandle;
}

export function createBuiltinTestUser(tag: string = "plugbuiltin"): AuthUser {
  const rand = Math.floor(Math.random() * 1e9);
  return {
    id: `u-${tag}-${rand}-${process.pid}`,
    email: `${tag}-${rand}-${process.pid}@test.local`,
    name: tag,
    role: "user",
  };
}

export async function seedBuiltinTestUser(user: AuthUser): Promise<void> {
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

export async function cleanupBuiltinTestUser(userId: string): Promise<void> {
  const handle = getHandle();
  await handle.db.delete(userTable).where(eq(userTable.id, userId));
}

export interface BuiltinTestApp {
  app: FastifyInstance;
  notesDir: string;
  eventBus: PluginEventBus;
  cleanup: () => Promise<void>;
}

export interface BuiltinTestAppOptions {
  user?: AuthUser | null;
  notesDir?: string;
}

export async function buildBuiltinTestApp(
  opts: BuiltinTestAppOptions = {},
): Promise<BuiltinTestApp> {
  const notesDir =
    opts.notesDir ??
    (await fs.mkdtemp(path.join(os.tmpdir(), "kryton-plugin-builtin-")));

  const handle = getHandle();
  const user = opts.user ?? null;

  const app = Fastify({ logger: false });
  app.decorate("config", { NOTES_DIR: notesDir } as never);
  await app.register(zodPlugin);
  app.decorate("db", handle.db);

  const ctx: AuthContext | null = user
    ? { user, apiKey: null, agentId: null }
    : null;

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
      return ctx.user;
    },
    requireWriteScope() {},
    requireSession() {},
    async authenticateWsToken() {
      return null;
    },
  };
  app.decorate("auth", authApi);

  await app.register(errorsPlugin);
  await app.register(notesModule);

  const eventBus = new PluginEventBus();
  const storage = new PluginStorageService(handle.db);

  await app.register(
    builtinNotesRoutes({
      notesDir,
      notesOps: app.noteService,
      eventBus,
    }),
    { prefix: "/api/plugin-builtin/notes" },
  );
  await app.register(
    builtinStorageRoutes({ storage }),
    { prefix: "/api/plugin-builtin/storage" },
  );

  await app.ready();

  return {
    app,
    notesDir,
    eventBus,
    cleanup: async () => {
      await app.close();
      if (!opts.notesDir) {
        await fs.rm(notesDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}
