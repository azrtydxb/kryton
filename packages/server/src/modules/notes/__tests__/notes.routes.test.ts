import { describe, it, expect, afterEach } from "vitest";
import { buildNotesTestApp, type NotesTestApp } from "./helpers.js";

const TEST_USER = { id: "user1234", email: "a@b.co", name: "Alice", role: "user" };

describe("notes module / notes routes", () => {
  let ctx: NotesTestApp | null = null;
  afterEach(async () => {
    if (ctx) await ctx.cleanup();
    ctx = null;
  });

  it("rejects unauthenticated tree listing", async () => {
    ctx = await buildNotesTestApp({ user: null });
    const res = await ctx.app.inject({ method: "GET", url: "/api/notes" });
    expect(res.statusCode).toBe(401);
  });

  it("returns an empty tree for a fresh user", async () => {
    ctx = await buildNotesTestApp({ user: TEST_USER });
    const res = await ctx.app.inject({ method: "GET", url: "/api/notes" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("creates and reads a note", async () => {
    ctx = await buildNotesTestApp({ user: TEST_USER });

    const create = await ctx.app.inject({
      method: "POST",
      url: "/api/notes",
      payload: { path: "Hello", content: "# Hello\n\nWorld" },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toEqual({ path: "Hello.md", message: "Note created" });

    const read = await ctx.app.inject({
      method: "GET",
      url: "/api/notes/Hello.md",
    });
    expect(read.statusCode).toBe(200);
    const body = read.json();
    expect(body.path).toBe("Hello.md");
    expect(body.content).toBe("# Hello\n\nWorld");
    expect(body.title).toBe("Hello");
  });
});
