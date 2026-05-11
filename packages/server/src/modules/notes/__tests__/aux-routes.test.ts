/**
 * Smoke tests for notes-aux routes (attachments, canvas, history, backlinks).
 *
 * Builds a minimal Fastify app with stub decorators (`auth`, `notes`,
 * `knowledge`) rather than using `buildTestApp` directly — that
 * helper registers the full app graph including DB-backed plugins which is
 * heavy for route-level smoke tests.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import {
  validatorCompiler,
  serializerCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { sql } from "drizzle-orm";

import { canvasRoutes } from "../routes/canvas.routes.js";
import { backlinksRoutes } from "../routes/backlinks.routes.js";
import { historyRoutes } from "../routes/history.routes.js";
import { attachmentsRoutes } from "../routes/attachments.routes.js";
import { createTestDb, type TestDbHandle } from "../../../test/db-fixture.js";
import { user as userTable } from "../../../db/schema/auth.js";

const TEST_USER = { id: "u-aux-test", email: "aux@test", name: "Aux", role: "user" };

async function buildAuxTestApp(
  notesDir: string,
  handle: TestDbHandle,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate("config", { NOTES_DIR: notesDir } as never);
  app.decorate("db", handle.db);

  const authStub = {
    instance: null,
    async resolve(_req: FastifyRequest) {
      return { user: TEST_USER, apiKey: null, agentId: null };
    },
    async requireUser(_req: FastifyRequest) {
      return TEST_USER;
    },
    async requireAuth(_req: FastifyRequest) {
      return { user: TEST_USER, apiKey: null, agentId: null };
    },
    async getOptionalUser() {
      return TEST_USER;
    },
    async requireAdmin() {
      return TEST_USER;
    },
    requireWriteScope() {
      /* no-op for tests */
    },
    requireSession() {
      /* no-op for tests */
    },
    async authenticateWsToken() {
      return null;
    },
  };
  app.decorate("auth", authStub as never);

  // Attachments now go through app.db / Drizzle directly. No prisma stub
  // needed for these routes.

  // Stub the cross-module decorators the routes consume.
  const userDirOf = async (userId: string): Promise<string> => {
    const dir = path.join(notesDir, userId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  };
  app.decorate("notes", {
    getUserNotesDir: userDirOf,
    async readNote(userPath: string, userId: string) {
      const dir = await userDirOf(userId);
      const content = await fs.readFile(path.join(dir, userPath), "utf8");
      return { content, modifiedAt: null };
    },
    async writeNote(userPath: string, content: string, userId: string) {
      const dir = await userDirOf(userId);
      await fs.mkdir(path.dirname(path.join(dir, userPath)), { recursive: true });
      await fs.writeFile(path.join(dir, userPath), content, "utf8");
    },
    async deleteNote(userPath: string, userId: string) {
      const dir = await userDirOf(userId);
      await fs.rm(path.join(dir, userPath), { force: true });
    },
    async scanDirectory() {
      return [];
    },
  } as never);
  app.decorate("knowledge", {
    indexNote: async () => undefined,
    removeFromIndex: async () => undefined,
    renameInIndex: async () => undefined,
    updateGraph: async () => undefined,
    removeFromGraph: async () => undefined,
    renameInGraph: async () => undefined,
    getAllTags: async () => [],
    getNotesByTag: async () => [],
    search: async () => [],
    getBacklinks: async () => [{ path: "Other.md", title: "Other" }],
    getFullGraph: async () => ({ nodes: [], edges: [] }),
    incrementCursor: async () => 0n,
    getCursor: async () => 0n,
  } as never);

  await app.register(import("@fastify/multipart"), {
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    attachFieldsToBody: false,
  });

  app.withTypeProvider<ZodTypeProvider>();

  await app.register(canvasRoutes, { prefix: "/api/canvas" });
  await app.register(backlinksRoutes, { prefix: "/api/backlinks" });
  await app.register(historyRoutes, { prefix: "/api/history", mode: "list" });
  await app.register(historyRoutes, { prefix: "/api/history-version", mode: "version" });
  await app.register(historyRoutes, { prefix: "/api/history-restore", mode: "restore" });
  await app.register(attachmentsRoutes, { prefix: "/api/attachments" });

  await app.ready();
  return app;
}

