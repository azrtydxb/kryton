/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getHostHooks,
  resetHostHooks,
  setHostHooks,
  subscribeHostHooks,
} from "../host-hooks";

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

  it("subscribeHostHooks fires on every setHostHooks", () => {
    const listener = vi.fn();
    const unsub = subscribeHostHooks(listener);
    setHostHooks({ theme: "light" });
    setHostHooks({ theme: "dark" });
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
    setHostHooks({ theme: "light" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("subscribers can read the latest snapshot inside the callback", () => {
    let seen: string | undefined;
    subscribeHostHooks(() => {
      seen = getHostHooks().theme;
    });
    setHostHooks({ theme: "light" });
    expect(seen).toBe("light");
    setHostHooks({ theme: "dark" });
    expect(seen).toBe("dark");
  });

  it("a throwing subscriber does not prevent siblings from firing", () => {
    const good = vi.fn();
    subscribeHostHooks(() => {
      throw new Error("boom");
    });
    subscribeHostHooks(good);
    setHostHooks({ theme: "dark" });
    expect(good).toHaveBeenCalledOnce();
  });

  it("stores reactive snapshots (currentUser/currentNote/theme/pluginSettings)", () => {
    setHostHooks({
      currentUser: { id: "u1", name: "Alice", email: "a@x" },
      currentNote: { path: "n.md", content: "# x" },
      theme: "light",
      pluginSettings: { "p-1": { accent: "#fff" } },
    });
    const h = getHostHooks();
    expect(h.currentUser?.id).toBe("u1");
    expect(h.currentNote?.path).toBe("n.md");
    expect(h.theme).toBe("light");
    expect(h.pluginSettings?.["p-1"]?.accent).toBe("#fff");
  });

  it("resetHostHooks clears subscribers too", () => {
    const listener = vi.fn();
    subscribeHostHooks(listener);
    resetHostHooks();
    setHostHooks({ theme: "dark" });
    expect(listener).not.toHaveBeenCalled();
  });
});
