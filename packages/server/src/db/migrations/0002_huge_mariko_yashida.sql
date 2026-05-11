CREATE TABLE "EmbedJob" (
	"user_id" text NOT NULL,
	"note_path" text NOT NULL,
	"op" text NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "EmbedJob_user_id_note_path_pk" PRIMARY KEY("user_id","note_path")
);
--> statement-breakpoint
CREATE TABLE "NoteEmbeddingChunk" (
	"user_id" text NOT NULL,
	"note_path" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"modified_at" timestamp with time zone NOT NULL,
	CONSTRAINT "NoteEmbeddingChunk_user_id_note_path_chunk_index_pk" PRIMARY KEY("user_id","note_path","chunk_index")
);
--> statement-breakpoint
ALTER TABLE "EmbedJob" ADD CONSTRAINT "EmbedJob_user_id_User_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NoteEmbeddingChunk" ADD CONSTRAINT "NoteEmbeddingChunk_user_id_User_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embed_job_queue_idx" ON "EmbedJob" USING btree ("enqueued_at");--> statement-breakpoint
CREATE INDEX "note_embedding_hnsw_idx" ON "NoteEmbeddingChunk" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "note_embedding_user_path_idx" ON "NoteEmbeddingChunk" USING btree ("user_id","note_path");