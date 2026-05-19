/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { buildClientApi } from "../PluginRoot";
import { PluginSlotRegistry } from "../registry";
import { resetHostHooks, setHostHooks } from "../host-hooks";
import type { ActivePluginInfo } from "../types";

const fakeInfo: ActivePluginInfo = {
  id: "test",
  name: "Test",
  version: "1.0.0",
  description: "",
  client: null,
  settings: [],
};

describe("buildClientApi → host-hooks wiring", () => {
  beforeEach(() => {
    resetHostHooks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("api.ui.closePane is a no-op when no host hook is registered", () => {
    const api = buildClientApi("test", new PluginSlotRegistry(), fakeInfo);
    // No throw, no return value — and no spy to call. Sanity.
    expect(() => api.ui.closePane()).not.toThrow();
  });

  it("api.ui.closePane invokes the registered host hook", () => {
    const closePane = vi.fn();
    setHostHooks({ closePane });
    const api = buildClientApi("test", new PluginSlotRegistry(), fakeInfo);
    api.ui.closePane();
    expect(closePane).toHaveBeenCalledOnce();
  });

  it("api.notes.saveCurrent rejects when no host hook is registered", async () => {
    const api = buildClientApi("test", new PluginSlotRegistry(), fakeInfo);
    await expect(api.notes.saveCurrent()).rejects.toThrow(/no host save/i);
  });

  it("api.notes.saveCurrent resolves with the host hook's payload", async () => {
    const saveCurrent = vi.fn(async () => ({
      path: "notes/Daily.md",
      savedAt: "2026-05-19T12:00:00Z",
    }));
    setHostHooks({ saveCurrent });
    const api = buildClientApi("test", new PluginSlotRegistry(), fakeInfo);
    const result = await api.notes.saveCurrent();
    expect(saveCurrent).toHaveBeenCalledOnce();
    expect(result).toEqual({
      path: "notes/Daily.md",
      savedAt: "2026-05-19T12:00:00Z",
    });
  });
});
