# Kryton CLI — `@azrtydxb/kryton-mcp` + `@azrtydxb/kryton-init` Design

**Date:** 2026-05-18
**Status:** Approved
**Scope:** Ship two small npm packages that let any user run one command to wire their Kryton server into every AI agent host on their machine — matching the UX of `@azrtydxb/novamem-init` for novamem.

## Problem

Today, connecting an AI tool (Claude Code, Cursor, Claude Desktop, Codex, Cline, Continue, KiloCode, RooCode, OpenCode, …) to a Kryton server is manual:

- User has to find the right config file per tool (each has a different path + format)
- User has to mint an API key by hand via Kryton's UI/REST
- User has to know the MCP endpoint URL + the bearer header format
- Tools that only speak **stdio MCP** (notably Claude Desktop, several VS-Code-based extensions) have no path at all — Kryton only exposes HTTP MCP transports

`novamem` solved this with `@azrtydxb/novamem-init` (installer) + `@azrtydxb/novamem-mcp` (stdio shim). The end-user flow is `npx @azrtydxb/novamem-init` → interactive prompts → done. We want the same for Kryton.

## Existing Kryton MCP surface (no server changes needed for this work)

- **Streamable HTTP** — `POST /api/mcp` (new sessions on `initialize`, JSON-RPC); `GET /api/mcp` (server→client SSE for an existing session); `DELETE /api/mcp` (terminate). Session managed by `mcp-session-id` header. This is the current standard transport.
- **Legacy SSE** — `GET /api/mcp/sse` (open event stream, returns sessionId); `POST /api/mcp/messages?sessionId=…` (send JSON-RPC). Kept for older clients.
- **Auth** — Bearer header. Tokens are `kryton_<rest>` issued via session-authenticated `POST /api/api-keys`. Stored in DB as SHA-256 hash.
- **Tool surface** — Dynamic, generated from the server's OpenAPI spec on boot ([dynamic-tools.ts](../../../packages/server/src/modules/agents/mcp/dynamic-tools.ts)). Every API endpoint that's not in the deny-list becomes a tool. So clients automatically pick up new server endpoints — no manual tool registration.

Gap: **no stdio transport.** Most AI tools either still require stdio or work most reliably with it.

## Goals

- Single command `npx @azrtydxb/kryton-init` (no global install required) walks the user through:
  1. Server URL (defaults to `https://kryton.ai`, sensible local default for tunnel users).
  2. Sign-in (email + password against the existing BetterAuth `/api/auth/sign-in/email`).
  3. Mints a new API key named e.g. `kryton-init-<hostname>-<timestamp>` via `POST /api/api-keys`.
  4. Auto-detects which AI agent hosts are installed on the machine.
  5. For each one, writes/merges the appropriate config to register Kryton as an MCP server.
- Idempotent — running again replaces the previous Kryton entries without duplicating.
- Per-host transport choice:
  - Hosts that natively support **HTTP/streamable** MCP → wire `https://kryton.ai/api/mcp` with `Authorization: Bearer <key>` directly.
  - Hosts that only speak **stdio** → wire to `npx @azrtydxb/kryton-mcp` (the shim package), with `KRYTON_URL` + `KRYTON_TOKEN` env.
- Uninstall command `kryton-init uninstall` removes Kryton entries from all detected configs.

## Non-goals

- Replacing or modifying the Kryton server's MCP surface. Both packages are pure clients.
- Multi-server profiles (user has multiple Kryton instances). v1 is single-server; profile support deferred.
- Windows. v1 supports macOS + Linux only. (Same scope as novamem-init.)

## Design

### Package 1 — `@azrtydxb/kryton-mcp` (stdio shim)

Mirror of `@azrtydxb/novamem-mcp`. Single binary `kryton-mcp` that:

