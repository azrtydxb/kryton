import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { WebSocket as NodeWebSocket } from "ws";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate } from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { buildTestApp } from "../../../__tests__/helpers/build-test-app.js";
import { user as userTable } from "../../../db/schema/auth.js";
import { agent as agentTable, agentToken as agentTokenTable } from "../../../db/schema/agents.js";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

/**
 * Synthetic agent presence — when a server-routed AI edit lands in a
 * live Y.Doc, the registry must publish a transient `kind:"agent"`
 * awareness state on the doc's Awareness so connected human clients see
 * the "AI is editing" pill without the agent needing a WS of its own.
 */

interface PresenceState {
  user?: { id?: string; name?: string; color?: string; kind?: string };
}

class PresenceClient {
  readonly doc = new Y.Doc();
  readonly awareness: Awareness;
  private ws: NodeWebSocket;
  private opened: Promise<void>;
  private syncReplied: Promise<void>;
  private resolveSyncReplied!: () => void;

  constructor(url: string, token: string) {
    this.ws = new NodeWebSocket(url, ["kryton-token", token]);
    this.ws.binaryType = "arraybuffer";
    this.awareness = new Awareness(this.doc);
    this.opened = new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
    this.syncReplied = new Promise<void>((resolve) => {
      this.resolveSyncReplied = resolve;
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
        this.resolveSyncReplied();
      } else if (messageType === MSG_AWARENESS) {
        const update = decoding.readVarUint8Array(dec);
        applyAwarenessUpdate(this.awareness, update, "remote");
      }
    });
  }

  async ready(): Promise<void> {
    await this.opened;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    this.ws.send(encoding.toUint8Array(enc));
    await this.syncReplied;
  }

  agentPresences(): PresenceState[] {
    const out: PresenceState[] = [];
    for (const [, state] of this.awareness.getStates()) {
      const s = state as PresenceState;
      if (s.user?.kind === "agent") out.push(s);
    }
    return out;
  }

  close(): void {
    this.ws.close();
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error(`waitFor: predicate did not become true within ${timeoutMs}ms`);
}

async function makeAuth(app: FastifyInstance): Promise<{ userId: string; token: string }> {
  const userId = `u-presence-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  await app.db.insert(userTable).values({
    id: userId,
    email: `presence-${Date.now()}-${Math.random()}@test.local`,
    name: "Presence Test User",
    emailVerified: false,
  });
  const crypto = await import("crypto");
  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const agentName = `presence-test-${Date.now()}-${Math.random()}`;
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

describe("collab agent awareness presence", () => {
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
    "publishes a synthetic kind:agent awareness state for MCP-driven edits and clears it after settle",
    { timeout: 30_000 },
    async () => {
      const auth = await makeAuth(app);
      const docId = `presence-${Date.now()}.md`;
      await app.notes.writeNote(docId, "seed\n", auth.userId);

      const url = `${baseUrl}/ws/yjs/${encodeURIComponent(docId)}`;
      const client = new PresenceClient(url, auth.token);
      await client.ready();
      await waitFor(() => client.doc.getText("content").toString() === "seed\n", 5_000);

      // Server-initiated AI write — should publish synthetic agent
      // presence on the doc's awareness channel.
      await app.notes.writeNote(docId, "ai edit\n", auth.userId, {
        clientId: null,
        agentId: "agent-presence-test",
        agentName: "TestBot",
      });

      await waitFor(() => client.agentPresences().length > 0, 5_000);
      const presences = client.agentPresences();
      expect(presences.length).toBe(1);
      expect(presences[0]!.user).toMatchObject({
        id: "agent-presence-test",
        name: "TestBot",
        kind: "agent",
      });
      expect(typeof presences[0]!.user!.color).toBe("string");

      // Presence should clear after the TTL (4s). Give it 6s to be safe.
      await waitFor(() => client.agentPresences().length === 0, 7_000);

      client.close();
    },
  );

  it(
    "debounces repeated edits: presence stays during back-to-back writes, expires only after quiet",
    { timeout: 30_000 },
    async () => {
      const auth = await makeAuth(app);
      const docId = `presence-debounce-${Date.now()}.md`;
      await app.notes.writeNote(docId, "x\n", auth.userId);

      const url = `${baseUrl}/ws/yjs/${encodeURIComponent(docId)}`;
      const client = new PresenceClient(url, auth.token);
      await client.ready();

      // First AI write.
      await app.notes.writeNote(docId, "a\n", auth.userId, {
        clientId: null,
        agentId: "agent-debounce",
        agentName: "Bouncer",
      });
      await waitFor(() => client.agentPresences().length > 0, 5_000);

      // After 2s, fire again — presence should still be visible.
      await sleep(2_000);
      await app.notes.writeNote(docId, "b\n", auth.userId, {
        clientId: null,
        agentId: "agent-debounce",
        agentName: "Bouncer",
      });
      await sleep(500);
      expect(client.agentPresences().length).toBe(1);

      // Now wait past the TTL with no further writes — should clear.
      await waitFor(() => client.agentPresences().length === 0, 7_000);

      client.close();
    },
  );
});
