/**
 * Shared MCP auth — Personal Access Token (kryton_*) bearer.
 *
 * Used by every MCP transport (Streamable HTTP, SSE, future stdio-via-
 * remote). Resolves to the owning user; rejects disabled accounts.
 */
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { user as userTable } from "../../../db/schema/auth.js";
import { agent as agentTable } from "../../../db/schema/agents.js";

export interface McpAuthContext {
  userId: string;
  scope: string;
  rawKey: string;
  userRole: string;
  /** Bound agent for this API key, if any — used to attribute MCP writes. */
  agentId: string | null;
  agentName: string | null;
}

/**
 * Authenticate an MCP request. Returns null and writes a 401/403 reply
 * if the bearer is missing or invalid; the caller should `return` early.
 */
export async function authenticateMcpRequest(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<McpAuthContext | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer kryton_")) {
    void reply.status(401).send({ error: "API key required for MCP access" });
    return null;
  }
  const rawKey = authHeader.slice(7);
  const keyData = await app.identity.apiKey.validate(rawKey);
  if (!keyData) {
    void reply.status(401).send({ error: "Invalid or expired API key" });
    return null;
  }
  const user = await app.db.query.user.findFirst({
    where: eq(userTable.id, keyData.userId),
    columns: { id: true, role: true, disabled: true },
  });
  if (!user) {
    void reply.status(401).send({ error: "User not found" });
    return null;
  }
  if (user.disabled) {
    void reply.status(403).send({ error: "Account is disabled" });
    return null;
  }
  let agentName: string | null = null;
  if (keyData.agentId) {
    const a = await app.db.query.agent.findFirst({
      where: eq(agentTable.id, keyData.agentId),
      columns: { label: true, name: true },
    });
    agentName = a?.label ?? a?.name ?? null;
  }

  return {
    userId: user.id,
    scope: keyData.scope,
    rawKey,
    userRole: user.role,
    agentId: keyData.agentId,
    agentName,
  };
}
