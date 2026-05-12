/**
 * Unit tests for the yamux client implementation.
 *
 * These tests construct yamux frames by hand and feed them through
 * the parser via a pair of in-memory streams. They cover the frame
 * shapes we'll actually see in production: server-initiated stream
 * SYN, DATA inbound, WINDOW_UPDATE credit grant, PING, GO_AWAY.
 *
 * Cross-implementation interop with hashicorp/yamux is covered by
 * the e2e Go-server integration test (separate file).
 */
import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";

import { YamuxSession, YamuxStream } from "../wire/yamux.js";

// Frame builder helpers — mirror writeHeader in the implementation.
const TYPE_DATA = 0;
const TYPE_WINDOW_UPDATE = 1;
const TYPE_PING = 2;
const TYPE_GO_AWAY = 3;
const FLAG_SYN = 0x1;
const FLAG_ACK = 0x2;
const FLAG_FIN = 0x4;

function header(type: number, flags: number, streamID: number, length: number): Buffer {
  const b = Buffer.alloc(12);
  b[0] = 0;
  b[1] = type;
  b.writeUInt16BE(flags, 2);
  b.writeUInt32BE(streamID, 4);
  b.writeUInt32BE(length, 8);
  return b;
}

/**
 * Build a paired ReadWriteStream where writes to one side become
 * readable bytes on the other. Returns [a, b] such that `a.write(x)`
 * causes `b.on('data', ...)` to fire.
 */
function pair() {
  const aToB = new PassThrough();
  const bToA = new PassThrough();
  const a = {
    write: (chunk: Buffer): boolean => aToB.write(chunk),
    on: (event: string, cb: (...args: unknown[]) => void): void => {
      bToA.on(event, cb);
    },
    end: () => {
      aToB.end();
    },
  };
  const b = {
    write: (chunk: Buffer): boolean => bToA.write(chunk),
    on: (event: string, cb: (...args: unknown[]) => void): void => {
      aToB.on(event, cb);
    },
    end: () => {
      bToA.end();
    },
  };
  return { a: a as unknown as NodeJS.ReadWriteStream, b: b as unknown as NodeJS.ReadWriteStream };
}

describe("YamuxSession", () => {
  it("emits 'stream' on inbound SYN and ACKs back", async () => {
    const { a, b } = pair();
    const session = new YamuxSession({ socket: a });
    const streamPromise = new Promise<YamuxStream>((resolve) => {
      session.on("stream", (s: unknown) => resolve(s as YamuxStream));
    });

    // Capture the outbound bytes (a.write goes to b's data).
    const outbound: Buffer[] = [];
    b.on("data", (c: unknown) => outbound.push(c as Buffer));

    // Send SYN on stream 2 (peer-initiated, even-numbered).
    b.write(header(TYPE_DATA, FLAG_SYN, 2, 0));

    const stream = await streamPromise;
    expect(stream.id).toBe(2);

    // Wait a tick for the ACK to be written.
    await new Promise((r) => setImmediate(r));
    // We expect at least one WINDOW_UPDATE with FLAG_ACK on stream 2.
    const ack = outbound.find((b) => b[1] === TYPE_WINDOW_UPDATE && b.readUInt16BE(2) === FLAG_ACK && b.readUInt32BE(4) === 2);
    expect(ack).toBeDefined();

    session.close();
  });

  it("delivers inbound DATA through the stream's read side", async () => {
    const { a, b } = pair();
    const session = new YamuxSession({ socket: a });
    const streamPromise = new Promise<YamuxStream>((resolve) => {
      session.on("stream", (s: unknown) => resolve(s as YamuxStream));
    });

    b.write(header(TYPE_DATA, FLAG_SYN, 2, 0));
    const stream = await streamPromise;

    const payload = Buffer.from("hello world", "utf8");
    b.write(header(TYPE_DATA, 0, 2, payload.length));
    b.write(payload);

    const received = await new Promise<Buffer>((resolve) => {
      stream.once("data", (c) => resolve(c as Buffer));
    });
    expect(received.toString()).toBe("hello world");

    session.close();
  });

  it("responds to PING with ACK and matching value", async () => {
    const { a, b } = pair();
    const session = new YamuxSession({ socket: a });

    const outbound: Buffer[] = [];
    b.on("data", (c: unknown) => outbound.push(c as Buffer));

    b.write(header(TYPE_PING, FLAG_SYN, 0, 42));
    await new Promise((r) => setImmediate(r));

    const pong = outbound.find((b) => b[1] === TYPE_PING && b.readUInt16BE(2) === FLAG_ACK);
    expect(pong).toBeDefined();
    expect(pong!.readUInt32BE(8)).toBe(42);

    session.close();
  });

  it("propagates FIN to the stream", async () => {
    const { a, b } = pair();
    const session = new YamuxSession({ socket: a });
    const streamPromise = new Promise<YamuxStream>((resolve) => {
      session.on("stream", (s: unknown) => resolve(s as YamuxStream));
    });

    b.write(header(TYPE_DATA, FLAG_SYN, 2, 0));
    const stream = await streamPromise;

    const ended = new Promise<void>((resolve) => stream.once("end", () => resolve()));
    // Send FIN with empty payload.
    b.write(header(TYPE_DATA, FLAG_FIN, 2, 0));
    stream.read(); // drain so 'end' can fire
    await ended;

    session.close();
  });

  it("emits 'close' on GO_AWAY", async () => {
    const { a, b } = pair();
    const session = new YamuxSession({ socket: a });
    const closed = new Promise<void>((resolve) => session.once("close", () => resolve()));

    b.write(header(TYPE_GO_AWAY, 0, 0, 0));
    await closed;
  });

  it("ping() resolves on matching ACK", async () => {
    const { a, b } = pair();
    const session = new YamuxSession({ socket: a, keepaliveTimeoutMs: 1000 });

    // Echo any inbound PING SYN back as ACK with the same value.
    b.on("data", (c: unknown) => {
      const buf = c as Buffer;
      if (buf[1] === TYPE_PING && (buf.readUInt16BE(2) & FLAG_SYN) !== 0) {
        const value = buf.readUInt32BE(8);
        b.write(header(TYPE_PING, FLAG_ACK, 0, value));
      }
    });

    await session.ping();
    session.close();
  });
});
