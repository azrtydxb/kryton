import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { yjsParamsSchema, yjsQuerySchema } from "../schemas/yjs.schemas.js";
import type { YjsPersistence } from "./persistence.js";
import { extractWsToken } from "../../../lib/ws-auth.js";
import type { VaultEventOrigin } from "../../vault-events/types.js";

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

/**
 * Discriminated origin tags for server-driven Y transactions. Both
 * `applyServerEdit` (MCP/HTTP write while a doc is live) and
 * `applyDiskUpdate` (external `.md` change picked up by the watcher) tag
 * their transactions so the flush pipeline can propagate the right
 * `VaultEventOrigin` downstream into `noteService.writeNote`.
 *
 * Invariant: if `collab.hasLiveDoc(path, userId)` returns true,
 * `noteService.writeNote` MUST route through `applyServerEdit` and MUST
 * NOT touch disk directly. The Y flush is the single chokepoint for both
 * disk persistence AND vault-event emission for that path.
 */
export interface YAgentOrigin {
  kind: "agent";
  agentId: string | null;
  agentName: string | null;
  clientId: string | null;
}
export interface YDiskOrigin {
  kind: "disk";
}
export type YServerOrigin = YAgentOrigin | YDiskOrigin;

// Persistence debounce defaults (per spec §5)
const DEBOUNCE_IDLE_MS = 2_000;
const DEBOUNCE_MAX_MS = 30_000;
// Eviction grace period after last client disconnects.
const EVICT_GRACE_MS = 60_000;

/**
 * Synthetic agent-presence settle window. After a server-routed AI edit
 * lands in a live doc we publish a transient `kind:"agent"` awareness
 * state on a fresh local Awareness instance under the registry, then
 * clear it after this many milliseconds so connected human clients see a
 * brief "AI is editing" pill. Re-firing within the window resets the
 * timer (debounced so rapid-fire edits don't churn presence).
 */
const AGENT_PRESENCE_TTL_MS = 4_000;

/**
 * Deterministic hue mapping for synthetic agent presence colors. Mirrors
 * the client-side `presenceColor` agent palette (warm wedge 10°–50°) so
 * the cursor / avatar color is consistent regardless of whether the
 * agent presence was minted client-side (future WS-bearer path) or
 * server-side here.
 */
function agentPresenceColor(agentId: string): string {
  let h = 5381;
  for (let i = 0; i < agentId.length; i++) {
    h = ((h << 5) + h) ^ agentId.charCodeAt(i);
  }
  const hue = 10 + ((h >>> 0) % 40);
  return `hsl(${hue}, 72%, 50%)`;
}

interface AuthInfo {
  userId: string;
  agentId: string | null;
}

interface AgentPresence {
  /** Synthetic clientID we registered against the doc's Awareness map. */
  clientId: number;
  /** Pending clear timer; fires AGENT_PRESENCE_TTL_MS after the last edit. */
  clearTimer: NodeJS.Timeout;
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
  /**
   * Origin of the most recent edit to land in this doc. Read by the
   * flush pipeline so the resulting `noteService.writeNote` carries the
   * right `VaultEventOrigin` (agentId/agentName for server-routed AI
   * edits, null for disk-watcher edits, null for plain client typing).
   */
  lastEditOrigin: YServerOrigin | null;
  /**
   * Transient synthetic agent presences keyed by agentId. Server-routed
   * AI edits publish into here so connected human clients see an "AI is
   * editing" pill on the same awareness channel; the entry is cleared
   * after `AGENT_PRESENCE_TTL_MS` of quiet, debounced per agent.
   */
  agentPresences: Map<string, AgentPresence>;
}

export interface YjsRegistry {
  getDoc(docId: string): Y.Doc | null;
  broadcast(docId: string, msg: Uint8Array): void;
  /** Flush all dirty docs to persistence. Used on graceful shutdown. */
  flushAll(): Promise<void>;
  /**
   * True iff a live in-memory Y.Doc exists for `(docId, userId)`. The
   * notes service consults this on every write to decide whether to
   * route the content into Y (broadcasts to all peers, eventual flush
   * writes disk) or take the direct-to-disk path.
   */
  hasLiveDoc(docId: string, userId: string): boolean;
  /**
   * Apply a server-initiated content replace to a live Y.Doc. The Y
   * `doc.on("update")` listener handles broadcast + scheduling the
   * flush; the flush handles disk + DB snapshot + vault event emission.
   * No-op if the doc isn't live for that user.
   */
  applyServerEdit(
    docId: string,
    userId: string,
    origin: VaultEventOrigin,
    newContent: string,
  ): Promise<void>;
  /**
   * Apply an external `.md` change picked up by the disk watcher to a
   * live Y.Doc. Replaces the entire Y.Text content; concurrent unsaved
   * client edits will be merged by CRDT but practically lost on a full
   * text replace — same race any open-editor + file-watcher setup has.
   */
  applyDiskUpdate(docId: string, userId: string, diskContent: string): Promise<void>;
  /**
   * Lifecycle hooks driven by ensureDoc / eviction so the disk-watcher
   * module can start/stop per-user chokidar instances on demand instead
   * of watching every notes dir from cold start.
   */
  setLifecycleHandlers(handlers: {
    onUserActive?: (userId: string, notesDir: string) => void;
    onUserIdle?: (userId: string) => void;
  }): void;
}

