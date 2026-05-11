/**
 * TunnelStatsService — in-memory counters + daily aggregates in
 * `TunnelTrafficDaily` for the admin tab's traffic widget.
 *
 * See docs/superpowers/specs/2026-05-12-kryton-tunnel-client-design.md §4.4.
 *
 * The counters are updated on every request the tunnel forwards to
 * Fastify via the loopback path. A periodic flush (60s) UPSERTs the
 * day's running total into the `TunnelTrafficDaily` table. The
 * /stats endpoint reads from the table for 7d/30d windows and adds
 * the in-memory running total for "today".
 */
import { sql } from "drizzle-orm";

import { tunnelTrafficDaily } from "../../../db/schema/tunnel.js";
import type { TunnelStats } from "../types.js";

type Db = {
  query: {
    tunnelTrafficDaily: {
      findMany: (args: { where?: unknown; orderBy?: unknown }) => Promise<{
        day: string;
        requests: number;
        bytesIn: number;
        bytesOut: number;
      }[]>;
    };
  };
  insert: (table: typeof tunnelTrafficDaily) => {
    values: (row: Record<string, unknown>) => {
      onConflictDoUpdate: (args: {
        target: unknown;
        set: Record<string, unknown>;
      }) => Promise<unknown>;
    };
  };
};

interface Counters {
  requests: number;
  bytesIn: number;
  bytesOut: number;
}

function utcDateString(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export class TunnelStatsService {
  private readonly inflight: Counters = { requests: 0, bytesIn: 0, bytesOut: 0 };
  private flushTimer: NodeJS.Timeout | null = null;
  private currentDay: string = utcDateString();

  constructor(
    private readonly db: Db,
    private readonly flushIntervalMs = 60_000,
  ) {}

  /**
   * Called by the loopback injector after each forwarded request.
   * Atomic via the single-threaded JS event loop.
   */
  recordRequest(bytesIn: number, bytesOut: number): void {
    this.inflight.requests += 1;
    this.inflight.bytesIn += bytesIn;
    this.inflight.bytesOut += bytesOut;
  }

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {
        /* best-effort; rely on next flush */
      });
    }, this.flushIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush().catch(() => undefined);
  }

  /**
   * Flush accumulated counters to TunnelTrafficDaily. Handles day
   * rollover: if currentDay has changed since last flush, the
   * accumulated counters apply to the previous day, not the new one.
   */
  async flush(): Promise<void> {
    const snapshot: Counters = {
      requests: this.inflight.requests,
      bytesIn: this.inflight.bytesIn,
      bytesOut: this.inflight.bytesOut,
    };
    if (snapshot.requests === 0 && snapshot.bytesIn === 0 && snapshot.bytesOut === 0) {
      // Even with no traffic we still update currentDay to today so
      // future flushes attribute correctly.
      this.currentDay = utcDateString();
      return;
    }
    const day = this.currentDay;
    // Reset inflight before the I/O — if the write fails we lose this
    // batch (acceptable for stats; not transactional).
    this.inflight.requests = 0;
    this.inflight.bytesIn = 0;
    this.inflight.bytesOut = 0;
    this.currentDay = utcDateString();

    await this.db
      .insert(tunnelTrafficDaily)
      .values({
        day,
        requests: snapshot.requests,
        bytesIn: snapshot.bytesIn,
        bytesOut: snapshot.bytesOut,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: tunnelTrafficDaily.day,
        set: {
          requests: sql`${tunnelTrafficDaily.requests} + ${snapshot.requests}`,
          bytesIn: sql`${tunnelTrafficDaily.bytesIn} + ${snapshot.bytesIn}`,
          bytesOut: sql`${tunnelTrafficDaily.bytesOut} + ${snapshot.bytesOut}`,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Build the response for GET /api/admin/tunnel/stats.
   */
  async getStats(window: "24h" | "7d" | "30d"): Promise<TunnelStats> {
    const days = window === "24h" ? 2 : window === "7d" ? 8 : 31;
    const since = new Date(Date.now() - days * 86_400_000);
    const sinceStr = utcDateString(since);

    const rows = await this.db.query.tunnelTrafficDaily.findMany({
      where: sql`${tunnelTrafficDaily.day} >= ${sinceStr}::date`,
      orderBy: sql`${tunnelTrafficDaily.day} ASC`,
    });

    // Merge today's in-flight counters into today's row (or append a
    // synthetic one if no row exists yet).
    const todayStr = utcDateString();
    let mergedToday = false;
    const daily = rows.map((r) => {
      if (r.day === todayStr) {
        mergedToday = true;
        return {
          date: r.day,
          requests: Number(r.requests) + this.inflight.requests,
          bytes_in: Number(r.bytesIn) + this.inflight.bytesIn,
          bytes_out: Number(r.bytesOut) + this.inflight.bytesOut,
        };
      }
      return {
        date: r.day,
        requests: Number(r.requests),
        bytes_in: Number(r.bytesIn),
        bytes_out: Number(r.bytesOut),
      };
    });
    if (!mergedToday && (this.inflight.requests > 0 || this.inflight.bytesIn > 0 || this.inflight.bytesOut > 0)) {
      daily.push({
        date: todayStr,
        requests: this.inflight.requests,
        bytes_in: this.inflight.bytesIn,
        bytes_out: this.inflight.bytesOut,
      });
    }

    // For 24h window, restrict to the last 2 day-rows (yesterday + today).
    const windowed =
      window === "24h" ? daily.slice(-2) : window === "7d" ? daily.slice(-7) : daily.slice(-30);

    const totals = windowed.reduce(
      (acc, d) => {
        acc.requests += d.requests;
        acc.bytes_in += d.bytes_in;
        acc.bytes_out += d.bytes_out;
        return acc;
      },
      { requests: 0, bytes_in: 0, bytes_out: 0 },
    );

    return {
      window,
      requests: totals.requests,
      bytes_in: totals.bytes_in,
      bytes_out: totals.bytes_out,
      daily: windowed,
      since: Math.floor(since.getTime() / 1000),
    };
  }
}
