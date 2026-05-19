/**
 * Client-side mirror of the server's `VaultEvent` discriminated union
 * (see packages/server/src/modules/vault-events/types.ts). Duplicated
 * because there is no shared schema package between the two halves
 * today; the two definitions must stay in sync.
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
