// packages/core/src/kryton.ts
//
// COORDINATION NOTE (Stream 2A → 2B merge):
//   The `yjs` field is intentionally left as `null` here.
//   Stream 2B (YjsManager) will add the YjsManager wiring at merge time.
//   When 2B merges, they should:
//     1. Import YjsManager from "./yjs/manager"
//     2. Add `yjs: YjsManager | null` to KrytonInitOpts and the Kryton class
//     3. Instantiate YjsManager in Kryton.init() and assign to k.yjs
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SqliteAdapter } from "./adapter";
import { applySchema } from "./bootstrap";
import { EventBus } from "./events";
import { LocalStorage } from "./storage";
import { HttpSyncClient } from "./sync/http";
import { SyncOrchestrator } from "./sync/sync";
import { NotesRepository } from "./query/notes";
import { FoldersRepository } from "./query/folders";
import { TagsRepository } from "./query/tags";
import { SettingsRepository } from "./query/settings";
import { NoteSharesRepository } from "./query/note-shares";
import { TrashItemsRepository } from "./query/trash-items";
import { GraphEdgesRepository } from "./query/graph-edges";
import { InstalledPluginsRepository } from "./query/installed-plugins";
import { KrytonSyncError } from "./errors";
import { isCompatibleVersion } from "./version-check";
import { KRYTON_CORE_VERSION } from "./version";

export interface KrytonInitOpts {
  adapter: SqliteAdapter;
  serverUrl: string;
  authToken: () => string | null | Promise<string | null>;
  agentToken?: () => string | null | Promise<string | null>;
  fetch?: typeof fetch;
  /**
   * Override the SQL schema applied on init.
   * Useful for tests — pass a minimal schema so tests don't need the full generated SQL.
   * In production, leave this undefined; the generated schema.sql is loaded from disk.
   */
  schema?: string;
}

export class Kryton {
  bus: EventBus<any>;
  storage: LocalStorage;
  http: HttpSyncClient;
  sync: SyncOrchestrator;
  notes: NotesRepository;
  folders: FoldersRepository;
  tags: TagsRepository;
  settings: SettingsRepository;
  noteShares: NoteSharesRepository;
  trashItems: TrashItemsRepository;
  graphEdges: GraphEdgesRepository;
  installedPlugins: InstalledPluginsRepository;

  // Stream 2B will add: yjs: YjsManager | null = null;

  private constructor(public adapter: SqliteAdapter) {
    this.bus = new EventBus();
    this.storage = new LocalStorage(adapter);
    // These are assigned properly in init(); the non-null assertions are safe.
    this.http = null as any;
    this.sync = null as any;
    this.notes = new NotesRepository(adapter, this.bus);
    this.folders = new FoldersRepository(adapter, this.bus);
    this.tags = new TagsRepository(adapter, this.bus);
    this.settings = new SettingsRepository(adapter, this.bus);
    this.noteShares = new NoteSharesRepository(adapter, this.bus);
    this.trashItems = new TrashItemsRepository(adapter, this.bus);
    this.graphEdges = new GraphEdgesRepository(adapter, this.bus);
    this.installedPlugins = new InstalledPluginsRepository(adapter, this.bus);
  }

  static async init(opts: KrytonInitOpts): Promise<Kryton> {
    const k = new Kryton(opts.adapter);

    // Load the schema SQL — prefer the explicit override (for tests), then read from disk.
    const schemaSql = opts.schema ?? Kryton.loadSchemaSql();
    applySchema(opts.adapter, schemaSql);

    k.http = new HttpSyncClient({
      serverUrl: opts.serverUrl,
      authToken: opts.agentToken ?? opts.authToken,
      fetch: opts.fetch,
    });

    await k.checkServerCompatibility();

    k.sync = new SyncOrchestrator({
      db: opts.adapter,
      bus: k.bus,
      storage: k.storage,
      httpClient: k.http,
      repositories: {
        notes: k.notes,
        folders: k.folders,
        tags: k.tags,
        settings: k.settings,
        note_shares: k.noteShares,
        trash_items: k.trashItems,
        graph_edges: k.graphEdges,
        installed_plugins: k.installedPlugins,
      },
    });

    return k;
  }

  private static loadSchemaSql(): string {
    // Resolve the generated schema.sql relative to this file at runtime.
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    return readFileSync(resolve(__dirname, "generated/schema.sql"), "utf8");
  }

  private async checkServerCompatibility(): Promise<void> {
    const ver = await this.http.version();
    if (!ver.apiVersion) {
      throw new KrytonSyncError("server did not return apiVersion", { retryable: false });
    }
    if (ver.supportedClientRange && !isCompatibleVersion(KRYTON_CORE_VERSION, ver.supportedClientRange)) {
      throw new KrytonSyncError(
        `client ${KRYTON_CORE_VERSION} not in server's supported range ${ver.supportedClientRange}`,
        { retryable: false }
      );
    }
  }

  async close(): Promise<void> {
    this.sync?.stopAuto();
    this.adapter.close();
  }
}
