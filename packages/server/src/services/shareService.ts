import { prisma } from "../prisma.js";

/**
 * Check whether `requestingUserId` has read/write access to a specific
 * note owned by `ownerUserId` at the given `path`.
 */
export async function hasAccess(
  ownerUserId: string,
  path: string,
  requestingUserId: string,
): Promise<{ canRead: boolean; canWrite: boolean }> {
  // 1. Direct file share
  const directShare = await prisma.noteShare.findFirst({
    where: {
      ownerUserId,
      sharedWithUserId: requestingUserId,
      path,
      isFolder: false,
    },
  });

  // 2. Folder shares whose path is a prefix of the requested path
  const folderShares = await prisma.noteShare.findMany({
    where: {
      ownerUserId,
      sharedWithUserId: requestingUserId,
      isFolder: true,
    },
  });
  // Filter in-app: only keep folder shares where the share path is a prefix of the requested path
  const matchingFolderShares = folderShares.filter((s) => path === s.path || path.startsWith(s.path + "/"));

  // 3. Combine all matching shares
  const allShares = [...matchingFolderShares];
  if (directShare) {
    allShares.push(directShare);
  }

  if (allShares.length === 0) {
    return { canRead: false, canWrite: false };
  }

  const hasReadWrite = allShares.some((s) => s.permission === "readwrite");
  if (hasReadWrite) {
    return { canRead: true, canWrite: true };
  }

  const hasRead = allShares.some((s) => s.permission === "read");
  if (hasRead) {
    return { canRead: true, canWrite: false };
  }

  return { canRead: false, canWrite: false };
}

/**
 * Return all notes/folders that have been shared with `userId`,
 * enriched with the owner's name and email.
 */
export async function getSharedNotesForUser(
  userId: string,
): Promise<
  Array<{
    id: string;
    ownerUserId: string;
    ownerName: string;
    path: string;
    isFolder: boolean;
    permission: string;
  }>
> {
  const shares = await prisma.noteShare.findMany({
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
 * for filtering the knowledge graph.  Folder shares are expanded by
 * querying the owner's SearchIndex.
 */
export async function getAccessibleSharedPaths(
  userId: string,
): Promise<Array<{ ownerUserId: string; notePath: string; permission: string }>> {
  const shares = await prisma.noteShare.findMany({
    where: { sharedWithUserId: userId },
  });

  const paths: Array<{ ownerUserId: string; notePath: string; permission: string }> = [];

  for (const share of shares) {
    if (!share.isFolder) {
      // File share – return the exact path
      paths.push({
        ownerUserId: share.ownerUserId,
        notePath: share.path,
        permission: share.permission,
      });
    } else {
      // Folder share – expand into individual note paths via SearchIndex
      const notesInFolder = await prisma.searchIndex.findMany({
        where: {
          userId: share.ownerUserId,
          notePath: { startsWith: share.path },
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
