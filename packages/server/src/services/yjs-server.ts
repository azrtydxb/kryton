import { Server as HttpServer, IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { loadYjsDoc, saveYjsSnapshot, appendYjsUpdate } from "./yjs-persistence.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("yjs-server");

// Message type constants (Yjs protocol)
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthResult {
  userId: string;
  agentId: string | null;
}

export interface YjsServerOptions {
  /** Verify a token from the WebSocket query string. Return null to reject. */
  authenticate: (token: string) => Promise<AuthResult | null>;
  /** Number of updates before auto-compacting. Default: 100 */
  compactAfterUpdates?: number;
  /** Time in ms between auto-compacts. Default: 60_000 */
  compactIntervalMs?: number;
}

interface DocEntry {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  clients: Set<WebSocket>;
  updateCount: number;
  lastSnapshot: number;
  userId: string;
}

// In-process document registry
const docs = new Map<string, DocEntry>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSyncUpdateMsg(update: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_SYNC);
  syncProtocol.writeUpdate(enc, update);
  return encoding.toUint8Array(enc);
}

function broadcastExcept(clients: Set<WebSocket>, msg: Uint8Array, exclude?: WebSocket): void {
  for (const c of clients) {
    if (c !== exclude && c.readyState === WebSocket.OPEN) {
      c.send(msg);
    }
  }
}

// ---------------------------------------------------------------------------
// Connection handler
// ---------------------------------------------------------------------------

async function onConnection(
  ws: WebSocket,
  docId: string,
  auth: AuthResult,
  opts: Required<YjsServerOptions>,
): Promise<void> {
  log.debug(`onConnection start, docId: ${docId}, userId: ${auth.userId}`);
  let entry = docs.get(docId);

  if (!entry) {
    const doc = (await loadYjsDoc(docId, auth.userId)) ?? new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    entry = {
      doc,
      awareness,
      clients: new Set(),
      updateCount: 0,
      lastSnapshot: Date.now(),
      userId: auth.userId,
    };
    docs.set(docId, entry);

    // Listen for document updates (from any connected client)
    doc.on("update", async (update: Uint8Array, origin: unknown) => {
      // Persist to update log
      await appendYjsUpdate(docId, update, auth.agentId).catch((e) =>
        log.warn("appendYjsUpdate failed", e)
      );
      entry!.updateCount++;

      // Broadcast to all other clients
      const msg = makeSyncUpdateMsg(update);
      broadcastExcept(entry!.clients, msg, origin as WebSocket | undefined);

      // Auto-compact if threshold reached
      const shouldCompact =
        entry!.updateCount >= opts.compactAfterUpdates ||
        Date.now() - entry!.lastSnapshot >= opts.compactIntervalMs;
      if (shouldCompact) {
        await saveYjsSnapshot(docId, entry!.userId, entry!.doc).catch((e) =>
          log.warn("saveYjsSnapshot failed", e)
        );
        entry!.updateCount = 0;
        entry!.lastSnapshot = Date.now();
      }
    });

    // Awareness changes — broadcast to all clients
    awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changedClients = [...added, ...updated, ...removed];
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients));
      const msg = encoding.toUint8Array(enc);
      for (const c of entry!.clients) {
        if (c.readyState === WebSocket.OPEN) c.send(msg);
      }
    });
  }

  entry.clients.add(ws);

  // Send sync step 1 to new client (full state vector)
  const step1Enc = encoding.createEncoder();
  encoding.writeVarUint(step1Enc, MSG_SYNC);
  syncProtocol.writeSyncStep1(step1Enc, entry.doc);
  ws.send(encoding.toUint8Array(step1Enc));

  // Send current awareness state to new client
  const awarenessStates = entry.awareness.getStates();
  if (awarenessStates.size > 0) {
    const awarenessEnc = encoding.createEncoder();
    encoding.writeVarUint(awarenessEnc, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      awarenessEnc,
      awarenessProtocol.encodeAwarenessUpdate(entry.awareness, Array.from(awarenessStates.keys())),
    );
    ws.send(encoding.toUint8Array(awarenessEnc));
  }

  // Handle incoming messages
  ws.on("message", (data: Buffer) => {
    if (!entry) return;
    try {
      const dec = decoding.createDecoder(new Uint8Array(data));
      const messageType = decoding.readVarUint(dec);

      if (messageType === MSG_SYNC) {
        const replyEnc = encoding.createEncoder();
        encoding.writeVarUint(replyEnc, MSG_SYNC);
        // Pass ws as origin so the update listener can skip broadcasting back to sender
        syncProtocol.readSyncMessage(dec, replyEnc, entry.doc, ws);
        if (encoding.length(replyEnc) > 1) {
          ws.send(encoding.toUint8Array(replyEnc));
        }
      } else if (messageType === MSG_AWARENESS) {
        const update = decoding.readVarUint8Array(dec);
        awarenessProtocol.applyAwarenessUpdate(entry.awareness, update, ws);
      }
    } catch (e) {
      log.warn("Error processing Yjs message", e);
    }
  });

  ws.on("close", () => {
    if (!entry) return;
    entry.clients.delete(ws);
    awarenessProtocol.removeAwarenessStates(entry.awareness, [ws as unknown as number], "close");

    if (entry.clients.size === 0) {
      // Persist final snapshot when all clients disconnect
      saveYjsSnapshot(docId, entry.userId, entry.doc).catch((e) =>
        log.warn("Final snapshot failed", e)
      );
      // Keep entry in memory for 5 minutes to avoid reloading on reconnect
      setTimeout(() => {
        if (entry && entry.clients.size === 0) {
          docs.delete(docId);
        }
      }, 5 * 60 * 1000);
    }
  });

  ws.on("error", (err) => {
    log.warn("Yjs WebSocket error", err);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attach Yjs WebSocket handling to an existing HTTP server.
 * Handles upgrade requests matching `/ws/yjs/:docId?token=<token>`.
 */
export function setupYjsWss(
  httpServer: HttpServer,
  wss: WebSocketServer,
  opts: YjsServerOptions,
): void {
  const fullOpts: Required<YjsServerOptions> = {
    compactAfterUpdates: opts.compactAfterUpdates ?? 100,
    compactIntervalMs: opts.compactIntervalMs ?? 60_000,
    authenticate: opts.authenticate,
  };

  httpServer.on("upgrade", async (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
    const match = url.pathname.match(/^\/ws\/yjs\/([^/?]+)$/);
    if (!match) {
      // Not our path — let other upgrade handlers handle it (or just close)
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.end();
      return;
    }

    const docId = decodeURIComponent(match[1]);
    const token = url.searchParams.get("token") ?? "";

    let authResult: AuthResult | null = null;
    try {
      authResult = await opts.authenticate(token);
    } catch (e) {
      log.warn("Yjs auth error", e);
    }

    if (!authResult) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.end();
      return;
    }

    const finalAuth = authResult;
    wss.handleUpgrade(req, socket, head, (ws) => {
      onConnection(ws, docId, finalAuth, fullOpts).catch((e) => {
        log.error("onConnection error", e);
        ws.terminate();
      });
    });
  });
}

/** Exposed for testing: clear all in-memory doc state */
export function _resetDocRegistry(): void {
  docs.clear();
}
