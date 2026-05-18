import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { format } from "date-fns";
import { and, eq } from "drizzle-orm";
import { executeTool } from "../mcp/tools.js";
import { settings } from "../../../db/schema/settings.js";
import {
  buildNotesTestApp,
  cleanupNotesTestUser,
  createNotesTestUser,
  seedNotesTestUser,
  type NotesTestApp,
} from "../../notes/__tests__/helpers.js";

/**
 * Regression tests for MCP tool path-casing + favorites-follow-rename bugs:
 *   - templates lookup must use the canonical `Templates/` folder (not `templates/`)
 *   - daily notes must read/write `Daily/YYYY-MM-DD.md` (not `daily/...`)
 *   - rename_note / rename_folder must update the user's starred list so
 *     favorites follow the new path instead of orphaning.
 */

const TEST_USER = createNotesTestUser("mcp-tools");

async function readStarredRow(
  ctx: NotesTestApp,
  userId: string,
): Promise<string[]> {
  const row = await ctx.app.db.query.settings.findFirst({
    where: and(eq(settings.userId, userId), eq(settings.key, "starred")),
  });
  if (!row?.value) return [];
  return JSON.parse(row.value) as string[];
}

async function clearStarred(ctx: NotesTestApp, userId: string): Promise<void> {
  await ctx.app.db
    .delete(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, "starred")));
}

describe("MCP tools / canonical Templates and Daily folders", () => {
  let ctx: NotesTestApp | null = null;

  beforeAll(async () => {
    await seedNotesTestUser(TEST_USER);
  });
  afterAll(async () => {
    await cleanupNotesTestUser(TEST_USER.id);
  });
  afterEach(async () => {
    if (ctx) await ctx.cleanup();
    ctx = null;
  });

  it("list_templates reads from Templates/ (capital T)", async () => {
    ctx = await buildNotesTestApp({ user: TEST_USER });
    const userDir = await ctx.app.notes.getUserNotesDir(TEST_USER.id);
    await fs.mkdir(path.join(userDir, "Templates"), { recursive: true });
    await fs.writeFile(
      path.join(userDir, "Templates", "Project.md"),
      "# {{title}}\n\nA project template.\n",
      "utf8",
    );

    const result = (await executeTool(
      ctx.app,
      "list_templates",
      {},
      TEST_USER.id,
    )) as Array<{ name: string; path: string }>;

    const names = result.map((e) => e.name);
    expect(names).toContain("Project.md");
  });

  it("list_templates returns [] when Templates/ does not exist", async () => {
    ctx = await buildNotesTestApp({ user: TEST_USER });
    const result = await executeTool(
      ctx.app,
      "list_templates",
      {},
      TEST_USER.id,
    );
    expect(result).toEqual([]);
  });

  it("create_note_from_template resolves from Templates/<name>.md", async () => {
    ctx = await buildNotesTestApp({ user: TEST_USER });
    const userDir = await ctx.app.notes.getUserNotesDir(TEST_USER.id);
    await fs.mkdir(path.join(userDir, "Templates"), { recursive: true });
    await fs.writeFile(
      path.join(userDir, "Templates", "Meeting Notes.md"),
      "# Meeting\n\nAttendees:\n",
      "utf8",
    );

    const result = (await executeTool(
      ctx.app,
      "create_note_from_template",
      { templateName: "Meeting Notes", notePath: "from-template.md" },
      TEST_USER.id,
    )) as { success: boolean; path: string };

    expect(result.success).toBe(true);

    const created = await fs.readFile(
      path.join(userDir, "from-template.md"),
      "utf8",
    );
    expect(created).toContain("Attendees:");
  });

  it("get_daily_note reports Daily/ (capital D) as the expected path", async () => {
    ctx = await buildNotesTestApp({ user: TEST_USER });
    const result = (await executeTool(
      ctx.app,
      "get_daily_note",
      {},
      TEST_USER.id,
    )) as { exists: boolean; expectedPath: string };

    expect(result.exists).toBe(false);
    expect(result.expectedPath).toMatch(/^Daily\/\d{4}-\d{2}-\d{2}\.md$/);
  });

  it("write_daily_note writes to Daily/YYYY-MM-DD.md and round-trips", async () => {
    ctx = await buildNotesTestApp({ user: TEST_USER });
    const today = format(new Date(), "yyyy-MM-dd");

    const writeResult = (await executeTool(
      ctx.app,
      "write_daily_note",
      { content: "# Daily\n\nhello\n" },
      TEST_USER.id,
    )) as { success: boolean; path: string };

    expect(writeResult.path).toBe(`Daily/${today}.md`);

    const userDir = await ctx.app.notes.getUserNotesDir(TEST_USER.id);
    const onDisk = await fs.readFile(
      path.join(userDir, "Daily", `${today}.md`),
      "utf8",
    );
    expect(onDisk).toContain("hello");

    // get_daily_note should now resolve the freshly-written note.
    const getResult = (await executeTool(
      ctx.app,
      "get_daily_note",
      {},
      TEST_USER.id,
    )) as { content: string };
    expect(getResult.content).toContain("hello");
  });

  it("list_daily_notes scans Daily/ (capital D)", async () => {
    ctx = await buildNotesTestApp({ user: TEST_USER });
    const userDir = await ctx.app.notes.getUserNotesDir(TEST_USER.id);
    await fs.mkdir(path.join(userDir, "Daily"), { recursive: true });
    await fs.writeFile(
      path.join(userDir, "Daily", "2026-05-17.md"),
      "yesterday\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(userDir, "Daily", "2026-05-18.md"),
      "today\n",
      "utf8",
    );

    const result = (await executeTool(
      ctx.app,
      "list_daily_notes",
      { limit: 10 },
      TEST_USER.id,
    )) as Array<{ path: string }>;

    const paths = result.map((r) => r.path).sort();
    expect(paths).toEqual(["Daily/2026-05-17.md", "Daily/2026-05-18.md"]);
  });
});

