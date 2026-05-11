/**
 * Tunnel schema — daily traffic aggregates for the reverse-tunnel feature.
 *
 * Per-tenant per-minute traffic samples are tracked in-memory by
 * `TunnelStatsService` and flushed every 60s to `tunnelTrafficDaily` as
 * daily UPSERTs. Used by the admin dashboard's traffic widget.
 *
 * See docs/superpowers/specs/2026-05-12-kryton-tunnel-client-design.md §1.5.
 */
import { bigint, date, pgTable, timestamp } from "drizzle-orm/pg-core";

export const tunnelTrafficDaily = pgTable("TunnelTrafficDaily", {
  day: date("day", { mode: "string" }).primaryKey(),
  requests: bigint("requests", { mode: "number" }).notNull().default(0),
  bytesIn: bigint("bytesIn", { mode: "number" }).notNull().default(0),
  bytesOut: bigint("bytesOut", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});
