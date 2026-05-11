import type { FastifyInstance } from "fastify";
import { and, eq, like } from "drizzle-orm";
import { noteShare } from "../../../db/schema/sharing.js";
import { searchIndex } from "../../../db/schema/notes.js";

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
  const shares = await app.db.query.noteShare.findMany({
    where: eq(noteShare.sharedWithUserId, userId),
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
      const notesInFolder = await app.db.query.searchIndex.findMany({
        where: and(
          eq(searchIndex.userId, share.ownerUserId),
          like(searchIndex.notePath, `${share.path}/%`),
        ),
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
