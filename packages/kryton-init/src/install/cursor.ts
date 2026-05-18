/**
 * Host wrapper — see `generic.ts` for the shared engine. Per-file
 * split lets future host-specific quirks land in isolation.
 */

import { findHost } from "../tools.js";
import {
  installHost,
  uninstallHost,
  type InstallCtx,
  type InstallResult,
  type UninstallCtx,
  type UninstallResult,
} from "./generic.js";

const HOST_NAME = "cursor";

function getHost() {
  const h = findHost(HOST_NAME);
  if (!h) throw new Error(`HostMeta missing for ${HOST_NAME}`);
  return h;
}

export async function install(ctx: InstallCtx): Promise<InstallResult> {
  return installHost(getHost(), ctx);
}

export async function uninstall(ctx: UninstallCtx): Promise<UninstallResult> {
  return uninstallHost(getHost(), ctx);
}
