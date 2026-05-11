import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth.js";

// ---------------------------------------------------------------------------
// Settings  — composite PK (key, userId)
// ---------------------------------------------------------------------------

export const settings = pgTable(
  "Settings",
  {
    key: text("key").notNull(),
    userId: text("userId").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    version: integer("version").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.userId] })],
);

// ---------------------------------------------------------------------------
// InstalledPlugin
// ---------------------------------------------------------------------------

export const installedPlugin = pgTable("InstalledPlugin", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  version: text("version").notNull(),
  description: text("description").notNull(),
  author: text("author").notNull(),
  state: text("state").notNull().default("installed"),
  error: text("error"),
  manifest: jsonb("manifest"),
  enabled: boolean("enabled").notNull().default(true),
  installedAt: timestamp("installedAt", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  schemaVersion: integer("schemaVersion").notNull().default(0),
});

// ---------------------------------------------------------------------------
// PluginStorage  — composite PK (pluginId, key, userId)
// ---------------------------------------------------------------------------

export const pluginStorage = pgTable(
  "PluginStorage",
  {
    pluginId: text("pluginId").notNull(),
    key: text("key").notNull(),
    userId: text("userId")
      .notNull()
      .default("")
      .references(() => user.id, { onDelete: "cascade" }),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.pluginId, t.key, t.userId] })],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const pluginStorageRelations = relations(pluginStorage, ({ one }) => ({
  user: one(user, { fields: [pluginStorage.userId], references: [user.id] }),
}));
