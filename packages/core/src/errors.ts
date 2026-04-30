// packages/core/src/errors.ts
import type { Conflict } from "./sync/protocol";

export class KrytonError extends Error {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "KrytonError";
    this.cause = cause;
  }
}

export class KrytonStorageError extends KrytonError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "KrytonStorageError";
  }
}

export class KrytonSyncError extends KrytonError {
  retryable: boolean;
  constructor(message: string, opts: { retryable: boolean; cause?: unknown }) {
    super(message, opts.cause);
    this.name = "KrytonSyncError";
    this.retryable = opts.retryable;
  }
}

export class KrytonConflictError extends KrytonError {
  conflicts: Conflict[];
  constructor(message: string, opts: { conflicts: Conflict[] }) {
    super(message);
    this.name = "KrytonConflictError";
    this.conflicts = opts.conflicts;
  }
}

export class KrytonYjsError extends KrytonError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "KrytonYjsError";
  }
}

export class KrytonAuthError extends KrytonError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "KrytonAuthError";
  }
}