describe("notes-aux routes", () => {
  let notesDir: string;
  let app: FastifyInstance;
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "kaux-"));
    // Reset attachment-related tables and reseed the test user.
    await handle.db.execute(sql`
      TRUNCATE TABLE "Attachment", "User" RESTART IDENTITY CASCADE
    `);
    await handle.db.insert(userTable).values({
      id: TEST_USER.id,
      email: TEST_USER.email,
      name: TEST_USER.name,
      emailVerified: false,
      role: TEST_USER.role,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    app = await buildAuxTestApp(notesDir, handle);
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(notesDir, { recursive: true, force: true });
  });

  describe("canvas routes", () => {
    it("creates, lists, reads, updates, and deletes a canvas file", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/canvas",
        payload: { name: "diagram", content: { nodes: [{ id: "a" }], edges: [] } },
      });
      expect(create.statusCode).toBe(201);
      expect(create.json()).toMatchObject({ name: "diagram.canvas" });

      const list = await app.inject({ method: "GET", url: "/api/canvas" });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual(["diagram"]);

      const read = await app.inject({ method: "GET", url: "/api/canvas/diagram" });
      expect(read.statusCode).toBe(200);
      expect(read.json()).toMatchObject({ nodes: [{ id: "a" }] });

      const update = await app.inject({
        method: "PUT",
        url: "/api/canvas/diagram",
        payload: { nodes: [{ id: "b" }], edges: [] },
      });
      expect(update.statusCode).toBe(200);

      const del = await app.inject({ method: "DELETE", url: "/api/canvas/diagram" });
      expect(del.statusCode).toBe(200);
    });

    it("returns 409 when creating a duplicate canvas file", async () => {
      await app.inject({ method: "POST", url: "/api/canvas", payload: { name: "dup" } });
      const dup = await app.inject({
        method: "POST",
        url: "/api/canvas",
        payload: { name: "dup" },
      });
      expect(dup.statusCode).toBe(409);
    });
  });

  describe("backlinks routes", () => {
    it("returns the backlinks list", async () => {
      const res = await app.inject({ method: "GET", url: "/api/backlinks/Welcome" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([{ path: "Other.md", title: "Other" }]);
    });
  });

  describe("history routes", () => {
    it("returns an empty version list when no history exists", async () => {
      const res = await app.inject({ method: "GET", url: "/api/history/Welcome.md" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ versions: [] });
    });

    it("lists, reads and restores a specific version", async () => {
      // Seed a fake snapshot in the user's history dir
      const userDir = path.join(notesDir, TEST_USER.id);
      const histDir = path.join(userDir, ".history", "Welcome.md");
      await fs.mkdir(histDir, { recursive: true });
      const ts = 1700000000000;
      await fs.writeFile(path.join(histDir, `${ts}.md`), "old content", "utf-8");

      const list = await app.inject({ method: "GET", url: "/api/history/Welcome.md" });
      expect(list.statusCode).toBe(200);
      expect(list.json().versions[0]).toMatchObject({ timestamp: ts });

      const ver = await app.inject({
        method: "GET",
        url: `/api/history-version/Welcome.md?ts=${ts}`,
      });
      expect(ver.statusCode).toBe(200);
      expect(ver.json()).toMatchObject({ content: "old content", timestamp: ts });

      const restore = await app.inject({
        method: "POST",
        url: `/api/history-restore/Welcome.md?ts=${ts}`,
      });
      expect(restore.statusCode).toBe(200);
      expect(restore.json()).toEqual({ restored: true });
    });
  });

  describe("attachments routes", () => {
    it("uploads a file and downloads it back", async () => {
      const boundary = "----testboundary12345";
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\n`),
        Buffer.from('Content-Disposition: form-data; name="notePath"\r\n\r\n'),
        Buffer.from("p1.md\r\n"),
        Buffer.from(`--${boundary}\r\n`),
        Buffer.from(
          'Content-Disposition: form-data; name="file"; filename="hello.txt"\r\n',
        ),
        Buffer.from("Content-Type: text/plain\r\n\r\n"),
        Buffer.from("hello world"),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const upload = await app.inject({
        method: "POST",
        url: "/api/attachments",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: body,
      });
      expect(upload.statusCode).toBe(200);
      const att = upload.json();
      expect(att.id).toBeDefined();
      expect(att.filename).toBe("hello.txt");

      const dl = await app.inject({ method: "GET", url: `/api/attachments/${att.id}` });
      expect(dl.statusCode).toBe(200);
      expect(dl.body).toBe("hello world");
      expect(dl.headers["content-type"]).toMatch(/text\/plain/);
    });

    it("returns 404 for a non-existent attachment", async () => {
      const res = await app.inject({ method: "GET", url: "/api/attachments/missing" });
      expect(res.statusCode).toBe(404);
    });
  });
});
