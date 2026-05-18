/**
 * Persistent state for the init CLI, stored at
 *   $XDG_CONFIG_HOME/kryton-init/state.json   (default ~/.config/kryton-init/state.json)
 *
 * Shape — frozen per the plan:
 *   { version, server, apiKeyId, apiKeyPrefix, wiredHosts[], installedAt }
 *
 * The full plaintext `kryton_…` API key is also persisted (chmod 0600)
 * so subsequent runs can re-use it without forcing a fresh mint. Old
 * state must roundtrip cleanly when fields are missing.
 */

import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const STATE_VERSION = 1;

export type WiredTransport = "http" | "stdio";

export interface WiredHost {
  name: string;
  path: string;
  transport: WiredTransport;
  /** sha256:<hex> of the file at write time. */
  preHash: string;
}

export interface InitState {
  version: number;
  server: string;
  apiKeyId: string;
  apiKeyPrefix: string;
  /** Plaintext bearer, persisted so re-runs don't re-mint. chmod 0600. */
  apiKey?: string;
  wiredHosts: WiredHost[];
  installedAt: string;
  /** Cached session cookie from sign-in. NOT persisted by default —
   *  callers may pass it in-memory for the same run. */
}

export function statePath(home: string = homedir()): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(home, ".config");
  return join(base, "kryton-init", "state.json");
}

/** Load state from disk. Returns null if missing / unreadable / invalid. */
export function loadState(home?: string): InitState | null {
  try {
    const raw = readFileSync(statePath(home), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.server !== "string" || typeof o.apiKeyId !== "string") return null;
    const wiredHostsRaw = Array.isArray(o.wiredHosts) ? o.wiredHosts : [];
    const wiredHosts: WiredHost[] = [];
    for (const h of wiredHostsRaw) {
      if (!h || typeof h !== "object") continue;
      const obj = h as Record<string, unknown>;
      if (
        typeof obj.name !== "string" ||
        typeof obj.path !== "string" ||
        (obj.transport !== "http" && obj.transport !== "stdio") ||
        typeof obj.preHash !== "string"
      ) {
        continue;
      }
      wiredHosts.push({
        name: obj.name,
        path: obj.path,
        transport: obj.transport,
        preHash: obj.preHash,
      });
    }
    return {
      version: typeof o.version === "number" ? o.version : STATE_VERSION,
      server: o.server,
      apiKeyId: o.apiKeyId,
      apiKeyPrefix: typeof o.apiKeyPrefix === "string" ? o.apiKeyPrefix : "",
      apiKey: typeof o.apiKey === "string" ? o.apiKey : undefined,
      wiredHosts,
      installedAt: typeof o.installedAt === "string" ? o.installedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Save state to disk. Creates parent dirs. Chmod 0600 to protect the key. */
export function saveState(state: InitState, home?: string): string {
  const path = statePath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  // Re-chmod in case the file already existed with looser perms.
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best-effort */
  }
  return path;
}
