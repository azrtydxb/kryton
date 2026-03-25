import * as path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Request, Response, Router } from "express";
import { z } from "zod";
import { validateApiKey } from "../services/apiKeyService.js";
import { prisma } from "../prisma.js";
import { getToolDefinitions, executeTool } from "./mcpTools.js";
import { generateDynamicTools } from "./dynamicTools.js";
import { swaggerSpec } from "../swagger.js";
import { scanDirectory } from "../services/noteService.js";
import { getUserNotesDir } from "../services/userNotesDir.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("mcp");

const NOTES_DIR = path.resolve(
  process.env.NOTES_DIR || path.join(import.meta.dirname, "../../../notes")
);

/** Map from JSON Schema type to Zod schema */
function jsonSchemaToZod(props: Record<string, { type: string; description?: string }>): Record<string, z.ZodTypeAny> {
  const zodProps: Record<string, z.ZodTypeAny> = {};
  for (const [key, val] of Object.entries(props)) {
    let schema: z.ZodTypeAny;
    switch (val.type) {
      case "number":
        schema = z.number();
        break;
      case "boolean":
        schema = z.boolean();
        break;
      default:
        schema = z.string();
    }
    if (val.description) {
      schema = schema.describe(val.description);
    }
    zodProps[key] = schema;
  }
  return zodProps;
}

function createMcpServerInstance(userId: string, keyScope: string, rawKey: string): McpServer {
  const server = new McpServer({ name: "Mnemo", version: "3.1.0" });

  // Register 14 core tools
  const toolDefs = getToolDefinitions();
  for (const toolDef of toolDefs) {
    const props = (toolDef.inputSchema.properties ?? {}) as Record<string, { type: string; description?: string }>;
    const hasParams = Object.keys(props).length > 0;

    if (hasParams) {
      const zodProps = jsonSchemaToZod(props);
      server.tool(
        toolDef.name,
        toolDef.description,
        zodProps,
        async (args: Record<string, unknown>) => {
          if (toolDef.scope === "read-write" && keyScope !== "read-write") {
            return {
              content: [{ type: "text" as const, text: "Error: This tool requires a read-write API key." }],
              isError: true,
            };
          }
          try {
            const result = await executeTool(toolDef.name, args, userId);
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
          } catch (err) {
            log.error(`MCP tool ${toolDef.name} error:`, err);
            return {
              content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : "Unknown error"}` }],
              isError: true,
            };
          }
        },
      );
    } else {
      server.tool(
        toolDef.name,
        toolDef.description,
        async () => {
          if (toolDef.scope === "read-write" && keyScope !== "read-write") {
            return {
              content: [{ type: "text" as const, text: "Error: This tool requires a read-write API key." }],
              isError: true,
            };
          }
          try {
            const result = await executeTool(toolDef.name, {}, userId);
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
          } catch (err) {
            log.error(`MCP tool ${toolDef.name} error:`, err);
            return {
              content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : "Unknown error"}` }],
              isError: true,
            };
          }
        },
      );
    }
  }

  // Register dynamic tools from OpenAPI spec (e.g. plugin routes)
  const coreToolNames = toolDefs.map(t => t.name);
  const dynamicTools = generateDynamicTools(swaggerSpec as Record<string, unknown>, coreToolNames);
  const port = process.env.PORT || "3001";

  for (const dynTool of dynamicTools) {
    const props = (dynTool.inputSchema.properties ?? {}) as Record<string, { type: string; description?: string }>;
    const hasParams = Object.keys(props).length > 0;

    const handler = async (args: Record<string, unknown>) => {
      if (dynTool.scope === "read-write" && keyScope !== "read-write") {
        return {
          content: [{ type: "text" as const, text: "Error: This tool requires a read-write API key." }],
          isError: true,
        };
      }
      try {
        let url = `http://localhost:${port}/api${dynTool.apiPath}`;
        const fetchInit: RequestInit = {
          method: dynTool.method,
          headers: {
            "Authorization": `Bearer ${rawKey}`,
            "Content-Type": "application/json",
          },
        };

        if (dynTool.method === "GET" || dynTool.method === "DELETE") {
          // Substitute path params, remainder become query params
          const remainingArgs = { ...args };
          const pathParamPattern = /\{(\w+)\}/g;
          let match: RegExpExecArray | null;
          while ((match = pathParamPattern.exec(dynTool.apiPath)) !== null) {
            const paramName = match[1];
            if (paramName in remainingArgs) {
              url = url.replace(`{${paramName}}`, encodeURIComponent(String(remainingArgs[paramName])));
              delete (remainingArgs as Record<string, unknown>)[paramName];
            }
          }
          const queryEntries = Object.entries(remainingArgs).filter(([, v]) => v !== undefined && v !== null);
          if (queryEntries.length > 0) {
            const qs = new URLSearchParams(queryEntries.map(([k, v]) => [k, String(v)]));
            url = `${url}?${qs.toString()}`;
          }
        } else {
          // POST / PUT — send as JSON body
          fetchInit.body = JSON.stringify(args);
        }

        const response = await fetch(url, fetchInit);
        const text = await response.text();
        if (!response.ok) {
          return {
            content: [{ type: "text" as const, text: `HTTP ${response.status}: ${text}` }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: text }] };
      } catch (err) {
        log.error(`MCP dynamic tool ${dynTool.name} error:`, err);
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : "Unknown error"}` }],
          isError: true,
        };
      }
    };

    if (hasParams) {
      const zodProps = jsonSchemaToZod(props);
      server.tool(dynTool.name, dynTool.description, zodProps, handler);
    } else {
      server.tool(dynTool.name, dynTool.description, async () => handler({}));
    }
  }

  // Register mnemo://notes resource
  server.resource(
    "notes",
    "mnemo://notes",
    { description: "The full note tree structure" },
    async (uri) => {
      const userDir = await getUserNotesDir(NOTES_DIR, userId);
      const tree = await scanDirectory(userDir);
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(tree, null, 2),
        }],
      };
    },
  );

  return server;
}

export function createMcpRouter(): Router {
  const router = Router();

  router.all("/", async (req: Request, res: Response) => {
    // Authenticate via API key
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer mnemo_")) {
      res.status(401).json({ error: "API key required for MCP access" });
      return;
    }

    const rawKey = authHeader.slice(7); // strip "Bearer "
    const keyData = await validateApiKey(rawKey);
    if (!keyData) {
      res.status(401).json({ error: "Invalid or expired API key" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: keyData.userId },
      select: { id: true, email: true, name: true, role: true, disabled: true },
    });

    if (!user || user.disabled) {
      res.status(403).json({ error: "Account is disabled" });
      return;
    }

    // Create a stateless MCP server per request
    const server = createMcpServerInstance(user.id, keyData.scope, rawKey);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);

    await transport.handleRequest(req, res, req.body);
  });

  return router;
}
