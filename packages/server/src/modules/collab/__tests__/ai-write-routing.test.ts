import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
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
 * Phase 1.5 — AI write routing.
 *
 * When a Y.Doc is live for `(path, userId)`, a server-initiated write
 * (MCP `update_note`, daily note, etc.) must apply INTO the Y.Doc rather
 * than touching disk directly. Connected clients see the AI edit as a
 * normal Y broadcast; the Y flush is the single chokepoint for disk
 * persistence + vault event emission downstream.
 */

class RoutingTestClient {
  readonly doc = new Y.Doc();
  private ws: NodeWebSocket;
  private opened: Promise<void>;
  private serverReplied: Promise<void>;
  private resolveServerReplied!: () => void;

  constructor(url: string, token: string) {
    this.ws = new NodeWebSocket(url, ["kryton-token", token]);
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
        this.resolveServerReplied();
      }
    });
  }

  async ready(): Promise<void> {
    await this.opened;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.ws.send(encoding.toUint8Array(enc));
    await this.serverReplied;
  }

  close(): void {
    this.ws.close();
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await sleep(50);
  }
  throw new Error(
    `waitFor: predicate did not become true within ${timeoutMs}ms — ${predicate.toString()}`,
  );
}

async function makeAuth(app: FastifyInstance): Promise<{ userId: string; token: string }> {
  const userId = `u-airoute-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  await app.db.insert(userTable).values({
    id: userId,
    email: `airoute-${Date.now()}-${Math.random()}@test.local`,
    name: "AI Route Test User",
    emailVerified: false,
  });
  const crypto = await import("crypto");
  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const agentName = `airoute-test-${Date.now()}-${Math.random()}`;
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

describe("collab AI write routing", () => {
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

  it(
    "routes app.notes.writeNote into the live Y.Doc when a session is open",
    { timeout: 30_000 },
    async () => {
      const auth = await makeAuth(app);

      const docId = `airoute-${Date.now()}.md`;
      const initial = "initial line\n";
      await app.notes.writeNote(docId, initial, auth.userId);

      const url = `${baseUrl}/ws/yjs/${encodeURIComponent(docId)}`;
      const client = new RoutingTestClient(url, auth.token);
      await client.ready();

      await waitFor(
        () => client.doc.getText("content").toString() === initial,
        10_000,
      );

      // Server-initiated write through app.notes.writeNote. Because a
      // live Y.Doc exists, this should route into Y rather than touching
      // disk directly. The client must observe the replacement via the
      // broadcast pipeline.
      const aiContent = "rewritten by AI\n";
      await app.notes.writeNote(docId, aiContent, auth.userId, {
        clientId: null,
        agentId: "agent-test",
        agentName: "Test Agent",
      });

      await waitFor(
        () => client.doc.getText("content").toString() === aiContent,
        10_000,
      );
      expect(client.doc.getText("content").toString()).toBe(aiContent);

      // Eventually the Y flush writes back to disk too. The idle debounce
      // is 2s — give it room.
      const userDir = await app.notes.getUserNotesDir(auth.userId);
      const fullPath = path.join(userDir, docId);
      await waitFor(async () => {
        try {
          return (await fs.readFile(fullPath, "utf-8")) === aiContent;
        } catch {
          return false;
        }
      }, 15_000);
      expect(await fs.readFile(fullPath, "utf-8")).toBe(aiContent);

      client.close();
    },
  );
});
