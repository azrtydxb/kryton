export interface DynamicToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope: "read-only" | "read-write";
  method: string;
  apiPath: string;
}

const EXCLUDED_PREFIXES = [
  "/admin", "/auth", "/api-keys", "/mcp", "/docs", "/health",
  // Core note API routes handled by built-in tools
  "/notes", "/search", "/tags", "/backlinks", "/graph", "/folders", "/daily", "/templates",
];

/**
 * Coerce an OpenAPI parameter name to something Anthropic's tool-use
 * API will accept as a JSON-Schema property key: ^[a-zA-Z0-9_.-]{1,64}$.
 * Fastify wildcard params come through as the literal '*'; we map those
 * to 'path' (the closest descriptive name). Anything else illegal gets
 * underscores.
 */
function sanitizePropertyKey(name: string): string {
  if (name === "*") return "path";
  const cleaned = name.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64);
  return cleaned || "param";
}

export function generateDynamicTools(
  spec: Record<string, unknown>,
  coreToolNames: string[],
): DynamicToolDef[] {
  const paths = (spec as { paths?: Record<string, Record<string, unknown>> }).paths;
  if (!paths) return [];

  const tools: DynamicToolDef[] = [];
  const coreSet = new Set(coreToolNames);

  for (const [apiPath, methods] of Object.entries(paths)) {
    if (EXCLUDED_PREFIXES.some(prefix => apiPath.startsWith(prefix))) continue;

    for (const [method, operation] of Object.entries(methods as Record<string, Record<string, unknown>>)) {
      if (!["get", "post", "put", "delete"].includes(method)) continue;

      const op = operation as {
        summary?: string;
        description?: string;
        operationId?: string;
        requestBody?: { content?: { "application/json"?: { schema?: Record<string, unknown> } } };
        parameters?: Array<{ name: string; in: string; description?: string; required?: boolean; schema?: Record<string, unknown> }>;
      };

      const name = op.operationId ||
        `${method}_${apiPath.replace(/^\//, "").replace(/[/:{}]/g, "_").replace(/_+/g, "_").replace(/_$/, "")}`;

      if (coreSet.has(name)) continue;

      const scope: "read-only" | "read-write" = method === "get" ? "read-only" : "read-write";

      let inputSchema: Record<string, unknown> = { type: "object", properties: {}, required: [] };

      const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
      if (bodySchema) {
        inputSchema = { ...bodySchema };
      }

      if (op.parameters?.length) {
        const props: Record<string, unknown> = {};
        const required: string[] = [];
        for (const param of op.parameters) {
          // Anthropic's tool-use API restricts property keys to
          // ^[a-zA-Z0-9_.-]{1,64}$. Fastify wildcard params surface as
          // the literal '*', which violates that pattern. Sanitize +
          // record the alias so the executor can map it back.
          const safeKey = sanitizePropertyKey(param.name);
          props[safeKey] = {
            type: param.schema?.type || "string",
            description: param.description || `${param.in} parameter: ${param.name}`,
          };
          if (param.required) required.push(safeKey);
        }
        if (!bodySchema) {
          inputSchema = { type: "object", properties: props, required };
        }
      }

      tools.push({
        name,
        description: op.summary || op.description || `${method.toUpperCase()} ${apiPath}`,
        inputSchema,
        scope,
        method: method.toUpperCase(),
        apiPath,
      });
    }
  }

  return tools;
}
