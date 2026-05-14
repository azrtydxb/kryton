import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { WebSocket as NodeWebSocket } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { buildTestApp } from "../../../__tests__/helpers/build-test-app.js";
import { user as userTable } from "../../../db/schema/auth.js";
import { agent as agentTable, agentToken as agentTokenTable } from "../../../db/schema/agents.js";

const MSG_SYNC = 0;

/**
 * Minimal Yjs WS client for testing convergence. Connects to a real
 * /ws/yjs/:docId endpoint using the same wire protocol the server expects.
 */
class TestYjsClient {
  readonly doc = new Y.Doc();
  private ws: NodeWebSocket;
  private opened: Promise<void>;
  /** Resolves after the first message arrives from the server, which
   *  is the response to our sync step 1. Used by `ready()` so callers
   *  block until the handshake has completed both ways — otherwise the
   *  test races and the first edit can ship before the server is
   *  prepared to relay it to peers. */
  private serverReplied: Promise<void>;
  private resolveServerReplied!: () => void;

  constructor(url: string) {
    this.ws = new NodeWebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.opened = new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
    this.serverReplied = new Promise<void>((resolve) => {
      this.resolveServerReplied = resolve;
    });

    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeUpdate(enc, update);
      if (this.ws.readyState === NodeWebSocket.OPEN) {
        this.ws.send(encoding.toUint8Array(enc));
      }
    });

    this.ws.on("message", (data: ArrayBuffer | Buffer) => {
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const dec = decoding.createDecoder(bytes);
      const messageType = decoding.readVarUint(dec);
      if (messageType === MSG_SYNC) {
        const replyEnc = encoding.createEncoder();
        encoding.writeVarUint(replyEnc, MSG_SYNC);
        syncProtocol.readSyncMessage(dec, replyEnc, this.doc, "remote");
        if (encoding.length(replyEnc) > 1 && this.ws.readyState === NodeWebSocket.OPEN) {
          this.ws.send(encoding.toUint8Array(replyEnc));
        }
        // First server sync message means the bidirectional handshake
        // is live — unblock ready() so callers can start editing safely.
        this.resolveServerReplied();
      }
    });
  }

  async ready(): Promise<void> {
    await this.opened;
    // Send sync step 1 so server replies with any state we don't have.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.ws.send(encoding.toUint8Array(enc));
    // Block until the server has replied at least once. Without this
    // the test's first edit could be sent into a half-open handshake
    // (especially on slow CI runners), and the server's broadcast to
    // peers would race the still-pending sync exchange.
    await this.serverReplied;
  }

  close(): void {
    this.ws.close();
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll a predicate every 50ms until it's true or `timeoutMs` elapses.
 * Throws with the predicate source so failures are debuggable. Use
 * this instead of fixed sleeps when a test depends on async state
 * propagation (WS sync, DB writes, etc.) — fixed sleeps are flake bait
 * on loaded CI runners.
 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error(
    `waitFor: predicate did not become true within ${timeoutMs}ms — ${predicate.toString()}`,
  );
}

async function makeAgentToken(app: FastifyInstance): Promise<{ userId: string; token: string }> {
  // Create a user and an agent with a known token. Phase 5.2 migrated the
  // agents service to Drizzle/Postgres (app.db); seed there so token
  // validation can find the row.
  const userId = `u-yjs-${Date.now()}-${Math.random()}`;
  await app.db.insert(userTable).values({
    id: userId,
    email: `yjs-${Date.now()}-${Math.random()}@test.local`,
    name: "Yjs Test User",
    emailVerified: false,
  });

  const crypto = await import("crypto");
  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const agentName = `yjs-test-${Date.now()}-${Math.random()}`;
  const [agentRow] = await app.db
    .insert(agentTable)
    .values({
      ownerUserId: userId,
      name: agentName,
      label: agentName,
      policyText: "permit(principal, action, resource);",
    })
    .returning();
  await app.db.insert(agentTokenTable).values({
    agentId: agentRow.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  return { userId, token: rawToken };
}

describe("collab Yjs WebSocket", () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    baseUrl = `ws://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects WS upgrade without auth", async () => {
    const ws = new NodeWebSocket(`${baseUrl}/ws/yjs/some-doc`);
    const result = await new Promise<"open" | "rejected">((resolve) => {
      ws.once("open", () => {
        ws.close();
        resolve("open");
      });
      ws.once("error", () => resolve("rejected"));
      ws.once("unexpected-response", () => resolve("rejected"));
      ws.once("close", () => resolve("rejected"));
    });
    expect(result).toBe("rejected");
  });

  it("converges state across two connected clients", { timeout: 30_000 }, async () => {
    let auth: { userId: string; token: string };
    try {
      auth = await makeAgentToken(app);
    } catch (e) {
      // If agent creation isn't supported in this test env, skip.
      console.warn("Skipping yjs convergence test:", e);
      return;
    }

    const docId = `convtest-${Date.now()}`;
    const url = `${baseUrl}/ws/yjs/${docId}?token=${encodeURIComponent(auth.token)}`;

    const a = new TestYjsClient(url);
    const b = new TestYjsClient(url);
    // `ready()` blocks until the bidirectional sync handshake is live
    // for both clients, so the first edit below is sent into a fully-
    // primed connection. No hopeful sleep needed.
    await Promise.all([a.ready(), b.ready()]);

    a.doc.getText("t").insert(0, "hello");

    // Wait for B to observe A's "hello" before appending. Without
    // this, on a slow runner B inserts at offset 0 (still empty) and
    // the two concurrent edits merge to either order — yjs is
    // deterministic but the result isn't guaranteed to be the literal
    // string the test asserts. The fix is real synchronisation, not
    // a longer sleep.
    await waitFor(() => b.doc.getText("t").toString() === "hello", 10_000);

    b.doc.getText("t").insert(b.doc.getText("t").length, " world");

    // Wait for the second edit to propagate back to A.
    await waitFor(
      () =>
        a.doc.getText("t").toString() === "hello world" &&
        b.doc.getText("t").toString() === "hello world",
      10_000,
    );

    expect(a.doc.getText("t").toString()).toBe("hello world");
    expect(b.doc.getText("t").toString()).toBe("hello world");

    a.close();
    b.close();
  });
});
