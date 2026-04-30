import { prisma } from "../prisma.js";

export async function incrementCursor(userId: string): Promise<bigint> {
  const result = await prisma.syncCursor.upsert({
    where: { userId },
    update: { cursor: { increment: 1n } },
    create: { userId, cursor: 1n },
  });
  return result.cursor;
}

export async function getCursor(userId: string): Promise<bigint> {
  const r = await prisma.syncCursor.findUnique({ where: { userId } });
  return r?.cursor ?? 0n;
}
