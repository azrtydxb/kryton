import type { FastifyInstance } from "fastify";

/**
 * Resolve the set of (ownerUserId, notePath) entries the given user can read
 * via shares. File shares map to a single path; folder shares are expanded by
 * looking up notes within the folder via SearchIndex.
 *
 * NOTE: This duplicates logic from the legacy `services/shareService.ts`
 * `getAccessibleSharedPaths` function. Once the collab module is ported, this
 * helper should be replaced with a call to `app.collab.getAccessibleSharedPaths`.
 */
export async function getAccessibleSharedPaths(
  app: FastifyInstance,
  userId: string,
): Promise<Array<{ ownerUserId: string; notePath: string; permission: string }>> {
  const shares = await app.prisma.noteShare.findMany({
    where: { sharedWithUserId: userId },
  });

  const paths: Array<{ ownerUserId: string; notePath: string; permission: string }> = [];

  for (const share of shares) {
    if (!share.isFolder) {
      paths.push({
        ownerUserId: share.ownerUserId,
        notePath: share.path,
        permission: share.permission,
      });
    } else {
      const notesInFolder = await app.prisma.searchIndex.findMany({
        where: {
          userId: share.ownerUserId,
          notePath: { startsWith: share.path + "/" },
        },
      });
      for (const note of notesInFolder) {
        paths.push({
          ownerUserId: share.ownerUserId,
          notePath: note.notePath,
          permission: share.permission,
        });
      }
    }
  }

  return paths;
}
