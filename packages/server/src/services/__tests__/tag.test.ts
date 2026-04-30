import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../../prisma.js";
import { upsertTag, mergeNoteTagSet, listNoteTags } from "../tag.js";

describe("tag service", () => {
  let userId: string;
  beforeEach(async () => {
    await prisma.noteTag.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.syncCursor.deleteMany();
    await prisma.user.deleteMany({ where: { email: "tag-test@example.com" } });
    const user = await prisma.user.create({ data: { id: "u-tag", email: "tag-test@example.com", name: "Tag Test" } });
    userId = user.id;
  });

  it("upsertTag creates and finds", async () => {
    const t = await upsertTag(userId, "urgent");
    const t2 = await upsertTag(userId, "urgent");
    expect(t.id).toBe(t2.id);
  });

  it("mergeNoteTagSet computes union and applies", async () => {
    await upsertTag(userId, "a");
    await upsertTag(userId, "b");
    await mergeNoteTagSet(userId, "p1", ["a"]);
    const merged = await mergeNoteTagSet(userId, "p1", ["b"]);
    expect(merged.sort()).toEqual(["a", "b"]);
    const tags = await listNoteTags(userId, "p1");
    expect(tags.sort()).toEqual(["a", "b"]);
  });
});
