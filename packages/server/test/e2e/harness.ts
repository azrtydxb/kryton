/**
 * E2E harness — boots the real Fastify app on a real port using the
 * same buildApp() the production server uses. Tests interact via real
 * HTTP fetch so this exercises the full middleware/auth/routing stack
 * including the MCP streamable transport.
 *
 * The Postgres database is provided by the vitest global setup
 * (testcontainers locally, service container in CI). The harness owns
 * the app lifecycle (start / stop / restart) and exposes small helpers
 * for the most common request shapes.
 */
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/index.js";

export class KrytonHarness {
  private app: FastifyInstance | undefined;
  private notesDir: string | undefined;
  baseUrl = "";
  /** Port stays stable across restart() so prior URLs/cookies are reusable. */
  private port = 0;

  /** Start the app for the first time. */
  async start(): Promise<void> {
    process.env.NODE_ENV = "test";
    if (process.env.TEST_DATABASE_URL && !process.env.POSTGRES_URL) {
      process.env.POSTGRES_URL = process.env.TEST_DATABASE_URL;
    }
    // Avoid downloading the MiniLM model; semantic search isn't under test here.
    if (!process.env.SEMANTIC_PROVIDER) process.env.SEMANTIC_PROVIDER = "off";
    if (!process.env.BETTER_AUTH_SECRET) {
      process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
    }
    if (!process.env.NOTES_DIR) {
      // Per-process scratch dir so parallel runs don't collide.
      const os = await import("node:os");
      const path = await import("node:path");
      const fs = await import("node:fs/promises");
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kryton-e2e-"));
      this.notesDir = dir;
      process.env.NOTES_DIR = dir;
    } else {
      this.notesDir = process.env.NOTES_DIR;
    }
    await this.boot();
  }

  /** Stop + restart the app. DB + notes dir survive; in-memory state doesn't. */
  async restart(): Promise<void> {
    if (this.app) await this.app.close();
    // undici's default fetch agent keeps connections alive to the host.
    // After the previous server closes those sockets point at a corpse;
    // reusing one for the next call surfaces as ECONNRESET. Replace the
    // global dispatcher with a fresh one so post-restart fetches dial a
    // new connection.
    const undici = await import("undici");
    undici.setGlobalDispatcher(new undici.Agent());
    await this.boot();
  }

  /** Tear down. */
  async stop(): Promise<void> {
    if (this.app) {
      await this.app.close();
      this.app = undefined;
    }
    if (this.notesDir && this.notesDir.startsWith("/tmp/")) {
      const fs = await import("node:fs/promises");
      await fs.rm(this.notesDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async boot(): Promise<void> {
    const config = loadEnv();
    this.app = await buildApp({ config, discoverPlugins: false });
    await this.app.listen({ host: "127.0.0.1", port: this.port });
    const addr = this.app.server.address() as AddressInfo;
    this.port = addr.port; // first start picks a free port; subsequent restarts reuse it
    this.baseUrl = `http://127.0.0.1:${this.port}`;
  }

  /** Sign up a new user (first signup auto-elevates to admin role). */
  async signUp(email: string, password: string): Promise<{ userId: string; cookies: string[] }> {
    const res = await fetch(`${this.baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, name: email.split("@")[0] }),
    });
    if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
    const cookies = res.headers.getSetCookie?.() ?? [];
    const body = (await res.json()) as { user: { id: string } };
    return { userId: body.user.id, cookies };
  }

  async signIn(email: string, password: string): Promise<{ cookies: string[] }> {
    const res = await fetch(`${this.baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
    const cookies = res.headers.getSetCookie?.() ?? [];
    return { cookies };
  }

  /** Mint an API key for the user identified by `cookies`. */
  async mintApiKey(
    cookies: string[],
    opts: { name: string; scope: "read-only" | "read-write" },
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/api-keys`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookies.join("; "),
      },
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error(`mint api key failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { key: string };
    return body.key;
  }

  /** MCP initialize handshake. Returns the negotiated session id. */
  async mcpInit(apiKey: string, clientName = "e2e-test"): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: clientName, version: "0" },
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`mcp initialize failed: ${res.status} ${await res.text()}`);
    }
    const sid = res.headers.get("mcp-session-id");
    if (!sid) throw new Error("mcp initialize: no Mcp-Session-Id header in response");
    // Consume body so the SSE stream closes.
    await res.text();
    return sid;
  }

  /** Call an MCP tool. Returns the parsed jsonrpc envelope. */
  async mcpCall(args: {
    apiKey: string;
    sessionId: string;
    name: string;
    arguments?: Record<string, unknown>;
    expectStatus?: number;
  }): Promise<{ status: number; payload: unknown }> {
    const res = await fetch(`${this.baseUrl}/api/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${args.apiKey}`,
        "mcp-session-id": args.sessionId,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Math.floor(Math.random() * 1_000_000),
        method: "tools/call",
        params: { name: args.name, arguments: args.arguments ?? {} },
      }),
    });
    const text = await res.text();
    if (args.expectStatus !== undefined && res.status !== args.expectStatus) {
      throw new Error(`mcp ${args.name} expected ${args.expectStatus}, got ${res.status}: ${text}`);
    }
    // SSE response: "event: message\ndata: {...}\n\n"
    const payloadLine = text.split("\n").find((l) => l.startsWith("data: "));
    const payload = payloadLine ? JSON.parse(payloadLine.slice(6)) : null;
    return { status: res.status, payload };
  }

  /** List MCP tools. Returns tool name set. */
  async mcpToolNames(apiKey: string, sessionId: string): Promise<Set<string>> {
    const res = await fetch(`${this.baseUrl}/api/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "mcp-session-id": sessionId,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });
    const text = await res.text();
    const line = text.split("\n").find((l) => l.startsWith("data: "));
    if (!line) throw new Error(`tools/list: unexpected body ${text}`);
    const env = JSON.parse(line.slice(6)) as {
      result: { tools: Array<{ name: string }> };
    };
    return new Set(env.result.tools.map((t) => t.name));
  }
}

/** Tiny helper for tests that just want a fresh signed-up user + an API key. */
export async function bootstrapUser(
  h: KrytonHarness,
  email = `e2e-${randomBytes(4).toString("hex")}@local.test`,
  password = "E2E-test-password-2026!",
): Promise<{
  email: string;
  password: string;
  cookies: string[];
  apiKey: string;
}> {
  await h.signUp(email, password).catch(() => undefined);
  const { cookies } = await h.signIn(email, password);
  const apiKey = await h.mintApiKey(cookies, { name: "e2e", scope: "read-write" });
  return { email, password, cookies, apiKey };
}
