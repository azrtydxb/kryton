import { describe, it, expect, afterEach } from "vitest";
import { buildNotesTestApp, type NotesTestApp } from "./helpers.js";

const TEST_USER = { id: "user1234", email: "a@b.co", name: "Alice", role: "user" };

describe("notes module / tags routes", () => {
  let ctx: NotesTestApp | null = null;
  afterEach(async () => {
    if (ctx) await ctx.cleanup();
    ctx = null;
  });

  it("rejects unauthenticated tag listing", async () => {
    ctx = await buildNotesTestApp({ user: null });
    const res = await ctx.app.inject({ method: "GET", url: "/api/tags" });
    expect(res.statusCode).toBe(401);
  });

  it("returns an empty list when knowledge module is not present", async () => {
    ctx = await buildNotesTestApp({ user: TEST_USER });
    const res = await ctx.app.inject({ method: "GET", url: "/api/tags" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
