// packages/core/src/__tests__/errors.test.ts
import { describe, it, expect } from "vitest";
import {
  KrytonError, KrytonStorageError, KrytonSyncError, KrytonConflictError,
  KrytonYjsError, KrytonAuthError,
} from "../errors";

describe("Kryton errors", () => {
  it("KrytonError has name set", () => {
    const e = new KrytonError("x");
    expect(e.name).toBe("KrytonError");
    expect(e instanceof Error).toBe(true);
  });
  it("subclasses inherit name", () => {
    expect(new KrytonStorageError("a").name).toBe("KrytonStorageError");
    expect(new KrytonSyncError("b", { retryable: true }).name).toBe("KrytonSyncError");
    expect(new KrytonConflictError("c", { conflicts: [] }).name).toBe("KrytonConflictError");
    expect(new KrytonYjsError("d").name).toBe("KrytonYjsError");
    expect(new KrytonAuthError("e").name).toBe("KrytonAuthError");
  });
  it("KrytonSyncError exposes retryable", () => {
    expect(new KrytonSyncError("x", { retryable: true }).retryable).toBe(true);
  });
});
