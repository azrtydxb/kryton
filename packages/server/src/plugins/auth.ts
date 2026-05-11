import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { createAuth, type Auth } from "../modules/identity/auth-config.js";
import { AuthError, ForbiddenError } from "../lib/errors.js";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface ApiKeyContext {
  id: string;
  scope: string;
}

export interface AuthContext {
  user: AuthUser;
  apiKey: ApiKeyContext | null;
  agentId: string | null;
}

export interface AuthApi {
  /** The Better Auth instance (for direct API access). */
  instance: Auth;
  /**
   * Resolve auth from request — checks bearer (API key, agent token), then session cookie.
   * Returns null if no valid credentials present.
   */
  resolve(request: FastifyRequest): Promise<AuthContext | null>;
  /** Resolve and require auth. Throws AuthError if missing. */
  requireUser(request: FastifyRequest): Promise<AuthUser>;
  /** Resolve and require auth context (with apiKey/agent info). Throws AuthError if missing. */
  requireAuth(request: FastifyRequest): Promise<AuthContext>;
  /** Resolve auth without throwing. Returns user or null. */
  getOptionalUser(request: FastifyRequest): Promise<AuthUser | null>;
  /** Throw if user is not admin. */
  requireAdmin(request: FastifyRequest): Promise<AuthUser>;
  /** Throw if API key scope is insufficient for write operations. */
  requireWriteScope(context: AuthContext): void;
  /** Throw if request is API-key based (some endpoints require browser session). */
  requireSession(context: AuthContext): void;
  /** Authenticate raw bearer token for WS upgrades (agent tokens). */
  authenticateWsToken(token: string): Promise<{ userId: string; agentId: string | null } | null>;
}

declare module "fastify" {
  interface FastifyInstance {
    auth: AuthApi;
  }
  interface FastifyRequest {
    authContext?: AuthContext;
  }
}

/**
 * Mounts Better Auth's catch-all handler at /api/auth/* and decorates the
 * Fastify instance with auth helpers.
 */
export const authPlugin = fp(async (app) => {
  if (!app.db) {
    throw new Error(
      "authPlugin requires app.db (Drizzle). Set POSTGRES_URL so dbPlugin initialises before authPlugin.",
    );
  }
  const auth = createAuth(app.db);

  const api: AuthApi = {
    instance: auth,

    async resolve(request) {
      // Cache per request
      if (request.authContext) return request.authContext;

      const authHeader = request.headers.authorization;
      const prisma = app.prisma;

      // Personal Access Token (kryton_ prefix)
      if (authHeader?.startsWith("Bearer kryton_")) {
        const rawKey = authHeader.slice(7);
        const keyData = await app.identity.apiKey.validate(rawKey);
        if (!keyData) return null;

        const user = await prisma.user.findUnique({
          where: { id: keyData.userId },
          select: { id: true, email: true, name: true, role: true, disabled: true },
        });
        if (!user) return null;
        if (user.disabled) throw new ForbiddenError("Account is disabled");

        const ctx: AuthContext = {
          user: { id: user.id, email: user.email, name: user.name, role: user.role },
          apiKey: { id: keyData.keyId, scope: keyData.scope },
          agentId: null,
        };
        request.authContext = ctx;
        return ctx;
      }

      // Agent token
      if (authHeader?.startsWith("Bearer ")) {
        const rawToken = authHeader.slice(7);
        const agentValidation = await app.agents.service.validateToken(rawToken);
        if (agentValidation) {
          const owner = await prisma.user.findUnique({
            where: { id: agentValidation.ownerUserId },
            select: { id: true, email: true, name: true, role: true, disabled: true },
          });
          if (!owner) return null;
          if (owner.disabled) throw new ForbiddenError("Account is disabled");

          const ctx: AuthContext = {
            user: { id: owner.id, email: owner.email, name: owner.name, role: owner.role },
            apiKey: null,
            agentId: agentValidation.agentId,
          };
          request.authContext = ctx;
          return ctx;
        }
      }

      // Session cookie
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers as Record<string, string | string[] | undefined>),
        });
        if (!session) return null;
        if ((session.user as Record<string, unknown>).disabled) {
          throw new ForbiddenError("Account is disabled");
        }
        const ctx: AuthContext = {
          user: {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
            role: ((session.user as Record<string, unknown>).role as string) || "user",
          },
          apiKey: null,
          agentId: null,
        };
        request.authContext = ctx;
        return ctx;
      } catch {
        return null;
      }
    },

    async requireUser(request) {
      const ctx = await api.resolve(request);
      if (!ctx) throw new AuthError("Missing or invalid session");
      return ctx.user;
    },

    async requireAuth(request) {
      const ctx = await api.resolve(request);
      if (!ctx) throw new AuthError("Missing or invalid session");
      return ctx;
    },

    async getOptionalUser(request) {
      const ctx = await api.resolve(request);
      return ctx?.user ?? null;
    },

    async requireAdmin(request) {
      const user = await api.requireUser(request);
      if (user.role !== "admin") throw new ForbiddenError("Admin access required");
      return user;
    },

    requireWriteScope(context) {
      if (!context.apiKey) return; // session = full access
      if (context.apiKey.scope === "read-write") return;
      throw new ForbiddenError("Insufficient API key scope — read-write access required");
    },

    requireSession(context) {
      if (context.apiKey) {
        throw new ForbiddenError("This endpoint requires browser session authentication");
      }
    },

    async authenticateWsToken(token) {
      const agentValidation = await app.agents.service.validateToken(token);
      if (agentValidation) {
        return { userId: agentValidation.ownerUserId, agentId: agentValidation.agentId };
      }
      return null;
    },
  };

  app.decorate("auth", api);

  // Mount Better Auth catch-all. We use Fastify's raw request/response to avoid
  // body parsing conflicts.
  app.route({
    method: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    url: "/api/auth/*",
    schema: { hide: true },
    handler: async (request, reply) => {
      // Convert Fastify req to a Web Request for better-auth.handler
      const url = `${request.protocol}://${request.headers.host}${request.url}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(request.headers)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) for (const vv of v) headers.append(k, vv);
        else headers.set(k, String(v));
      }
      const init: RequestInit = {
        method: request.method,
        headers,
      };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body ? JSON.stringify(request.body) : undefined;
        if (init.body && !headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }
      }
      const webReq = new Request(url, init);
      const webRes = await auth.handler(webReq);

      reply.status(webRes.status);
      webRes.headers.forEach((value, key) => {
        reply.header(key, value);
      });
      const buf = Buffer.from(await webRes.arrayBuffer());
      reply.send(buf);
    },
  });
}, { name: "auth", dependencies: ["db", "prisma"] });
