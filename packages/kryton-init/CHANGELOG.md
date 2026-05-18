# @azrtydxb/kryton-init

## 0.3.0

### Minor Changes

- c0fe66a: Add `KRYTON_EMAIL` + `KRYTON_PASSWORD` env-var support for non-interactive auth. Both required to skip the prompts; either one missing still prompts. Lets `kryton-init install --yes` run unattended in CI.

## 0.2.1

### Patch Changes

- 0d8de5f: Internal: validate Trusted Publishers + Sigstore provenance pipeline. No user-visible behaviour changes.

## 0.2.0

### Minor Changes

- 33a628e: First release of the Kryton CLI.

  - `@azrtydxb/kryton-mcp` — stdio MCP shim that proxies to a remote Kryton's `/api/mcp`. Lets stdio-only AI tools (Claude Desktop, Cline, Continue, …) use Kryton.
  - `@azrtydxb/kryton-init` — interactive installer that signs in to a Kryton server, mints an API key, and wires every detected AI agent host on the machine (Claude Code, Cursor, Claude Desktop, Codex, OpenCode, Cline, Continue, KiloCode, RooCode).
