import { and, eq, like } from "drizzle-orm";
import type { Db } from "../../../db/client.js";
import { noteShare } from "../../../db/schema/sharing.js";
import { searchIndex } from "../../../db/schema/notes.js";
import { user } from "../../../db/schema/auth.js";

export class ShareService {
  constructor(private readonly db: Db) {}

  /**
   * Check whether `requestingUserId` has read/write access to a specific
   * note owned by `ownerUserId` at the given `path`.
   */
  async hasAccess(
    ownerUserId: string,
    path: string,
    requestingUserId: string,
  ): Promise<{ canRead: boolean; canWrite: boolean }> {
    const directShare = await this.db.query.noteShare.findFirst({
      where: and(
        eq(noteShare.ownerUserId, ownerUserId),
        eq(noteShare.sharedWithUserId, requestingUserId),
        eq(noteShare.path, path),
        eq(noteShare.isFolder, false),
      ),
    });

    const folderShares = await this.db.query.noteShare.findMany({
      where: and(
        eq(noteShare.ownerUserId, ownerUserId),
        eq(noteShare.sharedWithUserId, requestingUserId),
        eq(noteShare.isFolder, true),
      ),
    });
    const matchingFolderShares = folderShares.filter(
      (s) => path === s.path || path.startsWith(s.path + "/"),
    );

    const allShares = [...matchingFolderShares];
    if (directShare) allShares.push(directShare);

    if (allShares.length === 0) return { canRead: false, canWrite: false };

    if (allShares.some((s) => s.permission === "readwrite")) {
      return { canRead: true, canWrite: true };
    }
    if (allShares.some((s) => s.permission === "read")) {
      return { canRead: true, canWrite: false };
    }
    return { canRead: false, canWrite: false };
  }

  /**
   * Return all notes/folders that have been shared with `userId`,
   * enriched with the owner's name.
   */
  async getSharedNotesForUser(userId: string): Promise<
    Array<{
      id: string;
      ownerUserId: string;
      ownerName: string;
      path: string;
      isFolder: boolean;
      permission: string;
    }>
  > {
    const rows = await this.db
      .select({
        id: noteShare.id,
        ownerUserId: noteShare.ownerUserId,
        path: noteShare.path,
        isFolder: noteShare.isFolder,
        permission: noteShare.permission,
        ownerName: user.name,
      })
      .from(noteShare)
      .leftJoin(user, eq(user.id, noteShare.ownerUserId))
      .where(eq(noteShare.sharedWithUserId, userId));

    return rows.map((r) => ({
      id: r.id,
      ownerUserId: r.ownerUserId,
      ownerName: r.ownerName ?? "",
      path: r.path,
      isFolder: r.isFolder,
      permission: r.permission,
    }));
  }

  /**
   * Expand all shares for `userId` into individual note paths, suitable
   * for filtering the knowledge graph.
   */
  async getAccessibleSharedPaths(
    userId: string,
  ): Promise<Array<{ ownerUserId: string; notePath: string; permission: string }>> {
    const shares = await this.db.query.noteShare.findMany({
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
        const notesInFolder = await this.db.query.searchIndex.findMany({
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
}
