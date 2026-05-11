import { relations, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth.js";
import { bytea } from "../types.js";

// ---------------------------------------------------------------------------
// SyncDeletion
// ---------------------------------------------------------------------------

export const syncDeletion = pgTable(
  "SyncDeletion",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tableName: text("tableName").notNull(),
    recordId: text("recordId").notNull(),
    userId: text("userId").notNull(),
    deletedAt: timestamp("deletedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("SyncDeletion_userId_deletedAt_idx").on(t.userId, t.deletedAt)],
);

// ---------------------------------------------------------------------------
// SyncCursor  — PK is userId (one row per user)
// ---------------------------------------------------------------------------

export const syncCursor = pgTable("SyncCursor", {
  userId: text("userId")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  cursor: bigint("cursor", { mode: "bigint" }).notNull().default(sql`0`),
});

// ---------------------------------------------------------------------------
// YjsDocument
//
// Prisma: snapshot Bytes, stateVector Bytes, updatedAt @updatedAt
// ---------------------------------------------------------------------------

export const yjsDocument = pgTable("YjsDocument", {
  docId: text("docId").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  snapshot: bytea("snapshot").notNull(),
  stateVector: bytea("stateVector").notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// YjsUpdate  — autoincrement bigint PK
// ---------------------------------------------------------------------------

export const yjsUpdate = pgTable(
  "YjsUpdate",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    docId: text("docId").notNull(),
    update: bytea("update").notNull(),
    agentId: text("agentId"),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("YjsUpdate_docId_createdAt_idx").on(t.docId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const syncCursorRelations = relations(syncCursor, ({ one }) => ({
  user: one(user, { fields: [syncCursor.userId], references: [user.id] }),
}));

export const yjsDocumentRelations = relations(yjsDocument, ({ one }) => ({
  user: one(user, { fields: [yjsDocument.userId], references: [user.id] }),
}));
