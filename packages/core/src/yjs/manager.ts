// packages/core/src/yjs/manager.ts
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { YjsStorage } from "./storage";
import { YjsWebsocketConnector, type WsLike } from "./websocket";
import type { SqliteAdapter } from "../adapter";

export interface YjsManagerOpts {
  db: SqliteAdapter;
  wsUrl: (docId: string) => string;
  authToken: () => string | null | Promise<string | null>;
  /** Injected for tests; defaults to platform WebSocket */
  wsFactory?: (url: string) => WsLike;
}

interface OpenDoc {
  doc: Y.Doc;
  awareness: Awareness;
  connector: YjsWebsocketConnector;
  refcount: number;
  snapshotTimer: ReturnType<typeof setInterval>;
}

export class YjsManager {
  private storage: YjsStorage;
  private docs = new Map<string, OpenDoc>();

  constructor(private opts: YjsManagerOpts) {
    this.storage = new YjsStorage(opts.db);
  }

  async openDocument(docId: string): Promise<Y.Doc> {
    const existing = this.docs.get(docId);
    if (existing) {
      existing.refcount++;
      return existing.doc;
    }

    const doc = this.storage.load(docId) ?? new Y.Doc();
    const awareness = new Awareness(doc);

    const tok = await this.opts.authToken();
    const baseUrl = this.opts.wsUrl(docId);
    const fullUrl = `${baseUrl}/${encodeURIComponent(docId)}?token=${encodeURIComponent(tok ?? "")}`;
    const ws = (this.opts.wsFactory ?? defaultWsFactory)(fullUrl);

    const connector = new YjsWebsocketConnector({ doc, ws, docId, awareness });

    // Also persist incremental updates so we don't lose data between snapshots
    const updateListener = (update: Uint8Array) =>
      this.storage.appendUpdate(docId, update);
    doc.on("update", updateListener);

    const snapshotTimer = setInterval(
      () => this.storage.save(docId, doc),
      30_000,
    );

    const open: OpenDoc = {
      doc,
      awareness,
      connector,
      refcount: 1,
      snapshotTimer,
    };
    this.docs.set(docId, open);
    return doc;
  }

  async closeDocument(docId: string): Promise<void> {
    const d = this.docs.get(docId);
    if (!d) return;
    d.refcount--;
    if (d.refcount > 0) return;

    clearInterval(d.snapshotTimer);
    this.storage.save(docId, d.doc); // final flush
    d.connector.destroy();
    d.awareness.destroy();
    d.doc.destroy();
    this.docs.delete(docId);
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.docs.keys()]) {
      await this.closeDocument(id);
    }
  }

  getAwareness(docId: string): Awareness | null {
    return this.docs.get(docId)?.awareness ?? null;
  }
}

function defaultWsFactory(url: string): WsLike {
  // In browsers/RN use the global WebSocket; in Node use a polyfill.
  if (typeof WebSocket !== "undefined") {
    const w = new WebSocket(url);
    w.binaryType = "arraybuffer";
    const adapter: WsLike = {
      readyState: w.readyState,
      send: (d) => w.send(d),
      close: () => w.close(),
    };
    w.onopen = () => {
      adapter.readyState = w.readyState;
      adapter.onopen?.();
    };
    w.onmessage = (ev) => adapter.onmessage?.(ev.data as ArrayBuffer);
    w.onclose = () => {
      adapter.readyState = w.readyState;
      adapter.onclose?.();
    };
    w.onerror = (ev) => adapter.onerror?.(ev);
    return adapter;
  }
  throw new Error("No WebSocket implementation available; provide wsFactory");
}
