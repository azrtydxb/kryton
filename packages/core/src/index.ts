// packages/core/src/index.ts
// Public API barrel for @azrtydxb/core

export { Kryton } from "./kryton";
export type { KrytonInitOpts } from "./kryton";

export { EventBus } from "./events";

export {
  KrytonError,
  KrytonStorageError,
  KrytonSyncError,
  KrytonConflictError,
  KrytonYjsError,
  KrytonAuthError,
} from "./errors";

export type {
  PullRequest,
  PullResponse,
  PushRequest,
  PushResponse,
  EntityOp,
  AcceptedEntity,
  Conflict,
  VersionResponse,
  TableChanges,
} from "./sync/protocol";

export type { SqliteAdapter, Row, SqliteRunResult } from "./adapter";

export { applySchema } from "./bootstrap";
export { LocalStorage } from "./storage";
export { isCompatibleVersion } from "./version-check";

export { KRYTON_CORE_VERSION } from "./version";

// Entity types
export type { Note } from "./query/notes";
export type { Folder } from "./query/folders";
export type { Tag } from "./query/tags";
export type { Settings } from "./query/settings";
export type { NoteShare } from "./query/note-shares";
export type { TrashItem } from "./query/trash-items";
export type { GraphEdge } from "./query/graph-edges";
export type { InstalledPlugin } from "./query/installed-plugins";

// Repositories (for consumers who want type access)
export { NotesRepository } from "./query/notes";
export { FoldersRepository } from "./query/folders";
export { TagsRepository } from "./query/tags";
export { SettingsRepository } from "./query/settings";
export { NoteSharesRepository } from "./query/note-shares";
export { TrashItemsRepository } from "./query/trash-items";
export { GraphEdgesRepository } from "./query/graph-edges";
export { InstalledPluginsRepository } from "./query/installed-plugins";
export { BaseRepository } from "./query/base";
export type { BaseRepoOpts } from "./query/base";

// Sync internals (for consumers building server adapters)
export { HttpSyncClient } from "./sync/http";
export type { HttpSyncClientOpts } from "./sync/http";
export { SyncOrchestrator } from "./sync/sync";
export type { SyncOrchestratorOpts } from "./sync/sync";
