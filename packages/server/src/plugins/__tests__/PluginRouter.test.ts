import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import { PluginRouter } from "../PluginRouter";

describe("PluginRouter", () => {
  let app: express.Express;
  let pluginRouter: PluginRouter;

  beforeEach(() => {
    app = express();
    pluginRouter = new PluginRouter(app);
  });

  it("registers a GET route for a plugin", () => {
    pluginRouter.register("test-plugin", "get", "/boards", (req, res) => {
      res.json({ ok: true });
    });

    const routes = pluginRouter.getRoutesForPlugin("test-plugin");
    expect(routes).toEqual([{ method: "get", path: "/boards" }]);
  });

  it("removes all routes for a plugin", () => {
    pluginRouter.register("test-plugin", "get", "/boards", (req, res) => {
      res.json({ ok: true });
    });
    pluginRouter.register("test-plugin", "post", "/boards", (req, res) => {
      res.json({ ok: true });
    });

    pluginRouter.removeAllForPlugin("test-plugin");
    const routes = pluginRouter.getRoutesForPlugin("test-plugin");
    expect(routes).toEqual([]);
  });

  it("tracks routes for different plugins independently", () => {
    pluginRouter.register("plugin-a", "get", "/a", (req, res) => {
      res.json({});
    });
    pluginRouter.register("plugin-b", "get", "/b", (req, res) => {
      res.json({});
    });

    pluginRouter.removeAllForPlugin("plugin-a");
    expect(pluginRouter.getRoutesForPlugin("plugin-a")).toEqual([]);
    expect(pluginRouter.getRoutesForPlugin("plugin-b")).toHaveLength(1);
  });
});
