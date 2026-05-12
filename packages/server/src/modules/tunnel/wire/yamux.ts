/**
 * Wire-compatible client implementation of hashicorp/yamux v0.
 *
 * Implements the spec at https://github.com/hashicorp/yamux/blob/master/spec.md
 *
 * Frame layout (12 bytes header + payload):
 *   ver(1) | type(1) | flags(2 BE) | streamID(4 BE) | length(4 BE)
 *
 * Types:
 *   0 DATA          (payload = length bytes)
 *   1 WINDOW_UPDATE (length = window delta in bytes)
 *   2 PING          (length = opaque value to echo)
 *   3 GO_AWAY       (length = error code)
 *
 * Flags:
 *   SYN 0x1   ACK 0x2   FIN 0x4   RST 0x8
 *
 * Streams have a 256 KiB receive window by default. Each side
 * (independently) decides when to send WINDOW_UPDATE frames to grow
 * its peer's send window. Our policy: send a WINDOW_UPDATE crediting
 * back N bytes when we've delivered N bytes to the consumer and N >=
 * window/2.
 *
 * Designed for the "Kryton initiates h2 CONNECT; tunnel server opens
 * yamux streams" topology. We're the yamux *server* (peer of
 * connection initiator under the hashicorp/yamux role model) — we
 * accept streams initiated by the remote side. Stream IDs are even.
 * For symmetry with hashicorp/yamux we never call openStream() here;
 * outbound stream open is unnecessary on the kryton client side.
 */
import { EventEmitter } from "node:events";
import { Duplex, type DuplexOptions } from "node:stream";

// Frame types.
const TYPE_DATA = 0;
const TYPE_WINDOW_UPDATE = 1;
const TYPE_PING = 2;
const TYPE_GO_AWAY = 3;

// Flags.
const FLAG_SYN = 0x1;
const FLAG_ACK = 0x2;
const FLAG_FIN = 0x4;
const FLAG_RST = 0x8;

// Header length.
const HEADER_LEN = 12;

// Default initial receive window per the yamux spec.
const INITIAL_WINDOW = 256 * 1024;

// Protocol version.
const PROTO_VERSION = 0;

// GoAway error codes.
const GO_AWAY_NORMAL = 0;
const GO_AWAY_PROTOCOL_ERROR = 1;
const GO_AWAY_INTERNAL_ERROR = 2;

interface FrameHeader {
  type: number;
  flags: number;
  streamID: number;
  length: number;
}

function writeHeader(buf: Buffer, type: number, flags: number, streamID: number, length: number): void {
  buf[0] = PROTO_VERSION;
  buf[1] = type;
  buf.writeUInt16BE(flags, 2);
  buf.writeUInt32BE(streamID, 4);
  buf.writeUInt32BE(length, 8);
}

function readHeader(buf: Buffer): FrameHeader {
  return {
    type: buf[1],
    flags: buf.readUInt16BE(2),
    streamID: buf.readUInt32BE(4),
    length: buf.readUInt32BE(8),
  };
}

/**
 * A single yamux stream. Exposed as a Node Duplex so consumers can
 * read/write/pipe through it naturally.
 */
export class YamuxStream extends Duplex {
  readonly id: number;
  private session: YamuxSession;
  private remoteAckSeen = false;
  private remoteFin = false;
  private localFin = false;
  // We can't shadow Duplex.closed (it has a public boolean reading
  // the stream's destroyed/destroyed state). Track our own under a
  // different name.
  private streamClosed = false;
  // Send window — how many bytes the remote will accept from us.
  private sendWindow = INITIAL_WINDOW;
  // Track bytes delivered to consumer for receive-window credits.
  private bytesDelivered = 0;
  // Pending writes when send window is exhausted.
  private writePending: Array<{ chunk: Buffer; resolve: () => void; reject: (e: Error) => void }> = [];

  constructor(session: YamuxSession, id: number, opts?: DuplexOptions) {
    super({
      ...opts,
      autoDestroy: true,
      allowHalfOpen: true,
    });
    this.session = session;
    this.id = id;
  }

