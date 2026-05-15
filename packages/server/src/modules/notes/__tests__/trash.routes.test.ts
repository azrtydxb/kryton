import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  buildNotesTestApp,
  cleanupNotesTestUser,
  createNotesTestUser,
  seedNotesTestUser,
  type NotesTestApp,
} from "./helpers.js";

const TEST_USER = createNotesTestUser("trash");

describe("notes module / trash routes", () => {
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

  it("rejects unauthenticated trash listing", async () => {
    ctx = await buildNotesTestApp({ user: null });
    const res = await ctx.app.inject({ method: "GET", url: "/api/trash" });
    expect(res.statusCode).toBe(401);
  });

  it("returns an empty list when trash is empty", async () => {
    ctx = await buildNotesTestApp({ user: TEST_USER });
    const res = await ctx.app.inject({ method: "GET", url: "/api/trash" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("empties trash without error when nothing exists", async () => {
    ctx = await buildNotesTestApp({ user: TEST_USER });
    const res = await ctx.app.inject({ method: "DELETE", url: "/api/trash-empty" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ message: "Trash emptied" });
  });
});
