import type { PrismaClient } from "../../../generated/prisma/client.js";

export class ShareService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Check whether `requestingUserId` has read/write access to a specific
   * note owned by `ownerUserId` at the given `path`.
   */
  async hasAccess(
    ownerUserId: string,
    path: string,
    requestingUserId: string,
  ): Promise<{ canRead: boolean; canWrite: boolean }> {
    const directShare = await this.prisma.noteShare.findFirst({
      where: {
        ownerUserId,
        sharedWithUserId: requestingUserId,
        path,
        isFolder: false,
      },
    });

    const folderShares = await this.prisma.noteShare.findMany({
      where: {
        ownerUserId,
        sharedWithUserId: requestingUserId,
        isFolder: true,
      },
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
    const shares = await this.prisma.noteShare.findMany({
      where: { sharedWithUserId: userId },
      include: { owner: { select: { name: true } } },
    });

    return shares.map((share) => ({
      id: share.id,
      ownerUserId: share.ownerUserId,
      ownerName: share.owner?.name ?? "",
      path: share.path,
      isFolder: share.isFolder,
      permission: share.permission,
    }));
  }

  /**
   * Expand all shares for `userId` into individual note paths, suitable
   * for filtering the knowledge graph.
   */
  async getAccessibleSharedPaths(
    userId: string,
  ): Promise<Array<{ ownerUserId: string; notePath: string; permission: string }>> {
    const shares = await this.prisma.noteShare.findMany({
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
        const notesInFolder = await this.prisma.searchIndex.findMany({
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
}
