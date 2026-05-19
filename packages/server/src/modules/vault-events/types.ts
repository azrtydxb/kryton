/**
 * VaultEvent — the discriminated union pushed over `/ws/vault` whenever a
 * user's note tree, folder structure, or tag set mutates.
 *
 * Every event carries:
 *   - `clientId`: stable per-tab/session id of the originating browser tab
 *     or `null` when the source is not a browser (MCP, disk watcher).
 *     Sockets that opened the channel with the same id suppress the echo;
 *     all others apply the patch.
 *   - `agentId` + `agentName`: populated when the change was made by an AI
 *     agent (today via WS bearer auth on `/ws/yjs`; MCP tools may pass
 *     `null` until agent attribution is wired through the API-key path).
 *
 * Updates carry `updatedAt` (ISO string) and `size` (bytes) so listeners
 * can refresh a row in the file-tree without a round-trip.
 */

export interface VaultEventBase {
  clientId: string | null;
  agentId: string | null;
  agentName: string | null;
}

export interface NoteCreatedEvent extends VaultEventBase {
  kind: "note.created";
  path: string;
  updatedAt: string;
  size: number;
}

export interface NoteUpdatedEvent extends VaultEventBase {
  kind: "note.updated";
  path: string;
  updatedAt: string;
  size: number;
}

export interface NoteDeletedEvent extends VaultEventBase {
  kind: "note.deleted";
  path: string;
}

export interface NoteRenamedEvent extends VaultEventBase {
  kind: "note.renamed";
  from: string;
  to: string;
  updatedAt: string;
  size: number;
}

export interface NoteMovedEvent extends VaultEventBase {
  kind: "note.moved";
  from: string;
  to: string;
  updatedAt: string;
  size: number;
}

export interface FolderCreatedEvent extends VaultEventBase {
  kind: "folder.created";
  path: string;
}

export interface FolderDeletedEvent extends VaultEventBase {
  kind: "folder.deleted";
  path: string;
}

export interface FolderRenamedEvent extends VaultEventBase {
  kind: "folder.renamed";
  from: string;
  to: string;
}

export interface TagAddedEvent extends VaultEventBase {
  kind: "tag.added";
  tag: string;
  path: string;
}

export interface TagRemovedEvent extends VaultEventBase {
  kind: "tag.removed";
  tag: string;
  path: string;
}

export type VaultEvent =
  | NoteCreatedEvent
  | NoteUpdatedEvent
  | NoteDeletedEvent
  | NoteRenamedEvent
  | NoteMovedEvent
  | FolderCreatedEvent
  | FolderDeletedEvent
  | FolderRenamedEvent
  | TagAddedEvent
  | TagRemovedEvent;

/**
 * Origin metadata threaded through the notes/folders services so the
 * single emission chokepoint can tag every outbound event with the
 * originating client + agent identity.
 */
export interface VaultEventOrigin {
  clientId: string | null;
  agentId: string | null;
  agentName: string | null;
}
