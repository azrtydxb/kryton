/**
 * Drop SearchIndex rows whose underlying .md file no longer exists on disk.
 * Without this, deleting a note out-of-band (filesystem rm, dev worktree
 * pointing at a different notes/ root, etc.) leaves phantom graph nodes
 * and tag entries that never go away — the user sees "6 graph nodes" when
 * their tree only has 2.
 *
 * Cheap to run: one Prisma read per user (their searchIndex rows), one
 * fs.stat per row, then a single deleteMany. Called once per user per
 * process from `ensureBackfilled`.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FastifyInstance } from "fastify";

export async function reconcileSearchIndex(
  app: FastifyInstance,
  notesRoot: string,
  userId: string,
): Promise<number> {
  const userRoot = path.join(notesRoot, userId);
  let exists = false;
  try {
    const s = await fs.stat(userRoot);
    exists = s.isDirectory();
  } catch {
    // User dir missing; treat every searchIndex row as stale.
  }

  const rows = await app.prisma.searchIndex.findMany({
    where: { userId },
    select: { notePath: true },
  });
  if (rows.length === 0) return 0;

  // If the user has no notes dir at all, drop every row.
  if (!exists) {
    await app.prisma.searchIndex.deleteMany({ where: { userId } });
    // Mirror onto graphEdge so half-pruned graphs don't carry stale edges.
    await app.prisma.graphEdge.deleteMany({ where: { userId } });
    return rows.length;
  }

  const stale: string[] = [];
  for (const r of rows) {
    const full = path.join(userRoot, r.notePath);
    try {
      await fs.stat(full);
    } catch {
      stale.push(r.notePath);
    }
  }
  if (stale.length === 0) return 0;

  // Delete in one round-trip. graphEdge rows reference notePath via
  // fromPath/toPath; clear the stale endpoints there too so the graph
  // doesn't render dangling edges.
  await app.prisma.$transaction([
    app.prisma.searchIndex.deleteMany({
      where: { userId, notePath: { in: stale } },
    }),
    app.prisma.graphEdge.deleteMany({
      where: { userId, OR: [{ fromPath: { in: stale } }, { toPath: { in: stale } }] },
    }),
  ]);

  app.log.info(
    { userId, removed: stale.length },
    "reconciled stale searchIndex rows against disk",
  );
  return stale.length;
}
