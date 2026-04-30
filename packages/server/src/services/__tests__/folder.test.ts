import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../../prisma.js";
import { createFolder, listFolders, deleteFolder } from "../folder.js";

describe("folder service", () => {
  let userId: string;
  beforeEach(async () => {
    await prisma.folder.deleteMany();
    await prisma.syncCursor.deleteMany();
    await prisma.user.deleteMany({ where: { email: "fold-test@example.com" } });
    const user = await prisma.user.create({ data: { id: "u-fold", email: "fold-test@example.com", name: "Fold Test" } });
    userId = user.id;
  });

  it("creates and lists folders", async () => {
    await createFolder(userId, { path: "a" });
    await createFolder(userId, { path: "a/b", parentPath: "a" });
    const all = await listFolders(userId);
    expect(all.map(f => f.path).sort()).toEqual(["a", "a/b"]);
  });

  it("delete cascades to children via recursive deletion", async () => {
    const a = await createFolder(userId, { path: "a" });
    await createFolder(userId, { path: "a/b", parentPath: "a" });
    await deleteFolder(userId, a.id);
    const remaining = await listFolders(userId);
    expect(remaining).toHaveLength(0);
  });
});
