/**
 * Factory: build a fresh `McpServer` instance bound to a specific
 * authenticated user + API-key scope. Each MCP session (Streamable HTTP,
 * SSE) gets its own instance so per-session state doesn't bleed across
 * users.
 *
 * Tool definitions and handlers live in `tools.ts`; dynamic tools
 * generated from the OpenAPI spec live in `dynamic-tools.ts`.
 */
import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getToolDefinitions, executeTool } from "./tools.js";
import { generateDynamicTools } from "./dynamic-tools.js";
import { createLogger } from "../../../lib/logger.js";

const log = createLogger("mcp");

function jsonSchemaToZod(
  props: Record<string, { type: string; description?: string }>,
): Record<string, z.ZodTypeAny> {
  const out: Record<string, z.ZodTypeAny> = {};
  for (const [key, val] of Object.entries(props)) {
    let s: z.ZodTypeAny;
    switch (val.type) {
      case "number":
        s = z.number();
        break;
      case "boolean":
        s = z.boolean();
        break;
      default:
        s = z.string();
    }
    if (val.description) s = s.describe(val.description);
    out[key] = s;
  }
  return out;
}

export interface BuildMcpServerArgs {
  app: FastifyInstance;
  userId: string;
  keyScope: string;
  rawKey: string;
}

export function buildMcpServer({ app, userId, keyScope, rawKey }: BuildMcpServerArgs): McpServer {
  const server = new McpServer({ name: "Kryton", version: "4.4.0" });

  const port = String(app.config.PORT);
  const openApiSpec =
    typeof (app as unknown as { swagger?: () => unknown }).swagger === "function"
      ? ((app as unknown as { swagger: () => unknown }).swagger() as Record<string, unknown>)
      : {};

  // Core tools (defined in tools.ts, all use Fastify decorators).
  const toolDefs = getToolDefinitions();
  for (const toolDef of toolDefs) {
    const props = (toolDef.inputSchema.properties ?? {}) as Record<
      string,
      { type: string; description?: string }
    >;
    const hasParams = Object.keys(props).length > 0;

    const wrap = async (args: Record<string, unknown>) => {
      if (toolDef.scope === "read-write" && keyScope !== "read-write") {
        return {
          content: [{ type: "text" as const, text: "Error: This tool requires a read-write API key." }],
          isError: true,
        };
      }
      try {
        const result = await executeTool(app, toolDef.name, args, userId, rawKey);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        log.error(`MCP tool ${toolDef.name} error:`, err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    };

    if (hasParams) {
      server.tool(toolDef.name, toolDef.description, jsonSchemaToZod(props), wrap);
    } else {
      server.tool(toolDef.name, toolDef.description, async () => wrap({}));
    }
  }

  // Dynamic tools — one per OpenAPI operation, dispatched via HTTP back to
  // the same server using the caller's API key.
  const coreToolNames = toolDefs.map((t) => t.name);
  const dynamicTools = generateDynamicTools(openApiSpec, coreToolNames);

  for (const dynTool of dynamicTools) {
    const props = (dynTool.inputSchema.properties ?? {}) as Record<
      string,
      { type: string; description?: string }
    >;
    const hasParams = Object.keys(props).length > 0;

    const handler = async (args: Record<string, unknown>) => {
      if (dynTool.scope === "read-write" && keyScope !== "read-write") {
        return {
          content: [{ type: "text" as const, text: "Error: This tool requires a read-write API key." }],
          isError: true,
        };
      }
      try {
        // apiPath is the OpenAPI path key, which is the full mounted
        // route (e.g. "/api/admin/users", "/version"). Do not prepend
        // any prefix — that doubled to "/api/api/..." before.
        let url = `http://localhost:${port}${dynTool.apiPath}`;
        const fetchInit: RequestInit = {
          method: dynTool.method,
          headers: {
            Authorization: `Bearer ${rawKey}`,
            "Content-Type": "application/json",
          },
        };

        if (dynTool.method === "GET" || dynTool.method === "DELETE") {
          const remaining = { ...args };
          const pathRe = /\{(\w+)\}/g;
          let m: RegExpExecArray | null;
          while ((m = pathRe.exec(dynTool.apiPath)) !== null) {
            const name = m[1];
            if (name in remaining) {
              url = url.replace(`{${name}}`, encodeURIComponent(String(remaining[name])));
              delete (remaining as Record<string, unknown>)[name];
            }
          }
          // Fastify wildcard params come through as a literal '*' in
          // the OpenAPI path. Sanitize step renamed the property to
          // 'path' — splice that value in for the trailing wildcard.
          // Don't URI-encode slashes; wildcard params are commonly
          // multi-segment paths like 'folder/note.md'.
          if (url.includes("/*") && typeof remaining.path === "string") {
            url = url.replace(/\*(?=$|\?)/, encodeURI(remaining.path));
            delete remaining.path;
          }
          const queryEntries = Object.entries(remaining).filter(([, v]) => v !== undefined && v !== null);
          if (queryEntries.length > 0) {
            const qs = new URLSearchParams(queryEntries.map(([k, v]) => [k, String(v)]));
            url = `${url}?${qs.toString()}`;
          }
        } else {
          // For POST/PUT/PATCH, the wildcard may live in the URL too
          // (e.g. POST /api/trash/restore/*). The body stays as-is.
          if (dynTool.apiPath.includes("/*") && typeof (args as { path?: unknown }).path === "string") {
            const bodyArgs = { ...args };
            url = url.replace(/\*(?=$|\?)/, encodeURI((bodyArgs as { path: string }).path));
            delete (bodyArgs as { path?: string }).path;
            fetchInit.body = JSON.stringify(bodyArgs);
          } else {
            fetchInit.body = JSON.stringify(args);
          }
        }

        const u = new URL(url);
        if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
          throw new Error("Dynamic tool URLs must target localhost");
        }

        const response = await fetch(url, fetchInit);
        const text = await response.text();
        if (!response.ok) {
          return {
            content: [{ type: "text" as const, text: `HTTP ${response.status}: ${text}` }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        log.error(`MCP dynamic tool ${dynTool.name} error:`, err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    };

    if (hasParams) {
      server.tool(dynTool.name, dynTool.description, jsonSchemaToZod(props), handler);
    } else {
      server.tool(dynTool.name, dynTool.description, async () => handler({}));
    }
  }

  // Resource: kryton://notes — full note tree.
  server.resource(
    "notes",
    "kryton://notes",
    { description: "The full note tree structure" },
    async (uri) => {
      const tree = await app.notes.scanDirectory(userId);
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify(tree, null, 2) },
        ],
      };
    },
  );

  return server;
}
