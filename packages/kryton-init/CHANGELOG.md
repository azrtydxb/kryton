# @azrtydxb/kryton-init

## 0.3.2

### Patch Changes

- 7675ad8: Drop the fake `https://kryton.ai` default server URL — Kryton is self-hosted and that domain doesn't resolve, so users who accepted the default hit a confusing "server unreachable" failure that looked like a network issue. The interactive prompt now has no default (the user must enter a URL, or the installer reuses the prior install's server if any). The `--yes` non-interactive path now errors out clearly if neither `--server`, `KRYTON_SERVER`, nor prior state provides a URL, instead of silently using the fake default.

  Also adds a README covering the install/uninstall/status/detect/mcp commands, every supported AI agent host with its config-file path and chosen transport, the state-file location and contents, and the env vars.

## 0.3.1

### Patch Changes

- e1fcf02: Send `scope: "read-write"` when minting the API key. Kryton's `POST /api/api-keys` requires it; previous versions failed with `VALIDATION_ERROR` against any current server.

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
