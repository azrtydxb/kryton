/**
 * MCP session persistence — durable companion to the in-memory session
 * map maintained by streamable.ts. Lets streamable-HTTP sessions survive
 * a Kryton restart without forcing the client to re-initialize.
 *
 * The in-memory map is the hot path; this store is consulted only on a
 * cold-cache miss (request arrives with an Mcp-Session-Id we don't
 * recognize). If a matching row exists and the bearer matches, the
 * transport + McpServer are rebuilt and the in-memory map is filled.
 *
 * Bearer storage: only the SHA-256 hash is persisted, so a DB leak
 * doesn't grant session takeover on its own.
 */
import { createHash } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { mcpSession } from "../../../db/schema/agents.js";

export function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export interface PersistedSession {
  id: string;
  userId: string;
  keyHash: string;
  keyScope: "read-only" | "read-write";
  createdAt: Date;
  lastActivityAt: Date;
}

export class McpSessionStore {
  constructor(private readonly app: FastifyInstance) {}

  async upsert(args: {
    id: string;
    userId: string;
    rawKey: string;
    keyScope: string;
  }): Promise<void> {
    const keyHash = hashKey(args.rawKey);
    await this.app.db
      .insert(mcpSession)
      .values({
        id: args.id,
        userId: args.userId,
        keyHash,
        keyScope: args.keyScope,
        lastActivityAt: new Date(),
      })
      .onConflictDoUpdate({
        target: mcpSession.id,
        set: { lastActivityAt: new Date(), keyHash, keyScope: args.keyScope },
      });
  }

  async touch(id: string): Promise<void> {
    await this.app.db
      .update(mcpSession)
      .set({ lastActivityAt: new Date() })
      .where(eq(mcpSession.id, id));
  }

  /**
   * Look up a session by id. Returns null if not found, expired, or
   * the supplied bearer hash doesn't match the stored one (which would
   * indicate session-id-guessing).
   */
  async findValid(
    id: string,
    rawKey: string,
    idleTimeoutMs: number,
  ): Promise<PersistedSession | null> {
    const row = await this.app.db.query.mcpSession.findFirst({
      where: eq(mcpSession.id, id),
    });
    if (!row) return null;
    const cutoff = Date.now() - idleTimeoutMs;
    if (row.lastActivityAt.getTime() < cutoff) {
      // Idle past the cutoff — sweep this row out lazily.
      await this.delete(id);
      return null;
    }
    if (row.keyHash !== hashKey(rawKey)) return null;
    return row as PersistedSession;
  }

  async delete(id: string): Promise<void> {
    await this.app.db.delete(mcpSession).where(eq(mcpSession.id, id));
  }

  /** Periodic sweep: drop rows whose last-activity is older than the cutoff. */
  async reapIdle(idleTimeoutMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - idleTimeoutMs);
    const res = await this.app.db
      .delete(mcpSession)
      .where(lt(mcpSession.lastActivityAt, cutoff))
      .returning({ id: mcpSession.id });
    return res.length;
  }

  /** Count active sessions for a user — feeds the per-user cap check. */
  async countForUser(userId: string): Promise<number> {
    const rows = await this.app.db.query.mcpSession.findMany({
      where: eq(mcpSession.userId, userId),
      columns: { id: true },
    });
    return rows.length;
  }

  /** Force-end every session bound to a (now-revoked) bearer. */
  async deleteByKey(rawKey: string): Promise<void> {
    const keyHash = hashKey(rawKey);
    await this.app.db.delete(mcpSession).where(eq(mcpSession.keyHash, keyHash));
  }

  /** Force-end every session for a user (e.g. on logout-all). */
  async deleteForUser(userId: string): Promise<void> {
    await this.app.db.delete(mcpSession).where(eq(mcpSession.userId, userId));
  }
}
