import path from "node:path";
import fs from "node:fs";
import { and, eq, or, like } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { GLOBAL_USER_ID, validatePathWithinBase, ensureExtension } from "../../../lib/pathUtils.js";
import { settings } from "../../../db/schema/settings.js";
import { searchIndex } from "../../../db/schema/notes.js";
import type {
  IndexFields,
  NoteEntry,
  NotesOps,
  PluginAPI,
  PluginEvent,
  PluginEventHandler,
  PluginManifest,
  PluginRouteHandler,
} from "./types.js";
import type { PluginEventBus } from "./event-bus.js";
import type { PluginRouter } from "./plugin-router.js";
import type { PluginHealthMonitor } from "./health-monitor.js";
import type { PluginStorageService } from "./storage.service.js";

type Db = FastifyInstance["db"];

interface SimpleLogger {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

export interface PluginApiFactoryDeps {
  eventBus: PluginEventBus;
  pluginRouter: PluginRouter;
  healthMonitor: PluginHealthMonitor;
  storage: PluginStorageService;
  db: Db;
  notesDir: string;
  notesOps: NotesOps;
  /** Factory that returns a logger scoped by tag. */
  loggerFactory: (tag: string) => SimpleLogger;
}

export class PluginApiFactory {
  private readonly deps: PluginApiFactoryDeps;

  constructor(deps: PluginApiFactoryDeps) {
    this.deps = deps;
  }

  createApi(manifest: PluginManifest): PluginAPI {
    const pluginId = manifest.id;
    const dataDir = path.join(process.cwd(), "data", "plugins", pluginId);
    fs.mkdirSync(dataDir, { recursive: true });

    const api: PluginAPI = {
      notes: this.createNotesApi(),
      events: this.createEventsApi(pluginId),
      routes: this.createRoutesApi(pluginId),
      storage: this.createStorageApi(pluginId),
      settings: this.createSettingsApi(pluginId),
      search: this.createSearchApi(),
      log: (() => {
        const log = this.deps.loggerFactory(`plugin:${pluginId}`);
        return {
          info: (msg: string, ..._args: unknown[]) => log.info(msg),
          warn: (msg: string, ..._args: unknown[]) => log.warn(msg),
          error: (msg: string, ..._args: unknown[]) => log.error(msg),
        };
      })(),
      plugin: {
        id: pluginId,
        version: manifest.version,
        dataDir,
      },
    };

    return api;
  }

  private createNotesApi(): PluginAPI["notes"] {
    const notesDir = this.deps.notesDir;
    const notesOps = this.deps.notesOps;
    return {
      async get(userId: string, notePath: string) {
        const userDir = path.join(notesDir, userId);
        const fullNotePath = ensureExtension(notePath, ".md");
        const note = await notesOps.readNote(userDir, fullNotePath);
        return {
          path: notePath,
          content: note.content,
          title: note.title,
          modifiedAt: note.modifiedAt,
        };
      },
      async list(userId: string, folder?: string) {
        const dir = folder
          ? path.join(notesDir, userId, folder)
          : path.join(notesDir, userId);
        validatePathWithinBase(dir, path.join(notesDir, userId));
        const tree = await notesOps.scanDirectory(dir, folder || "");

        function toNoteEntries(
          nodes: Array<{ name: string; path: string; type: string; children?: unknown[] }>,
        ): NoteEntry[] {
          return nodes.map((n) => ({
            name: n.name,
            path: n.path,
            type: n.type === "folder" ? ("directory" as const) : ("file" as const),
            ...(n.children
              ? { children: toNoteEntries(n.children as typeof nodes) }
              : {}),
          }));
        }
        return toNoteEntries(tree);
      },
      async create(userId: string, notePath: string, content: string) {
        const userDir = path.join(notesDir, userId);
        const fullNotePath = ensureExtension(notePath, ".md");
        await notesOps.writeNote(userDir, fullNotePath, content, userId);
      },
      async update(userId: string, notePath: string, content: string) {
        const userDir = path.join(notesDir, userId);
        const fullNotePath = ensureExtension(notePath, ".md");
        await notesOps.writeNote(userDir, fullNotePath, content, userId);
      },
      async delete(userId: string, notePath: string) {
        const userDir = path.join(notesDir, userId);
        const fullNotePath = ensureExtension(notePath, ".md");
        await notesOps.deleteNote(userDir, fullNotePath, userId);
      },
    };
  }

