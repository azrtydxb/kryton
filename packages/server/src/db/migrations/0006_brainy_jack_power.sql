CREATE TABLE "push_devices" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"platform" text NOT NULL,
	"token" text NOT NULL,
	"lastSeenAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_devices_userId_idx" ON "push_devices" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "push_devices_platform_token_unique" ON "push_devices" USING btree ("platform","token");