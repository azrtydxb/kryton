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
 * Phase 1.5 — disk watcher.
 *
 * When an external process rewrites a `.md` file while a Y.Doc is live
 * for that path, the per-user chokidar watcher must propagate the new
 * content into Y so connected clients see it. Our own `writeNote` echoes
 * must be deduped via the `selfWriteCache` populated by `recordSelfWrite`.
 */

class WatcherTestClient {
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
  const userId = `u-watch-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  await app.db.insert(userTable).values({
    id: userId,
    email: `watch-${Date.now()}-${Math.random()}@test.local`,
    name: "Disk Watcher Test User",
    emailVerified: false,
  });
  const crypto = await import("crypto");
  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const agentName = `watch-test-${Date.now()}-${Math.random()}`;
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

describe("collab disk watcher", () => {
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
    "propagates external .md edits into the live Y.Doc",
    { timeout: 45_000 },
    async () => {
      const auth = await makeAuth(app);

      const docId = `extedit-${Date.now()}.md`;
      const initial = "initial body\n";
      await app.notes.writeNote(docId, initial, auth.userId);

      const url = `${baseUrl}/ws/yjs/${encodeURIComponent(docId)}`;
      const client = new WatcherTestClient(url, auth.token);
      await client.ready();

      await waitFor(
        () => client.doc.getText("content").toString() === initial,
        10_000,
      );

      // Give the chokidar watcher a moment to finish its initial scan
      // before we modify the file. `awaitWriteFinish` adds 200ms of
      // settling on top of that.
      await sleep(500);

      // Externally rewrite the .md file (simulates git pull / vim save).
      const userDir = await app.notes.getUserNotesDir(auth.userId);
      const fullPath = path.join(userDir, docId);
      const external = "rewritten by an external editor\n";
      await fs.writeFile(fullPath, external, "utf-8");

      // The watcher should pick it up, call applyDiskUpdate, and the
      // client should see the Y broadcast with the new content.
      await waitFor(
        () => client.doc.getText("content").toString() === external,
        20_000,
      );
      expect(client.doc.getText("content").toString()).toBe(external);

      client.close();
    },
  );

  it(
    "skips self-write echoes (writeNote into live doc routes through Y, not loop)",
    { timeout: 30_000 },
    async () => {
      const auth = await makeAuth(app);

      const docId = `selfecho-${Date.now()}.md`;
      const initial = "initial\n";
      await app.notes.writeNote(docId, initial, auth.userId);

      const url = `${baseUrl}/ws/yjs/${encodeURIComponent(docId)}`;
      const client = new WatcherTestClient(url, auth.token);
      await client.ready();

      await waitFor(
        () => client.doc.getText("content").toString() === initial,
        10_000,
      );

      await sleep(500);

      // Call writeNote with a live doc — routes through Y. The Y flush
      // (debounced 2s) writes disk, and the disk-watcher event for that
      // write must be suppressed by the self-write cache (sha matches).
      // The client should converge on the new content exactly once; it
      // should NOT see a second redundant Y update.
      const aiContent = "ai write\n";
      await app.notes.writeNote(docId, aiContent, auth.userId, {
        clientId: null,
        agentId: "agent-self",
        agentName: "Self Echo Agent",
      });

      await waitFor(
        () => client.doc.getText("content").toString() === aiContent,
        10_000,
      );

      // Wait through the flush + a generous buffer for any spurious
      // watcher loop; assert content remains stable.
      await sleep(4_000);
      expect(client.doc.getText("content").toString()).toBe(aiContent);

      client.close();
    },
  );
});
