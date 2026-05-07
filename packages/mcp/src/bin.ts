#!/usr/bin/env node
/**
 * `kryton-mcp` — stdio MCP entrypoint.
 *
 * Spawned by host MCP clients (Claude Desktop, Cursor, Kilo, etc.) as
 * a subprocess. Reads JSON-RPC from stdin, writes responses to stdout,
 * forwards everything to a remote Kryton server's Streamable HTTP MCP
 * endpoint.
 *
 * Example Claude Desktop config:
 *   {
 *     "mcpServers": {
 *       "kryton": {
 *         "command": "npx",
 *         "args": ["-y", "@azrtydxb/mcp"],
 *         "env": {
 *           "KRYTON_BASE_URL": "https://kryton.example.com",
 *           "KRYTON_TOKEN": "kryton_xxx..."
 *         }
 *       }
 *     }
 *   }
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildKrytonMcpShim } from "./index.js";

async function main(): Promise<void> {
  const ctx = buildKrytonMcpShim();
  const transport = new StdioServerTransport();
  await ctx.server.connect(transport);

  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`[kryton-mcp] received ${signal}, shutting down\n`);
    try {
      await ctx.close();
    } catch {
      // best-effort
    }
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  process.stderr.write(`[kryton-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
