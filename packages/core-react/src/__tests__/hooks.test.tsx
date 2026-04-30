// packages/core-react/src/__tests__/hooks.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { KrytonProvider } from "../provider";
import { useNote, useNotes } from "../hooks";

/** Minimal EventBus for tests (mirrors the shape 2A will export from @azrtydxb/core). */
type Listener<T> = (payload: T) => void;
class EventBus<Events extends Record<string, unknown>> {
  private listeners = new Map<string, Set<Listener<unknown>>>();

  on<K extends keyof Events & string>(
    event: K,
    listener: Listener<Events[K]>,
  ): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener as Listener<unknown>);
    return () => this.listeners.get(event)?.delete(listener as Listener<unknown>);
  }

  emit<K extends keyof Events & string>(event: K, payload: Events[K]): void {
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
  }
}

function makeFakeCore(initialNotes: any[]) {
  const bus = new EventBus<{ change: { entityType: string; ids: string[]; source: string } }>();
  const data = new Map(initialNotes.map((n) => [n.id, n]));
  return {
    bus,
    notes: {
      findById: (id: string) => data.get(id),
      list: () => [...data.values()],
      _setForTest(n: any) {
        data.set(n.id, n);
        bus.emit("change", { entityType: "notes", ids: [n.id], source: "local" });
      },
    },
  } as any;
}

function NoteName({ id }: { id: string }) {
  const n = useNote(id);
  return <span>{n?.title ?? "loading"}</span>;
}

function NoteCount() {
  const notes = useNotes();
  return <span>{notes.length}</span>;
}

describe("useNote", () => {
  it("returns initial note", () => {
    const core = makeFakeCore([{ id: "1", title: "alpha" }]);
    render(
      <KrytonProvider core={core}>
        <NoteName id="1" />
      </KrytonProvider>,
    );
    expect(screen.getByText("alpha")).toBeTruthy();
  });

  it("updates when bus emits change for that id", () => {
    const core = makeFakeCore([{ id: "1", title: "alpha" }]);
    render(
      <KrytonProvider core={core}>
        <NoteName id="1" />
      </KrytonProvider>,
    );
    act(() => core.notes._setForTest({ id: "1", title: "beta" }));
    expect(screen.getByText("beta")).toBeTruthy();
  });
});

describe("useNotes", () => {
  it("returns initial list count", () => {
    const core = makeFakeCore([
      { id: "1", title: "a" },
      { id: "2", title: "b" },
    ]);
    render(
      <KrytonProvider core={core}>
        <NoteCount />
      </KrytonProvider>,
    );
    expect(screen.getByText("2")).toBeTruthy();
  });
});
