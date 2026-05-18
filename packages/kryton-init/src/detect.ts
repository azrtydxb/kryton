/**
 * Host detection — probe each known host's expected config path and
 * declare it "installed" if the file (or its parent directory in some
 * cases) is present.
 *
 * Heuristic: we look for either the resolved configPath itself, or its
 * parent directory. That catches hosts where the user has launched the
 * app at least once (creating the dir) but hasn't generated a config
 * file yet.
 */

import { dirname } from "node:path";
import { exists } from "./file-ops.js";
import { HOSTS, defaultContext, type HostContext, type HostMeta } from "./tools.js";

export interface DetectionResult {
  host: HostMeta;
  /** Resolved config path, or null if we can't determine it for this host. */
  configPath: string | null;
  /** True if the file itself exists. */
  fileExists: boolean;
  /** True if the parent directory exists (looser signal of "installed"). */
  dirExists: boolean;
}

export async function detectOne(host: HostMeta, ctx: HostContext = defaultContext()): Promise<DetectionResult> {
  const configPath = host.configPath(ctx);
  if (!configPath) {
    return { host, configPath: null, fileExists: false, dirExists: false };
  }
  const fileExists = await exists(configPath);
  const dirExists = fileExists ? true : await exists(dirname(configPath));
  return { host, configPath, fileExists, dirExists };
}

/** Detect every known host. Returns ALL hosts with status flags. */
export async function detectAll(ctx: HostContext = defaultContext()): Promise<DetectionResult[]> {
  const out: DetectionResult[] = [];
  for (const host of HOSTS) {
    out.push(await detectOne(host, ctx));
  }
  return out;
}

/** Returns the subset of hosts that look installed (file or dir present). */
export async function detectInstalled(ctx: HostContext = defaultContext()): Promise<DetectionResult[]> {
  const all = await detectAll(ctx);
  return all.filter((r) => r.fileExists || r.dirExists);
}
