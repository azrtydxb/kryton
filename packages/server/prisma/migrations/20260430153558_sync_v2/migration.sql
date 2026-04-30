-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "parentId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "cursor" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Folder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "cursor" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NoteTag" (
    "notePath" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "cursor" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "notePath", "tagId"),
    CONSTRAINT "NoteTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NoteTag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NoteVersion" (
    "userId" TEXT NOT NULL,
    "notePath" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "cursor" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "notePath"),
    CONSTRAINT "NoteVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NoteRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "notePath" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NoteRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "notePath" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "cursor" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "SyncCursor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "policyText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME,
    CONSTRAINT "Agent_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scope" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentToken_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "YjsDocument" (
    "docId" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "snapshot" BLOB NOT NULL,
    "stateVector" BLOB NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "YjsDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "YjsUpdate" (
    "id" BIGINT NOT NULL PRIMARY KEY,
    "docId" TEXT NOT NULL,
    "update" BLOB NOT NULL,
    "agentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GraphEdge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromPath" TEXT NOT NULL,
    "toPath" TEXT NOT NULL,
    "fromNoteId" TEXT NOT NULL,
    "toNoteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "cursor" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "GraphEdge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GraphEdge" ("fromNoteId", "fromPath", "id", "toNoteId", "toPath", "userId") SELECT "fromNoteId", "fromPath", "id", "toNoteId", "toPath", "userId" FROM "GraphEdge";
DROP TABLE "GraphEdge";
ALTER TABLE "new_GraphEdge" RENAME TO "GraphEdge";
CREATE INDEX "GraphEdge_userId_idx" ON "GraphEdge"("userId");
CREATE INDEX "GraphEdge_fromNoteId_idx" ON "GraphEdge"("fromNoteId");
CREATE INDEX "GraphEdge_toNoteId_idx" ON "GraphEdge"("toNoteId");
CREATE TABLE "new_InstalledPlugin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'installed',
    "error" TEXT,
    "manifest" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 0,
    "cursor" BIGINT NOT NULL DEFAULT 0
);
INSERT INTO "new_InstalledPlugin" ("author", "description", "enabled", "error", "id", "installedAt", "manifest", "name", "state", "updatedAt", "version") SELECT "author", "description", "enabled", "error", "id", "installedAt", "manifest", "name", "state", "updatedAt", "version" FROM "InstalledPlugin";
DROP TABLE "InstalledPlugin";
ALTER TABLE "new_InstalledPlugin" RENAME TO "InstalledPlugin";
CREATE TABLE "new_NoteShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "isFolder" BOOLEAN NOT NULL,
    "sharedWithUserId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "cursor" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "NoteShare_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NoteShare_sharedWithUserId_fkey" FOREIGN KEY ("sharedWithUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_NoteShare" ("createdAt", "id", "isFolder", "ownerUserId", "path", "permission", "sharedWithUserId", "updatedAt") SELECT "createdAt", "id", "isFolder", "ownerUserId", "path", "permission", "sharedWithUserId", "updatedAt" FROM "NoteShare";
DROP TABLE "NoteShare";
ALTER TABLE "new_NoteShare" RENAME TO "NoteShare";
CREATE INDEX "NoteShare_sharedWithUserId_idx" ON "NoteShare"("sharedWithUserId");
CREATE UNIQUE INDEX "NoteShare_ownerUserId_path_sharedWithUserId_key" ON "NoteShare"("ownerUserId", "path", "sharedWithUserId");
CREATE TABLE "new_Settings" (
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "cursor" BIGINT NOT NULL DEFAULT 0,

    PRIMARY KEY ("key", "userId")
);
INSERT INTO "new_Settings" ("key", "updatedAt", "userId", "value") SELECT "key", "updatedAt", "userId", "value" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
CREATE TABLE "new_TrashItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "originalPath" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trashedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "cursor" BIGINT NOT NULL DEFAULT 0
);
INSERT INTO "new_TrashItem" ("id", "originalPath", "trashedAt", "userId") SELECT "id", "originalPath", "trashedAt", "userId" FROM "TrashItem";
DROP TABLE "TrashItem";
ALTER TABLE "new_TrashItem" RENAME TO "TrashItem";
CREATE INDEX "TrashItem_userId_trashedAt_idx" ON "TrashItem"("userId", "trashedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Folder_userId_path_key" ON "Folder"("userId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_userId_name_key" ON "Tag"("userId", "name");

-- CreateIndex
CREATE INDEX "NoteRevision_userId_notePath_createdAt_idx" ON "NoteRevision"("userId", "notePath", "createdAt");

-- CreateIndex
CREATE INDEX "Attachment_userId_notePath_idx" ON "Attachment"("userId", "notePath");

-- CreateIndex
CREATE INDEX "Attachment_contentHash_idx" ON "Attachment"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_ownerUserId_name_key" ON "Agent"("ownerUserId", "name");

-- CreateIndex
CREATE INDEX "AgentToken_tokenHash_idx" ON "AgentToken"("tokenHash");

-- CreateIndex
CREATE INDEX "YjsUpdate_docId_createdAt_idx" ON "YjsUpdate"("docId", "createdAt");
