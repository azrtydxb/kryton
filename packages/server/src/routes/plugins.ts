import path from "path";
import fs from "fs";
import { Router } from "express";
import { PluginManager } from "../plugins/PluginManager";
import { adminMiddleware } from "../middleware/auth";
import {
  fetchRegistry,
  downloadPlugin,
  checkForUpdates,
} from "../services/pluginRegistryService";
import { AppDataSource } from "../data-source";
import { InstalledPlugin } from "../entities/InstalledPlugin";

/**
 * @swagger
 * /api/plugins/active:
 *   get:
 *     summary: List active plugins with client bundle info
 *     tags: [Plugins]
 *     responses:
 *       200:
 *         description: Array of active plugin metadata
 */

/**
 * @swagger
 * /api/plugins/all:
 *   get:
 *     summary: List all plugins with state info
 *     tags: [Plugins]
 *     responses:
 *       200:
 *         description: Array of all plugin metadata including state
 */
export function createPluginsRouter(pluginManager: PluginManager, pluginsDir: string): Router {
  const router = Router();

  router.get("/active", (_req, res) => {
    const active = pluginManager.getActivePlugins();
    res.json(
      active.map((p) => ({
        id: p.manifest.id,
        name: p.manifest.name,
        version: p.manifest.version,
        description: p.manifest.description,
        client: p.manifest.client ? `/plugins/${p.manifest.id}/client/index.js` : null,
        settings: p.manifest.settings || [],
      }))
    );
  });

  router.get("/all", (_req, res) => {
    const all = pluginManager.listPlugins();
    res.json(
      all.map((p) => ({
        id: p.manifest.id,
        name: p.manifest.name,
        version: p.manifest.version,
        description: p.manifest.description,
        author: p.manifest.author,
        state: p.state,
        error: p.error,
        settings: p.manifest.settings || [],
      }))
    );
  });

  /**
   * @swagger
   * /api/plugins/{id}/enable:
   *   post:
   *     summary: Enable and load a plugin (admin only)
   *     tags: [Plugins]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Plugin enabled
   *       404:
   *         description: Plugin not found
   *       403:
   *         description: Admin access required
   */
  router.post("/:id/enable", adminMiddleware, async (req, res) => {
    const id = req.params.id as string;
    try {
      await pluginManager.loadPlugin(id);
      const plugin = pluginManager.getPlugin(id);
      res.json({ id, state: plugin?.state ?? "active" });
    } catch (err) {
      res.status(404).json({ error: `Plugin not found or failed to load: ${(err as Error).message}` });
    }
  });

  /**
   * @swagger
   * /api/plugins/{id}/disable:
   *   post:
   *     summary: Disable and unload a plugin (admin only)
   *     tags: [Plugins]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Plugin disabled
   *       403:
   *         description: Admin access required
   */
  router.post("/:id/disable", adminMiddleware, async (req, res) => {
    const id = req.params.id as string;
    await pluginManager.disablePlugin(id);
    res.json({ id, state: "unloaded", enabled: false });
  });

  /**
   * @swagger
   * /api/plugins/{id}/reload:
   *   post:
   *     summary: Hot-swap reload a plugin (admin only)
   *     tags: [Plugins]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Plugin reloaded
   *       404:
   *         description: Plugin not found
   *       403:
   *         description: Admin access required
   */
  router.post("/:id/reload", adminMiddleware, async (req, res) => {
    const id = req.params.id as string;
    try {
      await pluginManager.reloadPlugin(id);
      const plugin = pluginManager.getPlugin(id);
      res.json({ id, state: plugin?.state ?? "active" });
    } catch (err) {
      res.status(404).json({ error: `Plugin reload failed: ${(err as Error).message}` });
    }
  });

  // ── Registry endpoints (admin only) ──────────────────────────────────────

  /**
   * @swagger
   * /api/plugins/registry:
   *   get:
   *     summary: Fetch the plugin registry (cached 5 min)
   *     tags: [Plugins]
   *     responses:
   *       200:
   *         description: Array of available plugins from registry
   *       403:
   *         description: Admin access required
   */
  router.get("/registry", adminMiddleware, async (_req, res) => {
    try {
      const registry = await fetchRegistry();
      res.json(registry.plugins);
    } catch (err) {
      res.status(502).json({ error: `Failed to fetch registry: ${(err as Error).message}` });
    }
  });

  /**
   * @swagger
   * /api/plugins/updates:
   *   get:
   *     summary: Check for available plugin updates
   *     tags: [Plugins]
   *     responses:
   *       200:
   *         description: Array of plugins with available updates
   *       403:
   *         description: Admin access required
   */
  router.get("/updates", adminMiddleware, async (_req, res) => {
    try {
      const repo = AppDataSource.getRepository(InstalledPlugin);
      const installed = await repo.find();
      const updates = await checkForUpdates(
        installed.map((p) => ({ id: p.id, version: p.version }))
      );
      res.json(updates);
    } catch (err) {
      res.status(502).json({ error: `Failed to check for updates: ${(err as Error).message}` });
    }
  });

  /**
   * @swagger
   * /api/plugins/install/{id}:
   *   post:
   *     summary: Download and install a plugin from the registry
   *     tags: [Plugins]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Plugin installed and activated
   *       400:
   *         description: Plugin not found in registry
   *       403:
   *         description: Admin access required
   */
  router.post("/install/:id", adminMiddleware, async (req, res) => {
    const id = req.params.id as string;
    try {
      const registry = await fetchRegistry();
      const registryPlugin = registry.plugins.find((p) => p.id === id);
      if (!registryPlugin) {
        res.status(400).json({ error: `Plugin "${id}" not found in registry` });
        return;
      }

      await downloadPlugin(id, pluginsDir);
      await pluginManager.loadPlugin(id);

      const plugin = pluginManager.getPlugin(id);
      res.json({ id, state: plugin?.state ?? "active", version: registryPlugin.version });
    } catch (err) {
      res.status(500).json({ error: `Failed to install plugin: ${(err as Error).message}` });
    }
  });

  /**
   * @swagger
   * /api/plugins/update/{id}:
   *   post:
   *     summary: Download and hot-swap a plugin with the latest registry version
   *     tags: [Plugins]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Plugin updated and reactivated
   *       400:
   *         description: Plugin not found in registry
   *       403:
   *         description: Admin access required
   */
  router.post("/update/:id", adminMiddleware, async (req, res) => {
    const id = req.params.id as string;
    try {
      const registry = await fetchRegistry();
      const registryPlugin = registry.plugins.find((p) => p.id === id);
      if (!registryPlugin) {
        res.status(400).json({ error: `Plugin "${id}" not found in registry` });
        return;
      }

      await pluginManager.unloadPlugin(id);
      await downloadPlugin(id, pluginsDir);
      await pluginManager.loadPlugin(id);

      const plugin = pluginManager.getPlugin(id);
      res.json({ id, state: plugin?.state ?? "active", version: registryPlugin.version });
    } catch (err) {
      res.status(500).json({ error: `Failed to update plugin: ${(err as Error).message}` });
    }
  });

  /**
   * @swagger
   * /api/plugins/{id}/uninstall:
   *   post:
   *     summary: Deactivate and remove a plugin
   *     tags: [Plugins]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Plugin uninstalled
   *       403:
   *         description: Admin access required
   */
  router.post("/:id/uninstall", adminMiddleware, async (req, res) => {
    const id = req.params.id as string;
    try {
      await pluginManager.unloadPlugin(id);

      const pluginDir = path.join(pluginsDir, id);
      if (fs.existsSync(pluginDir)) {
        fs.rmSync(pluginDir, { recursive: true, force: true });
      }

      const repo = AppDataSource.getRepository(InstalledPlugin);
      await repo.delete(id);

      // Note: PluginStorage entries are intentionally kept to preserve user data

      res.json({ id, uninstalled: true });
    } catch (err) {
      res.status(500).json({ error: `Failed to uninstall plugin: ${(err as Error).message}` });
    }
  });

  return router;
}
