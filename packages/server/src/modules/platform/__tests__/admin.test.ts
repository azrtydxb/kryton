import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../../../__tests__/helpers/build-test-app.js";

describe("admin routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated user list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/users" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated invite list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/invites" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated registration setting read", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/settings/registration" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated user update", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/admin/users/some-id",
      payload: { disabled: true },
    });
    expect(res.statusCode).toBe(401);
  });
});
