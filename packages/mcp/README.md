# @azrtydxb/mcp

Stdio MCP shim for Kryton. Bridges a local stdio MCP client (Claude Desktop, Cursor, Kilo, etc.) to a remote Kryton server's Streamable HTTP MCP endpoint at `/api/mcp`.

## Why

Kryton's server speaks two MCP transports natively:

- **Streamable HTTP** (modern): `POST/GET/DELETE /api/mcp`
- **SSE** (legacy): `GET /api/mcp/sse` + `POST /api/mcp/messages`

Some host MCP clients only speak stdio. This shim runs as a subprocess of the host, accepts MCP JSON-RPC on stdin/stdout, and forwards every request to the remote server over Streamable HTTP.

## Install

```sh
npx @azrtydxb/mcp        # one-shot, no install
# or
npm install -g @azrtydxb/mcp
```

## Configuration

Two environment variables:

| Variable          | Required | Default                  |
| ----------------- | -------- | ------------------------ |
| `KRYTON_BASE_URL` | no       | `http://localhost:3001`  |
| `KRYTON_TOKEN`    | **yes**  | —                        |

`KRYTON_TOKEN` must be a Personal Access Token (`kryton_…`) created via `POST /api/api-keys` on the server.

## Claude Desktop / Cursor / Kilo example

```jsonc
{
  "mcpServers": {
    "kryton": {
      "command": "npx",
      "args": ["-y", "@azrtydxb/mcp"],
      "env": {
        "KRYTON_BASE_URL": "https://kryton.example.com",
        "KRYTON_TOKEN": "kryton_xxx..."
      }
    }
  }
}
```

## Direct connection (skip the shim)

If your host supports remote MCP transports natively, point it directly at:

- Streamable HTTP: `https://kryton.example.com/api/mcp`
- SSE:             `https://kryton.example.com/api/mcp/sse`

Both require the same bearer token.
