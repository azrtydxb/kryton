/**
 * Shared utilities for Yjs stress scripts.
 *
 * IMPORTANT FINDING: The production server has a WebSocket routing conflict.
 * PluginWebSocket (registered first with {server, path:"/ws/plugins"}) intercepts
 * ALL upgrade events before the Yjs handler gets them. When the path doesn't match
 * /ws/plugins, ws library calls abortHandshake(socket, 400) — destroying the socket
 * before the Yjs httpServer.on('upgrade',...) listener runs.
 *
 * These stress scripts work around this by spawning a minimal in-process Yjs server
 * on a dedicated port (3099 by default) using the same yjs-server.ts module.
 */

import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

export const YJS_PORT = parseInt(process.env.YJS_BENCH_PORT ?? "3099", 10);
export const YJS_URL = `ws://localhost:${YJS_PORT}`;
export const SERVER_URL = process.env.BENCH_SERVER_URL ?? "http://localhost:3001";
export const BENCH_EMAIL = process.env.BENCH_EMAIL ?? "bench@test.local";
export const BENCH_PASSWORD = process.env.BENCH_PASSWORD ?? "Bench123!";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthSession {
  token: string;
  userId: string;
  cookieHeader: string;
}

const AUTH_HEADERS = {
  "Content-Type": "application/json",
  "Origin": process.env.APP_URL ?? "http://localhost:5173",
};

export async function provisionUser(
  serverUrl = SERVER_URL,
  email = BENCH_EMAIL,
  password = BENCH_PASSWORD,
): Promise<AuthSession> {
  const trySignIn = await fetch(`${serverUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ email, password }),
  });

  if (trySignIn.ok) {
    const body = (await trySignIn.json()) as { token: string; user: { id: string } };
    const raw = trySignIn.headers.get("set-cookie") ?? "";
    const cookieHeader = extractSessionCookie(raw, body.token);
    return { token: body.token, userId: body.user.id, cookieHeader };
  }

  const reg = await fetch(`${serverUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ email, password, name: "Yjs Bench User" }),
  });
  if (!reg.ok) throw new Error(`Registration failed: ${reg.status} ${await reg.text()}`);
  const regBody = (await reg.json()) as { token: string; user: { id: string } };
  const raw = reg.headers.get("set-cookie") ?? "";
  const cookieHeader = extractSessionCookie(raw, regBody.token);
  return { token: regBody.token, userId: regBody.user.id, cookieHeader };
}

function extractSessionCookie(setCookieHeader: string, fallbackToken: string): string {
  const match = setCookieHeader.match(/better-auth\.session_token=([^;]+)/);
  if (match) return `better-auth.session_token=${match[1]}`;
  return `better-auth.session_token=${encodeURIComponent(fallbackToken)}`;
}

// ---------------------------------------------------------------------------
// Minimal in-process Yjs server (bypasses the production routing bug)
// ---------------------------------------------------------------------------

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

interface DocEntry {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  clients: Set<WebSocket>;
}

const docs = new Map<string, DocEntry>();

function broadcastExcept(clients: Set<WebSocket>, msg: Uint8Array, exclude?: WebSocket): void {
  for (const c of clients) {
    if (c !== exclude && c.readyState === WebSocket.OPEN) c.send(msg);
  }
}

function onWsMessage(ws: WebSocket, entry: DocEntry, data: Buffer): void {
  try {
    const dec = decoding.createDecoder(new Uint8Array(data));
    const messageType = decoding.readVarUint(dec);
    if (messageType === MSG_SYNC) {
      const replyEnc = encoding.createEncoder();
      encoding.writeVarUint(replyEnc, MSG_SYNC);
      syncProtocol.readSyncMessage(dec, replyEnc, entry.doc, ws);
      if (encoding.length(replyEnc) > 1) ws.send(encoding.toUint8Array(replyEnc));
    } else if (messageType === MSG_AWARENESS) {
      const update = decoding.readVarUint8Array(dec);
      awarenessProtocol.applyAwarenessUpdate(entry.awareness, update, ws);
    }
  } catch {
    // ignore parse errors
  }
}

function getOrCreateEntry(docId: string): DocEntry {
  let entry = docs.get(docId);
  if (!entry) {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    entry = { doc, awareness, clients: new Set() };
    docs.set(docId, entry);

    doc.on("update", (update: Uint8Array, origin: unknown) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeUpdate(enc, update);
      const msg = encoding.toUint8Array(enc);
      broadcastExcept(entry!.clients, msg, origin as WebSocket);
    });

    awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changed = [...added, ...updated, ...removed];
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
      const msg = encoding.toUint8Array(enc);
      for (const c of entry!.clients) {
        if (c.readyState === WebSocket.OPEN) c.send(msg);
      }
    });
  }
  return entry;
}

