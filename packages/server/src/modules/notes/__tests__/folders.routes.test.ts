import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { buildNotesTestApp, type NotesTestApp } from "./helpers.js";

const TEST_USER = { id: "user1234", email: "a@b.co", name: "Alice", role: "user" };

describe("notes module / folders routes", () => {
  let ctx: NotesTestApp | null = null;
  afterEach(async () => {
    if (ctx) await ctx.cleanup();
    ctx = null;
  });

  it("rejects unauthenticated folder creation", async () => {
    ctx = await buildNotesTestApp({ user: null });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/folders",
      payload: { path: "Projects" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates a folder on disk", async () => {
    ctx = await buildNotesTestApp({ user: TEST_USER });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/folders",
      payload: { path: "Projects" },
    });
    expect(res.statusCode).toBe(201);
    const userDir = path.join(ctx.notesDir, TEST_USER.id);
    const stat = await fs.stat(path.join(userDir, "Projects"));
    expect(stat.isDirectory()).toBe(true);
  });
});
