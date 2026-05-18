/**
 * Command implementations: install / uninstall / status / detect / mcp.
 *
 * The CLI shell in `main.ts` parses argv and calls into here. Each
 * command function returns a numeric exit code; nothing in here calls
 * `process.exit` directly so tests can drive the flow.
 */

import { hostname } from "node:os";
import { input, password as passwordPrompt, checkbox, confirm } from "@inquirer/prompts";
import {
  AuthError,
  mintApiKey,
  probeHealth,
  revokeApiKey,
  signIn,
  trimTrailingSlash,
} from "./auth.js";
import { detectAll, detectInstalled } from "./detect.js";
import {
  dispatchInstall,
  dispatchUninstall,
  pickTransport,
  type InstallResult,
  type UninstallResult,
} from "./install/index.js";
import { buildEntry, SERVER_KEY } from "./mcp.js";
import { loadState, saveState, STATE_VERSION, type InitState, type WiredHost } from "./state.js";
import { defaultContext, findHost, HOSTS } from "./tools.js";

export interface SharedOpts {
  server?: string;
  hosts?: string;
  dryRun?: boolean;
  yes?: boolean;
  host?: string;
}

const DEFAULT_SERVER = "https://kryton.ai";

function parseHostFilter(list: string | undefined): string[] | null {
  if (!list) return null;
  return list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ─── install ─────────────────────────────────────────────────────── */

export async function cmdInstall(opts: SharedOpts): Promise<number> {
  try {
    const prior = loadState();
    const server = await resolveServer(opts, prior?.server);
    await probeHealth({ server });
    console.log(`Server reachable: ${server}`);

    // Decide whether to reuse the prior key or mint a fresh one.
    const { apiKeyId, apiKey, apiKeyPrefix } = await resolveApiKey(server, prior, opts.yes ?? false);

    // Detect → choose hosts.
    const detected = await detectInstalled(defaultContext());
    const filter = parseHostFilter(opts.hosts);
    const candidates = filter
      ? detected.filter((d) => filter.includes(d.host.name))
      : detected;

    if (candidates.length === 0) {
      console.error("No detected hosts to configure. Pass --hosts <list> to force.");
      return 1;
    }

    const chosen = await chooseHosts(candidates.map((c) => c.host.name), opts.yes ?? false);
    if (chosen.length === 0) {
      console.log("No hosts selected.");
      return 1;
    }

    // Wire each chosen host.
    const wired: WiredHost[] = [];
    const results: InstallResult[] = [];
    for (const name of chosen) {
      const det = candidates.find((c) => c.host.name === name);
      if (!det || !det.configPath) {
        console.error(`Skipping ${name}: cannot resolve config path.`);
        continue;
      }
      const host = det.host;
      const transport = pickTransport(host);
      const result = await dispatchInstall(name, {
        configPath: det.configPath,
        transport,
        entryParams: { server, token: apiKey },
        dryRun: opts.dryRun,
      });
      results.push(result);
      if (result.written || result.dryRun || result.alreadyInSync) {
        wired.push({
          name,
          path: det.configPath,
          transport,
          preHash: result.postHash ?? result.preHash ?? "sha256:unknown",
        });
      }
    }

    printInstallSummary(results);

    if (!opts.dryRun) {
      const next: InitState = {
        version: STATE_VERSION,
        server,
        apiKeyId,
        apiKeyPrefix,
        apiKey,
        wiredHosts: wired,
        installedAt: new Date().toISOString(),
      };
      const path = saveState(next);
      console.log(`State saved → ${path}`);
    } else {
      console.log("Dry run — no files were written and state was not updated.");
    }
    return 0;
  } catch (e) {
    if (e instanceof AuthError) {
      console.error(`${e.message}`);
      return 1;
    }
    if (e instanceof Error && (e as { name?: string }).name === "ExitPromptError") {
      console.log("\nAborted.");
      return 130;
    }
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

async function resolveServer(opts: SharedOpts, last?: string): Promise<string> {
  if (opts.server) return trimTrailingSlash(opts.server);
  if (opts.yes) return trimTrailingSlash(last ?? DEFAULT_SERVER);
  const ans = await input({
    message: "Kryton server URL",
    default: last ?? DEFAULT_SERVER,
    validate: (v) => /^https?:\/\//.test(v) || "must start with http:// or https://",
  });
  return trimTrailingSlash(ans);
}

async function resolveApiKey(
  server: string,
  prior: InitState | null,
  yes: boolean,
): Promise<{ apiKeyId: string; apiKey: string; apiKeyPrefix: string }> {
  // Reuse path: we have a prior key, same server, and the user wants it.
  if (prior && prior.server === server && prior.apiKey) {
    const reuse = yes
      ? true
      : await confirm({
          message: `Reuse existing API key (${prior.apiKeyPrefix}…)?`,
          default: true,
        });
    if (reuse) {
      return { apiKeyId: prior.apiKeyId, apiKey: prior.apiKey, apiKeyPrefix: prior.apiKeyPrefix };
    }
  }

  // Mint flow.
  const email = await input({
    message: "Email",
    validate: (v) => v.includes("@") || "must be an email address",
  });
  const password = await passwordPrompt({ message: "Password", mask: "*" });
  console.log("Signing in...");
  const cookie = await signIn({ server, email, password });
  console.log("Signed in. Minting an API key...");
  const name = `kryton-init-${hostname()}-${new Date().toISOString()}`;
  const minted = await mintApiKey({ server, sessionCookie: cookie, name });
  console.log(`Minted API key: ${minted.prefix}… (id ${minted.id})`);
  return { apiKeyId: minted.id, apiKey: minted.key, apiKeyPrefix: minted.prefix };
}

async function chooseHosts(candidates: string[], yes: boolean): Promise<string[]> {
  if (yes) return candidates;
  return checkbox({
    message: "Wire which hosts?",
    choices: candidates.map((name) => {
      const h = findHost(name);
      return {
        name: h ? `${h.displayName} (${name})` : name,
        value: name,
        checked: true,
      };
    }),
    pageSize: 20,
  });
}

function printInstallSummary(results: InstallResult[]): void {
  console.log("");
  for (const r of results) {
    const tag = r.dryRun
      ? "(dry-run)"
      : r.written
        ? "wrote"
        : r.alreadyInSync
          ? "already in sync"
          : "no-op";
    console.log(`  ${r.host}: ${tag} → ${r.path} [${r.transport}]`);
    if (r.backupPath) console.log(`    backup → ${r.backupPath}`);
  }
  console.log("");
}

/* ─── uninstall ───────────────────────────────────────────────────── */

export async function cmdUninstall(opts: SharedOpts): Promise<number> {
  const prior = loadState();
  if (!prior) {
    console.error("No state file found — nothing to uninstall.");
    return 1;
  }
  const filter = parseHostFilter(opts.hosts);
  const targets = filter
    ? prior.wiredHosts.filter((h) => filter.includes(h.name))
    : prior.wiredHosts;

  if (targets.length === 0) {
    console.log("No wired hosts to uninstall.");
    return 0;
  }

  const results: UninstallResult[] = [];
  for (const wired of targets) {
    const result = await dispatchUninstall(wired.name, {
      configPath: wired.path,
      expectedHash: wired.preHash,
      dryRun: opts.dryRun,
      force: opts.yes,
    });
    results.push(result);
  }

  printUninstallSummary(results);

  // Revoke the API key on the server if we have a session.
  if (!opts.dryRun) {
    // We need a fresh sign-in to revoke; for now we attempt without
    // forcing one and surface the result. Users can re-run sign-in to
    // revoke explicitly.
    console.log(`API key ${prior.apiKeyPrefix}… (${prior.apiKeyId}) was NOT revoked on the server.`);
    console.log("Re-run `kryton-init install` to mint a new key, or call DELETE /api/api-keys manually.");
  }

  // Keep state but clear the wired hosts that we successfully unwired.
  if (!opts.dryRun) {
    const removed = new Set(results.filter((r) => r.written || r.notPresent).map((r) => r.host));
    const remaining = prior.wiredHosts.filter((h) => !removed.has(h.name));
    if (remaining.length === 0) {
      console.log("All hosts unwired. State file retained for the API-key record.");
    }
    saveState({ ...prior, wiredHosts: remaining });
  }
  return 0;
}

function printUninstallSummary(results: UninstallResult[]): void {
  console.log("");
  for (const r of results) {
    let tag: string;
    if (r.dryRun) tag = "(dry-run)";
    else if (r.refusedUserEdited) tag = "REFUSED (user-edited since install)";
    else if (r.written) tag = "removed";
    else if (r.notPresent) tag = "not present";
    else tag = "no-op";
    console.log(`  ${r.host}: ${tag} → ${r.path}`);
    if (r.backupPath) console.log(`    backup → ${r.backupPath}`);
  }
  console.log("");
}

/* ─── revoke (helper used by uninstall when --yes + auth available) ── */

export async function revokeOnServer(
  server: string,
  email: string,
  password: string,
  apiKeyId: string,
): Promise<void> {
  const cookie = await signIn({ server, email, password });
  await revokeApiKey({ server, sessionCookie: cookie, apiKeyId });
}

/* ─── status ──────────────────────────────────────────────────────── */

export function cmdStatus(): number {
  const state = loadState();
  if (!state) {
    console.log("No state file. Run `kryton-init install` first.");
    return 0;
  }
  console.log(`Server:        ${state.server}`);
  console.log(`API key:       ${state.apiKeyPrefix}… (id ${state.apiKeyId})`);
  console.log(`Installed at:  ${state.installedAt}`);
  console.log(`Wired hosts:   ${state.wiredHosts.length}`);
  for (const h of state.wiredHosts) {
    console.log(`  - ${h.name} [${h.transport}] → ${h.path}`);
  }
  return 0;
}

/* ─── detect ──────────────────────────────────────────────────────── */

export async function cmdDetect(): Promise<number> {
  const all = await detectAll(defaultContext());
  for (const d of all) {
    const status = d.fileExists ? "file" : d.dirExists ? "dir" : "absent";
    console.log(`  ${d.host.name.padEnd(16)} ${status.padEnd(8)} ${d.configPath ?? "(unresolved)"}`);
  }
  return 0;
}

/* ─── mcp (print snippet) ─────────────────────────────────────────── */

export function cmdMcpSnippet(opts: SharedOpts): number {
  const state = loadState();
  if (!state) {
    console.error("No state file. Run `kryton-init install` first to know which server/token to print.");
    return 1;
  }
  const hostName = opts.host;
  const transport = hostName
    ? (() => {
        const h = findHost(hostName);
        if (!h) {
          console.error(`Unknown host: ${hostName}`);
          return null;
        }
        return pickTransport(h);
      })()
    : "http";
  if (transport === null) return 1;

  // Show both shapes by default; one shape when --host is given.
  if (!hostName) {
    const http = { mcpServers: { [SERVER_KEY]: buildEntry("http", { server: state.server, token: state.apiKey ?? "<API-KEY>" }) } };
    const stdio = { mcpServers: { [SERVER_KEY]: buildEntry("stdio", { server: state.server, token: state.apiKey ?? "<API-KEY>" }) } };
    console.log("# HTTP shape\n");
    console.log(JSON.stringify(http, null, 2));
    console.log("\n# stdio shape\n");
    console.log(JSON.stringify(stdio, null, 2));
    return 0;
  }

  const h = findHost(hostName)!;
  const wrap = { [h.rootKey]: { [SERVER_KEY]: buildEntry(transport, { server: state.server, token: state.apiKey ?? "<API-KEY>" }, { envKey: h.stdioEnvKey, typeField: h.stdioTypeField }) } };
  console.log(JSON.stringify(wrap, null, 2));
  return 0;
}

/* ─── known hosts (for --help discovery) ──────────────────────────── */

export function knownHostNames(): string[] {
  return HOSTS.map((h) => h.name);
}
