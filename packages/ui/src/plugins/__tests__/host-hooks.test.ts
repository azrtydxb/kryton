/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getHostHooks, resetHostHooks, setHostHooks } from "../host-hooks";

describe("host-hooks registry", () => {
  beforeEach(() => {
    resetHostHooks();
  });

  it("starts empty", () => {
    expect(getHostHooks()).toEqual({});
  });

  it("setHostHooks stores the implementations", async () => {
    const saveCurrent = vi.fn(async () => ({
      path: "n.md",
      savedAt: "2026-05-19T00:00:00Z",
    }));
    const closePane = vi.fn();
    setHostHooks({ saveCurrent, closePane });
    const hooks = getHostHooks();
    expect(await hooks.saveCurrent?.()).toEqual({
      path: "n.md",
      savedAt: "2026-05-19T00:00:00Z",
    });
    hooks.closePane?.();
    expect(closePane).toHaveBeenCalledOnce();
  });

  it("resetHostHooks clears", () => {
    setHostHooks({ closePane: () => {} });
    resetHostHooks();
    expect(getHostHooks()).toEqual({});
  });

  it("setHostHooks replaces, does not merge", () => {
    setHostHooks({ closePane: () => {}, saveCurrent: async () => ({ path: "", savedAt: "" }) });
    setHostHooks({ closePane: () => {} });
    expect(getHostHooks().saveCurrent).toBeUndefined();
  });
});
