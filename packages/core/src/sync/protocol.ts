// packages/core/src/sync/protocol.ts
// Wire protocol types for sync v2 — imported by both client (core) and server (2C stream).

export interface PullRequest {
  cursor: string; // BigInt as string
}

export interface PullResponse {
  cursor: string;
  changes: Record<string, TableChanges>;
  truncated?: boolean;
}

export interface TableChanges {
  created: Array<Record<string, unknown>>;
  updated: Array<Record<string, unknown>>;
  deleted: string[];
}

export interface PushRequest {
  changes: Record<string, EntityOp[]>;
}

export type EntityOp =
  | { op: "create"; id: string; fields: Record<string, unknown> }
  | { op: "update"; id: string; base_version: number; fields: Record<string, unknown> }
  | { op: "delete"; id: string };

export interface PushResponse {
  accepted: Record<string, AcceptedEntity[]>;
  conflicts: Conflict[];
}

export interface AcceptedEntity {
  id: string;
  version: number;
  merged_value?: Record<string, unknown>; // for tag-merge results
}

export interface Conflict {
  table: string;
  id: string;
  current_version: number;
  current_state: Record<string, unknown>;
}

export interface VersionResponse {
  apiVersion: string;     // semver of the API
  schemaVersion: string;  // semver of the data schema
  supportedClientRange: string; // e.g., ">=4.4.0 <5.0.0"
}
