/**
 * Aggregator for the per-host install/uninstall modules.
 *
 * Every per-host file in this directory exports `install(...)` and
 * `uninstall(...)`. They all share the generic engine in `generic.ts`;
 * the per-file split exists so adding host-specific quirks later
 * touches one file at a time.
 */

import { findHost } from "../tools.js";
import { pickTransport } from "../tools.js";
import type { InstallCtx, InstallResult, UninstallCtx, UninstallResult } from "./generic.js";
import { installHost, uninstallHost } from "./generic.js";

import * as claudeCode from "./claude-code.js";
import * as cursor from "./cursor.js";
import * as claudeDesktop from "./claude-desktop.js";
import * as codex from "./codex.js";
import * as opencode from "./opencode.js";
import * as cline from "./cline.js";
import * as continueHost from "./continue.js";
import * as kilocode from "./kilocode.js";
import * as roocode from "./roocode.js";

export const HOST_MODULES: Record<
  string,
  {
    install: (ctx: InstallCtx) => Promise<InstallResult>;
    uninstall: (ctx: UninstallCtx) => Promise<UninstallResult>;
  }
> = {
  "claude-code": claudeCode,
  cursor,
  "claude-desktop": claudeDesktop,
  codex,
  opencode,
  cline,
  continue: continueHost,
  kilocode,
  roocode,
};

/** Dispatch install for a host by name. Throws if no module is registered. */
export async function dispatchInstall(name: string, ctx: InstallCtx): Promise<InstallResult> {
  const mod = HOST_MODULES[name];
  if (!mod) {
    const host = findHost(name);
    if (!host) throw new Error(`unknown host: ${name}`);
    // Fallback to the generic engine if the per-host module is missing.
    return installHost(host, ctx);
  }
  return mod.install(ctx);
}

export async function dispatchUninstall(name: string, ctx: UninstallCtx): Promise<UninstallResult> {
  const mod = HOST_MODULES[name];
  if (!mod) {
    const host = findHost(name);
    if (!host) throw new Error(`unknown host: ${name}`);
    return uninstallHost(host, ctx);
  }
  return mod.uninstall(ctx);
}

export { pickTransport };
export type { InstallCtx, InstallResult, UninstallCtx, UninstallResult };
