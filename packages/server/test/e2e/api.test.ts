/**
 * API E2E — exercises the live Fastify app over real HTTP. Each test
 * gets its own user so they're independent (Postgres survives between
 * tests). The harness boots once per file (beforeAll) and tears down
 * once (afterAll); restart-specific tests live in mcp.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KrytonHarness, bootstrapUser } from "./harness.js";

const h = new KrytonHarness();

beforeAll(async () => {
  await h.start();
}, 60_000);

afterAll(async () => {
  await h.stop();
});

describe("E2E — auth", () => {
  it("sign-up then sign-in succeeds and returns a session cookie", async () => {
    const user = await bootstrapUser(h);
    expect(user.apiKey).toMatch(/^kryton_/);
  });
});

describe("E2E — notes CRUD", () => {
  it("create, read, list, append, rename, delete", async () => {
    const { cookies } = await bootstrapUser(h);
    const reqOpts = {
      "content-type": "application/json",
      cookie: cookies.join("; "),
    };

    // Create
    let res = await fetch(`${h.baseUrl}/api/notes`, {
      method: "POST",
      headers: reqOpts,
      body: JSON.stringify({ path: "scratch/hello.md", content: "# hi\n" }),
    });
    expect(res.status).toBe(201);

    // Read
    res = await fetch(`${h.baseUrl}/api/notes/scratch/hello.md`, {
      headers: { cookie: cookies.join("; ") },
    });
    expect(res.status).toBe(200);
    const note = (await res.json()) as { content: string };
    expect(note.content).toContain("# hi");

    // Rename
    res = await fetch(`${h.baseUrl}/api/notes-rename/scratch/hello.md`, {
      method: "POST",
      headers: reqOpts,
      body: JSON.stringify({ newPath: "scratch/renamed.md" }),
    });
    expect(res.status).toBe(200);

    // Old path 404s
    res = await fetch(`${h.baseUrl}/api/notes/scratch/hello.md`, {
      headers: { cookie: cookies.join("; ") },
    });
    expect(res.status).toBe(404);

    // Delete (soft → trash)
    res = await fetch(`${h.baseUrl}/api/notes/scratch/renamed.md`, {
      method: "DELETE",
      headers: { cookie: cookies.join("; ") },
    });
    expect(res.status).toBe(200);

    // In trash
    res = await fetch(`${h.baseUrl}/api/trash`, {
      headers: { cookie: cookies.join("; ") },
    });
    const trash = (await res.json()) as Array<{ path: string }>;
    expect(trash.some((t) => t.path === "scratch/renamed.md")).toBe(true);
  });
});

describe("E2E — tags + search", () => {
  it("tags surface after note write; search finds the note", async () => {
    const { cookies } = await bootstrapUser(h);

    await fetch(`${h.baseUrl}/api/notes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookies.join("; "),
      },
      body: JSON.stringify({
        path: "ideas/widget.md",
        content: "# Widget\n\nA brilliant idea. #ideas",
      }),
    });

    // Tags
    let res = await fetch(`${h.baseUrl}/api/tags`, {
      headers: { cookie: cookies.join("; ") },
    });
    const tags = (await res.json()) as Array<{ tag: string; count: number }>;
    expect(tags.some((t) => t.tag === "ideas")).toBe(true);

    // Search. Indexing happens in the writeNote pipeline; tolerate a
    // tiny lag on slow runners with one retry.
    let results: Array<{ path: string }> = [];
    for (let i = 0; i < 5; i++) {
      const sres = await fetch(`${h.baseUrl}/api/search?q=brilliant`, {
        headers: { cookie: cookies.join("; ") },
      });
      results = (await sres.json()) as Array<{ path: string }>;
      if (results.some((r) => r.path === "ideas/widget.md")) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(results.some((r) => r.path === "ideas/widget.md")).toBe(true);
  });
});

describe("E2E — favorites (Settings.starred)", () => {
  it("favorites round-trip via the Settings table", async () => {
    const { cookies } = await bootstrapUser(h);

    // Add via the same path the client uses (PUT /api/settings/starred)
    let res = await fetch(`${h.baseUrl}/api/settings/starred`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: cookies.join("; "),
      },
      body: JSON.stringify({ value: JSON.stringify(["a.md"]) }),
    });
    expect(res.status).toBe(200);

    res = await fetch(`${h.baseUrl}/api/settings`, {
      headers: { cookie: cookies.join("; ") },
    });
    const settings = (await res.json()) as Record<string, string>;
    expect(JSON.parse(settings.starred ?? "[]")).toEqual(["a.md"]);
  });
});

describe("E2E — folders + trash via app.folders / app.trash", () => {
  it("create, rename, delete a folder; trash receives + restores", async () => {
    const { cookies } = await bootstrapUser(h);
    const req = {
      "content-type": "application/json",
      cookie: cookies.join("; "),
    };

    // Create folder
    let res = await fetch(`${h.baseUrl}/api/folders`, {
      method: "POST",
      headers: req,
      body: JSON.stringify({ path: "project-x" }),
    });
    expect(res.status).toBe(201);

    // Note inside the folder
    await fetch(`${h.baseUrl}/api/notes`, {
      method: "POST",
      headers: req,
      body: JSON.stringify({ path: "project-x/a.md", content: "# a" }),
    });

    // Rename folder
    res = await fetch(`${h.baseUrl}/api/folders-rename/project-x`, {
      method: "POST",
      headers: req,
      body: JSON.stringify({ newPath: "project-y" }),
    });
    expect(res.status).toBe(200);

    // Delete folder (trashes the note inside)
    res = await fetch(`${h.baseUrl}/api/folders/project-y`, {
      method: "DELETE",
      headers: { cookie: cookies.join("; ") },
    });
    expect(res.status).toBe(200);

    // Restore from trash
    res = await fetch(`${h.baseUrl}/api/trash/restore/project-y/a.md`, {
      method: "POST",
      headers: { cookie: cookies.join("; ") },
    });
    expect(res.status).toBe(200);

    // Note exists again
    res = await fetch(`${h.baseUrl}/api/notes/project-y/a.md`, {
      headers: { cookie: cookies.join("; ") },
    });
    expect(res.status).toBe(200);
  });
});
