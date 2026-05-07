import Fastify, { type FastifyInstance } from "fastify";
import { zodPlugin } from "../../../plugins/zod.js";
import { errorsPlugin } from "../../../plugins/errors.js";
import { AuthError, ForbiddenError } from "../../../lib/errors.js";
import { knowledgeModule } from "../index.js";
import type { AuthApi, AuthContext, AuthUser } from "../../../plugins/auth.js";

export interface KnowledgeTestAppOptions {
  user?: AuthUser | null;
  apiKey?: { id: string; scope: string } | null;
  prisma: unknown;
}

/**
 * Build a Fastify app for knowledge tests. Stubs `app.prisma` and `app.auth`
 * so the routes can be exercised without a real DB or Better Auth session.
 */
export async function buildKnowledgeTestApp(
  opts: KnowledgeTestAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(zodPlugin);

  app.decorate("prisma", opts.prisma as never);

  const user = opts.user ?? null;
  const apiKey = opts.apiKey ?? null;
  const ctx: AuthContext | null = user
    ? { user, apiKey, agentId: null }
    : null;

  const authApi: AuthApi = {
    instance: {} as never,
    async resolve() {
      return ctx;
    },
    async requireUser() {
      if (!ctx) throw new AuthError("Missing or invalid session");
      return ctx.user;
    },
    async requireAuth() {
      if (!ctx) throw new AuthError("Missing or invalid session");
      return ctx;
    },
    async getOptionalUser() {
      return ctx?.user ?? null;
    },
    async requireAdmin() {
      if (!ctx) throw new AuthError("Missing or invalid session");
      if (ctx.user.role !== "admin") {
        throw new ForbiddenError("Admin access required");
      }
      return ctx.user;
    },
    requireWriteScope(c) {
      if (!c.apiKey) return;
      if (c.apiKey.scope === "read-write") return;
      throw new ForbiddenError("Insufficient API key scope — read-write access required");
    },
    requireSession(c) {
      if (c.apiKey) {
        throw new ForbiddenError("This endpoint requires browser session authentication");
      }
    },
    async authenticateWsToken() {
      return null;
    },
  };
  app.decorate("auth", authApi);

  await app.register(errorsPlugin);
  await app.register(knowledgeModule);

  await app.ready();
  return app;
}
