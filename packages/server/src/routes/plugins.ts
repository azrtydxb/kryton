import { Router } from "express";
import { PluginManager } from "../plugins/PluginManager";

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
export function createPluginsRouter(pluginManager: PluginManager): Router {
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

  return router;
}
