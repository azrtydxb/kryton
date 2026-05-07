/**
 * Kryton stdio MCP shim — exposes a remote Kryton server's MCP tools
 * to a local stdio MCP client (Claude Desktop, Cursor, Kilo, etc.).
 *
 * Architecture:
 *   - On the host side, run a `Server` over stdio (this process talks
 *     JSON-RPC on stdin/stdout to the host MCP client).
 *   - On the remote side, run a `Client` over Streamable HTTP against
 *     `<KRYTON_BASE_URL>/api/mcp` using the configured bearer token.
 *   - Forward every request the host makes (initialize, tools/list,
 *     tools/call, resources/list, resources/read, prompts/list,
 *     prompts/get, completion/complete, logging/setLevel, ping) to the
 *     remote Client; relay the response back.
 *
 * Why a thin proxy and not a tool-list mirror? The shim doesn't need
 * to know the tool schemas — the remote server is the source of truth.
 * Adding a tool on the server is automatically visible through the
 * shim with no shim release required.
 *
 * Configuration via env vars:
 *   KRYTON_BASE_URL  — server origin, e.g. https://kryton.example.com
 *                      (default: http://localhost:3001)
 *   KRYTON_TOKEN     — Personal Access Token (must start with `kryton_`)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  InitializedNotificationSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  PingRequestSchema,
  ReadResourceRequestSchema,
  SetLevelRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export interface ShimOptions {
  baseUrl?: string;
  token?: string;
  /** Server name advertised over stdio. Defaults to "kryton". */
  serverName?: string;
  /** Server version advertised over stdio. */
  serverVersion?: string;
}

export interface ShimContext {
  /** The remote MCP client. Connect / disconnect with caller-supplied transports. */
  client: Client;
  /** The local MCP server. Bind to StdioServerTransport via `connect`. */
  server: Server;
  /** Closes the remote client. The server is closed by its transport. */
  close(): Promise<void>;
}

/**
 * Build a stdio↔Streamable-HTTP MCP proxy. The caller wires up the
 * transports (StreamableHTTPClientTransport on the client, whatever on
 * the server — typically `StdioServerTransport`) and connects them.
 *
 * For the canonical stdio entrypoint, see `bin.ts`.
 */
export function buildKrytonMcpShim(options: ShimOptions = {}): ShimContext {
  const baseUrl = (options.baseUrl ?? process.env.KRYTON_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
  const token = options.token ?? process.env.KRYTON_TOKEN;
  if (!token) {
    throw new Error("KRYTON_TOKEN environment variable is required (Personal Access Token starting with kryton_)");
  }
  if (!token.startsWith("kryton_")) {
    throw new Error("KRYTON_TOKEN must be a Personal Access Token (starts with kryton_)");
  }

  const remoteUrl = new URL(`${baseUrl}/api/mcp`);
  const httpTransport = new StreamableHTTPClientTransport(remoteUrl, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
  const client = new Client(
    { name: "kryton-stdio-shim", version: options.serverVersion ?? "4.4.0" },
    { capabilities: {} },
  );

  const server = new Server(
    {
      name: options.serverName ?? "kryton",
      version: options.serverVersion ?? "4.4.0",
    },
    {
      capabilities: {
        tools: {},
        resources: { subscribe: true },
        prompts: {},
        logging: {},
      },
    },
  );

  // --- forwarders: server-side request → remote client method ---
  // Each handler is a thin adapter that invokes the corresponding Client
  // call. The MCP SDK Client surface handles request id allocation and
  // response correlation; we only re-throw remote errors.

  server.setRequestHandler(PingRequestSchema, async () => {
    await client.ping();
    return {};
  });

  server.setRequestHandler(ListToolsRequestSchema, async (req) => {
    return client.listTools(req.params);
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    return client.callTool(req.params);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async (req) => {
    return client.listResources(req.params);
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (req) => {
    return client.listResourceTemplates(req.params);
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    return client.readResource(req.params);
  });

  server.setRequestHandler(SubscribeRequestSchema, async (req) => {
    return client.subscribeResource(req.params);
  });

  server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    return client.unsubscribeResource(req.params);
  });

  server.setRequestHandler(ListPromptsRequestSchema, async (req) => {
    return client.listPrompts(req.params);
  });

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    return client.getPrompt(req.params);
  });

  server.setRequestHandler(CompleteRequestSchema, async (req) => {
    return client.complete(req.params);
  });

  server.setRequestHandler(SetLevelRequestSchema, async (req) => {
    await client.setLoggingLevel(req.params.level);
    return {};
  });

  // Forward "initialized" notification to the remote so it knows the
  // host finished handshaking. The SDK already fires this on the remote
  // side when we call `client.connect`, so this is mostly informational.
  server.setNotificationHandler(InitializedNotificationSchema, async () => {
    // no-op — both sides are already initialised at this point.
  });

  // Connect remote client now (synchronously kicks off; resolves when
  // the remote initialise round-trip completes). The caller should
  // `await ctx.client.connect(...)` outside, but for the canonical bin.ts
  // entrypoint we expose connectRemote() to handle it.
  void connectRemote();

  async function connectRemote(): Promise<void> {
    try {
      await client.connect(httpTransport);
    } catch (err) {
      // Surface to stderr; the host MCP client will also see the stdio
      // server fail to handshake.
      process.stderr.write(
        `[kryton-mcp] Failed to connect to ${remoteUrl}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      throw err;
    }
  }

  return {
    client,
    server,
    async close() {
      try {
        await client.close();
      } catch {
        // best-effort
      }
    },
  };
}
