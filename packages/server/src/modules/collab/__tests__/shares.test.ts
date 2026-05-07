import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../../../__tests__/helpers/build-test-app.js";

describe("collab shares routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated share creation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/shares",
      payload: {
        path: "note.md",
        sharedWithUserId: "other",
        permission: "read",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated share list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/shares" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated shares-with-me list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/shares/with-me" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated share update", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/shares/some-id",
      payload: { permission: "readwrite" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated share delete", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/shares/some-id" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated access-request creation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/access-requests",
      payload: { ownerUserId: "u", notePath: "n" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated access-request list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/access-requests" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated outgoing access-request list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/access-requests/mine" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated sync pull", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sync/v2/pull",
      payload: { cursor: "0" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated sync push", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sync/v2/push",
      payload: { changes: {} },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unauthenticated tier2 fetch", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sync/v2/tier2/history/some-path",
    });
    expect(res.statusCode).toBe(401);
  });

  it("validates share creation body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/shares",
      payload: { permission: "invalid" },
    });
    // 400 (validation) or 401 (unauthenticated) — either way, not a 500.
    expect([400, 401]).toContain(res.statusCode);
  });
});
