import { describe, it, expect } from "vitest";
import { generateDynamicTools } from "../dynamicTools.js";

const CORE_TOOL_NAMES = [
  "list_notes", "read_note", "create_note", "update_note", "delete_note",
  "search", "list_tags", "get_backlinks", "get_graph", "list_folders",
  "create_folder", "get_daily_note", "list_templates", "create_note_from_template",
];

describe("dynamicTools", () => {
  it("generates tools from OpenAPI paths", () => {
    const spec = {
      paths: {
        "/plugins/summarize/run": {
          post: {
            summary: "Summarize a note",
            operationId: "summarize_run",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { notePath: { type: "string", description: "Path of the note" } },
                    required: ["notePath"],
                  },
                },
              },
            },
            responses: { "200": { description: "Summary result" } },
          },
        },
      },
    };

    const tools = generateDynamicTools(spec, CORE_TOOL_NAMES);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("summarize_run");
    expect(tools[0].description).toBe("Summarize a note");
    expect(tools[0].scope).toBe("read-write");
    expect(tools[0].method).toBe("POST");
    expect(tools[0].apiPath).toBe("/plugins/summarize/run");
  });

  it("skips paths covered by core tools", () => {
    const spec = { paths: { "/notes": { get: { summary: "List notes", responses: {} } } } };
    const tools = generateDynamicTools(spec, CORE_TOOL_NAMES);
    expect(tools).toHaveLength(0);
  });

  it("skips excluded paths (admin, auth, api-keys, mcp, docs)", () => {
    const spec = {
      paths: {
        "/admin/users": { get: { summary: "List users", responses: {} } },
        "/auth/login": { post: { summary: "Login", responses: {} } },
        "/api-keys": { get: { summary: "List keys", responses: {} } },
        "/mcp": { post: { summary: "MCP", responses: {} } },
        "/docs": { get: { summary: "Docs", responses: {} } },
      },
    };
    const tools = generateDynamicTools(spec, CORE_TOOL_NAMES);
    expect(tools).toHaveLength(0);
  });

  it("infers read-only scope for GET, read-write for POST/PUT/DELETE", () => {
    const spec = {
      paths: {
        "/plugins/stats/overview": { get: { summary: "Get stats", responses: {} } },
        "/plugins/stats/reset": { post: { summary: "Reset stats", responses: {} } },
      },
    };
    const tools = generateDynamicTools(spec, CORE_TOOL_NAMES);
    expect(tools).toHaveLength(2);
    const getT = tools.find(t => t.method === "GET")!;
    const postT = tools.find(t => t.method === "POST")!;
    expect(getT.scope).toBe("read-only");
    expect(postT.scope).toBe("read-write");
  });

  it("falls back to method_path name when no operationId", () => {
    const spec = { paths: { "/plugins/translate/run": { post: { summary: "Translate text", responses: {} } } } };
    const tools = generateDynamicTools(spec, CORE_TOOL_NAMES);
    expect(tools[0].name).toBe("post_plugins_translate_run");
  });
});
