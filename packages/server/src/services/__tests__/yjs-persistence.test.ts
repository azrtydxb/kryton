import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";
import { prisma } from "../../prisma.js";
import { loadYjsDoc, saveYjsSnapshot, appendYjsUpdate } from "../yjs-persistence.js";

describe("yjs-persistence", () => {
  beforeEach(async () => {
    await prisma.yjsUpdate.deleteMany();
    await prisma.yjsDocument.deleteMany();
    await prisma.user.deleteMany({ where: { id: "u-y" } });
    await prisma.user.create({ data: { id: "u-y", email: "y@example.com", name: "Yjs User" } });
  });

  it("save snapshot and load round-trip", async () => {
    const doc = new Y.Doc();
    doc.getText("body").insert(0, "hi");
    await saveYjsSnapshot("d1", "u-y", doc);

    const loaded = await loadYjsDoc("d1", "u-y");
    expect(loaded).not.toBeNull();
    expect(loaded!.getText("body").toString()).toBe("hi");
  });

  it("returns null for unknown docId", async () => {
    const result = await loadYjsDoc("nonexistent", "u-y");
    expect(result).toBeNull();
  });

  it("returns null when userId does not match", async () => {
    const doc = new Y.Doc();
    doc.getText("body").insert(0, "secret");
    await saveYjsSnapshot("d2", "u-y", doc);

    const result = await loadYjsDoc("d2", "other-user");
    expect(result).toBeNull();
  });

  it("append updates, then snapshot compacts them", async () => {
    const doc = new Y.Doc();
    doc.getText("body").insert(0, "a");
    await saveYjsSnapshot("d3", "u-y", doc);

    const u = Y.encodeStateAsUpdate(doc);
    await appendYjsUpdate("d3", u, null);
    expect(await prisma.yjsUpdate.count({ where: { docId: "d3" } })).toBe(1);

    await saveYjsSnapshot("d3", "u-y", doc); // re-snapshot compacts
    expect(await prisma.yjsUpdate.count({ where: { docId: "d3" } })).toBe(0);
  });

  it("applies pending updates when loading", async () => {
    const doc = new Y.Doc();
    doc.getText("body").insert(0, "base");
    await saveYjsSnapshot("d4", "u-y", doc);

    // Simulate a second client's update stored in the log
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc));
    doc2.getText("body").insert(4, " updated");
    const update = Y.encodeStateAsUpdate(doc2, Y.encodeStateVector(doc));
    await appendYjsUpdate("d4", update, null);

    const loaded = await loadYjsDoc("d4", "u-y");
    expect(loaded!.getText("body").toString()).toBe("base updated");
  });

  it("appendYjsUpdate stores agentId", async () => {
    const doc = new Y.Doc();
    await saveYjsSnapshot("d5", "u-y", doc);
    await appendYjsUpdate("d5", new Uint8Array([1, 2, 3]), "agent-42");
    const rows = await prisma.yjsUpdate.findMany({ where: { docId: "d5" } });
    expect(rows[0].agentId).toBe("agent-42");
  });
});
