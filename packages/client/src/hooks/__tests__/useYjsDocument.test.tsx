import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as React from "react";
import * as Y from "yjs";
import { useYjsDocument } from "../useYjsDocument";
import { HttpAdapter } from "../../data/HttpAdapter";
import { HttpAdapterContext } from "../../data/httpAdapterContext";

class StubWebSocket {
  static instances: StubWebSocket[] = [];
  url: string;
  readyState = 0;
  binaryType = "arraybuffer";
  private listeners: Map<string, ((ev: Event) => void)[]> = new Map();
  constructor(url: string) {
    this.url = url;
    StubWebSocket.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: Event) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  removeEventListener() {}
  send() {}
  close() {
    this.readyState = 3;
    const closeListeners = this.listeners.get("close") ?? [];
    for (const fn of closeListeners) fn(new Event("close"));
  }
  fireError() {
    const errListeners = this.listeners.get("error") ?? [];
    for (const fn of errListeners) fn(new Event("error"));
  }
}

const originalWebSocket = globalThis.WebSocket;

function makeFetch(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(body),
    json: async () => body,
  })) as unknown as typeof fetch;
}

function makeWrapper(adapter: HttpAdapter) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(HttpAdapterContext.Provider, { value: adapter }, children);
  };
}

beforeEach(() => {
  StubWebSocket.instances = [];
  (globalThis as unknown as { WebSocket: typeof StubWebSocket }).WebSocket = StubWebSocket;
});

afterEach(() => {
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket;
});

describe("useYjsDocument", () => {
  it("opens a Y.Doc for the given path and exposes ytext + awareness", async () => {
    const adapter = new HttpAdapter({ fetch: makeFetch({}), baseUrl: "" });
    const { result } = renderHook(() => useYjsDocument("Welcome.md"), {
      wrapper: makeWrapper(adapter),
    });

    await waitFor(() => {
      expect(result.current.doc).not.toBeNull();
    });
    expect(result.current.ytext).not.toBeNull();
    expect(result.current.awareness).not.toBeNull();
    expect(result.current.status).toBe("connected");
    expect(result.current.ytext).toBeInstanceOf(Y.Text);
    expect(adapter.hasLiveDocument("Welcome.md")).toBe(true);
  });

  it("returns nulls and status 'connecting' for a null path", () => {
    const adapter = new HttpAdapter({ fetch: makeFetch({}), baseUrl: "" });
    const { result } = renderHook(() => useYjsDocument(null), {
      wrapper: makeWrapper(adapter),
    });
    expect(result.current.doc).toBeNull();
    expect(result.current.ytext).toBeNull();
    expect(result.current.status).toBe("connecting");
  });

  it("closes the document on unmount", async () => {
    const adapter = new HttpAdapter({ fetch: makeFetch({}), baseUrl: "" });
    const { result, unmount } = renderHook(() => useYjsDocument("Note.md"), {
      wrapper: makeWrapper(adapter),
    });
    await waitFor(() => expect(result.current.doc).not.toBeNull());
    expect(adapter.hasLiveDocument("Note.md")).toBe(true);

    unmount();
    // Close is deferred to a microtask to be StrictMode-safe.
    await new Promise<void>((res) => queueMicrotask(res));
    expect(adapter.hasLiveDocument("Note.md")).toBe(false);
  });

  it("switches Y.Doc when path changes", async () => {
    const adapter = new HttpAdapter({ fetch: makeFetch({}), baseUrl: "" });
    const { result, rerender } = renderHook(
      ({ p }: { p: string }) => useYjsDocument(p),
      { wrapper: makeWrapper(adapter), initialProps: { p: "A.md" } },
    );
    await waitFor(() => expect(result.current.doc).not.toBeNull());
    const docA = result.current.doc;
    expect(adapter.hasLiveDocument("A.md")).toBe(true);

    rerender({ p: "B.md" });
    await waitFor(() => expect(result.current.doc).not.toBeNull());
    await waitFor(() => expect(result.current.doc).not.toBe(docA));
    // After the microtask drains, A is closed.
    await new Promise<void>((res) => queueMicrotask(res));
    expect(adapter.hasLiveDocument("A.md")).toBe(false);
    expect(adapter.hasLiveDocument("B.md")).toBe(true);
  });

  it("StrictMode-style remount on the same path keeps the doc alive", async () => {
    const adapter = new HttpAdapter({ fetch: makeFetch({}), baseUrl: "" });
    const { result, rerender } = renderHook(
      ({ p }: { p: string }) => useYjsDocument(p),
      { wrapper: makeWrapper(adapter), initialProps: { p: "Same.md" } },
    );
    await waitFor(() => expect(result.current.doc).not.toBeNull());
    // Simulate a same-path remount by toggling props that don't change
    // the dependency. The microtask-deferred close should never fire
    // because the synchronous re-render keeps the ref count above zero.
    rerender({ p: "Same.md" });
    await new Promise<void>((res) => queueMicrotask(res));
    expect(adapter.hasLiveDocument("Same.md")).toBe(true);
  });

  it("transitions to 'failed' when the socket errors", async () => {
    const adapter = new HttpAdapter({ fetch: makeFetch({}), baseUrl: "" });
    const { result } = renderHook(() => useYjsDocument("Fails.md"), {
      wrapper: makeWrapper(adapter),
    });
    await waitFor(() => expect(result.current.status).toBe("connected"));

    const socket = StubWebSocket.instances[StubWebSocket.instances.length - 1];
    expect(socket).toBeDefined();
    act(() => {
      socket!.fireError();
    });
    await waitFor(() => expect(result.current.status).toBe("failed"));
  });
});
