import path from "node:path";
import fs from "node:fs/promises";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { validatePluginId } from "../../../lib/pathUtils.js";
import { NotFoundError, ValidationError, AppError } from "../../../lib/errors.js";
import type { PluginManager } from "../services/manager.js";
import type { PluginRegistryService } from "../services/registry.service.js";

const idParamsSchema = z.object({ id: z.string() });

const activePluginSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  client: z.string().nullable(),
  settings: z.array(z.unknown()),
});

const allPluginSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  author: z.string().optional(),
  state: z.string(),
  error: z.string().nullable(),
  settings: z.array(z.unknown()),
});

const stateResponseSchema = z.object({
  id: z.string(),
  state: z.string(),
  version: z.string().optional(),
  enabled: z.boolean().optional(),
  uninstalled: z.boolean().optional(),
});

// Lenient — the registry is hosted in a third-party GitHub repo; entries
// may omit optional metadata. Coerce missing/null fields to defaults so
// response serialization doesn't 500 on a stale registry entry.
const registryPluginSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish().transform((v) => v ?? ""),
  author: z.string().nullish().transform((v) => v ?? ""),
  version: z.string(),
  minKrytonVersion: z.string().nullish().transform((v) => v ?? ""),
  tags: z.array(z.string()).nullish().transform((v) => v ?? []),
  icon: z.string().nullish().transform((v) => v ?? ""),
});

const updateInfoSchema = z.object({
  id: z.string(),
  currentVersion: z.string(),
  latestVersion: z.string(),
});

interface PluginsRoutesDeps {
  pluginManager: PluginManager;
  registry: PluginRegistryService;
  pluginsDir: string;
}

/**
 * Plugin lifecycle routes. Mounted under `/api/plugins` by the plugins
 * module. All endpoints require an authenticated user; admin-only
 * endpoints use `app.auth.requireAdmin`.
 */
