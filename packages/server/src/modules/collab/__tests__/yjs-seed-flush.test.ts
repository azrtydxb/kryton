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
 * Tests for Phase 1 server seed + flush behaviour:
 *  - On first WS open for a docId with no DB snapshot, Y.Text("content")
 *    must mirror the `.md` file on disk.
 *  - On debounced flush after a Y edit, the `.md` file must be rewritten
 *    via noteService.writeNote (which keeps search/graph indexes fresh).
 */

class SeedTestClient {
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
  const userId = `u-seed-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  await app.db.insert(userTable).values({
    id: userId,
    email: `seed-${Date.now()}-${Math.random()}@test.local`,
    name: "Seed Test User",
    emailVerified: false,
  });

  const crypto = await import("crypto");
  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const agentName = `seed-test-${Date.now()}-${Math.random()}`;
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

describe("collab Yjs seed + flush", () => {
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
    "seeds Y.Text(\"content\") from .md on first open (no DB snapshot)",
    { timeout: 30_000 },
    async () => {
      const auth = await makeAuth(app);

      // Write the canonical .md file directly via app.notes, but skip
      // the Y path entirely — there's no live entry yet, so writeNote
      // hits disk straight. The on-disk content is what we expect to
      // see seeded into Y.Text("content") on first WS open.
      const docId = `seed-${Date.now()}.md`;
      const seedContent = "# Hello from disk\n\nFirst paragraph.\n";
      await app.notes.writeNote(docId, seedContent, auth.userId);

      const url = `${baseUrl}/ws/yjs/${encodeURIComponent(docId)}`;
      const client = new SeedTestClient(url, auth.token);
      await client.ready();

      // After ready(), the server has replied with its full state. The
      // client should now hold the seeded content in Y.Text("content").
      await waitFor(
        () => client.doc.getText("content").toString() === seedContent,
        10_000,
      );

      expect(client.doc.getText("content").toString()).toBe(seedContent);

      client.close();
    },
  );

  it(
    "flushes Y edits back to .md via noteService.writeNote",
    { timeout: 30_000 },
    async () => {
      const auth = await makeAuth(app);

      const docId = `flush-${Date.now()}.md`;
      const initial = "initial content\n";
      await app.notes.writeNote(docId, initial, auth.userId);

      const url = `${baseUrl}/ws/yjs/${encodeURIComponent(docId)}`;
      const client = new SeedTestClient(url, auth.token);
      await client.ready();

      // Wait for seed to land on the client.
      await waitFor(
        () => client.doc.getText("content").toString() === initial,
        10_000,
      );

      // Edit through Y — the server's doc.on("update") listener will
      // receive this, schedule a flush, and after the idle debounce
      // (2s) call flushToDisk, which writes via noteService.writeNote.
      const appended = " — edited via Y\n";
      client.doc.getText("content").insert(initial.length, appended);

      // Resolve the user's on-disk path so we can poll it directly.
      const userDir = await app.notes.getUserNotesDir(auth.userId);
      const fullPath = path.join(userDir, docId);

      // The idle debounce is 2s. Poll up to 10s for the disk to reflect
      // the edit — accommodates CI slowness without being flaky.
      await waitFor(async () => {
        try {
          const onDisk = await fs.readFile(fullPath, "utf-8");
          return onDisk === initial + appended;
        } catch {
          return false;
        }
      }, 10_000);

      const finalOnDisk = await fs.readFile(fullPath, "utf-8");
      expect(finalOnDisk).toBe(initial + appended);

      client.close();
    },
  );
});
