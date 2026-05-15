import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  buildNotesTestApp,
  cleanupNotesTestUser,
  createNotesTestUser,
  seedNotesTestUser,
  type NotesTestApp,
} from "./helpers.js";

const TEST_USER = createNotesTestUser("templates");

describe("notes module / templates routes", () => {
  let ctx: NotesTestApp | null = null;

  beforeAll(async () => {
    await seedNotesTestUser(TEST_USER);
  });
  afterAll(async () => {
    await cleanupNotesTestUser(TEST_USER.id);
  });
  afterEach(async () => {
    if (ctx) await ctx.cleanup();
    ctx = null;
  });

  it("rejects unauthenticated template listing", async () => {
    ctx = await buildNotesTestApp({ user: null });
    const res = await ctx.app.inject({ method: "GET", url: "/api/templates" });
    expect(res.statusCode).toBe(401);
  });

  it("returns an empty list when the Templates dir is empty", async () => {
    ctx = await buildNotesTestApp({ user: TEST_USER });
    const res = await ctx.app.inject({ method: "GET", url: "/api/templates" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
