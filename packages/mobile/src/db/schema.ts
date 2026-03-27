export const DB_NAME = "mnemo.db";

export const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    modified_at INTEGER NOT NULL DEFAULT 0,
    _status TEXT NOT NULL DEFAULT 'synced',
    _changed TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    _status TEXT NOT NULL DEFAULT 'synced',
    _changed TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS note_shares (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    path TEXT NOT NULL,
    is_folder INTEGER NOT NULL DEFAULT 0,
    permission TEXT NOT NULL DEFAULT 'read',
    shared_with_user_id TEXT NOT NULL,
    _status TEXT NOT NULL DEFAULT 'synced',
    _changed TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS trash_items (
    id TEXT PRIMARY KEY,
    original_path TEXT NOT NULL,
    trashed_at INTEGER NOT NULL DEFAULT 0,
    _status TEXT NOT NULL DEFAULT 'synced',
    _changed TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_notes_path ON notes(path);
  CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
`;
