// packages/core-react/src/hooks.ts
import { useSyncExternalStore, useMemo, useEffect, useState } from "react";
import { useKryton } from "./provider";
import type * as Y from "yjs";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Shape of a change event emitted by the core EventBus. */
interface ChangeEvent {
  entityType: string;
  ids: string[];
  source: string;
}

/**
 * Build a `subscribe` function that re-renders when the bus emits a "change"
 * event matching the given entityType predicate.
 */
function useEntitySubscribe(entityType: string | null, ids?: string[]) {
  const core = useKryton();
  return useMemo(
    () =>
      (cb: () => void): (() => void) =>
        core.bus.on("change", (e: ChangeEvent) => {
          if (entityType !== null && e.entityType !== entityType) return;
          if (ids && !ids.some((id) => e.ids.includes(id))) return;
          cb();
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [core, entityType, ids?.join(",")],
  );
}

// ---------------------------------------------------------------------------
// Note hooks
// ---------------------------------------------------------------------------

export function useNote(id: string) {
  const core = useKryton();
  const subscribe = useMemo(
    () =>
      (cb: () => void): (() => void) =>
        core.bus.on("change", (e: ChangeEvent) => {
          if (e.entityType === "notes" && e.ids.includes(id)) cb();
        }),
    [core, id],
  );
  const get = () => core.notes.findById(id) ?? null;
  return useSyncExternalStore(subscribe, get, get);
}

export function useNotes() {
  const core = useKryton();
  const [notes, setNotes] = useState<unknown[]>(() => core.notes.list() as unknown[]);
  useEffect(() => {
    return core.bus.on("change", (e: ChangeEvent) => {
      if (e.entityType === "notes") setNotes(core.notes.list() as unknown[]);
    });
  }, [core]);
  return notes;
}

// ---------------------------------------------------------------------------
// Folder / Tag / Settings hooks
// ---------------------------------------------------------------------------

export function useFolders() {
  const core = useKryton();
  const [folders, setFolders] = useState<unknown[]>(
    () => (core.folders?.list() as unknown[]) ?? [],
  );
  useEffect(() => {
    return core.bus.on("change", (e: ChangeEvent) => {
      if (e.entityType === "folders")
        setFolders((core.folders?.list() as unknown[]) ?? []);
    });
  }, [core]);
  return folders;
}

export function useTags() {
  const core = useKryton();
  const [tags, setTags] = useState<unknown[]>(
    () => (core.tags?.list() as unknown[]) ?? [],
  );
  useEffect(() => {
    return core.bus.on("change", (e: ChangeEvent) => {
      if (e.entityType === "tags")
        setTags((core.tags?.list() as unknown[]) ?? []);
    });
  }, [core]);
  return tags;
}

export function useSettings() {
  const core = useKryton();
  const [settings, setSettings] = useState<unknown[]>(
    () => (core.settings?.list() as unknown[]) ?? [],
  );
  useEffect(() => {
    return core.bus.on("change", (e: ChangeEvent) => {
      if (e.entityType === "settings")
        setSettings((core.settings?.list() as unknown[]) ?? []);
    });
  }, [core]);
  return settings;
}

// ---------------------------------------------------------------------------
// Sync status hook
// ---------------------------------------------------------------------------

export interface SyncStatus {
  lastPullAt: number | null;
  lastPushAt: number | null;
  pending: number;
  online: boolean;
}

export function useSyncStatus(): SyncStatus {
  const core = useKryton();
  const subscribe = useMemo(
    () =>
      (cb: () => void): (() => void) =>
        core.bus.on("sync:complete", () => cb()),
    [core],
  );
  const get = (): SyncStatus => ({
    lastPullAt:
      parseInt(core.storage?.get?.("last_pull_at", "0") ?? "0", 10) || null,
    lastPushAt:
      parseInt(core.storage?.get?.("last_push_at", "0") ?? "0", 10) || null,
    pending: 0,
    online: true,
  });
  return useSyncExternalStore(subscribe, get, get);
}

// ---------------------------------------------------------------------------
// Yjs document hook
// ---------------------------------------------------------------------------

export function useYjsDoc(docId: string): Y.Doc | null {
  const core = useKryton();
  const [doc, setDoc] = useState<Y.Doc | null>(null);

  useEffect(() => {
    let active = true;
    core.yjs
      .openDocument(docId)
      .then((d: Y.Doc) => {
        if (active) setDoc(d);
      });
    return () => {
      active = false;
      core.yjs.closeDocument(docId);
    };
  }, [core, docId]);

  return doc;
}
