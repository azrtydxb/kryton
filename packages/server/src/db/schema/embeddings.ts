import { pgTable, text, integer, timestamp, primaryKey, index, vector } from "drizzle-orm/pg-core";
import { user } from "./auth.js";

export const noteEmbeddingChunk = pgTable(
  "NoteEmbeddingChunk",
  {
    userId:     text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    notePath:   text("note_path").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    chunkText:  text("chunk_text").notNull(),
    embedding:  vector("embedding", { dimensions: 384 }).notNull(),
    modifiedAt: timestamp("modified_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk:       primaryKey({ columns: [t.userId, t.notePath, t.chunkIndex] }),
    hnswIdx:  index("note_embedding_hnsw_idx")
                .using("hnsw", t.embedding.op("vector_cosine_ops")),
    userPath: index("note_embedding_user_path_idx").on(t.userId, t.notePath),
  }),
);

export const embedJob = pgTable(
  "EmbedJob",
  {
    userId:     text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    notePath:   text("note_path").notNull(),
    op:         text("op").notNull(), // "upsert" | "delete"
    enqueuedAt: timestamp("enqueued_at", { withTimezone: true }).notNull().defaultNow(),
    attempts:   integer("attempts").notNull().default(0),
    error:      text("error"),
  },
  (t) => ({
    pk:    primaryKey({ columns: [t.userId, t.notePath] }),
    queue: index("embed_job_queue_idx").on(t.enqueuedAt),
  }),
);
