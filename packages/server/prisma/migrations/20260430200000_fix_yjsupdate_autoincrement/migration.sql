-- Fix YjsUpdate.id to use INTEGER PRIMARY KEY AUTOINCREMENT so SQLite rowid aliasing works.
-- The previous migration created BIGINT NOT NULL PRIMARY KEY which SQLite does not auto-populate.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Recreate the table with correct type
CREATE TABLE "YjsUpdate_new" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "docId" TEXT NOT NULL,
    "update" BLOB NOT NULL,
    "agentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "YjsUpdate_new" ("id", "docId", "update", "agentId", "createdAt")
SELECT "id", "docId", "update", "agentId", "createdAt" FROM "YjsUpdate";

DROP TABLE "YjsUpdate";

ALTER TABLE "YjsUpdate_new" RENAME TO "YjsUpdate";

CREATE INDEX "YjsUpdate_docId_createdAt_idx" ON "YjsUpdate"("docId", "createdAt");

PRAGMA defer_foreign_keys=OFF;
PRAGMA foreign_keys=ON;
