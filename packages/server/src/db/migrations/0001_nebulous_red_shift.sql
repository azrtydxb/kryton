DROP TABLE "SyncCursor" CASCADE;--> statement-breakpoint
DROP TABLE "SyncDeletion" CASCADE;--> statement-breakpoint
ALTER TABLE "InstalledPlugin" DROP COLUMN "cursor";--> statement-breakpoint
ALTER TABLE "Settings" DROP COLUMN "cursor";--> statement-breakpoint
ALTER TABLE "Folder" DROP COLUMN "cursor";--> statement-breakpoint
ALTER TABLE "GraphEdge" DROP COLUMN "cursor";--> statement-breakpoint
ALTER TABLE "NoteTag" DROP COLUMN "cursor";--> statement-breakpoint
ALTER TABLE "NoteVersion" DROP COLUMN "cursor";--> statement-breakpoint
ALTER TABLE "Tag" DROP COLUMN "cursor";--> statement-breakpoint
ALTER TABLE "TrashItem" DROP COLUMN "cursor";--> statement-breakpoint
ALTER TABLE "NoteShare" DROP COLUMN "cursor";