import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth.js";

// ---------------------------------------------------------------------------
// PushDevices
// ---------------------------------------------------------------------------

export const pushDevices = pgTable(
  "push_devices",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["ios", "android"] }).notNull(),
    token: text("token").notNull(),
    lastSeenAt: timestamp("lastSeenAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("push_devices_userId_idx").on(t.userId),
    uniqueIndex("push_devices_platform_token_unique").on(t.platform, t.token),
  ],
);

export type PushDevice = typeof pushDevices.$inferSelect;
export type NewPushDevice = typeof pushDevices.$inferInsert;
