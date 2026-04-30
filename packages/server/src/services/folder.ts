import { prisma } from "../prisma.js";
import { incrementCursor } from "./cursor.js";

export async function createFolder(userId: string, input: { path: string; parentPath?: string }) {
  const cursor = await incrementCursor(userId);
  const parent = input.parentPath
    ? await prisma.folder.findUnique({ where: { userId_path: { userId, path: input.parentPath } } })
    : null;
  return prisma.folder.create({
    data: {
      userId,
      path: input.path,
      parentId: parent?.id ?? null,
      version: 1,
      cursor,
    },
  });
}

export async function listFolders(userId: string) {
  return prisma.folder.findMany({ where: { userId }, orderBy: { path: "asc" } });
}

export async function deleteFolder(userId: string, folderId: string) {
  // Recursively delete children first (SQLite self-referential FK is SET NULL, not CASCADE)
  const children = await prisma.folder.findMany({ where: { userId, parentId: folderId } });
  for (const child of children) {
    await deleteFolder(userId, child.id);
  }
  return prisma.folder.delete({ where: { id: folderId } });
}
