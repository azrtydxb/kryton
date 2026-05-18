#!/usr/bin/env node
/**
 * @azrtydxb/kryton-init — interactive installer entrypoint.
 *
 * Commands:
 *   kryton-init install [--server <url>] [--hosts <list>] [--dry-run] [--yes]
 *   kryton-init uninstall [--hosts <list>] [--dry-run] [--yes]
 *   kryton-init status
 *   kryton-init detect
 *   kryton-init mcp [--host <name>]
 */

import { Command, Option } from "commander";
import { fileURLToPath } from "node:url";
import { realpathSync, readFileSync } from "node:fs";
import {
  cmdDetect,
  cmdInstall,
  cmdMcpSnippet,
  cmdStatus,
  cmdUninstall,
  knownHostNames,
} from "./commands.js";

function pkgVersion(): string {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    return (JSON.parse(readFileSync(pkgUrl, "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function runCli(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .name("kryton-init")
    .description("Sign in to a Kryton server, mint an API key, and wire every supported AI agent host (Claude Code, Cursor, Claude Desktop, Codex, OpenCode, Cline, Continue, KiloCode, RooCode).")
    .version(pkgVersion());

  const hostsList = knownHostNames().join(", ");

  program
    .command("install", { isDefault: true })
    .description("Interactive: sign in, mint key, wire detected hosts")
    .addOption(new Option("--server <url>", "Kryton server URL").env("KRYTON_SERVER"))
    .option("--hosts <list>", `comma-separated host filter; valid: ${hostsList}`)
    .option("--dry-run", "preview the plan without writing")
    .option("--yes, -y", "non-interactive: accept defaults")
    .action(async (opts) => {
      process.exitCode = await cmdInstall(opts);
    });

  program
    .command("uninstall")
    .description("Remove Kryton entries from every wired host's config")
    .option("--hosts <list>", `comma-separated host filter; valid: ${hostsList}`)
    .option("--dry-run", "preview the plan without writing")
    .option("--yes, -y", "non-interactive: force-uninstall even on hash mismatch")
    .action(async (opts) => {
      process.exitCode = await cmdUninstall(opts);
    });

  program
    .command("status")
    .description("Print the current wiring + API-key prefix")
    .action(() => {
      process.exitCode = cmdStatus();
    });

  program
    .command("detect")
    .description("List detected AI agent hosts without writing anything")
    .action(async () => {
      process.exitCode = await cmdDetect();
    });

  program
    .command("mcp")
    .description("Print the MCP entry snippet for manual wiring")
    .option("--host <name>", `print just this host's shape; valid: ${hostsList}`)
    .action((opts) => {
      process.exitCode = cmdMcpSnippet(opts);
    });

  try {
    await program.parseAsync(argv);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  const code = process.exitCode;
  return typeof code === "number" ? code : 0;
}

// CLI shebang guard — match novamem-init's symlink-aware check so npx /
// node_modules/.bin invocations still run `runCli`.
const here = fileURLToPath(import.meta.url);
let invokedAsCli = false;
try {
  invokedAsCli = process.argv[1] ? realpathSync(process.argv[1]) === here : false;
} catch {
  /* argv[1] may not exist when imported */
}
if (invokedAsCli) {
  runCli(process.argv).then((code) => process.exit(code));
}