export const pluginsRoutes = (deps: PluginsRoutesDeps): FastifyPluginAsync =>
  async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();
    const { pluginManager, registry, pluginsDir } = deps;

    // GET /active — list active plugins (auth required)
    typed.get(
      "/active",
      {
        schema: {
          tags: ["plugins"],
          summary: "List active plugins with client bundle info",
          response: { 200: z.array(activePluginSchema) },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async () => {
        const active = pluginManager.getActivePlugins();
        return active.map((p) => ({
          id: p.manifest.id,
          name: p.manifest.name,
          version: p.manifest.version,
          description: p.manifest.description,
          client: p.manifest.client ? `/plugins/${p.manifest.id}/client/index.js` : null,
          settings: p.manifest.settings ?? [],
        }));
      },
    );

    // GET /all — list all plugins (admin)
    typed.get(
      "/all",
      {
        schema: {
          tags: ["plugins"],
          summary: "List all plugins with state info (admin)",
          response: { 200: z.array(allPluginSchema) },
        },
        preHandler: async (req) => {
          await app.auth.requireAdmin(req);
        },
      },
      async () => {
        const all = pluginManager.listPlugins();
        return all.map((p) => ({
          id: p.manifest.id,
          name: p.manifest.name,
          version: p.manifest.version,
          description: p.manifest.description,
          author: p.manifest.author,
          state: p.state,
          error: p.error,
          settings: p.manifest.settings ?? [],
        }));
      },
    );

    // POST /:id/enable
    typed.post(
      "/:id/enable",
      {
        schema: {
          tags: ["plugins"],
          summary: "Enable and load a plugin (admin)",
          params: idParamsSchema,
          response: { 200: stateResponseSchema },
        },
        preHandler: async (req) => {
          await app.auth.requireAdmin(req);
        },
      },
      async (req) => {
        const { id } = req.params;
        try {
          validatePluginId(id);
        } catch (err) {
          throw new ValidationError((err as Error).message);
        }
        try {
          await pluginManager.loadPlugin(id);
        } catch (err) {
          throw new NotFoundError(`Plugin not found or failed to load: ${(err as Error).message}`);
        }
        const plugin = pluginManager.getPlugin(id);
        return { id, state: plugin?.state ?? "active" };
      },
    );

    // POST /:id/disable
    typed.post(
      "/:id/disable",
      {
        schema: {
          tags: ["plugins"],
          summary: "Disable and unload a plugin (admin)",
          params: idParamsSchema,
          response: { 200: stateResponseSchema },
        },
        preHandler: async (req) => {
          await app.auth.requireAdmin(req);
        },
      },
      async (req) => {
        const { id } = req.params;
        try {
          validatePluginId(id);
        } catch (err) {
          throw new ValidationError((err as Error).message);
        }
        await pluginManager.disablePlugin(id);
        return { id, state: "unloaded", enabled: false };
      },
    );

    // POST /:id/reload
    typed.post(
      "/:id/reload",
      {
        schema: {
          tags: ["plugins"],
          summary: "Hot-swap reload a plugin (admin)",
          params: idParamsSchema,
          response: { 200: stateResponseSchema },
        },
        preHandler: async (req) => {
          await app.auth.requireAdmin(req);
        },
      },
      async (req) => {
        const { id } = req.params;
        try {
          validatePluginId(id);
        } catch (err) {
          throw new ValidationError((err as Error).message);
        }
        try {
          await pluginManager.reloadPlugin(id);
        } catch (err) {
          throw new NotFoundError(`Plugin reload failed: ${(err as Error).message}`);
        }
        const plugin = pluginManager.getPlugin(id);
        return { id, state: plugin?.state ?? "active" };
      },
    );

    // GET /registry
    typed.get(
      "/registry",
      {
        schema: {
          tags: ["plugins"],
          summary: "Fetch the plugin registry (cached 5 min)",
          response: { 200: z.array(registryPluginSchema) },
        },
        preHandler: async (req) => {
          await app.auth.requireAdmin(req);
        },
      },
      async () => {
        try {
          const data = await registry.fetchRegistry();
          return data.plugins;
        } catch (err) {
          throw new AppError(
            `Failed to fetch registry: ${(err as Error).message}`,
            502,
            "REGISTRY_FETCH_FAILED",
          );
        }
      },
    );

    // GET /updates
    typed.get(
      "/updates",
      {
        schema: {
          tags: ["plugins"],
          summary: "Check for available plugin updates (admin)",
          response: { 200: z.array(updateInfoSchema) },
        },
        preHandler: async (req) => {
          await app.auth.requireAdmin(req);
        },
      },
      async () => {
        try {
          const installed = await app.prisma.installedPlugin.findMany();
          return registry.checkForUpdates(
            installed.map((p) => ({ id: p.id, version: p.version })),
          );
        } catch (err) {
          throw new AppError(
            `Failed to check for updates: ${(err as Error).message}`,
            502,
            "UPDATE_CHECK_FAILED",
          );
        }
      },
    );

    // POST /install/:id
    typed.post(
      "/install/:id",
      {
        schema: {
          tags: ["plugins"],
          summary: "Download and install a plugin from the registry (admin)",
          params: idParamsSchema,
          response: { 200: stateResponseSchema },
        },
        preHandler: async (req) => {
          await app.auth.requireAdmin(req);
        },
      },
      async (req) => {
        const { id } = req.params;
        try {
          validatePluginId(id);
        } catch (err) {
          throw new ValidationError((err as Error).message);
        }
        try {
          const data = await registry.fetchRegistry();
          const registryPlugin = data.plugins.find((p) => p.id === id);
          if (!registryPlugin) {
            throw new ValidationError(`Plugin "${id}" not found in registry`);
          }
          await registry.downloadPlugin(id, pluginsDir);
          await pluginManager.loadPlugin(id);
          const plugin = pluginManager.getPlugin(id);
          return { id, state: plugin?.state ?? "active", version: registryPlugin.version };
        } catch (err) {
          if (err instanceof AppError) throw err;
          throw new AppError(
            `Failed to install plugin: ${(err as Error).message}`,
            500,
            "PLUGIN_INSTALL_FAILED",
          );
        }
      },
    );

    // POST /update/:id
    typed.post(
      "/update/:id",
      {
        schema: {
          tags: ["plugins"],
          summary: "Download and hot-swap a plugin with the latest registry version (admin)",
          params: idParamsSchema,
          response: { 200: stateResponseSchema },
        },
        preHandler: async (req) => {
          await app.auth.requireAdmin(req);
        },
      },
      async (req) => {
        const { id } = req.params;
        try {
          validatePluginId(id);
        } catch (err) {
          throw new ValidationError((err as Error).message);
        }
        try {
          const data = await registry.fetchRegistry();
          const registryPlugin = data.plugins.find((p) => p.id === id);
          if (!registryPlugin) {
            throw new ValidationError(`Plugin "${id}" not found in registry`);
          }
          await pluginManager.unloadPlugin(id);
          await registry.downloadPlugin(id, pluginsDir);
          await pluginManager.loadPlugin(id);
          const plugin = pluginManager.getPlugin(id);
          return { id, state: plugin?.state ?? "active", version: registryPlugin.version };
        } catch (err) {
          if (err instanceof AppError) throw err;
          throw new AppError(
            `Failed to update plugin: ${(err as Error).message}`,
            500,
            "PLUGIN_UPDATE_FAILED",
          );
        }
      },
    );

    // POST /:id/uninstall
    typed.post(
      "/:id/uninstall",
      {
        schema: {
          tags: ["plugins"],
          summary: "Deactivate and remove a plugin (admin)",
          params: idParamsSchema,
          response: { 200: stateResponseSchema },
        },
        preHandler: async (req) => {
          await app.auth.requireAdmin(req);
        },
      },
      async (req) => {
        const { id } = req.params;
        try {
          validatePluginId(id);
        } catch (err) {
          throw new ValidationError((err as Error).message);
        }
        try {
          await pluginManager.unloadPlugin(id);

          const pluginDir = path.join(pluginsDir, id);
          try {
            await fs.rm(pluginDir, { recursive: true, force: true });
          } catch {
            // Directory may not exist
          }

          await app.prisma.installedPlugin.delete({ where: { id } });
          // Note: PluginStorage entries are intentionally kept to preserve user data

          return { id, state: "unloaded", uninstalled: true };
        } catch (err) {
          if (err instanceof AppError) throw err;
          throw new AppError(
            `Failed to uninstall plugin: ${(err as Error).message}`,
            500,
            "PLUGIN_UNINSTALL_FAILED",
          );
        }
      },
    );
  };
