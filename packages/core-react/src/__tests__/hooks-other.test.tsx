// packages/core-react/src/__tests__/hooks-other.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { KrytonProvider } from "../provider";
import { useFolders, useTags, useSettings, useSyncStatus } from "../hooks";

type Listener<T> = (payload: T) => void;
class EventBus<Events extends Record<string, unknown>> {
  private listeners = new Map<string, Set<Listener<unknown>>>();
  on<K extends keyof Events & string>(
    event: K,
    listener: Listener<Events[K]>,
  ): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener as Listener<unknown>);
    return () =>
      this.listeners.get(event)?.delete(listener as Listener<unknown>);
  }
  emit<K extends keyof Events & string>(event: K, payload: Events[K]): void {
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
  }
}

function makeFakeCore(opts?: {
  folders?: any[];
  tags?: any[];
  settings?: any[];
}) {
  const bus = new EventBus<{
    change: { entityType: string; ids: string[]; source: string };
    "sync:complete": undefined;
  }>();
  const folderData = [...(opts?.folders ?? [])];
  const tagData = [...(opts?.tags ?? [])];
  const settingData = [...(opts?.settings ?? [])];
  return {
    bus,
    folders: { list: () => folderData },
    tags: { list: () => tagData },
    settings: { list: () => settingData },
    storage: { get: (_k: string, def: string) => def },
    _bus: bus,
  } as any;
}

describe("useFolders", () => {
  it("returns initial folder list", () => {
    const core = makeFakeCore({
      folders: [
        { id: "f1", path: "/notes" },
        { id: "f2", path: "/archive" },
      ],
    });
    function FolderCount() {
      const f = useFolders();
      return <span data-testid="count">{f.length}</span>;
    }
    render(
      <KrytonProvider core={core}>
        <FolderCount />
      </KrytonProvider>,
    );
    expect(screen.getByTestId("count").textContent).toBe("2");
  });
});

describe("useTags", () => {
  it("returns initial tag list", () => {
    const core = makeFakeCore({ tags: [{ id: "t1", name: "work" }] });
    function TagCount() {
      const t = useTags();
      return <span data-testid="tag-count">{t.length}</span>;
    }
    render(
      <KrytonProvider core={core}>
        <TagCount />
      </KrytonProvider>,
    );
    expect(screen.getByTestId("tag-count").textContent).toBe("1");
  });
});

describe("useSettings", () => {
  it("returns initial settings list", () => {
    const core = makeFakeCore({
      settings: [{ key: "theme", value: "dark" }],
    });
    function SettingsCount() {
      const s = useSettings();
      return <span data-testid="settings-count">{s.length}</span>;
    }
    render(
      <KrytonProvider core={core}>
        <SettingsCount />
      </KrytonProvider>,
    );
    expect(screen.getByTestId("settings-count").textContent).toBe("1");
  });
});

describe("useSyncStatus", () => {
  it("returns online and null timestamps by default", () => {
    const core = makeFakeCore();
    function Status() {
      const s = useSyncStatus();
      return (
        <span data-testid="status">
          {s.online ? "online" : "offline"}|{s.lastPullAt ?? "null"}
        </span>
      );
    }
    render(
      <KrytonProvider core={core}>
        <Status />
      </KrytonProvider>,
    );
    expect(screen.getByTestId("status").textContent).toBe("online|null");
  });
});
