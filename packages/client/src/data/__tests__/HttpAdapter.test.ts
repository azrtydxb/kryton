import { describe, it, expect, vi } from "vitest";
import { HttpAdapter } from "../HttpAdapter";

// Helper to build a minimal fetch mock returning JSON
function makeFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Internal Server Error",
    text: async () => JSON.stringify(body),
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("HttpAdapter — notes", () => {
  it("primes cache via refresh('notes') and exposes notes.list()", async () => {
    const tree = [
      { name: "First.md", path: "First.md", type: "file" as const },
      { name: "Second.md", path: "Second.md", type: "file" as const },
    ];
    const fetchMock = makeFetch(tree);
    const adapter = new HttpAdapter({ fetch: fetchMock, baseUrl: "" });

    await adapter.refresh("notes");

    const notes = adapter.notes.list();
    expect(notes).toHaveLength(2);
    expect(notes[0]?.title).toBe("First");
    expect(notes[1]?.title).toBe("Second");
  });

  it("notes.findById returns the note by path-based id", async () => {
    const tree = [{ name: "My Note.md", path: "My Note.md", type: "file" as const }];
    const fetchMock = makeFetch(tree);
    const adapter = new HttpAdapter({ fetch: fetchMock, baseUrl: "" });

    await adapter.refresh("notes");

    const found = adapter.notes.findById("My Note.md");
    expect(found).not.toBeNull();
    expect(found?.title).toBe("My Note");
  });

  it("notes.findByPath returns null when not found", async () => {
    const adapter = new HttpAdapter({ fetch: makeFetch([]), baseUrl: "" });
    await adapter.refresh("notes");
    expect(adapter.notes.findByPath("nonexistent.md")).toBeNull();
  });

  it("notes.list with folderPath filter only returns children", async () => {
    const tree = [
      {
        name: "Projects",
        path: "Projects",
        type: "folder" as const,
        children: [{ name: "Kryton.md", path: "Projects/Kryton.md", type: "file" as const }],
      },
      { name: "Root.md", path: "Root.md", type: "file" as const },
    ];
    const adapter = new HttpAdapter({ fetch: makeFetch(tree), baseUrl: "" });
    await adapter.refresh("notes");

    const filtered = adapter.notes.list({ folderPath: "Projects" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.path).toBe("Projects/Kryton.md");
  });
});

describe("HttpAdapter — settings", () => {
  it("primes settings via refresh('settings') and exposes settings.get()", async () => {
    const settingsObj = { theme: "dark", fontSize: "14" };
    const fetchMock = makeFetch(settingsObj);
    const adapter = new HttpAdapter({ fetch: fetchMock, baseUrl: "" });

    await adapter.refresh("settings");

    expect(adapter.settings.get("theme")).toBe("dark");
    expect(adapter.settings.get("fontSize")).toBe("14");
    expect(adapter.settings.get("nonexistent")).toBeNull();
  });

  it("settings.set calls PUT /api/settings/:key", async () => {
    const fetchMock = makeFetch({ key: "theme", value: "light", message: "Setting updated" });
    const adapter = new HttpAdapter({ fetch: fetchMock, baseUrl: "" });

    await adapter.settings.set("theme", "light");

    expect(adapter.settings.get("theme")).toBe("light");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/theme",
      expect.objectContaining({ method: "PUT" })
    );
  });
});

describe("HttpAdapter — tags", () => {
  it("primes tags via refresh('tags')", async () => {
    const rawTags = [{ tag: "project", count: 3 }, { tag: "todo", count: 1 }];
    const fetchMock = makeFetch(rawTags);
    const adapter = new HttpAdapter({ fetch: fetchMock, baseUrl: "" });

    await adapter.refresh("tags");

    const tags = adapter.tags.list();
    expect(tags).toHaveLength(2);
    expect(tags[0]?.name).toBe("project");
    expect(tags[1]?.name).toBe("todo");
  });
});

