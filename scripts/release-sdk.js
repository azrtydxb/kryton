import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Publish @azrtydxb/sdk to public npm.
 * Called by scripts/release.js after the tag is created.
 *
 * npm refuses to publish a prerelease version (one with a `-pre.N` suffix)
 * without an explicit `--tag`, since it must not move the default `latest`
 * dist-tag. So prereleases publish under `next` and stable versions under
 * `latest`. The version is read from the SDK's package.json (which the release
 * flow keeps in sync with the git tag).
 *
 * @param {object} [opts]
 * @param {(cmd: string) => string} [opts.exec]
 * @param {boolean} [opts.dryRun]
 */
export async function publishSdk({
  exec = (cmd) => execSync(cmd, { stdio: "inherit" }),
  dryRun = false,
} = {}) {
  const pkgUrl = new URL("../packages/sdk/package.json", import.meta.url);
  const { version } = JSON.parse(readFileSync(pkgUrl, "utf8"));
  const distTag = version.includes("-") ? "next" : "latest";
  const flags = `--access public --tag ${distTag}${dryRun ? " --dry-run" : ""}`;
  exec(`npm publish ${flags} --workspace=packages/sdk`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await publishSdk({ dryRun: process.argv.includes("--dry-run") });
}
