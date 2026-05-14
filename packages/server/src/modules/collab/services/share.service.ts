import { and, eq, like } from "drizzle-orm";
import type { Db } from "../../../db/client.js";
import { noteShare } from "../../../db/schema/sharing.js";
import { searchIndex } from "../../../db/schema/notes.js";
import { user } from "../../../db/schema/auth.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../lib/errors.js";

export interface ShareRecord {
  id: string;
  ownerUserId: string;
  path: string;
  isFolder: boolean;
  sharedWithUserId: string;
  permission: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  "code" in err &&
  (err as { code?: string }).code === "23505";

export class ShareService {
  constructor(private readonly db: Db) {}

  /** Create a share owned by `ownerUserId`. */
  async create(
    ownerUserId: string,
    args: {
      path: string;
      sharedWithUserId: string;
      permission: "read" | "readwrite";
      isFolder?: boolean;
    },
  ): Promise<ShareRecord> {
    if (args.sharedWithUserId === ownerUserId) {
      throw new ValidationError("Cannot share with yourself");
    }
    try {
      const [saved] = await this.db
        .insert(noteShare)
        .values({
          ownerUserId,
          path: args.path,
          isFolder: args.isFolder ?? false,
          sharedWithUserId: args.sharedWithUserId,
          permission: args.permission,
        })
        .returning();
      return saved;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError("Share already exists");
      }
      throw err;
    }
  }

  /** List shares owned by `ownerUserId`. */
  async listOwned(ownerUserId: string): Promise<ShareRecord[]> {
    return this.db.query.noteShare.findMany({
      where: eq(noteShare.ownerUserId, ownerUserId),
    });
  }

  /**
   * Update an existing share's permission. The caller must be the
   * owner; otherwise ForbiddenError. Returns the updated row.
   */
  async updatePermission(
    ownerUserId: string,
    shareId: string,
    permission: "read" | "readwrite",
  ): Promise<ShareRecord> {
    const share = await this.requireOwned(ownerUserId, shareId);
    const [updated] = await this.db
      .update(noteShare)
      .set({ permission, updatedAt: new Date() })
      .where(eq(noteShare.id, share.id))
      .returning();
    return updated;
  }

  /** Revoke a share. Caller must be the owner. */
  async revoke(ownerUserId: string, shareId: string): Promise<void> {
    const share = await this.requireOwned(ownerUserId, shareId);
    await this.db.delete(noteShare).where(eq(noteShare.id, share.id));
  }

  private async requireOwned(
    ownerUserId: string,
    shareId: string,
  ): Promise<ShareRecord> {
    const share = await this.db.query.noteShare.findFirst({
      where: eq(noteShare.id, shareId),
    });
    if (!share) throw new NotFoundError("Share not found");
    if (share.ownerUserId !== ownerUserId) {
      throw new ForbiddenError("Not the owner of this share");
    }
    return share;
  }

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