describe("HttpAdapter — trashItems", () => {
  it("primes trash via refresh('trashItems')", async () => {
    const rawTrash = [
      { path: "Deleted.md", originalPath: "Deleted.md", trashedAt: new Date().toISOString() },
    ];
    const fetchMock = makeFetch(rawTrash);
    const adapter = new HttpAdapter({ fetch: fetchMock, baseUrl: "" });

    await adapter.refresh("trashItems");

    const items = adapter.trashItems.list();
    expect(items).toHaveLength(1);
    expect(items[0]?.originalPath).toBe("Deleted.md");
    expect(typeof items[0]?.trashedAt).toBe("number");
  });
});

describe("HttpAdapter — subscribe / fire", () => {
  it("fires subscriber when notes change", async () => {
    const fetchMock = makeFetch([]);
    const adapter = new HttpAdapter({ fetch: fetchMock, baseUrl: "" });

    const cb = vi.fn();
    adapter.subscribe("notes", "*", cb);
    await adapter.refresh("notes");

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops callbacks", async () => {
    const fetchMock = makeFetch([]);
    const adapter = new HttpAdapter({ fetch: fetchMock, baseUrl: "" });

    const cb = vi.fn();
    const off = adapter.subscribe("notes", "*", cb);
    off();
    await adapter.refresh("notes");

    expect(cb).not.toHaveBeenCalled();
  });
});

describe("HttpAdapter — getSyncStatus", () => {
  it("returns default sync status", () => {
    const adapter = new HttpAdapter({ fetch: makeFetch({}), baseUrl: "" });
    const status = adapter.getSyncStatus();
    expect(status.online).toBe(true);
    expect(status.pending).toBe(0);
  });
});

describe("HttpAdapter — folders", () => {
  it("extracts folders from the notes tree", async () => {
    const tree = [
      {
        name: "Projects",
        path: "Projects",
        type: "folder" as const,
        children: [
          {
            name: "Sub",
            path: "Projects/Sub",
            type: "folder" as const,
            children: [],
          },
        ],
      },
    ];
    const fetchMock = makeFetch(tree);
    const adapter = new HttpAdapter({ fetch: fetchMock, baseUrl: "" });

    await adapter.refresh("notes");

    const folders = adapter.folders.list();
    expect(folders.length).toBeGreaterThanOrEqual(2);
    const projects = folders.find((f) => f.path === "Projects");
    expect(projects).toBeDefined();
    expect(projects?.parentId).toBeNull();
    const sub = folders.find((f) => f.path === "Projects/Sub");
    expect(sub?.parentId).toBe("Projects");
  });
});

describe("HttpAdapter — currentUser", () => {
  it("returns null before refresh", () => {
    const adapter = new HttpAdapter({ fetch: makeFetch({}), baseUrl: "" });
    expect(adapter.currentUser()).toBeNull();
  });

  it("returns user after refresh", async () => {
    const fetchMock = makeFetch({ user: { id: "u1", email: "a@b.com", name: "Alice" } });
    const adapter = new HttpAdapter({ fetch: fetchMock, baseUrl: "" });
    await adapter.refresh("currentUser");
    const user = adapter.currentUser();
    expect(user?.id).toBe("u1");
    expect(user?.email).toBe("a@b.com");
  });
});

