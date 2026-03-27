import * as SQLite from "expo-sqlite";
import { DB_NAME, CREATE_TABLES_SQL } from "./schema";

let _db: SQLite.SQLiteDatabase | null = null;

export function getDatabase(): SQLite.SQLiteDatabase {
  if (!_db) {
    _db = SQLite.openDatabaseSync(DB_NAME);
    _db.execSync(CREATE_TABLES_SQL);
  }
  return _db;
}

// Helper types
export interface NoteRow {
  id: string;
  path: string;
  title: string;
  content: string;
  tags: string;
  modified_at: number;
  _status: string;
  _changed: string;
}

export interface SettingRow {
  id: string;
  key: string;
  value: string;
  _status: string;
}

export interface NoteShareRow {
  id: string;
  owner_user_id: string;
  path: string;
  is_folder: number;
  permission: string;
  shared_with_user_id: string;
  _status: string;
}

export interface TrashItemRow {
  id: string;
  original_path: string;
  trashed_at: number;
  _status: string;
}
