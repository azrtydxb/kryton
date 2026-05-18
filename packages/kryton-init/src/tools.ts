/**
 * Per-host metadata for every AI agent we know how to wire Kryton into.
 *
 * The HostMeta surface is intentionally narrow:
 *   - configPath(ctx) returns the resolved absolute config path (or null
 *     if we can't determine it — e.g. Cline's path depends on a
 *     glob-resolvable VS Code extension dir that may not exist).
 *   - format chooses the parser/serialiser in merge.ts
 *   - supportsHttp/supportsStdio describe what the host can speak; the
 *     installer prefers HTTP when both flags are true, else stdio
 *   - rootKey is the top-level map where the per-host installer drops
 *     the "kryton" entry (e.g. `mcpServers`, `mcp_servers`, `mcpServers`)
 */

import { homedir, platform } from "node:os";
import { join } from "node:path";
import { readdirSync, existsSync } from "node:fs";
import type { ConfigFormat } from "./merge.js";

export interface HostContext {
  /** Override $HOME — used for tests against tmp dirs. */
  home: string;
  /** Override platform — used for tests. */
  platform: NodeJS.Platform;
}

export function defaultContext(): HostContext {
  return { home: homedir(), platform: platform() };
}

export type Transport = "http" | "stdio";

export interface HostMeta {
  name: string;
  displayName: string;
  /** Resolve the config path. Returns null if not determinable. */
  configPath: (ctx: HostContext) => string | null;
  format: ConfigFormat;
  supportsHttp: boolean;
  supportsStdio: boolean;
  /** Top-level key holding the server map (default "mcpServers"). */
  rootKey: string;
  /** Stdio env-key the host expects. Defaults to "env"; OpenCode uses "environment". */
  stdioEnvKey?: "env" | "environment";
  /** Some hosts disambiguate stdio entries with a `type: "local"` field. */
  stdioTypeField?: string;
  /** One-line note to print in install summary. */
  postInstallHint?: string;
}

// ─── Path helpers ─────────────────────────────────────────────────────

function macConfig(ctx: HostContext, ...parts: string[]): string {
  return join(ctx.home, "Library", "Application Support", ...parts);
}

function xdgConfig(ctx: HostContext, ...parts: string[]): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg && xdg.length > 0
    ? join(xdg, ...parts)
    : join(ctx.home, ".config", ...parts);
}

/**
 * Resolve a glob like `~/.vscode/extensions/saoudrizwan.claude-dev-*` by
 * picking the lexicographically-latest matching directory. Returns null
 * if no match.
 */
function resolveVscodeExtensionDir(ctx: HostContext, glob: string): string | null {
  // glob is anchored under ~/.vscode/extensions, expecting `<prefix>-*`.
  const base = join(ctx.home, ".vscode", "extensions");
  if (!existsSync(base)) return null;
  const prefix = glob.replace(/\*$/, "");
  let candidates: string[];
  try {
    candidates = readdirSync(base).filter((e) => e.startsWith(prefix));
  } catch {
    return null;
  }
  if (candidates.length === 0) return null;
  candidates.sort();
  return join(base, candidates[candidates.length - 1]!);
}

// ─── Hosts ────────────────────────────────────────────────────────────

export const HOSTS: readonly HostMeta[] = [
  {
    name: "claude-code",
    displayName: "Claude Code",
    configPath: (ctx) => join(ctx.home, ".claude.json"),
    format: "json",
    supportsHttp: true,
    supportsStdio: true,
    rootKey: "mcpServers",
    postInstallHint: "Restart Claude Code to pick up the new MCP server.",
  },
  {
    name: "cursor",
    displayName: "Cursor",
    configPath: (ctx) => join(ctx.home, ".cursor", "mcp.json"),
    format: "json",
    supportsHttp: true,
    supportsStdio: true,
    rootKey: "mcpServers",
    postInstallHint: "Open Cursor → Settings → MCP and toggle 'kryton' on if it isn't already.",
  },
  {
    name: "claude-desktop",
    displayName: "Claude Desktop",
    configPath: (ctx) => {
      if (ctx.platform === "darwin") {
        return macConfig(ctx, "Claude", "claude_desktop_config.json");
      }
      // linux
      return xdgConfig(ctx, "Claude", "claude_desktop_config.json");
    },
    format: "json",
    supportsHttp: false,
    supportsStdio: true,
    rootKey: "mcpServers",
    postInstallHint: "Quit Claude Desktop fully (Cmd-Q on macOS) and reopen — it doesn't hot-reload MCP config.",
  },
  {
    name: "codex",
    displayName: "OpenAI Codex CLI",
    configPath: (ctx) => join(ctx.home, ".codex", "config.toml"),
    format: "toml",
    // Codex's MCP client speaks Streamable-HTTP. Route via stdio shim
    // anyway for now (matches novamem-init behaviour) so the version
    // pin gives us a kill switch if upstream changes.
    supportsHttp: false,
    supportsStdio: true,
    rootKey: "mcp_servers",
  },
  {
    name: "opencode",
    displayName: "OpenCode",
    configPath: (ctx) => xdgConfig(ctx, "opencode", "config.json"),
    format: "json",
    supportsHttp: false,
    supportsStdio: true,
    rootKey: "mcp",
    stdioEnvKey: "environment",
    stdioTypeField: "local",
  },
  {
    name: "cline",
    displayName: "Cline (VS Code)",
    configPath: (ctx) => {
      const ext = resolveVscodeExtensionDir(ctx, "saoudrizwan.claude-dev-*");
      if (!ext) return null;
      return join(ext, "settings", "cline_mcp_settings.json");
    },
    format: "json",
    supportsHttp: false,
    supportsStdio: true,
    rootKey: "mcpServers",
  },
  {
    name: "continue",
    displayName: "Continue",
    configPath: (ctx) => join(ctx.home, ".continue", "config.yaml"),
    format: "yaml",
    supportsHttp: false,
    supportsStdio: true,
    // Continue's YAML keeps MCP servers under `mcpServers`.
    rootKey: "mcpServers",
  },
  {
    name: "kilocode",
    displayName: "KiloCode",
    configPath: (ctx) => xdgConfig(ctx, "kilocode", "mcp.json"),
    format: "json",
    supportsHttp: false,
    supportsStdio: true,
    rootKey: "mcpServers",
  },
  {
    name: "roocode",
    displayName: "RooCode",
    configPath: (ctx) => {
      if (ctx.platform === "darwin") {
        return macConfig(
          ctx,
          "Code",
          "User",
          "globalStorage",
          "rooveterinaryinc.roo-cline",
          "settings",
          "cline_mcp_settings.json",
        );
      }
      // linux: VS Code user dir under ~/.config/Code
      return xdgConfig(
        ctx,
        "Code",
        "User",
        "globalStorage",
        "rooveterinaryinc.roo-cline",
        "settings",
        "cline_mcp_settings.json",
      );
    },
    format: "json",
    supportsHttp: false,
    supportsStdio: true,
    rootKey: "mcpServers",
  },
];

export function findHost(name: string): HostMeta | undefined {
  return HOSTS.find((h) => h.name === name);
}

/**
 * Pick the transport for a host: HTTP when supported, else stdio.
 * Throws if a host claims to support neither (caller's bug).
 */
export function pickTransport(host: HostMeta): Transport {
  if (host.supportsHttp) return "http";
  if (host.supportsStdio) return "stdio";
  throw new Error(`host ${host.name} supports neither transport`);
}
