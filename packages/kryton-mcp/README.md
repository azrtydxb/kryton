# @azrtydxb/kryton-mcp

stdio MCP shim for [Kryton](https://kryton.ai). Bridges stdio JSON-RPC (used by
Claude Desktop, Cline, Continue, and other older MCP hosts) to a Kryton
server's HTTP MCP transport at `<server>/api/mcp`.

## Usage

```jsonc
{
  "mcpServers": {
    "kryton": {
      "command": "npx",
      "args": ["-y", "@azrtydxb/kryton-mcp"],
      "env": {
        "KRYTON_URL": "https://kryton.ai",
        "KRYTON_TOKEN": "kryton_..."
      }
    }
  }
}
```

## Environment

| Variable       | Default              | Notes                                                                    |
| -------------- | -------------------- | ------------------------------------------------------------------------ |
| `KRYTON_URL`   | `https://kryton.ai`  | Base URL of the Kryton server. The shim POSTs to `<url>/api/mcp`.        |
| `KRYTON_TOKEN` | _(required)_         | Bearer token, must begin with `kryton_`. Mint via `kryton-init` or UI.   |
| `KRYTON_DEBUG` | unset                | When `1`, emits `[kryton-mcp] level=… msg=… …` lines on stderr.          |

## Exit codes

| Code | Meaning                                       |
| ---- | --------------------------------------------- |
| 0    | Clean shutdown (stdin closed).                |
| 1    | Missing/invalid env, or fatal upstream error. |

The shim is a thin proxy — the upstream Kryton server is the source of truth
for the tool list, which is generated dynamically from its OpenAPI spec.
