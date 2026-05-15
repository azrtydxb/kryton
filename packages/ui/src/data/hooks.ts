// packages/ui/src/data/hooks.ts
import { useEffect, useReducer, useState } from "react";
import { useKrytonData } from "./KrytonDataProvider";
import type { NoteFilter, NoteData, FolderData, TagData, SettingData, NoteShareData, TrashItemData, SyncStatus, KrytonDataAdapter } from "./types";

function makeListHook<T>(entityType: string, getList: (a: KrytonDataAdapter) => T[]) {
  return function useList(): T[] {
    const adapter = useKrytonData();
    const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
      const off = adapter.subscribe(entityType, "*", () => forceUpdate());
      return off;
    }, [adapter]);
    return getList(adapter);
  };
}

export function useUiNotes(filter?: NoteFilter): NoteData[] {
  const adapter = useKrytonData();
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
  const filterKey = JSON.stringify(filter ?? null);
  useEffect(() => {
    const off = adapter.subscribe("notes", "*", () => forceUpdate());
    return off;
  }, [adapter, filterKey]);
  return adapter.notes.list(filter);
}
export const useUiFolders = makeListHook<FolderData>("folders", a => a.folders.list());
export const useUiTags = makeListHook<TagData>("tags", a => a.tags.list());
export const useUiSettings = makeListHook<SettingData>("settings", a => a.settings.list?.() ?? []);
export const useUiNoteShares = makeListHook<NoteShareData>("note_shares", a => a.noteShares.list());
export const useUiTrashItems = makeListHook<TrashItemData>("trash_items", a => a.trashItems.list());

export function useUiNote(id: string): NoteData | null {
  const adapter = useKrytonData();
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const off = adapter.subscribe("notes", [id], () => forceUpdate());
    return off;
  }, [adapter, id]);
  return adapter.notes.findById(id);
}

export function useUiSetting(key: string): string | null {
  const all = useUiSettings();
  return all.find(s => s.key === key)?.value ?? null;
}

export function useUiSyncStatus(): SyncStatus {
  const adapter = useKrytonData();
  const [s, setS] = useState(() => adapter.getSyncStatus());
  useEffect(() => {
    const off = adapter.subscribe("sync", "*", () => setS(() => adapter.getSyncStatus()));
    return off;
  }, [adapter]);
  return s;
}