describe("HttpAdapter — applyVaultEvent", () => {
  function freshAdapter() {
    return new HttpAdapter({ fetch: makeFetch([]), baseUrl: "" });
  }

  it("note.created inserts a row and fires notes/folders subscribers", () => {
    const adapter = freshAdapter();
    const onNotes = vi.fn();
    const onFolders = vi.fn();
    adapter.subscribe("notes", "*", onNotes);
    adapter.subscribe("folders", "*", onFolders);

    adapter.applyVaultEvent({
      kind: "note.created",
      path: "Projects/Plan.md",
      updatedAt: "2026-05-19T00:00:00.000Z",
      size: 4,
      clientId: null,
      agentId: null,
      agentName: null,
    });

    const notes = adapter.notes.list();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.path).toBe("Projects/Plan.md");
    expect(notes[0]?.title).toBe("Plan");
    expect(onNotes).toHaveBeenCalled();
    expect(onFolders).toHaveBeenCalled();
    expect(adapter.folders.list().some((f) => f.path === "Projects")).toBe(true);
  });

  it("note.created is idempotent — re-applying does not duplicate the row", () => {
    const adapter = freshAdapter();
    const ev = {
      kind: "note.created" as const,
      path: "Welcome.md",
      updatedAt: "2026-05-19T00:00:00.000Z",
      size: 4,
      clientId: null,
      agentId: null,
      agentName: null,
    };
    adapter.applyVaultEvent(ev);
    adapter.applyVaultEvent(ev);
    adapter.applyVaultEvent({ ...ev, kind: "note.updated" });
    expect(adapter.notes.list()).toHaveLength(1);
  });

  it("note.updated bumps modifiedAt without duplicating", () => {
    const adapter = freshAdapter();
    adapter.applyVaultEvent({
      kind: "note.created",
      path: "a.md",
      updatedAt: "2026-05-19T00:00:00.000Z",
      size: 1,
      clientId: null,
      agentId: null,
      agentName: null,
    });
    adapter.applyVaultEvent({
      kind: "note.updated",
      path: "a.md",
      updatedAt: "2026-05-19T01:00:00.000Z",
      size: 9,
      clientId: null,
      agentId: null,
      agentName: null,
    });
    const notes = adapter.notes.list();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.modifiedAt).toBe(new Date("2026-05-19T01:00:00.000Z").getTime());
  });

  it("note.deleted removes the row; second delete is a no-op", () => {
    const adapter = freshAdapter();
    adapter.applyVaultEvent({
      kind: "note.created",
      path: "a.md",
      updatedAt: "2026-05-19T00:00:00.000Z",
      size: 1,
      clientId: null,
      agentId: null,
      agentName: null,
    });
    const onNotes = vi.fn();
    adapter.subscribe("notes", "*", onNotes);
    adapter.applyVaultEvent({
      kind: "note.deleted",
      path: "a.md",
      clientId: null,
      agentId: null,
      agentName: null,
    });
    expect(adapter.notes.list()).toHaveLength(0);
    expect(onNotes).toHaveBeenCalledTimes(1);
    adapter.applyVaultEvent({
      kind: "note.deleted",
      path: "a.md",
      clientId: null,
      agentId: null,
      agentName: null,
    });
    expect(onNotes).toHaveBeenCalledTimes(1);
  });

  it("note.renamed rewrites path + id in place", () => {
    const adapter = freshAdapter();
    adapter.applyVaultEvent({
      kind: "note.created",
      path: "old.md",
      updatedAt: "2026-05-19T00:00:00.000Z",
      size: 1,
      clientId: null,
      agentId: null,
      agentName: null,
    });
    adapter.applyVaultEvent({
      kind: "note.renamed",
      from: "old.md",
      to: "new.md",
      updatedAt: "2026-05-19T01:00:00.000Z",
      size: 1,
      clientId: null,
      agentId: null,
      agentName: null,
    });
    expect(adapter.notes.findByPath("old.md")).toBeNull();
    expect(adapter.notes.findByPath("new.md")?.title).toBe("new");
  });

  it("note.moved into a new folder materialises that folder", () => {
    const adapter = freshAdapter();
    adapter.applyVaultEvent({
      kind: "note.created",
      path: "a.md",
      updatedAt: "2026-05-19T00:00:00.000Z",
      size: 1,
      clientId: null,
      agentId: null,
      agentName: null,
    });
    adapter.applyVaultEvent({
      kind: "note.moved",
      from: "a.md",
      to: "Projects/a.md",
      updatedAt: "2026-05-19T01:00:00.000Z",
      size: 1,
      clientId: null,
      agentId: null,
      agentName: null,
    });
    expect(adapter.notes.findByPath("Projects/a.md")).not.toBeNull();
    expect(adapter.folders.list().some((f) => f.path === "Projects")).toBe(true);
  });

  it("folder.created and folder.deleted patch the folder list (idempotent)", () => {
    const adapter = freshAdapter();
    adapter.applyVaultEvent({
      kind: "folder.created",
      path: "f",
      clientId: null,
      agentId: null,
      agentName: null,
    });
    adapter.applyVaultEvent({
      kind: "folder.created",
      path: "f",
      clientId: null,
      agentId: null,
      agentName: null,
    });
    expect(adapter.folders.list().filter((f) => f.path === "f")).toHaveLength(1);

    adapter.applyVaultEvent({
      kind: "folder.deleted",
      path: "f",
      clientId: null,
      agentId: null,
      agentName: null,
    });
    expect(adapter.folders.list().some((f) => f.path === "f")).toBe(false);
  });

  it("folder.deleted cascades to notes under the prefix", () => {
    const adapter = freshAdapter();
    adapter.applyVaultEvent({
      kind: "note.created",
      path: "f/a.md",
      updatedAt: "2026-05-19T00:00:00.000Z",
      size: 1,
      clientId: null,
      agentId: null,
      agentName: null,
    });
    adapter.applyVaultEvent({
      kind: "note.created",
      path: "f/b.md",
      updatedAt: "2026-05-19T00:00:00.000Z",
      size: 1,
      clientId: null,
      agentId: null,
      agentName: null,
    });
    adapter.applyVaultEvent({
      kind: "note.created",
      path: "other.md",
      updatedAt: "2026-05-19T00:00:00.000Z",
      size: 1,
      clientId: null,
      agentId: null,
      agentName: null,
    });
    adapter.applyVaultEvent({
      kind: "folder.deleted",
      path: "f",
      clientId: null,
      agentId: null,
      agentName: null,
    });
    expect(adapter.notes.list().map((n) => n.path)).toEqual(["other.md"]);
  });

  it("folder.renamed remaps notes and child folders", () => {
    const adapter = freshAdapter();
    adapter.applyVaultEvent({
      kind: "folder.created",
      path: "Old",
      clientId: null,
      agentId: null,
      agentName: null,
    });
    adapter.applyVaultEvent({
      kind: "folder.created",
      path: "Old/Sub",
      clientId: null,
      agentId: null,
      agentName: null,
    });
    adapter.applyVaultEvent({
      kind: "note.created",
      path: "Old/Sub/a.md",
      updatedAt: "2026-05-19T00:00:00.000Z",
      size: 1,
      clientId: null,
      agentId: null,
      agentName: null,
    });
    adapter.applyVaultEvent({
      kind: "folder.renamed",
      from: "Old",
      to: "New",
      clientId: null,
      agentId: null,
      agentName: null,
    });
    const folderPaths = adapter.folders.list().map((f) => f.path).sort();
    expect(folderPaths).toContain("New");
    expect(folderPaths).toContain("New/Sub");
    expect(folderPaths).not.toContain("Old");
    expect(adapter.notes.findByPath("New/Sub/a.md")).not.toBeNull();
    expect(adapter.notes.findByPath("Old/Sub/a.md")).toBeNull();
  });

  it("clientId is sent as X-Kryton-Client-Id on mutating requests", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "{}",
      json: async () => ({ path: "a.md" }),
    })) as unknown as typeof fetch;
    const adapter = new HttpAdapter({
      fetch: fetchMock,
      baseUrl: "",
      clientId: "tab-xyz",
    });
    await adapter.notes.create({ path: "a.md", title: "A", content: "x" });
    const call = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const init = call[1] as { headers: Record<string, string> };
    expect(init.headers["X-Kryton-Client-Id"]).toBe("tab-xyz");
  });
});
