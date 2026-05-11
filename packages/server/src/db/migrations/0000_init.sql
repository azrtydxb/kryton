CREATE TABLE "Account" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"idToken" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ApiKey" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"keyHash" text NOT NULL,
	"keyPrefix" text NOT NULL,
	"scope" text DEFAULT 'read-only' NOT NULL,
	"expiresAt" timestamp with time zone,
	"lastUsedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"publicKey" text NOT NULL,
	"userId" text NOT NULL,
	"credentialID" text NOT NULL,
	"counter" integer NOT NULL,
	"deviceType" text NOT NULL,
	"backedUp" boolean NOT NULL,
	"transports" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Session" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"token" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TwoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backupCodes" text NOT NULL,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "User" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"twoFactorEnabled" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "InstalledPlugin" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"description" text NOT NULL,
	"author" text NOT NULL,
	"state" text DEFAULT 'installed' NOT NULL,
	"error" text,
	"manifest" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"installedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"schemaVersion" integer DEFAULT 0 NOT NULL,
	"cursor" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PluginStorage" (
	"pluginId" text NOT NULL,
	"key" text NOT NULL,
	"userId" text DEFAULT '' NOT NULL,
	"value" jsonb NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "PluginStorage_pluginId_key_userId_pk" PRIMARY KEY("pluginId","key","userId")
);
--> statement-breakpoint
CREATE TABLE "Settings" (
	"key" text NOT NULL,
	"userId" text NOT NULL,
	"value" text NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"cursor" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "Settings_key_userId_pk" PRIMARY KEY("key","userId")
);
--> statement-breakpoint
CREATE TABLE "Attachment" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"notePath" text NOT NULL,
	"filename" text NOT NULL,
	"contentHash" text NOT NULL,
	"sizeBytes" integer NOT NULL,
	"mimeType" text NOT NULL,
	"storagePath" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Folder" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"path" text NOT NULL,
	"parentId" text,
	"version" integer DEFAULT 0 NOT NULL,
	"cursor" bigint DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "GraphEdge" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fromPath" text NOT NULL,
	"toPath" text NOT NULL,
	"fromNoteId" text NOT NULL,
	"toNoteId" text NOT NULL,
	"userId" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"cursor" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "NoteRevision" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"notePath" text NOT NULL,
	"content" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "NoteTag" (
	"notePath" text NOT NULL,
	"tagId" text NOT NULL,
	"userId" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"cursor" bigint DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "NoteTag_userId_notePath_tagId_pk" PRIMARY KEY("userId","notePath","tagId")
);
--> statement-breakpoint
CREATE TABLE "NoteVersion" (
	"userId" text NOT NULL,
	"notePath" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"cursor" bigint DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "NoteVersion_userId_notePath_pk" PRIMARY KEY("userId","notePath")
);
--> statement-breakpoint
CREATE TABLE "SearchIndex" (
	"notePath" text NOT NULL,
	"userId" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"tags" text DEFAULT '' NOT NULL,
	"modifiedAt" timestamp with time zone NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '') || ' ' || coalesce(tags, ''))) STORED,
	CONSTRAINT "SearchIndex_notePath_userId_pk" PRIMARY KEY("notePath","userId")
);
--> statement-breakpoint
CREATE TABLE "Tag" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"version" integer DEFAULT 0 NOT NULL,
	"cursor" bigint DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TrashItem" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"originalPath" text NOT NULL,
	"userId" text NOT NULL,
	"trashedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"cursor" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AccessRequest" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requesterUserId" text NOT NULL,
	"ownerUserId" text NOT NULL,
	"notePath" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "InviteCode" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"createdById" text NOT NULL,
	"usedById" text,
	"expiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "NoteShare" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerUserId" text NOT NULL,
	"path" text NOT NULL,
	"isFolder" boolean NOT NULL,
	"sharedWithUserId" text NOT NULL,
	"permission" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"cursor" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SyncCursor" (
	"userId" text PRIMARY KEY NOT NULL,
	"cursor" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SyncDeletion" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tableName" text NOT NULL,
	"recordId" text NOT NULL,
	"userId" text NOT NULL,
	"deletedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "YjsDocument" (
	"docId" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"snapshot" "bytea" NOT NULL,
	"stateVector" "bytea" NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "YjsUpdate" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"docId" text NOT NULL,
	"update" "bytea" NOT NULL,
	"agentId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Agent" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerUserId" text NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"policyText" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSeenAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "AgentToken" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agentId" text NOT NULL,
	"tokenHash" text NOT NULL,
	"scope" text,
	"expiresAt" timestamp with time zone NOT NULL,
	"revokedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TwoFactor" ADD CONSTRAINT "TwoFactor_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PluginStorage" ADD CONSTRAINT "PluginStorage_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NoteRevision" ADD CONSTRAINT "NoteRevision_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NoteTag" ADD CONSTRAINT "NoteTag_tagId_Tag_id_fk" FOREIGN KEY ("tagId") REFERENCES "public"."Tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NoteTag" ADD CONSTRAINT "NoteTag_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NoteVersion" ADD CONSTRAINT "NoteVersion_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SearchIndex" ADD CONSTRAINT "SearchIndex_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_requesterUserId_User_id_fk" FOREIGN KEY ("requesterUserId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_ownerUserId_User_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "InviteCode" ADD CONSTRAINT "InviteCode_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "InviteCode" ADD CONSTRAINT "InviteCode_usedById_User_id_fk" FOREIGN KEY ("usedById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NoteShare" ADD CONSTRAINT "NoteShare_ownerUserId_User_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NoteShare" ADD CONSTRAINT "NoteShare_sharedWithUserId_User_id_fk" FOREIGN KEY ("sharedWithUserId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SyncCursor" ADD CONSTRAINT "SyncCursor_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "YjsDocument" ADD CONSTRAINT "YjsDocument_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_ownerUserId_User_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AgentToken" ADD CONSTRAINT "AgentToken_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account" USING btree ("providerId","accountId");--> statement-breakpoint
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey" USING btree ("keyHash");--> statement-breakpoint
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "ApiKey_keyHash_idx" ON "ApiKey" USING btree ("keyHash");--> statement-breakpoint
CREATE UNIQUE INDEX "Passkey_credentialID_key" ON "Passkey" USING btree ("credentialID");--> statement-breakpoint
CREATE UNIQUE INDEX "Session_token_key" ON "Session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "TwoFactor_userId_idx" ON "TwoFactor" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "User_email_key" ON "User" USING btree ("email");--> statement-breakpoint
CREATE INDEX "Attachment_userId_notePath_idx" ON "Attachment" USING btree ("userId","notePath");--> statement-breakpoint
CREATE INDEX "Attachment_contentHash_idx" ON "Attachment" USING btree ("contentHash");--> statement-breakpoint
CREATE UNIQUE INDEX "Folder_userId_path_key" ON "Folder" USING btree ("userId","path");--> statement-breakpoint
CREATE INDEX "GraphEdge_userId_idx" ON "GraphEdge" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "GraphEdge_fromNoteId_idx" ON "GraphEdge" USING btree ("fromNoteId");--> statement-breakpoint
CREATE INDEX "GraphEdge_toNoteId_idx" ON "GraphEdge" USING btree ("toNoteId");--> statement-breakpoint
CREATE INDEX "NoteRevision_userId_notePath_createdAt_idx" ON "NoteRevision" USING btree ("userId","notePath","createdAt");--> statement-breakpoint
CREATE INDEX "SearchIndex_userId_idx" ON "SearchIndex" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "SearchIndex_tsv_idx" ON "SearchIndex" USING gin ("tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "Tag_userId_name_key" ON "Tag" USING btree ("userId","name");--> statement-breakpoint
CREATE INDEX "TrashItem_userId_trashedAt_idx" ON "TrashItem" USING btree ("userId","trashedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "InviteCode_code_key" ON "InviteCode" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "NoteShare_ownerUserId_path_sharedWithUserId_key" ON "NoteShare" USING btree ("ownerUserId","path","sharedWithUserId");--> statement-breakpoint
CREATE INDEX "NoteShare_sharedWithUserId_idx" ON "NoteShare" USING btree ("sharedWithUserId");--> statement-breakpoint
CREATE INDEX "SyncDeletion_userId_deletedAt_idx" ON "SyncDeletion" USING btree ("userId","deletedAt");--> statement-breakpoint
CREATE INDEX "YjsUpdate_docId_createdAt_idx" ON "YjsUpdate" USING btree ("docId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "Agent_ownerUserId_name_key" ON "Agent" USING btree ("ownerUserId","name");--> statement-breakpoint
CREATE INDEX "AgentToken_tokenHash_idx" ON "AgentToken" USING btree ("tokenHash");