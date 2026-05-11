import { relations } from "drizzle-orm";
import {
  bigserial,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth.js";
import { bytea } from "../types.js";

// ---------------------------------------------------------------------------
// YjsDocument
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

export const yjsDocumentRelations = relations(yjsDocument, ({ one }) => ({
  user: one(user, { fields: [yjsDocument.userId], references: [user.id] }),
}));
