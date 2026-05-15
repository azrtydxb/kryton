// packages/ui/src/data/__tests__/hooks.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import * as Y from "yjs";
import { KrytonDataProvider } from "../KrytonDataProvider";
import { useUiNotes } from "../hooks";
import type { FolderData, KrytonDataAdapter, NoteData } from "../types";

function makeAdapter(initial: NoteData[]): KrytonDataAdapter & { _trigger(): void } {
  const subs = new Set<() => void>();
  let data = [...initial];
  return {
    notes: { list: () => data, findById: () => null, findByPath: () => null, create: async () => initial[0]!, update: async () => {}, delete: async () => {} },
    folders: { list: () => [], create: async () => ({} as FolderData), delete: async () => {} },
    tags: { list: () => [] },
    settings: { get: () => null, set: async () => {} },
    noteShares: { list: () => [] },
    trashItems: { list: () => [], restore: async () => {}, purge: async () => {}, purgeAll: async () => {} },
    subscribe: (_t, _ids, cb) => { subs.add(cb); return () => subs.delete(cb); },
    openDocument: async () => new Y.Doc(), closeDocument: () => {}, getAwareness: () => null, readNoteContent: () => null,
    getSyncStatus: () => ({ lastPullAt: null, lastPushAt: null, pending: 0, online: true }),
    triggerSync: async () => {},
    currentUser: () => null,
    _trigger() { subs.forEach(c => c()); data = [...data, { id: "n2", path: "n2", title: "alpha", tags: "[]", modifiedAt: 0, version: 0 }]; },
  };
}

function NoteList() {
  const notes = useUiNotes();
  return <ul>{notes.map(n => <li key={n.id}>{n.title}</li>)}</ul>;
}

describe("useUiNotes", () => {
  it("renders initial data", () => {
    const adapter = makeAdapter([{ id: "n1", path: "n1", title: "first", tags: "[]", modifiedAt: 0, version: 0 }]);
    render(<KrytonDataProvider adapter={adapter}><NoteList /></KrytonDataProvider>);
    expect(screen.getByText("first")).toBeInTheDocument();
  });

  it("re-renders when subscribe callback fires", () => {
    const adapter = makeAdapter([{ id: "n1", path: "n1", title: "first", tags: "[]", modifiedAt: 0, version: 0 }]);
    render(<KrytonDataProvider adapter={adapter}><NoteList /></KrytonDataProvider>);
    act(() => adapter._trigger());
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });
});
