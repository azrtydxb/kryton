import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { yjsParamsSchema, yjsQuerySchema } from "../schemas/yjs.schemas.js";
import type { YjsPersistence } from "./persistence.js";

// Yjs message type constants
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

/**
 * Transaction origin sentinel used when seeding `Y.Text("content")` from
 * the canonical `.md` file on first open. The seed transaction runs
 * BEFORE the `doc.on("update")` listener is bound, so the value of the
 * origin is currently moot — but tagging it explicitly makes the intent
 * legible and lets future listeners (Phase 1.5 disk watcher, etc.) skip
 * the seed reliably.
 */
const ORIGIN_SEED: unique symbol = Symbol("yjs-seed");

// Persistence debounce defaults (per spec §5)
const DEBOUNCE_IDLE_MS = 2_000;
const DEBOUNCE_MAX_MS = 30_000;
// Eviction grace period after last client disconnects.
const EVICT_GRACE_MS = 60_000;

interface AuthInfo {
  userId: string;
  agentId: string | null;
}

interface DocEntry {
  docId: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  clients: Set<WebSocket>;
  userId: string;
  dirty: boolean;
  // Debounce state
  idleTimer: NodeJS.Timeout | null;
  maxTimer: NodeJS.Timeout | null;
  // Persistence in-flight flag (writes are out-of-band)
  flushing: Promise<void> | null;
  evictTimer: NodeJS.Timeout | null;
}

export interface YjsRegistry {
  getDoc(docId: string): Y.Doc | null;
  broadcast(docId: string, msg: Uint8Array): void;
  /** Flush all dirty docs to persistence. Used on graceful shutdown. */
  flushAll(): Promise<void>;
}

export interface RegisterYjsOptions {
  persistence: YjsPersistence;
}

function makeSyncUpdateMsg(update: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_SYNC);
  syncProtocol.writeUpdate(enc, update);
  return encoding.toUint8Array(enc);
}

/**
 * Register the Yjs WebSocket route on the given Fastify instance, and
 * return a registry handle that exposes getDoc/broadcast/flushAll for
 * use as a decorator.
 */
