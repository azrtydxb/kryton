import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  buildBuiltinTestApp,
  cleanupBuiltinTestUser,
  createBuiltinTestUser,
  seedBuiltinTestUser,
  type BuiltinTestApp,
} from "./builtin-routes.helpers.js";

const TEST_USER = createBuiltinTestUser("notes");

describe("plugin-builtin notes routes", () => {
  let ctx: BuiltinTestApp | null = null;

  beforeAll(async () => {
    await seedBuiltinTestUser(TEST_USER);
  });
  afterAll(async () => {
    await cleanupBuiltinTestUser(TEST_USER.id);
  });

  afterEach(async () => {
    if (ctx) await ctx.cleanup();
    ctx = null;
  });

  it("rejects unauthenticated calls", async () => {
    ctx = await buildBuiltinTestApp({ user: null });
    for (const url of [
      "/api/plugin-builtin/notes/list",
      "/api/plugin-builtin/notes/get?path=a.md",
    ]) {
      const res = await ctx.app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
    }
  });

  it("creates, reads, updates, lists, and deletes a note", async () => {
    ctx = await buildBuiltinTestApp({ user: TEST_USER });

    const create = await ctx.app.inject({
      method: "POST",
      url: "/api/plugin-builtin/notes/create",
      payload: { path: "demo", content: "# demo\nbody" },
    });
    expect(create.statusCode).toBe(200);
    expect(create.json()).toEqual({ ok: true });

    const list = await ctx.app.inject({
      method: "GET",
      url: "/api/plugin-builtin/notes/list",
    });
    expect(list.statusCode).toBe(200);
    const tree = list.json();
    expect(Array.isArray(tree)).toBe(true);
    const names = tree.map((e: { name: string }) => e.name);
    expect(names).toContain("demo.md");

    const read = await ctx.app.inject({
      method: "GET",
      url: "/api/plugin-builtin/notes/get?path=demo.md",
    });
    expect(read.statusCode).toBe(200);
    const body = read.json();
    expect(body.content).toBe("# demo\nbody");

    const update = await ctx.app.inject({
      method: "POST",
      url: "/api/plugin-builtin/notes/update",
      payload: { path: "demo.md", content: "# demo\nupdated" },
    });
    expect(update.statusCode).toBe(200);

    const reread = await ctx.app.inject({
      method: "GET",
      url: "/api/plugin-builtin/notes/get?path=demo.md",
    });
    expect(reread.json().content).toBe("# demo\nupdated");

    const del = await ctx.app.inject({
      method: "DELETE",
      url: "/api/plugin-builtin/notes/delete?path=demo.md",
    });
    expect(del.statusCode).toBe(200);
  });

  it("openByPath emits a note:open event with the current user", async () => {
    ctx = await buildBuiltinTestApp({ user: TEST_USER });
    const seen: unknown[] = [];
    ctx.eventBus.on(
      "note:open",
      (...args: unknown[]) => {
        seen.push(args[0]);
      },
      "test-plugin",
    );

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/plugin-builtin/notes/openByPath",
      payload: { path: "demo.md" },
    });
    expect(res.statusCode).toBe(200);
    expect(seen).toEqual([{ userId: TEST_USER.id, path: "demo.md" }]);
  });

  it("replaceFenceAtRange splices a line range and rewrites the note", async () => {
    ctx = await buildBuiltinTestApp({ user: TEST_USER });

    await ctx.app.inject({
      method: "POST",
      url: "/api/plugin-builtin/notes/create",
      payload: {
        path: "fence",
        content: ["before", "```js", "old()", "```", "after"].join("\n"),
      },
    });

    const splice = await ctx.app.inject({
      method: "POST",
      url: "/api/plugin-builtin/notes/replaceFenceAtRange",
      payload: {
        path: "fence.md",
        range: { startLine: 1, endLine: 3 },
        newSource: ["```ts", "next()", "```"].join("\n"),
      },
    });
    expect(splice.statusCode).toBe(200);

    const read = await ctx.app.inject({
      method: "GET",
      url: "/api/plugin-builtin/notes/get?path=fence.md",
    });
    expect(read.json().content).toBe(
      ["before", "```ts", "next()", "```", "after"].join("\n"),
    );
  });

  it("replaceFenceAtRange rejects an inverted range", async () => {
    ctx = await buildBuiltinTestApp({ user: TEST_USER });

    await ctx.app.inject({
      method: "POST",
      url: "/api/plugin-builtin/notes/create",
      payload: { path: "fence2", content: "a\nb\nc\n" },
    });

    const splice = await ctx.app.inject({
      method: "POST",
      url: "/api/plugin-builtin/notes/replaceFenceAtRange",
      payload: {
        path: "fence2.md",
        range: { startLine: 3, endLine: 1 },
        newSource: "x",
      },
    });
    expect(splice.statusCode).toBe(400);
  });
});
