// packages/core/src/yjs/websocket.ts
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

export interface WsLike {
  readyState: number;
  send(data: Uint8Array): void;
  close(): void;
  onopen?: () => void;
  onmessage?: (data: ArrayBuffer | Uint8Array) => void;
  onclose?: () => void;
  onerror?: (e: unknown) => void;
}

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export interface YjsConnectorOpts {
  doc: Y.Doc;
  ws: WsLike;
  docId: string;
  awareness?: awarenessProtocol.Awareness;
  onSync?: () => void;
}

export class YjsWebsocketConnector {
  private updateHandler: (update: Uint8Array, origin: unknown) => void;
  private awarenessHandler?: (changes: unknown, origin: unknown) => void;

  constructor(private opts: YjsConnectorOpts) {
    this.updateHandler = (update, origin) => {
      if (origin === this) return; // don't echo updates we received from the wire
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, update);
      this.send(encoding.toUint8Array(enc));
    };
    opts.doc.on("update", this.updateHandler);

    if (opts.awareness) {
      this.awarenessHandler = (_changes, origin) => {
        if (origin === this) return;
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          enc,
          awarenessProtocol.encodeAwarenessUpdate(opts.awareness!, [
            opts.awareness!.clientID,
          ]),
        );
        this.send(encoding.toUint8Array(enc));
      };
      opts.awareness.on("update", this.awarenessHandler);
    }

    opts.ws.onopen = () => this.handleOpen();
    opts.ws.onmessage = (data) => this.handleMessage(data);
    opts.ws.onclose = () => this.handleClose();
  }

  private handleOpen(): void {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, this.opts.doc);
    this.send(encoding.toUint8Array(enc));
    if (this.opts.awareness) {
      const enc2 = encoding.createEncoder();
      encoding.writeVarUint(enc2, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        enc2,
        awarenessProtocol.encodeAwarenessUpdate(this.opts.awareness, [
          this.opts.awareness.clientID,
        ]),
      );
      this.send(encoding.toUint8Array(enc2));
    }
  }

  private handleMessage(data: ArrayBuffer | Uint8Array): void {
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
    const dec = decoding.createDecoder(buf);
    const messageType = decoding.readVarUint(dec);
    switch (messageType) {
      case MESSAGE_SYNC: {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        const result = syncProtocol.readSyncMessage(dec, enc, this.opts.doc, this);
        if (encoding.length(enc) > 1) this.send(encoding.toUint8Array(enc));
        if (result === syncProtocol.messageYjsSyncStep2) this.opts.onSync?.();
        break;
      }
      case MESSAGE_AWARENESS: {
        if (this.opts.awareness) {
          awarenessProtocol.applyAwarenessUpdate(
            this.opts.awareness,
            decoding.readVarUint8Array(dec),
            this,
          );
        }
        break;
      }
    }
  }

  private handleClose(): void {
    // No-op; reconnection is handled by the calling code
  }

  send(data: Uint8Array): void {
    if (this.opts.ws.readyState === 1) this.opts.ws.send(data);
  }

  destroy(): void {
    this.opts.doc.off("update", this.updateHandler);
    if (this.opts.awareness && this.awarenessHandler) {
      this.opts.awareness.off("update", this.awarenessHandler);
    }
    this.opts.ws.close();
  }
}
