import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { AgentService } from "./services/agent.service.js";
import { agentsRoutes } from "./routes/agents.routes.js";
import { agentsOnlineRoutes } from "./routes/agents-online.routes.js";
import { sseMcpRoutes, streamableMcpRoutes } from "./mcp/server.js";

declare module "fastify" {
  interface FastifyInstance {
    agents: {
      service: AgentService;
    };
  }
}

const agentsModuleImpl: FastifyPluginAsync = async (app) => {
  const agentService = new AgentService(app);
  app.decorate("agents", { service: agentService });

  await app.register(agentsRoutes({ agentService }), { prefix: "/api/agents" });
  // Live MCP-session indicators for the sidebar agents-online footer.
  await app.register(agentsOnlineRoutes, { prefix: "/api/agents" });
  // MCP transports — Streamable HTTP + SSE share /api/mcp.
  // Streamable HTTP owns POST/GET/DELETE on the bare prefix; SSE adds
  // GET /sse and POST /messages.
  await app.register(streamableMcpRoutes, { prefix: "/api/mcp" });
  await app.register(sseMcpRoutes, { prefix: "/api/mcp" });
};

/**
 * Agents module — agent CRUD, bearer token minting/revocation, and the MCP
 * (Model Context Protocol) HTTP transport.
 *
 * Routes:
 *   - /api/agents/*   — session-authenticated agent management
 *   - /api/mcp        — Personal Access Token authenticated MCP transport
 *
 * Wrapped with `fastify-plugin` so `app.agents.service` is visible to
 * siblings (notably `plugins/auth.ts` for agent-token validation).
 */
export const agentsModule: FastifyPluginAsync = fp(agentsModuleImpl, {
  name: "agents-module",
});
