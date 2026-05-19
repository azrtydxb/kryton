import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  buildBuiltinTestApp,
  cleanupBuiltinTestUser,
  createBuiltinTestUser,
  seedBuiltinTestUser,
  type BuiltinTestApp,
} from "./builtin-routes.helpers.js";

const TEST_USER = createBuiltinTestUser("storage");

describe("plugin-builtin storage routes", () => {
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
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/plugin-builtin/storage/get?key=foo",
      headers: { "x-kryton-plugin-id": "demo" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects missing plugin id header", async () => {
    ctx = await buildBuiltinTestApp({ user: TEST_USER });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/plugin-builtin/storage/get?key=foo",
    });
    expect(res.statusCode).toBe(400);
  });

  it("set then get returns the stored value scoped per plugin", async () => {
    ctx = await buildBuiltinTestApp({ user: TEST_USER });

    const set = await ctx.app.inject({
      method: "POST",
      url: "/api/plugin-builtin/storage/set",
      headers: { "x-kryton-plugin-id": "demo-a" },
      payload: { key: "k1", value: { hello: "world" } },
    });
    expect(set.statusCode).toBe(200);

    const getA = await ctx.app.inject({
      method: "GET",
      url: "/api/plugin-builtin/storage/get?key=k1",
      headers: { "x-kryton-plugin-id": "demo-a" },
    });
    expect(getA.statusCode).toBe(200);
    expect(getA.json()).toEqual({ value: { hello: "world" } });

    // Different plugin id => isolated namespace, value should be null.
    const getB = await ctx.app.inject({
      method: "GET",
      url: "/api/plugin-builtin/storage/get?key=k1",
      headers: { "x-kryton-plugin-id": "demo-b" },
    });
    expect(getB.statusCode).toBe(200);
    expect(getB.json()).toEqual({ value: null });
  });

  it("list returns matching keys, delete removes them", async () => {
    ctx = await buildBuiltinTestApp({ user: TEST_USER });
    const headers = { "x-kryton-plugin-id": "demo-list" };

    for (const k of ["pre-1", "pre-2", "other"]) {
      await ctx.app.inject({
        method: "POST",
        url: "/api/plugin-builtin/storage/set",
        headers,
        payload: { key: k, value: k },
      });
    }

    const listAll = await ctx.app.inject({
      method: "GET",
      url: "/api/plugin-builtin/storage/list",
      headers,
    });
    const entries = listAll.json() as Array<{ key: string }>;
    expect(entries.map((e) => e.key).sort()).toEqual(["other", "pre-1", "pre-2"]);

    const listPrefix = await ctx.app.inject({
      method: "GET",
      url: "/api/plugin-builtin/storage/list?prefix=pre-",
      headers,
    });
    const pre = listPrefix.json() as Array<{ key: string }>;
    expect(pre.map((e) => e.key).sort()).toEqual(["pre-1", "pre-2"]);

    const del = await ctx.app.inject({
      method: "DELETE",
      url: "/api/plugin-builtin/storage/delete?key=pre-1",
      headers,
    });
    expect(del.statusCode).toBe(200);

    const after = await ctx.app.inject({
      method: "GET",
      url: "/api/plugin-builtin/storage/get?key=pre-1",
      headers,
    });
    expect(after.json()).toEqual({ value: null });
  });
});