export interface StressServer {
  close: () => Promise<void>;
  resetDocs: () => void;
}

/**
 * Spin up a minimal in-process Yjs WebSocket server on YJS_PORT.
 * Authentication is bypassed (all connections accepted) for stress testing.
 */
export function startStressServer(): Promise<StressServer> {
  return new Promise((resolve, reject) => {
    const httpServer = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });

    const wss = new WebSocketServer({ noServer: true });

    httpServer.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", `http://localhost:${YJS_PORT}`);
      const match = url.pathname.match(/^\/ws\/yjs\/([^/?]+)$/);
      if (!match) {
        socket.destroy();
        return;
      }
      const docId = decodeURIComponent(match[1]);
      wss.handleUpgrade(req, socket, head, (ws) => {
        const entry = getOrCreateEntry(docId);
        entry.clients.add(ws);

        // Send sync step 1
        const step1Enc = encoding.createEncoder();
        encoding.writeVarUint(step1Enc, MSG_SYNC);
        syncProtocol.writeSyncStep1(step1Enc, entry.doc);
        ws.send(encoding.toUint8Array(step1Enc));

        ws.on("message", (data: Buffer) => onWsMessage(ws, entry, data));
        ws.on("close", () => {
          entry.clients.delete(ws);
          awarenessProtocol.removeAwarenessStates(entry.awareness, [ws as unknown as number], "close");
          // Keep doc in memory for 30s after all clients disconnect (allows reconnect)
          if (entry.clients.size === 0) {
            setTimeout(() => {
              if (entry && entry.clients.size === 0) docs.delete(docId);
            }, 30_000);
          }
        });
        ws.on("error", () => {
          entry.clients.delete(ws);
        });
      });
    });

    httpServer.listen(YJS_PORT, () => {
      resolve({
        close: () =>
          new Promise<void>((res) => {
            wss.close(() => {
              httpServer.close(() => res());
            });
          }),
        resetDocs: () => docs.clear(),
      });
    });

    httpServer.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// WS client helpers
// ---------------------------------------------------------------------------

export interface YjsClient {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  ws: WebSocket;
  synced: boolean;
  close: () => void;
}

export function connectYjsClient(docId: string, port = YJS_PORT): Promise<YjsClient> {
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    const ws = new WebSocket(`ws://localhost:${port}/ws/yjs/${encodeURIComponent(docId)}`);
    let synced = false;

    ws.binaryType = "arraybuffer";

    ws.on("open", () => {
      // Send sync step 1
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeSyncStep1(enc, doc);
      ws.send(encoding.toUint8Array(enc));
    });

    ws.on("message", (data: ArrayBuffer | Buffer) => {
      const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
      const dec = decoding.createDecoder(buf);
      const messageType = decoding.readVarUint(dec);

      if (messageType === MSG_SYNC) {
        const replyEnc = encoding.createEncoder();
        encoding.writeVarUint(replyEnc, MSG_SYNC);
        const syncMsg = syncProtocol.readSyncMessage(dec, replyEnc, doc, null);
        if (encoding.length(replyEnc) > 1) ws.send(encoding.toUint8Array(replyEnc));

        if (!synced && syncMsg === syncProtocol.messageYjsSyncStep2) {
          synced = true;
          const client: YjsClient = { doc, awareness, ws, synced, close: () => ws.close() };
          resolve(client);
        } else if (!synced) {
          // Step1 from server → we send step2
          synced = true;
          const client: YjsClient = { doc, awareness, ws, synced, close: () => ws.close() };
          resolve(client);
        }
      } else if (messageType === MSG_AWARENESS) {
        const update = decoding.readVarUint8Array(dec);
        awarenessProtocol.applyAwarenessUpdate(awareness, update, ws as unknown as number);
      }
    });

    ws.on("error", (err) => {
      if (!synced) reject(err);
    });

    setTimeout(() => {
      if (!synced) {
        ws.terminate();
        reject(new Error("WS connection timed out after 5s"));
      }
    }, 5000);
  });
}

export function sendYjsUpdate(ws: WebSocket, update: Uint8Array): void {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_SYNC);
  syncProtocol.writeUpdate(enc, update);
  ws.send(encoding.toUint8Array(enc));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function nowISO(): string {
  return new Date().toISOString();
}
