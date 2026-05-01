import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";

export interface NoteData {
  id: string;
  path: string;
  title: string;
  tags: string;       // JSON-stringified string[]
  modifiedAt: number;
  version: number;
}
export interface FolderData { id: string; userId: string; path: string; parentId: string | null; updatedAt: number; version: number; }
export interface TagData { id: string; userId: string; name: string; color: string | null; updatedAt: number; version: number; }
export interface SettingData { id: string; userId: string; key: string; value: string; updatedAt: number; version: number; }
export interface NoteShareData { id: string; ownerUserId: string; path: string; isFolder: boolean; sharedWithUserId: string; permission: string; createdAt: number; updatedAt: number; version: number; }
export interface TrashItemData { id: string; userId: string; originalPath: string; trashedAt: number; version: number; }
export interface CurrentUser { id: string; email: string; displayName: string; }

export interface SyncStatus {
  lastPullAt: number | null;
  lastPushAt: number | null;
  pending: number;
  online: boolean;
}

export interface NoteFilter { folderPath?: string; tag?: string; }

export interface KrytonDataAdapter {
  notes: {
    list(filter?: NoteFilter): NoteData[];
    findById(id: string): NoteData | null;
    findByPath(path: string): NoteData | null;
    create(input: { path: string; title: string; content?: string; tags?: string[] }): Promise<NoteData>;
    update(id: string, patch: Partial<NoteData> & { content?: string }): Promise<void>;
    delete(id: string): Promise<void>;
  };
  folders: {
    list(): FolderData[];
    create(input: { path: string; parentId: string | null }): Promise<FolderData>;
    delete(id: string): Promise<void>;
  };
  tags: { list(): TagData[]; };
  settings: {
    get(key: string): string | null;
    set(key: string, value: string): Promise<void>;
  };
  noteShares: { list(): NoteShareData[]; };
  trashItems: {
    list(): TrashItemData[];
    restore(id: string): Promise<void>;
    purge(id: string): Promise<void>;
    purgeAll(): Promise<void>;
  };

  subscribe(entityType: string, ids: string[] | "*", callback: () => void): () => void;

  openDocument(noteId: string): Promise<Y.Doc>;
  closeDocument(noteId: string): void;
  getAwareness(noteId: string): Awareness | null;
  readNoteContent(noteId: string): string | null;

  getSyncStatus(): SyncStatus;
  triggerSync(): Promise<void>;

  currentUser(): CurrentUser | null;
}
