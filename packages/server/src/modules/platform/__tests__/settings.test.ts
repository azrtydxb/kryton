import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../../../__tests__/helpers/build-test-app.js";

describe("settings routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated GET /api/settings", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings/" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated PUT /api/settings/:key", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/theme",
      payload: { value: "dark" },
    });
    expect(res.statusCode).toBe(401);
  });
});