export function registerYjsRoutes(
  app: FastifyInstance,
  opts: RegisterYjsOptions,
): YjsRegistry {
  const { persistence } = opts;
  const docs = new Map<string, DocEntry>();
  /**
   * In-flight ensureDoc calls. Without this, two clients connecting to
   * the same docId at roughly the same moment both miss the `docs.get`
   * check, both await `persistence.loadYjsDoc()`, and both construct
   * their own Y.Doc. The second's `docs.set` wins the registry, but the
   * first connection's update handler is bound to the orphaned doc —
   * its edits never reach peers. Coalescing the lookup so the second
   * caller awaits the first's promise serialises the cache fill.
   */
  const ensureDocInFlight = new Map<string, Promise<DocEntry>>();

  const scheduleFlush = (entry: DocEntry): void => {
    entry.dirty = true;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => void doFlush(entry), DEBOUNCE_IDLE_MS);
    if (!entry.maxTimer) {
      entry.maxTimer = setTimeout(() => void doFlush(entry), DEBOUNCE_MAX_MS);
    }
  };

  const doFlush = async (entry: DocEntry): Promise<void> => {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    if (entry.maxTimer) {
      clearTimeout(entry.maxTimer);
      entry.maxTimer = null;
    }
    if (!entry.dirty) return;
    entry.dirty = false;
    // Coalesce concurrent flushes
    if (entry.flushing) {
      try {
        await entry.flushing;
      } catch {
        /* prior flush failure logged below */
      }
    }
    // Order: disk first, then DB snapshot. `.md` is the source of truth
    // for the rest of the system (search/graph indexes, git, MCP tools,
    // file tree). If the snapshot save fails after disk succeeds, we
    // mark the doc dirty again and retry — the worst case is a slightly
    // stale snapshot that gets caught up on the next flush. If we did
    // it in reverse and the disk write failed, the system of record
    // would silently lag behind the DB cache.
    const p = (async (): Promise<void> => {
      try {
        await persistence.flushToDisk(entry.docId, entry.userId, entry.doc);
      } catch (e) {
        app.log.warn({ err: e, docId: entry.docId }, "yjs flushToDisk failed");
        entry.dirty = true;
        // Don't attempt the snapshot if disk failed — keep them in lockstep
        // so we don't end up with a DB snapshot that's newer than disk.
        return;
      }
      try {
        await persistence.saveYjsSnapshot(entry.docId, entry.userId, entry.doc);
      } catch (e) {
        app.log.warn({ err: e, docId: entry.docId }, "yjs saveYjsSnapshot failed");
        entry.dirty = true;
      }
    })().finally(() => {
      entry.flushing = null;
    });
    entry.flushing = p;
    await p;
  };

  /**
   * Authorize an authenticated user against a docId before allowing
   * them to open or create the corresponding Y.Doc. Without this, any
   * authenticated user could create arbitrary docIds and accumulate
   * server-side state, and could open someone else's docId in the
   * cache (persistence.loadYjsDoc enforces user-scoping for the disk
   * snapshot, but the in-memory entry is keyed by docId alone).
   *
   * Convention: docId is the note path within the requesting user's
   * own notes directory. Shared-note collab uses HTTP today, not WS,
   * so any shared-note docId convention will need to be added here
   * when that lands.
   */
  const authorizeDoc = async (docId: string, auth: AuthInfo): Promise<void> => {
    try {
      await app.notes.readNote(docId, auth.userId);
    } catch (err) {
      app.log.debug(
        { err: err instanceof Error ? err.message : String(err), docId, userId: auth.userId },
        "yjs docId authorization failed",
      );
      throw new Error("forbidden", { cause: err });
    }
  };

  const ensureDoc = async (docId: string, auth: AuthInfo): Promise<DocEntry> => {
    // Authorize on every connection (not just cache miss). The doc may
    // have been deleted on disk or had its permissions changed since
    // the entry was last loaded; relying on the cache would silently
    // grant access until the eviction grace period elapsed.
    await authorizeDoc(docId, auth);
    const cached = docs.get(docId);
    if (cached) {
      if (cached.userId !== auth.userId) {
        // Cache collision across users — refuse rather than expose
        // another user's in-memory doc.
        throw new Error("forbidden");
      }
      // Cancel any pending eviction since a new client is connecting.
      if (cached.evictTimer) {
        clearTimeout(cached.evictTimer);
        cached.evictTimer = null;
      }
      return cached;
    }
    await authorizeDoc(docId, auth);
    // Coalesce concurrent first-time-fills so two clients connecting in
    // the same tick don't construct rival Y.Doc instances.
    const inflight = ensureDocInFlight.get(docId);
    if (inflight) return inflight;

    const buildPromise = (async (): Promise<DocEntry> => {
      const loaded = await persistence.loadYjsDoc(docId, auth.userId);
      let doc: Y.Doc;
      if (loaded) {
        // A DB snapshot exists — it's the authoritative session state.
        // Do NOT reseed from disk: any in-session edits that haven't
        // hit disk yet would be lost.
        doc = loaded;
      } else {
        doc = new Y.Doc();
        // Seed `Y.Text("content")` from the canonical `.md` file. The
        // seed transaction runs BEFORE the `doc.on("update")` listener
        // is bound below, so the seeding update is NOT recorded as an
        // inbound delta (no appendYjsUpdate, no broadcast, no flush
        // schedule). If the file is missing (note never written yet),
        // start with an empty doc — first edit will create it on flush.
        try {
          const note = await app.notes.readNote(docId, auth.userId);
          if (note.content.length > 0) {
            doc.transact(() => {
              doc.getText("content").insert(0, note.content);
            }, ORIGIN_SEED);
          }
        } catch (err) {
          // Tolerate "not found" — empty new note is a valid state.
          // Anything else (permission, corrupt disk) propagates and the
          // caller's onConnection error handler closes the socket.
          const code = (err as { code?: unknown; statusCode?: unknown })?.code;
          const status = (err as { statusCode?: unknown })?.statusCode;
          if (code !== "ENOENT" && status !== 404) {
            throw err;
          }
        }
      }
      const awareness = new awarenessProtocol.Awareness(doc);
      const entry: DocEntry = {
        docId,
        doc,
        awareness,
        clients: new Set(),
        userId: auth.userId,
        dirty: false,
        idleTimer: null,
        maxTimer: null,
        flushing: null,
        evictTimer: null,
      };
      docs.set(docId, entry);

      doc.on("update", (update: Uint8Array, origin: unknown) => {
        // Append to update log out-of-band.
        void persistence
          .appendYjsUpdate(docId, update, auth.agentId)
          .catch((e) => app.log.warn({ err: e, docId }, "appendYjsUpdate failed"));

        // Broadcast to all other clients.
        const msg = makeSyncUpdateMsg(update);
        for (const c of entry.clients) {
          if (c !== origin && c.readyState === c.OPEN) {
            c.send(msg);
          }
        }

        // Schedule debounced snapshot writeback.
        scheduleFlush(entry);
      });

      awareness.on(
        "update",
        ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
          const changedClients = [...added, ...updated, ...removed];
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MSG_AWARENESS);
          encoding.writeVarUint8Array(
            enc,
            awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
          );
          const msg = encoding.toUint8Array(enc);
          for (const c of entry.clients) {
            if (c.readyState === c.OPEN) c.send(msg);
          }
        },
      );

      return entry;
    })();

    ensureDocInFlight.set(docId, buildPromise);
    try {
      return await buildPromise;
    } finally {
      ensureDocInFlight.delete(docId);
    }
  };

  const onConnection = async (
    socket: WebSocket,
    docId: string,
    auth: AuthInfo,
  ): Promise<void> => {
    const entry = await ensureDoc(docId, auth);
    entry.clients.add(socket);

    // Send sync step 1 (state vector) so client can compute the diff to send.
    const step1Enc = encoding.createEncoder();
    encoding.writeVarUint(step1Enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(step1Enc, entry.doc);
    socket.send(encoding.toUint8Array(step1Enc));

    // Send current awareness state.
    const awarenessStates = entry.awareness.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEnc = encoding.createEncoder();
      encoding.writeVarUint(awarenessEnc, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEnc,
        awarenessProtocol.encodeAwarenessUpdate(
          entry.awareness,
          Array.from(awarenessStates.keys()),
        ),
      );
      socket.send(encoding.toUint8Array(awarenessEnc));
    }

    socket.on("message", (data: Buffer) => {
      try {
        const dec = decoding.createDecoder(new Uint8Array(data));
        const messageType = decoding.readVarUint(dec);
        if (messageType === MSG_SYNC) {
          const replyEnc = encoding.createEncoder();
          encoding.writeVarUint(replyEnc, MSG_SYNC);
          // Pass `socket` as origin so the doc.on("update") listener skips
          // broadcasting back to the sender.
          syncProtocol.readSyncMessage(dec, replyEnc, entry.doc, socket);
          if (encoding.length(replyEnc) > 1) {
            socket.send(encoding.toUint8Array(replyEnc));
          }
        } else if (messageType === MSG_AWARENESS) {
          const update = decoding.readVarUint8Array(dec);
          awarenessProtocol.applyAwarenessUpdate(entry.awareness, update, socket);
        }
      } catch (e) {
        app.log.warn(
          { err: e instanceof Error ? e.message : String(e), docId },
          "yjs message error",
        );
      }
    });

    socket.on("close", () => {
      entry.clients.delete(socket);
      awarenessProtocol.removeAwarenessStates(
        entry.awareness,
        [socket as unknown as number],
        "close",
      );
      if (entry.clients.size === 0) {
        // Flush final state immediately, then schedule eviction.
        void doFlush(entry);
        if (entry.evictTimer) clearTimeout(entry.evictTimer);
        entry.evictTimer = setTimeout(() => {
          if (entry.clients.size === 0) {
            docs.delete(docId);
          }
        }, EVICT_GRACE_MS);
      }
    });

    socket.on("error", (err) => {
      app.log.warn(
        { err: err instanceof Error ? err.message : String(err), docId },
        "yjs ws error",
      );
    });
  };

  // Extract bearer token from Sec-WebSocket-Protocol. Query-string tokens
  // are no longer accepted because they leak via access logs, browser
  // history, and proxies. Convention: a "kryton-token" marker followed
  // by the token entry. Anything else (bare subprotocols, missing
  // marker, marker without a following entry) returns null so the
  // request falls through to cookie/session auth.
  const extractToken = (req: FastifyRequest): string | null => {
    const proto = req.headers["sec-websocket-protocol"];
    if (typeof proto !== "string" || proto.length === 0) return null;
    const parts = proto.split(",").map((s) => s.trim());
    const marker = parts.indexOf("kryton-token");
    if (marker === -1) return null;
    const candidate = parts[marker + 1];
    return candidate && candidate.length > 0 ? candidate : null;
  };

  app.route({
    method: "GET",
    url: "/ws/yjs/:docId",
    schema: {
      tags: ["collab"],
      hide: true,
      params: yjsParamsSchema,
      querystring: yjsQuerySchema,
    },
    websocket: true,
    preValidation: async (req, reply) => {
      // Resolve auth before the WS upgrade. Two paths:
      //   1. Bearer-style agent token via query string / WS protocol.
      //   2. Existing session/cookie or API key header (via standard auth).
      const token = extractToken(req);
      if (token) {
        const result = await app.auth.authenticateWsToken(token);
        if (result) {
          (req as FastifyRequest & { wsAuth?: AuthInfo }).wsAuth = result;
          return;
        }
      }
      // Fall back to cookie/session resolution.
      const ctx = await app.auth.resolve(req).catch(() => null);
      if (ctx) {
        (req as FastifyRequest & { wsAuth?: AuthInfo }).wsAuth = {
          userId: ctx.user.id,
          agentId: ctx.agentId,
        };
        return;
      }
      reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Yjs WS auth failed" } });
    },
    handler: ((socket: WebSocket, req: FastifyRequest) => {
      const { docId } = req.params as { docId: string };
      const auth = (req as FastifyRequest & { wsAuth?: AuthInfo }).wsAuth;
      if (!auth) {
        socket.close(1008, "unauthenticated");
        return;
      }
      onConnection(socket, docId, auth).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "forbidden") {
          socket.close(1008, "forbidden");
          return;
        }
        app.log.error({ err: e, docId }, "yjs onConnection failed");
        socket.close(1011, "internal");
      });
    }) as never,
  });

  const registry: YjsRegistry = {
    getDoc(docId) {
      return docs.get(docId)?.doc ?? null;
    },
    broadcast(docId, msg) {
      const entry = docs.get(docId);
      if (!entry) return;
      for (const c of entry.clients) {
        if (c.readyState === c.OPEN) c.send(msg);
      }
    },
    async flushAll() {
      const tasks: Promise<void>[] = [];
      for (const entry of docs.values()) {
        tasks.push(doFlush(entry));
      }
      await Promise.allSettled(tasks);
    },
  };

  return registry;
}
