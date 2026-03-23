import { AppDataSource } from "../data-source";
import { NoteShare } from "../entities/NoteShare";
import { SearchIndex } from "../entities/SearchIndex";
import { User } from "../entities/User";

/**
 * Check whether `requestingUserId` has read/write access to a specific
 * note owned by `ownerUserId` at the given `path`.
 */
export async function hasAccess(
  ownerUserId: string,
  path: string,
  requestingUserId: string,
): Promise<{ canRead: boolean; canWrite: boolean }> {
  const repo = AppDataSource.getRepository(NoteShare);

  // 1. Direct file share
  const directShare = await repo.findOne({
    where: {
      ownerUserId,
      sharedWithUserId: requestingUserId,
      path,
      isFolder: false,
    },
  });

  // 2. Folder shares whose path is a prefix of the requested path
  const folderShares = await repo
    .createQueryBuilder("s")
    .where("s.ownerUserId = :ownerUserId", { ownerUserId })
    .andWhere("s.sharedWithUserId = :requestingUserId", { requestingUserId })
    .andWhere("s.isFolder = true")
    .andWhere("POSITION(s.path IN :path) = 1", { path })
    .getMany();

  // 3. Combine all matching shares
  const allShares: NoteShare[] = [...folderShares];
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
  const repo = AppDataSource.getRepository(NoteShare);

  const result = await repo
    .createQueryBuilder("s")
    .leftJoin(User, "u", "u.id::text = s.ownerUserId")
    .addSelect("u.name", "ownerName")
    .addSelect("u.email", "ownerEmail")
    .where("s.sharedWithUserId = :userId", { userId })
    .getRawAndEntities();

  return result.entities.map((entity, i) => ({
    id: entity.id,
    ownerUserId: entity.ownerUserId,
    ownerName: (result.raw[i]?.ownerName as string) ?? "",
    path: entity.path,
    isFolder: entity.isFolder,
    permission: entity.permission,
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
  const shareRepo = AppDataSource.getRepository(NoteShare);
  const searchRepo = AppDataSource.getRepository(SearchIndex);

  const shares = await shareRepo.find({
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
      const notesInFolder = await searchRepo
        .createQueryBuilder("si")
        .where("si.userId = :ownerUserId", { ownerUserId: share.ownerUserId })
        .andWhere("POSITION(:folderPath IN si.notePath) = 1", {
          folderPath: share.path,
        })
        .getMany();

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
