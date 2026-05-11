import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { zodPlugin } from "../../../plugins/zod.js";
import { errorsPlugin } from "../../../plugins/errors.js";
import { mcpRoutes } from "../mcp/server.js";
import type { AppConfig } from "../../../config/index.js";

/**
 * MCP smoke test — verifies the transport route is wired up and rejects
 * requests without a valid Personal Access Token. Exercising a full MCP
 * round-trip requires a real DB and is covered by the integration
 * suite; here we just confirm the auth gate.
 */
describe("MCP transport smoke test", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(zodPlugin);

    // Minimal stubs — the mcp route only touches app.db after auth passes
    app.decorate("db", {
      query: {
        user: {
          findFirst: async () => undefined,
        },
      },
    } as never);

    app.decorate("config", { PORT: 3001 } as AppConfig);

    await app.register(errorsPlugin);
    await app.register(mcpRoutes, { prefix: "/api/mcp" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/API key required/i);
  });

  it("returns 401 when Authorization is not a kryton_ token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/mcp",
      headers: { authorization: "Bearer not-a-kryton-key" },
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    expect(res.statusCode).toBe(401);
  });
});