  /** Called by session when an inbound DATA frame arrives. */
  _ingestData(payload: Buffer): void {
    if (this.push(payload)) {
      // Consumer accepted; schedule a window update credit.
      this.bytesDelivered += payload.length;
      if (this.bytesDelivered >= INITIAL_WINDOW / 2) {
        this.session._sendWindowUpdate(this.id, this.bytesDelivered, 0);
        this.bytesDelivered = 0;
      }
    } else {
      // Consumer back-pressuring — wait until _read is called before crediting.
    }
  }

  /** Called by session when an inbound WINDOW_UPDATE arrives. */
  _grantSendWindow(delta: number): void {
    this.sendWindow += delta;
    this._drainPendingWrites();
  }

  /** Called by session when a SYN-ACK flag is observed for this stream. */
  _markAck(): void {
    this.remoteAckSeen = true;
  }

  /** Called by session when FIN flag observed from remote. */
  _markRemoteFin(): void {
    if (!this.remoteFin) {
      this.remoteFin = true;
      this.push(null);
    }
  }

  /** Called by session when RST flag observed or session goes away. */
  _abortStream(err: Error): void {
    if (this.streamClosed) return;
    this.streamClosed = true;
    for (const p of this.writePending) p.reject(err);
    this.writePending = [];
    this.destroy(err);
  }

  override _read(_size: number): void {
    // Consumer is asking for more — credit the peer if we held back.
    if (this.bytesDelivered > 0) {
      this.session._sendWindowUpdate(this.id, this.bytesDelivered, 0);
      this.bytesDelivered = 0;
    }
  }

  override _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (err?: Error | null) => void): void {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, encoding) : chunk;
    if (this.streamClosed) {
      callback(new Error("stream closed"));
      return;
    }
    this.writePending.push({
      chunk: buf,
      resolve: () => callback(null),
      reject: callback,
    });
    this._drainPendingWrites();
  }

  override _final(callback: (err?: Error | null) => void): void {
    if (this.localFin || this.streamClosed) {
      callback(null);
      return;
    }
    this.localFin = true;
    // Send an empty DATA frame with FIN flag.
    try {
      this.session._sendDataFrame(this.id, Buffer.alloc(0), FLAG_FIN);
      callback(null);
    } catch (e) {
      callback(e as Error);
    }
  }

  override _destroy(err: Error | null, callback: (e: Error | null) => void): void {
    if (!this.streamClosed) {
      this.streamClosed = true;
      if (err && !this.localFin) {
        // Send RST when destroyed in error.
        try {
          this.session._sendDataFrame(this.id, Buffer.alloc(0), FLAG_RST);
        } catch {
          /* session may already be gone */
        }
      }
    }
    this.session._onStreamClosed(this.id);
    callback(err);
  }

  private _drainPendingWrites(): void {
    while (this.writePending.length > 0 && this.sendWindow > 0) {
      const next = this.writePending[0];
      const take = Math.min(next.chunk.length, this.sendWindow);
      if (take === next.chunk.length) {
        this.writePending.shift();
        try {
          this.session._sendDataFrame(this.id, next.chunk, 0);
          this.sendWindow -= take;
          next.resolve();
        } catch (e) {
          next.reject(e as Error);
        }
      } else {
        // Partial — split.
        const part = next.chunk.subarray(0, take);
        next.chunk = next.chunk.subarray(take);
        try {
          this.session._sendDataFrame(this.id, part, 0);
          this.sendWindow -= take;
        } catch (e) {
          next.reject(e as Error);
          this.writePending.shift();
        }
      }
    }
  }
}

export interface YamuxSessionOptions {
  /**
   * Underlying bidirectional bytestream — typically the body of an
   * HTTP/2 CONNECT stream.
   */
  socket: NodeJS.ReadWriteStream;
  /**
   * Logger; only `warn` / `error` / `info` are used.
   */
  log?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
  /**
   * If true, this side initiates yamux pings every `keepaliveInterval`.
   * Default false — most useful when the peer doesn't ping.
   */
  enableKeepAlive?: boolean;
  keepaliveIntervalMs?: number;
  keepaliveTimeoutMs?: number;
}

/**
 * YamuxSession multiplexes streams over a single bytestream.
 *
 * In the Kryton client context we're the side that *receives*
 * remotely-initiated streams (the tunnel server opens them to deliver
 * public requests). So the surface is mostly: parse inbound frames,
 * fire 'stream' events with new YamuxStream instances, write
 * outbound bytes for window-updates / pings / data when local code
 * writes to a stream.
 */
