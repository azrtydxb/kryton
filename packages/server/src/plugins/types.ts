import { RequestHandler } from "express";
import { EntitySchema, Repository } from "typeorm";

// --- Plugin Manifest (parsed from manifest.json) ---

export interface PluginSettingDefinition {
  key: string;
  type: "string" | "boolean" | "number";
  default: string | boolean | number;
  label: string;
  perUser: boolean;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  minMnemoVersion: string;
  server?: string;
  client?: string;
  settings?: PluginSettingDefinition[];
}

// --- Plugin Events ---

export type PluginEvent =
  | "note:beforeSave"
  | "note:afterSave"
  | "note:beforeDelete"
  | "note:afterDelete"
  | "note:open"
  | "search:query"
  | "user:login"
  | "user:logout";

export type PluginEventHandler = (...args: unknown[]) => void | Promise<void>;

// --- HTTP ---

export type HttpMethod = "get" | "post" | "put" | "delete" | "patch";

// --- Note Types ---

export interface Note {
  path: string;
  content: string;
  title: string;
  modifiedAt: Date;
}

export interface NoteEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: NoteEntry[];
}

// --- Storage ---

export interface StorageEntry {
  key: string;
  value: unknown;
  userId: string | null;
}

// --- Search ---

export interface IndexFields {
  title: string;
  content: string;
  tags?: string[];
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

// --- Plugin API (injected into activate()) ---

export interface PluginAPI {
  notes: {
    get(userId: string, path: string): Promise<Note>;
    list(userId: string, folder?: string): Promise<NoteEntry[]>;
    create(userId: string, path: string, content: string): Promise<void>;
    update(userId: string, path: string, content: string): Promise<void>;
    delete(userId: string, path: string): Promise<void>;
  };

  events: {
    on(event: PluginEvent, handler: PluginEventHandler): void;
    off(event: PluginEvent, handler: PluginEventHandler): void;
  };

  routes: {
    register(method: HttpMethod, path: string, handler: RequestHandler): void;
  };

  storage: {
    get(key: string, userId?: string): Promise<unknown>;
    set(key: string, value: unknown, userId?: string): Promise<void>;
    delete(key: string, userId?: string): Promise<void>;
    list(prefix?: string, userId?: string): Promise<StorageEntry[]>;
  };

  database: {
    registerEntity(entity: EntitySchema): void;
    getRepository(entity: EntitySchema): Repository<object>;
  };

  settings: {
    get(key: string, userId?: string): Promise<unknown>;
  };

  search: {
    index(userId: string, path: string, fields: IndexFields): Promise<void>;
    query(userId: string, query: string): Promise<SearchResult[]>;
  };

  log: {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
  };

  plugin: {
    id: string;
    version: string;
    dataDir: string;
  };
}

// --- Plugin Module Interface ---

export interface PluginModule {
  activate(api: PluginAPI): void | Promise<void>;
  deactivate(): void | Promise<void>;
}

// --- Plugin State ---

export type PluginState =
  | "installed"
  | "loaded"
  | "active"
  | "deactivating"
  | "unloaded"
  | "error";

export interface PluginInstance {
  manifest: PluginManifest;
  state: PluginState;
  module: PluginModule | null;
  api: PluginAPI | null;
  error: string | null;
  registeredRoutes: Array<{ method: HttpMethod; path: string }>;
  registeredEvents: Array<{ event: PluginEvent; handler: PluginEventHandler }>;
}