describe("MCP tools / favorites follow renames", () => {
  let ctx: NotesTestApp | null = null;

  beforeAll(async () => {
    await seedNotesTestUser(TEST_USER);
  });
  afterAll(async () => {
    await cleanupNotesTestUser(TEST_USER.id);
  });
  afterEach(async () => {
    if (ctx) {
      // Wipe the starred row so favorites don't bleed between tests sharing
      // a single test user.
      await clearStarred(ctx, TEST_USER.id);
      await ctx.cleanup();
    }
    ctx = null;
  });

  it("rename_note updates the starred entry to the new path", async () => {
    ctx = await buildNotesTestApp({ user: TEST_USER });

    await executeTool(
      ctx.app,
      "create_note",
      { path: "fav/old.md", content: "# old\n" },
      TEST_USER.id,
    );
    await executeTool(
      ctx.app,
      "add_favorite",
      { path: "fav/old.md" },
      TEST_USER.id,
    );
    expect(await readStarredRow(ctx, TEST_USER.id)).toEqual(["fav/old.md"]);

    await executeTool(
      ctx.app,
      "rename_note",
      { oldPath: "fav/old.md", newPath: "fav/new.md" },
      TEST_USER.id,
    );

    expect(await readStarredRow(ctx, TEST_USER.id)).toEqual(["fav/new.md"]);

    const list = (await executeTool(
      ctx.app,
      "list_favorites",
      {},
      TEST_USER.id,
    )) as { paths: string[] };
    expect(list.paths).toEqual(["fav/new.md"]);
  });

  it("rename_note leaves unrelated favorites untouched", async () => {
    ctx = await buildNotesTestApp({ user: TEST_USER });

    await executeTool(
      ctx.app,
      "create_note",
      { path: "a.md", content: "a" },
      TEST_USER.id,
    );
    await executeTool(
      ctx.app,
      "create_note",
      { path: "b.md", content: "b" },
      TEST_USER.id,
    );
    await executeTool(ctx.app, "add_favorite", { path: "a.md" }, TEST_USER.id);
    await executeTool(ctx.app, "add_favorite", { path: "b.md" }, TEST_USER.id);

    await executeTool(
      ctx.app,
      "rename_note",
      { oldPath: "a.md", newPath: "a-renamed.md" },
      TEST_USER.id,
    );

    const starred = await readStarredRow(ctx, TEST_USER.id);
    expect(starred.sort()).toEqual(["a-renamed.md", "b.md"]);
  });

  it("rename_folder rewrites the prefix of each affected favorite", async () => {
    ctx = await buildNotesTestApp({ user: TEST_USER });

    await executeTool(
      ctx.app,
      "create_folder",
      { path: "moveable" },
      TEST_USER.id,
    );
    await executeTool(
      ctx.app,
      "create_note",
      { path: "moveable/one.md", content: "1" },
      TEST_USER.id,
    );
    await executeTool(
      ctx.app,
      "create_note",
      { path: "moveable/sub/two.md", content: "2" },
      TEST_USER.id,
    );
    await executeTool(
      ctx.app,
      "create_note",
      { path: "other/three.md", content: "3" },
      TEST_USER.id,
    );

    await executeTool(
      ctx.app,
      "add_favorite",
      { path: "moveable/one.md" },
      TEST_USER.id,
    );
    await executeTool(
      ctx.app,
      "add_favorite",
      { path: "moveable/sub/two.md" },
      TEST_USER.id,
    );
    await executeTool(
      ctx.app,
      "add_favorite",
      { path: "other/three.md" },
      TEST_USER.id,
    );

    await executeTool(
      ctx.app,
      "rename_folder",
      { oldPath: "moveable", newPath: "moved" },
      TEST_USER.id,
    );

    const starred = (await readStarredRow(ctx, TEST_USER.id)).sort();
    expect(starred).toEqual([
      "moved/one.md",
      "moved/sub/two.md",
      "other/three.md",
    ]);
  });
});
