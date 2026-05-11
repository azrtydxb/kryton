import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../../../__tests__/helpers/build-test-app.js";

describe("admin tunnel routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated status request", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/tunnel/status",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated token set", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/tunnel/token",
      payload: { token: "eyJhbGc.eyJzdWI.AAAA" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated token clear", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/admin/tunnel/token",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated stats", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/tunnel/stats?window=24h",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated reconnect", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/tunnel/reconnect",
    });
    expect(res.statusCode).toBe(401);
  });
});
