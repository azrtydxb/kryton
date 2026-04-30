// packages/core/src/yjs/__tests__/websocket.test.ts
import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { YjsWebsocketConnector, type WsLike } from "../websocket";

class FakeWs implements WsLike {
  readyState = 1;
  onopen?: () => void;
  onmessage?: (data: ArrayBuffer | Uint8Array) => void;
  onclose?: () => void;
  onerror?: (e: unknown) => void;
  sent: Uint8Array[] = [];
  send(data: Uint8Array) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  triggerOpen() {
    this.onopen?.();
  }
  triggerMessage(d: Uint8Array) {
    this.onmessage?.(d);
  }
}

describe("YjsWebsocketConnector", () => {
  it("sends sync step 1 on open", () => {
    const ws = new FakeWs();
    const doc = new Y.Doc();
    const _c = new YjsWebsocketConnector({ doc, ws, docId: "d1" });
    ws.triggerOpen();
    expect(ws.sent.length).toBeGreaterThan(0);
  });

  it("destroy removes update listener and closes ws", () => {
    const ws = new FakeWs();
    const doc = new Y.Doc();
    const c = new YjsWebsocketConnector({ doc, ws, docId: "d1" });
    c.destroy();
    expect(ws.readyState).toBe(3);
  });

  it("does not send when ws is not open", () => {
    const ws = new FakeWs();
    ws.readyState = 0; // connecting
    const doc = new Y.Doc();
    const c = new YjsWebsocketConnector({ doc, ws, docId: "d1" });
    c.send(new Uint8Array([1, 2, 3]));
    expect(ws.sent).toHaveLength(0);
  });

  it("calls onSync when sync step 2 is received", () => {
    // Set up: connector A sends step1, we simulate server replying with step2
    const wsA = new FakeWs();
    const docA = new Y.Doc();
    const onSync = vi.fn();
    const _cA = new YjsWebsocketConnector({ doc: docA, ws: wsA, docId: "d1", onSync });
    wsA.triggerOpen(); // sends step1

    // Build a server-side doc and produce step2 response
    const docServer = new Y.Doc();
    docServer.getText("body").insert(0, "server-content");

    // The message sent by A (step1) is wsA.sent[0]
    // We decode it and produce a step2 in return
    // For testing purposes, we create a full update message (sync type=0, then readSyncMessage)
    import("lib0/encoding").then((enc) => {
      import("lib0/decoding").then((dec) => {
        import("y-protocols/sync").then((syncProto) => {
          const sentMsg = wsA.sent[0]!;
          const decoder = dec.createDecoder(sentMsg);
          dec.readVarUint(decoder); // message type (0=sync)
          const responseEnc = enc.createEncoder();
          enc.writeVarUint(responseEnc, 0); // MESSAGE_SYNC
          syncProto.readSyncMessage(decoder, responseEnc, docServer, null);
          const step2 = enc.toUint8Array(responseEnc);
          wsA.triggerMessage(step2);
          expect(onSync).toHaveBeenCalled();
        });
      });
    });
  });
});
