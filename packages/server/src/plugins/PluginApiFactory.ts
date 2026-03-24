import { PluginAPI, PluginManifest, PluginEvent, PluginEventHandler } from "./types";
import { PluginEventBus } from "./PluginEventBus";
import { PluginRouter } from "./PluginRouter";
import { PluginHealthMonitor } from "./PluginHealthMonitor";
import {
  getStorageValue,
  setStorageValue,
  deleteStorageValue,
  listStorageEntries,
} from "../services/pluginStorageService";
import { AppDataSource } from "../data-source";
import { Settings } from "../entities/Settings";
import { SearchIndex } from "../entities/SearchIndex";
import { RequestHandler } from "express";
import { EntitySchema, Repository } from "typeorm";
import path from "path";
import fs from "fs";

interface PluginApiFactoryDeps {
  eventBus: PluginEventBus;
  pluginRouter: PluginRouter;
  healthMonitor: PluginHealthMonitor;
  notesDir: string;
}

export class PluginApiFactory {
  private deps: PluginApiFactoryDeps;

  constructor(deps: PluginApiFactoryDeps) {
    this.deps = deps;
  }

  createApi(manifest: PluginManifest): PluginAPI {
    const pluginId = manifest.id;
    const dataDir = path.join(process.cwd(), "data", "plugins", pluginId);
    fs.mkdirSync(dataDir, { recursive: true });

    const pluginEntities: EntitySchema[] = [];

    const api: PluginAPI = {
      notes: this.createNotesApi(pluginId),
      events: this.createEventsApi(pluginId),
      routes: this.createRoutesApi(pluginId),
      storage: this.createStorageApi(pluginId),
      database: {
        registerEntity(entity: EntitySchema): void {
          pluginEntities.push(entity);
        },
        getRepository(entity: EntitySchema): Repository<object> {
          return AppDataSource.getRepository(entity) as Repository<object>;
        },
      },
      settings: this.createSettingsApi(pluginId),
      search: this.createSearchApi(pluginId),
      log: {
        info: (msg: string, ...args: unknown[]) =>
          console.log(`[plugin:${pluginId}]`, msg, ...args),
        warn: (msg: string, ...args: unknown[]) =>
          console.warn(`[plugin:${pluginId}]`, msg, ...args),
        error: (msg: string, ...args: unknown[]) =>
          console.error(`[plugin:${pluginId}]`, msg, ...args),
      },
      plugin: {
        id: pluginId,
        version: manifest.version,
        dataDir,
      },
    };

    return api;
  }

  private createNotesApi(_pluginId: string): PluginAPI["notes"] {
    const notesDir = this.deps.notesDir;
    return {
      async get(userId: string, notePath: string) {
        const fullPath = path.join(notesDir, userId, `${notePath}.md`);
        const content = await fs.promises.readFile(fullPath, "utf-8");
        const stat = await fs.promises.stat(fullPath);
        const title = notePath.split("/").pop() || notePath;
        return { path: notePath, content, title, modifiedAt: stat.mtime };
      },
      async list(userId: string, folder?: string) {
        const dir = folder
          ? path.join(notesDir, userId, folder)
          : path.join(notesDir, userId);
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        return entries.map((e) => ({
          name: e.name,
          path: folder ? `${folder}/${e.name}` : e.name,
          type: e.isDirectory() ? ("directory" as const) : ("file" as const),
        }));
      },
      async create(userId: string, notePath: string, content: string) {
        const fullPath = path.join(notesDir, userId, `${notePath}.md`);
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.promises.writeFile(fullPath, content, "utf-8");
      },
      async update(userId: string, notePath: string, content: string) {
        const fullPath = path.join(notesDir, userId, `${notePath}.md`);
        await fs.promises.writeFile(fullPath, content, "utf-8");
      },
      async delete(userId: string, notePath: string) {
        const fullPath = path.join(notesDir, userId, `${notePath}.md`);
        await fs.promises.unlink(fullPath);
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
      register: (method, routePath, handler: RequestHandler) => {
        const wrappedHandler: RequestHandler = async (req, res, next) => {
          try {
            await Promise.resolve(handler(req, res, next));
          } catch (err) {
            healthMonitor.recordError(pluginId);
            next(err);
          }
        };
        pluginRouter.register(pluginId, method, routePath, wrappedHandler);
      },
    };
  }

  private createStorageApi(pluginId: string): PluginAPI["storage"] {
    return {
      get: (key, userId?) => getStorageValue(pluginId, key, userId),
      set: (key, value, userId?) => setStorageValue(pluginId, key, value, userId),
      delete: (key, userId?) => deleteStorageValue(pluginId, key, userId),
      list: (prefix?, userId?) => listStorageEntries(pluginId, prefix, userId),
    };
  }

  private createSettingsApi(pluginId: string): PluginAPI["settings"] {
    return {
      async get(key: string, userId?: string) {
        const repo = AppDataSource.getRepository(Settings);
        const settingsKey = `plugin:${pluginId}:${key}`;

        // Check user override first
        if (userId) {
          const userSetting = await repo.findOneBy({
            key: settingsKey,
            userId,
          });
          if (userSetting) return JSON.parse(userSetting.value);
        }

        // Fall back to admin default
        const adminSetting = await repo.findOneBy({
          key: settingsKey,
          userId: "",
        });
        if (adminSetting) return JSON.parse(adminSetting.value);

        return null;
      },
    };
  }

  private createSearchApi(_pluginId: string): PluginAPI["search"] {
    return {
      async index(userId, notePath, fields) {
        const repo = AppDataSource.getRepository(SearchIndex);
        await repo.upsert(
          {
            notePath,
            userId,
            title: fields.title,
            content: fields.content,
            tags: fields.tags || [],
            modifiedAt: new Date(),
          },
          ["notePath", "userId"]
        );
      },
      async query(userId, queryStr) {
        const repo = AppDataSource.getRepository(SearchIndex);
        const results = await repo
          .createQueryBuilder("si")
          .where("si.userId = :userId", { userId })
          .andWhere("(si.title ILIKE :q OR si.content ILIKE :q)", {
            q: `%${queryStr}%`,
          })
          .getMany();
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
