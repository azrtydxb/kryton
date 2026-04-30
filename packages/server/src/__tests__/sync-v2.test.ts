import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { prisma } from "../prisma.js";
import { createSyncV2Router } from "../routes/sync-v2.js";
import { createTestApp } from "./test-app.js";
import { createFolder } from "../services/folder.js";

const TEST_USER = { id: "u-r1", email: "r1@example.com", name: "Route User", role: "user" };

function makeApp() {
  return createTestApp("/api/sync/v2", createSyncV2Router(), TEST_USER);
}

describe("/api/sync/v2", () => {
  beforeEach(async () => {
    await prisma.noteTag.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.syncCursor.deleteMany();
    await prisma.noteRevision.deleteMany();
    await prisma.user.deleteMany({ where: { id: TEST_USER.id } });
    await prisma.user.create({ data: { id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name } });
  });

  it("pull returns empty changes for new user", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/sync/v2/pull")
      .send({ cursor: "0" });
    expect(res.status).toBe(200);
    expect(res.body.cursor).toBe("0");
    expect(res.body.changes).toBeDefined();
    expect(res.body.changes.folders).toBeDefined();
  });

  it("pull returns folders after a push creates them", async () => {
    const app = makeApp();

    await request(app)
      .post("/api/sync/v2/push")
      .send({ changes: { folders: [{ op: "create", id: "f1", fields: { id: "f1", path: "inbox", parentId: null } }] } })
      .expect(200);

    const res = await request(app)
      .post("/api/sync/v2/pull")
      .send({ cursor: "0" });
    expect(res.status).toBe(200);
    expect(res.body.changes.folders.created).toHaveLength(1);
  });

  it("push returns conflicts for stale base_version", async () => {
    await createFolder(TEST_USER.id, { path: "existing" });
    const folders = await prisma.folder.findMany({ where: { userId: TEST_USER.id } });
    const folderId = folders[0].id;

    const app = makeApp();
    const res = await request(app)
      .post("/api/sync/v2/push")
      .send({ changes: { folders: [{ op: "update", id: folderId, base_version: 999, fields: { path: "renamed" } }] } });
    expect(res.status).toBe(200);
    expect(res.body.conflicts).toHaveLength(1);
  });

  it("tier2/history returns revisions", async () => {
    await prisma.noteRevision.create({
      data: { id: "rev1", userId: TEST_USER.id, notePath: "test.md", content: "v1" },
    });
    const app = makeApp();
    const res = await request(app)
      .get("/api/sync/v2/tier2/history/test.md");
    expect(res.status).toBe(200);
    expect(res.body.entities).toHaveLength(1);
  });

  it("tier2 returns 404 for unknown entity type", async () => {
    const app = makeApp();
    const res = await request(app)
      .get("/api/sync/v2/tier2/unknown/p1");
    expect(res.status).toBe(404);
  });

  it("GET /api/sync/v2/tier2/access_requests/:path returns requests", async () => {
    const app = makeApp();
    const res = await request(app)
      .get("/api/sync/v2/tier2/access_requests/some-note.md");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entities)).toBe(true);
  });
});
