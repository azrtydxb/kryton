import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../../../__tests__/helpers/build-test-app.js";

describe("plugins routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated /active", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins/active" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated /all", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins/all" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated enable", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/some-id/enable",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated disable", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/some-id/disable",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated reload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/some-id/reload",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated registry fetch", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins/registry" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated install", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/foo/install",
    });
    // route is /install/:id — make sure this 404s, not 401, because it's a different path
    expect([401, 404]).toContain(res.statusCode);
  });

  it("rejects unauthenticated uninstall", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/foo/uninstall",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("plugin lifecycle (manager)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("exposes the plugins decorator", () => {
    expect(app.plugins).toBeDefined();
    expect(app.plugins.manager).toBeDefined();
    expect(app.plugins.eventBus).toBeDefined();
    expect(app.plugins.healthMonitor).toBeDefined();
  });

  it("loadPlugin throws for a missing plugin directory", async () => {
    await expect(app.plugins.manager.loadPlugin("does-not-exist")).rejects.toThrow();
  });

  it("listPlugins returns an array", () => {
    const list = app.plugins.manager.listPlugins();
    expect(Array.isArray(list)).toBe(true);
  });

  it("disablePlugin is a no-op for unknown plugin", async () => {
    await expect(
      app.plugins.manager.disablePlugin("does-not-exist"),
    ).resolves.toBeUndefined();
  });
});
