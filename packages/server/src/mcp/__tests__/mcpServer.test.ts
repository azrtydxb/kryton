import { describe, it, expect } from "vitest";
import { getToolDefinitions } from "../mcpTools.js";

describe("MCP tools", () => {
  it("exports all expected tool definitions", () => {
    const tools = getToolDefinitions();
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_notes");
    expect(names).toContain("read_note");
    expect(names).toContain("create_note");
    expect(names).toContain("update_note");
    expect(names).toContain("delete_note");
    expect(names).toContain("search");
    expect(names).toContain("list_tags");
    expect(names).toContain("get_backlinks");
    expect(names).toContain("get_graph");
    expect(names).toContain("list_folders");
    expect(names).toContain("create_folder");
    expect(names).toContain("get_daily_note");
    expect(names).toContain("list_templates");
    expect(names).toContain("create_note_from_template");
    expect(names).toHaveLength(14);
  });

  it("each tool has a description and inputSchema", () => {
    const tools = getToolDefinitions();
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});
