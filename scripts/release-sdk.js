import { execSync } from "node:child_process";

/**
 * Publish @azrtydxb/sdk to public npm.
 * Called by scripts/release.js after the tag is created.
 *
 * @param {object} [opts]
 * @param {(cmd: string) => string} [opts.exec]
 * @param {boolean} [opts.dryRun]
 */
export async function publishSdk({
  exec = (cmd) => execSync(cmd, { stdio: "inherit" }),
  dryRun = false,
} = {}) {
  const flags = dryRun ? "--access public --dry-run" : "--access public";
  exec(`npm publish ${flags} --workspace=packages/sdk`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await publishSdk({ dryRun: process.argv.includes("--dry-run") });
}
