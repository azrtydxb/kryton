import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth.js";

// ---------------------------------------------------------------------------
// NoteShare
// ---------------------------------------------------------------------------

export const noteShare = pgTable(
  "NoteShare",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ownerUserId: text("ownerUserId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    isFolder: boolean("isFolder").notNull(),
    sharedWithUserId: text("sharedWithUserId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    version: integer("version").notNull().default(0),
    cursor: bigint("cursor", { mode: "bigint" }).notNull().default(sql`0`),
  },
  (t) => [
    uniqueIndex("NoteShare_ownerUserId_path_sharedWithUserId_key").on(
      t.ownerUserId,
      t.path,
      t.sharedWithUserId,
    ),
    index("NoteShare_sharedWithUserId_idx").on(t.sharedWithUserId),
  ],
);

// ---------------------------------------------------------------------------
// AccessRequest
// ---------------------------------------------------------------------------

export const accessRequest = pgTable("AccessRequest", {
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  requesterUserId: text("requesterUserId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  ownerUserId: text("ownerUserId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  notePath: text("notePath").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// InviteCode
// ---------------------------------------------------------------------------

export const inviteCode = pgTable(
  "InviteCode",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    code: text("code").notNull(),
    createdById: text("createdById")
      .notNull()
      .references(() => user.id),
    usedById: text("usedById").references(() => user.id),
    expiresAt: timestamp("expiresAt", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("InviteCode_code_key").on(t.code)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const noteShareRelations = relations(noteShare, ({ one }) => ({
  owner: one(user, {
    fields: [noteShare.ownerUserId],
    references: [user.id],
    relationName: "owner",
  }),
  sharedWith: one(user, {
    fields: [noteShare.sharedWithUserId],
    references: [user.id],
    relationName: "sharedWith",
  }),
}));

export const accessRequestRelations = relations(accessRequest, ({ one }) => ({
  requester: one(user, {
    fields: [accessRequest.requesterUserId],
    references: [user.id],
    relationName: "arRequester",
  }),
  owner: one(user, {
    fields: [accessRequest.ownerUserId],
    references: [user.id],
    relationName: "arOwner",
  }),
}));

export const inviteCodeRelations = relations(inviteCode, ({ one }) => ({
  createdBy: one(user, {
    fields: [inviteCode.createdById],
    references: [user.id],
    relationName: "createdBy",
  }),
  usedBy: one(user, {
    fields: [inviteCode.usedById],
    references: [user.id],
    relationName: "usedBy",
  }),
}));
