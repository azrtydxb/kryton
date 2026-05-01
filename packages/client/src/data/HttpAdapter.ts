/**
 * HttpAdapter — implements KrytonDataAdapter against the /api/* HTTP surface.
 *
 * The server's notes API returns a file-tree structure from scanDirectory().
 * Settings returns Record<string, string>. Tags returns {tag, count}[].
 * Trash returns {path, originalPath, trashedAt}[].
 * Shares: GET /api/shares returns NoteShare[] (owner view).
 *
 * Notes do not have a server-side UUID — the file path is the stable identity.
 * We use path as `id` for NoteData to satisfy the KrytonDataAdapter interface.
 *
 * Yjs documents: web client connects via native WebSocket to /ws/yjs/<noteId>.
 */

import type {
  KrytonDataAdapter,
  NoteData,
  FolderData,
  TagData,
  NoteShareData,
  TrashItemData,
  SyncStatus,
  CurrentUser,
  NoteFilter,
} from "@azrtydxb/ui";
import * as Y from "yjs";

// ---- Server response shapes ------------------------------------------------

interface ServerFileNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: ServerFileNode[];
}

interface ServerTrashItem {
  path: string;
  originalPath: string;
  trashedAt: string | Date;
}

interface ServerTagItem {
  tag: string;
  count: number;
}

// ---- Helpers ---------------------------------------------------------------

/** Flatten the server file-tree into a NoteData[] list. */
function flattenTree(nodes: ServerFileNode[]): NoteData[] {
  const out: NoteData[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      out.push({
        id: node.path,
        path: node.path,
        title: node.name.replace(/\.md$/, ""),
        tags: "[]",
        modifiedAt: 0,
        version: 0,
      });
    } else if (node.children) {
      out.push(...flattenTree(node.children));
    }
  }
  return out;
}

/** Convert server settings object to SettingData-like records in the cache. */
function settingsToMap(obj: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(obj));
}

// ---- HttpAdapter -----------------------------------------------------------

export interface HttpAdapterOptions {
  /** Custom fetch implementation (used in tests). Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
  /** Base URL, e.g. "" for same-origin or "http://localhost:3000" for dev proxy. */
  baseUrl: string;
}

export class HttpAdapter implements KrytonDataAdapter {
  private _fetch: typeof globalThis.fetch;
  private baseUrl: string;

  // In-memory state caches
  private _notes: NoteData[] = [];
  private _folders: FolderData[] = [];
  private _tags: TagData[] = [];
  private _settings: Map<string, string> = new Map();
  private _noteShares: NoteShareData[] = [];
  private _trashItems: TrashItemData[] = [];
  private _currentUser: CurrentUser | null = null;

  // Sync status
  private _syncStatus: SyncStatus = {
    lastPullAt: null,
    lastPushAt: null,
    pending: 0,
    online: true,
  };

  // Subscriptions: entityType -> Set<callback>
  private _subs: Map<string, Set<() => void>> = new Map();

  // Yjs documents and their WebSocket connections
  private _docs: Map<string, Y.Doc> = new Map();
  private _sockets: Map<string, WebSocket> = new Map();

  constructor(opts: HttpAdapterOptions) {
    this._fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = opts.baseUrl;
  }

  // ---- subscribe / fire ----------------------------------------------------

  subscribe(entityType: string, _ids: string[] | "*", cb: () => void): () => void {
    if (!this._subs.has(entityType)) {
      this._subs.set(entityType, new Set());
    }
    this._subs.get(entityType)!.add(cb);
    return () => {
      this._subs.get(entityType)?.delete(cb);
    };
  }

  private fire(entityType: string): void {
    this._subs.get(entityType)?.forEach((cb) => cb());
    // Also fire wildcard listeners
    this._subs.get("*")?.forEach((cb) => cb());
  }

  // ---- Internal fetch helper -----------------------------------------------

