# Kryton CLI — Implementation Plan

**Reference:** [docs/superpowers/specs/2026-05-18-krytonctl-design.md](../specs/2026-05-18-krytonctl-design.md)
**Convention:** TypeScript strict, ESM. PSR-12-equivalent style. Conventional commits. NO Co-Authored-By trailers. Single delivery, three parallel workstreams.

## Locations

- `packages/kryton-mcp/` (new) — stdio shim
- `packages/kryton-init/` (new) — installer
- Both included in the existing root `package.json` workspaces

## Frozen contracts

```ts
// kryton-mcp — published surface
// bin: kryton-mcp
// Env consumed:
//   KRYTON_URL          (default https://kryton.ai)
//   KRYTON_TOKEN        (required; raw bearer with kryton_ prefix)
//   KRYTON_DEBUG=1      (verbose stderr logging)
// stdin/stdout: MCP stdio JSON-RPC, transparent proxy to <URL>/api/mcp

// kryton-init — published surface
// bin: kryton-init
// Commands:
//   kryton-init install [--server <url>] [--dry-run] [--hosts <list>]
//   kryton-init uninstall [--dry-run] [--hosts <list>]
//   kryton-init status
//   kryton-init detect
//   kryton-init mcp [--host <name>]    // print snippet, no write

// Both packages publish independently to npm:
//   @azrtydxb/kryton-mcp@0.1.0
//   @azrtydxb/kryton-init@0.1.0
```

State file at `~/.config/kryton-init/state.json`:

```json
{
  "version": 1,
  "server": "https://kryton.ai",
  "apiKeyId": "ak_xxxx",
  "apiKeyPrefix": "kryton_a1b2c3d4",
  "wiredHosts": [
    { "name": "claude-code", "path": "/Users/u/.claude.json", "transport": "http", "preHash": "sha256:..." },
    { "name": "claude-desktop", "path": "/Users/u/Library/Application Support/Claude/claude_desktop_config.json", "transport": "stdio", "preHash": "sha256:..." }
  ],
  "installedAt": "2026-05-18T17:30:00Z"
}
```

## Workstreams

### WS-M — `@azrtydxb/kryton-mcp` (stdio shim)

**Owns:** `packages/kryton-mcp/**`

**Deps:** `@modelcontextprotocol/sdk` (already a workspace dep). No others.

**Tasks:**
- M-1: `package.json` — name `@azrtydxb/kryton-mcp`, type "module", bin entry, ESM build via `tsc`, `"files": ["dist"]`, sideEffects false.
- M-2: `src/bin.ts` — env-validation + invoke `src/index.ts`'s `main()`. Strict: if `KRYTON_TOKEN` unset, exit(1) with friendly stderr.
- M-3: `src/index.ts` — `Server` from `@modelcontextprotocol/sdk/server/index.js` with `StdioServerTransport`. For every JSON-RPC method, forward to `<URL>/api/mcp` over HTTPS with bearer header.
- M-4: Session lifecycle — capture `mcp-session-id` response header on first request; replay on subsequent requests. On 404 (session lost), open a new one transparently.
- M-5: Server→client notifications channel — `GET <URL>/api/mcp` with `mcp-session-id`, parse SSE events, emit into stdio. Reconnect with exponential backoff on disconnect.
- M-6: Logging — `KRYTON_DEBUG=1` enables structured stderr lines `[kryton-mcp] level=… msg=… …`. Otherwise silent.
- M-7: Tests — node:test (zero deps): spin up an httptest server in-process, exercise initialize → tools/list → tool call round-trip; session-recover on 404; broken upstream returns clean stderr error.

### WS-I — `@azrtydxb/kryton-init` (installer)

**Owns:** `packages/kryton-init/**`

**Deps:** `@inquirer/prompts`, `commander`, `smol-toml`, `yaml`, `tar` if needed. Mirror novamem-init deps where possible.

