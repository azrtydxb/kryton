/**
 * MCP transport routes — re-exports the Streamable HTTP and SSE plugins.
 * The agents module registers both under `/api/mcp`:
 *   - Streamable HTTP (modern):  POST/GET/DELETE /api/mcp
 *   - SSE (legacy):              GET /api/mcp/sse + POST /api/mcp/messages
 *
 * For stdio-only host clients (Claude Desktop default, etc.), use the
 * generic `mcp-remote` proxy:
 *
 *   {
 *     "mcpServers": {
 *       "kryton": {
 *         "command": "npx",
 *         "args": [
 *           "-y", "mcp-remote",
 *           "https://kryton.example.com/api/mcp",
 *           "--header", "Authorization: Bearer kryton_xxx..."
 *         ]
 *       }
 *     }
 *   }
 */
export { streamableMcpRoutes } from "./streamable.js";
export { sseMcpRoutes } from "./sse.js";

// Backwards-compat alias for callers that imported the original plugin.
export { streamableMcpRoutes as mcpRoutes } from "./streamable.js";
