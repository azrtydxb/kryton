/**
 * Generic install / uninstall engine. Every per-host module in this
 * directory is a thin wrapper around `installHost` / `uninstallHost`
 * that fills in the HostMeta. We keep them as separate files (one per
 * host) so adding host-specific quirks later is a one-file change with
 * no risk to its neighbours.
 *
 * Round-trip invariants:
 *   - parse with the host's format (json/toml/yaml)
 *   - deleteKeyCI on `kryton` so historical `Kryton` / `KRYTON` entries
 *     don't accumulate next to the new lower-case one
 *   - set `<rootKey>.kryton` to the new entry
 *   - serialise back, atomic-write, backup the original first
 */

import { atomicWrite, backup, hash, hashString, readFileMaybe } from "../file-ops.js";
import {
  deepGet,
  deepSet,
  deleteKeyCI,
  isPlainObject,
  parseLoose,
  stringify,
} from "../merge.js";
import { buildEntry, SERVER_KEY, type EntryParams, type Transport } from "../mcp.js";
import type { HostMeta } from "../tools.js";

export interface InstallResult {
  host: string;
  path: string;
  transport: Transport;
  /** True if anything was written. */
  written: boolean;
  /** True if the on-disk entry already matched the intended entry. */
  alreadyInSync: boolean;
  /** Pre-write file hash (sha256:<hex>) — null if file didn't exist. */
  preHash: string | null;
  /** Post-write file hash, or null on dry-run / no-op. */
  postHash: string | null;
  /** Path of the backup file we wrote, if any. */
  backupPath: string | null;
  /** True when --dry-run prevented any disk mutation. */
  dryRun: boolean;
}

export interface UninstallResult {
  host: string;
  path: string;
  /** True if anything was written. */
  written: boolean;
  /** True if there was no kryton entry to remove. */
  notPresent: boolean;
  /** True if we refused to write because the file changed since install. */
  refusedUserEdited: boolean;
  preHash: string | null;
  postHash: string | null;
  backupPath: string | null;
  dryRun: boolean;
}

export interface InstallCtx {
  configPath: string;
  transport: Transport;
  entryParams: EntryParams;
  dryRun?: boolean;
}

export async function installHost(host: HostMeta, ctx: InstallCtx): Promise<InstallResult> {
  const preHash = await hash(ctx.configPath);
  const raw = await readFileMaybe(ctx.configPath);
  const doc = parseLoose(raw, host.format);

  // Ensure root key exists.
  if (!isPlainObject(doc[host.rootKey])) {
    doc[host.rootKey] = {};
  }
  const root = doc[host.rootKey] as Record<string, unknown>;
  // Scrub any prior kryton entry (case-insensitive) so we don't end up
  // with parallel "Kryton" + "kryton" entries from old installs.
  deleteKeyCI(root, SERVER_KEY);

  const entry = buildEntry(ctx.transport, ctx.entryParams, {
    envKey: host.stdioEnvKey,
    typeField: host.stdioTypeField,
  });
  deepSet(doc, [host.rootKey, SERVER_KEY], entry);

  const serialized = stringify(doc, host.format);

  // Idempotency check: would the file content be identical?
  if (raw !== null && raw === serialized) {
    return {
      host: host.name,
      path: ctx.configPath,
      transport: ctx.transport,
      written: false,
      alreadyInSync: true,
      preHash,
      postHash: preHash,
      backupPath: null,
      dryRun: ctx.dryRun ?? false,
    };
  }

  // Idempotency check #2: equivalent entry already present, even if
  // surrounding formatting differs (whitespace, key order).
  const existing = deepGet(doc, [host.rootKey, SERVER_KEY]);
  const reparse = raw ? parseLoose(raw, host.format) : {};
  const priorEntry = deepGet(reparse, [host.rootKey, SERVER_KEY]);
  if (existing && priorEntry && JSON.stringify(existing) === JSON.stringify(priorEntry)) {
    // Entry is already in sync; serialised diff is whitespace-only.
    // Don't rewrite — preserve user's formatting.
    return {
      host: host.name,
      path: ctx.configPath,
      transport: ctx.transport,
      written: false,
      alreadyInSync: true,
      preHash,
      postHash: preHash,
      backupPath: null,
      dryRun: ctx.dryRun ?? false,
    };
  }

  if (ctx.dryRun) {
    return {
      host: host.name,
      path: ctx.configPath,
      transport: ctx.transport,
      written: false,
      alreadyInSync: false,
      preHash,
      postHash: null,
      backupPath: null,
      dryRun: true,
    };
  }

  const backupPath = await backup(ctx.configPath);
  await atomicWrite(ctx.configPath, serialized);
  const postHash = hashString(serialized);

  return {
    host: host.name,
    path: ctx.configPath,
    transport: ctx.transport,
    written: true,
    alreadyInSync: false,
    preHash,
    postHash,
    backupPath,
    dryRun: false,
  };
}

export interface UninstallCtx {
  configPath: string;
  /** sha256:<hex> recorded in state at install time; if the current
   *  hash differs we refuse unless `force` is set. */
  expectedHash?: string | null;
  force?: boolean;
  dryRun?: boolean;
}

export async function uninstallHost(host: HostMeta, ctx: UninstallCtx): Promise<UninstallResult> {
  const preHash = await hash(ctx.configPath);

  if (preHash === null) {
    // Nothing on disk — nothing to do.
    return {
      host: host.name,
      path: ctx.configPath,
      written: false,
      notPresent: true,
      refusedUserEdited: false,
      preHash: null,
      postHash: null,
      backupPath: null,
      dryRun: ctx.dryRun ?? false,
    };
  }

  if (!ctx.force && ctx.expectedHash && ctx.expectedHash !== preHash) {
    return {
      host: host.name,
      path: ctx.configPath,
      written: false,
      notPresent: false,
      refusedUserEdited: true,
      preHash,
      postHash: null,
      backupPath: null,
      dryRun: ctx.dryRun ?? false,
    };
  }

  const raw = await readFileMaybe(ctx.configPath);
  const doc = parseLoose(raw, host.format);
  const root = doc[host.rootKey];
  let removed = false;
  if (isPlainObject(root)) {
    removed = deleteKeyCI(root, SERVER_KEY);
  }

  if (!removed) {
    return {
      host: host.name,
      path: ctx.configPath,
      written: false,
      notPresent: true,
      refusedUserEdited: false,
      preHash,
      postHash: preHash,
      backupPath: null,
      dryRun: ctx.dryRun ?? false,
    };
  }

  if (ctx.dryRun) {
    return {
      host: host.name,
      path: ctx.configPath,
      written: false,
      notPresent: false,
      refusedUserEdited: false,
      preHash,
      postHash: null,
      backupPath: null,
      dryRun: true,
    };
  }

  const serialized = stringify(doc, host.format);
  const backupPath = await backup(ctx.configPath);
  await atomicWrite(ctx.configPath, serialized);
  const postHash = hashString(serialized);

  return {
    host: host.name,
    path: ctx.configPath,
    written: true,
    notPresent: false,
    refusedUserEdited: false,
    preHash,
    postHash,
    backupPath,
    dryRun: false,
  };
}
