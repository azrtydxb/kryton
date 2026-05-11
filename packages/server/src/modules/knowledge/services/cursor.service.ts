import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { syncCursor } from "../../../db/schema/sync.js";

/**
 * Sync cursor helper — manages the per-user monotonic cursor used by
 * the sync protocol. Receives the Fastify instance via constructor.
 */
export class CursorService {
  constructor(private readonly app: FastifyInstance) {}

  async increment(userId: string): Promise<bigint> {
    const [result] = await this.app.db
      .insert(syncCursor)
      .values({ userId, cursor: 1n })
      .onConflictDoUpdate({
        target: syncCursor.userId,
        set: { cursor: sql`${syncCursor.cursor} + 1` },
      })
      .returning();
    return result.cursor;
  }

  async get(userId: string): Promise<bigint> {
    const r = await this.app.db.query.syncCursor.findFirst({
      where: eq(syncCursor.userId, userId),
    });
    return r?.cursor ?? 0n;
  }
}
