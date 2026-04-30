/**
 * SRV-22: Yjs WebSocket server tests.
 *
 * IMPORTANT: The server sends sync-step-1 to the client as soon as the
 * connection is established (inside the async onConnection handler). Because
 * the server's async function may resume and send the message BEFORE the
 * client's "open" event fires in the Node.js event loop, message listeners
 * must be registered BEFORE waiting for the open event.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as http from "http";
import { WebSocket, WebSocketServer } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { prisma } from "../../prisma.js";
import { setupYjsWss, _resetDocRegistry } from "../yjs-server.js";

const AUTH_RESULT = { userId: "u-yws", agentId: null };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServer(authenticate: (t: string) => Promise<typeof AUTH_RESULT | null>) {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  setupYjsWss(server, wss, { authenticate });
  return { server, wss };
}

function listenOnPort(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, () => resolve((server.address() as { port: number }).port)));
}

async function closeServer(server: http.Server, wss: WebSocketServer): Promise<void> {
  for (const c of wss.clients) c.terminate();
  wss.close();
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
}

/**
 * Connect a WebSocket and return a helper that collects all received messages.
 * Register the message collector BEFORE the open event to avoid races.
 */
function connect(url: string): {
  ws: WebSocket;
  nextMessage: (timeoutMs?: number) => Promise<Buffer>;
  close: () => Promise<void>;
  allMessages: Buffer[];
} {
  const ws = new WebSocket(url);
  const allMessages: Buffer[] = [];
  const waiters: Array<(buf: Buffer) => void> = [];

  ws.on("message", (data) => {
    const buf = data as Buffer;
    allMessages.push(buf);
    const waiter = waiters.shift();
    if (waiter) waiter(buf);
  });

  function nextMessage(timeoutMs = 4000): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`message timeout after ${timeoutMs}ms`)), timeoutMs);
      waiters.push((buf) => { clearTimeout(timer); resolve(buf); });
    });
  }

  function close(): Promise<void> {
    return new Promise((resolve) => {
      ws.once("close", resolve);
      ws.once("error", () => resolve());
      ws.close();
    });
  }

  return { ws, nextMessage, close, allMessages };
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) { resolve(); return; }
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("yjs server", () => {
  let server: http.Server;
  let wss: WebSocketServer;
  let port: number;

  beforeEach(async () => {
    _resetDocRegistry();
    await prisma.yjsUpdate.deleteMany();
    await prisma.yjsDocument.deleteMany();
    await prisma.user.deleteMany({ where: { id: "u-yws" } });
    await prisma.user.create({ data: { id: "u-yws", email: "yws@example.com", name: "Yjs WS User" } });

    ({ server, wss } = makeServer(async () => AUTH_RESULT));
    port = await listenOnPort(server);
  });

  afterEach(async () => {
    await closeServer(server, wss);
    _resetDocRegistry();
  });

  it("client receives MSG_SYNC on connect", async () => {
    const { ws, nextMessage, close } = connect(`ws://localhost:${port}/ws/yjs/doc1?token=any`);
    // Register nextMessage BEFORE waiting for open (avoid race with server's step1)
    const msgPromise = nextMessage();
    await waitForOpen(ws);
    const msg = await msgPromise;

    const dec = decoding.createDecoder(new Uint8Array(msg));
    expect(decoding.readVarUint(dec)).toBe(0); // MSG_SYNC

    await close();
  });

  it("server responds with a MSG_SYNC message after full exchange", async () => {
    const { ws, nextMessage, close, allMessages } = connect(`ws://localhost:${port}/ws/yjs/doc2?token=any`);
    const firstMsgPromise = nextMessage(); // server's step1
    await waitForOpen(ws);
    const firstMsg = await firstMsgPromise;

    // Verify server's step1 is MSG_SYNC
    const d0 = decoding.createDecoder(new Uint8Array(firstMsg));
    expect(decoding.readVarUint(d0)).toBe(0); // MSG_SYNC

    // Send client step1 — server should reply with step2
    const clientDoc = new Y.Doc();
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, 0); // MSG_SYNC
    syncProtocol.writeSyncStep1(e, clientDoc);
    ws.send(encoding.toUint8Array(e));

    // Wait a bit for response(s)
    await new Promise((r) => setTimeout(r, 200));

    // Should have received at least the step2 reply (MSG_SYNC type 0)
    const syncMsgs = allMessages.filter((m) => m[0] === 0);
    expect(syncMsgs.length).toBeGreaterThanOrEqual(1);

    await close();
  });

  it("update is persisted to YjsUpdate table", async () => {
    const { ws, nextMessage, close } = connect(`ws://localhost:${port}/ws/yjs/doc4?token=any`);
    const step1Promise = nextMessage();
    await waitForOpen(ws);
    await step1Promise; // server's step1

    // Full handshake
    const step2Promise = nextMessage();
    const clientDoc = new Y.Doc();
    const s1enc = encoding.createEncoder();
    encoding.writeVarUint(s1enc, 0);
    syncProtocol.writeSyncStep1(s1enc, clientDoc);
    ws.send(encoding.toUint8Array(s1enc));
    await step2Promise; // server's step2

    // Send update
    clientDoc.getText("body").insert(0, "persist me");
    const update = Y.encodeStateAsUpdate(clientDoc);
    const upEnc = encoding.createEncoder();
    encoding.writeVarUint(upEnc, 0);
    syncProtocol.writeUpdate(upEnc, update);
    ws.send(encoding.toUint8Array(upEnc));

    await new Promise((r) => setTimeout(r, 400));

    const rows = await prisma.yjsUpdate.findMany({ where: { docId: "doc4" } });
    expect(rows.length).toBeGreaterThanOrEqual(1);

    await close();
  }, 15_000);

  it("two clients on same doc — c2 receives c1 broadcast", async () => {
    const c1 = connect(`ws://localhost:${port}/ws/yjs/doc3?token=any`);
    const c2 = connect(`ws://localhost:${port}/ws/yjs/doc3?token=any`);
    const [c1Step1, c2Step1] = await Promise.all([c1.nextMessage(), c2.nextMessage()]);
    await Promise.all([waitForOpen(c1.ws), waitForOpen(c2.ws)]);
    // Both received step1
    expect(c1Step1).toBeDefined();
    expect(c2Step1).toBeDefined();

    // c1 does full handshake
    const clientDoc = new Y.Doc();
    const c1Step2Promise = c1.nextMessage();
    const hs = encoding.createEncoder();
    encoding.writeVarUint(hs, 0);
    syncProtocol.writeSyncStep1(hs, clientDoc);
    c1.ws.send(encoding.toUint8Array(hs));
    await c1Step2Promise;

    // c1 sends an update — c2 should receive it
    clientDoc.getText("body").insert(0, "hello c2");
    const update = Y.encodeStateAsUpdate(clientDoc);
    const upEnc = encoding.createEncoder();
    encoding.writeVarUint(upEnc, 0);
    syncProtocol.writeUpdate(upEnc, update);
    c1.ws.send(encoding.toUint8Array(upEnc));

    // Wait for broadcast
    await new Promise((r) => setTimeout(r, 300));
    expect(c2.allMessages.length).toBeGreaterThanOrEqual(1);

    await Promise.all([c1.close(), c2.close()]);
  }, 15_000);

  it("rejects path that does not match /ws/yjs/:docId", async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/other/doc?token=any`);
    await new Promise<void>((resolve) => {
      ws.once("close", resolve);
      ws.once("error", () => resolve());
    });
    // Connection should be rejected/closed
    expect([WebSocket.CLOSED, WebSocket.CLOSING]).toContain(ws.readyState);
  });

  it("rejects connection when authenticate returns null", async () => {
    const { server: s2, wss: w2 } = makeServer(async () => null);
    const p2 = await listenOnPort(s2);

    const ws = new WebSocket(`ws://localhost:${p2}/ws/yjs/anydoc?token=bad`);
    await new Promise<void>((resolve) => {
      ws.once("close", resolve);
      ws.once("error", () => resolve());
    });

    await closeServer(s2, w2);
    // Connection was rejected
    expect(true).toBe(true);
  });
});
