# @azrtydxb/kryton-init

Interactive installer that signs you in to a [Kryton](https://kryton.ai) server, mints an API key, and wires every detected AI agent host on this machine to use it via MCP.

One command turns "I have a Kryton server" into "Claude Code, Cursor, Codex, Claude Desktop, Cline, Continue, OpenCode, KiloCode, and RooCode all see Kryton's tools" — without hand-editing nine different config files.

## Quick start

```bash
npx -y @azrtydxb/kryton-init
```

That's the whole thing. It will:

1. Probe the server (defaults to `https://kryton.ai`; pass `--server <url>` for self-hosted).
2. Prompt for email + password, sign in via the public auth endpoint.
3. Mint an API key named `kryton-init: <hostname>` with `read-write` scope.
4. Detect every supported AI agent host installed on this machine.
5. Show a checkbox list — pick which hosts to wire.
6. Write the MCP entry into each chosen host's config file (preserving everything else in it).
7. Print a per-host post-install hint (which app needs a restart, where to toggle the server on, etc.).

Run it again any time to re-wire after installing a new host, or change servers.

## Commands

| Command                | What it does                                                          |
| ---------------------- | --------------------------------------------------------------------- |
| `kryton-init` _(default)_ / `kryton-init install` | Full interactive flow described above. |
| `kryton-init uninstall` | Remove the `kryton` MCP entry from every wired host's config.        |
| `kryton-init status`    | Print the current state: server, key prefix, list of wired hosts.    |
| `kryton-init detect`    | List detected AI agent hosts; doesn't sign in or write anything.     |
| `kryton-init mcp`       | Print an MCP entry snippet for manual wiring (when a host isn't auto-supported). Use `--host <name>` for one specific host shape. |

### Common flags

| Flag                       | Applies to                | Meaning                                                                 |
| -------------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `--server <url>`           | `install`                 | Kryton server base URL. Also reads `KRYTON_SERVER` env var.             |
| `--hosts <a,b,c>`          | `install`, `uninstall`    | Restrict to a comma-separated subset (host names below).                |
| `--dry-run`                | `install`, `uninstall`    | Print the plan; write nothing.                                          |
| `--yes` / `-y`             | `install`, `uninstall`    | Non-interactive: accept defaults; on uninstall, force-remove even if a config has drifted from the recorded hash. |
| `--host <name>`            | `mcp`                     | Print just that one host's MCP snippet shape.                           |

## Supported hosts

Each host's config file is edited in place; everything else in the file is preserved.

| Name             | App                      | Config file                                                                  | Transport |
| ---------------- | ------------------------ | ---------------------------------------------------------------------------- | --------- |
| `claude-code`    | Claude Code              | `~/.claude.json`                                                             | HTTP      |
| `cursor`         | Cursor                   | `~/.cursor/mcp.json`                                                         | HTTP      |
| `claude-desktop` | Claude Desktop           | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `$XDG_CONFIG_HOME/Claude/…` (Linux) | stdio |
| `codex`          | OpenAI Codex CLI         | `~/.codex/config.toml`                                                       | stdio     |
| `opencode`       | OpenCode                 | `$XDG_CONFIG_HOME/opencode/config.json`                                      | stdio     |
| `cline`          | Cline (VS Code)          | VS Code extension dir for `saoudrizwan.claude-dev-*`                         | stdio     |
| `continue`       | Continue                 | `~/.continue/config.yaml`                                                    | stdio     |
| `kilocode`       | KiloCode                 | `$XDG_CONFIG_HOME/kilocode/mcp.json`                                         | stdio     |
| `roocode`        | RooCode (VS Code)        | VS Code globalStorage dir for `rooveterinaryinc.roo-cline`                   | stdio     |

Run `kryton-init detect` to see which of these are actually installed on this machine.

## Transports

`kryton-init` picks the right transport per host:

- **HTTP** — the host hits `<server>/api/mcp` directly with the bearer token in `Authorization`. Faster, fewer moving parts, no separate process.
- **stdio** — the host spawns [`@azrtydxb/kryton-mcp`](../kryton-mcp/README.md) via `npx`, which proxies stdio JSON-RPC to the same `/api/mcp` endpoint. Used for hosts that don't (yet) speak Streamable-HTTP MCP.

The transport choice is per host and not configurable — it tracks whatever the host actually supports today.

## State file

After a successful install, `kryton-init` records the install plan at:

```
$XDG_CONFIG_HOME/kryton-init/state.json
   (default: ~/.config/kryton-init/state.json)
```

It contains the server URL, the API-key id + prefix + full plaintext key (file is `chmod 0600`), and a hash of each wired host's config at write time. The hash is what lets `uninstall` refuse to clobber a config you've hand-edited since — pass `--yes` to override.

`kryton-init uninstall` removes the entries from each wired config and revokes the API key on the server.

## Environment

| Variable          | Used by      | Notes                                                            |
| ----------------- | ------------ | ---------------------------------------------------------------- |
| `KRYTON_SERVER`   | `install`    | Default for `--server`. Overridden by an explicit flag.          |
| `XDG_CONFIG_HOME` | all          | Base dir for the state file and several host configs.            |

## Examples

Self-hosted, all detected hosts:

```bash
npx -y @azrtydxb/kryton-init --server https://kryton.example.com
```

Just Claude Code, scripted:

```bash
npx -y @azrtydxb/kryton-init install \
  --server https://kryton.example.com \
  --hosts claude-code \
  --yes
```

Preview what _would_ change, then bail:

```bash
npx -y @azrtydxb/kryton-init install --dry-run
```

Print the snippet you'd paste into a host this tool doesn't yet auto-support:

```bash
npx -y @azrtydxb/kryton-init mcp --host claude-desktop
```

## Uninstall

```bash
npx -y @azrtydxb/kryton-init uninstall
```

Removes Kryton's MCP entry from every previously-wired config and revokes the API key. Add `--hosts <list>` to scope to a subset; add `--yes` to force-remove past a config-hash mismatch.

## See also

- [`@azrtydxb/kryton-mcp`](../kryton-mcp/README.md) — the stdio shim that's installed under the hood for non-HTTP hosts.
- [Kryton server docs](https://kryton.ai) — for the full tool catalogue exposed at `/api/mcp`.
