ALTER TABLE "ApiKey" ADD COLUMN "agentId" text;--> statement-breakpoint
CREATE INDEX "ApiKey_agentId_idx" ON "ApiKey" USING btree ("agentId");