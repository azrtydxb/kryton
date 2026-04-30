import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../../../prisma.js";
import { backfillTags } from "../tags-backfill.js";

describe("tags-backfill", () => {
  beforeEach(async () => {
    await prisma.noteTag.deleteMany({ where: { userId: "u-tg" } });
    await prisma.tag.deleteMany({ where: { userId: "u-tg" } });
    await prisma.searchIndex.deleteMany({ where: { userId: "u-tg" } });
    await prisma.syncCursor.deleteMany({ where: { userId: "u-tg" } });
    await prisma.user.deleteMany({ where: { id: "u-tg" } });
    await prisma.user.create({ data: { id: "u-tg", email: "tg@example.com", name: "Tag Backfill" } });
  });

  it("creates tags + NoteTag rows from SearchIndex", async () => {
    // SearchIndex.tags is stored as JSON array string
    await prisma.searchIndex.create({
      data: { notePath: "p1", userId: "u-tg", title: "t", content: "", tags: JSON.stringify(["urgent", "review"]), modifiedAt: new Date() },
    });
    await prisma.searchIndex.create({
      data: { notePath: "p2", userId: "u-tg", title: "t", content: "", tags: JSON.stringify(["urgent"]), modifiedAt: new Date() },
    });
    await backfillTags("u-tg");
    const tags = await prisma.tag.findMany({ where: { userId: "u-tg" } });
    expect(tags.map(t => t.name).sort()).toEqual(["review", "urgent"]);
    const links = await prisma.noteTag.findMany({ where: { userId: "u-tg" } });
    expect(links).toHaveLength(3);
  });
});
