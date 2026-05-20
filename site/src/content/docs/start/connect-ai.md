---
title: Connect your AI
description: One command detects every supported AI host on your machine and wires it to your Kryton server.
---

Kryton publishes two npm packages under `@azrtydxb/`: `kryton-init` (one-shot installer) and `kryton-mcp` (the stdio MCP shim for hosts that don't speak HTTP MCP).

## Quick start

```sh
npx @azrtydxb/kryton-init
```

The installer will:

1. Ask for your Kryton server URL (defaults to `https://kryton.ai`).
2. Sign you in via email + password.
3. Mint an API key named `kryton-init-<hostname>-<timestamp>`.
4. Detect every supported AI tool on your machine.
5. Write the appropriate MCP config to each one.

It is idempotent — re-running replaces previous Kryton entries instead of duplicating them, and writes a `<path>.kryton-init.bak.<timestamp>` next to every file it modifies.

## Supported hosts

macOS and Linux only.

| Host | Transport |
|---|---|
| Claude Code | HTTP (stdio fallback) |
| Cursor | HTTP (stdio fallback) |
| Claude Desktop | stdio |
| Codex | HTTP (stdio fallback) |
| OpenCode | stdio |
| Cline (VS Code) | stdio |
| Continue | stdio |
| KiloCode | stdio |
| RooCode | stdio |

## Other commands

```sh
kryton-init install        # interactive setup (default action)
kryton-init uninstall      # remove Kryton entries from every detected host
kryton-init status         # show which hosts are wired (token hash only)
kryton-init detect         # list detected hosts without writing anything
kryton-init mcp [--host]   # print the MCP JSON snippet to wire manually
```

`uninstall` also revokes the minted API key on the server.

For the manual JSON snippets and the full CLI reference, see [the CLI page](/kryton/advanced/reference/cli/).

## Next

[Your first notes](/kryton/start/first-notes/) — write something for your agent to read.
