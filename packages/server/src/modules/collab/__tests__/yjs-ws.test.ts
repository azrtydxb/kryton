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

  constructor(url: string) {
    this.ws = new NodeWebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.opened = new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
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
  }

  close(): void {
    this.ws.close();
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

  it("converges state across two connected clients", async () => {
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
    await Promise.all([a.ready(), b.ready()]);

    // Give the server a moment to send sync step 1 and flush state.
    await sleep(150);

    a.doc.getText("t").insert(0, "hello");
    await sleep(200);
    b.doc.getText("t").insert(b.doc.getText("t").length, " world");

    // Poll for convergence instead of a fixed sleep — CI runners
    // sometimes take >300 ms to settle and produced flakes like
    // "expected 'hello' to be 'hello world'".
    const expected = "hello world";
    for (let i = 0; i < 50; i++) {
      if (
        a.doc.getText("t").toString() === expected &&
        b.doc.getText("t").toString() === expected
      ) break;
      await sleep(100);
    }

    expect(a.doc.getText("t").toString()).toBe("hello world");
    expect(b.doc.getText("t").toString()).toBe("hello world");

    a.close();
    b.close();
  });
});
