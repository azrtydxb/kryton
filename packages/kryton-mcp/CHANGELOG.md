# @azrtydxb/kryton-mcp

## 0.2.0

### Minor Changes

- 33a628e: First release of the Kryton CLI.

  - `@azrtydxb/kryton-mcp` — stdio MCP shim that proxies to a remote Kryton's `/api/mcp`. Lets stdio-only AI tools (Claude Desktop, Cline, Continue, …) use Kryton.
  - `@azrtydxb/kryton-init` — interactive installer that signs in to a Kryton server, mints an API key, and wires every detected AI agent host on the machine (Claude Code, Cursor, Claude Desktop, Codex, OpenCode, Cline, Continue, KiloCode, RooCode).
