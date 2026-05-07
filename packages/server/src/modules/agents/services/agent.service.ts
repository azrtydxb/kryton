import * as crypto from "node:crypto";
import type { FastifyInstance } from "fastify";

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
 * `app.prisma` for all DB access — no module-level Prisma singleton.
 */
export class AgentService {
  constructor(private readonly app: FastifyInstance) {}

  /** Create a new agent owned by the given user. */
  async create(ownerUserId: string, input: CreateAgentInput) {
    return this.app.prisma.agent.create({
      data: {
        ownerUserId,
        name: input.name,
        label: input.label,
        policyText: input.policyText ?? null,
      },
    });
  }

  /** Replace the Cedar policy text for an agent. */
  async setPolicy(agentId: string, policyText: string) {
    return this.app.prisma.agent.update({
      where: { id: agentId },
      data: { policyText },
    });
  }

  /** Mint a new bearer token for the agent. Returns the raw token (shown once). */
  async mintToken(agentId: string, opts: MintTokenOptions): Promise<MintedToken> {
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + opts.expiresInSeconds * 1000);

    const row = await this.app.prisma.agentToken.create({
      data: {
        agentId,
        tokenHash,
        scope: opts.scope ?? null,
        expiresAt,
      },
    });

    return { token, tokenId: row.id, expiresAt };
  }

  /**
   * Validate a raw bearer token.
   * Returns agent+owner info if valid; null if not found, revoked, or expired.
   */
  async validateToken(token: string): Promise<ValidatedToken | null> {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const t = await this.app.prisma.agentToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { agent: true },
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
    await this.app.prisma.agentToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
  }

  /** List all agents owned by a user. */
  async list(ownerUserId: string) {
    return this.app.prisma.agent.findMany({ where: { ownerUserId } });
  }

  /** Permanently delete an agent and cascade its tokens. */
  async delete(agentId: string): Promise<void> {
    await this.app.prisma.agent.delete({ where: { id: agentId } });
  }

  /** Find an agent by id, returning null if missing. */
  async findById(agentId: string) {
    return this.app.prisma.agent.findUnique({ where: { id: agentId } });
  }

  /** Find a token row by id, returning null if missing. */
  async findTokenById(tokenId: string) {
    return this.app.prisma.agentToken.findUnique({ where: { id: tokenId } });
  }
}
