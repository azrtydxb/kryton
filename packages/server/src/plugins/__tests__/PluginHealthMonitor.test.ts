import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PluginHealthMonitor } from "../PluginHealthMonitor";

describe("PluginHealthMonitor", () => {
  let monitor: PluginHealthMonitor;
  let onDisable: (pluginId: string) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    onDisable = vi.fn() as (pluginId: string) => void;
    monitor = new PluginHealthMonitor({
      maxErrors: 5,
      windowMs: 60_000,
      onDisable,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not disable plugin below error threshold", () => {
    for (let i = 0; i < 4; i++) {
      monitor.recordError("test-plugin");
    }
    expect(onDisable).not.toHaveBeenCalled();
  });

  it("disables plugin at error threshold", () => {
    for (let i = 0; i < 5; i++) {
      monitor.recordError("test-plugin");
    }
    expect(onDisable).toHaveBeenCalledWith("test-plugin");
  });

  it("resets error count after time window", () => {
    for (let i = 0; i < 4; i++) {
      monitor.recordError("test-plugin");
    }
    vi.advanceTimersByTime(61_000);
    monitor.recordError("test-plugin");
    expect(onDisable).not.toHaveBeenCalled();
  });

  it("tracks plugins independently", () => {
    for (let i = 0; i < 5; i++) {
      monitor.recordError("plugin-a");
    }
    expect(onDisable).toHaveBeenCalledWith("plugin-a");
    expect(onDisable).not.toHaveBeenCalledWith("plugin-b");
  });

  it("does not fire onDisable twice for the same plugin", () => {
    for (let i = 0; i < 10; i++) {
      monitor.recordError("test-plugin");
    }
    expect(onDisable).toHaveBeenCalledTimes(1);
  });

  it("reset clears error history for a plugin", () => {
    for (let i = 0; i < 4; i++) {
      monitor.recordError("test-plugin");
    }
    monitor.reset("test-plugin");
    for (let i = 0; i < 4; i++) {
      monitor.recordError("test-plugin");
    }
    expect(onDisable).not.toHaveBeenCalled();
  });
});