export class YamuxSession extends EventEmitter {
  private socket: NodeJS.ReadWriteStream;
  private log: NonNullable<YamuxSessionOptions["log"]>;
  private parseBuf: Buffer = Buffer.alloc(0);
  private streams = new Map<number, YamuxStream>();
  private closed = false;
  private pingsInflight = new Map<number, { resolve: () => void; timer: NodeJS.Timeout }>();
  private pingCounter = 0;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private opts: Required<Omit<YamuxSessionOptions, "log" | "socket">>;

  constructor(options: YamuxSessionOptions) {
    super();
    this.socket = options.socket;
    this.log = options.log ?? { info: () => {}, warn: () => {}, error: () => {} };
    this.opts = {
      enableKeepAlive: options.enableKeepAlive ?? false,
      keepaliveIntervalMs: options.keepaliveIntervalMs ?? 5_000,
      keepaliveTimeoutMs: options.keepaliveTimeoutMs ?? 15_000,
    };

    this.socket.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      this._onData(buf);
    });
    this.socket.on("end", () => this._teardown(null));
    this.socket.on("close", () => this._teardown(null));
    this.socket.on("error", (err: Error) => this._teardown(err));

    if (this.opts.enableKeepAlive) {
      this.keepaliveTimer = setInterval(() => {
        this.ping().catch(() => this._teardown(new Error("ping timeout")));
      }, this.opts.keepaliveIntervalMs);
    }
  }

  /**
   * Send a ping; resolves on ACK, rejects on keepaliveTimeoutMs.
   */
  ping(): Promise<void> {
    const id = ++this.pingCounter;
    const header = Buffer.alloc(HEADER_LEN);
    writeHeader(header, TYPE_PING, FLAG_SYN, 0, id);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pingsInflight.delete(id);
        reject(new Error("yamux ping timeout"));
      }, this.opts.keepaliveTimeoutMs);
      this.pingsInflight.set(id, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        timer,
      });
      try {
        this.socket.write(header);
      } catch (e) {
        clearTimeout(timer);
        this.pingsInflight.delete(id);
        reject(e as Error);
      }
    });
  }

  /**
   * Send GO_AWAY and tear down. Idempotent.
   */
  close(reason: "normal" | "protocol" | "internal" = "normal"): void {
    if (this.closed) return;
    this.closed = true;
    const code =
      reason === "protocol"
        ? GO_AWAY_PROTOCOL_ERROR
        : reason === "internal"
          ? GO_AWAY_INTERNAL_ERROR
          : GO_AWAY_NORMAL;
    try {
      const header = Buffer.alloc(HEADER_LEN);
      writeHeader(header, TYPE_GO_AWAY, 0, 0, code);
      this.socket.write(header);
    } catch {
      /* socket may already be dead */
    }
    this._teardown(null);
  }

  /** Internal: emit stream event for a freshly accepted inbound stream. */
  private _acceptStream(id: number): YamuxStream {
    const stream = new YamuxStream(this, id);
    this.streams.set(id, stream);
    return stream;
  }

  /** Internal: send a window-update frame crediting the remote. */
  _sendWindowUpdate(streamID: number, delta: number, flags: number): void {
    if (this.closed) return;
    const header = Buffer.alloc(HEADER_LEN);
    writeHeader(header, TYPE_WINDOW_UPDATE, flags, streamID, delta);
    this.socket.write(header);
  }

  /** Internal: send a data frame on this stream. */
  _sendDataFrame(streamID: number, payload: Buffer, flags: number): void {
    if (this.closed) throw new Error("session closed");
    const header = Buffer.alloc(HEADER_LEN);
    writeHeader(header, TYPE_DATA, flags, streamID, payload.length);
    this.socket.write(header);
    if (payload.length > 0) {
      this.socket.write(payload);
    }
  }

  _onStreamClosed(id: number): void {
    this.streams.delete(id);
  }

  private _onData(chunk: Buffer): void {
    this.parseBuf = this.parseBuf.length === 0 ? chunk : Buffer.concat([this.parseBuf, chunk]);
    while (this.parseBuf.length >= HEADER_LEN) {
      const hdr = readHeader(this.parseBuf);
      if (hdr.type === TYPE_DATA) {
        if (this.parseBuf.length < HEADER_LEN + hdr.length) return; // need more
        const payload = this.parseBuf.subarray(HEADER_LEN, HEADER_LEN + hdr.length);
        this.parseBuf = this.parseBuf.subarray(HEADER_LEN + hdr.length);
        this._handleData(hdr, payload);
      } else {
        // WINDOW_UPDATE / PING / GO_AWAY have no payload.
        const buf = this.parseBuf.subarray(0, HEADER_LEN);
        this.parseBuf = this.parseBuf.subarray(HEADER_LEN);
        this._handleControl(hdr, buf);
      }
    }
  }

  private _handleData(hdr: FrameHeader, payload: Buffer): void {
    let stream = this.streams.get(hdr.streamID);
    if (hdr.flags & FLAG_SYN) {
      if (stream) {
        this.log.warn("yamux: SYN on existing stream", { id: hdr.streamID });
      } else {
        stream = this._acceptStream(hdr.streamID);
        // Immediately ACK the stream by sending a WINDOW_UPDATE with ACK flag
        // and zero delta (per hashicorp/yamux convention).
        this._sendWindowUpdate(hdr.streamID, 0, FLAG_ACK);
        this.emit("stream", stream);
      }
    }
    if (!stream) {
      // Unknown stream — RST it.
      this._sendRST(hdr.streamID);
      return;
    }
    if (hdr.flags & FLAG_ACK) {
      stream._markAck();
    }
    if (payload.length > 0) {
      stream._ingestData(payload);
    }
    if (hdr.flags & FLAG_FIN) {
      stream._markRemoteFin();
    }
    if (hdr.flags & FLAG_RST) {
      stream._abortStream(new Error("stream reset"));
    }
  }

  private _handleControl(hdr: FrameHeader, _raw: Buffer): void {
    switch (hdr.type) {
      case TYPE_WINDOW_UPDATE: {
        if (hdr.streamID === 0) {
          // Session-level window updates are not a thing in yamux v0
          // but tolerate them gracefully.
          return;
        }
        let stream = this.streams.get(hdr.streamID);
        if (hdr.flags & FLAG_SYN) {
          if (!stream) {
            stream = this._acceptStream(hdr.streamID);
            this._sendWindowUpdate(hdr.streamID, 0, FLAG_ACK);
            this.emit("stream", stream);
          }
        }
        if (stream && hdr.length > 0) {
          stream._grantSendWindow(hdr.length);
        }
        if (stream && hdr.flags & FLAG_ACK) {
          stream._markAck();
        }
        if (stream && hdr.flags & FLAG_FIN) {
          stream._markRemoteFin();
        }
        if (stream && hdr.flags & FLAG_RST) {
          stream._abortStream(new Error("stream reset"));
        }
        return;
      }
      case TYPE_PING: {
        if (hdr.flags & FLAG_SYN) {
          // Reply with ACK + same value.
          const reply = Buffer.alloc(HEADER_LEN);
          writeHeader(reply, TYPE_PING, FLAG_ACK, 0, hdr.length);
          this.socket.write(reply);
        } else if (hdr.flags & FLAG_ACK) {
          const inflight = this.pingsInflight.get(hdr.length);
          if (inflight) {
            this.pingsInflight.delete(hdr.length);
            inflight.resolve();
          }
        }
        return;
      }
      case TYPE_GO_AWAY: {
        this.log.info("yamux: remote sent GO_AWAY", { code: hdr.length });
        this._teardown(null);
        return;
      }
      default:
        this.log.warn("yamux: unknown frame type", { type: hdr.type });
    }
  }

  private _sendRST(streamID: number): void {
    if (this.closed) return;
    const header = Buffer.alloc(HEADER_LEN);
    writeHeader(header, TYPE_DATA, FLAG_RST, streamID, 0);
    this.socket.write(header);
  }

  private _teardown(err: Error | null): void {
    if (this.closed) return;
    this.closed = true;
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    for (const [, p] of this.pingsInflight) {
      clearTimeout(p.timer);
    }
    this.pingsInflight.clear();
    for (const stream of this.streams.values()) {
      stream._abortStream(err ?? new Error("session closed"));
    }
    this.streams.clear();
    if (err) this.emit("error", err);
    this.emit("close");
  }
}