  private async apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const res = await this._fetch(`${this.baseUrl}${path}`, {
      credentials: "include",
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res;
  }

  // ---- refresh (used by HttpDataProvider on mount, and triggerSync) --------

  async refresh(entityType: string): Promise<void> {
    switch (entityType) {
      case "notes":
        await this._refreshNotes();
        break;
      case "folders":
        // Folders are derived from the notes tree; re-refresh notes
        await this._refreshNotes();
        break;
      case "tags":
        await this._refreshTags();
        break;
      case "settings":
        await this._refreshSettings();
        break;
      case "noteShares":
        await this._refreshShares();
        break;
      case "trashItems":
        await this._refreshTrash();
        break;
      case "currentUser":
        await this._refreshCurrentUser();
        break;
      default:
        break;
    }
  }

  private async _refreshNotes(): Promise<void> {
    const res = await this.apiFetch("/api/notes");
    const tree: ServerFileNode[] = await res.json();
    this._notes = flattenTree(Array.isArray(tree) ? tree : [tree]);

    // Derive folders from tree as well
    this._folders = this._extractFolders(Array.isArray(tree) ? tree : [tree], null);

    this.fire("notes");
    this.fire("folders");
  }

  private _extractFolders(nodes: ServerFileNode[], parentId: string | null): FolderData[] {
    const out: FolderData[] = [];
    for (const node of nodes) {
      if (node.type === "folder") {
        out.push({
          id: node.path,
          userId: "",
          path: node.path,
          parentId,
          updatedAt: 0,
          version: 0,
        });
        if (node.children) {
          out.push(...this._extractFolders(node.children, node.path));
        }
      }
    }
    return out;
  }

  private async _refreshTags(): Promise<void> {
    const res = await this.apiFetch("/api/tags");
    const raw: ServerTagItem[] = await res.json();
    this._tags = raw.map((t, i) => ({
      id: t.tag,
      userId: "",
      name: t.tag,
      color: null,
      updatedAt: 0,
      version: i,
    }));
    this.fire("tags");
  }

  private async _refreshSettings(): Promise<void> {
    const res = await this.apiFetch("/api/settings");
    const obj: Record<string, string> = await res.json();
    this._settings = settingsToMap(obj);
    this.fire("settings");
  }

  private async _refreshShares(): Promise<void> {
    const res = await this.apiFetch("/api/shares");
    const raw: NoteShareData[] = await res.json();
    // Normalise timestamps: server returns ISO strings; KrytonDataAdapter expects numbers
    this._noteShares = raw.map((s) => ({
      ...s,
      createdAt: typeof s.createdAt === "string" ? new Date(s.createdAt).getTime() : s.createdAt,
      updatedAt: typeof s.updatedAt === "string" ? new Date(s.updatedAt).getTime() : s.updatedAt,
    }));
    this.fire("noteShares");
  }

  private async _refreshTrash(): Promise<void> {
    const res = await this.apiFetch("/api/trash");
    const raw: ServerTrashItem[] = await res.json();
    this._trashItems = raw.map((t, i) => ({
      id: t.path,
      userId: "",
      originalPath: t.originalPath,
      trashedAt: typeof t.trashedAt === "string" ? new Date(t.trashedAt).getTime() : (t.trashedAt as Date).getTime(),
      version: i,
    }));
    this.fire("trashItems");
  }

  private async _refreshCurrentUser(): Promise<void> {
    try {
      const res = await this.apiFetch("/api/auth/get-session");
      const data = await res.json();
      const u = data?.user;
      if (u) {
        this._currentUser = {
          id: u.id,
          email: u.email,
          displayName: u.name ?? u.email,
        };
      } else {
        this._currentUser = null;
      }
    } catch {
      this._currentUser = null;
    }
    this.fire("currentUser");
  }

  // ---- notes ---------------------------------------------------------------

  notes = {
    list: (filter?: NoteFilter): NoteData[] => {
      let notes = this._notes;
      if (filter?.folderPath) {
        const prefix = filter.folderPath.endsWith("/")
          ? filter.folderPath
          : filter.folderPath + "/";
        notes = notes.filter((n) => n.path.startsWith(prefix));
      }
      if (filter?.tag) {
        const tag = filter.tag;
        notes = notes.filter((n) => {
          try {
            const tags: string[] = JSON.parse(n.tags);
            return tags.includes(tag);
          } catch {
            return false;
          }
        });
      }
      return notes;
    },

    findById: (id: string): NoteData | null => {
      return this._notes.find((n) => n.id === id) ?? null;
    },

    findByPath: (path: string): NoteData | null => {
      return this._notes.find((n) => n.path === path) ?? null;
    },

    create: async (input: {
      path: string;
      title: string;
      content?: string;
      tags?: string[];
    }): Promise<NoteData> => {
      const res = await this.apiFetch("/api/notes", {
        method: "POST",
        body: JSON.stringify({
          path: input.path,
          content: input.content ?? `# ${input.title}\n`,
        }),
      });
      const data = await res.json();
      const notePath: string = data.path ?? input.path;
      const note: NoteData = {
        id: notePath,
        path: notePath,
        title: input.title,
        tags: JSON.stringify(input.tags ?? []),
        modifiedAt: Date.now(),
        version: 0,
      };
      this._notes = [...this._notes, note];
      this.fire("notes");
      return note;
    },

    update: async (id: string, patch: Partial<NoteData> & { content?: string }): Promise<void> => {
      const note = this._notes.find((n) => n.id === id);
      if (!note) throw new Error(`Note not found: ${id}`);

      if (patch.content !== undefined) {
        await this.apiFetch(`/api/notes/${encodeURIComponent(note.path)}`, {
          method: "PUT",
          body: JSON.stringify({ content: patch.content }),
        });
      }

      this._notes = this._notes.map((n) =>
        n.id === id ? { ...n, ...patch, modifiedAt: Date.now() } : n
      );
      this.fire("notes");
    },

    delete: async (id: string): Promise<void> => {
      const note = this._notes.find((n) => n.id === id);
      if (!note) throw new Error(`Note not found: ${id}`);

      await this.apiFetch(`/api/notes/${encodeURIComponent(note.path)}`, {
        method: "DELETE",
      });
      this._notes = this._notes.filter((n) => n.id !== id);
      this.fire("notes");
    },
  };

  // ---- folders -------------------------------------------------------------

  folders = {
    list: (): FolderData[] => this._folders,

    create: async (input: { path: string; parentId: string | null }): Promise<FolderData> => {
      await this.apiFetch("/api/folders", {
        method: "POST",
        body: JSON.stringify({ path: input.path }),
      });
      const folder: FolderData = {
        id: input.path,
        userId: "",
        path: input.path,
        parentId: input.parentId,
        updatedAt: Date.now(),
        version: 0,
      };
      this._folders = [...this._folders, folder];
      this.fire("folders");
      return folder;
    },

    delete: async (id: string): Promise<void> => {
      const folder = this._folders.find((f) => f.id === id);
      if (!folder) throw new Error(`Folder not found: ${id}`);

      await this.apiFetch(`/api/folders/${encodeURIComponent(folder.path)}`, {
        method: "DELETE",
      });
      this._folders = this._folders.filter((f) => f.id !== id);
      this.fire("folders");
    },
  };

  // ---- tags ----------------------------------------------------------------

  tags = {
    list: (): TagData[] => this._tags,
  };

  // ---- settings ------------------------------------------------------------

  settings = {
    get: (key: string): string | null => {
      return this._settings.get(key) ?? null;
    },

    set: async (key: string, value: string): Promise<void> => {
      await this.apiFetch(`/api/settings/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({ value }),
      });
      this._settings.set(key, value);
      this.fire("settings");
    },
  };

  // ---- noteShares ----------------------------------------------------------

  noteShares = {
    list: (): NoteShareData[] => this._noteShares,
  };

  // ---- trashItems ----------------------------------------------------------

  trashItems = {
    list: (): TrashItemData[] => this._trashItems,

    restore: async (id: string): Promise<void> => {
      const item = this._trashItems.find((t) => t.id === id);
      if (!item) throw new Error(`Trash item not found: ${id}`);

      await this.apiFetch(`/api/trash/restore/${encodeURIComponent(item.originalPath)}`, {
        method: "POST",
      });
      this._trashItems = this._trashItems.filter((t) => t.id !== id);
      this.fire("trashItems");
      // Refreshing notes to pick up the restored note
      await this._refreshNotes();
    },

    purge: async (id: string): Promise<void> => {
      const item = this._trashItems.find((t) => t.id === id);
      if (!item) throw new Error(`Trash item not found: ${id}`);

      await this.apiFetch(`/api/trash/${encodeURIComponent(item.originalPath)}`, {
        method: "DELETE",
      });
      this._trashItems = this._trashItems.filter((t) => t.id !== id);
      this.fire("trashItems");
    },

    purgeAll: async (): Promise<void> => {
      await this.apiFetch("/api/trash-empty", {
        method: "DELETE",
      });
      this._trashItems = [];
      this.fire("trashItems");
    },
  };

  // ---- Yjs / WebSocket documents -------------------------------------------

  async openDocument(noteId: string): Promise<Y.Doc> {
    if (this._docs.has(noteId)) {
      return this._docs.get(noteId)!;
    }

    const doc = new Y.Doc();
    this._docs.set(noteId, doc);

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsBase = this.baseUrl
      ? this.baseUrl.replace(/^https?:/, wsProtocol)
      : `${wsProtocol}//${window.location.host}`;
    const wsUrl = `${wsBase}/ws/yjs/${encodeURIComponent(noteId)}`;

    const socket = new WebSocket(wsUrl);
    this._sockets.set(noteId, socket);

    socket.binaryType = "arraybuffer";

    socket.addEventListener("message", (event) => {
      const data =
        event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : new Uint8Array(event.data);
      Y.applyUpdate(doc, data);
    });

    doc.on("update", (update: Uint8Array) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(update);
      }
    });

    socket.addEventListener("close", () => {
      // Socket closed — doc stays alive; reconnection is out of scope for this adapter
    });

    return doc;
  }

  closeDocument(noteId: string): void {
    const socket = this._sockets.get(noteId);
    if (socket) {
      socket.close();
      this._sockets.delete(noteId);
    }
    const doc = this._docs.get(noteId);
    if (doc) {
      doc.destroy();
      this._docs.delete(noteId);
    }
  }

  // Awareness is not implemented in this basic adapter (requires y-protocols integration)
  getAwareness(_noteId: string) {
    return null;
  }

  readNoteContent(noteId: string): string | null {
    const doc = this._docs.get(noteId);
    if (!doc) return null;
    // Assumes content is in a Y.Text named "content"
    const text = doc.getText("content");
    return text.toString();
  }

  // ---- Sync ----------------------------------------------------------------

  getSyncStatus(): SyncStatus {
    return this._syncStatus;
  }

  async triggerSync(): Promise<void> {
    this._syncStatus = { ...this._syncStatus, pending: 1 };
    this.fire("sync");

    await Promise.all([
      this._refreshNotes(),
      this._refreshTags(),
      this._refreshSettings(),
      this._refreshShares(),
      this._refreshTrash(),
    ]);

    this._syncStatus = {
      lastPullAt: Date.now(),
      lastPushAt: Date.now(),
      pending: 0,
      online: true,
    };
    this.fire("sync");
  }

  // ---- Current user --------------------------------------------------------

  currentUser(): CurrentUser | null {
    return this._currentUser;
  }
}