1. Reads `KRYTON_URL` + `KRYTON_TOKEN` from env.
2. Opens a stdio MCP server (via `@modelcontextprotocol/sdk`'s `StdioServerTransport`).
3. For each incoming JSON-RPC request, forwards it to `<KRYTON_URL>/api/mcp` over HTTPS with `Authorization: Bearer <KRYTON_TOKEN>`. Tracks `mcp-session-id` header round-trip.
4. Streams server→client notifications by holding a `GET /api/mcp` SSE channel open and re-emitting frames to stdio.
5. On `initialize`/`notifications/initialized` handshake passthrough.

Single source file `src/index.ts` + bin entry. Reuses `@modelcontextprotocol/sdk`. No invented protocol — pure adapter from stdio JSON-RPC to Kryton's HTTP MCP.

`bin.ts` is the entry, registered in `package.json` as:

```json
"bin": { "kryton-mcp": "dist/bin.js" }
```

### Package 2 — `@azrtydxb/kryton-init` (installer)

Mirror of `@azrtydxb/novamem-init`. Single binary `kryton-init` (also runnable as `npx @azrtydxb/kryton-init`). Built on `commander` + `@inquirer/prompts` + `smol-toml` (same deps as novamem-init).

Commands:

- `kryton-init install` (default) — interactive setup.
- `kryton-init uninstall` — remove Kryton entries from all detected configs.
- `kryton-init status` — show which hosts are wired + which Kryton URL/token they point at (token hash only, not raw).
- `kryton-init detect` — list detected AI tool hosts without writing anything.
- `kryton-init mcp` — print the JSON snippet to wire Kryton manually (escape hatch for unsupported hosts).

Source files mirror novamem-init's layout (since 70% of host-detection + config-merge logic is reusable):

| File | Purpose |
|---|---|
| `src/main.ts` | Commander entrypoint |
| `src/commands.ts` | Command handlers (install/uninstall/status/detect/mcp) |
| `src/auth.ts` | BetterAuth sign-in + API-key mint flow |
| `src/detect.ts` | Detect which hosts are installed on the machine |
| `src/tools.ts` | Per-host metadata (config path, format, supports stdio/HTTP) |
| `src/install/*.ts` | One file per host with read-merge-write logic |
| `src/merge.ts` | Generic JSON/TOML merge helpers |
| `src/file-ops.ts` | Atomic write, backup creation |
| `src/mcp.ts` | Render the MCP entry (stdio vs HTTP variant) |
| `src/state.ts` | State file `~/.config/kryton-init/state.json` listing wired hosts |

### Per-host MCP entry shape

Two shapes depending on whether the host supports streamable HTTP natively.

**HTTP shape** (recent Claude Code, recent Cursor with HTTP MCP, recent VS Code MCP host):

```json
{
  "mcpServers": {
    "kryton": {
      "type": "http",
      "url": "https://kryton.ai/api/mcp",
      "headers": {
        "Authorization": "Bearer kryton_xxxx..."
      }
    }
  }
}
```

**stdio shape** (Claude Desktop, older Cursor, Continue, Cline, …):

```json
{
  "mcpServers": {
    "kryton": {
      "command": "npx",
      "args": ["-y", "@azrtydxb/kryton-mcp"],
      "env": {
        "KRYTON_URL": "https://kryton.ai",
        "KRYTON_TOKEN": "kryton_xxxx..."
      }
    }
  }
}
```

The per-host modules pick the right shape based on `tools.ts` capability flags.

### Auth flow

1. Interactive prompt for server URL (default `https://kryton.ai`, suggest tunnel URL if discoverable from local kryton-init state).
2. Prompt for email + password.
3. `POST <server>/api/auth/sign-in/email` returns `{token, user}` — `token` is a session token, not the API key.
4. `POST <server>/api/api-keys` with `Authorization: Bearer <session-token>` and body `{name: "kryton-init-<hostname>-<ISO timestamp>"}` returns `{key: "kryton_..."}` ONCE.
5. Persist the API key into the state file (`~/.config/kryton-init/state.json`) with `chmod 0600`.
6. On `uninstall`, also `DELETE /api/api-keys/<id>` so the orphaned key is revoked.

### Supported hosts (v1)

Same list as novamem-init. The file-merge logic is host-specific; the actual surface choice (stdio vs HTTP) is per `tools.ts`:

| Host | Config path | Format | Transport (Kryton wires) |
|---|---|---|---|
| Claude Code | `~/.claude.json` and per-project `.claude/settings.json` | JSON | HTTP if supported, stdio fallback |
| Cursor | `~/.cursor/mcp.json` (global), `.cursor/mcp.json` (project) | JSON | HTTP if supported, stdio fallback |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS); `~/.config/Claude/claude_desktop_config.json` (linux) | JSON | stdio |
| Codex | `~/.codex/config.toml` | TOML | HTTP if supported, stdio fallback |
| OpenCode | `~/.config/opencode/config.json` | JSON | stdio |
| Cline (VS Code) | `~/.vscode/extensions/saoudrizwan.claude-dev-*/settings/cline_mcp_settings.json` (path resolved at detect time) | JSON | stdio |
| Continue | `~/.continue/config.yaml` | YAML | stdio |
| KiloCode | `~/.config/kilocode/mcp.json` | JSON | stdio |
| RooCode | `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json` (or VS-Code-equivalent on linux) | JSON | stdio |