export interface RegisterYjsOptions {
  persistence: YjsPersistence;
  /**
   * Resolves the on-disk notes directory for a user. Surfaced on the
   * registry so lifecycle hook consumers (disk watcher) can compute
   * paths without re-importing the notes module.
   */
  resolveNotesDir?: (userId: string) => Promise<string>;
}

function isYServerOrigin(o: unknown): o is YServerOrigin {
  if (typeof o !== "object" || o === null) return false;
  const kind = (o as { kind?: unknown }).kind;
  return kind === "agent" || kind === "disk";
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
  const { persistence, resolveNotesDir } = opts;
  const docs = new Map<string, DocEntry>();
  /** Per-user live-doc reference count for lifecycle hooks. */
  const userDocCounts = new Map<string, number>();
  let lifecycle: {
    onUserActive?: (userId: string, notesDir: string) => void;
    onUserIdle?: (userId: string) => void;
  } = {};

  const incUserCount = async (userId: string): Promise<void> => {
    const prev = userDocCounts.get(userId) ?? 0;
    userDocCounts.set(userId, prev + 1);
    if (prev === 0 && lifecycle.onUserActive && resolveNotesDir) {
      try {
        const dir = await resolveNotesDir(userId);
        lifecycle.onUserActive(userId, dir);
      } catch (err) {
        app.log.warn({ err, userId }, "disk-watcher onUserActive failed");
      }
    }
  };
  const decUserCount = (userId: string): void => {
    const prev = userDocCounts.get(userId) ?? 0;
    if (prev <= 1) {
      userDocCounts.delete(userId);
      if (lifecycle.onUserIdle) {
        try {
          lifecycle.onUserIdle(userId);
        } catch (err) {
          app.log.warn({ err, userId }, "disk-watcher onUserIdle failed");
        }
      }
    } else {
      userDocCounts.set(userId, prev - 1);
    }
  };
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
    // Snapshot the origin at flush time so multiple back-to-back edits
    // don't lose attribution for the earlier one. The flush is the
    // single chokepoint for downstream vault-event emission per the
    // Phase 1.5 invariant.
    const flushOrigin = entry.lastEditOrigin;
    entry.lastEditOrigin = null;
    const p = (async (): Promise<void> => {
      try {
        await persistence.flushToDisk(entry.docId, entry.userId, entry.doc, flushOrigin);
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
   * Mint a stable synthetic Awareness clientID for an agent. Real Y
   * client IDs come from `doc.clientID` which yjs generates as a 32-bit
   * unsigned random; pushing the synthetic id into the negative half of
   * the int range avoids any plausible collision while keeping the
   * value a finite number (the y-protocols encoder writes varints).
   *
   * Stable across calls for the same agentId so repeated edits update
   * the SAME awareness entry instead of stacking presences.
   */
  const agentClientId = (agentId: string): number => {
    let h = 5381;
    for (let i = 0; i < agentId.length; i++) {
      h = ((h << 5) + h) ^ agentId.charCodeAt(i);
    }
    // Map into a high positive band well above any realistic yjs random.
    // 2^31 + (h mod 2^30) keeps it in a 31-bit unsigned region that
    // varint encoding tolerates and that yjs clientID generation never
    // hits in practice.
    return 0x7000_0000 + ((h >>> 0) & 0x0fff_ffff);
  };

  const publishAgentPresence = (
    entry: DocEntry,
    agentId: string,
    agentName: string,
  ): void => {
    const clientId = agentClientId(agentId);
    const existing = entry.agentPresences.get(agentId);
    // Idempotent state: write a fresh awareness entry every time so the
    // clock advances and the encoded update broadcasts to peers (even
    // if the same agent re-fires before the TTL elapses).
    const state = {
      user: {
        id: agentId,
        name: agentName,
        color: agentPresenceColor(agentId),
        kind: "agent" as const,
      },
    };
    const prevMeta = entry.awareness.meta.get(clientId);
    // Start at clock=1 so the client's `applyAwarenessUpdate` accepts
    // the entry — its check is `currClock < clock`, and currClock for
    // an unknown client defaults to 0. A clock of 0 would be silently
    // dropped on the receiving end.
    const clock = prevMeta === undefined ? 1 : prevMeta.clock + 1;
    const isNew = !entry.awareness.states.has(clientId);
    entry.awareness.states.set(clientId, state);
    entry.awareness.meta.set(clientId, {
      clock,
      lastUpdated: Date.now(),
    });
    entry.awareness.emit("update", [
      { added: isNew ? [clientId] : [], updated: isNew ? [] : [clientId], removed: [] },
      "server",
    ]);

    if (existing) clearTimeout(existing.clearTimer);
    const clearTimer = setTimeout(() => {
      const presence = entry.agentPresences.get(agentId);
      if (!presence) return;
      const meta = entry.awareness.meta.get(clientId);
      const nextClock = (meta?.clock ?? 0) + 1;
      entry.awareness.states.delete(clientId);
      entry.awareness.meta.set(clientId, {
        clock: nextClock,
        lastUpdated: Date.now(),
      });
      entry.awareness.emit("update", [
        { added: [], updated: [], removed: [clientId] },
        "server",
      ]);
      entry.agentPresences.delete(agentId);
    }, AGENT_PRESENCE_TTL_MS);
    // Don't keep the event loop alive on the timer alone — when the
    // process is otherwise idle the presence clear is best-effort.
    if (typeof clearTimer.unref === "function") clearTimer.unref();
    entry.agentPresences.set(agentId, { clientId, clearTimer });
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
        lastEditOrigin: null,
        agentPresences: new Map(),
      };
      docs.set(docId, entry);
      await incUserCount(auth.userId);

      doc.on("update", (update: Uint8Array, origin: unknown) => {
        // Track the most recent edit origin so the flush knows which
        // `VaultEventOrigin` to emit downstream. Client-driven edits
        // arrive with origin = the WebSocket; server-driven edits
        // arrive with one of YAgentOrigin | YDiskOrigin.
        if (isYServerOrigin(origin)) {
          entry.lastEditOrigin = origin;
        } else {
          entry.lastEditOrigin = null;
        }
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
    // Register the message handler BEFORE awaiting ensureDoc. ensureDoc can
    // take many ms (DB lookup + disk read + seed transaction); during that
    // window the client may already have sent its sync step 1. Without an
    // attached "message" listener those early frames are silently dropped
    // by the underlying EventEmitter — leaving the client waiting for a
    // step 2 reply that will never come. Buffering early messages and
    // replaying them once ensureDoc resolves keeps the sync handshake
    // resilient to local-loopback timing where there is no network RTT to
    // mask the gap (tests + same-host clients).
    const entryReady: Promise<DocEntry> = ensureDoc(docId, auth);
    const earlyMessages: Buffer[] = [];
    let entry: DocEntry | null = null;

    const handleSyncFrame = (data: Buffer): void => {
      if (!entry) {
        earlyMessages.push(data);
        return;
      }
      try {
        const dec = decoding.createDecoder(new Uint8Array(data));
        const messageType = decoding.readVarUint(dec);
        if (messageType === MSG_SYNC) {
          const replyEnc = encoding.createEncoder();
          encoding.writeVarUint(replyEnc, MSG_SYNC);
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
    };

    socket.on("message", handleSyncFrame);

    entry = await entryReady;
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

    // Replay anything the client sent while ensureDoc was still resolving.
    // Order is preserved (FIFO from the buffer).
    for (const buffered of earlyMessages) {
      handleSyncFrame(buffered);
    }
    earlyMessages.length = 0;

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
            for (const presence of entry.agentPresences.values()) {
              clearTimeout(presence.clearTimer);
            }
            entry.agentPresences.clear();
            docs.delete(docId);
            decUserCount(entry.userId);
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
      const token = extractWsToken(req);
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
    hasLiveDoc(docId, userId) {
      const entry = docs.get(docId);
      return entry !== undefined && entry.userId === userId;
    },
    async applyServerEdit(docId, userId, origin, newContent) {
      const entry = docs.get(docId);
      if (!entry || entry.userId !== userId) return;
      const yOrigin: YAgentOrigin = {
        kind: "agent",
        agentId: origin.agentId,
        agentName: origin.agentName,
        clientId: origin.clientId,
      };
      const ytext = entry.doc.getText("content");
      entry.doc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, newContent);
      }, yOrigin);
      // Publish a transient agent presence so human collaborators see
      // an "AI is editing" pill on the same awareness channel. Skipped
      // for non-agent server writes (e.g. raw HTTP PUT with no agent).
      if (origin.agentId) {
        publishAgentPresence(entry, origin.agentId, origin.agentName ?? "AI");
      }
    },
    async applyDiskUpdate(docId, userId, diskContent) {
      const entry = docs.get(docId);
      if (!entry || entry.userId !== userId) return;
      const ytext = entry.doc.getText("content");
      if (ytext.toString() === diskContent) return;
      const yOrigin: YDiskOrigin = { kind: "disk" };
      entry.doc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, diskContent);
      }, yOrigin);
    },
    setLifecycleHandlers(handlers) {
      lifecycle = handlers;
    },
  };

  return registry;
}
