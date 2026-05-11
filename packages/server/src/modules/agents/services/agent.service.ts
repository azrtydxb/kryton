import * as crypto from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { agent, agentToken } from "../../../db/schema/agents.js";

export interface CreateAgentInput {
  name: string;
  label: string;
  policyText?: string;
}

export interface MintTokenOptions {
  expiresInSeconds: number;
  scope?: string;
}

export interface MintedToken {
  token: string;
  tokenId: string;
  expiresAt: Date;
}

export interface ValidatedToken {
  agentId: string;
  ownerUserId: string;
  tokenId: string;
}

/**
 * Agent service. Receives the Fastify instance via constructor and uses
 * `app.db` (Drizzle) for all DB access — no module-level Drizzle singleton.
 */
export class AgentService {
  constructor(private readonly app: FastifyInstance) {}

  private get db() {
    return this.app.db;
  }

  /** Create a new agent owned by the given user. */
  async create(ownerUserId: string, input: CreateAgentInput) {
    const [row] = await this.db
      .insert(agent)
      .values({
        ownerUserId,
        name: input.name,
        label: input.label,
        policyText: input.policyText ?? null,
      })
      .returning();
    return row;
  }

  /** Replace the Cedar policy text for an agent. */
  async setPolicy(agentId: string, policyText: string) {
    const [row] = await this.db
      .update(agent)
      .set({ policyText })
      .where(eq(agent.id, agentId))
      .returning();
    return row;
  }

  /** Mint a new bearer token for the agent. Returns the raw token (shown once). */
  async mintToken(agentId: string, opts: MintTokenOptions): Promise<MintedToken> {
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + opts.expiresInSeconds * 1000);

    const [row] = await this.db
      .insert(agentToken)
      .values({
        agentId,
        tokenHash,
        scope: opts.scope ?? null,
        expiresAt,
      })
      .returning();

    return { token, tokenId: row.id, expiresAt };
  }

  /**
   * Validate a raw bearer token.
   * Returns agent+owner info if valid; null if not found, revoked, or expired.
   */
  async validateToken(token: string): Promise<ValidatedToken | null> {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const t = await this.db.query.agentToken.findFirst({
      where: and(
        eq(agentToken.tokenHash, tokenHash),
        isNull(agentToken.revokedAt),
        gt(agentToken.expiresAt, new Date()),
      ),
      with: { agent: true },
    });

    if (!t) return null;

    return {
      agentId: t.agentId,
      ownerUserId: t.agent.ownerUserId,
      tokenId: t.id,
    };
  }

  /** Soft-revoke a token by setting revokedAt. */
  async revokeToken(tokenId: string): Promise<void> {
    await this.db
      .update(agentToken)
      .set({ revokedAt: new Date() })
      .where(eq(agentToken.id, tokenId));
  }

  /** List all agents owned by a user. */
  async list(ownerUserId: string) {
    return this.db.query.agent.findMany({
      where: eq(agent.ownerUserId, ownerUserId),
    });
  }

  /** Permanently delete an agent and cascade its tokens. */
  async delete(agentId: string): Promise<void> {
    await this.db.delete(agent).where(eq(agent.id, agentId));
  }

  /** Find an agent by id, returning null if missing. */
  async findById(agentId: string) {
    const row = await this.db.query.agent.findFirst({
      where: eq(agent.id, agentId),
    });
    return row ?? null;
  }

  /** Find a token row by id, returning null if missing. */
  async findTokenById(tokenId: string) {
    const row = await this.db.query.agentToken.findFirst({
      where: eq(agentToken.id, tokenId),
    });
    return row ?? null;
  }
}