### Idempotency + safety

- Every write goes through `file-ops.ts` which:
  1. Reads existing content.
  2. Backs up to `<path>.kryton-init.bak.<timestamp>` (only the most recent backup is kept).
  3. Parses to in-memory AST.
  4. Removes any prior `kryton` entry (case-insensitive key match).
  5. Inserts the new entry.
  6. Atomic write via tmp-file + rename.
- `state.json` records which paths were touched and their pre-write hash, so `uninstall` can detect "user-edited since" and refuse to clobber.
- All file writes go through `npm pack`-style dry-run mode (`--dry-run` flag).

### Distribution

- Both packages published to npm under `@azrtydxb/` org (matching the novamem packages).
- Versioned together; both 0.1.0 for v1.
- Repo: `azrtydxb/kryton-cli` (NEW separate repo — keeps Kryton-server's release cadence independent from CLI's).
- CI: standard npm publish workflow on tag push.

### Why a separate repo

- Kryton-server releases on its own cadence (chart + server + operator); CLI breaks should never block a server release and vice versa.
- The shim package depends only on `@modelcontextprotocol/sdk` — pulling it from the kryton monorepo would force a Kryton checkout for every shim install.
- Same model as novamem (separate `azrtydxb/novamem-init` could exist; novamem currently keeps init inside the monorepo because the server-side is heavily tied; Kryton's case is cleaner).

Actually — re-reading the novamem layout, novamem keeps both `packages/mcp` and `packages/init` INSIDE its monorepo. For consistency + faster iteration we'll do the same: `packages/kryton-mcp` + `packages/kryton-init` inside `azrtydxb/kryton`, both published independently to npm.

So the working location is **`/Users/pascal/Development/Kryton/kryton/packages/kryton-mcp/`** and **`/packages/kryton-init/`**.

## Non-design alternatives considered

- **Single combined package** (init + shim merged). Rejected: the shim runs as a long-lived stdio process spawned by AI tools; the init is a one-shot CLI. Distinct lifecycles, distinct bundle sizes, distinct concerns.
- **Ship only the installer; rely on `mcp-remote` from upstream**. `mcp-remote` is a generic remote-MCP shim from the MCP SDK ecosystem. It works, but lacks Kryton-specific affordances (session-token refresh on 401, server-version reporting, friendly error messages naming Kryton). The 150-LOC shim is worth the control.
- **Generate the per-host configs from a single template**. Each host's config file has different shape (JSON vs TOML vs YAML, nested differently). A template adds more complexity than it saves; one file per host is the clearer pattern (novamem-init does this).

## Acceptance

Demo: on a freshly-cloned dev box with Claude Code + Cursor + Claude Desktop installed,
1. `npx @azrtydxb/kryton-init` walks me through.
2. Each of the 3 hosts opens with Kryton tools available in its tool list.
3. `uninstall` removes Kryton entries from all 3, leaving other MCP entries intact.
4. `--dry-run` writes nothing but prints the same plan.
