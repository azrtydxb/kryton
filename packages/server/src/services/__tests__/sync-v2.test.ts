import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { prisma } from "../../prisma.js";
import { pullChanges, pushChanges } from "../sync-v2.js";
import { createFolder } from "../folder.js";

// ---------------------------------------------------------------------------
// Pull tests (SRV-14)
// ---------------------------------------------------------------------------

describe("sync-v2 pull", () => {
  beforeEach(async () => {
    await prisma.noteTag.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.syncCursor.deleteMany();
    await prisma.user.deleteMany({ where: { id: "u-sp" } });
    await prisma.user.create({ data: { id: "u-sp", email: "sp@example.com", name: "Pull User" } });
  });

  it("returns folders created after cursor", async () => {
    await createFolder("u-sp", { path: "a" });
    const fst = await pullChanges("u-sp", 0n);
    expect(fst.changes.folders.created).toHaveLength(1);

    await createFolder("u-sp", { path: "b" });
    const snd = await pullChanges("u-sp", BigInt(fst.cursor));
    expect(snd.changes.folders.created).toHaveLength(1);
    expect((snd.changes.folders.created[0] as { path: string }).path).toBe("b");
  });

  it("returns empty changes for new user with cursor 0", async () => {
    const result = await pullChanges("u-sp", 0n);
    expect(result.cursor).toBe("0");
    expect(result.changes.folders.created).toHaveLength(0);
    expect(result.changes.tags.created).toHaveLength(0);
    expect(result.changes.notes.created).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Push tests (SRV-15)
// ---------------------------------------------------------------------------

describe("sync-v2 push", () => {
  beforeEach(async () => {
    await prisma.noteTag.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.syncCursor.deleteMany();
    await prisma.user.deleteMany({ where: { id: "u-pp" } });
    await prisma.user.create({ data: { id: "u-pp", email: "pp@example.com", name: "Push User" } });
  });

  it("creates a new folder via push", async () => {
    const r = await pushChanges("u-pp", {
      folders: [{ op: "create", id: "f1", fields: { id: "f1", path: "alpha", parentId: null } }],
    });
    expect(r.accepted.folders).toHaveLength(1);
    expect(r.conflicts).toHaveLength(0);
    const all = await prisma.folder.findMany({ where: { userId: "u-pp" } });
    expect(all).toHaveLength(1);
  });

  it("rejects update with stale base_version", async () => {
    const f = await createFolder("u-pp", { path: "a" });
    const r = await pushChanges("u-pp", {
      folders: [{ op: "update", id: f.id, base_version: 999, fields: { path: "renamed" } }],
    });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].current_version).toBe(f.version);
  });

  it("deletes a folder via push", async () => {
    const f = await createFolder("u-pp", { path: "to-delete" });
    const r = await pushChanges("u-pp", {
      folders: [{ op: "delete", id: f.id }],
    });
    expect(r.accepted.folders).toHaveLength(1);
    const remaining = await prisma.folder.findMany({ where: { userId: "u-pp" } });
    expect(remaining).toHaveLength(0);
  });

  it("creates a tag via push", async () => {
    const r = await pushChanges("u-pp", {
      tags: [{ op: "create", id: "t1", fields: { id: "t1", name: "urgent", color: null } }],
    });
    expect(r.accepted.tags).toHaveLength(1);
    const tags = await prisma.tag.findMany({ where: { userId: "u-pp" } });
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe("urgent");
  });
});

// ---------------------------------------------------------------------------
// Notes push tests (SRV-16)
// ---------------------------------------------------------------------------

describe("sync-v2 notes push", () => {
  let notesRoot: string;

  beforeEach(async () => {
    notesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kn-"));
    process.env.NOTES_DIR = notesRoot;
    await prisma.searchIndex.deleteMany();
    await prisma.noteVersion.deleteMany();
    await prisma.syncCursor.deleteMany();
    await prisma.user.deleteMany({ where: { id: "u-np" } });
    await prisma.user.create({ data: { id: "u-np", email: "np@example.com", name: "Notes User" } });
  });

  it("creates a note, writes file, indexes", async () => {
    const r = await pushChanges("u-np", {
      notes: [{
        op: "create",
        id: "p1.md",
        fields: { path: "p1.md", title: "T", content: "Hello", tags: "[]", modifiedAt: 0 },
      }],
    });
    expect(r.accepted.notes).toHaveLength(1);
    const file = await fs.readFile(path.join(notesRoot, "u-np", "p1.md"), "utf-8");
    expect(file).toBe("Hello");
    const idx = await prisma.searchIndex.findFirst({ where: { userId: "u-np", notePath: "p1.md" } });
    expect(idx?.title).toBe("T");
  });

  it("merges tags server-side", async () => {
    await pushChanges("u-np", {
      notes: [{
        op: "create",
        id: "p1.md",
        fields: { path: "p1.md", title: "T", content: "v1", tags: '["a"]', modifiedAt: 0 },
      }],
    });
    const r = await pushChanges("u-np", {
      notes: [{
        op: "update",
        id: "p1.md",
        base_version: 1,
        fields: { path: "p1.md", title: "T", content: "v2", tags: '["b"]', modifiedAt: 0 },
      }],
    });
    expect(r.accepted.notes[0].merged_value?.tags).toContain("a");
    expect(r.accepted.notes[0].merged_value?.tags).toContain("b");
  });

  it("deletes a note removes file and index", async () => {
    await pushChanges("u-np", {
      notes: [{
        op: "create",
        id: "del.md",
        fields: { path: "del.md", title: "Del", content: "bye", tags: "[]", modifiedAt: 0 },
      }],
    });
    const r = await pushChanges("u-np", {
      notes: [{ op: "delete", id: "del.md" }],
    });
    expect(r.accepted.notes[0].id).toBe("del.md");
    const fileExists = await fs.stat(path.join(notesRoot, "u-np", "del.md")).catch(() => null);
    expect(fileExists).toBeNull();
  });
});
