/**
 * Stream 4D — Migration verification script.
 *
 * Takes an optional path to a SQLite DB as argument (defaults to a
 * temporary file). Builds a "pre-sync_v2" schema by applying only
 * the migrations that existed before 20260430153558_sync_v2. Seeds it
 * with production-shaped data (5 users × 200 notes × 30 settings ×
 * 20 graph edges × 10 shares × 50 trash items). Then applies the
 * sync_v2 migration (and the subsequent fix migration) and asserts:
 *
 *   1. No data loss: counts match across before/after for unchanged tables.
 *   2. All foreign keys resolve: no dangling references.
 *   3. Version columns default to 0.
 *   4. Cursor columns default to 0.
 *   5. Pull as user 1 returns expected counts.
 *
 * Usage:
 *   npx tsx scripts/migration-verify.ts [/path/to/db]
 */

import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const NUM_USERS = 5;
const NOTES_PER_USER = 200;
const SETTINGS_PER_USER = 30;
const GRAPH_EDGES_PER_USER = 20;
const SHARES_PER_USER = 10;
const TRASH_PER_USER = 50;

// Pre-sync_v2 migrations (applied to build "old" schema)
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../prisma/migrations");
const PRE_SYNC_V2_MIGRATIONS = [
  "20260327125715_init",
  "20260328221442_add_noteshare_index",
];
// Migrations applied in the "upgrade" step
const SYNC_V2_MIGRATIONS = [
  "20260430153558_sync_v2",
  "20260430200000_fix_yjsupdate_autoincrement",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  process.stdout.write(`[migration-verify] ${msg}\n`);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    process.stderr.write(`[FAIL] ${message}\n`);
    process.exit(1);
  }
}

function applyMigration(db: Database.Database, migrationName: string) {
  const sqlPath = path.join(MIGRATIONS_DIR, migrationName, "migration.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");
  db.exec(sql);
  log(`Applied migration: ${migrationName}`);
}

