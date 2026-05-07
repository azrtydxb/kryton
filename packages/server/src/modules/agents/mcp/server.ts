/**
 * MCP transport routes — re-exports the Streamable HTTP and SSE plugins.
 * The agents module registers both under `/api/mcp`:
 *   - Streamable HTTP (modern):  POST/GET/DELETE /api/mcp
 *   - SSE (legacy):              GET /api/mcp/sse + POST /api/mcp/messages
 *
 * A separate stdio shim (`@azrtydxb/mcp` in packages/mcp) wraps the
 * Streamable HTTP transport for clients that only speak stdio.
 */
export { streamableMcpRoutes } from "./streamable.js";
export { sseMcpRoutes } from "./sse.js";

// Backwards-compat alias for callers that imported the original plugin.
export { streamableMcpRoutes as mcpRoutes } from "./streamable.js";
