import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginApiFactory } from "../PluginApiFactory";
import { PluginEventBus } from "../PluginEventBus";
import { PluginRouter } from "../PluginRouter";
import { PluginHealthMonitor } from "../PluginHealthMonitor";
import express from "express";

describe("PluginApiFactory", () => {
  let factory: PluginApiFactory;
  let eventBus: PluginEventBus;
  let pluginRouter: PluginRouter;
  let healthMonitor: PluginHealthMonitor;

  beforeEach(() => {
    eventBus = new PluginEventBus();
    pluginRouter = new PluginRouter(express());
    healthMonitor = new PluginHealthMonitor({
      maxErrors: 5,
      windowMs: 60_000,
      onDisable: vi.fn(),
    });
    factory = new PluginApiFactory({
      eventBus,
      pluginRouter,
      healthMonitor,
      notesDir: "/tmp/test-notes",
    });
  });

  it("creates a scoped API for a plugin", () => {
    const api = factory.createApi({
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      description: "A test plugin",
      author: "Test",
      minKrytonVersion: "2.0.0",
    });

    expect(api.plugin.id).toBe("test-plugin");
    expect(api.plugin.version).toBe("1.0.0");
    expect(api.notes).toBeDefined();
    expect(api.events).toBeDefined();
    expect(api.routes).toBeDefined();
    expect(api.storage).toBeDefined();
    expect(api.log).toBeDefined();
  });

  it("scopes event registrations to the plugin", () => {
    const api = factory.createApi({
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      description: "A test plugin",
      author: "Test",
      minKrytonVersion: "2.0.0",
    });

    const handler = vi.fn();
    api.events.on("note:afterSave", handler);

    // Removing all for this plugin should remove the handler
    eventBus.removeAllForPlugin("test-plugin");
    eventBus.emit("note:afterSave", {});
    expect(handler).not.toHaveBeenCalled();
  });

  it("prefixes log messages with plugin id", () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const api = factory.createApi({
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      description: "A test plugin",
      author: "Test",
      minKrytonVersion: "2.0.0",
    });

    api.log.info("hello");
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[INFO] [plugin:test-plugin] hello"),
    );
    consoleSpy.mockRestore();
  });
});
