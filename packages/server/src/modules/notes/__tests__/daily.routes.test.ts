import { describe, it, expect, afterEach } from "vitest";
import { buildNotesTestApp, type NotesTestApp } from "./helpers.js";

const TEST_USER = { id: "user1234", email: "a@b.co", name: "Alice", role: "user" };

describe("notes module / daily routes", () => {
  let ctx: NotesTestApp | null = null;
  afterEach(async () => {
    if (ctx) await ctx.cleanup();
    ctx = null;
  });

  it("rejects unauthenticated daily creation", async () => {
    ctx = await buildNotesTestApp({ user: null });
    const res = await ctx.app.inject({ method: "POST", url: "/api/daily" });
    expect(res.statusCode).toBe(401);
  });

  it("creates today's daily note", async () => {
    ctx = await buildNotesTestApp({ user: TEST_USER });
    const res = await ctx.app.inject({ method: "POST", url: "/api/daily" });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.path).toMatch(/^Daily\/\d{4}-\d{2}-\d{2}\.md$/);
    expect(body.content).toContain("Daily Note");
  });
});
