// packages/core/src/sync/__tests__/sync-auto.test.ts
import { describe, it, expect, vi } from "vitest";
import { SyncOrchestrator } from "../sync";

describe("startAuto", () => {
  it("runs full() on the configured interval", async () => {
    vi.useFakeTimers();
    const pull = vi.fn(async () => ({ cursor: "0", changes: {} }));
    const push = vi.fn(async () => ({ accepted: {}, conflicts: [] }));
    const o = new SyncOrchestrator({
      db: { transaction: (fn: any) => fn() } as any,
      bus: { emit: vi.fn(), on: vi.fn() } as any,
      storage: { get: () => "0", set: vi.fn() } as any,
      httpClient: { pull, push } as any,
      repositories: {},
    });
    o.startAuto({ intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(3500);
    // 3 full() calls in 3500ms (at 1000ms, 2000ms, 3000ms)
    expect(pull.mock.calls.length).toBeGreaterThanOrEqual(3);
    o.stopAuto();
    vi.useRealTimers();
  });

  it("stopAuto prevents further cycles", async () => {
    vi.useFakeTimers();
    const pull = vi.fn(async () => ({ cursor: "0", changes: {} }));
    const push = vi.fn(async () => ({ accepted: {}, conflicts: [] }));
    const o = new SyncOrchestrator({
      db: { transaction: (fn: any) => fn() } as any,
      bus: { emit: vi.fn(), on: vi.fn() } as any,
      storage: { get: () => "0", set: vi.fn() } as any,
      httpClient: { pull, push } as any,
      repositories: {},
    });
    o.startAuto({ intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1500);
    o.stopAuto();
    const callCount = pull.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(pull.mock.calls.length).toBe(callCount); // no more calls
    vi.useRealTimers();
  });
});
