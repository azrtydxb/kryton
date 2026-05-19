import { useCallback, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { useHttpAdapter } from "../data/httpAdapterContext";

export type YjsConnectionStatus = "connecting" | "connected" | "failed";

/**
 * Identity published into the doc's awareness state on connect. The
 * `kind` is always `"user"` from the client — agent presences are
 * synthesised server-side when MCP-driven edits land in a live doc.
 */
export interface YjsLocalIdentity {
  id: string;
  name: string;
  color: string;
}

export interface UseYjsDocumentResult {
  doc: Y.Doc | null;
  ytext: Y.Text | null;
  awareness: Awareness | null;
  status: YjsConnectionStatus;
  /**
   * Push a selection-only awareness update. Only the `cursor` field is
   * written, so identity (the `user` field set once on connect) is not
   * republished on every keystroke. No-op when no live doc.
   */
  publishCursor: (anchor: number, head: number) => void;
}

/**
 * Open a Y.Doc for `path` via the data adapter and bind its lifecycle to
 * the component lifecycle. The hook calls `adapter.openDocument(path)`
 * on mount (and on path change), tears the document back down on unmount
 * or when `path` switches.
 *
 * When an `identity` is provided AND the connection reaches the
 * `"connected"` state, the hook writes a one-shot `user` field into the
 * awareness state (`{ id, name, color, kind: "user" }`). Subsequent
 * cursor updates go through `publishCursor` and only write the `cursor`
 * field, so identity isn't broadcast on every selection change.
 *
 * Pass `null` to detach without opening anything (used while the editor
 * has no active note).
 */
export function useYjsDocument(
  path: string | null,
  identity?: YjsLocalIdentity | null,
): UseYjsDocumentResult {
  const adapter = useHttpAdapter();
  const [state, setState] = useState<Omit<UseYjsDocumentResult, "publishCursor">>({
    doc: null,
    ytext: null,
    awareness: null,
    status: "connecting",
  });
  const awarenessRef = useRef<Awareness | null>(null);

  // StrictMode-safe close: track a per-path reference count.
  const refCountRef = useRef<Map<string, number>>(new Map());

  // Reset to "connecting" the moment `path` changes.
  const [trackedPath, setTrackedPath] = useState<string | null>(path);
  if (trackedPath !== path) {
    setTrackedPath(path);
    setState({ doc: null, ytext: null, awareness: null, status: "connecting" });
    // awarenessRef is cleared by the effect's cleanup; touching the ref
    // during render trips react-hooks/refs.
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
        awarenessRef.current = awareness;

        if (awareness && identity) {
          awareness.setLocalStateField("user", {
            id: identity.id,
            name: identity.name,
            color: identity.color,
            kind: "user",
          });
        }

        setState({ doc, ytext, awareness, status: "connected" });

        const socket = (adapter as unknown as { _sockets: Map<string, WebSocket> })._sockets?.get(path);
        if (socket) {
          const onClose = () => {
            if (cancelled) return;
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
        awarenessRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
      awarenessRef.current = null;
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
    // identity is intentionally not in deps — only the initial connect
    // publishes the user field; identity changes are vanishingly rare
    // within a session and would just churn awareness. If we later need
    // re-publish on identity change, do it in a separate effect that
    // only writes the `user` field while connected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, path]);

  const publishCursor = useCallback((anchor: number, head: number) => {
    const aware = awarenessRef.current;
    if (!aware) return;
    aware.setLocalStateField("cursor", { anchor, head });
  }, []);

  return { ...state, publishCursor };
}