  private createEventsApi(pluginId: string): PluginAPI["events"] {
    return {
      on: (event: PluginEvent, handler: PluginEventHandler) => {
        this.deps.eventBus.on(event, handler, pluginId);
      },
      off: (event: PluginEvent, handler: PluginEventHandler) => {
        this.deps.eventBus.off(event, handler);
      },
    };
  }

  private createRoutesApi(pluginId: string): PluginAPI["routes"] {
    const { pluginRouter, healthMonitor } = this.deps;
    return {
      register: (method, routePath, handler: PluginRouteHandler) => {
        const wrapped: PluginRouteHandler = async (req, reply) => {
          // Express-compat shim: Kryton plugins written for the old Express
          // server use `res.status(n).json(obj)` and `res.send(obj)`. Add
          // those as proxies onto Fastify's reply so plugins keep working
          // without modification.
          const replyWithExpressShim = reply as unknown as Record<string, unknown>;
          if (typeof replyWithExpressShim.status !== "function") {
            replyWithExpressShim.status = (code: number): unknown => {
              reply.code(code);
              return replyWithExpressShim;
            };
          }
          if (typeof replyWithExpressShim.json !== "function") {
            replyWithExpressShim.json = (body: unknown): unknown => {
              reply.send(body);
              return replyWithExpressShim;
            };
          }
          if (typeof replyWithExpressShim.sendStatus !== "function") {
            replyWithExpressShim.sendStatus = (code: number): unknown => {
              reply.code(code).send();
              return replyWithExpressShim;
            };
          }
          try {
            return await handler(req, reply);
          } catch (err) {
            healthMonitor.recordError(pluginId);
            throw err;
          }
        };
        pluginRouter.register(pluginId, method, routePath, wrapped);
      },
    };
  }

  private createStorageApi(pluginId: string): PluginAPI["storage"] {
    const storage = this.deps.storage;
    return {
      get: (key, userId?) => storage.get(pluginId, key, userId),
      set: (key, value, userId?) => storage.set(pluginId, key, value, userId),
      delete: (key, userId?) => storage.delete(pluginId, key, userId),
      list: (prefix?, userId?) => storage.list(pluginId, prefix, userId),
    };
  }

  private createSettingsApi(pluginId: string): PluginAPI["settings"] {
    const db = this.deps.db;
    return {
      async get(key: string, userId?: string) {
        const settingsKey = `plugin:${pluginId}:${key}`;

        if (userId) {
          const userSetting = await db.query.settings.findFirst({
            where: and(eq(settings.key, settingsKey), eq(settings.userId, userId)),
          });
          if (userSetting) return JSON.parse(userSetting.value);
        }

        const adminSetting = await db.query.settings.findFirst({
          where: and(
            eq(settings.key, settingsKey),
            eq(settings.userId, GLOBAL_USER_ID),
          ),
        });
        if (adminSetting) return JSON.parse(adminSetting.value);

        return null;
      },
    };
  }

  private createSearchApi(): PluginAPI["search"] {
    const db = this.deps.db;
    return {
      async index(userId: string, notePath: string, fields: IndexFields) {
        const now = new Date();
        await db
          .insert(searchIndex)
          .values({
            notePath,
            userId,
            title: fields.title,
            content: fields.content,
            tags: JSON.stringify(fields.tags || []),
            modifiedAt: now,
          })
          .onConflictDoUpdate({
            target: [searchIndex.notePath, searchIndex.userId],
            set: {
              title: fields.title,
              content: fields.content,
              tags: JSON.stringify(fields.tags || []),
              modifiedAt: now,
            },
          });
      },
      async query(userId: string, queryStr: string) {
        const pattern = `%${queryStr}%`;
        const results = await db
          .select()
          .from(searchIndex)
          .where(
            and(
              eq(searchIndex.userId, userId),
              or(
                like(searchIndex.title, pattern),
                like(searchIndex.content, pattern),
              ),
            ),
          );
        return results.map((r) => ({
          path: r.notePath,
          title: r.title,
          snippet: r.content.substring(0, 200),
          score: 1,
        }));
      },
    };
  }
}
