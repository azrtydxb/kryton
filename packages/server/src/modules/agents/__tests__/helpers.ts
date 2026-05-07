import Fastify, { type FastifyInstance } from "fastify";
import { zodPlugin } from "../../../plugins/zod.js";
import { errorsPlugin } from "../../../plugins/errors.js";
import { AuthError, ForbiddenError } from "../../../lib/errors.js";
import { agentsRoutes } from "../routes/agents.routes.js";
import { AgentService } from "../services/agent.service.js";
import type { AuthApi, AuthContext, AuthUser } from "../../../plugins/auth.js";

export interface AgentsTestAppOptions {
  /** The user returned by auth helpers. Set to null to simulate anonymous. */
  user?: AuthUser | null;
  /** Inline prisma stub. Provide just the methods used by the routes under test. */
  prisma: unknown;
}

/**
 * Build a Fastify app with the agents routes wired in, but with `app.prisma`
 * and `app.auth` stubbed. This avoids the need for a real DB or Better Auth
 * session in unit tests.
 */
export async function buildAgentsTestApp(
  opts: AgentsTestAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(zodPlugin);

  app.decorate("prisma", opts.prisma as never);

  const user = opts.user ?? null;
  const ctx: AuthContext | null = user
    ? { user, apiKey: null, agentId: null }
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

  const agentService = new AgentService(app);
  await app.register(agentsRoutes({ agentService }), { prefix: "/api/agents" });

  await app.ready();
  return app;
}
