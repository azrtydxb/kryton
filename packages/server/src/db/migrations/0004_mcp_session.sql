CREATE TABLE "McpSession" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"keyHash" text NOT NULL,
	"keyScope" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastActivityAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "McpSession" ADD CONSTRAINT "McpSession_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "McpSession_userId_idx" ON "McpSession" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "McpSession_lastActivityAt_idx" ON "McpSession" USING btree ("lastActivityAt");