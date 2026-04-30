import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { prisma } from "../prisma.js";
import { createAttachmentsRouter } from "../routes/attachments.js";
import { createTestApp } from "./test-app.js";

const TEST_USER = { id: "u-att", email: "att@example.com", name: "Attach User", role: "user" };

describe("/api/attachments", () => {
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "katt-"));
    await prisma.attachment.deleteMany({ where: { userId: TEST_USER.id } });
    await prisma.user.deleteMany({ where: { id: TEST_USER.id } });
    await prisma.user.create({ data: { id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name } });
  });

  function makeApp() {
    return createTestApp("/api/attachments", createAttachmentsRouter(storageRoot), TEST_USER);
  }

  it("upload then download attachment", async () => {
    const app = makeApp();

    const upload = await request(app)
      .post("/api/attachments")
      .field("notePath", "p1.md")
      .attach("file", Buffer.from("hello"), { filename: "test.txt", contentType: "text/plain" });

    expect(upload.status).toBe(200);
    expect(upload.body.id).toBeDefined();

    const dl = await request(app)
      .get(`/api/attachments/${upload.body.id}`);
    expect(dl.status).toBe(200);
    expect(dl.text).toBe("hello");
    expect(dl.headers["content-type"]).toMatch(/text\/plain/);
  });

  it("returns 400 when no file is provided", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/attachments")
      .send({ notePath: "p1.md" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent attachment", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/attachments/doesnotexist");
    expect(res.status).toBe(404);
  });

  it("returns 404 for attachment owned by different user", async () => {
    // Create attachment for another user
    const otherStorageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "katt2-"));
    const otherUser = { id: "u-att2", email: "att2@example.com", name: "Other User", role: "user" };
    await prisma.user.deleteMany({ where: { id: otherUser.id } });
    await prisma.user.create({ data: { id: otherUser.id, email: otherUser.email, name: otherUser.name } });
    const app = createTestApp("/api/attachments", createAttachmentsRouter(otherStorageRoot), otherUser);

    const upload = await request(app)
      .post("/api/attachments")
      .field("notePath", "p2.md")
      .attach("file", Buffer.from("secret"), { filename: "secret.txt", contentType: "text/plain" });
    expect(upload.status).toBe(200);
    const attId = upload.body.id;

    // Try to download with TEST_USER (different user)
    const appOtherUser = makeApp();
    const res = await request(appOtherUser).get(`/api/attachments/${attId}`);
    expect(res.status).toBe(404);
  });
});
