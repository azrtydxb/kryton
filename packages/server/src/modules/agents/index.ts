import type { FastifyPluginAsync } from "fastify";
import { AgentService } from "./services/agent.service.js";
import { agentsRoutes } from "./routes/agents.routes.js";
import { mcpRoutes } from "./mcp/server.js";

/**
 * Agents module — agent CRUD, bearer token minting/revocation, and the MCP
 * (Model Context Protocol) HTTP transport.
 *
 * Routes:
 *   - /api/agents/*   — session-authenticated agent management
 *   - /api/mcp        — Personal Access Token authenticated MCP transport
 */
export const agentsModule: FastifyPluginAsync = async (app) => {
  const agentService = new AgentService(app);

  await app.register(agentsRoutes({ agentService }), { prefix: "/api/agents" });
  await app.register(mcpRoutes, { prefix: "/api/mcp" });
};
