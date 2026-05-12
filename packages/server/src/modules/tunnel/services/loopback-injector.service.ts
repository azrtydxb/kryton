/**
 * LoopbackInjector — splices an inbound yamux stream (carrying
 * HTTP/1.1 bytes from the tunnel server) to a fresh TCP connection
 * pointing at Fastify's own listener. Fastify treats the request
 * as if it had arrived from a normal client on the LAN.
 *
 * See docs/superpowers/specs/2026-05-12-kryton-tunnel-client-design.md §3.
 */
import { connect as netConnect, type Socket } from "node:net";
import type { Duplex } from "node:stream";

import type { TunnelStatsService } from "./tunnel-stats.service.js";

type Logger = {
  debug: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
};

export class LoopbackInjector {
  private localPort = 0;
  private readonly localHost: string;
  private readonly log: Logger;
  private readonly stats?: TunnelStatsService;

  constructor(opts: { localHost?: string; log: Logger; stats?: TunnelStatsService }) {
    this.localHost = opts.localHost ?? "127.0.0.1";
    this.log = opts.log;
    this.stats = opts.stats;
  }

  setLocalPort(port: number): void {
    this.localPort = port;
  }

  /**
   * Splice the given yamux stream to a freshly dialed loopback TCP
   * connection. Cleanup is automatic on either-side close/error.
   */
  handle(yamuxStream: Duplex): void {
    if (!this.localPort) {
      this.log.warn("loopback injector has no port; dropping stream");
      yamuxStream.destroy(new Error("loopback port not configured"));
      return;
    }

    const socket: Socket = netConnect({ host: this.localHost, port: this.localPort });
    let bytesUp = 0;
    let bytesDown = 0;

    socket.once("connect", () => {
      // Splice both directions. We don't use stream.pipe directly
      // because we want byte counts; the manual loop is small.
      yamuxStream.on("data", (chunk: Buffer) => {
        bytesUp += chunk.length;
        if (!socket.write(chunk)) {
          yamuxStream.pause();
          socket.once("drain", () => yamuxStream.resume());
        }
      });
      yamuxStream.on("end", () => {
        socket.end();
      });
      socket.on("data", (chunk: Buffer) => {
        bytesDown += chunk.length;
        if (!yamuxStream.write(chunk)) {
          socket.pause();
          yamuxStream.once("drain", () => socket.resume());
        }
      });
      socket.on("end", () => {
        yamuxStream.end();
      });
    });

    const wrapUp = (label: string, err?: Error) => {
      this.log.debug("tunnel loopback ended", { label, err: err?.message });
      if (this.stats) {
        this.stats.recordRequest(bytesUp, bytesDown);
      }
      socket.destroy();
      yamuxStream.destroy();
    };

    yamuxStream.once("close", () => wrapUp("yamux_close"));
    yamuxStream.once("error", (err: Error) => wrapUp("yamux_error", err));
    socket.once("close", () => wrapUp("socket_close"));
    socket.once("error", (err: Error) => wrapUp("socket_error", err));
  }
}
