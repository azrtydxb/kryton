import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ValidationError } from "../../../lib/errors.js";
import type { PluginStorageService } from "../services/storage.service.js";

export interface BuiltinStorageRoutesDeps {
  storage: PluginStorageService;
}

const PLUGIN_ID_HEADER = "x-kryton-plugin-id";
const PLUGIN_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function getPluginId(req: FastifyRequest): string {
  const raw = req.headers[PLUGIN_ID_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || typeof value !== "string" || !PLUGIN_ID_REGEX.test(value)) {
    throw new ValidationError(
      `Missing or invalid ${PLUGIN_ID_HEADER} header`,
    );
  }
  return value;
}

const getQuerySchema = z.object({ key: z.string().min(1) });
const listQuerySchema = z.object({ prefix: z.string().optional() });
const setBodySchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});
const deleteQuerySchema = z.object({ key: z.string().min(1) });

const okResponse = z.object({ ok: z.literal(true) });

/**
 * Built-in plugin key-value storage API surfaced to client plugins under
 * /api/plugin-builtin/storage/*. Scoped by plugin id (from the
 * X-Kryton-Plugin-Id request header) and by the authenticated user. Backed
 * by `PluginStorageService`.
 */
export const builtinStorageRoutes = (
  deps: BuiltinStorageRoutesDeps,
): FastifyPluginAsync =>
  async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();
    const { storage } = deps;

    typed.get(
      "/get",
      {
        schema: {
          tags: ["plugin-builtin"],
          summary: "Read a storage key for the current user + plugin",
          querystring: getQuerySchema,
          response: { 200: z.object({ value: z.unknown() }) },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const pluginId = getPluginId(req);
        const value = await storage.get(pluginId, req.query.key, user.id);
        return { value };
      },
    );

    typed.post(
      "/set",
      {
        schema: {
          tags: ["plugin-builtin"],
          summary: "Write a storage key for the current user + plugin",
          body: setBodySchema,
          response: { 200: okResponse },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const pluginId = getPluginId(req);
        await storage.set(pluginId, req.body.key, req.body.value, user.id);
        return { ok: true as const };
      },
    );

    typed.delete(
      "/delete",
      {
        schema: {
          tags: ["plugin-builtin"],
          summary: "Delete a storage key for the current user + plugin",
          querystring: deleteQuerySchema,
          response: { 200: okResponse },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const pluginId = getPluginId(req);
        await storage.delete(pluginId, req.query.key, user.id);
        return { ok: true as const };
      },
    );

    typed.get(
      "/list",
      {
        schema: {
          tags: ["plugin-builtin"],
          summary: "List storage entries for the current user + plugin",
          querystring: listQuerySchema,
          response: {
            200: z.array(
              z.object({
                key: z.string(),
                value: z.unknown(),
                userId: z.string().nullable(),
              }),
            ),
          },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const pluginId = getPluginId(req);
        return storage.list(pluginId, req.query.prefix, user.id);
      },
    );
  };
