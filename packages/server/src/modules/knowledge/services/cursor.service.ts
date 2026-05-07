import type { FastifyInstance } from "fastify";

/**
 * Sync cursor helper — manages the per-user monotonic cursor used by
 * the sync protocol. Receives the Fastify instance via constructor.
 */
export class CursorService {
  constructor(private readonly app: FastifyInstance) {}

  async increment(userId: string): Promise<bigint> {
    const result = await this.app.prisma.syncCursor.upsert({
      where: { userId },
      update: { cursor: { increment: 1n } },
      create: { userId, cursor: 1n },
    });
    return result.cursor;
  }

  async get(userId: string): Promise<bigint> {
    const r = await this.app.prisma.syncCursor.findUnique({ where: { userId } });
    return r?.cursor ?? 0n;
  }
}