function countRows(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) as n FROM "${table}"`).get() as { n: number };
  return row.n;
}

function countRowsWhere(db: Database.Database, table: string, where: string): number {
  const row = db.prepare(`SELECT COUNT(*) as n FROM "${table}" WHERE ${where}`).get() as { n: number };
  return row.n;
}

// ---------------------------------------------------------------------------
// Build pre-sync_v2 schema
// ---------------------------------------------------------------------------

function buildPreMigrationDb(dbPath: string): Database.Database {
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = OFF"); // disable during schema setup

  for (const migration of PRE_SYNC_V2_MIGRATIONS) {
    applyMigration(db, migration);
  }

  db.pragma("foreign_keys = ON");
  return db;
}

// ---------------------------------------------------------------------------
// Seed production-shaped data
// ---------------------------------------------------------------------------

function seedData(db: Database.Database): { userIds: string[] } {
  log(`Seeding ${NUM_USERS} users × ${NOTES_PER_USER} notes × ${SETTINGS_PER_USER} settings × ${GRAPH_EDGES_PER_USER} edges × ${SHARES_PER_USER} shares × ${TRASH_PER_USER} trash items`);

  const now = new Date().toISOString();
  const userIds: string[] = [];

  // Disable FK checks for seeding speed
  db.pragma("foreign_keys = OFF");

  // Users
  const insertUser = db.prepare(
    `INSERT INTO "User" (id, name, email, emailVerified, role, disabled, twoFactorEnabled, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, 'user', 0, 0, ?, ?)`,
  );
  for (let u = 1; u <= NUM_USERS; u++) {
    const uid = `verify-user-${u}`;
    userIds.push(uid);
    insertUser.run(uid, `Verify User ${u}`, `verify${u}@example.com`, now, now);
  }

  // SearchIndex (notes — pre-sync_v2 has no NoteVersion table)
  const insertSearchIndex = db.prepare(
    `INSERT OR IGNORE INTO "SearchIndex" (notePath, userId, title, content, tags, modifiedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  // Settings
  const insertSetting = db.prepare(
    `INSERT OR IGNORE INTO "Settings" (key, userId, value, updatedAt)
     VALUES (?, ?, ?, ?)`,
  );

  // GraphEdge
  const insertEdge = db.prepare(
    `INSERT INTO "GraphEdge" (id, fromPath, toPath, fromNoteId, toNoteId, userId)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  // NoteShare — shares are between user 1 and others
  const insertShare = db.prepare(
    `INSERT INTO "NoteShare" (id, ownerUserId, path, isFolder, sharedWithUserId, permission, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, ?, 'read', ?, ?)`,
  );

  // TrashItem
  const insertTrash = db.prepare(
    `INSERT INTO "TrashItem" (id, originalPath, userId, trashedAt)
     VALUES (?, ?, ?, ?)`,
  );

  const seedAll = db.transaction(() => {
    for (const userId of userIds) {
      // Notes via SearchIndex
      for (let n = 1; n <= NOTES_PER_USER; n++) {
        const notePath = `notes/note-${n}.md`;
        insertSearchIndex.run(notePath, userId, `Note ${n}`, `Content of note ${n}`, "[]", now);
      }

      // Settings
      for (let s = 1; s <= SETTINGS_PER_USER; s++) {
        insertSetting.run(`setting-key-${s}`, userId, `value-${s}`, now);
      }

      // GraphEdges
      for (let e = 1; e <= GRAPH_EDGES_PER_USER; e++) {
        const id = randomUUID();
        insertEdge.run(id, `notes/note-${e}.md`, `notes/note-${(e % NOTES_PER_USER) + 1}.md`, id, randomUUID(), userId);
      }

      // Trash
      for (let t = 1; t <= TRASH_PER_USER; t++) {
        insertTrash.run(randomUUID(), `notes/trashed-${t}.md`, userId, now);
      }
    }

    // Shares: user 1 shares SHARES_PER_USER notes with user 2
    const ownerUserId = userIds[0]!;
    const sharedWithUserId = userIds[1]!;
    for (let s = 1; s <= SHARES_PER_USER; s++) {
      insertShare.run(
        randomUUID(),
        ownerUserId,
        `notes/note-${s}.md`,
        sharedWithUserId,
        now,
        now,
      );
    }
  });

  seedAll();
  db.pragma("foreign_keys = ON");

  const totalEntities =
    NUM_USERS +
    NUM_USERS * NOTES_PER_USER +
    NUM_USERS * SETTINGS_PER_USER +
    NUM_USERS * GRAPH_EDGES_PER_USER +
    SHARES_PER_USER +
    NUM_USERS * TRASH_PER_USER;

  log(`Seeded ~${totalEntities} entities total`);
  return { userIds };
}

// ---------------------------------------------------------------------------
// Capture pre-migration counts
// ---------------------------------------------------------------------------

interface PreCounts {
  users: number;
  searchIndex: number;
  settings: number;
  graphEdges: number;
  noteShares: number;
  trashItems: number;
}

function capturePreCounts(db: Database.Database): PreCounts {
  return {
    users: countRows(db, "User"),
    searchIndex: countRows(db, "SearchIndex"),
    settings: countRows(db, "Settings"),
    graphEdges: countRows(db, "GraphEdge"),
    noteShares: countRows(db, "NoteShare"),
    trashItems: countRows(db, "TrashItem"),
  };
}

// ---------------------------------------------------------------------------
// Apply sync_v2 migration
// ---------------------------------------------------------------------------

function applyUpgradeMigrations(db: Database.Database) {
  log("Applying sync_v2 upgrade migrations...");
  db.pragma("foreign_keys = OFF");
  for (const migration of SYNC_V2_MIGRATIONS) {
    applyMigration(db, migration);
  }
  db.pragma("foreign_keys = ON");
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

function assertNoDataLoss(db: Database.Database, pre: PreCounts) {
  log("Asserting no data loss...");

  const postUsers = countRows(db, "User");
  assert(postUsers === pre.users, `User count changed: ${pre.users} -> ${postUsers}`);

  const postSearchIndex = countRows(db, "SearchIndex");
  assert(
    postSearchIndex === pre.searchIndex,
    `SearchIndex count changed: ${pre.searchIndex} -> ${postSearchIndex}`,
  );

  const postSettings = countRows(db, "Settings");
  assert(
    postSettings === pre.settings,
    `Settings count changed: ${pre.settings} -> ${postSettings}`,
  );

  const postEdges = countRows(db, "GraphEdge");
  assert(
    postEdges === pre.graphEdges,
    `GraphEdge count changed: ${pre.graphEdges} -> ${postEdges}`,
  );

  const postShares = countRows(db, "NoteShare");
  assert(
    postShares === pre.noteShares,
    `NoteShare count changed: ${pre.noteShares} -> ${postShares}`,
  );

  const postTrash = countRows(db, "TrashItem");
  assert(
    postTrash === pre.trashItems,
    `TrashItem count changed: ${pre.trashItems} -> ${postTrash}`,
  );

  log("  No data loss confirmed.");
}

function assertVersionColumnsDefaultToZero(db: Database.Database) {
  log("Asserting version columns default to 0...");

  // Rows inserted by seed (before migration) have no version column — after
  // migration they should have been initialized to 0 via the INSERT...SELECT.
  const badSettings = countRowsWhere(db, "Settings", "version != 0");
  assert(badSettings === 0, `Settings rows with version != 0: ${badSettings}`);

  const badEdges = countRowsWhere(db, "GraphEdge", "version != 0");
  assert(badEdges === 0, `GraphEdge rows with version != 0: ${badEdges}`);

  const badShares = countRowsWhere(db, "NoteShare", "version != 0");
  assert(badShares === 0, `NoteShare rows with version != 0: ${badShares}`);

  const badTrash = countRowsWhere(db, "TrashItem", "version != 0");
  assert(badTrash === 0, `TrashItem rows with version != 0: ${badTrash}`);

  log("  All version columns defaulted to 0.");
}

function assertCursorColumnsDefaultToZero(db: Database.Database) {
  log("Asserting cursor columns default to 0...");

  const badSettings = countRowsWhere(db, "Settings", "cursor != 0");
  assert(badSettings === 0, `Settings rows with cursor != 0: ${badSettings}`);

  const badEdges = countRowsWhere(db, "GraphEdge", "cursor != 0");
  assert(badEdges === 0, `GraphEdge rows with cursor != 0: ${badEdges}`);

  const badShares = countRowsWhere(db, "NoteShare", "cursor != 0");
  assert(badShares === 0, `NoteShare rows with cursor != 0: ${badShares}`);

  const badTrash = countRowsWhere(db, "TrashItem", "cursor != 0");
  assert(badTrash === 0, `TrashItem rows with cursor != 0: ${badTrash}`);

  log("  All cursor columns defaulted to 0.");
}

function assertForeignKeysResolve(db: Database.Database, userIds: string[]) {
  log("Asserting all foreign keys resolve...");
  db.pragma("foreign_keys = ON");

  // Run FK integrity check
  const result = db.pragma("foreign_key_check") as Array<{
    table: string;
    rowid: number;
    parent: string;
    fkid: number;
  }>;

  if (result.length > 0) {
    process.stderr.write(`[FAIL] Foreign key violations:\n${JSON.stringify(result, null, 2)}\n`);
    process.exit(1);
  }

  // Spot-check: Settings all have known userIds
  for (const userId of userIds) {
    const count = countRowsWhere(db, "Settings", `userId = '${userId}'`);
    assert(
      count === SETTINGS_PER_USER,
      `User ${userId} should have ${SETTINGS_PER_USER} settings, got ${count}`,
    );
  }

  log("  All foreign keys resolve.");
}

function assertPullCounts(db: Database.Database, userIds: string[]) {
  log("Asserting pull-equivalent counts for user 1...");

  const userId = userIds[0]!;

  // After migration, NoteVersion table exists but is empty (no backfill in this script).
  // SearchIndex rows represent notes.
  const noteCount = countRowsWhere(db, "SearchIndex", `userId = '${userId}'`);
  assert(
    noteCount === NOTES_PER_USER,
    `User 1 SearchIndex count should be ${NOTES_PER_USER}, got ${noteCount}`,
  );

  const settingsCount = countRowsWhere(db, "Settings", `userId = '${userId}'`);
  assert(
    settingsCount === SETTINGS_PER_USER,
    `User 1 Settings count should be ${SETTINGS_PER_USER}, got ${settingsCount}`,
  );

  const edgesCount = countRowsWhere(db, "GraphEdge", `userId = '${userId}'`);
  assert(
    edgesCount === GRAPH_EDGES_PER_USER,
    `User 1 GraphEdge count should be ${GRAPH_EDGES_PER_USER}, got ${edgesCount}`,
  );

  const trashCount = countRowsWhere(db, "TrashItem", `userId = '${userId}'`);
  assert(
    trashCount === TRASH_PER_USER,
    `User 1 TrashItem count should be ${TRASH_PER_USER}, got ${trashCount}`,
  );

  const sharesCount = countRowsWhere(db, "NoteShare", `ownerUserId = '${userId}'`);
  assert(
    sharesCount === SHARES_PER_USER,
    `User 1 NoteShare (as owner) count should be ${SHARES_PER_USER}, got ${sharesCount}`,
  );

  log("  Pull-equivalent counts match.");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dbPath = process.argv[2] ?? `/tmp/kryton-migration-verify-${Date.now()}.db`;
  log(`Using database: ${dbPath}`);

  // Phase 1: Build pre-sync_v2 schema and seed
  const db = buildPreMigrationDb(dbPath);
  const { userIds } = seedData(db);
  const preCounts = capturePreCounts(db);

  log(`Pre-migration counts: ${JSON.stringify(preCounts)}`);

  // Phase 2: Apply sync_v2 migration
  applyUpgradeMigrations(db);

  // Phase 3: Assertions
  assertNoDataLoss(db, preCounts);
  assertVersionColumnsDefaultToZero(db);
  assertCursorColumnsDefaultToZero(db);
  assertForeignKeysResolve(db, userIds);
  assertPullCounts(db, userIds);

  db.close();

  // Cleanup temp file if we created it
  if (!process.argv[2]) {
    fs.unlinkSync(dbPath);
    log(`Removed temporary database: ${dbPath}`);
  }

  log("All assertions passed. Migration verification complete.");
}

main().catch((err) => {
  process.stderr.write(`[migration-verify] Unexpected error: ${err}\n`);
  process.exit(1);
});