**Tasks:**
- I-1: `package.json` — name, bin entry, ESM, build to `dist/`.
- I-2: `src/main.ts` — Commander setup, install as default action.
- I-3: `src/auth.ts` — `signIn(server, email, password)` returns `{sessionToken, user}`; `mintApiKey(server, sessionToken, name)` returns `{id, key}`. Uses fetch (Node 20+ native).
- I-4: `src/tools.ts` — Per-host metadata table:
  ```ts
  type HostMeta = {
    name: string;
    displayName: string;
    configPath: () => string | null;  // null if not installed
    format: "json" | "toml" | "yaml";
    supportsHttp: boolean;
    supportsStdio: boolean;
    rootKey: string;  // e.g. "mcpServers"
  };
  ```
  Entries for all 9 hosts from the design doc.
- I-5: `src/detect.ts` — `detectHosts()` returns the subset where `configPath()` resolves to an existing file (or expected dir).
- I-6: `src/install/<host>.ts` — One file per host. Each exports `install(meta, entry, ctx): Promise<{written, pre, post}>` and `uninstall(meta, ctx): Promise<{written, pre, post}>`. Reuses `merge.ts` + `file-ops.ts`.
- I-7: `src/merge.ts` — JSON/TOML/YAML round-trippable parse/edit/serialize. Preserves comments/formatting where possible (smol-toml gives this; yaml lib too; JSON loses comments — acceptable).
- I-8: `src/file-ops.ts` — `atomicWrite(path, content)`, `backup(path)`, `hash(path)`.
- I-9: `src/mcp.ts` — Render both transport variants given `{server, token, packageName}`.
- I-10: `src/state.ts` — Load/save state file. Detect "user edited since" via pre-hash comparison.
- I-11: `src/commands.ts` — Wire each command. `install` flow:
  1. Read prior state. If present + user wants to keep, skip auth.
  2. Otherwise prompt server URL.
  3. Prompt email + password.
  4. `signIn` + `mintApiKey`.
  5. `detectHosts` → confirm selection.
  6. Per host: pick transport (HTTP if supported, else stdio), call install(...).
  7. Persist state.
  8. Print summary.
- I-12: Tests — node:test. Per-host install/uninstall round-trip on tmp dirs. Hash-mismatch refuses overwrite.

### WS-R — Release plumbing

**Owns:**
- Root `package.json` workspaces include `packages/kryton-mcp` + `packages/kryton-init`.
- `.github/workflows/cli-publish.yml` — new workflow, triggers on tag `cli-v*`, publishes both packages to npm.
- `docs/CLI.md` — user-facing README excerpt: `npx @azrtydxb/kryton-init` quick start.

**Tasks:**
- R-1: Add `packages/kryton-mcp` + `packages/kryton-init` to root workspaces.
- R-2: New release workflow gated on `cli-v*` tags. Uses NPM_TOKEN secret. Runs both packages' tests + builds before publishing.
- R-3: `docs/CLI.md` — user-facing usage doc.
- R-4: CHANGELOG entry under server's existing CHANGELOG noting the CLI packages exist (cross-link).

## Integration points

- WS-I depends on WS-M's `kryton-mcp` package name + bin. Frozen in the contract above.
- WS-R depends on both having a `package.json` ready to publish; otherwise independent.

## Acceptance

- [ ] `npx @azrtydxb/kryton-init` walks through sign-in + key mint + host detection + writes for 3 detected hosts (Claude Code, Cursor, Claude Desktop) on a real dev box.
- [ ] After installation, those 3 hosts show Kryton tools in their tool list.
- [ ] `kryton-init uninstall` removes Kryton entries from all 3 + revokes the API key on the server.
- [ ] `kryton-init --dry-run` writes nothing.
- [ ] `pnpm test` (or `npm test`) on the monorepo passes (existing tests + new CLI tests).
- [ ] `cli-v0.1.0` tag publishes both packages to npm.
