/**
 * Real end-to-end test: spawn the Go tunnel-server binary as a
 * subprocess, mint an Ed25519 keypair + JWT here, then exercise the
 * full client stack (h2 CONNECT + our TS yamux implementation) by
 * issuing a public HTTP request and assertion-checking that Fastify
 * received the forwarded request.
 *
 * Skipped if the Go binary isn't built (CI builds it before invoking
 * this suite via the wrapper Make target).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createServer, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

import { TunnelStateService } from "../services/tunnel-state.service.js";
import { TunnelStatsService } from "../services/tunnel-stats.service.js";
import { TunnelClient } from "../services/tunnel-client.service.js";
import { LoopbackInjector } from "../services/loopback-injector.service.js";

const GO_BINARY = process.env.KRYTON_TUNNEL_SERVER_BINARY ??
  "/Users/pascal/Development/kryton-tunnel-server/bin/kryton-tunnel-server";

const ENABLED = existsSync(GO_BINARY);

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error("no port"));
      }
    });
    srv.once("error", reject);
  });
}

function mintJWT(privatePem: string): string {
  const header = { alg: "EdDSA", typ: "JWT", kid: "v1" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "https://kryton.ai",
    sub: "tenant_1",
    subdomain: "test",
    plan: "active",
    iat: now - 60,
    exp: now + 3600,
    jti: "tok_abc",
  };
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const sig = edSign(null, Buffer.from(signingInput), { key: privatePem, format: "pem", type: "pkcs8" });
  const sigB64 = sig.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${signingInput}.${sigB64}`;
}

// Faux Drizzle stub. The tunnel services exercise only `query.X.findFirst/findMany`
// + `insert/values/onConflictDoUpdate` + `delete/where`. We provide a minimal
// in-memory shim for the round-trip test.
interface SettingsRow { key: string; userId: string; value: string }
function makeFakeDb() {
  const settings: SettingsRow[] = [];
  return {
    settings,
    query: {
      settings: {
        findFirst: async () => settings[0],
      },
      tunnelTrafficDaily: {
        findMany: async () => [] as { day: string; requests: number; bytesIn: number; bytesOut: number }[],
      },
    },
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async () => undefined,
      }),
    }),
    delete: () => ({
      where: async () => undefined,
    }),
  };
}

describe.skipIf(!ENABLED)("tunnel e2e (Go binary)", () => {
  let serverProc: ChildProcess | null = null;
  let krytonProc: Server | null = null;
  let keysDir: string;
  let privatePem: string;
  let publicRaw: Buffer;
  let controlPort: number;
  let publicPort: number;
  let krytonPort: number;

  beforeAll(async () => {
    // Generate Ed25519 keypair.
    const kp = generateKeyPairSync("ed25519");
    privatePem = kp.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    // Extract raw 32-byte public key from DER.
    const pubDer = kp.publicKey.export({ format: "der", type: "spki" }) as Buffer;
    publicRaw = pubDer.subarray(pubDer.length - 32);

    keysDir = await mkdtemp(join(tmpdir(), "tunnel-keys-"));
    await writeFile(join(keysDir, "v1.pub"), publicRaw.toString("base64"));

    controlPort = await pickFreePort();
    publicPort = await pickFreePort();
    krytonPort = await pickFreePort();
    const metricsPort = await pickFreePort();

    // Spawn the Go tunnel server.
    serverProc = spawn(GO_BINARY, [], {
      env: {
        ...process.env,
        POD_ID: "test",
        POD_ADDR: "127.0.0.1:" + controlPort,
        WP_BEARER: "test",
        JWT_KEYS_DIR: keysDir,
        LISTEN_CONTROL: "127.0.0.1:" + controlPort,
        LISTEN_PUBLIC: "127.0.0.1:" + publicPort,
        LISTEN_METRICS: "127.0.0.1:" + metricsPort,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Drain stdio so the child doesn't block, but don't accumulate
    // unused log buffers — they trip the no-unused-vars rule.
    serverProc.stdout?.on("data", () => undefined);
    serverProc.stderr?.on("data", () => undefined);

    // Wait for control + public listeners to be up.
    await waitForListener("127.0.0.1", controlPort, 3000);
    await waitForListener("127.0.0.1", publicPort, 3000);

    // Start a tiny faux-Kryton Fastify-like HTTP server.
    krytonProc = createServer((req, res) => {
      res.setHeader("content-type", "text/plain");
      res.end(`hello from kryton (${req.url})`);
    });
    await new Promise<void>((resolve) => krytonProc!.listen(krytonPort, "127.0.0.1", resolve));
  }, 15000);

  afterAll(async () => {
    if (krytonProc) {
      await new Promise<void>((resolve) => krytonProc!.close(() => resolve()));
    }
    if (serverProc) {
      serverProc.kill("SIGTERM");
      await new Promise((resolve) => serverProc!.once("exit", resolve));
    }
    if (keysDir) await rm(keysDir, { recursive: true, force: true });
  });

  it("dials, holds session, and forwards a real public GET to faux-Kryton", async () => {
    const jwt = mintJWT(privatePem);

    const fakeDb = makeFakeDb();
    const state = new TunnelStateService(fakeDb as unknown as never);
    // Pre-seed instance id so we don't hit findFirst empty.
    fakeDb.settings.push({ key: "tunnel.instance_id", userId: "__global__", value: "test-instance" });

    const stats = new TunnelStatsService(fakeDb as unknown as never);
    const loopback = new LoopbackInjector({
      log: { debug: () => {}, warn: () => {}, error: () => {} },
      stats,
    });
    loopback.setLocalPort(krytonPort);

    const client = new TunnelClient({
      state,
      loopback,
      log: { info: () => {}, warn: () => {}, error: () => {} },
      serverUrl: `http://127.0.0.1:${controlPort}`,
      krytonVersion: "0.0.0-test",
      initialBackoffMs: 200,
      maxBackoffMs: 1000,
    });

    await client.start(jwt);

    // Wait for state=open.
    let status = client.getStatus();
    for (let i = 0; i < 50 && status.state !== "open"; i++) {
      await delay(100);
      status = client.getStatus();
    }
    expect(status.state).toBe("open");

    // Issue a public GET via plain HTTP/1.1 (the public listener uses
    // h2c, which speaks both).
    const body = await new Promise<string>((resolve, reject) => {
      const req = httpRequest({
        host: "127.0.0.1",
        port: publicPort,
        path: "/api/notes",
        method: "GET",
        headers: { host: "test.my.kryton.ai", connection: "close" },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString()));
        // Silence socket-level shutdown errors that Node otherwise
        // surfaces as an uncaught exception in the test runner.
        if (res.socket) res.socket.on("error", () => undefined);
      });
      req.on("error", reject);
      req.on("socket", (s) => s.on("error", () => undefined));
      req.end();
    });
    expect(body).toContain("hello from kryton (/api/notes)");

    await client.stop();
  }, 15000);
});

async function waitForListener(host: string, port: number, timeoutMs: number): Promise<void> {
  // Plain TCP probe — we just want to know "the port is accepting
  // connections", not exchange any HTTP bytes. (HTTP GET against the
  // control listener fails because it only accepts CONNECT, and the
  // resulting ECONNRESET surfaces in vitest as a noisy unhandled
  // error.)
  const { Socket } = await import("node:net");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const opened = await new Promise<boolean>((resolve) => {
      const sock = new Socket();
      sock.setTimeout(200);
      sock.once("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.once("error", () => {
        sock.destroy();
        resolve(false);
      });
      sock.once("timeout", () => {
        sock.destroy();
        resolve(false);
      });
      sock.connect(port, host);
    });
    if (opened) return;
    await delay(50);
  }
  throw new Error(`listener ${host}:${port} did not open within ${timeoutMs}ms`);
}
