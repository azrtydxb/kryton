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
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import type { VaultEvent } from "./vaultEvents.types";

// Yjs WS message type constants (must match server: yjs.handler.ts).
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

// ---- Server response shapes ------------------------------------------------

interface ServerFileNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: ServerFileNode[];
  updatedAt?: string;
  size?: number;
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
        modifiedAt: node.updatedAt ? new Date(node.updatedAt).getTime() : 0,
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

/** "" for top-level, otherwise the parent folder path. */
function folderParentOf(folderPath: string): string | null {
  const idx = folderPath.lastIndexOf("/");
  return idx === -1 ? null : folderPath.slice(0, idx);
}

// ---- HttpAdapter -----------------------------------------------------------

export interface HttpAdapterOptions {
  /** Custom fetch implementation (used in tests). Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
  /** Base URL, e.g. "" for same-origin or "http://localhost:3000" for dev proxy. */
  baseUrl: string;
  /**
   * Stable per-session client id stamped on every mutating HTTP request
   * (`X-Kryton-Client-Id`) and on the `/ws/vault` query string. The
   * server uses it to suppress echo of an event back to its originator.
   * Tests pass a fixed value; production wires a sessionStorage uuid.
   */
  clientId?: string;
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
  private _awareness: Map<string, awarenessProtocol.Awareness> = new Map();

  readonly clientId: string;

  constructor(opts: HttpAdapterOptions) {
    this._fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = opts.baseUrl;
    this.clientId = opts.clientId ?? "";
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
        ...(this.clientId ? { "X-Kryton-Client-Id": this.clientId } : {}),
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
    const awareness = new awarenessProtocol.Awareness(doc);
    this._docs.set(noteId, doc);
    this._awareness.set(noteId, awareness);

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsBase = this.baseUrl
      ? this.baseUrl.replace(/^https?:/, wsProtocol)
      : `${wsProtocol}//${window.location.host}`;
    const wsUrl = `${wsBase}/ws/yjs/${encodeURIComponent(noteId)}`;

    const socket = new WebSocket(wsUrl);
    this._sockets.set(noteId, socket);

    socket.binaryType = "arraybuffer";

    const sendFramed = (build: (enc: encoding.Encoder) => void): void => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const enc = encoding.createEncoder();
      build(enc);
      socket.send(encoding.toUint8Array(enc));
    };

