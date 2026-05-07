import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getToolDefinitions, executeTool } from "./tools.js";
import { generateDynamicTools } from "./dynamic-tools.js";
import { createLogger } from "../../../lib/logger.js";

const log = createLogger("mcp");

/** Map a JSON Schema property record to a Zod shape. */
function jsonSchemaToZod(
  props: Record<string, { type: string; description?: string }>,
): Record<string, z.ZodTypeAny> {
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

function createMcpServerInstance(
  app: FastifyInstance,
  userId: string,
  keyScope: string,
  rawKey: string,
  port: string,
  openApiSpec: Record<string, unknown>,
): McpServer {
  const server = new McpServer({ name: "Kryton", version: "3.1.0" });

  // Register core tools
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
          content: [
            { type: "text" as const, text: "Error: This tool requires a read-write API key." },
          ],
          isError: true,
        };
      }
      try {
        const result = await executeTool(app, toolDef.name, args, userId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
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

  // Register dynamic tools generated from the OpenAPI spec
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
          content: [
            { type: "text" as const, text: "Error: This tool requires a read-write API key." },
          ],
          isError: true,
        };
      }
      try {
        let url = `http://localhost:${port}/api${dynTool.apiPath}`;
        const fetchInit: RequestInit = {
          method: dynTool.method,
          headers: {
            Authorization: `Bearer ${rawKey}`,
            "Content-Type": "application/json",
          },
        };

        if (dynTool.method === "GET" || dynTool.method === "DELETE") {
          const remainingArgs = { ...args };
          const pathParamPattern = /\{(\w+)\}/g;
          let match: RegExpExecArray | null;
          while ((match = pathParamPattern.exec(dynTool.apiPath)) !== null) {
            const paramName = match[1];
            if (paramName in remainingArgs) {
              url = url.replace(
                `{${paramName}}`,
                encodeURIComponent(String(remainingArgs[paramName])),
              );
              delete (remainingArgs as Record<string, unknown>)[paramName];
            }
          }
          const queryEntries = Object.entries(remainingArgs).filter(
            ([, v]) => v !== undefined && v !== null,
          );
          if (queryEntries.length > 0) {
            const qs = new URLSearchParams(
              queryEntries.map(([k, v]) => [k, String(v)]),
            );
            url = `${url}?${qs.toString()}`;
          }
        } else {
          fetchInit.body = JSON.stringify(args);
        }

        const urlObj = new URL(url);
        if (urlObj.hostname !== "localhost" && urlObj.hostname !== "127.0.0.1") {
          throw new Error("Dynamic tool URLs must target localhost");
        }

        const response = await fetch(url, fetchInit);
        const text = await response.text();
        if (!response.ok) {
          return {
            content: [
              { type: "text" as const, text: `HTTP ${response.status}: ${text}` },
            ],
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

  // Register kryton://notes resource
  server.resource(
    "notes",
    "kryton://notes",
    { description: "The full note tree structure" },
    async (uri) => {
      const tree = await app.notes.scanDirectory(userId);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(tree, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

/**
 * MCP routes — mounted under `/api/mcp`. Authenticates with a Personal Access
 * Token (kryton_*) and delegates the streamable HTTP transport to the MCP SDK.
 *
 * The Fastify reply is hijacked so the underlying Node response can be written
 * directly by the MCP transport.
 */
export const mcpRoutes: FastifyPluginAsync = async (app) => {
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/",
    schema: { hide: true },
    handler: async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith("Bearer kryton_")) {
        reply.status(401);
        return { error: "API key required for MCP access" };
      }

      const rawKey = authHeader.slice(7);
      const keyData = await app.identity.apiKey.validate(rawKey);
      if (!keyData) {
        reply.status(401);
        return { error: "Invalid or expired API key" };
      }

      const user = await app.prisma.user.findUnique({
        where: { id: keyData.userId },
        select: { id: true, email: true, name: true, role: true, disabled: true },
      });
      if (!user || user.disabled) {
        reply.status(403);
        return { error: "Account is disabled" };
      }

      // Hijack the reply so the MCP transport owns the Node response stream.
      reply.hijack();

      const port = String(app.config.PORT);
      // Pull the live OpenAPI spec from @fastify/swagger if it's registered;
      // otherwise fall back to an empty spec (no dynamic tools).
      const openApiSpec =
        typeof (app as unknown as { swagger?: () => unknown }).swagger === "function"
          ? ((app as unknown as { swagger: () => unknown }).swagger() as Record<string, unknown>)
          : {};
      const server = createMcpServerInstance(
        app,
        user.id,
        keyData.scope,
        rawKey,
        port,
        openApiSpec,
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);

      try {
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (err) {
        log.error("MCP transport error:", err);
        if (!reply.raw.headersSent) {
          reply.raw.statusCode = 500;
          reply.raw.setHeader("content-type", "application/json");
          reply.raw.end(JSON.stringify({ error: "MCP transport error" }));
        } else {
          reply.raw.end();
        }
      }
    },
  });
};
