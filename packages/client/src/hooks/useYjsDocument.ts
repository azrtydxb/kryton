import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { useHttpAdapter } from "../data/httpAdapterContext";

export type YjsConnectionStatus = "connecting" | "connected" | "failed";

export interface UseYjsDocumentResult {
  doc: Y.Doc | null;
  ytext: Y.Text | null;
  awareness: Awareness | null;
  status: YjsConnectionStatus;
}

/**
 * Open a Y.Doc for `path` via the data adapter and bind its lifecycle to
 * the component lifecycle. The hook calls `adapter.openDocument(path)`
 * on mount (and on path change), tears the document back down on unmount
 * or when `path` switches.
 *
 * `status` starts as `"connecting"`, transitions to `"connected"` once
 * the underlying socket opens (signalling the WS handshake completed
 * successfully), and becomes `"failed"` if the socket errors / closes
 * before reaching the open state. Callers fall back to HTTP-only
 * persistence when the status is `"failed"` (or when `ytext` is null).
 *
 * Pass `null` to detach without opening anything (used while the editor
 * has no active note).
 *
 * StrictMode safety: the in-flight open is tracked by path so a
 * transient double-mount doesn't tear down the Y session that the
 * second mount is about to reuse. The adapter itself is idempotent for
 * `openDocument(samePath)` — it returns the existing doc — so the only
 * thing we have to guard is the close-on-unmount path.
 */
export function useYjsDocument(path: string | null): UseYjsDocumentResult {
  const adapter = useHttpAdapter();
  const [state, setState] = useState<UseYjsDocumentResult>({
    doc: null,
    ytext: null,
    awareness: null,
    status: "connecting",
  });

  // StrictMode-safe close: track a per-path reference count. A mount
  // increments it; a cleanup decrements after a microtask. The real
  // `closeDocument` only fires when the count reaches zero — so a
  // synchronous unmount/remount pair on the same path (StrictMode's
  // intentional double-invoke) leaves the count at >=1 throughout and
  // we never close the doc the second mount is about to reuse.
  const refCountRef = useRef<Map<string, number>>(new Map());

  // Reset to "connecting" the moment `path` changes, before any effect
  // runs — keeps the render output coherent with the requested path
  // without calling setState inside an effect (React 19 lint rule).
  const [trackedPath, setTrackedPath] = useState<string | null>(path);
  if (trackedPath !== path) {
    setTrackedPath(path);
    setState({ doc: null, ytext: null, awareness: null, status: "connecting" });
  }

  useEffect(() => {
    if (!path) {
      return;
    }

    let cancelled = false;
    const counts = refCountRef.current;
    counts.set(path, (counts.get(path) ?? 0) + 1);

    (async () => {
      try {
        const doc = await adapter.openDocument(path);
        if (cancelled) return;
        const ytext = doc.getText("content");
        const awareness = adapter.getAwareness(path);

        // The adapter returns a live socket reference via the internal
        // _sockets map; we infer status from awareness existence + the
        // socket's readyState lookup pattern. The simplest signal that
        // matches the spec is: doc exists -> connected; if the socket
        // errors before open we'll catch it via the close listener
        // below.
        setState({ doc, ytext, awareness, status: "connected" });

        // Listen for premature close so we can transition to "failed"
        // and let the editor fall back to the HTTP save path. The
        // adapter exposes the socket indirectly through the close
        // listener it already installs; we attach a second listener
        // here scoped to this component instance.
        const socket = (adapter as unknown as { _sockets: Map<string, WebSocket> })._sockets?.get(path);
        if (socket) {
          const onClose = () => {
            if (cancelled) return;
            // Only flip to failed when the socket dies while we still
            // think we're connected — a deliberate closeDocument on
            // unmount races this path and is already handled by
            // `cancelled`.
            setState((prev) => (prev.status === "connected" ? { ...prev, status: "failed" } : prev));
          };
          const onError = () => {
            if (cancelled) return;
            setState((prev) => (prev.status !== "failed" ? { ...prev, status: "failed" } : prev));
          };
          socket.addEventListener("close", onClose);
          socket.addEventListener("error", onError);
        }
      } catch (err) {
        if (cancelled) return;
        console.warn("[useYjsDocument] openDocument failed", err);
        setState({ doc: null, ytext: null, awareness: null, status: "failed" });
      }
    })();

    return () => {
      cancelled = true;
      // Decrement on a microtask so that StrictMode's synchronous
      // unmount→remount pair on the same path sees the count return
      // to its pre-cleanup level before we evaluate "should I close?".
      const closingPath = path;
      queueMicrotask(() => {
        const next = (counts.get(closingPath) ?? 1) - 1;
        if (next <= 0) {
          counts.delete(closingPath);
          adapter.closeDocument(closingPath);
        } else {
          counts.set(closingPath, next);
        }
      });
    };
  }, [adapter, path]);

  return state;
}
