import { describe, it, expect } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { prisma } from "../../../prisma.js";
import { backfillFolders } from "../folders-backfill.js";

describe("folders-backfill", () => {
  it("creates folder rows for existing directories", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kbf-"));
    await fs.mkdir(path.join(tmp, "u-bf", "alpha", "beta"), { recursive: true });
    await fs.writeFile(path.join(tmp, "u-bf", "alpha", "x.md"), "");

    await prisma.folder.deleteMany({ where: { userId: "u-bf" } });
    await prisma.syncCursor.deleteMany({ where: { userId: "u-bf" } });
    await prisma.user.deleteMany({ where: { id: "u-bf" } });
    await prisma.user.create({ data: { id: "u-bf", email: "bf@example.com", name: "Backfill Test" } });

    await backfillFolders(tmp, "u-bf");

    const rows = await prisma.folder.findMany({ where: { userId: "u-bf" }, orderBy: { path: "asc" } });
    expect(rows.map(r => r.path)).toEqual(["alpha", "alpha/beta"]);
  });
});
