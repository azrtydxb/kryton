import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth.js";
import { tsvector } from "../types.js";

// ---------------------------------------------------------------------------
// SearchIndex  — composite PK (notePath, userId) + stored tsvector + GIN index
// ---------------------------------------------------------------------------

export const searchIndex = pgTable(
  "SearchIndex",
  {
    notePath: text("notePath").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    tags: text("tags").notNull().default(""),
    modifiedAt: timestamp("modifiedAt", { withTimezone: true, mode: "date" }).notNull(),
    tsv: tsvector("tsv").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '') || ' ' || coalesce(tags, ''))`,
    ),
  },
  (t) => [
    primaryKey({ columns: [t.notePath, t.userId] }),
    index("SearchIndex_userId_idx").on(t.userId),
    index("SearchIndex_tsv_idx").using("gin", t.tsv),
  ],
);

// ---------------------------------------------------------------------------
// GraphEdge
// ---------------------------------------------------------------------------

export const graphEdge = pgTable(
  "GraphEdge",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    fromPath: text("fromPath").notNull(),
    toPath: text("toPath").notNull(),
    fromNoteId: text("fromNoteId").notNull(),
    toNoteId: text("toNoteId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(0),
  },
  (t) => [
    index("GraphEdge_userId_idx").on(t.userId),
    index("GraphEdge_fromNoteId_idx").on(t.fromNoteId),
    index("GraphEdge_toNoteId_idx").on(t.toNoteId),
  ],
);

// ---------------------------------------------------------------------------
// Folder
// ---------------------------------------------------------------------------

export const folder = pgTable(
  "Folder",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    parentId: text("parentId"),
    version: integer("version").notNull().default(0),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("Folder_userId_path_key").on(t.userId, t.path)],
);

// ---------------------------------------------------------------------------
// Tag
// ---------------------------------------------------------------------------

export const tag = pgTable(
  "Tag",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    version: integer("version").notNull().default(0),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("Tag_userId_name_key").on(t.userId, t.name)],
);

// ---------------------------------------------------------------------------
// NoteTag  — composite PK (userId, notePath, tagId)
// ---------------------------------------------------------------------------

export const noteTag = pgTable(
  "NoteTag",
  {
    notePath: text("notePath").notNull(),
    tagId: text("tagId")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(0),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.notePath, t.tagId] })],
);

// ---------------------------------------------------------------------------
// NoteVersion  — composite PK (userId, notePath)
// ---------------------------------------------------------------------------

export const noteVersion = pgTable(
  "NoteVersion",
  {
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    notePath: text("notePath").notNull(),
    version: integer("version").notNull().default(0),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.notePath] })],
);

// ---------------------------------------------------------------------------
// NoteRevision
// ---------------------------------------------------------------------------

export const noteRevision = pgTable(
  "NoteRevision",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    notePath: text("notePath").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("NoteRevision_userId_notePath_createdAt_idx").on(t.userId, t.notePath, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Attachment
// ---------------------------------------------------------------------------

export const attachment = pgTable(
  "Attachment",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    notePath: text("notePath").notNull(),
    filename: text("filename").notNull(),
    contentHash: text("contentHash").notNull(),
    sizeBytes: integer("sizeBytes").notNull(),
    mimeType: text("mimeType").notNull(),
    storagePath: text("storagePath").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("Attachment_userId_notePath_idx").on(t.userId, t.notePath),
    index("Attachment_contentHash_idx").on(t.contentHash),
  ],
);

// ---------------------------------------------------------------------------
// TrashItem
// ---------------------------------------------------------------------------

export const trashItem = pgTable(
  "TrashItem",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    originalPath: text("originalPath").notNull(),
    userId: text("userId").notNull(),
    trashedAt: timestamp("trashedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    version: integer("version").notNull().default(0),
  },
  (t) => [index("TrashItem_userId_trashedAt_idx").on(t.userId, t.trashedAt)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const searchIndexRelations = relations(searchIndex, ({ one }) => ({
  user: one(user, { fields: [searchIndex.userId], references: [user.id] }),
}));

export const graphEdgeRelations = relations(graphEdge, ({ one }) => ({
  user: one(user, { fields: [graphEdge.userId], references: [user.id] }),
}));

// Folder is self-referencing via parentId (no cascade — preserve children).
export const folderRelations = relations(folder, ({ one, many }) => ({
  user: one(user, { fields: [folder.userId], references: [user.id] }),
  parent: one(folder, {
    fields: [folder.parentId],
    references: [folder.id],
    relationName: "FolderHierarchy",
  }),
  children: many(folder, { relationName: "FolderHierarchy" }),
}));

export const tagRelations = relations(tag, ({ one, many }) => ({
  user: one(user, { fields: [tag.userId], references: [user.id] }),
  notes: many(noteTag),
}));

export const noteTagRelations = relations(noteTag, ({ one }) => ({
  tag: one(tag, { fields: [noteTag.tagId], references: [tag.id] }),
  user: one(user, { fields: [noteTag.userId], references: [user.id] }),
}));

export const noteVersionRelations = relations(noteVersion, ({ one }) => ({
  user: one(user, { fields: [noteVersion.userId], references: [user.id] }),
}));

export const noteRevisionRelations = relations(noteRevision, ({ one }) => ({
  user: one(user, { fields: [noteRevision.userId], references: [user.id] }),
}));

export const attachmentRelations = relations(attachment, ({ one }) => ({
  user: one(user, { fields: [attachment.userId], references: [user.id] }),
}));
