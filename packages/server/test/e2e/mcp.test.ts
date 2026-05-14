/**
 * MCP E2E — covers the streamable-HTTP transport end-to-end:
 *   - handshake
 *   - tools/list exposes the expected core surface
 *   - tool execution touches the same service layer as REST
 *   - session persistence across a Kryton restart (the McpSession
 *     table + rehydrate path)
 *   - 404 on a forged sid so spec-compliant clients re-init
 *
 * The restart test is the load-bearing one — it verifies the change
 * that motivated this CI suite in the first place.
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

describe("E2E — MCP transport", () => {
  it("initialize → tools/list exposes the core tool surface", async () => {
    const { apiKey } = await bootstrapUser(h);
    const sid = await h.mcpInit(apiKey);
    const names = await h.mcpToolNames(apiKey, sid);

    const expectedCore = [
      "list_notes",
      "read_note",
      "create_note",
      "update_note",
      "append_to_note",
      "rename_note",
      "delete_note",
      "search",
      "list_tags",
      "list_notes_by_tag",
      "get_backlinks",
      "get_graph",
      "list_folders",
      "create_folder",
      "rename_folder",
      "delete_folder",
      "get_daily_note",
      "write_daily_note",
      "list_templates",
      "create_note_from_template",
      "list_favorites",
      "add_favorite",
      "remove_favorite",
      "list_recent_notes",
      "get_note_metadata",
      "list_daily_notes",
      "list_trash",
      "restore_from_trash",
      "empty_trash",
      "list_shares",
      "list_shares_with_me",
      "share_note",
      "unshare_note",
    ];
    for (const name of expectedCore) expect(names).toContain(name);
  });

  it("tool execution: create_note → list_notes → add_favorite → list_favorites", async () => {
    const { apiKey } = await bootstrapUser(h);
    const sid = await h.mcpInit(apiKey);

    let r = await h.mcpCall({
      apiKey,
      sessionId: sid,
      name: "create_note",
      arguments: { path: "mcp/hello.md", content: "# hi" },
    });
    expect(r.status).toBe(200);

    r = await h.mcpCall({ apiKey, sessionId: sid, name: "list_notes" });
    const listText = (r.payload as { result: { content: { text: string }[] } }).result.content[0]
      .text;
    expect(listText).toContain("mcp/hello.md");

    r = await h.mcpCall({
      apiKey,
      sessionId: sid,
      name: "add_favorite",
      arguments: { path: "mcp/hello.md" },
    });
    const favText = (r.payload as { result: { content: { text: string }[] } }).result.content[0]
      .text;
    expect(favText).toContain('"success": true');

    r = await h.mcpCall({ apiKey, sessionId: sid, name: "list_favorites" });
    const favsText = (r.payload as { result: { content: { text: string }[] } }).result.content[0]
      .text;
    expect(favsText).toContain("mcp/hello.md");
  });

  it("forged session id returns 404 (spec contract)", async () => {
    const { apiKey } = await bootstrapUser(h);
    const r = await fetch(`${h.baseUrl}/api/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "mcp-session-id": "not-a-real-sid",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "list_notes", arguments: {} },
      }),
    });
    expect(r.status).toBe(404);
  });

  it("session survives a Kryton restart (McpSession rehydrate)", async () => {
    const { apiKey } = await bootstrapUser(h);
    const sid = await h.mcpInit(apiKey);

    // Pre-restart call succeeds
    let r = await h.mcpCall({ apiKey, sessionId: sid, name: "list_notes" });
    expect(r.status).toBe(200);

    // Restart — wipes the in-memory session map; DB row stays
    await h.restart();

    // Same sid still works — server rehydrates transparently
    r = await h.mcpCall({ apiKey, sessionId: sid, name: "list_notes" });
    expect(r.status).toBe(200);
    const text = (r.payload as { result: { content: { text: string }[] } }).result.content[0].text;
    // Body parses as JSON; doesn't matter what's in it, just that we got
    // a real tool response and not an offline page or error.
    expect(() => JSON.parse(text)).not.toThrow();
  }, 60_000);
});