    socket.addEventListener("open", () => {
      // Sync step 1: send our state vector so the peer can compute the diff.
      sendFramed((enc) => {
        encoding.writeVarUint(enc, MSG_SYNC);
        syncProtocol.writeSyncStep1(enc, doc);
      });
      // Announce our local awareness state, if any has been set.
      const states = awareness.getStates();
      if (states.size > 0) {
        sendFramed((enc) => {
          encoding.writeVarUint(enc, MSG_AWARENESS);
          encoding.writeVarUint8Array(
            enc,
            awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]),
          );
        });
      }
    });

    socket.addEventListener("message", (event) => {
      const data =
        event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : new Uint8Array(event.data);
      try {
        const dec = decoding.createDecoder(data);
        const messageType = decoding.readVarUint(dec);
        if (messageType === MSG_SYNC) {
          const replyEnc = encoding.createEncoder();
          encoding.writeVarUint(replyEnc, MSG_SYNC);
          // `socket` as transactionOrigin lets the doc.on("update") handler
          // skip echoing the resulting update back over the same socket.
          syncProtocol.readSyncMessage(dec, replyEnc, doc, socket);
          if (encoding.length(replyEnc) > 1 && socket.readyState === WebSocket.OPEN) {
            socket.send(encoding.toUint8Array(replyEnc));
          }
        } else if (messageType === MSG_AWARENESS) {
          awarenessProtocol.applyAwarenessUpdate(
            awareness,
            decoding.readVarUint8Array(dec),
            socket,
          );
        }
      } catch (err) {
        console.warn("[yjs] message decode failed", err);
      }
    });

    doc.on("update", (update: Uint8Array, origin: unknown) => {
      // Skip echo when the update was produced by applying a message from
      // this socket (see readSyncMessage above).
      if (origin === socket) return;
      sendFramed((enc) => {
        encoding.writeVarUint(enc, MSG_SYNC);
        syncProtocol.writeUpdate(enc, update);
      });
    });

    awareness.on(
      "update",
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        // Server-originated awareness changes are applied with `socket` as origin;
        // re-broadcasting them would loop.
        if (origin === socket) return;
        const changed = [...added, ...updated, ...removed];
        sendFramed((enc) => {
          encoding.writeVarUint(enc, MSG_AWARENESS);
          encoding.writeVarUint8Array(
            enc,
            awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
          );
        });
      },
    );

    socket.addEventListener("close", () => {
      // Socket closed — doc stays alive; reconnection is out of scope for this adapter.
      awarenessProtocol.removeAwarenessStates(
        awareness,
        Array.from(awareness.getStates().keys()).filter((id) => id !== awareness.clientID),
        "ws-close",
      );
    });

    return doc;
  }

  closeDocument(noteId: string): void {
    const socket = this._sockets.get(noteId);
    if (socket) {
      socket.close();
      this._sockets.delete(noteId);
    }
    const awareness = this._awareness.get(noteId);
    if (awareness) {
      awareness.destroy();
      this._awareness.delete(noteId);
    }
    const doc = this._docs.get(noteId);
    if (doc) {
      doc.destroy();
      this._docs.delete(noteId);
    }
  }

  getAwareness(noteId: string): awarenessProtocol.Awareness | null {
    return this._awareness.get(noteId) ?? null;
  }

  readNoteContent(noteId: string): string | null {
    const doc = this._docs.get(noteId);
    if (!doc) return null;
    // Assumes content is in a Y.Text named "content"
    const text = doc.getText("content");
    return text.toString();
  }

  // ---- Vault events --------------------------------------------------------

  /**
   * Apply a server-pushed `VaultEvent` to the in-memory caches and fire
   * the relevant subscriber sets. Idempotent: re-applying the same event
   * is a no-op (adding a path already present is a no-op; deleting a
   * path not present is a no-op).
   */
  applyVaultEvent(event: VaultEvent): void {
    switch (event.kind) {
      case "note.created":
      case "note.updated": {
        const existingIdx = this._notes.findIndex((n) => n.path === event.path);
        const next: NoteData = {
          id: event.path,
          path: event.path,
          title:
            event.path.split("/").pop()?.replace(/\.md$/, "") ?? event.path,
          tags: existingIdx === -1 ? "[]" : this._notes[existingIdx]!.tags,
          modifiedAt: new Date(event.updatedAt).getTime(),
          version:
            existingIdx === -1 ? 0 : (this._notes[existingIdx]!.version ?? 0) + 1,
        };
        if (existingIdx === -1) {
          this._notes = [...this._notes, next];
          // A newly-created note may live under a folder that the cache
          // hasn't materialised yet (e.g. the user just created
          // Projects/2026/X.md). Insert any missing ancestor folders so
          // the sidebar tree renders rows for them on the next subscribe.
          this._ensureFoldersForPath(event.path);
        } else {
          // Preserve the existing array identity for unchanged rows; only
          // splice the touched index.
          this._notes = this._notes.map((n, i) => (i === existingIdx ? next : n));
        }
        this.fire("notes");
        this.fire("folders");
        break;
      }
      case "note.deleted": {
        const beforeLen = this._notes.length;
        this._notes = this._notes.filter((n) => n.path !== event.path);
        if (this._notes.length !== beforeLen) this.fire("notes");
        break;
      }
      case "note.renamed":
      case "note.moved": {
        const idx = this._notes.findIndex((n) => n.path === event.from);
        if (idx === -1) {
          // Originator already applied the rename optimistically; the
          // echo lands here as a no-op except for the modifiedAt bump on
          // the destination row, if present.
          const destIdx = this._notes.findIndex((n) => n.path === event.to);
          if (destIdx !== -1) {
            const cur = this._notes[destIdx]!;
            this._notes = this._notes.map((n, i) =>
              i === destIdx
                ? { ...cur, modifiedAt: new Date(event.updatedAt).getTime() }
                : n,
            );
            this.fire("notes");
          }
          break;
        }
        const existing = this._notes[idx]!;
        const renamed: NoteData = {
          ...existing,
          id: event.to,
          path: event.to,
          title:
            event.to.split("/").pop()?.replace(/\.md$/, "") ?? event.to,
          modifiedAt: new Date(event.updatedAt).getTime(),
          version: (existing.version ?? 0) + 1,
        };
        this._notes = this._notes.map((n, i) => (i === idx ? renamed : n));
        this._ensureFoldersForPath(event.to);
        this.fire("notes");
        this.fire("folders");
        break;
      }
      case "folder.created": {
        if (!this._folders.some((f) => f.path === event.path)) {
          this._folders = [
            ...this._folders,
            {
              id: event.path,
              userId: "",
              path: event.path,
              parentId: folderParentOf(event.path),
              updatedAt: Date.now(),
              version: 0,
            },
          ];
          this.fire("folders");
        }
        break;
      }
      case "folder.deleted": {
        const folderPrefix = event.path.endsWith("/") ? event.path : event.path + "/";
        const beforeFolders = this._folders.length;
        const beforeNotes = this._notes.length;
        this._folders = this._folders.filter(
          (f) => f.path !== event.path && !f.path.startsWith(folderPrefix),
        );
        this._notes = this._notes.filter((n) => !n.path.startsWith(folderPrefix));
        if (this._folders.length !== beforeFolders) this.fire("folders");
        if (this._notes.length !== beforeNotes) this.fire("notes");
        break;
      }
      case "folder.renamed": {
        const fromPrefix = event.from.endsWith("/") ? event.from : event.from + "/";
        const toPrefix = event.to.endsWith("/") ? event.to : event.to + "/";
        let foldersChanged = false;
        let notesChanged = false;
        this._folders = this._folders.map((f) => {
          if (f.path === event.from) {
            foldersChanged = true;
            return { ...f, id: event.to, path: event.to, parentId: folderParentOf(event.to) };
          }
          if (f.path.startsWith(fromPrefix)) {
            foldersChanged = true;
            const remapped = toPrefix + f.path.slice(fromPrefix.length);
            return { ...f, id: remapped, path: remapped };
          }
          return f;
        });
        this._notes = this._notes.map((n) => {
          if (n.path.startsWith(fromPrefix)) {
            notesChanged = true;
            const remapped = toPrefix + n.path.slice(fromPrefix.length);
            return { ...n, id: remapped, path: remapped };
          }
          return n;
        });
        if (foldersChanged) this.fire("folders");
        if (notesChanged) this.fire("notes");
        break;
      }
      case "tag.added": {
        if (!this._tags.some((t) => t.name === event.tag)) {
          this._tags = [
            ...this._tags,
            {
              id: event.tag,
              userId: "",
              name: event.tag,
              color: null,
              updatedAt: Date.now(),
              version: this._tags.length,
            },
          ];
          this.fire("tags");
        }
        break;
      }
      case "tag.removed": {
        // Server-authoritative; the simplest idempotent take is to drop
        // the tag if the count would reach zero. Without per-note tag
        // tracking here we conservatively keep the tag row and let the
        // next full refresh reconcile counts.
        break;
      }
    }
  }

  /**
   * Insert any folder rows along the path that the cache hasn't seen
   * yet. Idempotent — existing folders are left alone.
   */
  private _ensureFoldersForPath(notePath: string): void {
    const segments = notePath.split("/");
    if (segments.length <= 1) return;
    let cursor = "";
    let added = false;
    for (let i = 0; i < segments.length - 1; i++) {
      cursor = cursor ? `${cursor}/${segments[i]}` : segments[i];
      if (!this._folders.some((f) => f.path === cursor)) {
        this._folders = [
          ...this._folders,
          {
            id: cursor,
            userId: "",
            path: cursor,
            parentId: folderParentOf(cursor),
            updatedAt: Date.now(),
            version: 0,
          },
        ];
        added = true;
      }
    }
    if (added) this.fire("folders");
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
